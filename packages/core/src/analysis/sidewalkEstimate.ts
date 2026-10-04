import { LocalFrame } from '../geo/projection';
import { add, dot, pointInRing, intersectLines, leftNormal, lengthOf, mul, sampleAt, sub, unit, type V } from '../geo/polyline';
import type { CityBaseline, LngLat, Network, Road } from '../model/types';
import { isPedestrianRoad, layoutSection } from '../physical/section';

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
  /** Estimated length actually drawn (m). */
  readonly estimatedM?: number;
  readonly lengthM: number;
}

export interface SidewalkCoverage {
  readonly sides: readonly SidewalkSide[];
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
  for (const road of Object.values(net.roads)) {
    if (isPedestrianRoad(road) || SKIP.has(road.roadClass) || road.tags?.roundabout) continue;
    const axis = road.axis.map((q) => frame.toMetric(q) as V);
    const L = lengthOf(axis);
    if (L < 8 || (road.roadClass === 'service' && (L < 40 || ['driveway', 'parking_aisle', 'drive-through'].includes(road.tags?.service ?? '')))) continue;
    const lay = layoutSection(road);
    const els = road.section.elements;
    const tag = road.tags?.sidewalk ?? road.tags?.['sidewalk:both'];
    const ends = [frame.toMetric(net.nodes[road.from]?.at ?? road.axis[0]!) as V, frame.toMetric(net.nodes[road.to]?.at ?? road.axis[road.axis.length - 1]!) as V];
    const atJunction = [(degree.get(road.from) ?? 0) >= 3, (degree.get(road.to) ?? 0) >= 3];
    /** True when the point lies on another road's carriageway (with a corner allowance near junctions). */
    const blocked = (q: V): boolean => {
      for (const c of nearRoad(q, 12)) {
        if (c.v.roadId === road.id) continue;
        const nearEnd = (atJunction[0] && Math.hypot(q[0] - ends[0]![0], q[1] - ends[0]![1]) < 25) || (atJunction[1] && Math.hypot(q[0] - ends[1]![0], q[1] - ends[1]![1]) < 25);
        if (segDist(q, c.a, c.b) < c.v.half + (nearEnd ? JUNCTION_MARGIN : SIDE_MARGIN)) return true;
      }
      return false;
    };
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const edge = side === 'left' ? lay.cwLeft : lay.cwRight;
      const outer = side === 'left' ? lay.outerLeft : lay.outerRight;
      const has = side === 'left' ? els[0]?.kind === 'sidewalk' : els[els.length - 1]?.kind === 'sidewalk';
      const key = `${road.id}:${side}`;
      const push = (status: SideStatus, widthM: number, rings?: LngLat[][], estimatedM?: number) => {
        sides.push({ key, roadId: road.id, side, status, widthM, lengthM: Math.round(L), ...(rings?.length ? { ring: rings[0], rings, estimatedM: Math.round(estimatedM ?? 0) } : {}) });
        totals[status] += status === 'estimated' ? estimatedM ?? 0 : L;
      };
      if (has) { push('data', Math.abs(outer - edge)); continue; }
      // Samples along the side: facade gap and parallel footway.
      const want = SIDEWALK_WIDTH[road.roadClass] ?? 1.5;
      let walkHits = 0, facadeHits = 0;
      const samples: { s: number; p: V; n: V; w: number }[] = [];
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
        if (w >= MIN_WIDTH && [0.2, w / 2, w].some((o) => blocked(add(start, mul(nrm, o))))) w = 0;
        samples.push({ s: st, p: start, n: nrm, w });
      }
      const n = samples.length;
      if (!n) continue;
      if (tag === 'separate' || walkHits / n >= 0.5) { push('footway', 0); continue; }
      if (tag === 'no' || tag === 'none' || (side === 'left' && tag === 'right') || (side === 'right' && tag === 'left')) { push('rural', 0); continue; }
      // Built-up area: facades along the side, or buildings within 60 m of the road (estimated everywhere in town).
      const mid = sampleAt(axis, L / 2).p;
      const urban = facadeHits / n >= 0.2 || nearFacade(mid, 60).some((e) => segDist(mid, e.a, e.b) < 60) || URBAN_CLASS.has(road.roadClass) && nearFacade(mid, 150).length > 0;
      if (!urban) { push('rural', 0); continue; }
      // Contiguous runs with room become pieces; widths are smoothed to avoid saw-teeth.
      const rings: LngLat[][] = [];
      let drawn = 0, wsum = 0, wcount = 0;
      let run: typeof samples = [];
      const flush = () => {
        if (run.length >= 2 && run[run.length - 1]!.s - run[0]!.s >= MIN_PIECE) {
          const ws = run.map((q, i) => Math.min(...run.slice(Math.max(0, i - 1), i + 2).map((x) => x.w)));
          const inner = run.map((q) => q.p);
          const outerPts = run.map((q, i) => add(q.p, mul(q.n, Math.round(ws[i]! * 20) / 20)));
          rings.push([...inner, ...outerPts.reverse()].map((q) => frame.toLngLat(q)));
          drawn += run[run.length - 1]!.s - run[0]!.s;
          for (const w of ws) { wsum += w; wcount++; }
        }
        run = [];
      };
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
      for (const q of samples) { if (q.w >= MIN_WIDTH) run.push(q); else flush(); }
      flush();
      if (!rings.length) { push('no_room', 0); continue; }
      push('estimated', Math.round((wsum / Math.max(1, wcount)) * 10) / 10, rings, drawn);
    }
  }
  for (const k of Object.keys(totals) as SideStatus[]) totals[k] = Math.round(totals[k]);
  return { sides, totals };
}
