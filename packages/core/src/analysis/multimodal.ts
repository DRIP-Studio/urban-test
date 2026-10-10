import { LocalFrame } from '../geo/projection';
import { lengthOf, project, slice } from '../geo/polyline';
import type { LngLat, Network, TransitLine } from '../model/types';
import { buildGraph, snapToGraph, type RoutingContext } from './graph';
import { route, type Route, type RouteStep } from './routing';
import { nextTransitDeparture } from './transit';
import { networkAtWorksDate } from './works';
import { turnAllowed } from './turn-routing';

export interface TransitRouteOptions {
  /** Maximum actual walking distance per access or exit leg; this is a traveller preference. */
  accessM?: number;
  transferM?: number;
  requireTransit?: boolean;
  /** Services excluded when calculating a distinct alternative. */
  excludedLineIds?: readonly string[];
}
interface Leg { route: Route; waitS: number; instruction: string; }
interface Stop { line: TransitLine; index: number; at: LngLat; }
interface Service { offsets: number[]; segments: Route[]; }

/** Earliest scheduled arrival over authored transit services and the actual pedestrian graph.
 * No realtime data is implied. Services are directional; an opposite direction is another authored line.
 */
export function multimodalRoute(net: Network, origin: LngLat, from: LngLat, to: LngLat, ctx: RoutingContext, options: TransitRouteOptions = {}): Route {
  const frame = new LocalFrame(origin), walkCtx = { ...ctx, mode: 'walk' as const };
  const contextAt = (elapsed: number, mode = ctx.mode): RoutingContext => {
    const total = ctx.minutes * 60 + elapsed, days = Math.floor(total / 86400);
    const date = ctx.date ? new Date(Date.parse(ctx.date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10) : undefined;
    return {...ctx, mode, day: ((ctx.day + days) % 7 + 7) % 7, minutes: ((total % 86400) + 86400) % 86400 / 60, date, holiday: days === 0 ? ctx.holiday : false};
  };
  const views = new Map<string, Network>(), graphs = new Map<string, ReturnType<typeof buildGraph>>();
  const networkAt = (c: RoutingContext) => { const key = c.date ?? ''; if (!views.has(key)) views.set(key, networkAtWorksDate(net, key)); return views.get(key)!; };
  const graphAt = (c: RoutingContext) => { const key = `${c.date}:${c.day}:${Math.floor(c.minutes)}:${c.mode}:${c.holiday}`; if (!graphs.has(key)) { if(graphs.size>=64)graphs.delete(graphs.keys().next().value!);graphs.set(key, buildGraph(networkAt(c), frame, c)); } return graphs.get(key)!; };
  const graph = graphAt(walkCtx), accessM = options.accessM ?? 1200, transferM = options.transferM ?? 500;
  if (!Number.isFinite(accessM) || accessM < 0 || !Number.isFinite(transferM) || transferM < 0) throw Error('Distanze pedonali non valide');
  const gap = (a: LngLat, b: LngLat) => { const p = frame.toMetric(a), q = frame.toMetric(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
  const warnings: string[] = ['Ricerca partenze entro 24 ore; attese incluse nel viaggio.', 'Orari e velocità delle linee dello scenario; nessuna previsione in tempo reale.'];
  const empty = (): Route => ({ found: false, distanceM: 0, durationS: 0, line: [], roadIds: [], steps: [], mode: 'walk', warnings: [...warnings, 'Nessun servizio raggiungibile con gli orari e le distanze pedonali scelti'] });
  const walking = (a: LngLat, b: LngLat, limit: number, elapsed = 0): Route | null => {
    const c = contextAt(elapsed, 'walk'), view = networkAt(c), g = elapsed === 0 ? graph : graphAt(c);
    if (gap(a, b) > limit) return null;
    const r = route(view, origin, a, b, c, g);
    if (!r.found) return null;
    if (!r.line.length) {
      const snap = snapToGraph(view, g, frame, a);
      if (r.distanceM > 0.01 || gap(a,b) > 0.01 || !snap || snap.distM > 30) return null;
      return {...r, line:[a,b]};
    }
    // Short stop-access connectors are explicit; distant snaps must never bridge a disconnected network.
    const start = gap(a, r.line[0]!), end = gap(b, r.line[r.line.length - 1]!);
    if (start > 30 || end > 30 || r.distanceM + start + end > limit) return null;
    return { ...r, line: [a, ...r.line, b], distanceM: r.distanceM + start + end, durationS: r.durationS + (start + end) / (4.8 / 3.6) };
  };
  const services = new Map<string, Service>(), stops: Stop[] = [];
  for (const line of net.transit ?? []) {
    if (options.excludedLineIds?.includes(line.id)) continue;
    if (line.stops.length < 2 || line.line.length < 2 || !(line.speedKmh > 0)) continue;
    const rail = !['bus', 'brt', 'trolleybus', 'tram', 'on_demand'].includes(line.mode);
    const axis = line.line.map(p => frame.toMetric(p)), along = line.stops.map(s => project(axis, frame.toMetric(s.at)));
    if (along.some((p, i) => p.d > 60 || i > 0 && p.along < along[i - 1]!.along)) { warnings.push(`${line.name}: fermate fuori asse o non ordinate`); continue; }
    const offsets = [0], segments: Route[] = [], roadCtx = { ...ctx, mode: line.mode === 'tram' ? 'tram' as const : 'bus' as const };
    const roadGraph = rail ? undefined : buildGraph(net, frame, roadCtx, true);
    let valid = true;
    for (let i = 1; i < line.stops.length; i++) {
      let segment: Route;
      if (rail) {
        const pts = slice(axis, along[i - 1]!.along, along[i]!.along), distanceM = lengthOf(pts);
        segment = { found: true, distanceM, durationS: distanceM / (line.speedKmh / 3.6), line: pts.map(p => frame.toLngLat(p)), roadIds: [], steps: [], warnings: [], mode: 'bus' };
      } else {
        segment = route(net, origin, line.stops[i - 1]!.at, line.stops[i]!.at, roadCtx, roadGraph);
        if (!segment.found || !segment.line.length || gap(line.stops[i - 1]!.at, segment.line[0]!) > 60 || gap(line.stops[i]!.at, segment.line[segment.line.length - 1]!) > 60) { valid = false; break; }
        segment = { ...segment, durationS: Math.max(segment.durationS, segment.distanceM / (line.speedKmh / 3.6)) };
      }
      segments.push(segment); offsets.push(offsets[i - 1]! + segment.durationS + (line.dwellS ?? 20));
    }
    if (!valid) { warnings.push(`${line.name}: servizio stradale non connesso o bloccato`); continue; }
    services.set(line.id, { offsets, segments });
    line.stops.forEach((s, index) => stops.push({ line, index, at: s.at }));
  }
  const n = stops.length, dist = Array(n * 2).fill(Infinity) as number[], settled = new Set<number>();
  const prev = new Map<number, { from: number; legs: Leg[] }>();
  let best = Infinity, bestNode = -1, bestExit: Route | null = null;
  const direct = options.requireTransit ? null : walking(from, to, Infinity);
  if (direct) { best = direct.durationS; bestExit = direct; }
  for (let i = 0; i < n; i++) {
    const r = walking(from, stops[i]!.at, accessM);
    if (r) { dist[i] = r.durationS; prev.set(i, { from: -1, legs: [{ route: r, waitS: 0, instruction: 'A piedi fino alla fermata' }] }); }
  }
  // Spatial index keeps transfers local without limiting the number of transit services.
  const grid = new Map<string, number[]>(), cell = Math.max(1, transferM);
  stops.forEach((s, i) => { const p = frame.toMetric(s.at), key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`; grid.set(key, [...(grid.get(key) ?? []), i]); });
  const lineStops = new Map<string, number[]>();
  stops.forEach((s, i) => { const list = lineStops.get(s.line.id) ?? []; list[s.index] = i; lineStops.set(s.line.id, list); });
  while (true) {
    let u = -1, current = best;
    for (let i = 0; i < dist.length; i++) if (!settled.has(i) && dist[i]! < current) { current = dist[i]!; u = i; }
    if (u < 0) break;
    settled.add(u);
    const stop = stops[u % n]!, boarded = u >= n;
    const exit = boarded || !options.requireTransit ? walking(stop.at, to, accessM, current) : null;
    if (exit && current + exit.durationS < best) { best = current + exit.durationS; bestNode = u; bestExit = exit; }
    const relax = (v: number, cost: number, legs: Leg[]) => { if (cost < dist[v]!) { dist[v] = cost; prev.set(v, { from: u, legs }); } };
    const service = services.get(stop.line.id)!, offset = service.offsets[stop.index]!;
    const now = ctx.minutes * 60 + current;
    const today = contextAt(current), dayStart = Math.floor(now / 86400) * 86400;
    let departure = nextTransitDeparture(stop.line, today.day, now - dayStart - offset, today.holiday) + dayStart + offset;
    // Explore real subsequent slots when an earlier departure is closed. Search horizon: 24 hours.
    for (;Number.isFinite(departure) && departure - now <= 86400;) {
      let allUsable = true;
      const waitS = Math.max(0, departure - now), accumulated: Route[] = [];
      for (let j = stop.index + 1; j < stop.line.stops.length; j++) {
        const segment = service.segments[j - 1]!;
        const segmentStart = departure - ctx.minutes * 60 + service.offsets[j - 1]! - offset;
        // Check each minute boundary traversed, not only the query time or boarding time.
        // A scheduled line keeps its authored path; a closure invalidates this departure.
        let usable = true;
        for (let t = segmentStart; t <= segmentStart + segment.durationS;) {
          const c = contextAt(t, stop.line.mode === 'tram' ? 'tram' : 'bus'), g = graphAt(c);
          const directed = new Map(g.edges.map(e => [`${e.roadId}:${e.forward}`,e]));
          const edges=(segment.traversals??[]).map(e=>directed.get(`${e.roadId}:${e.forward}`));
          const ids = new Set(g.edges.map(e => e.roadId));
          if (segment.roadIds.some(id => !ids.has(id)) || edges.some(e=>!e) || edges.some((e,i)=>i>0&&!turnAllowed(networkAt(c),origin,g,edges[i-1]!,e!))) { usable = false; break; }
          if (t === segmentStart + segment.durationS) break;
          t = Math.min(segmentStart + segment.durationS, (Math.floor((ctx.minutes * 60 + t) / 60) + 1) * 60 - ctx.minutes * 60);
        }
        if (!usable) { allUsable = false;warnings.push(`${stop.line.name}: tratta non disponibile all'ora di passaggio`); break; }
        accumulated.push(segment);
        const durationS = service.offsets[j]! - offset - (stop.line.dwellS ?? 20);
        const r: Route = { found: true, distanceM: accumulated.reduce((s, r) => s + r.distanceM, 0), durationS, line: accumulated.flatMap(r => [...r.line]), roadIds: accumulated.flatMap(r => [...r.roadIds]), steps: [], warnings: [], mode: 'bus' };
        relax(n + lineStops.get(stop.line.id)![j]!, current + waitS + durationS, [{ route: r, waitS, instruction: `${stop.line.name}: ${stop.line.stops[stop.index]!.name} → ${stop.line.stops[j]!.name}` }]);
      }
      if(allUsable)break;
      const nextTime=departure+0.01, nextContext=contextAt(nextTime-ctx.minutes*60), startDay=Math.floor(nextTime/86400)*86400;
      departure=nextTransitDeparture(stop.line,nextContext.day,nextTime-startDay-offset,nextContext.holiday)+startDay+offset;
    }
    const p = frame.toMetric(stop.at), x = Math.floor(p[0] / cell), y = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const v of grid.get(`${x + dx},${y + dy}`) ?? []) {
      if (stops[v]!.line.id === stop.line.id) continue;
      const r = walking(stop.at, stops[v]!.at, transferM, current);
      if (r) relax((boarded ? n : 0) + v, current + r.durationS, [{ route: r, waitS: 0, instruction: 'Cambio linea a piedi' }]);
    }
  }
  if (!bestExit || !Number.isFinite(best)) return empty();
  const legs: Leg[] = [{ route: bestExit, waitS: 0, instruction: 'A piedi alla destinazione' }];
  for (let u = bestNode; u >= 0;) { const p = prev.get(u)!; legs.unshift(...p.legs); u = p.from; }
  const steps: RouteStep[] = legs.flatMap(leg => [
    ...(leg.waitS > 0 ? [{ roadName: '', distanceM: 0, durationS: leg.waitS, maneuver: 'straight' as const, instruction: `Attendi ${Math.ceil(leg.waitS / 60)} min alla fermata`, at: leg.route.line[0]! }] : []),
    { roadName: '', distanceM: leg.route.distanceM, durationS: leg.route.durationS, maneuver: 'straight' as const, instruction: leg.instruction, at: leg.route.line[0]! },
  ]);
  return { found: true, distanceM: legs.reduce((s, l) => s + l.route.distanceM, 0), durationS: best, line: legs.flatMap(l => [...l.route.line]), roadIds: [...new Set(legs.flatMap(l => [...l.route.roadIds]))], steps, warnings: [...new Set(warnings)], mode: 'walk' };
}

/** Distinct scheduled alternatives: remove each used service and recompute a real journey. */
export function multimodalAlternatives(net: Network, origin: LngLat, from: LngLat, to: LngLat, ctx: RoutingContext, options: TransitRouteOptions = {}): Route[] {
  const first = multimodalRoute(net,origin,from,to,ctx,options);
  if(!first.found)return [first];
  const candidates: Route[] = [first], signature=(r:Route)=>JSON.stringify(r.steps.map(s=>[s.instruction,s.distanceM]));
  const seen = new Set([signature(first)]);
  for(const line of net.transit??[]) {
    if(!first.steps.some(s=>s.instruction.startsWith(line.name+':')))continue;
    const r=multimodalRoute(net,origin,from,to,ctx,{...options,excludedLineIds:[...(options.excludedLineIds??[]),line.id]});
    const key=signature(r);if(r.found&&!seen.has(key)){seen.add(key);candidates.push(r);}
  }
  return candidates.sort((a,b)=>a.durationS-b.durationS).slice(0,3);
}
