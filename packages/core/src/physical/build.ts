import { LocalFrame } from '../geo/projection';
import { add, band, leftNormal, lengthOf, mul, offset, project, sampleAt, slice, type V } from '../geo/polyline';
import type { CityFeature, JunctionSpec, LngLat, Network, ProvenanceKind, Road } from '../model/types';
import { armKey, buildJunction, type JunctionGeometry } from './junction';
import { arrowRing, arrowStations, dashFor, dashes, hasEdgeLines, MARKING, solid, zebra } from './markings';
import { buildRoundabouts } from './roundabout';
import { layoutSection } from './section';
import { MetricCache, vehicularArms } from './topology';

export type SurfaceKind =
  | 'carriageway' | 'bus' | 'median' | 'cycle' | 'parking' | 'sidewalk' | 'furniture' | 'green' | 'shoulder' | 'curb'
  | 'junction' | 'corner' | 'footpath'
  | 'roundabout_ring' | 'roundabout_island' | 'roundabout_apron' | 'splitter' | 'area';

export type MarkKind = 'lane_line' | 'edge_line' | 'center_line' | 'stop_line' | 'give_way' | 'zebra' | 'arrow' | 'ring_line';

export type PhysState = 'existing' | 'project';

export interface PhysPolygon {
  readonly id: string;
  readonly kind: SurfaceKind | MarkKind;
  readonly ring: readonly LngLat[];
  readonly holes?: readonly (readonly LngLat[])[];
  readonly roadId?: string;
  readonly nodeId?: string;
  readonly areaId?: string;
  readonly areaKind?: string;
  readonly state: PhysState;
  readonly material: string;
  /** Draw order inside the road stack (higher on top). */
  readonly z: number;
  /** Physical height above the road surface, metres (kerbs, islands) — used by the Twin. */
  readonly heightM: number;
}

export interface PhysLine {
  readonly id: string;
  readonly kind: 'kerb' | 'axis';
  readonly line: readonly LngLat[];
  readonly roadId?: string;
  readonly nodeId?: string;
  readonly state: PhysState;
}

export interface PhysicalModel {
  readonly surfaces: PhysPolygon[];
  readonly markings: PhysPolygon[];
  readonly lines: PhysLine[];
  readonly stats: { roads: number; junctions: number; roundabouts: number; markings: number; ms: number };
}

const DEFAULT_MATERIAL: Record<string, string> = {
  carriageway: 'asphalt', junction: 'asphalt', bus: 'asphalt_red', median: 'concrete', cycle: 'cycle_pavement',
  parking: 'asphalt', sidewalk: 'concrete_pavers', corner: 'concrete_pavers', furniture: 'stone', green: 'grass',
  shoulder: 'asphalt', curb: 'granite', footpath: 'concrete_pavers', roundabout_ring: 'asphalt',
  roundabout_island: 'grass', roundabout_apron: 'porphyry', splitter: 'granite',
};
const Z: Record<string, number> = {
  footpath: 0, sidewalk: 1, corner: 1, furniture: 1, green: 1, curb: 1, shoulder: 2, parking: 2, cycle: 3,
  carriageway: 4, bus: 5, median: 6, junction: 4, roundabout_ring: 4, roundabout_apron: 5, roundabout_island: 6, splitter: 6,
};
const HEIGHT: Record<string, number> = { sidewalk: 0.15, corner: 0.15, furniture: 0.15, green: 0.15, median: 0.15, curb: 0.15, roundabout_island: 0.2, roundabout_apron: 0.05, splitter: 0.15 };

const PROJECT: ProvenanceKind = 'project';
export function roadState(road: Road): PhysState {
  return Object.values(road.provenance).some((p) => p.kind === PROJECT) ? 'project' : 'existing';
}

export interface BuildOptions {
  readonly origin: LngLat;
  /** Baseline context: existing crossings from OSM etc. */
  readonly features?: Readonly<Record<string, CityFeature>>;
  readonly defaultCornerRadiusM?: number;
  /** Reuse geometry of roads and junctions that did not change since the previous build (same objects, same setbacks). */
  readonly cache?: PhysicalCache;
}

interface JunctionEntry {
  readonly deps: readonly unknown[];
  readonly g: JunctionGeometry | null;
  readonly surfaces: PhysPolygon[];
  readonly lines: PhysLine[];
}
interface RoadEntry {
  readonly deps: readonly unknown[];
  readonly surfaces: PhysPolygon[];
  readonly lines: PhysLine[];
  readonly markings: PhysPolygon[];
}

/**
 * Memo of per-road and per-junction output across builds. Networks are immutable and replays share
 * unchanged objects, so object identity of the inputs is a sound dependency key.
 */
export class PhysicalCache {
  origin: LngLat | null = null;
  metric: MetricCache | null = null;
  junctions = new Map<string, JunctionEntry>();
  roads = new Map<string, RoadEntry>();
  crossings = new Map<string, { deps: readonly unknown[]; out: PhysPolygon[] }>();
  grid: RoadGrid | null = null;
  reset(origin: LngLat, frame: LocalFrame): void {
    this.origin = origin; this.metric = new MetricCache(frame);
    this.junctions.clear(); this.roads.clear(); this.crossings.clear(); this.grid = null;
  }
}
/** Uniform grid over road axes for nearest-road queries, updated only for roads that changed. */
export class RoadGrid {
  private static readonly CELL = 40;
  private cells = new Map<string, Set<string>>();
  private placed = new Map<string, { road: Road; keys: string[] }>();
  constructor(private readonly metric: MetricCache) {}
  private keysFor(road: Road, pad: number): string[] {
    const a = this.metric.axis(road);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of a) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const C = RoadGrid.CELL, out: string[] = [];
    for (let i = Math.floor((x0 - pad) / C); i <= Math.floor((x1 + pad) / C); i++)
      for (let j = Math.floor((y0 - pad) / C); j <= Math.floor((y1 + pad) / C); j++) out.push(`${i},${j}`);
    return out;
  }
  sync(roads: readonly Road[]): void {
    const seen = new Set<string>();
    for (const road of roads) {
      seen.add(road.id);
      const was = this.placed.get(road.id);
      if (was?.road === road) continue;
      if (was) this.unplace(road.id);
      const keys = this.keysFor(road, 8);
      for (const k of keys) (this.cells.get(k) ?? this.cells.set(k, new Set()).get(k)!).add(road.id);
      this.placed.set(road.id, { road, keys });
    }
    for (const id of [...this.placed.keys()]) if (!seen.has(id)) this.unplace(id);
  }
  private unplace(id: string): void {
    for (const k of this.placed.get(id)?.keys ?? []) this.cells.get(k)?.delete(id);
    this.placed.delete(id);
  }
  near(p: V): Road[] {
    const C = RoadGrid.CELL;
    const ids = this.cells.get(`${Math.floor(p[0] / C)},${Math.floor(p[1] / C)}`);
    return ids ? [...ids].map((id) => this.placed.get(id)!.road) : [];
  }
}

const sameDeps = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function buildPhysicalModel(net: Network, opts: BuildOptions): PhysicalModel {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const frame = new LocalFrame(opts.origin);
  const cache = opts.cache;
  if (cache && (!cache.origin || cache.origin[0] !== opts.origin[0] || cache.origin[1] !== opts.origin[1])) cache.reset(opts.origin, frame);
  const metric = cache?.metric ?? new MetricCache(frame);
  const toLL = (ring: readonly V[]): LngLat[] => ring.map((p) => frame.toLngLat(p));
  const surfaces: PhysPolygon[] = [];
  const markings: PhysPolygon[] = [];
  const lines: PhysLine[] = [];

  // 1. Roundabouts own their nodes: arms meeting a ring are shaped there.
  const rb = buildRoundabouts(net, metric);
  for (const p of rb.polygons) surfaces.push({ ...p, ring: toLL(p.ring), ...(p.holes ? { holes: p.holes.map(toLL) } : {}) });
  for (const p of rb.markings) markings.push({ ...p, ring: toLL(p.ring) });

  // 2. Junctions at every node with ≥ 2 vehicular arms (not owned by a roundabout).
  const setbacks = new Map<string, number>(rb.setbacks);
  const junctionGeom = new Map<string, JunctionGeometry>();
  const roadIdsAtNodes = new Set<string>();
  for (const road of Object.values(net.roads)) { roadIdsAtNodes.add(road.from); roadIdsAtNodes.add(road.to); }
  const roadsAtNode = new Map<string, Road[]>();
  for (const road of Object.values(net.roads)) {
    (roadsAtNode.get(road.from) ?? roadsAtNode.set(road.from, []).get(road.from)!).push(road);
    if (road.to !== road.from) (roadsAtNode.get(road.to) ?? roadsAtNode.set(road.to, []).get(road.to)!).push(road);
  }
  const seenJunctions = new Set<string>();
  for (const nodeId of roadIdsAtNodes) {
    if (rb.ownedNodes.has(nodeId)) continue;
    const node = net.nodes[nodeId];
    if (!node) continue;
    const spec = net.junctions[nodeId];
    const radius = spec?.cornerRadiusM ?? opts.defaultCornerRadiusM ?? 4;
    const deps = [node, spec, radius, ...(roadsAtNode.get(nodeId) ?? [])];
    let entry = cache?.junctions.get(nodeId);
    if (!entry || !sameDeps(entry.deps, deps)) {
      entry = buildJunctionEntry(net, nodeId, node.at, spec, radius, metric, frame, deps);
      cache?.junctions.set(nodeId, entry);
    }
    seenJunctions.add(nodeId);
    if (!entry.g) continue;
    junctionGeom.set(nodeId, entry.g);
    for (const [k, v] of entry.g.setbacks) setbacks.set(k, v);
    surfaces.push(...entry.surfaces);
    lines.push(...entry.lines);
  }
  if (cache) for (const id of cache.junctions.keys()) if (!seenJunctions.has(id)) cache.junctions.delete(id);

  // 3. Road strips, trimmed at both ends by the junction setbacks.
  const seenRoads = new Set<string>();
  for (const road of Object.values(net.roads)) {
    if (rb.ringRoadIds.has(road.id)) continue;
    const s0 = setbacks.get(`${road.id}|s`) ?? 0;
    const s1 = setbacks.get(`${road.id}|e`) ?? 0;
    const deps = [road, s0, s1];
    let entry = cache?.roads.get(road.id);
    if (!entry || !sameDeps(entry.deps, deps)) {
      entry = buildRoadEntry(road, s0, s1, metric, toLL, deps);
      cache?.roads.set(road.id, entry);
    }
    seenRoads.add(road.id);
    surfaces.push(...entry.surfaces);
    lines.push(...entry.lines);
    markings.push(...entry.markings);
  }
  if (cache) for (const id of cache.roads.keys()) if (!seenRoads.has(id)) cache.roads.delete(id);

  // 4. Junction approach control lines (only where the junction has an explicit control).
  for (const [nodeId, g] of junctionGeom) {
    const spec = net.junctions[nodeId];
    if (!spec || spec.control === 'uncontrolled' || spec.control === 'roundabout') continue;
    addApproachLines(net, nodeId, spec, metric, setbacks, markings, toLL);
  }

  // 5. Pedestrian crossings: existing OSM crossings + authored junction crossings.
  addCrossings(net, opts.features ?? {}, metric, setbacks, markings, toLL, cache);

  // 6. Authored areas: public space, green infrastructure, parking bays, painted crossings.
  for (const area of Object.values(net.areas)) {
    if (area.state === 'removed') continue;
    const state: PhysState = area.state === 'project' ? 'project' : 'existing';
    if (area.kind === 'crossing') {
      const [a, b] = area.polygon.map((q) => frame.toMetric(q) as V);
      if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Stripes run along traffic: build them on a short axis perpendicular to the crossing line.
      const mid: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dir: V = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const axis: V[] = [add(mid, mul(leftNormal(dir), -1)), add(mid, mul(leftNormal(dir), 1))];
      zebra(axis, 1, len / 2, -len / 2, area.depthM ?? MARKING.zebraDepthM).forEach((r, i) =>
        markings.push({ id: `ar:${area.id}:${i}`, kind: 'zebra', ring: toLL(r), areaId: area.id, state, material: 'road_marking_white', z: 10, heightM: 0 }));
      continue;
    }
    const raised = area.kind === 'green' || area.kind === 'median_green' || area.kind === 'plaza' || area.kind === 'tree_pit' || area.kind === 'rain_garden';
    surfaces.push({
      id: `ar:${area.id}`, kind: 'area', areaKind: area.kind, areaId: area.id, ring: area.polygon, state, material: area.material,
      z: area.kind === 'parking' ? 5 : 7, heightM: raised ? 0.15 : 0,
    });
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    surfaces, markings, lines,
    stats: { roads: Object.keys(net.roads).length, junctions: junctionGeom.size, roundabouts: Object.keys(net.roundabouts).length, markings: markings.length, ms: Math.round(t1 - t0) },
  };
}

function buildJunctionEntry(
  net: Network, nodeId: string, at: LngLat, spec: JunctionSpec | undefined, radius: number,
  metric: MetricCache, frame: LocalFrame, deps: readonly unknown[],
): JunctionEntry {
  const toLL = (ring: readonly V[]): LngLat[] => ring.map((p) => frame.toLngLat(p));
  const arms = vehicularArms(net, nodeId, metric);
  const g = arms.length >= 2 ? buildJunction(nodeId, frame.toMetric(at) as V, arms, radius) : null;
  if (!g) return { deps, g: null, surfaces: [], lines: [] };
  const state: PhysState = spec || arms.some((a) => roadState(a.road) === 'project') ? 'project' : 'existing';
  const surfaces: PhysPolygon[] = [{ id: `j:${nodeId}`, kind: 'junction', ring: toLL(g.surface), nodeId, state, material: 'asphalt', z: Z.junction!, heightM: 0 }];
  g.corners.forEach((c, i) => surfaces.push({ id: `jc:${nodeId}:${i}`, kind: 'corner', ring: toLL(c), nodeId, state, material: DEFAULT_MATERIAL.corner!, z: Z.corner!, heightM: HEIGHT.corner! }));
  const lines: PhysLine[] = g.kerbs.map((k, i) => ({ id: `jk:${nodeId}:${i}`, kind: 'kerb', line: toLL(k), nodeId, state }));
  return { deps, g, surfaces, lines };
}

function buildRoadEntry(road: Road, s0: number, s1: number, metric: MetricCache, toLL: (r: readonly V[]) => LngLat[], deps: readonly unknown[]): RoadEntry {
  const out: RoadEntry = { deps, surfaces: [], lines: [], markings: [] };
  const axis = metric.axis(road);
  const L = lengthOf(axis);
  if (L - s0 - s1 < 0.3) return out;
  const trimmed = slice(axis, s0, L - s1);
  if (trimmed.length < 2) return out;
  const layout = layoutSection(road);
  const state = roadState(road);
  for (const pe of layout.elements) {
    const kind: SurfaceKind = layout.pedestrianOnly ? 'footpath' : pe.el.kind === 'lane' ? 'carriageway' : (pe.el.kind as SurfaceKind);
    out.surfaces.push({
      id: `s:${pe.el.id}`, kind, ring: toLL(band(trimmed, pe.left, pe.right)), roadId: road.id, state,
      material: pe.el.material ?? DEFAULT_MATERIAL[kind] ?? 'asphalt', z: Z[kind] ?? 4, heightM: HEIGHT[kind] ?? 0,
    });
  }
  if (layout.pedestrianOnly) return out;
  out.lines.push({ id: `k:${road.id}:l`, kind: 'kerb', line: toLL(offset(trimmed, layout.cwLeft)), roadId: road.id, state });
  out.lines.push({ id: `k:${road.id}:r`, kind: 'kerb', line: toLL(offset(trimmed, layout.cwRight)), roadId: road.id, state });
  addRoadMarkings(road, trimmed, layout, state, out.markings, toLL);
  return out;
}

function addRoadMarkings(
  road: Road, axis: readonly V[], layout: ReturnType<typeof layoutSection>, state: PhysState,
  out: PhysPolygon[], toLL: (r: readonly V[]) => LngLat[],
): void {
  const lanes = layout.elements.filter((e) => e.el.kind === 'lane' || e.el.kind === 'bus');
  const laneById = new Map(road.lanes.map((l) => [l.id, l]));
  const dash = dashFor(road);
  let k = 0;
  const push = (kind: PhysPolygon['kind'], ring: V[]) =>
    out.push({ id: `m:${road.id}:${k++}`, kind, ring: toLL(ring), roadId: road.id, state, material: 'road_marking_white', z: 10, heightM: 0 });

  // Lines between adjacent lanes.
  for (let i = 1; i < lanes.length; i++) {
    const a = lanes[i - 1]!, b = lanes[i]!;
    const off = a.right;
    const line = offset(axis, off);
    const da = laneById.get(a.el.laneId ?? '')?.direction, db = laneById.get(b.el.laneId ?? '')?.direction;
    const opposite = da && db && da !== db;
    if (a.el.kind === 'bus' || b.el.kind === 'bus') {
      push('lane_line', solid(line, 0.3));
    } else {
      for (const r of dashes(line, dash)) push(opposite ? 'center_line' : 'lane_line', r);
    }
  }
  if (hasEdgeLines(road) && lanes.length) {
    push('edge_line', solid(offset(axis, layout.cwLeft - 0.25), MARKING.edgeWidthM));
    push('edge_line', solid(offset(axis, layout.cwRight + 0.25), MARKING.edgeWidthM));
  }
  // Direction arrows on one-way roads (every lane), always derived from the lane model.
  if (road.oneway !== 'no') {
    const L = lengthOf(axis);
    for (const pe of lanes) {
      const lane = laneById.get(pe.el.laneId ?? '');
      if (!lane) continue;
      const centre = (pe.left + pe.right) / 2;
      const forward = lane.direction !== 'backward';
      for (const st of arrowStations(L)) {
        const d = forward ? st : L - st;
        const { p, t } = sampleAt(axis, d);
        const tail = add(p, mul(leftNormal(t), centre));
        push('arrow', arrowRing(tail, forward ? t : mul(t, -1)));
      }
    }
  }
}

function addApproachLines(
  net: Network, nodeId: string, spec: JunctionSpec, metric: MetricCache,
  setbacks: Map<string, number>, out: PhysPolygon[], toLL: (r: readonly V[]) => LngLat[],
): void {
  for (const arm of vehicularArms(net, nodeId, metric)) {
    const minor = spec.minorRoadIds.includes(arm.road.id);
    const kind = spec.control === 'signal' ? 'stop_line' : spec.control === 'stop' && minor ? 'stop_line' : spec.control === 'priority' && minor ? 'give_way' : null;
    if (!kind) continue;
    const S = (setbacks.get(armKey(arm)) ?? 0) + (spec.crossingRoadIds.includes(arm.road.id) ? MARKING.zebraDepthM + 1.5 : 0.5);
    // Inbound half of the carriageway: in the arm frame, traffic towards the node drives on the arm's left.
    const layout = layoutSection(arm.road);
    const inbound = arm.road.lanes.filter((l) => (arm.atStart ? l.direction === 'backward' : l.direction !== 'backward'));
    if (!inbound.length) continue;
    const els = layout.elements.filter((e) => inbound.some((l) => l.id === e.el.laneId));
    const offs = els.flatMap((e) => (arm.atStart ? [e.left, e.right] : [-e.left, -e.right]));
    const lo = Math.min(...offs), hi = Math.max(...offs);
    const { p, t } = sampleAt(arm.axis, S);
    const n = leftNormal(t);
    const line = [add(p, mul(n, lo)), add(p, mul(n, hi))];
    const rings = kind === 'stop_line' ? [solid(line, MARKING.stopWidthM)] : dashes(line, MARKING.giveWayDash);
    rings.forEach((r, i) => out.push({ id: `a:${nodeId}:${arm.road.id}:${i}`, kind, ring: toLL(r), nodeId, roadId: arm.road.id, state: 'project', material: 'road_marking_white', z: 10, heightM: 0 }));
  }
}

function addCrossings(
  net: Network, features: Readonly<Record<string, CityFeature>>, metric: MetricCache,
  setbacks: Map<string, number>, out: PhysPolygon[], toLL: (r: readonly V[]) => LngLat[], cache?: PhysicalCache,
): void {
  const roads = Object.values(net.roads).filter((r) => !layoutSection(r).pedestrianOnly);
  // Authored junction crossings.
  for (const spec of Object.values(net.junctions)) {
    for (const rid of spec.crossingRoadIds) {
      const road = net.roads[rid];
      if (!road) continue;
      const atStart = road.from === spec.nodeId;
      const axis = metric.axis(road);
      const L = lengthOf(axis);
      const S = setbacks.get(`${rid}|${atStart ? 's' : 'e'}`) ?? 0;
      const along = atStart ? S + MARKING.zebraDepthM / 2 + 0.5 : L - S - MARKING.zebraDepthM / 2 - 0.5;
      const lay = layoutSection(road);
      zebra(axis, along, lay.cwLeft, lay.cwRight).forEach((r, i) =>
        out.push({ id: `z:${spec.nodeId}:${rid}:${i}`, kind: 'zebra', ring: toLL(r), roadId: rid, nodeId: spec.nodeId, state: 'project', material: 'road_marking_white', z: 10, heightM: 0 }));
    }
  }
  // Existing crossings from OSM, snapped to the nearest carriageway within 6 m.
  const grid = cache ? (cache.grid ??= new RoadGrid(metric)) : new RoadGrid(metric);
  grid.sync(roads);
  for (const f of Object.values(features)) {
    if (f.kind !== 'crossing' || f.geometry !== 'point') continue;
    const p = metric.frame.toMetric(f.coords[0]!) as V;
    const candidates = grid.near(p).filter((r) => !layoutSection(r).pedestrianOnly);
    let best: { road: Road; along: number; d: number } | null = null;
    for (const road of candidates) {
      const pr = project(metric.axis(road), p);
      if (pr.d < 6 && (!best || pr.d < best.d)) best = { road, along: pr.along, d: pr.d };
    }
    if (!best) continue;
    const s0 = setbacks.get(`${best.road.id}|s`) ?? 0, s1 = setbacks.get(`${best.road.id}|e`) ?? 0;
    const deps = [best.road, best.along, s0, s1];
    const hit = cache?.crossings.get(f.id);
    if (hit && sameDeps(hit.deps, deps)) { out.push(...hit.out); continue; }
    const made: PhysPolygon[] = [];
    const axis = metric.axis(best.road);
    const L = lengthOf(axis);
    const half = MARKING.zebraDepthM / 2 + 0.3;
    if (L - s0 - s1 >= MARKING.zebraDepthM + 0.6) {
      const along = Math.min(Math.max(best.along, s0 + half), L - s1 - half);
      const lay = layoutSection(best.road);
      const roadId = best.road.id;
      zebra(axis, along, lay.cwLeft, lay.cwRight).forEach((r, i) =>
        made.push({ id: `z:${f.id}:${i}`, kind: 'zebra', ring: toLL(r), roadId, state: 'existing', material: 'road_marking_white', z: 10, heightM: 0 }));
    }
    cache?.crossings.set(f.id, { deps, out: made });
    out.push(...made);
  }
}
