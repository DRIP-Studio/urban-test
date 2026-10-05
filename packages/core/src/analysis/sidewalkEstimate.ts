import { LocalFrame } from '../geo/projection';
import { add, dot, pointInRing, ringSelfIntersects, intersectLines, leftNormal, lengthOf, mul, sampleAt, sub, unit, type V } from '../geo/polyline';
import type { CityBaseline, LngLat, Network, Road } from '../model/types';
import { isPedestrianRoad, layoutSection } from '../physical/section';
import { armKey, buildJunction } from '../physical/junction';
import { MetricCache, incidence, vehicularArms, type Arm } from '../physical/topology';

/**
 * Sidewalk coverage of every road side, without touching the roads:
 *  - `data`      the cross-section already has a sidewalk (OSM, survey, import);
 *  - `footway`   OSM maps a separate footway / path running alongside (percorso pedonale);
 *  - `estimated` no data and no footway: a sidewalk is estimated from the road class (DM 5/11/2001,
 *                min 1,50 m) and limited by the free space before the building fronts;
 *  - `no_room`   facades at the kerb (historic centre): no sidewalk can be estimated;
 *  - `rural`     no buildings nearby: no sidewalk expected.
 * Estimated sidewalks are an overlay: they can be switched on and off and never change the road.
 */

export type SideStatus = 'data' | 'footway' | 'estimated' | 'no_room' | 'rural';

export interface SidewalkSide {
  readonly key: string;
  readonly roadId: string;
  readonly side: 'left' | 'right';
  readonly status: SideStatus;
  readonly widthM: number;
  /** Band polygon outside the carriageway (WGS84), for estimated sidewalks: the first piece. */
  readonly ring?: readonly LngLat[];
  /** All pieces of the estimated sidewalk: interrupted at junctions, other carriageways and where the facades leave no room. */
  readonly rings?: readonly (readonly LngLat[])[];
  /** Outer (building-side) edge of each piece, for the dashed outline without seams. */
  readonly edges?: readonly (readonly LngLat[])[];
  /** Estimated length actually drawn (m). */
  readonly estimatedM?: number;
  readonly lengthM: number;
}

/**
 * Corner of two estimated sidewalks at a junction: kerb fillet with the same radius as the
 * carriageway (so it follows the asphalt exactly) and the back of the sidewalk rounded behind it.
 */
export interface SidewalkCorner {
  readonly key: string;
  readonly nodeId: string;
  /** The two sides it joins (`roadId:left|right`): switching either off removes the corner. */
  readonly sides: readonly [string, string];
  readonly ring: readonly LngLat[];
  readonly outer: readonly LngLat[];
}

export interface SidewalkCoverage {
  readonly sides: readonly SidewalkSide[];
  readonly corners: readonly SidewalkCorner[];
  readonly totals: Readonly<Record<SideStatus, number>>;
}

/** Recommended sidewalk width by road class (m): DM 5/11/2001 minimum 1,50; DPR 503/1996 accessibility. */
export const SIDEWALK_WIDTH: Readonly<Record<string, number>> = {
  primary: 2.5, secondary: 2.25, tertiary: 2.0, unclassified: 1.75, residential: 1.5, living_street: 1.5, trunk: 2.5, service: 1.5,
};
const SKIP = new Set(['motorway', 'motorway_link', 'trunk_link', 'track', 'construction', 'roundabout', 'steps', 'path', 'cycleway', 'footway', 'pedestrian', 'bridleway', 'raceway']);
/** Classes that in a town always get sidewalks (service only when it is a street, not a driveway). */
const URBAN_CLASS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'trunk', 'service']);
const CELL = 25;

function grid<T>(items: { a: V; b: V; v: T }[]) {
  const g = new Map<string, { a: V; b: V; v: T }[]>();
  for (const it of items) {
    const n = Math.max(1, Math.ceil(Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]) / (CELL / 2)));
    const keys = new Set<string>();
    for (let k = 0; k <= n; k++) keys.add(`${Math.floor((it.a[0] + ((it.b[0] - it.a[0]) * k) / n) / CELL)},${Math.floor((it.a[1] + ((it.b[1] - it.a[1]) * k) / n) / CELL)}`);
    for (const key of keys) (g.get(key) ?? g.set(key, []).get(key)!).push(it);
  }
  return (p: V, r: number) => {
    const out = new Set<{ a: V; b: V; v: T }>();
    for (let x = Math.floor((p[0] - r) / CELL); x <= Math.floor((p[0] + r) / CELL); x++) for (let y = Math.floor((p[1] - r) / CELL); y <= Math.floor((p[1] + r) / CELL); y++) for (const s of g.get(`${x},${y}`) ?? []) out.add(s);
    return [...out];
  };
}

const segDist = (p: V, a: V, b: V) => {
  const d = sub(b, a), L2 = dot(d, d);
  const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
  const q = add(a, mul(d, t));
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
};

/** Spacing of the samples along each side (m) and clearances. */
const STEP = 2;
const JUNCTION_MARGIN = 2.5; // corner radius allowance where another carriageway starts (DM 19/4/2006 raccordi)
const SIDE_MARGIN = 0.3;
const MIN_WIDTH = 0.9; // DM 236/1989 §8.2.1: minimum clear width of a pedestrian path
const MIN_PIECE = 6;
/** Kerb radius at junctions without an explicit one (same default as the physical model). */
const DEFAULT_CORNER_RADIUS = 4;

interface Sample { s: number; p: V; n: V; w: number; readonly wt: number }
interface Pending { readonly key: string; readonly road: Road; readonly side: 'left' | 'right'; readonly L: number; readonly samples: Sample[]; readonly cut: [number, number]; readonly corner: [boolean, boolean];
  /** Kerb-side and back-of-sidewalk points where the piece meets a corner, per end. */
  readonly joint: [{ inner: V; outer: V } | null, { inner: V; outer: V } | null] }

/** Width of an estimated side near one end (beyond the corner zone), 0 when the facades leave no room there. */
function endWidth(p: Pending | undefined, atStart: boolean): number {
  if (!p) return 0;
  const near = p.samples.filter((q) => { const d = atStart ? q.s : p.L - q.s; return d >= 4 && d <= 14; });
  if (!near.length) return 0;
  // The junction allowance does not apply where a corner takes over: the tight width counts.
  const w = Math.min(...near.map((q) => (q.w >= MIN_WIDTH ? q.w : q.wt)));
  return w >= MIN_WIDTH ? Math.round(w * 20) / 20 : 0;
}

/** One side of one road, before corners: a final status, or the samples of an estimated side. */
interface SideResult { readonly side: 'left' | 'right'; readonly L: number; readonly status: SideStatus; readonly widthM: number; readonly samples?: readonly Sample[] }
/** Per baseline (buildings are static), per road: last result and the roads it depended on. */
const resultCache = new WeakMap<CityBaseline, Map<string, { deps: Road[]; results: SideResult[] }>>();

/** Road side seen from an arm: the arm's left is the road's left when the arm starts the road. */
const roadSide = (arm: Arm, armSide: 'left' | 'right'): 'left' | 'right' => ((armSide === 'left') === arm.atStart ? 'left' : 'right');

export function sidewalkCoverage(net: Network, baseline: CityBaseline): SidewalkCoverage {
  const frame = new LocalFrame(baseline.origin);
  // Building edges (facades) and pedestrian ways (footways, paths, pedestrian streets).
  const facades: { a: V; b: V; v: null }[] = [];
  for (const bd of Object.values(baseline.buildings)) {
    const ring = bd.footprint.map((q) => frame.toMetric(q) as V);
    for (let i = 0; i < ring.length; i++) facades.push({ a: ring[i]!, b: ring[(i + 1) % ring.length]!, v: null });
  }
  const nearFacade = grid(facades);
  // Building footprints by grid cell, for point-in-building tests.
  const bcell = new Map<string, V[][]>();
  for (const bd of Object.values(baseline.buildings)) {
    const ring = bd.footprint.map((q) => frame.toMetric(q) as V);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y++) (bcell.get(`${x},${y}`) ?? bcell.set(`${x},${y}`, []).get(`${x},${y}`)!).push(ring);
  }
  const inBuilding = (q: V) => (bcell.get(`${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`) ?? []).some((r) => pointInRing(q, r));
  const walks: { a: V; b: V; v: V }[] = [];
  // Every vehicular carriageway (roundabout rings included): estimated sidewalks never enter one.
  const carriage: { a: V; b: V; v: { roadId: string; half: number } }[] = [];
  const degree = new Map<string, number>();
  for (const r of Object.values(net.roads)) {
    const ax = r.axis.map((q) => frame.toMetric(q) as V);
    const ped = isPedestrianRoad(r) || ['footway', 'path', 'pedestrian', 'steps'].includes(r.roadClass);
    if (ped) { for (let i = 1; i < ax.length; i++) walks.push({ a: ax[i - 1]!, b: ax[i]!, v: unit(sub(ax[i]!, ax[i - 1]!)) }); continue; }
    const lay = layoutSection(r);
    const half = Math.max(Math.abs(lay.cwLeft), Math.abs(lay.cwRight), 1.5);
    for (let i = 1; i < ax.length; i++) carriage.push({ a: ax[i - 1]!, b: ax[i]!, v: { roadId: r.id, half } });
    for (const n of [r.from, r.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  }
  const nearWalk = grid(walks);
  const nearRoad = grid(carriage);
  const ray = (p: V, dir: V, maxD: number): number | null => {
    const end = add(p, mul(dir, maxD));
    let best: number | null = null;
    for (const e of nearFacade(add(p, mul(dir, maxD / 2)), maxD / 2 + 1)) {
      const hit = intersectLines(p, sub(end, p), e.a, sub(e.b, e.a));
      if (hit && hit.s >= 0 && hit.s <= 1 && hit.t >= 0 && hit.t <= 1) { const d = hit.s * maxD; if (best === null || d < best) best = d; }
    }
    return best;
  };
  const sides: SidewalkSide[] = [];
  const totals: Record<SideStatus, number> = { data: 0, footway: 0, estimated: 0, no_room: 0, rural: 0 };
  const pending: Pending[] = [];
  /** Samples and status of both sides of one road (independent of every other estimated side). */
  const sideResults = (road: Road): SideResult[] => {
    const out: SideResult[] = [];
    const axis = road.axis.map((q) => frame.toMetric(q) as V);
    const L = lengthOf(axis);
    if (L < 8 || (road.roadClass === 'service' && (L < 40 || ['driveway', 'parking_aisle', 'drive-through'].includes(road.tags?.service ?? '')))) return out;
    const lay = layoutSection(road);
    const els = road.section.elements;
    const tag = road.tags?.sidewalk ?? road.tags?.['sidewalk:both'];
    const ends = [frame.toMetric(net.nodes[road.from]?.at ?? road.axis[0]!) as V, frame.toMetric(net.nodes[road.to]?.at ?? road.axis[road.axis.length - 1]!) as V];
    const atJunction = [(degree.get(road.from) ?? 0) >= 3, (degree.get(road.to) ?? 0) >= 3];
    /**
     * True when the point lies on another road's carriageway (with a corner allowance near junctions).
     * `tight`: where a corner will be built, the roads meeting at that end are the corner's business.
     */
    const blocked = (q: V, tight = false): boolean => {
      for (const c of nearRoad(q, 12)) {
        if (c.v.roadId === road.id) continue;
        if (tight) {
          const other = net.roads[c.v.roadId];
          const shares = (k: 0 | 1) => { const n = k ? road.to : road.from; return (other?.from === n || other?.to === n) && Math.hypot(q[0] - ends[k]![0], q[1] - ends[k]![1]) < 25; };
          if (shares(0) || shares(1)) continue;
        }
        const nearEnd = (atJunction[0] && Math.hypot(q[0] - ends[0]![0], q[1] - ends[0]![1]) < 25) || (atJunction[1] && Math.hypot(q[0] - ends[1]![0], q[1] - ends[1]![1]) < 25);
        if (segDist(q, c.a, c.b) < c.v.half + (nearEnd && !tight ? JUNCTION_MARGIN : SIDE_MARGIN)) return true;
      }
      return false;
    };
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const edge = side === 'left' ? lay.cwLeft : lay.cwRight;
      const outer = side === 'left' ? lay.outerLeft : lay.outerRight;
      const has = side === 'left' ? els[0]?.kind === 'sidewalk' : els[els.length - 1]?.kind === 'sidewalk';
      const push = (status: SideStatus, widthM: number) => { out.push({ side, L, status, widthM }); };
      if (has) { push('data', Math.abs(outer - edge)); continue; }
      // Samples along the side: facade gap and parallel footway.
      const want = SIDEWALK_WIDTH[road.roadClass] ?? 1.5;
      let walkHits = 0, facadeHits = 0;
      const samples: Sample[] = [];
      for (let s = 0; s <= L + 1e-6; s += STEP) {
        const st = Math.min(s, L);
        const { p, t } = sampleAt(axis, st);
        const nrm = mul(leftNormal(t), sign);
        const start = add(p, mul(leftNormal(t), edge));
        const g = ray(start, nrm, 30);
        if (g !== null) facadeHits++;
        const probe = add(start, mul(nrm, 3));
        if (nearWalk(probe, 6).some((w) => segDist(probe, w.a, w.b) < 5.5 && Math.abs(dot(w.v, t)) > 0.85)) walkHits++;
        // Width here: the standard width, limited by the free space before the facade.
        let w = Math.min(want, g === null ? want : g - 0.05);
        // Not on another carriageway: check the inner, middle and outer points of the band.
        // Near a junction the corner allowance applies; where a corner is built instead, the tight width is used.
        const wt = w >= MIN_WIDTH && ![0.2, w / 2, w].some((o) => blocked(add(start, mul(nrm, o)), true)) ? w : 0;
        if (w >= MIN_WIDTH && [0.2, w / 2, w].some((o) => blocked(add(start, mul(nrm, o))))) w = 0;
        samples.push({ s: st, p: start, n: nrm, w, wt });
      }
      const n = samples.length;
      if (!n) continue;
      if (tag === 'separate' || walkHits / n >= 0.5) { push('footway', 0); continue; }
      if (tag === 'no' || tag === 'none' || (side === 'left' && tag === 'right') || (side === 'right' && tag === 'left')) { push('rural', 0); continue; }
      // Built-up area: facades along the side, or buildings within 60 m of the road (estimated everywhere in town).
      const mid = sampleAt(axis, L / 2).p;
      const urban = facadeHits / n >= 0.2 || nearFacade(mid, 60).some((e) => segDist(mid, e.a, e.b) < 60) || URBAN_CLASS.has(road.roadClass) && nearFacade(mid, 150).length > 0;
      if (!urban) { push('rural', 0); continue; }
      // Between two samples the band must stay out of buildings: probe the outer edge and the middle line,
      // shrinking the width (or cutting the piece) where a footprint is hit.
      for (let i = 0; i < samples.length; i++) {
        const a = samples[i]!, b = samples[i + 1] ?? samples[i]!;
        while (a.w >= MIN_WIDTH) {
          let hit = inBuilding(add(a.p, mul(a.n, 0.15)));
          for (let k = 0; k <= 4 && !hit; k++) {
            const t = k / 4, base = add(a.p, mul(sub(b.p, a.p), t)), nn = unit(add(mul(a.n, 1 - t), mul(b.n, t)));
            const w = Math.min(a.w, b.w >= MIN_WIDTH ? b.w : a.w);
            hit = inBuilding(add(base, mul(nn, w))) || inBuilding(add(base, mul(nn, w / 2)));
          }
          if (!hit) break;
          a.w = a.w - 0.25 >= MIN_WIDTH ? a.w - 0.25 : 0;
          if (b !== a && b.w > a.w && a.w > 0) b.w = a.w;
        }
      }
      if (!samples.some((q) => q.w >= MIN_WIDTH)) { push('no_room', 0); continue; }
      out.push({ side, L, status: 'estimated', widthM: 0, samples });
    }
    return out;
  };

  // Incremental: a road reuses its result while it and every road within reach of its samples are the
  // same objects (the network is immutable, so an edit changes only the roads it touches).
  const cache = resultCache.get(baseline) ?? resultCache.set(baseline, new Map()).get(baseline)!;
  const RB = 100, reach = 45;
  const bboxOf = (r: Road) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of r.axis) { const [x, y] = frame.toMetric(q); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1] as const; };
  const allRoads = Object.values(net.roads);
  const boxes = new Map(allRoads.map((r) => [r, bboxOf(r)]));
  const cells = new Map<string, Road[]>();
  for (const [r, [x0, y0, x1, y1]] of boxes) for (let x = Math.floor(x0 / RB); x <= Math.floor(x1 / RB); x++) for (let y = Math.floor(y0 / RB); y <= Math.floor(y1 / RB); y++) (cells.get(`${x},${y}`) ?? cells.set(`${x},${y}`, []).get(`${x},${y}`)!).push(r);
  const neighbours = (r: Road): Road[] => {
    const [x0, y0, x1, y1] = boxes.get(r)!;
    const out = new Set<Road>();
    for (let x = Math.floor((x0 - reach) / RB); x <= Math.floor((x1 + reach) / RB); x++) for (let y = Math.floor((y0 - reach) / RB); y <= Math.floor((y1 + reach) / RB); y++) for (const o of cells.get(`${x},${y}`) ?? []) {
      const [a0, b0, a1, b1] = boxes.get(o)!;
      if (a1 >= x0 - reach && a0 <= x1 + reach && b1 >= y0 - reach && b0 <= y1 + reach) out.add(o);
    }
    return [...out].sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  const seen = new Set<string>();
  for (const road of allRoads) {
    if (isPedestrianRoad(road) || SKIP.has(road.roadClass) || road.tags?.roundabout) continue;
    seen.add(road.id);
    const deps = neighbours(road);
    const hit = cache.get(road.id);
    const results = hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i]) ? hit.results : sideResults(road);
    if (results !== hit?.results) cache.set(road.id, { deps, results });
    for (const r of results) {
      const key = `${road.id}:${r.side}`;
      if (r.samples) { pending.push({ key, road, side: r.side, L: r.L, samples: r.samples.map((q) => ({ ...q })), cut: [0, 0], corner: [false, false], joint: [null, null] }); continue; }
      sides.push({ key, roadId: road.id, side: r.side, status: r.status, widthM: r.widthM, lengthM: Math.round(r.L) });
      totals[r.status] += r.L;
    }
  }
  for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);

  // Corners: at every junction (roundabout rings excepted) two consecutive estimated sides are joined
  // by a corner built with the junction's own kerb geometry; the side pieces stop where it starts.
  const byKey = new Map(pending.map((q) => [q.key, q]));
  interface CornerDraft { key: string; nodeId: string; pa: Pending; pb: Pending; endA: 0 | 1; endB: 0 | 1; ring: V[]; kerbLen: number; nodeM: V }
  const drafts: CornerDraft[] = [];
  const metric = new MetricCache(frame);
  const ringNodes = new Set<string>();
  for (const r of Object.values(net.roads)) if (r.tags?.roundabout) { ringNodes.add(r.from); ringNodes.add(r.to); }
  for (const nodeId of incidence(net).byNode.keys()) {
    const node = net.nodes[nodeId];
    if (!node || ringNodes.has(nodeId)) continue;
    const arms = vehicularArms(net, nodeId, metric);
    if (arms.length < 2) continue;
    const sideOf = (a: Arm, sd: 'left' | 'right') => byKey.get(`${a.road.id}:${roadSide(a, sd)}`);
    const wl = arms.map((a) => endWidth(sideOf(a, 'left'), a.atStart));
    const wr = arms.map((a) => endWidth(sideOf(a, 'right'), a.atStart));
    if (!wl.some((w) => w > 0) || !wr.some((w) => w > 0)) continue;
    const mod: Arm[] = arms.map((a, i) => ({ ...a, outLeft: a.cwLeft + wl[i]!, outRight: a.cwRight - wr[i]! }));
    const radius = net.junctions[nodeId]?.cornerRadiusM ?? DEFAULT_CORNER_RADIUS;
    const nodeM = frame.toMetric(node.at) as V;
    const g = buildJunction(nodeId, nodeM, mod, radius);
    if (!g) continue;
    const own = new Set(arms.map((a) => a.road.id));
    const onOtherCarriageway = (q: V) => nearRoad(q, 12).some((c) => !own.has(c.v.roadId) && segDist(q, c.a, c.b) < c.v.half);
    g.corners.forEach((ring, k) => {
      const i = g.cornerArm[k]!, j = (i + 1) % arms.length;
      const a = arms[i]!, b = arms[j]!;
      if (!wl[i] || !wr[j]) return;
      const pa = sideOf(a, 'left')!, pb = sideOf(b, 'right')!;
      if (pa.key === pb.key) return;
      // Never over the junction itself (folded corners of very short or acute arms), buildings or other carriageways.
      if (pointInRing(nodeM, ring) || ring.some((q) => inBuilding(q)) || ring.some(onOtherCarriageway)) return;
      const kerbLen = g.kerbs[k]?.length ?? 0;
      if (kerbLen < 2 || ring.length < kerbLen + 2) return;
      drafts.push({ key: `${nodeId}:${k}`, nodeId, pa, pb, endA: a.atStart ? 0 : 1, endB: b.atStart ? 0 : 1, ring, kerbLen, nodeM });
      for (const [arm, p] of [[a, pa], [b, pb]] as const) {
        const end = arm.atStart ? 0 : 1;
        p.cut[end] = Math.max(p.cut[end], g.setbacks.get(armKey(arm)) ?? 0);
        p.corner[end] = true;
      }
    });
  }

  // Pieces: contiguous runs with room, trimmed where a corner takes over; widths smoothed to avoid saw-teeth.
  for (const p of pending) {
    const lo = p.cut[0], hi = p.L - p.cut[1];
    const at = (s: number): Sample => {
      let i = p.samples.findIndex((q) => q.s >= s);
      if (i < 0) i = p.samples.length - 1;
      const b = p.samples[i]!, a = p.samples[Math.max(0, i - 1)]!;
      const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      return { s, p: add(a.p, mul(sub(b.p, a.p), t)), n: unit(add(mul(a.n, 1 - t), mul(b.n, t))), w: Math.min(a.w, b.w), wt: Math.min(a.wt, b.wt) };
    };
    // Between a corner and the side, the junction allowance is no longer needed: the corner owns the kerb
    // radius. Samples there take the tight width when it stays out of buildings.
    const CORNER_ZONE = 10;
    for (const q of p.samples) {
      const zone = (p.corner[0] && q.s <= lo + CORNER_ZONE) || (p.corner[1] && q.s >= hi - CORNER_ZONE);
      if (!zone || q.w >= MIN_WIDTH || q.wt < MIN_WIDTH) continue;
      if (![0.15, q.wt / 2, q.wt].some((o) => inBuilding(add(q.p, mul(q.n, o))))) q.w = q.wt;
    }
    const samples = hi - lo < 1 ? [] : [at(lo), ...p.samples.filter((q) => q.s > lo + 0.05 && q.s < hi - 0.05), at(hi)];
    const rings: LngLat[][] = [], edges: LngLat[][] = [];
    let drawn = 0, wsum = 0, wcount = 0;
    let run: Sample[] = [];
    const flush = () => {
      const len = run.length >= 2 ? run[run.length - 1]!.s - run[0]!.s : 0;
      // Pieces ending on a corner may be short (two close junctions): they still close the gap.
      const onCorner = run.length >= 2 && ((p.corner[0] && Math.abs(run[0]!.s - lo) < 0.1) || (p.corner[1] && Math.abs(run[run.length - 1]!.s - hi) < 0.1));
      if (len >= MIN_PIECE || (onCorner && len >= 0.5)) {
        const ws = run.map((q, i) => Math.min(...run.slice(Math.max(0, i - 1), i + 2).map((x) => x.w)));
        const inner = run.map((q) => q.p);
        const outerPts = run.map((q, i) => add(q.p, mul(q.n, Math.round(ws[i]! * 20) / 20)));
        edges.push(outerPts.map((q) => frame.toLngLat(q)));
        if (p.corner[0] && Math.abs(run[0]!.s - lo) < 0.1) p.joint[0] = { inner: inner[0]!, outer: outerPts[0]! };
        if (p.corner[1] && Math.abs(run[run.length - 1]!.s - hi) < 0.1) p.joint[1] = { inner: inner[inner.length - 1]!, outer: outerPts[outerPts.length - 1]! };
        rings.push([...inner, ...[...outerPts].reverse()].map((q) => frame.toLngLat(q)));
        drawn += len;
        for (const w of ws) { wsum += w; wcount++; }
      }
      run = [];
    };
    for (const q of samples) { if (q.w >= MIN_WIDTH) run.push(q); else flush(); }
    flush();
    if (!rings.length) {
      sides.push({ key: p.key, roadId: p.road.id, side: p.side, status: 'no_room', widthM: 0, lengthM: Math.round(p.L) });
      totals.no_room += p.L;
      continue;
    }
    const widthM = wcount ? Math.round((wsum / wcount) * 10) / 10 : Math.max(endWidth(p, true), endWidth(p, false));
    sides.push({ key: p.key, roadId: p.road.id, side: p.side, status: 'estimated', widthM, lengthM: Math.round(p.L), ...(rings.length ? { ring: rings[0], rings, edges } : {}), estimatedM: Math.round(drawn) });
    totals.estimated += drawn;
  }
  // Corners meet the pieces exactly: their four end points are the pieces' own (the arm frame is straight,
  // the road axis may bend before the cut). A corner whose sides have no piece at that end is dropped.
  const corners: SidewalkCorner[] = [];
  for (const d of drafts) {
    const ja = d.pa.joint[d.endA], jb = d.pb.joint[d.endB];
    if (!ja || !jb) continue;
    const ring = [...d.ring];
    ring[0] = ja.inner;
    ring[d.kerbLen - 1] = jb.inner;
    ring[d.kerbLen] = jb.outer;
    ring[ring.length - 1] = ja.outer;
    if (ringSelfIntersects(ring) || pointInRing(d.nodeM, ring)) continue;
    corners.push({ key: d.key, nodeId: d.nodeId, sides: [d.pa.key, d.pb.key], ring: ring.map((q) => frame.toLngLat(q)), outer: ring.slice(d.kerbLen).map((q) => frame.toLngLat(q)) });
  }
  for (const k of Object.keys(totals) as SideStatus[]) totals[k] = Math.round(totals[k]);
  return { sides, corners, totals };
}
