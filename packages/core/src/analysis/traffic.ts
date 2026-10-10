import { LocalFrame } from '../geo/projection';
import type { CityBaseline, LngLat, Network } from '../model/types';
import { buildGraph, dijkstra, type GraphEdge, type RoadGraph } from './graph';
import { junctionDelay } from './routing';

/**
 * Hourly share (%) of daily car trips: a DRIP assumption with morning and evening
 * peaks, NOT a measured profile. Editable by the user; always labelled as estimate.
 */
export const WEEKDAY_PROFILE = [0.6, 0.3, 0.2, 0.2, 0.4, 1.4, 4.2, 8.1, 8.6, 6.0, 5.2, 5.4, 6.2, 6.6, 5.4, 5.6, 6.4, 7.6, 8.2, 6.4, 3.9, 2.6, 1.6, 1.0];
export const WEEKEND_PROFILE = [1.2, 0.8, 0.5, 0.3, 0.3, 0.5, 1.2, 2.8, 4.6, 6.2, 7.4, 7.6, 7.2, 6.4, 5.4, 5.6, 6.2, 7.0, 7.6, 7.2, 5.4, 4.0, 2.6, 1.7];

/** Continuous hourly interpolation; profiles are explicit planning assumptions, not observations. */
export function hourlyDemandShare(day: number, hour: number, holiday = false): number {
  const profile = holiday || day >= 5 ? WEEKEND_PROFILE : WEEKDAY_PROFILE;
  const normalized = ((hour % 24) + 24) % 24, h = Math.floor(normalized), fraction = normalized - h;
  return profile[h]! * (1 - fraction) + profile[(h + 1) % 24]! * fraction;
}
export interface TrafficParams {
  readonly holiday?: boolean;
  readonly date?: string;
  /** Daily car trips generated/attracted by the study area (estimate, editable). */
  readonly dailyTrips: number;
  /** Share of trips crossing the area from/to its edges. */
  readonly externalShare: number;
  readonly day: number;
  readonly hour: number;
  readonly iterations: number;
  readonly growthPercent: number;
}

export const DEFAULT_TRAFFIC: TrafficParams = { dailyTrips: 60000, externalShare: 0.35, day: 1, hour: 8, iterations: 4, growthPercent: 0 };

export interface RoadFlow {
  readonly roadId: string;
  readonly forward: boolean;
  readonly volumeVph: number;
  readonly capacityVph: number;
  readonly vc: number;
  readonly speedKmh: number;
  readonly freeSpeedKmh: number;
}

export interface TrafficResult {
  readonly provenance: 'estimated';
  readonly method: string;
  readonly params: TrafficParams;
  readonly hourlyTrips: number;
  readonly flows: readonly RoadFlow[];
  readonly totals: { readonly vehKm: number; readonly vehHours: number; readonly avgSpeedKmh: number; readonly overCapacity: number; readonly unreachableTrips: number };
}

interface Zone { node: number; at: LngLat; prod: number; attr: number; external: boolean }

const ATTRACTOR_WEIGHT: Record<string, number> = { shop: 3, amenity: 2.5, office: 3, leisure: 1.5, transit_stop: 1, parking: 2, tourism: 1 };

/** Trip ends from real context: building floor area (production), POIs (attraction), boundary gateways (external). */
function zones(net: Network, baseline: CityBaseline, g: RoadGraph, frame: LocalFrame): Zone[] {
  const nodePos = g.nodeIds.map((id) => net.nodes[id]?.at).map((p) => (p ? frame.toMetric(p) : null));
  const cell = 120;
  const grid = new Map<string, number[]>();
  nodePos.forEach((p, i) => {
    if (!p || !g.out[i]!.length) return;
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const nearest = (p: readonly [number, number]): number | null => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    let best: number | null = null, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const q = nodePos[i]!;
        const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };
  const prod = new Float64Array(g.nodeIds.length), attr = new Float64Array(g.nodeIds.length);
  for (const b of Object.values(baseline.buildings)) {
    const c = b.footprint[0];
    if (!c) continue;
    let area = 0;
    const m = b.footprint.map((q) => frame.toMetric(q));
    for (let i = 0, j = m.length - 1; i < m.length; j = i++) area += m[j]![0] * m[i]![1] - m[i]![0] * m[j]![1];
    const floors = Math.max(1, Math.round(b.heightM / 3.2));
    const n = nearest(m[0]!);
    if (n !== null) { prod[n] = prod[n]! + (Math.abs(area) / 2) * floors; attr[n] = attr[n]! + (Math.abs(area) / 2) * floors * 0.4; }
  }
  for (const f of Object.values(baseline.features)) {
    const w = ATTRACTOR_WEIGHT[f.kind];
    if (!w || !f.coords[0]) continue;
    const n = nearest(frame.toMetric(f.coords[0]));
    if (n !== null) attr[n] = attr[n]! + w * 400;
  }
  const [W, S, E, Nn] = baseline.bbox;
  const edgeM = 150;
  const sw = frame.toMetric([W, S]), ne = frame.toMetric([E, Nn]);
  const out: Zone[] = [];
  for (let i = 0; i < g.nodeIds.length; i++) {
    const p = nodePos[i];
    if (!p || !g.out[i]!.length) continue;
    const boundary = p[0] - sw[0] < edgeM || ne[0] - p[0] < edgeM || p[1] - sw[1] < edgeM || ne[1] - p[1] < edgeM;
    const major = g.out[i]!.some((eid) => ['trunk', 'primary', 'secondary', 'tertiary'].includes(net.roads[g.edges[eid]!.roadId]?.roadClass ?? ''));
    if (prod[i]! > 0 || attr[i]! > 0 || (boundary && major)) {
      out.push({ node: i, at: net.nodes[g.nodeIds[i]!]!.at, prod: prod[i]!, attr: attr[i]!, external: boundary && major });
    }
  }
  return out;
}

/** Merge zones on a coarse grid so that assignment stays interactive (~150 zones). */
function cluster(zs: Zone[], frame: LocalFrame, cellM: number): Zone[] {
  const by = new Map<string, Zone>();
  for (const z of zs) {
    const p = frame.toMetric(z.at);
    const k = `${z.external ? 'x' : 'i'}${Math.floor(p[0] / cellM)},${Math.floor(p[1] / cellM)}`;
    const c = by.get(k);
    if (!c) by.set(k, { ...z });
    else { c.prod += z.prod; c.attr += z.attr; if (z.prod + z.attr > 0) c.node = (c.prod + c.attr) >= (z.prod + z.attr) ? c.node : z.node; }
  }
  return [...by.values()];
}

export function estimateTraffic(net: Network, baseline: CityBaseline, params: TrafficParams = DEFAULT_TRAFFIC): TrafficResult {
  const frame = new LocalFrame(baseline.origin);
  const g = buildGraph(net, frame, { mode: 'car', day: params.day, minutes: params.hour * 60, holiday: params.holiday, date: params.date });
  const zs = cluster(zones(net, baseline, g, frame), frame, 260);
  const internal = zs.filter((z) => !z.external), external = zs.filter((z) => z.external);
  const hourly = params.dailyTrips * (1 + params.growthPercent / 100) * hourlyDemandShare(params.day, params.hour, params.holiday) / 100;
  const P = internal.reduce((s, z) => s + z.prod, 0) || 1, A = internal.reduce((s, z) => s + z.attr, 0) || 1;
  // Morning peak: production → attraction; evening reverses. Through traffic between gateways.
  const reverse = params.hour >= 15;
  const pairs: { o: Zone; d: Zone; trips: number }[] = [];
  const intTrips = hourly * (1 - params.externalShare), extTrips = hourly * params.externalShare;
  for (const o of internal) {
    const share = (reverse ? o.attr / A : o.prod / P) * intTrips;
    if (share < 0.05) continue;
    const dests = internal.filter((d) => d !== o);
    const wsum = dests.reduce((s, d) => s + (reverse ? d.prod / P : d.attr / A), 0) || 1;
    for (const d of dests) {
      const t = share * ((reverse ? d.prod / P : d.attr / A) / wsum);
      if (t >= 0.05) pairs.push({ o, d, trips: t });
    }
  }
  if (external.length >= 2) {
    const per = extTrips / (external.length * (external.length - 1));
    for (const o of external) for (const d of external) if (o !== d) pairs.push({ o, d, trips: per * 0.5 });
    for (const x of external) for (const z of internal) {
      const t = (extTrips * 0.5 * (reverse ? z.prod / P : z.attr / A)) / external.length;
      if (t >= 0.05) pairs.push(reverse ? { o: z, d: x, trips: t } : { o: x, d: z, trips: t });
    }
  }
  const byOrigin = new Map<number, { d: number; trips: number }[]>();
  for (const p of pairs) (byOrigin.get(p.o.node) ?? byOrigin.set(p.o.node, []).get(p.o.node)!).push({ d: p.d.node, trips: p.trips });

  const vol = new Float64Array(g.edges.length);
  const cost = (e: GraphEdge) => {
    const vc = vol[e.id]! / e.capacityVph;
    return e.costS * (1 + 0.15 * vc ** 4);
  };
  const turn = (p: GraphEdge | null, e: GraphEdge) => junctionDelay(net, g.nodeIds[e.from]!, p, e);
  let unreachable = 0;
  const inc = Math.max(1, params.iterations);
  for (let it = 0; it < inc; it++) {
    for (const [o, list] of byOrigin) {
      const { dist, prev } = dijkstra(g, [{ node: o, cost: 0 }], { costOf: cost, turnPenalty: turn });
      for (const { d, trips } of list) {
        if (!Number.isFinite(dist[d]!)) { if (it === 0) unreachable += trips; continue; }
        let n = d;
        const f = trips / inc;
        while (prev[n]! >= 0) { const e = g.edges[prev[n]!]!; vol[e.id]! += f; n = e.from; }
      }
    }
  }
  const flows: RoadFlow[] = [];
  let vehKm = 0, vehH = 0, over = 0;
  for (const e of g.edges) {
    const v = vol[e.id]!;
    const vc = v / e.capacityVph;
    const t = e.costS * (1 + 0.15 * vc ** 4);
    const speed = (e.lengthM / Math.max(t, 1e-6)) * 3.6;
    flows.push({ roadId: e.roadId, forward: e.forward, volumeVph: Math.round(v), capacityVph: Math.round(e.capacityVph), vc: Math.round(vc * 100) / 100, speedKmh: Math.round(speed), freeSpeedKmh: Math.round(e.speedKmh) });
    vehKm += (v * e.lengthM) / 1000;
    vehH += (v * t) / 3600;
    if (vc > 1) over++;
  }
  return {
    provenance: 'estimated',
    method: 'Stima DRIP: domanda da superficie edificata e servizi OSM, profilo orario ipotetico (modificabile), assegnazione incrementale con funzione BPR (α 0,15, β 4). Non è un conteggio.',
    params, hourlyTrips: Math.round(hourly), flows,
    totals: { vehKm: Math.round(vehKm), vehHours: Math.round(vehH), avgSpeedKmh: vehH > 0 ? Math.round(vehKm / vehH) : 0, overCapacity: over, unreachableTrips: Math.round(unreachable) },
  };
}
