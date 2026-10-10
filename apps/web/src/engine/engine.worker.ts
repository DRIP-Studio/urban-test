/// <reference lib="webworker" />
import {
  fuseTraffic, type TrafficSourceMode, type TrafficObservation, type TrafficSegment,
  multimodalAlternatives, multimodalRoute, gradingQuantities, type Area,type TerrainGrid, networkAtWorksDate, detectUtilityClashes, NetworkReplayer, PhysicalCache, analyzeJunction, analyzeSignalJunction, congestedTravel, routeAlternatives, analyzeNetwork, auditScenario, buildPhysicalModel, estimateTraffic, DEFAULT_TRAFFIC,
  coordinateCorridor, detectCorridors, designPlant, groupDemand, optimizeNetworkSignals, sidewalkCoverage, isochrone, route, routeVia, screenSafety, serviceAccess, signalHeads, suggestSignalPlan,
  type CityBaseline, type Network, type Operation, type PhysLine, type PhysPolygon, type TrafficResult, type SimOptions, type SimView,
} from '@drip-urban/core';
import type { Geometry, LineString, Polygon } from './geojson';
import type { EngineRequest, EngineResponse, LayerDiff } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let baseline: CityBaseline | null = null;
const replayer = new NetworkReplayer();
let net: Network | null = null;
let authoredNet: Network | null = null;
let lastTraffic: TrafficResult | null = null;
/** Traffic estimate of the existing city (for «today» with congestion); the baseline never changes in a session. */
let baseTraffic: TrafficResult | null = null;

const post = (m: EngineResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);

function polyFeature(p: PhysPolygon) {
  const ring = [...p.ring, p.ring[0]!];
  const holes = (p.holes ?? []).map((h) => [...h, h[0]!]);
  return {
    type: 'Feature' as const, id: p.id,
    geometry: { type: 'Polygon' as const, coordinates: [ring, ...holes] },
    properties: { id: p.id, kind: p.kind, material: p.material, state: p.state, z: p.z, h: p.heightM, roadId: p.roadId ?? null, nodeId: p.nodeId ?? null, areaId: p.areaId ?? null, areaKind: p.areaKind ?? null },
  };
}
function lineFeature(l: PhysLine) {
  return { type: 'Feature' as const, id: l.id, geometry: { type: 'LineString' as const, coordinates: l.line }, properties: { id: l.id, kind: l.kind, state: l.state, roadId: l.roadId ?? null, nodeId: l.nodeId ?? null } };
}

const physCache = new PhysicalCache();
type Item = PhysPolygon | PhysLine;
/** Previous build, per layer: id → source object. Cache hits keep the same object, so identity is the fast path. */
const prev = { surfaces: new Map<string, Item>(), markings: new Map<string, Item>(), lines: new Map<string, Item>() };

function diffLayer<G extends Geometry, T extends Item = Item>(layer: keyof typeof prev, items: readonly T[], toFeature: (x: T) => { id: string } & object, full: boolean): LayerDiff<G> {
  const old = prev[layer];
  const next = new Map<string, Item>();
  const add: object[] = [];
  for (const it of items) {
    next.set(it.id, it);
    if (full) { add.push(toFeature(it)); continue; }
    const was = old.get(it.id);
    if (was === it) continue;
    if (was && JSON.stringify(was) === JSON.stringify(it)) { next.set(it.id, was); continue; }
    add.push(toFeature(it));
  }
  const remove = full ? [] : [...old.keys()].filter((id) => !next.has(id));
  prev[layer] = next;
  return { full, add: add as LayerDiff<G>['add'], remove };
}

function build(ops: readonly Operation[], rev: number, full: boolean,worksDate?:string): void {
  if (!baseline) return;
  const t0 = performance.now();
  const r = replayer.derive(baseline, ops);
  const changed = net !== r.net;
  authoredNet = r.net;
  net = networkAtWorksDate(r.net,worksDate);
  if (changed) lastTraffic = null;
  const m = buildPhysicalModel(net, { origin: baseline.origin, features: baseline.features, cache: physCache });
  const diff = {
    surfaces: diffLayer<Polygon, PhysPolygon>('surfaces', m.surfaces, polyFeature, full),
    markings: diffLayer<Polygon, PhysPolygon>('markings', m.markings, polyFeature, full),
    lines: diffLayer<LineString, PhysLine>('lines', m.lines, lineFeature, full),
    heads: signalHeads(net, baseline.origin),
  };
  post({ type: 'physical', rev, diff, stats: { ...m.stats, ms: Math.round(performance.now() - t0) }, failed: r.failed.map((f) => ({ opId: f.op.id, type: f.op.type, messages: f.issues.map((i) => i.message) })) });
}

function runJob(kind: string, args: Record<string, unknown>): unknown {
  if (!baseline || !net) throw new Error('Motore non inizializzato');
  const o = baseline.origin;
  switch (kind) {
    case 'trafficState': {
      const mode=args.mode as TrafficSourceMode,now=Number(args.now),observations=args.observations as TrafficObservation[];
      let estimates:TrafficSegment[]=[];
      if(mode==='simulated'||mode==='hybrid'){
        const result=estimateTraffic(net,baseline,{...DEFAULT_TRAFFIC,...args.params as object});
        estimates=result.flows.map(f=>({roadId:f.roadId,forward:f.forward,speedKmh:f.speedKmh,flowVph:f.volumeVph,densityVehKm:f.speedKmh>0?f.volumeVph/f.speedKmh:null,confidence:.35,source:'estimated',provider:'DRIP assegnazione domanda dichiarata',capturedAt:new Date(now).toISOString(),closed:false,matchDistanceM:0}));
      }
      return fuseTraffic(net,o,mode,observations,estimates,now);
    }
    case 'route': return route(net, o, args.from as [number, number], args.to as [number, number], args.ctx as Parameters<typeof route>[4]);
    case 'compareRoute': {
      const base = new NetworkReplayer().derive(baseline, []).net;
      // Origin, optional stops (navigatore a tappe), destination.
      const pts = [args.from, ...((args.via as [number, number][] | undefined) ?? []), args.to] as [number, number][];
      const ctx = args.ctx as Parameters<typeof route>[4];
      if (args.strategy === 'transit' || args.strategy === 'multimodal') {
        if (pts.length > 2) throw Error('Le tappe intermedie richiedono il percorso stradale; scegli A e B per il viaggio TPL');
        const options = { requireTransit: args.strategy === 'transit', accessM: Number(args.accessM ?? 1200), transferM: Number(args.transferM ?? 500) };
        const alternatives = multimodalAlternatives(authoredNet ?? net, o, pts[0]!, pts[1]!, ctx, options);
        const project = alternatives[0]!;
        return { today: multimodalRoute(base, o, pts[0]!, pts[1]!, ctx, options), project, alternatives };
      }
      // With traffic: real times from the DRIP estimate (BPR), for today and for the project alike.
      let todayCost = {}, projectCost = {};
      if (args.traffic && !ctx.trafficState) {
        const params = { ...DEFAULT_TRAFFIC, ...(lastTraffic?.params ?? {}), day: ctx.day, hour: ctx.minutes / 60, holiday: ctx.holiday, date: ctx.date };
        const matches = (r: TrafficResult | null) => r && r.params.day === params.day && r.params.hour === params.hour && r.params.holiday === params.holiday && r.params.date === params.date && r.params.dailyTrips === params.dailyTrips;
        if (!matches(lastTraffic)) lastTraffic = estimateTraffic(net, baseline, params);
        if (!matches(baseTraffic)) baseTraffic = estimateTraffic(base, baseline, params);
        todayCost = { travel: congestedTravel(baseTraffic!.flows) };
        projectCost = { travel: congestedTravel(lastTraffic!.flows) };
      }
      const alternatives = routeAlternatives(net, o, pts, ctx, projectCost);
      return { today: routeVia(base, o, pts, ctx, todayCost), project: alternatives[0]!, alternatives };
    }
    case 'junction': {
      // A signalised junction is analysed as its controller sees it (approaches left out of the plan excluded).
      const plan = Object.values(net.signalPlans).find((p) => p.nodeId === args.nodeId);
      const a = plan ? analyzeSignalJunction(net, o, plan) : analyzeJunction(net, o, args.nodeId as string);
      if (!a) return null;
      // Webster on the DRIP traffic estimate when one has been computed, else on typical flows per road class.
      const demand = lastTraffic ? groupDemand(a, lastTraffic.flows, net) : undefined;
      return { analysis: a, suggested: suggestSignalPlan(net, a, { demand, permissiveLeft: args.permissiveLeft as boolean | undefined }) };
    }
    case 'optimizeSignals': {
      // Network-wide Webster on the DRIP traffic estimate (computed now if missing).
      if (!lastTraffic) lastTraffic = estimateTraffic(net, baseline);
      const flows = lastTraffic.flows;
      return optimizeNetworkSignals(net, o, (a) => groupDemand(a, flows, net!));
    }
    case 'sidewalks': return sidewalkCoverage(net, baseline);
    case 'coordinate': {
      const ids = args.planIds as string[];
      const plans = ids.map((id) => net!.signalPlans[id]).filter((p): p is NonNullable<typeof p> => !!p);
      return coordinateCorridor(net, o, plans, args.speedKmh as number, (args.cycleS as number | null) ?? null, args.direction as 'oneway' | 'twoway', { allowHalfCycle: args.allowHalfCycle as boolean | undefined });
    }
    case 'detectCorridors': return detectCorridors(net, o, { maxSpacingM: args.maxSpacingM as number | undefined });
    case 'designPlant': {
      const plans = (args.planIds as string[]).map((id) => net!.signalPlans[id]).filter((p): p is NonNullable<typeof p> => !!p);
      return designPlant(net, o, plans, args.speedKmh as number | undefined);
    }
    case 'traffic': {
      lastTraffic = estimateTraffic(net, baseline, args.params as Parameters<typeof estimateTraffic>[2]);
      return lastTraffic;
    }
    case 'trafficCompare': {
      const p = args.params as Parameters<typeof estimateTraffic>[2];
      const base = new NetworkReplayer().derive(baseline, []).net;
      return { today: estimateTraffic(base, baseline, p), project: estimateTraffic(net, baseline, p) };
    }
    case 'physicalFor': {
      const n = networkAtWorksDate(new NetworkReplayer().derive(baseline, args.ops as Operation[]).net,args.date as string|undefined);
      const m = buildPhysicalModel(n, { origin: baseline.origin, features: baseline.features });
      return { surfaces: { type: 'FeatureCollection', features: m.surfaces.sort((a, b) => a.z - b.z).map(polyFeature) }, markings: { type: 'FeatureCollection', features: m.markings.map(polyFeature) } };
    }
    case 'scenarioMetrics': {
      const n = new NetworkReplayer().derive(baseline, args.ops as Operation[]).net;
      const traffic = estimateTraffic(n, baseline, args.params as Parameters<typeof estimateTraffic>[2]);
      const safety = screenSafety(n, baseline, (args.crashes as Parameters<typeof screenSafety>[2]) ?? [], traffic);
      // Safety scores are normalised per run, so scenarios are compared on raw geometric conflicts.
      return { totals: traffic.totals, crossingConflicts: safety.reduce((s, x) => s + x.factors.crossingConflicts, 0), junctions: safety.length };
    }
    case 'safety': return screenSafety(net, baseline, (args.crashes as Parameters<typeof screenSafety>[2]) ?? [], args.useTraffic ? lastTraffic : null);
    case 'network': return analyzeNetwork(net, o, 50, args.ctx ? { ...(args.ctx as { day: number; minutes: number }), mode: 'car' } : undefined);
    case 'access': return serviceAccess(net, baseline, (args.minutes as number) ?? 7, (args.mode as 'walk' | 'bike') ?? 'walk', args.ctx as { day: number; minutes: number });
    case 'isochrone': return isochrone(net, o, args.at as [number, number], args.mode as 'walk', args.minutes as number, args.ctx as { day: number; minutes: number });
    case 'grading': {if(!args.terrain)throw Error('DTM richiesto');return gradingQuantities(args.area as Area,args.terrain as TerrainGrid,Number(args.stepM));}
    case 'utilityClashes': return detectUtilityClashes(net,baseline,args as unknown as Parameters<typeof detectUtilityClashes>[2]);
    case 'audit': return auditScenario(net, o, lastTraffic);
    default: throw new Error(`Analisi sconosciuta: ${kind}`);
  }
}

self.onmessage = (ev: MessageEvent<EngineRequest>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      baseline = m.baseline; replayer.derive(baseline, []); net = null; authoredNet = null; lastTraffic = null; baseTraffic = null;
      prev.surfaces.clear(); prev.markings.clear(); prev.lines.clear();
      post({ type: 'ready' }); return;
    }
    if (m.type === 'build') { build(m.ops, m.rev, Boolean(m.full) || prev.surfaces.size === 0,m.worksDate); return; }
    if (m.type === 'job') {
      try { post({ type: 'job', id: m.id, ok: true, result: runJob(m.kind, m.args) }); }
      catch (e) { post({ type: 'job', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) }); }
    }
  } catch (e) { post({ type: 'error', message: e instanceof Error ? e.message : String(e) }); }
};
