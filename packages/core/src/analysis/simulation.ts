import { LocalFrame } from '../geo/projection';
import { add, leftNormal, lengthOf, mul, sampleAt, type V } from '../geo/polyline';
import type { CityBaseline, LngLat, Network } from '../model/types';
import { armKey, buildJunction } from '../physical/junction';
import { layoutSection } from '../physical/section';
import { MetricCache, vehicularArms } from '../physical/topology';
import { buildGraph, dijkstra, type GraphEdge, type RoadGraph } from './graph';
import { analyzeJunction, signalState, type JunctionAnalysis } from './junction';
import { WEEKDAY_PROFILE, WEEKEND_PROFILE } from './traffic';

export type VehicleClass = 'car' | 'van' | 'truck' | 'bus' | 'emergency';
export const VEHICLE_SPECS: Record<VehicleClass, { length: number; width: number; accel: number; decel: number; share: number; label: string }> = {
  car: { length: 4.5, width: 1.8, accel: 2.0, decel: 3.0, share: 0.82, label: 'Auto' },
  van: { length: 5.8, width: 2.0, accel: 1.6, decel: 2.8, share: 0.1, label: 'Furgone' },
  truck: { length: 10.0, width: 2.5, accel: 1.0, decel: 2.5, share: 0.04, label: 'Camion' },
  bus: { length: 12.0, width: 2.55, accel: 1.1, decel: 2.5, share: 0.03, label: 'Autobus 12 m' },
  emergency: { length: 6.0, width: 2.1, accel: 2.4, decel: 3.5, share: 0.01, label: 'Emergenza' },
};
const CLASSES = Object.keys(VEHICLE_SPECS) as VehicleClass[];
/** Floats per vehicle in SimFrame.data: lon, lat, heading°, class index, km/h, vehicle id. */
export const SIM_STRIDE = 6;

interface Vehicle {
  id: number;
  cls: VehicleClass;
  path: number[]; // graph edge ids
  k: number; // index in path
  s: number; // metres along current edge (travel direction) or along movement when inJunction
  v: number;
  lane: number;
  inJunction: { pts: V[]; length: number } | null;
  born: number;
  freeTime: number;
}

export interface SimMetrics {
  readonly t: number;
  readonly vehicles: number;
  readonly avgSpeedKmh: number;
  readonly stopped: number;
  readonly completed: number;
  readonly throughputVph: number;
  readonly avgTravelS: number;
  readonly avgDelayS: number;
  readonly queues: readonly { nodeId: string; roadId: string; vehicles: number }[];
}

export interface SimFrame {
  /** lon, lat, bearing°, class index, speed km/h, vehicle id — SIM_STRIDE floats per vehicle. */
  readonly data: Float32Array;
  readonly signals: readonly { at: LngLat; state: 'green' | 'yellow' | 'red'; bearing: number }[];
  readonly metrics: SimMetrics;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  readonly day: number;
  readonly hour: number;
  readonly dailyTrips: number;
  /** Fraction of the demand simulated (performance): 1 = full. */
  readonly scale: number;
  readonly seed: number;
  /** Restrict spawning to this bbox (focus area); vehicles still route on the whole network. */
  readonly focus?: readonly [number, number, number, number];
}

export class FlowSimulation {
  readonly frame: LocalFrame;
  private readonly metric: MetricCache;
  private readonly g: RoadGraph;
  private readonly net: Network;
  private readonly rand: () => number;
  private vehicles: Vehicle[] = [];
  private nextId = 1;
  private t = 0;
  private spawnAcc = 0;
  private completed: { travel: number; delay: number; at: number }[] = [];
  private readonly spawnRate: number;
  private readonly entries: number[];
  private readonly exits: number[];
  private readonly treeCache = new Map<number, Int32Array>();
  private readonly setback = new Map<string, number>();
  private readonly junctions = new Map<string, JunctionAnalysis | null>();
  private readonly lengths = new Map<string, number>();

  constructor(net: Network, baseline: CityBaseline, private readonly opts: SimOptions) {
    this.net = net;
    this.frame = new LocalFrame(baseline.origin);
    this.metric = new MetricCache(this.frame);
    this.g = buildGraph(net, this.frame, { mode: 'car', day: opts.day, minutes: opts.hour * 60 });
    this.rand = mulberry32(opts.seed);
    const profile = opts.day >= 5 ? WEEKEND_PROFILE : WEEKDAY_PROFILE;
    this.spawnRate = (opts.dailyTrips * (profile[opts.hour]! / 100) * opts.scale) / 3600;
    const inFocus = (id: string) => {
      const p = net.nodes[id]?.at;
      const f = opts.focus;
      return !!p && (!f || (p[0] >= f[0] && p[0] <= f[2] && p[1] >= f[1] && p[1] <= f[3]));
    };
    const nodes = [...this.g.nodeIds.keys()].filter((i) => this.g.out[i]!.length && inFocus(this.g.nodeIds[i]!));
    this.entries = nodes;
    this.exits = nodes;
    for (const road of Object.values(net.roads)) this.lengths.set(road.id, lengthOf(this.metric.axis(road)));
  }

  private roadSetback(roadId: string, atStart: boolean): number {
    const key = `${roadId}|${atStart ? 's' : 'e'}`;
    if (!this.setback.has(key)) {
      const road = this.net.roads[roadId]!;
      const nodeId = atStart ? road.from : road.to;
      const arms = vehicularArms(this.net, nodeId, this.metric);
      if (arms.length >= 3 && !road.tags?.roundabout) {
        const geo = buildJunction(nodeId, this.frame.toMetric(this.net.nodes[nodeId]!.at) as V, arms, this.net.junctions[nodeId]?.cornerRadiusM ?? 4);
        for (const a of arms) this.setback.set(armKey(a), geo?.setbacks.get(armKey(a)) ?? 0);
      }
      if (!this.setback.has(key)) this.setback.set(key, 0);
    }
    return this.setback.get(key)!;
  }

  private analysis(nodeId: string): JunctionAnalysis | null {
    if (!this.junctions.has(nodeId)) {
      const ends = Object.values(this.net.roads).filter((r) => r.from === nodeId || r.to === nodeId);
      this.junctions.set(nodeId, ends.length >= 3 && !ends.some((r) => r.tags?.roundabout) ? analyzeJunction(this.net, this.frame.origin, nodeId) : null);
    }
    return this.junctions.get(nodeId)!;
  }

  private edgeLen(e: GraphEdge): number { return this.lengths.get(e.roadId)!; }
  private lanesOf(e: GraphEdge): number {
    return Math.max(1, this.net.roads[e.roadId]!.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward')).length);
  }

  private routeFrom(o: number, d: number): number[] | null {
    let prev = this.treeCache.get(o);
    if (!prev) {
      prev = dijkstra(this.g, [{ node: o, cost: 0 }]).prev;
      this.treeCache.set(o, prev);
    }
    const path: number[] = [];
    let n = d;
    while (prev[n]! >= 0 && path.length < 2000) { const e = this.g.edges[prev[n]!]!; path.push(e.id); n = e.from; }
    if (n !== o || !path.length) return null;
    return path.reverse();
  }

  private spawn(): void {
    for (let tries = 0; tries < 6; tries++) {
      const o = this.entries[Math.floor(this.rand() * this.entries.length)]!;
      const d = this.exits[Math.floor(this.rand() * this.exits.length)]!;
      if (o === d) continue;
      const path = this.routeFrom(o, d);
      if (!path || path.length < 2) continue;
      const first = this.g.edges[path[0]!]!;
      const lane = Math.floor(this.rand() * this.lanesOf(first));
      const startS = this.roadSetback(first.roadId, first.forward) + 1;
      // Do not spawn into an occupied lane start.
      if (this.vehicles.some((v) => !v.inJunction && v.path[v.k] === first.id && v.lane === lane && v.s < startS + 12)) continue;
      let r = this.rand(), cls: VehicleClass = 'car';
      for (const c of CLASSES) { r -= VEHICLE_SPECS[c].share; if (r <= 0) { cls = c; break; } }
      const free = path.reduce((s, id) => s + this.g.edges[id]!.costS, 0);
      this.vehicles.push({ id: this.nextId++, cls, path, k: 0, s: startS, v: Math.min(8, first.speedKmh / 3.6), lane, inJunction: null, born: this.t, freeTime: free });
      return;
    }
  }

  /** Stop requirement at the end of the current edge: distance to stop line or Infinity. */
  private stopAhead(veh: Vehicle, e: GraphEdge, L: number): number {
    const next = veh.path[veh.k + 1];
    if (next === undefined) return Infinity;
    const nodeId = this.g.nodeIds[e.to]!;
    const stopS = L - this.roadSetback(e.roadId, !e.forward) - 1;
    const plan = Object.values(this.net.signalPlans).find((p) => p.nodeId === nodeId);
    if (plan) {
      const a = this.analysis(nodeId);
      const road = this.net.roads[e.roadId]!;
      const lanes = road.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward'));
      const laneId = lanes[Math.min(veh.lane, lanes.length - 1)]?.id;
      const group = a?.groups.find((gr) => laneId && gr.laneIds.includes(laneId))?.id;
      if (group) {
        const nextRoad = this.g.edges[next]!.roadId;
        const turn = a?.movements.find((m) => m.fromLaneId === laneId && m.toRoadId === nextRoad)?.turn;
        const st = signalState(plan, group, this.t, turn);
        const dist = stopS - veh.s;
        const canStop = veh.v * veh.v / (2 * VEHICLE_SPECS[veh.cls].decel) < dist;
        if (st === 'red' || (st === 'yellow' && canStop)) return stopS;
      }
      return Infinity;
    }
    // Yield: roundabout entries and minor approaches look for conflicting vehicles near the node.
    const nextEdge = this.g.edges[next]!;
    const entering = this.net.roads[nextEdge.roadId]?.tags?.roundabout && !this.net.roads[e.roadId]?.tags?.roundabout;
    const spec = this.net.junctions[nodeId];
    const minor = spec && (spec.control === 'priority' || spec.control === 'stop') && spec.minorRoadIds.includes(e.roadId);
    if (entering || minor) {
      const busy = this.vehicles.some((o) => {
        if (o === veh || o.inJunction) return false;
        const oe = this.g.edges[o.path[o.k]!]!;
        if (oe.roadId === e.roadId) return false;
        const conflictRoad = entering ? this.net.roads[oe.roadId]?.tags?.roundabout : !spec!.minorRoadIds.includes(oe.roadId);
        if (!conflictRoad || oe.to !== e.to) return false;
        const oL = this.edgeLen(oe);
        return oL - o.s < 18 && o.v > 0.5;
      });
      if (busy || (spec?.control === 'stop' && veh.v > 0.3)) return stopS;
    }
    return Infinity;
  }

  step(dt: number): void {
    this.spawnAcc += this.spawnRate * dt;
    while (this.spawnAcc >= 1) { this.spawn(); this.spawnAcc -= 1; }
    // Leaders per edge-lane.
    const byLane = new Map<string, Vehicle[]>();
    for (const v of this.vehicles) {
      if (v.inJunction) continue;
      const key = `${v.path[v.k]}:${v.lane}`;
      (byLane.get(key) ?? byLane.set(key, []).get(key)!).push(v);
    }
    for (const list of byLane.values()) list.sort((a, b) => b.s - a.s);
    const done: Vehicle[] = [];
    for (const veh of this.vehicles) {
      const spec = VEHICLE_SPECS[veh.cls];
      if (veh.inJunction) {
        veh.v = Math.min(veh.v + spec.accel * dt, 8);
        veh.s += veh.v * dt;
        if (veh.s >= veh.inJunction.length) {
          veh.k++;
          const e = this.g.edges[veh.path[veh.k]!]!;
          veh.s = this.roadSetback(e.roadId, e.forward) + (veh.s - veh.inJunction.length);
          veh.lane = Math.min(veh.lane, this.lanesOf(e) - 1);
          veh.inJunction = null;
        }
        continue;
      }
      const e = this.g.edges[veh.path[veh.k]!]!;
      const L = this.edgeLen(e);
      const v0 = e.speedKmh / 3.6;
      const list = byLane.get(`${e.id}:${veh.lane}`)!;
      const idx = list.indexOf(veh);
      let gap = Infinity, dv = 0;
      if (idx > 0) { const lead = list[idx - 1]!; gap = lead.s - veh.s - VEHICLE_SPECS[lead.cls].length; dv = veh.v - lead.v; }
      const stop = this.stopAhead(veh, e, L);
      if (stop - veh.s < gap) { gap = Math.max(0.1, stop - veh.s); dv = veh.v; }
      const s0 = 2, T = 1.3;
      const sStar = s0 + Math.max(0, veh.v * T + (veh.v * dv) / (2 * Math.sqrt(spec.accel * spec.decel)));
      const acc = spec.accel * (1 - (veh.v / Math.max(1, v0)) ** 4 - (Number.isFinite(gap) ? (sStar / Math.max(0.1, gap)) ** 2 : 0));
      veh.v = Math.max(0, veh.v + Math.max(-9, acc) * dt);
      veh.s += veh.v * dt;
      const endS = L - this.roadSetback(e.roadId, !e.forward);
      if (veh.s >= endS) {
        if (veh.k >= veh.path.length - 1) { done.push(veh); continue; }
        const next = this.g.edges[veh.path[veh.k + 1]!]!;
        const nodeId = this.g.nodeIds[e.to]!;
        const a = this.analysis(nodeId);
        const road = this.net.roads[e.roadId]!;
        const lanes = road.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward'));
        const laneId = lanes[Math.min(veh.lane, lanes.length - 1)]?.id;
        const mv = a?.movements.find((m) => m.fromLaneId === laneId && m.toRoadId === next.roadId) ?? a?.movements.find((m) => m.fromRoadId === e.roadId && m.toRoadId === next.roadId);
        if (mv) {
          const pts = mv.path.map((q) => this.frame.toMetric(q) as V);
          veh.inJunction = { pts, length: lengthOf(pts) };
          veh.s = veh.s - endS;
        } else {
          veh.k++;
          veh.s = this.roadSetback(next.roadId, next.forward) + (veh.s - endS);
          veh.lane = Math.min(veh.lane, this.lanesOf(next) - 1);
        }
      }
    }
    if (done.length) {
      const set = new Set(done);
      for (const v of done) this.completed.push({ travel: this.t - v.born, delay: Math.max(0, this.t - v.born - v.freeTime), at: this.t });
      this.vehicles = this.vehicles.filter((v) => !set.has(v));
    }
    // Gridlock guard: vehicles older than 6× their free-flow time (min 10 min) leave the simulation as incomplete.
    this.vehicles = this.vehicles.filter((v) => this.t - v.born < Math.max(600, v.freeTime * 6));
    this.t += dt;
  }

  frameData(): SimFrame {
    const data = new Float32Array(this.vehicles.length * SIM_STRIDE);
    this.vehicles.forEach((veh, i) => {
      let p: V, t: V;
      if (veh.inJunction) {
        const s = sampleAt(veh.inJunction.pts, veh.s);
        p = s.p; t = s.t;
      } else {
        const e = this.g.edges[veh.path[veh.k]!]!;
        const road = this.net.roads[e.roadId]!;
        let axis = this.metric.axis(road);
        if (!e.forward) axis = [...axis].reverse();
        const s = sampleAt(axis, veh.s);
        const lay = layoutSection(road);
        const lanes = road.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward'));
        const lane = lanes[Math.min(veh.lane, lanes.length - 1)];
        const el = lay.elements.find((x) => x.el.laneId === lane?.id);
        const off = el ? (el.left + el.right) / 2 : 0;
        p = add(s.p, mul(leftNormal(s.t), e.forward ? off : -off));
        t = s.t;
      }
      const ll = this.frame.toLngLat(p);
      const o = i * SIM_STRIDE;
      data[o] = ll[0]; data[o + 1] = ll[1];
      data[o + 2] = (Math.atan2(t[0], t[1]) * 180) / Math.PI;
      data[o + 3] = CLASSES.indexOf(veh.cls);
      data[o + 4] = veh.v * 3.6;
      data[o + 5] = veh.id;
    });
    const signals: SimFrame['signals'][number][] = [];
    for (const plan of Object.values(this.net.signalPlans)) {
      const a = this.analysis(plan.nodeId);
      for (const g of a?.groups ?? []) signals.push({ at: g.stopAt, state: signalState(plan, g.id, this.t), bearing: g.bearingDeg });
    }
    const recent = this.completed.filter((c) => this.t - c.at < 900);
    const queues = new Map<string, { nodeId: string; roadId: string; vehicles: number }>();
    for (const v of this.vehicles) {
      if (v.inJunction || v.v > 1) continue;
      const e = this.g.edges[v.path[v.k]!]!;
      const k = `${e.roadId}|${e.to}`;
      const q = queues.get(k) ?? { nodeId: this.g.nodeIds[e.to]!, roadId: e.roadId, vehicles: 0 };
      q.vehicles++;
      queues.set(k, q);
    }
    const n = this.vehicles.length;
    return {
      data, signals,
      metrics: {
        t: Math.round(this.t), vehicles: n,
        avgSpeedKmh: n ? Math.round((this.vehicles.reduce((s, v) => s + v.v, 0) / n) * 3.6) : 0,
        stopped: this.vehicles.filter((v) => v.v < 0.5).length,
        completed: this.completed.length,
        throughputVph: recent.length ? Math.round((recent.length / Math.min(900, Math.max(60, this.t))) * 3600) : 0,
        avgTravelS: recent.length ? Math.round(recent.reduce((s, c) => s + c.travel, 0) / recent.length) : 0,
        avgDelayS: recent.length ? Math.round(recent.reduce((s, c) => s + c.delay, 0) / recent.length) : 0,
        queues: [...queues.values()].filter((q) => q.vehicles >= 3).sort((a, b) => b.vehicles - a.vehicles).slice(0, 12),
      },
    };
  }
}
