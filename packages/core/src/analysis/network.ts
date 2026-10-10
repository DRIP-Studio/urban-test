import { LocalFrame } from '../geo/projection';
import type { CityBaseline, LngLat, Network, TravelMode } from '../model/types';
import { buildGraph, dijkstra, snapToGraph, type RoutingContext } from './graph';

export interface NetworkStats {
  readonly components: number;
  readonly largestShare: number;
  /** Roads not in the largest strongly-reachable component (car). */
  readonly isolatedRoadIds: readonly string[];
  /** Roads whose removal disconnects the network (bridges in the undirected graph). */
  readonly criticalRoadIds: readonly string[];
  /** Sampled edge betweenness 0..1 per road. */
  readonly centrality: Readonly<Record<string, number>>;
}

export function analyzeNetwork(net: Network, origin: LngLat, samples = 60, ctx: RoutingContext = { mode: 'car', day: 1, minutes: 600 }): NetworkStats {
  const frame = new LocalFrame(origin);
  const g = buildGraph(net, frame, ctx);
  const n = g.nodeIds.length;
  // Undirected adjacency for components and bridges.
  const adj: { to: number; road: string }[][] = Array.from({ length: n }, () => []);
  const seenRoad = new Set<string>();
  for (const e of g.edges) {
    if (seenRoad.has(e.roadId)) continue;
    seenRoad.add(e.roadId);
    adj[e.from]!.push({ to: e.to, road: e.roadId });
    adj[e.to]!.push({ to: e.from, road: e.roadId });
  }
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1 || !adj[s]!.length) continue;
    const c = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const { to } of adj[u]!) if (comp[to] === -1) { comp[to] = c; stack.push(to); }
    }
    sizes.push(size);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  const isolated = [...seenRoad].filter((rid) => {
    const e = g.edges.find((x) => x.roadId === rid)!;
    return comp[e.from] !== largest;
  });
  // Bridges (iterative Tarjan).
  const disc = new Int32Array(n).fill(-1), low = new Int32Array(n);
  const bridges: string[] = [];
  let time = 0;
  for (let s = 0; s < n; s++) {
    if (disc[s] !== -1 || !adj[s]!.length) continue;
    const stack: { u: number; parentRoad: string | null; i: number }[] = [{ u: s, parentRoad: null, i: 0 }];
    disc[s] = low[s] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const edges = adj[top.u]!;
      if (top.i < edges.length) {
        const { to, road } = edges[top.i++]!;
        if (road === top.parentRoad) continue;
        if (disc[to] === -1) { disc[to] = low[to] = time++; stack.push({ u: to, parentRoad: road, i: 0 }); }
        else low[top.u] = Math.min(low[top.u]!, disc[to]!);
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          low[parent.u] = Math.min(low[parent.u]!, low[top.u]!);
          if (low[top.u]! > disc[parent.u]!) bridges.push(top.parentRoad!);
        }
      }
    }
  }
  // Sampled betweenness on travel time (deterministic sample: evenly spaced nodes of the main component).
  const main = [...Array(n).keys()].filter((i) => comp[i] === largest);
  const step = Math.max(1, Math.floor(main.length / samples));
  const count = new Map<string, number>();
  for (let k = 0; k < main.length; k += step) {
    const { prev } = dijkstra(g, [{ node: main[k]! , cost: 0 }]);
    for (const t of main) {
      let v = t;
      while (prev[v]! >= 0) { const e = g.edges[prev[v]!]!; count.set(e.roadId, (count.get(e.roadId) ?? 0) + 1); v = e.from; }
    }
  }
  const max = Math.max(1, ...count.values());
  const centrality: Record<string, number> = {};
  for (const [k, v] of count) centrality[k] = Math.round((v / max) * 1000) / 1000;
  return { components: sizes.length, largestShare: sizes.length ? Math.max(...sizes) / sizes.reduce((s, x) => s + x, 0) : 0, isolatedRoadIds: isolated, criticalRoadIds: bridges, centrality };
}

export const SERVICE_CATEGORIES: Readonly<Record<string, { label: string; match: (kind: string, cat?: string) => boolean }>> = {
  school: { label: 'Scuole', match: (k, c) => c === 'school' || c === 'kindergarten' || c === 'college' },
  health: { label: 'Salute', match: (_k, c) => ['pharmacy', 'doctors', 'clinic', 'hospital', 'dentist'].includes(c ?? '') },
  parks: { label: 'Parchi e verde', match: (k, c) => k === 'green' || k === 'leisure' || c === 'park' || c === 'playground' || c === 'Piazza' },
  transit: { label: 'Trasporto pubblico', match: (k, c) => k === 'transit_stop' || c === 'Fermata TPL' || k === 'railway' },
  commerce: { label: 'Commercio', match: (k) => k === 'shop' },
  services: { label: 'Servizi', match: (_k, c) => ['bank', 'post_office', 'townhall', 'library', 'police', 'place_of_worship'].includes(c ?? '') },
};

export interface AccessResult {
  readonly minutesLimit: number;
  readonly mode: TravelMode;
  /** For each road: walking minutes to the nearest service of each category (null = unreachable). */
  readonly byRoad: Readonly<Record<string, Readonly<Record<string, number | null>>>>;
  /** Share of residential road length reaching every category within the limit. */
  readonly coverage: number;
  readonly categoryCoverage: Readonly<Record<string, number>>;
  readonly serviceCounts: Readonly<Record<string, number>>;
}

/** "Città dei 7 minuti": multi-source shortest paths from each service category on the walk graph. */
export function serviceAccess(net: Network, baseline: CityBaseline, minutes = 7, mode: TravelMode = 'walk', ctx: Omit<RoutingContext, 'mode'> = { day: 1, minutes: 600 }): AccessResult {
  const frame = new LocalFrame(baseline.origin);
  const g = buildGraph(net, frame, { ...ctx, mode });
  const byRoad: Record<string, Record<string, number | null>> = {};
  const catCov: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const roadLen = new Map<string, number>();
  for (const e of g.edges) roadLen.set(e.roadId, e.lengthM);
  const residential = [...roadLen.keys()].filter((id) => ['residential', 'living_street', 'tertiary', 'unclassified', 'pedestrian', 'footway'].includes(net.roads[id]?.roadClass ?? ''));
  const totalRes = residential.reduce((s, id) => s + roadLen.get(id)!, 0) || 1;
  const residentialSet=new Set(residential);
  const allOk = new Set(residential);
  for (const [cat, def] of Object.entries(SERVICE_CATEGORIES)) {
    const pts = Object.values(baseline.features).filter((f) => def.match(f.kind, f.category)).map((f) => f.coords[0]!);
    counts[cat] = pts.length;
    const sources: { node: number; cost: number }[] = [];
    for (const p of pts) {
      const s = snapToGraph(net, g, frame, p);
      if (!s || s.distM > 150) continue;
      const r = net.roads[s.roadId]!;
      const v = mode === 'walk' ? 4.8 / 3.6 : 15 / 3.6;
      const a = g.index.get(r.from), b = g.index.get(r.to);
      if (a !== undefined) sources.push({ node: a, cost: (s.along + s.distM) / v });
      if (b !== undefined) sources.push({ node: b, cost: (s.length - s.along + s.distM) / v });
    }
    const { dist } = sources.length ? dijkstra(g, sources, { maxCost: minutes * 60 * 3 }) : { dist: new Float64Array(g.nodeIds.length).fill(Infinity) };
    let ok = 0;
    for (const id of roadLen.keys()) {
      const r = net.roads[id]!;
      const a = g.index.get(r.from), b = g.index.get(r.to);
      const t = Math.min(a !== undefined ? dist[a]! : Infinity, b !== undefined ? dist[b]! : Infinity) / 60;
      (byRoad[id] ??= {})[cat] = Number.isFinite(t) ? Math.round(t * 10) / 10 : null;
      if (Number.isFinite(t) && t <= minutes) { if (residentialSet.has(id)) ok += roadLen.get(id)!; }
      else allOk.delete(id);
    }
    catCov[cat] = Math.round((ok / totalRes) * 1000) / 10;
  }
  const cov = [...allOk].reduce((s, id) => s + roadLen.get(id)!, 0) / totalRes;
  return { minutesLimit: minutes, mode, byRoad, coverage: Math.round(cov * 1000) / 10, categoryCoverage: catCov, serviceCounts: counts };
}

/** Isochrone: travel minutes to every reachable road from a point. */
export function isochrone(net: Network, origin: LngLat, at: LngLat, mode: TravelMode, maxMinutes: number, ctx: Omit<RoutingContext, 'mode'> = { day: 1, minutes: 600 }): Record<string, number> {
  const frame = new LocalFrame(origin);
  const g = buildGraph(net, frame, { ...ctx, mode });
  const s = snapToGraph(net, g, frame, at);
  if (!s) return {};
  const r = net.roads[s.roadId]!;
  const speed = (g.edges.find((e) => e.roadId === s.roadId)?.speedKmh ?? 4.8) / 3.6;
  const src: { node: number; cost: number }[] = [];
  const a = g.index.get(r.from), b = g.index.get(r.to);
  if (a !== undefined) src.push({ node: a, cost: s.along / speed });
  if (b !== undefined) src.push({ node: b, cost: (s.length - s.along) / speed });
  const { dist } = dijkstra(g, src, { maxCost: maxMinutes * 60 });
  const out: Record<string, number> = { [s.roadId]: 0 };
  for (const e of g.edges) {
    const t = Math.min(dist[e.from]!, dist[e.to]!) / 60;
    if (t <= maxMinutes) out[e.roadId] = Math.min(out[e.roadId] ?? Infinity, Math.round(t * 10) / 10);
  }
  return out;
}
