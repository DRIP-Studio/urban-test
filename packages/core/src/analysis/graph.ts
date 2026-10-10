import {trafficKey,type TrafficState} from './traffic-state';
import { LocalFrame } from '../geo/projection';
import { lengthOf, project, type V } from '../geo/polyline';
import type { Lane, LngLat, Network, Road, TravelMode, Zone } from '../model/types';
import { checkRestrictions, windowActive, type VehicleSpec } from './restrictions';
import { isPedestrianRoad } from '../physical/section';
import { axisTouchesZone } from './zones';

export interface RoutingContext {
  readonly trafficState?: TrafficState;
  readonly mode: TravelMode;
  /** Local time used for zone schedules (ZTL) — day 0 = Monday. */
  readonly day: number;
  readonly minutes: number;
  readonly vehicle?: VehicleSpec;
  readonly permits?: readonly string[];
  readonly holiday?: boolean;
  readonly date?: string;
}

export interface GraphEdge {
  readonly id: number;
  readonly roadId: string;
  /** true when travelling along the axis direction. */
  readonly forward: boolean;
  readonly from: number;
  readonly to: number;
  readonly lengthM: number;
  readonly speedKmh: number;
  readonly costS: number;
  readonly capacityVph: number;
}

export interface RoadGraph {
  readonly nodeIds: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  readonly edges: readonly GraphEdge[];
  /** outgoing edge ids per node */
  readonly out: readonly number[][];
  readonly blocked: ReadonlyMap<string, string>;
  readonly ctx: RoutingContext;
}

const WALK_KMH = 4.8, BIKE_KMH = 15;
const VEHICLE: ReadonlySet<TravelMode> = new Set(['car', 'motorcycle', 'truck', 'bus', 'emergency']);

export function zoneActive(z: Zone, day: number, minutes: number): boolean {
  return windowActive(z.schedule, day, minutes);
}

const metricCache = new WeakMap<Road, number>();
export function roadLength(road: Road, frame: LocalFrame): number {
  let l = metricCache.get(road);
  if (l === undefined) {
    l = lengthOf(road.axis.map((p) => frame.toMetric(p) as V));
    metricCache.set(road, l);
  }
  return l;
}

/** Capacity per direction (veh/h): 1 800 per lane at signal-free flow, scaled by class. */
export function laneCapacity(road: Road): number {
  const base: Record<string, number> = { trunk: 1900, primary: 1700, secondary: 1500, tertiary: 1200, residential: 800, unclassified: 900, service: 500, living_street: 300, roundabout: 1300 };
  return base[road.roadClass] ?? 900;
}

export function buildGraph(net: Network, frame: LocalFrame, ctx: RoutingContext, includeRestricted = false): RoadGraph {
  const nodeIds: string[] = [];
  const index = new Map<string, number>();
  const idx = (id: string) => {
    let i = index.get(id);
    if (i === undefined) { i = nodeIds.length; nodeIds.push(id); index.set(id, i); }
    return i;
  };
  const day = ctx.holiday ? 6 : ctx.day;
  const activeZones = (includeRestricted ? [] : Object.values(net.zones)).filter((z) => zoneActive(z, day, ctx.minutes));
  const edges: GraphEdge[] = [];
  const out: number[][] = [];
  const blocked = new Map<string, string>();
  const vehicle = VEHICLE.has(ctx.mode);

  for (const road of Object.values(net.roads)) {
    const pedestrianRoad = isPedestrianRoad(road);
    if (vehicle && pedestrianRoad) continue;
    if (ctx.mode === 'walk' && road.roadClass === 'trunk') continue;

    let speed = ctx.mode === 'walk' ? WALK_KMH : ctx.mode === 'bike' ? Math.min(BIKE_KMH, road.speedKmh) : road.speedKmh;
    if (ctx.mode === 'truck') speed = Math.min(speed, 50);
    if (ctx.mode === 'emergency') speed = speed * 1.25;
    let closedReason: string | null = null;
    for (const z of activeZones) {
      if (!axisTouchesZone(road.axis, z.polygon)) continue;
      const delivering = ctx.mode === 'truck' && windowActive(z.deliveryWindows ?? [], day, ctx.minutes) && !!z.deliveryWindows?.length;
      const permitted = ctx.permits?.some((permit) => z.permits?.includes(permit));
      if ((z.kind === 'ztl' || z.kind === 'pedestrian' || z.kind === 'school') && vehicle && !z.allowedModes.includes(ctx.mode) && !delivering && !permitted) closedReason = `${z.name} (${z.kind.toUpperCase()}) attiva`;
      if (z.kind === 'work' && ctx.mode !== 'walk' && !z.allowedModes.includes(ctx.mode)) closedReason = `Cantiere ${z.name}`;
      if (z.speedKmh && vehicle) speed = Math.min(speed, z.speedKmh);
      if (z.kind === 'zone30' && vehicle) speed = Math.min(speed, 30);
    }
    // Road restrictions (authored or OSM): HGV bans, mass/size limits, closures, with time windows.
    const rc = vehicle && !includeRestricted ? checkRestrictions(road, ctx.mode, ctx.vehicle, day, ctx.minutes) : { blocked: null, penalty: 1 };
    if (rc.blocked) closedReason = rc.blocked;
    if (closedReason) { blocked.set(road.id, closedReason); continue; }

    const length = roadLength(road, frame);
    const dirs: boolean[] = [];
    const lanesFor = (fwd: boolean) => road.lanes.filter((l) => (fwd ? l.direction !== 'backward' : l.direction !== 'forward'));
    for (const fwd of [true, false]) {
      if (ctx.mode !== 'walk') {
        if (road.oneway === 'forward' && !fwd) continue;
        if (road.oneway === 'backward' && fwd) continue;
        const lanes = lanesFor(fwd);
        // Trucks use general traffic lanes (lane modes list 'car'); road-level bans are checked above.
        const allows = (l: Lane) => l.modes.includes(ctx.mode) || ctx.mode === 'emergency' || ((ctx.mode === 'truck' || ctx.mode === 'motorcycle') && l.modes.includes('car'));
        // A preferential lane outside its time window is a general traffic lane.
        const restricted = (l: Lane) => l.restriction && l.restriction !== 'none' && windowActive(l.restrictionSchedule, day, ctx.minutes);
        const usable = lanes.filter((l) => {
          if (!restricted(l)) return allows(l) || (l.restriction === 'bus_only' && ctx.mode !== 'walk' && ctx.mode !== 'bike');
          if (includeRestricted) return allows(l);
          if (l.restriction === 'closed') return false;
          if (l.restriction === 'bus_only') return ctx.mode === 'bus' || ctx.mode === 'emergency';
          if (l.restriction === 'bike_only') return ctx.mode === 'bike';
          return allows(l);
        });
        if (!usable.length && !(pedestrianRoad && ctx.mode === 'bike')) continue;
      }
      dirs.push(fwd);
    }
    for (const fwd of dirs) {
      const observation=vehicle&&!includeRestricted?ctx.trafficState?.segments[trafficKey(road.id,fwd)]:undefined;
      if(observation?.closed){blocked.set(road.id,`Chiusura ${observation.provider}`);continue;}
      const observedSpeed=observation?.speedKmh;
      const edgeSpeed=observedSpeed!==null&&observedSpeed!==undefined?Math.min(speed,Math.max(.5,observedSpeed)):speed;
      const from = idx(fwd ? road.from : road.to), to = idx(fwd ? road.to : road.from);
      while (out.length < nodeIds.length) out.push([]);
      const lanes = Math.max(1, road.lanes.filter((l) => (fwd ? l.direction !== 'backward' : l.direction !== 'forward')).length);
      const e: GraphEdge = {
        id: edges.length, roadId: road.id, forward: fwd, from, to, lengthM: length, speedKmh: edgeSpeed,
        costS: (length / (edgeSpeed / 3.6)) * rc.penalty, capacityVph: laneCapacity(road) * lanes,
      };
      edges.push(e);
      out[from]!.push(e.id);
    }
  }
  while (out.length < nodeIds.length) out.push([]);
  return { nodeIds, index, edges, out, blocked, ctx };
}

/** Nearest point on any road usable by the graph. */
export function snapToGraph(net: Network, g: RoadGraph, frame: LocalFrame, at: LngLat): { roadId: string; along: number; length: number; distM: number } | null {
  const p = frame.toMetric(at) as V;
  const usable = new Set(g.edges.map((e) => e.roadId));
  let best: { roadId: string; along: number; length: number; distM: number } | null = null;
  for (const id of usable) {
    const road = net.roads[id]!;
    const axis = road.axis.map((q) => frame.toMetric(q) as V);
    const pr = project(axis, p);
    if (!best || pr.d < best.distM) best = { roadId: id, along: pr.along, length: lengthOf(axis), distM: pr.d };
  }
  return best;
}

/** Binary-heap Dijkstra. `costOf` lets traffic assignment use congested times. */
export function dijkstra(
  g: RoadGraph, sources: readonly { node: number; cost: number }[], opts: { target?: number; maxCost?: number; costOf?: (e: GraphEdge) => number; turnPenalty?: (prev: GraphEdge | null, next: GraphEdge) => number } = {},
): { dist: Float64Array; prev: Int32Array } {
  const n = g.nodeIds.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap: number[] = [];
  const hd: number[] = [];
  const push = (node: number, d: number) => {
    heap.push(node); hd.push(d);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p]! <= hd[i]!) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!]; [hd[p], hd[i]] = [hd[i]!, hd[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0]!, hd[0]!];
    const ln = heap.pop()!, ld = hd.pop()!;
    if (heap.length) {
      heap[0] = ln; hd[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hd[l]! < hd[m]!) m = l;
        if (r < heap.length && hd[r]! < hd[m]!) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!]; [hd[m], hd[i]] = [hd[i]!, hd[m]!];
        i = m;
      }
    }
    return top;
  };
  for (const s of sources) if (s.cost < dist[s.node]!) { dist[s.node] = s.cost; push(s.node, s.cost); }
  const costOf = opts.costOf ?? ((e: GraphEdge) => e.costS);
  while (heap.length) {
    const [u, d] = pop();
    if (d > dist[u]!) continue;
    if (u === opts.target) break;
    if (opts.maxCost !== undefined && d > opts.maxCost) break;
    const inEdge = prev[u]! >= 0 ? g.edges[prev[u]!]! : null;
    for (const eid of g.out[u]!) {
      const e = g.edges[eid]!;
      const nd = d + costOf(e) + (opts.turnPenalty ? opts.turnPenalty(inEdge, e) : 0);
      if (nd < dist[e.to]!) { dist[e.to] = nd; prev[e.to] = eid; push(e.to, nd); }
    }
  }
  return { dist, prev };
}
