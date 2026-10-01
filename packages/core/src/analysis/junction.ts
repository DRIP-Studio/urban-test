import { LocalFrame } from '../geo/projection';
import { add, cross, dist, leftNormal, mul, sampleAt, sub, type V } from '../geo/polyline';
import type { Lane, LngLat, Network, SignalPhase, SignalPlan, TurnKind } from '../model/types';
import { armKey, buildJunction } from '../physical/junction';
import { layoutSection } from '../physical/section';
import { MetricCache, vehicularArms, type Arm } from '../physical/topology';

export interface Movement {
  readonly id: string;
  readonly fromRoadId: string;
  readonly fromLaneId: string;
  readonly toRoadId: string;
  readonly toLaneId: string;
  readonly turn: TurnKind;
  readonly groupId: string;
  /** Trajectory (WGS84), stop line → exit. */
  readonly path: readonly LngLat[];
  readonly overridden: boolean;
}

export type ConflictKind = 'crossing' | 'merge' | 'diverge';

export interface ConflictPoint {
  readonly id: string;
  readonly kind: ConflictKind;
  readonly at: LngLat;
  readonly a: string;
  readonly b: string;
  /** 1 (low) … 3 (high): crossing of opposing left/through or near-perpendicular paths is high. */
  readonly severity: 1 | 2 | 3;
}

export interface LaneGroup {
  readonly id: string;
  readonly roadId: string;
  readonly approachName: string;
  readonly laneIds: readonly string[];
  readonly turns: readonly TurnKind[];
  readonly label: string;
  /** Stop-line centre (WGS84), where the signal head is placed. */
  readonly stopAt: LngLat;
  readonly bearingDeg: number;
}

export interface JunctionAnalysis {
  readonly nodeId: string;
  readonly arms: readonly { roadId: string; name: string; inbound: number; outbound: number; bearingDeg: number }[];
  readonly movements: readonly Movement[];
  readonly groups: readonly LaneGroup[];
  readonly conflicts: readonly ConflictPoint[];
  /** Pairs of group ids that may not be green together. */
  readonly incompatible: readonly (readonly [string, string])[];
  readonly crossingRoadIds: readonly string[];
}

const TURN_IT: Record<TurnKind, string> = { left: 'sinistra', through: 'dritto', right: 'destra', uturn: 'inversione' };

function turnBetween(inArm: Arm, outArm: Arm): TurnKind {
  const travel = mul(inArm.u, -1); // heading into the junction
  const exit = outArm.u;
  const angle = Math.atan2(cross(travel, exit), travel[0] * exit[0] + travel[1] * exit[1]) * (180 / Math.PI);
  if (Math.abs(angle) < 35) return 'through';
  if (Math.abs(angle) > 155) return 'uturn';
  return angle > 0 ? 'left' : 'right';
}

/** Lanes entering (inbound) or leaving (outbound) the node, ordered right → left as seen by their drivers. */
function lanesOf(arm: Arm, inbound: boolean): Lane[] {
  const towardsNode = (l: Lane) => (arm.atStart ? l.direction === 'backward' : l.direction !== 'backward') || l.direction === 'reversible';
  const lanes = arm.road.lanes.filter((l) => (inbound ? towardsNode(l) : !towardsNode(l) || l.direction === 'reversible'));
  // Lane centre offset in the arm frame: inbound drivers face -u, so their right is the arm's left side.
  const lay = layoutSection(arm.road);
  const offset = (l: Lane) => {
    const e = lay.elements.find((x) => x.el.laneId === l.id);
    const c = e ? (e.left + e.right) / 2 : 0;
    return arm.atStart ? c : -c;
  };
  return [...lanes].sort((a, b) => (inbound ? offset(b) - offset(a) : offset(a) - offset(b)));
}

function laneCentre(arm: Arm, lane: Lane): number {
  const e = layoutSection(arm.road).elements.find((x) => x.el.laneId === lane.id);
  const c = e ? (e.left + e.right) / 2 : 0;
  return arm.atStart ? c : -c;
}

function bezier(p0: V, p1: V, p2: V, p3: V, n = 16): V[] {
  const out: V[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, m = 1 - t;
    out.push([
      m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
      m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function segIntersect(a: V, b: V, c: V, d: V): V | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? add(a, mul(r, t)) : null;
}

export function analyzeJunction(net: Network, frameOrigin: LngLat, nodeId: string): JunctionAnalysis | null {
  const node = net.nodes[nodeId];
  if (!node) return null;
  const frame = new LocalFrame(frameOrigin);
  const metric = new MetricCache(frame);
  const arms = vehicularArms(net, nodeId, metric);
  if (arms.length < 3) return null;
  const spec = net.junctions[nodeId];
  const geo = buildJunction(nodeId, frame.toMetric(node.at) as V, arms, spec?.cornerRadiusM ?? 4)!;
  const overrides = spec?.laneConnections ?? {};
  const toLL = (pts: V[]) => pts.map((p) => frame.toLngLat(p));
  const stopPoint = (arm: Arm, lane: Lane, extra = 0): { p: V; dir: V } => {
    const s = (geo.setbacks.get(armKey(arm)) ?? 0) + extra;
    const { p, t } = sampleAt(arm.axis, s);
    return { p: add(p, mul(leftNormal(t), laneCentre(arm, lane))), dir: t };
  };

  const movements: Movement[] = [];
  const groupsByKey = new Map<string, { arm: Arm; lanes: Lane[]; turns: Set<TurnKind> }>();
  for (const inArm of arms) {
    const inbound = lanesOf(inArm, true);
    if (!inbound.length) continue;
    const exits = arms.filter((o) => o !== inArm).map((o) => ({ arm: o, turn: turnBetween(inArm, o), lanes: lanesOf(o, false) })).filter((x) => x.lanes.length && x.turn !== 'uturn');
    inbound.forEach((lane, li) => {
      const explicit = lane.turns.length && !(lane.turns.length === 1 && lane.turns[0] === 'through');
      for (const ex of exits) {
        let allowed: boolean;
        if (explicit) allowed = lane.turns.includes(ex.turn);
        else if (inbound.length === 1) allowed = true;
        else allowed = ex.turn === 'through' || (ex.turn === 'right' && li === 0) || (ex.turn === 'left' && li === inbound.length - 1);
        // Exit lane by position: right turns to the rightmost lane, left turns to the leftmost.
        const toLane = ex.turn === 'right' ? ex.lanes[0]! : ex.turn === 'left' ? ex.lanes[ex.lanes.length - 1]! : ex.lanes[Math.min(li, ex.lanes.length - 1)]!;
        const key = `${lane.id}>${toLane.id}`;
        const ov = overrides[key];
        if (ov !== undefined) allowed = ov;
        if (!allowed) continue;
        const a = stopPoint(inArm, lane), b = stopPoint(ex.arm, toLane);
        const d = dist(a.p, b.p);
        const path = bezier(a.p, add(a.p, mul(a.dir, -d * 0.45)), add(b.p, mul(b.dir, -d * 0.45)), b.p);
        // Lane group: same approach, same set of movements of the lane.
        movements.push({ id: key, fromRoadId: inArm.road.id, fromLaneId: lane.id, toRoadId: ex.arm.road.id, toLaneId: toLane.id, turn: ex.turn, groupId: '', path: toLL(path), overridden: ov !== undefined });
      }
    });
    // Group lanes with identical turn sets.
    for (const lane of inbound) {
      const turns = movements.filter((m) => m.fromLaneId === lane.id).map((m) => m.turn).sort();
      if (!turns.length) continue;
      const key = `${inArm.road.id}|${inArm.atStart}|${turns.join(',')}`;
      const g = groupsByKey.get(key) ?? { arm: inArm, lanes: [], turns: new Set<TurnKind>() };
      g.lanes.push(lane);
      turns.forEach((t) => g.turns.add(t));
      groupsByKey.set(key, g);
    }
  }
  const groups: LaneGroup[] = [];
  const groupOfLane = new Map<string, string>();
  let gi = 0;
  for (const g of groupsByKey.values()) {
    const id = `G${++gi}`;
    const turns = [...g.turns].sort((a, b) => ['left', 'through', 'right'].indexOf(a) - ['left', 'through', 'right'].indexOf(b));
    const mid = g.lanes.reduce((s, l) => s + laneCentre(g.arm, l), 0) / g.lanes.length;
    const S = geo.setbacks.get(armKey(g.arm)) ?? 0;
    const { p, t } = sampleAt(g.arm.axis, S);
    const stop = add(p, mul(leftNormal(t), mid));
    const heading = mul(t, -1);
    groups.push({
      id, roadId: g.arm.road.id, approachName: g.arm.road.name || 'senza nome', laneIds: g.lanes.map((l) => l.id), turns,
      label: `${g.arm.road.name || 'Braccio'} · ${turns.map((x) => TURN_IT[x]).join(' + ')}`,
      stopAt: frame.toLngLat(stop), bearingDeg: (Math.atan2(heading[0], heading[1]) * 180) / Math.PI,
    });
    g.lanes.forEach((l) => groupOfLane.set(l.id, id));
  }
  const withGroups = movements.map((m) => ({ ...m, groupId: groupOfLane.get(m.fromLaneId) ?? '' }));

  // Conflicts between movements from different approaches.
  const conflicts: ConflictPoint[] = [];
  const incompatible = new Set<string>();
  const mPaths = withGroups.map((m) => m.path.map((q) => frame.toMetric(q) as V));
  for (let i = 0; i < withGroups.length; i++) {
    for (let j = i + 1; j < withGroups.length; j++) {
      const a = withGroups[i]!, b = withGroups[j]!;
      if (a.fromRoadId === b.fromRoadId && a.fromLaneId !== b.fromLaneId && a.toLaneId !== b.toLaneId) continue;
      let kind: ConflictKind | null = null;
      let at: V | null = null;
      if (a.toLaneId === b.toLaneId && a.fromRoadId !== b.fromRoadId) { kind = 'merge'; at = mPaths[i]![mPaths[i]!.length - 1]!; }
      else if (a.fromLaneId === b.fromLaneId && a.toRoadId !== b.toRoadId) { kind = 'diverge'; at = mPaths[i]![0]!; }
      else if (a.fromRoadId !== b.fromRoadId) {
        const pa = mPaths[i]!, pb = mPaths[j]!;
        outer: for (let x = 1; x < pa.length; x++) for (let y = 1; y < pb.length; y++) {
          const hit = segIntersect(pa[x - 1]!, pa[x]!, pb[y - 1]!, pb[y]!);
          if (hit) { kind = 'crossing'; at = hit; break outer; }
        }
      }
      if (!kind || !at) continue;
      const severity: 1 | 2 | 3 = kind === 'crossing' ? ((a.turn === 'left' || b.turn === 'left') || (a.turn === 'through' && b.turn === 'through') ? 3 : 2) : kind === 'merge' ? 2 : 1;
      conflicts.push({ id: `C${conflicts.length + 1}`, kind, at: frame.toLngLat(at), a: a.id, b: b.id, severity });
      if (kind !== 'diverge' && a.groupId && b.groupId && a.groupId !== b.groupId) {
        incompatible.add([a.groupId, b.groupId].sort().join('|'));
      }
    }
  }
  return {
    nodeId,
    arms: arms.map((a) => ({ roadId: a.road.id, name: a.road.name || 'senza nome', inbound: lanesOf(a, true).length, outbound: lanesOf(a, false).length, bearingDeg: (Math.atan2(a.u[0], a.u[1]) * 180) / Math.PI })),
    movements: withGroups, groups, conflicts,
    incompatible: [...incompatible].map((k) => k.split('|') as [string, string]),
    crossingRoadIds: spec?.crossingRoadIds ?? [],
  };
}

/** Yellow time (s) from approach speed, Italian practice: 3 s up to 50 km/h, 4 s above. */
export const yellowFor = (speedKmh: number): number => (speedKmh > 50 ? 4 : 3);

/**
 * Proposes a conflict-free plan: groups are coloured greedily into phases,
 * green split proportionally to demand (or evenly without data).
 */
export function suggestSignalPlan(net: Network, a: JunctionAnalysis, opts: { cycleS?: number; demand?: Readonly<Record<string, number>> } = {}): SignalPlan {
  const bad = new Set(a.incompatible.map(([x, y]) => `${x}|${y}`));
  const ok = (x: string, y: string) => !bad.has([x, y].sort().join('|'));
  const order = [...a.groups].sort((g1, g2) => (opts.demand?.[g2.id] ?? 0) - (opts.demand?.[g1.id] ?? 0));
  const phases: string[][] = [];
  for (const g of order) {
    const ph = phases.find((p) => p.every((x) => ok(x, g.id)));
    if (ph) ph.push(g.id); else phases.push([g.id]);
  }
  const cycle = opts.cycleS ?? Math.min(120, Math.max(60, 30 + phases.length * 18));
  const maxSpeed = Math.max(...a.arms.map((arm) => net.roads[arm.roadId]?.speedKmh ?? 50));
  const Y = yellowFor(maxSpeed), R = 2;
  const available = cycle - phases.length * (Y + R);
  const weight = (p: string[]) => Math.max(1, ...p.map((g) => opts.demand?.[g] ?? 1));
  const total = phases.reduce((s, p) => s + weight(p), 0);
  let greens = phases.map((p) => Math.max(7, Math.round((available * weight(p)) / total)));
  const drift = cycle - phases.length * (Y + R) - greens.reduce((s, g) => s + g, 0);
  greens = greens.map((g, i) => (i === 0 ? g + drift : g));
  const servedRoads = (p: string[]) => new Set(p.flatMap((g) => {
    const grp = a.groups.find((x) => x.id === g)!;
    return [grp.roadId, ...a.movements.filter((m) => m.groupId === g).map((m) => m.toRoadId)];
  }));
  const signalPhases: SignalPhase[] = phases.map((p, i) => ({
    id: `F${i + 1}`, name: `Fase ${i + 1}`, greenGroups: p, greenS: greens[i]!, yellowS: Y, allRedS: R,
    pedestrianRoadIds: a.crossingRoadIds.filter((rid) => !servedRoads(p).has(rid)),
  }));
  return { id: `plan:${a.nodeId}`, nodeId: a.nodeId, name: 'Piano semaforico', mode: 'fixed_time', cycleS: cycle, offsetS: 0, phases: signalPhases };
}

/** Signal state of a group at time t (s) — used by simulation and the Twin. */
export function signalState(plan: SignalPlan, groupId: string, t: number): 'green' | 'yellow' | 'red' {
  let s = (((t - plan.offsetS) % plan.cycleS) + plan.cycleS) % plan.cycleS;
  for (const ph of plan.phases) {
    if (s < ph.greenS) return ph.greenGroups.includes(groupId) ? 'green' : 'red';
    s -= ph.greenS;
    if (s < ph.yellowS) return ph.greenGroups.includes(groupId) ? 'yellow' : 'red';
    s -= ph.yellowS + ph.allRedS;
    if (s < 0) return 'red';
  }
  return 'red';
}

/** Pedestrian signal (Italian 3-aspect: red / yellow / green). */
export function pedestrianState(plan: SignalPlan, roadId: string, t: number): 'green' | 'yellow' | 'red' {
  let s = (((t - plan.offsetS) % plan.cycleS) + plan.cycleS) % plan.cycleS;
  for (const ph of plan.phases) {
    const on = ph.pedestrianRoadIds.includes(roadId);
    if (s < ph.greenS) return on ? (s < ph.greenS - 5 ? 'green' : 'yellow') : 'red';
    s -= ph.greenS + ph.yellowS + ph.allRedS;
    if (s < 0) return 'red';
  }
  return 'red';
}

export interface SignalHead {
  readonly planId: string;
  readonly nodeId: string;
  /** Lane group id for vehicle heads, `ped:<roadId>` for pedestrian heads. */
  readonly groupId: string;
  readonly kind: 'vehicle' | 'arrow_left' | 'arrow_right' | 'arrow_straight' | 'pedestrian';
  readonly at: LngLat;
  readonly bearingDeg: number;
}

/** Physical signal heads of every plan: one per lane group at the stop line, two pedestrian heads per signalised crossing. */
export function signalHeads(net: Network, frameOrigin: LngLat): SignalHead[] {
  const frame = new LocalFrame(frameOrigin);
  const metric = new MetricCache(frame);
  const out: SignalHead[] = [];
  for (const plan of Object.values(net.signalPlans)) {
    const a = analyzeJunction(net, frameOrigin, plan.nodeId);
    if (!a) continue;
    for (const g of a.groups) {
      const only = g.turns.length === 1 ? g.turns[0] : null;
      const kind = only === 'left' ? 'arrow_left' : only === 'right' ? 'arrow_right' : 'vehicle';
      out.push({ planId: plan.id, nodeId: plan.nodeId, groupId: g.id, kind, at: g.stopAt, bearingDeg: g.bearingDeg });
    }
    const pedRoads = new Set(plan.phases.flatMap((p) => p.pedestrianRoadIds));
    if (!pedRoads.size) continue;
    const node = net.nodes[plan.nodeId]!;
    const arms = vehicularArms(net, plan.nodeId, metric);
    const geo = buildJunction(plan.nodeId, frame.toMetric(node.at) as V, arms, net.junctions[plan.nodeId]?.cornerRadiusM ?? 4);
    for (const arm of arms) {
      if (!pedRoads.has(arm.road.id) || !geo) continue;
      const s = (geo.setbacks.get(armKey(arm)) ?? 0) + 2.5;
      const { p, t } = sampleAt(arm.axis, s);
      for (const off of [arm.cwLeft + 0.6, arm.cwRight - 0.6]) {
        out.push({ planId: plan.id, nodeId: plan.nodeId, groupId: `ped:${arm.road.id}`, kind: 'pedestrian', at: frame.toLngLat(add(p, mul(leftNormal(t), off))), bearingDeg: 0 });
      }
    }
  }
  return out;
}
