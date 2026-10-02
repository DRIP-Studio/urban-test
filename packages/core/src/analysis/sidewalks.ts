import { LocalFrame } from '../geo/projection';
import { add, intersectLines, leftNormal, lengthOf, mul, sampleAt, sub, type V } from '../geo/polyline';
import type { CityBaseline, CrossSection, CrossSectionElement, Provenance, Road } from '../model/types';
import { isPedestrianRoad, layoutSection } from '../physical/section';

/**
 * Existing sidewalks, derived from real geometry: on each side of a road, the free strip between the
 * carriageway edge and the building fronts (OSM footprints), measured every few metres along the road.
 * OSM tagging wins where present (`sidewalk=no|none|separate|left|right`). The result is declared as
 * derived: it is a measurement on mapped geometry, not a survey.
 */

export const SIDEWALK_PROVENANCE: Provenance = {
  kind: 'derived',
  source: 'Marciapiede ricavato dallo spazio tra carreggiata e fronte degli edifici (OpenStreetMap)',
};

const SKIP_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'track', 'service', 'construction', 'roundabout']);
const STEP = 4;
const RAY = 9;
const MIN_W = 0.9;
const MAX_W = 3.0;
const CELL = 20;

export interface SidewalkChange {
  readonly roadId: string;
  readonly section: CrossSection;
  readonly left: number | null;
  readonly right: number | null;
}

export interface SidewalkReport {
  readonly changes: SidewalkChange[];
  readonly roadsWithSidewalks: number;
  readonly roadsWithout: number;
  readonly totalLengthM: number;
}

function buildingEdges(b: CityBaseline, frame: LocalFrame) {
  const grid = new Map<string, [V, V][]>();
  for (const bd of Object.values(b.buildings)) {
    const ring = bd.footprint.map((q) => frame.toMetric(q) as V);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!;
      const keys = new Set<string>();
      const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / (CELL / 2)));
      for (let k = 0; k <= n; k++) {
        const x = a[0] + ((c[0] - a[0]) * k) / n, y = a[1] + ((c[1] - a[1]) * k) / n;
        keys.add(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
      }
      for (const key of keys) (grid.get(key) ?? grid.set(key, []).get(key)!).push([a, c]);
    }
  }
  return (p: V, dir: V, maxD: number): number | null => {
    const end = add(p, mul(dir, maxD));
    const seen = new Set<[V, V]>();
    let best: number | null = null;
    const steps = Math.ceil(maxD / (CELL / 2));
    for (let k = 0; k <= steps; k++) {
      const q = add(p, mul(dir, (maxD * k) / steps));
      for (const e of grid.get(`${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        const hit = intersectLines(p, sub(end, p), e[0], sub(e[1], e[0]));
        if (hit && hit.s >= 0 && hit.s <= 1 && hit.t >= 0 && hit.t <= 1) {
          const d = hit.s * maxD;
          if (best === null || d < best) best = d;
        }
      }
    }
    return best;
  };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
};

function sideWidth(gaps: (number | null)[]): number | null {
  const hits = gaps.filter((g): g is number => g !== null);
  if (hits.length < Math.max(2, gaps.length * 0.5)) return null; // open side: no facade to measure against
  const w = quantile(hits, 0.25); // conservative: the narrow stretches set the usable width
  if (w < MIN_W) return null; // facade at the kerb: no sidewalk (common in the historic centre)
  return Math.round(Math.min(MAX_W, w) * 10) / 10;
}

function withSidewalks(road: Road, left: number | null, right: number | null): CrossSection {
  const inner = road.section.elements.filter((e, i, arr) => {
    const outermost = i === 0 || i === arr.length - 1;
    return !(e.kind === 'sidewalk' && outermost);
  });
  const els: CrossSectionElement[] = [];
  if (left !== null) els.push({ id: `${road.id}:swl`, kind: 'sidewalk', widthM: left });
  els.push(...inner);
  if (right !== null) els.push({ id: `${road.id}:swr`, kind: 'sidewalk', widthM: right });
  return { ...road.section, elements: els };
}

export function inferSidewalks(b: CityBaseline): SidewalkReport {
  const frame = new LocalFrame(b.origin);
  const ray = buildingEdges(b, frame);
  const changes: SidewalkChange[] = [];
  let withSw = 0, without = 0, total = 0;
  for (const road of Object.values(b.roads)) {
    if (isPedestrianRoad(road) || SKIP_CLASSES.has(road.roadClass) || road.tags?.roundabout) continue;
    const tag = road.tags?.sidewalk ?? road.tags?.['sidewalk:both'];
    if (tag === 'separate') continue; // drawn as its own footway in OSM
    const axis = road.axis.map((q) => frame.toMetric(q) as V);
    const L = lengthOf(axis);
    if (L < 12) continue;
    const lay = layoutSection(road);
    const gl: (number | null)[] = [], gr: (number | null)[] = [];
    for (let s = 6; s <= L - 6; s += STEP) {
      const { p, t } = sampleAt(axis, s);
      const n = leftNormal(t);
      gl.push(ray(add(p, mul(n, lay.cwLeft)), n, RAY));
      gr.push(ray(add(p, mul(n, lay.cwRight)), mul(n, -1), RAY));
    }
    let left = sideWidth(gl), right = sideWidth(gr);
    if (tag === 'no' || tag === 'none') left = right = null;
    if (tag === 'both' || tag === 'yes') {
      // OSM says there are sidewalks: where no facade allows a measurement, keep the mapped width.
      const els = road.section.elements;
      if (left === null && els[0]?.kind === 'sidewalk') left = els[0].widthM;
      if (right === null && els[els.length - 1]?.kind === 'sidewalk') right = els[els.length - 1]!.widthM;
    }
    if (left === null && right === null) without++; else withSw++;
    total += ((left !== null ? 1 : 0) + (right !== null ? 1 : 0)) * L;
    const section = withSidewalks(road, left, right);
    if (JSON.stringify(section) !== JSON.stringify(road.section)) changes.push({ roadId: road.id, section, left, right });
  }
  return { changes, roadsWithSidewalks: withSw, roadsWithout: without, totalLengthM: Math.round(total) };
}
