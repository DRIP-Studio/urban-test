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
  /** Pairs of movement keys `<groupId>:<turn>` that may not be green together (directional control). */
  readonly movementConflicts: readonly (readonly [string, string])[];
  /** Subset of movementConflicts a left turn may run yielding to opposing traffic (svolta permessa). */
  readonly permissivePairs: readonly (readonly [string, string])[];
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

/**
 * The junction as the signal controller sees it: groups of approaches taken out of the plan
 * (`SignalPlan.unsignalized`) are dropped together with every conflict that involves them.
 * Heads, timing design, validation and simulation all go through here.
 */
export function analyzeSignalJunction(net: Network, frameOrigin: LngLat, plan: Pick<SignalPlan, 'nodeId' | 'unsignalized'>): JunctionAnalysis | null {
  const a = analyzeJunction(net, frameOrigin, plan.nodeId);
  const out = plan.unsignalized;
  if (!a || !out || !Object.keys(out).length) return a;
  const groups = a.groups.filter((g) => !out[g.roadId]);
  const keep = new Set(groups.map((g) => g.id));
  const pair = (x: string, y: string) => keep.has(x.split(':')[0]!) && keep.has(y.split(':')[0]!);
  return {
    ...a, groups,
    incompatible: a.incompatible.filter(([x, y]) => keep.has(x) && keep.has(y)),
    movementConflicts: a.movementConflicts.filter(([x, y]) => pair(x, y)),
    permissivePairs: a.permissivePairs.filter(([x, y]) => pair(x, y)),
  };
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
  const movementConflicts = new Set<string>();
  const permissivePairs = new Set<string>();
  const armBearing = new Map(arms.map((x) => [x.road.id, Math.atan2(x.u[0], x.u[1])]));
  const opposite = (r1: string, r2: string) => {
    const d = Math.abs(((armBearing.get(r1) ?? 0) - (armBearing.get(r2) ?? 0) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    return d > (135 * Math.PI) / 180;
  };
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
        const ka = `${a.groupId}:${a.turn}`, kb = `${b.groupId}:${b.turn}`;
        const key = [ka, kb].sort().join('|');
        movementConflicts.add(key);
        // A left turn against the opposing through/right flow may be permitted (it yields).
        const leftVsOpposing = (x: Movement, y: Movement) => x.turn === 'left' && y.turn !== 'left' && opposite(x.fromRoadId, y.fromRoadId);
        if (kind === 'crossing' && (leftVsOpposing(a, b) || leftVsOpposing(b, a))) permissivePairs.add(key);
        if (kind === 'merge' && (a.turn === 'left' || b.turn === 'left') && opposite(a.fromRoadId, b.fromRoadId)) permissivePairs.add(key);
      }
    }
  }
  return {
    nodeId,
    arms: arms.map((a) => ({ roadId: a.road.id, name: a.road.name || 'senza nome', inbound: lanesOf(a, true).length, outbound: lanesOf(a, false).length, bearingDeg: (Math.atan2(a.u[0], a.u[1]) * 180) / Math.PI })),
    movements: withGroups, groups, conflicts,
    incompatible: [...incompatible].map((k) => k.split('|') as [string, string]),
    movementConflicts: [...movementConflicts].map((k) => k.split('|') as [string, string]),
    permissivePairs: [...permissivePairs].map((k) => k.split('|') as [string, string]),
    crossingRoadIds: spec?.crossingRoadIds ?? [],
  };
}

/** Yellow time (s) from approach speed, Italian practice: 3 s up to 50 km/h, 4 s above. */
export const yellowFor = (speedKmh: number): number => (speedKmh > 50 ? 4 : 3);

/** Turns of a group that are green in a phase (directional control), or [] if the group is red. */
export function activeTurns(phase: SignalPhase, group: Pick<LaneGroup, 'id' | 'turns'>): readonly TurnKind[] {
  if (!phase.greenGroups.includes(group.id)) return [];
  return phase.greenMovements?.[group.id]?.filter((t) => group.turns.includes(t)) ?? group.turns;
}

export interface PlanIssue { readonly phase?: string; readonly message: string; readonly kind: 'conflict' | 'cycle' | 'unserved' | 'timing' }

/**
 * Checks a plan against the junction geometry, movement by movement: two movements in conflict may not
 * be green together, unless the plan allows permitted left turns and the pair is a left turn against
 * opposing traffic. Every lane group must get green at least once; the phases must add up to the cycle.
 */
export function planIssues(plan: SignalPlan, a: Pick<JunctionAnalysis, 'groups' | 'movementConflicts' | 'permissivePairs'>): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const permissive = new Set(plan.permissiveLeft ? a.permissivePairs.map(([x, y]) => [x, y].sort().join('|')) : []);
  const conflict = new Set(a.movementConflicts.map(([x, y]) => [x, y].sort().join('|')));
  const total = plan.phases.reduce((t, p) => t + p.greenS + p.yellowS + p.allRedS, 0);
  if (Math.abs(total - plan.cycleS) > 0.5) issues.push({ kind: 'cycle', message: `La somma delle fasi (${Math.round(total)} s) deve essere uguale al ciclo (${plan.cycleS} s)` });
  for (const ph of plan.phases) {
    const keys = a.groups.flatMap((g) => activeTurns(ph, g).map((t) => `${g.id}:${t}`));
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const k = [keys[i]!, keys[j]!].sort().join('|');
      if (conflict.has(k) && !permissive.has(k)) issues.push({ kind: 'conflict', phase: ph.name, message: `${ph.name}: verdi in conflitto (${keys[i]} × ${keys[j]})` });
    }
    if (ph.yellowS < 3) issues.push({ kind: 'timing', phase: ph.name, message: `${ph.name}: giallo minimo 3 s` });
    if (ph.greenS < 5) issues.push({ kind: 'timing', phase: ph.name, message: `${ph.name}: verde minimo 5 s` });
  }
  for (const g of a.groups) {
    const served = new Set(plan.phases.flatMap((ph) => activeTurns(ph, g)));
    const missing = g.turns.filter((t) => !served.has(t));
    if (missing.length === g.turns.length) issues.push({ kind: 'unserved', message: `${g.label}: mai verde` });
    else if (missing.length) issues.push({ kind: 'unserved', message: `${g.label}: manca il verde per ${missing.map((t) => TURN_IT[t]).join(', ')}` });
  }
  return issues;
}

/** Saturation flow per lane (veh/h of green), HCM/Italian practice, adjusted for turning movements. */
const SAT_PER_LANE = 1800;
const turnFactor = (turns: readonly TurnKind[]) => (turns.length === 1 && turns[0] === 'left' ? 0.92 : turns.length === 1 && turns[0] === 'right' ? 0.85 : turns.includes('left') ? 0.9 : 1);
/** Default approach volume (veh/h per inbound lane) when no traffic estimate is available. */
const DEFAULT_VPH: Record<string, number> = { motorway: 1200, trunk: 900, primary: 700, secondary: 550, tertiary: 420, unclassified: 260, residential: 180, living_street: 80, service: 80 };

/** Volume of a lane group (veh/h): from `demand` when given, else typical flow for the road class. */
export function groupVolume(net: Network, g: Pick<LaneGroup, 'id' | 'roadId' | 'laneIds' | 'turns'>, demand?: Readonly<Record<string, number>>): number {
  const d = demand?.[g.id];
  if (d !== undefined) return d;
  const road = net.roads[g.roadId];
  return (DEFAULT_VPH[road?.roadClass ?? ''] ?? 250) * g.laneIds.length * (g.turns.length === 1 && g.turns[0] !== 'through' ? 0.35 : 1);
}

export interface SignalDesign {
  readonly cycleS: number;
  readonly lostTimeS: number;
  readonly criticalRatio: number;
  readonly phases: readonly { readonly groups: readonly string[]; readonly y: number; readonly greenS: number }[];
  readonly method: string;
}

/**
 * Proposes a conflict-free plan by Webster's method.
 *
 * 1. Phasing: groups of the same axis (opposite approaches) run together; with `permissiveLeft` the left
 *    turns join their axis, otherwise they get protected phases. Groups are assigned greedily, most loaded first.
 * 2. Flow ratios y = q/s per group (q from `demand` veh/h, else from road class), critical y per phase.
 * 3. Cycle C₀ = (1.5 L + 5) / (1 − Y), limited to 40–120 s; greens split in proportion to critical y,
 *    with a minimum that lets pedestrians cross at 1.0 m/s.
 */
export function suggestSignalPlan(net: Network, a: JunctionAnalysis, opts: { cycleS?: number; demand?: Readonly<Record<string, number>>; permissiveLeft?: boolean } = {}): SignalPlan & { design: SignalDesign } {
  const permissive = opts.permissiveLeft ?? false;
  const allowed = new Set(permissive ? a.permissivePairs.map(([x, y]) => [x, y].sort().join('|')) : []);
  const badMov = new Set(a.movementConflicts.map(([x, y]) => [x, y].sort().join('|')).filter((k) => !allowed.has(k)));
  const groupOk = (g1: LaneGroup, g2: LaneGroup) => g1.turns.every((t1) => g2.turns.every((t2) => !badMov.has([`${g1.id}:${t1}`, `${g2.id}:${t2}`].sort().join('|'))));
  const q = (g: LaneGroup) => groupVolume(net, g, opts.demand);
  const sat = (g: LaneGroup) => SAT_PER_LANE * g.laneIds.length * turnFactor(g.turns);
  const y = (g: LaneGroup) => Math.min(0.9, q(g) / sat(g));
  const axisOf = (g: LaneGroup) => {
    const b = ((a.arms.find((x) => x.roadId === g.roadId)?.bearingDeg ?? 0) % 180 + 180) % 180;
    return Math.round(b / 45) % 4;
  };
  // Through/right first (they define the axis phases), then protected lefts; heavier first.
  const order = [...a.groups].sort((g1, g2) => {
    const l1 = g1.turns.length === 1 && g1.turns[0] === 'left' ? 1 : 0, l2 = g2.turns.length === 1 && g2.turns[0] === 'left' ? 1 : 0;
    return l1 - l2 || axisOf(g1) - axisOf(g2) || y(g2) - y(g1);
  });
  const phases: LaneGroup[][] = [];
  for (const g of order) {
    const fit = phases.filter((p) => p.every((x) => groupOk(x, g)));
    const sameAxis = fit.find((p) => p.some((x) => axisOf(x) === axisOf(g)));
    const ph = sameAxis ?? fit[0];
    if (ph) ph.push(g); else phases.push([g]);
  }
  const maxSpeed = Math.max(...a.arms.map((arm) => net.roads[arm.roadId]?.speedKmh ?? 50));
  const Y = yellowFor(maxSpeed), R = 2, startLoss = 2;
  const lost = phases.length * (startLoss + R) + phases.length * Math.max(0, Y - 3);
  const crit = phases.map((p) => Math.max(...p.map(y)));
  const Ysum = Math.min(0.9, crit.reduce((t, v) => t + v, 0));
  const webster = (1.5 * lost + 5) / (1 - Ysum);
  const cycle = Math.round(opts.cycleS ?? Math.min(120, Math.max(40, webster)));
  // Pedestrian minimum: crossing width at 1.0 m/s + 4 s to step off (DM 5/11/2001, practice).
  const pedMin = (p: LaneGroup[]) => {
    const served = new Set(p.flatMap((g) => [g.roadId, ...a.movements.filter((m) => m.groupId === g.id).map((m) => m.toRoadId)]));
    const widths = a.crossingRoadIds.filter((rid) => !served.has(rid)).map((rid) => (net.roads[rid]?.section.elements.reduce((t, e) => t + (e.kind === 'sidewalk' ? 0 : e.widthM), 0) ?? 7));
    return widths.length ? Math.ceil(Math.max(...widths) / 1.0 + 4) : 7;
  };
  const available = cycle - phases.length * (Y + R);
  let greens = phases.map((p, i) => Math.max(pedMin(p), Math.round((available * crit[i]!) / Math.max(1e-6, crit.reduce((t, v) => t + v, 0)))));
  const drift = cycle - phases.length * (Y + R) - greens.reduce((t, g) => t + g, 0);
  const heaviest = crit.indexOf(Math.max(...crit));
  greens = greens.map((g, i) => (i === heaviest ? Math.max(5, g + drift) : g));
  const realCycle = greens.reduce((t, g) => t + g, 0) + phases.length * (Y + R);
  const servedRoads = (p: LaneGroup[]) => new Set(p.flatMap((g) => [g.roadId, ...a.movements.filter((m) => m.groupId === g.id).map((m) => m.toRoadId)]));
  const signalPhases: SignalPhase[] = phases.map((p, i) => ({
    id: `F${i + 1}`, name: `Fase ${i + 1}`, greenGroups: p.map((g) => g.id), greenS: greens[i]!, yellowS: Y, allRedS: R,
    pedestrianRoadIds: a.crossingRoadIds.filter((rid) => !servedRoads(p).has(rid)),
  }));
  return {
    id: `plan:${a.nodeId}`, nodeId: a.nodeId, name: 'Piano semaforico', mode: 'fixed_time', cycleS: realCycle, offsetS: 0, phases: signalPhases,
    permissiveLeft: permissive,
    design: {
      cycleS: realCycle, lostTimeS: lost, criticalRatio: Math.round(Ysum * 100) / 100,
      phases: phases.map((p, i) => ({ groups: p.map((g) => g.id), y: Math.round(crit[i]! * 100) / 100, greenS: greens[i]! })),
      method: opts.demand ? 'Webster su flussi stimati DRIP' : 'Webster su flussi tipici per classe di strada',
    },
  };
}

/** Demand per lane group (veh/h) from estimated link flows: approach volume split by lane count. */
export function groupDemand(a: JunctionAnalysis, flows: readonly { roadId: string; forward: boolean; volumeVph: number }[], net: Network): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of a.groups) {
    const road = net.roads[g.roadId];
    if (!road) continue;
    const towardsNode = road.to === a.nodeId;
    const f = flows.find((x) => x.roadId === g.roadId && x.forward === towardsNode);
    if (!f) continue;
    const lanesIn = a.groups.filter((x) => x.roadId === g.roadId).reduce((t, x) => t + x.laneIds.length, 0) || 1;
    out[g.id] = (f.volumeVph * g.laneIds.length) / lanesIn;
  }
  return out;
}

/** Signal state of a group (optionally of one turn of it) at time t (s) — simulation, map, Twin. */
export function signalState(plan: SignalPlan, groupId: string, t: number, turn?: TurnKind): 'green' | 'yellow' | 'red' {
  let s = (((t - plan.offsetS) % plan.cycleS) + plan.cycleS) % plan.cycleS;
  const on = (ph: SignalPhase) => ph.greenGroups.includes(groupId) && (!turn || !ph.greenMovements?.[groupId] || ph.greenMovements[groupId]!.includes(turn));
  for (const ph of plan.phases) {
    if (s < ph.greenS) return on(ph) ? 'green' : 'red';
    s -= ph.greenS;
    if (s < ph.yellowS) return on(ph) ? 'yellow' : 'red';
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
  /** Approach the head controls. */
  readonly roadId: string;
  /** Key used to switch the head off (SignalPlan.disabledHeads). */
  readonly key: string;
  /** Turn controlled by a directional (arrow) head. */
  readonly turn?: TurnKind;
  readonly kind: 'vehicle' | 'arrow_left' | 'arrow_right' | 'arrow_straight' | 'pedestrian';
  readonly at: LngLat;
  readonly bearingDeg: number;
}

const ARROW: Record<TurnKind, SignalHead['kind']> = { left: 'arrow_left', right: 'arrow_right', through: 'arrow_straight', uturn: 'arrow_left' };

/**
 * Physical signal heads of every plan: one per lane group at the stop line (arrow heads when a group's
 * turns are switched separately), two pedestrian heads per signalised crossing. Heads listed in
 * `disabledHeads` are not installed.
 */
export function signalHeads(net: Network, frameOrigin: LngLat): SignalHead[] {
  const frame = new LocalFrame(frameOrigin);
  const metric = new MetricCache(frame);
  const out: SignalHead[] = [];
  for (const plan of Object.values(net.signalPlans)) {
    const a = analyzeSignalJunction(net, frameOrigin, plan);
    if (!a) continue;
    const off = new Set(plan.disabledHeads ?? []);
    for (const g of a.groups) {
      if (off.has(g.id)) continue;
      // Directional heads when some phase switches only part of the group's turns.
      const split = plan.phases.some((ph) => ph.greenGroups.includes(g.id) && ph.greenMovements?.[g.id] && ph.greenMovements[g.id]!.length < g.turns.length);
      if (split && g.turns.length > 1) {
        const b = (g.bearingDeg * Math.PI) / 180;
        const right: V = [Math.cos(b), -Math.sin(b)];
        const stop = frame.toMetric(g.stopAt) as V;
        g.turns.forEach((turn, i) => {
          const key = `${g.id}:${turn}`;
          if (off.has(key)) return;
          const p = add(stop, mul(right, (i - (g.turns.length - 1) / 2) * 0.9));
          out.push({ planId: plan.id, nodeId: plan.nodeId, groupId: g.id, roadId: g.roadId, key, turn, kind: ARROW[turn], at: frame.toLngLat(p), bearingDeg: g.bearingDeg });
        });
        continue;
      }
      const only = g.turns.length === 1 ? g.turns[0] : null;
      const kind = only === 'left' ? 'arrow_left' : only === 'right' ? 'arrow_right' : 'vehicle';
      out.push({ planId: plan.id, nodeId: plan.nodeId, groupId: g.id, roadId: g.roadId, key: g.id, kind, at: g.stopAt, bearingDeg: g.bearingDeg });
    }
    const pedRoads = new Set(plan.phases.flatMap((p) => p.pedestrianRoadIds));
    if (!pedRoads.size) continue;
    const node = net.nodes[plan.nodeId]!;
    const arms = vehicularArms(net, plan.nodeId, metric);
    const geo = buildJunction(plan.nodeId, frame.toMetric(node.at) as V, arms, net.junctions[plan.nodeId]?.cornerRadiusM ?? 4);
    for (const arm of arms) {
      if (!pedRoads.has(arm.road.id) || !geo || off.has(`ped:${arm.road.id}`)) continue;
      const s = (geo.setbacks.get(armKey(arm)) ?? 0) + 2.5;
      const { p, t } = sampleAt(arm.axis, s);
      [arm.cwLeft + 0.6, arm.cwRight - 0.6].forEach((o, side) => {
        const key = `ped:${arm.road.id}:${side}`;
        if (off.has(key)) return;
        out.push({ planId: plan.id, nodeId: plan.nodeId, groupId: `ped:${arm.road.id}`, roadId: arm.road.id, key, kind: 'pedestrian', at: frame.toLngLat(add(p, mul(leftNormal(t), o))), bearingDeg: 0 });
      });
    }
  }
  return out;
}

/** Scales the greens of a plan to a new cycle, keeping yellow and all-red. */
export function rescalePlan(plan: SignalPlan, cycleS: number): SignalPlan {
  const fixed = plan.phases.reduce((t, p) => t + p.yellowS + p.allRedS, 0);
  const greens = plan.phases.reduce((t, p) => t + p.greenS, 0);
  const avail = Math.max(plan.phases.length * 5, cycleS - fixed);
  const phases = plan.phases.map((p) => ({ ...p, greenS: Math.max(5, Math.round((p.greenS / Math.max(1, greens)) * avail)) }));
  const drift = cycleS - fixed - phases.reduce((t, p) => t + p.greenS, 0);
  const i = phases.reduce((bi, p, k) => (p.greenS > phases[bi]!.greenS ? k : bi), 0);
  phases[i] = { ...phases[i]!, greenS: Math.max(5, phases[i]!.greenS + drift) };
  return { ...plan, cycleS: phases.reduce((t, p) => t + p.greenS + p.yellowS + p.allRedS, 0), phases };
}

export interface SignalOptimization {
  readonly plan: SignalPlan;
  readonly analysis: JunctionAnalysis;
  readonly beforeCycleS: number;
  readonly design: SignalDesign;
  /** Cycle forced by a coordinated corridor (common cycle = the longest Webster cycle of the corridor). */
  readonly corridorCycleS?: number;
}

/**
 * Network-wide retiming ("ottimizza tutti i semafori"): Webster on every signal plan with the given
 * demand, keeping what the designer decided (mode, permitted lefts, removed heads, coordination).
 * Plans linked by a corridor or merged into one plant keep their offsets and get a common cycle — the
 * longest of the group (a half-cycle junction counts double and keeps its half) — so the green wave
 * survives; greens are rescaled in proportion.
 */
export function optimizeNetworkSignals(net: Network, frameOrigin: LngLat, demandFor?: (a: JunctionAnalysis) => Readonly<Record<string, number>> | undefined): SignalOptimization[] {
  const out: SignalOptimization[] = [];
  for (const plan of Object.values(net.signalPlans)) {
    const a = analyzeSignalJunction(net, frameOrigin, plan);
    if (!a || !a.groups.length) continue;
    const { design, ...s } = suggestSignalPlan(net, a, { demand: demandFor?.(a), permissiveLeft: plan.permissiveLeft });
    out.push({
      plan: { ...s, id: plan.id, name: plan.name, mode: plan.mode, offsetS: plan.offsetS, actuation: plan.actuation, permissiveLeft: plan.permissiveLeft, disabledHeads: plan.disabledHeads, unsignalized: plan.unsignalized, coordination: plan.coordination, plant: plan.plant },
      analysis: a, beforeCycleS: plan.cycleS, design,
    });
  }
  // Groups of plans sharing a cycle: connected through corridors and plants.
  const parent = out.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstOf = new Map<string, number>();
  out.forEach((o, i) => {
    for (const key of [o.plan.coordination && `c:${o.plan.coordination.id}`, o.plan.plant && `p:${o.plan.plant.id}`]) {
      if (!key) continue;
      const j = firstOf.get(key);
      if (j === undefined) firstOf.set(key, i); else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, number[]>();
  out.forEach((o, i) => { if (o.plan.coordination || o.plan.plant) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]); });
  for (const idx of groups.values()) {
    const half = (i: number) => !!out[i]!.plan.coordination?.halfCycle;
    let cycle = Math.max(...idx.map((i) => out[i]!.plan.cycleS * (half(i) ? 2 : 1)));
    cycle += cycle % 2 && idx.some(half) ? 1 : 0;
    for (const i of idx) {
      const o = out[i]!;
      const p = rescalePlan(o.plan, half(i) ? cycle / 2 : cycle);
      out[i] = { ...o, plan: { ...p, offsetS: Math.round(o.plan.offsetS % p.cycleS) }, corridorCycleS: cycle };
    }
  }
  return out;
}
