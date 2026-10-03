import { LocalFrame } from '../geo/projection';
import { add, band, dot, intersectLines, leftNormal, lengthOf, mul, sampleAt, sub, unit, type V } from '../geo/polyline';
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
  /** Band polygon outside the carriageway (WGS84), for estimated sidewalks. */
  readonly ring?: readonly LngLat[];
  readonly lengthM: number;
}

export interface SidewalkCoverage {
  readonly sides: readonly SidewalkSide[];
  readonly totals: Readonly<Record<SideStatus, number>>;
}

/** Recommended sidewalk width by road class (m): DM 5/11/2001 minimum 1,50; DPR 503/1996 accessibility. */
export const SIDEWALK_WIDTH: Readonly<Record<string, number>> = {
  primary: 2.5, secondary: 2.25, tertiary: 2.0, unclassified: 1.75, residential: 1.5, living_street: 1.5,
};
const SKIP = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'track', 'service', 'construction', 'roundabout', 'steps', 'path', 'cycleway', 'footway', 'pedestrian']);
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

export function sidewalkCoverage(net: Network, baseline: CityBaseline): SidewalkCoverage {
  const frame = new LocalFrame(baseline.origin);
  // Building edges (facades) and pedestrian ways (footways, paths, pedestrian streets).
  const facades: { a: V; b: V; v: null }[] = [];
  for (const bd of Object.values(baseline.buildings)) {
    const ring = bd.footprint.map((q) => frame.toMetric(q) as V);
    for (let i = 0; i < ring.length; i++) facades.push({ a: ring[i]!, b: ring[(i + 1) % ring.length]!, v: null });
  }
  const nearFacade = grid(facades);
  const walks: { a: V; b: V; v: V }[] = [];
  for (const r of Object.values(net.roads)) {
    if (!isPedestrianRoad(r) && !['footway', 'path', 'pedestrian', 'steps'].includes(r.roadClass)) continue;
    const ax = r.axis.map((q) => frame.toMetric(q) as V);
    for (let i = 1; i < ax.length; i++) walks.push({ a: ax[i - 1]!, b: ax[i]!, v: unit(sub(ax[i]!, ax[i - 1]!)) });
  }
  const nearWalk = grid(walks);
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
    if (L < 8) continue;
    const lay = layoutSection(road);
    const els = road.section.elements;
    const tag = road.tags?.sidewalk ?? road.tags?.['sidewalk:both'];
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const edge = side === 'left' ? lay.cwLeft : lay.cwRight;
      const outer = side === 'left' ? lay.outerLeft : lay.outerRight;
      const has = side === 'left' ? els[0]?.kind === 'sidewalk' : els[els.length - 1]?.kind === 'sidewalk';
      const key = `${road.id}:${side}`;
      const push = (status: SideStatus, widthM: number, ring?: LngLat[]) => {
        sides.push({ key, roadId: road.id, side, status, widthM, lengthM: Math.round(L), ...(ring ? { ring } : {}) });
        totals[status] += L;
      };
      if (has) { push('data', Math.abs(outer - edge)); continue; }
      // Samples along the side: facade gap and parallel footway.
      let walkHits = 0, facadeHits = 0, n = 0;
      const gaps: number[] = [];
      for (let s = 4; s <= L - 4; s += 5) {
        n++;
        const { p, t } = sampleAt(axis, s);
        const nrm = mul(leftNormal(t), sign);
        const start = add(p, mul(leftNormal(t), edge));
        const g = ray(start, nrm, 30);
        if (g !== null) { facadeHits++; gaps.push(g); }
        // A footway 0.5–8 m beyond the kerb, roughly parallel: the sidewalk is mapped separately.
        const probe = add(start, mul(nrm, 3));
        if (nearWalk(probe, 6).some((w) => segDist(probe, w.a, w.b) < 5.5 && Math.abs(dot(w.v, t)) > 0.85)) walkHits++;
      }
      if (!n) continue;
      if (tag === 'separate' || walkHits / n >= 0.5) { push('footway', 0); continue; }
      if (tag === 'no' || tag === 'none' || (side === 'left' && tag === 'right') || (side === 'right' && tag === 'left')) { push('rural', 0); continue; }
      if (facadeHits / n < 0.2) { push('rural', 0); continue; }
      const free = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.25)] ?? 0;
      if (free < 1.0) { push('no_room', 0); continue; }
      const want = SIDEWALK_WIDTH[road.roadClass] ?? 1.5;
      const w = Math.round(Math.min(want, free - 0.1) * 10) / 10;
      if (w < 0.9) { push('no_room', 0); continue; }
      const a = edge, b = edge + sign * w;
      const ring = band(axis, Math.max(a, b), Math.min(a, b)).map((q) => frame.toLngLat(q));
      push('estimated', w, ring);
    }
  }
  for (const k of Object.keys(totals) as SideStatus[]) totals[k] = Math.round(totals[k]);
  return { sides, totals };
}
