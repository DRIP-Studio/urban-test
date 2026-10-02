import { LocalFrame } from '../geo/projection';
import type { V } from '../geo/polyline';
import type { JunctionSpec, LngLat, Network, Road, RoadNode, Roundabout, SignalPlan } from '../model/types';
import { makeLanes } from './road-factory';

/**
 * Geometric roundabout insertion.
 *
 * The ring is placed anywhere (on a junction or free). Every node inside the ring is absorbed, roads
 * wholly inside disappear, and every road that crosses the ring centre line becomes an arm cut exactly
 * there — however many short OSM tracts lie between the old junction and the ring. A road that passes
 * right through the ring yields two arms. Removal restores the replaced pieces exactly.
 */

const PROJECT = { kind: 'project' as const, source: 'DRIP Urban scenario' };

/** Radius of the circulatory centre line at a bearing (radians from east), ellipses included. */
export function centreRadius(rb: Roundabout, angle: number): number {
  const a = rb.outerDiameterM / 2 - rb.circulatoryWidthM / 2;
  const b = rb.type === 'elliptical' ? (rb.outerDiameterM / 2) * Math.min(1, Math.max(0.5, rb.aspect)) - rb.circulatoryWidthM / 2 : a;
  const rot = ((90 - rb.orientationDeg) * Math.PI) / 180;
  const t = angle - rot;
  return (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t));
}

const radiusAt = (rb: Roundabout, p: V) => centreRadius(rb, Math.atan2(p[1], p[0]));
/** Nodes this close to the ring's outer edge are part of the roundabout area. */
const absorbRadius = (rb: Roundabout, p: V) => radiusAt(rb, p) + rb.circulatoryWidthM / 2 + 1;
const isInsideCentre = (rb: Roundabout, p: V) => Math.hypot(p[0], p[1]) < radiusAt(rb, p);

function densify(pts: readonly V[], step = 0.5): V[] {
  const out: V[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Point where segment a→b crosses the centre line (a and b on opposite sides), by bisection. */
function crossing(rb: Roundabout, a: V, b: V): V {
  let lo = 0, hi = 1;
  const inA = isInsideCentre(rb, a);
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    const p: V = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
    if (isInsideCentre(rb, p) === inA) lo = m; else hi = m;
  }
  const t = (lo + hi) / 2;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Outward polyline (from the ring) → the part outside the centre line, starting on it. */
function outsidePart(rb: Roundabout, outward: readonly V[]): V[] | null {
  const d = densify(outward);
  let last = -1;
  for (let i = 0; i < d.length; i++) if (isInsideCentre(rb, d[i]!)) last = i;
  if (last === d.length - 1) return null; // never leaves the ring
  if (last === -1) {
    // Starts already outside the centre line (absorbed node near the outer edge): radial stub.
    const p0 = d[0]!;
    const r = radiusAt(rb, p0), L = Math.hypot(p0[0], p0[1]) || 1;
    return [[(p0[0] / L) * r, (p0[1] / L) * r], ...d];
  }
  return [crossing(rb, d[last]!, d[last + 1]!), ...d.slice(last + 1)];
}

/** Simplify a densified polyline back to its corners (keeps the shape within 2 cm). */
function simplify(pts: readonly V[]): V[] {
  if (pts.length <= 2) return [...pts];
  const out: V[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!, b = pts[i]!, c = pts[i + 1]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const base = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross) / base > 0.02) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Cheap reject: does any segment come within `reach` metres of the ring centre? */
function nearRing(pts: readonly V[], reach: number): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2));
    if (Math.hypot(a[0] + dx * t, a[1] + dy * t) < reach) return true;
  }
  return false;
}

interface ArmCut {
  readonly roadId: string;
  /** Source road (the original, for arms taken from it). */
  readonly road: Road;
  /** true: the arm keeps the road's `from` end outside; false: keeps its `to` end. */
  readonly keepsFrom: boolean;
  /** Outward from the ring, metric, first point on the centre line. */
  readonly outward: V[];
  readonly angle: number;
}

export interface RoundaboutPlan {
  readonly arms: ArmCut[];
  readonly absorbedNodes: string[];
  readonly removedRoadIds: string[];
  readonly overlaps: string[];
}

/** Dry run: what the ring would cut, absorb and remove. */
export function planRoundabout(net: Network, rb: Roundabout): RoundaboutPlan {
  const f = new LocalFrame(rb.center);
  const m = (q: LngLat) => f.toMetric(q) as V;
  const absorbed = new Set<string>();
  const overlaps = new Set<string>();
  for (const n of Object.values(net.nodes)) {
    const p = m(n.at);
    if (n.id === rb.replacedNodeId || Math.hypot(p[0], p[1]) < absorbRadius(rb, p)) {
      const other = Object.keys(net.roundabouts).find((id) => id !== rb.id && n.id.startsWith(`${id}:n`));
      if (other) overlaps.add(other); else absorbed.add(n.id);
    }
  }
  const arms: ArmCut[] = [];
  const removed: string[] = [];
  const reach = rb.outerDiameterM / 2 + 2;
  for (const road of Object.values(net.roads)) {
    if (road.tags?.roundabout) continue;
    const fromIn = absorbed.has(road.from), toIn = absorbed.has(road.to);
    const pts = road.axis.map(m);
    if (!fromIn && !toIn && !nearRing(pts, reach)) continue;
    if (fromIn && toIn) { removed.push(road.id); continue; }
    if (fromIn || toIn) {
      const out = outsidePart(rb, fromIn ? pts : [...pts].reverse());
      if (!out) { removed.push(road.id); continue; }
      arms.push({ roadId: road.id, road, keepsFrom: !fromIn, outward: out, angle: Math.atan2(out[0]![1], out[0]![0]) });
      continue;
    }
    // Neither end inside: a road passing through the ring is split into two arms.
    const d = densify(pts);
    const ins = d.map((q) => isInsideCentre(rb, q));
    const first = ins.indexOf(true);
    if (first < 0) continue;
    const last = ins.lastIndexOf(true);
    const toward = [...d.slice(0, first), crossing(rb, d[first - 1]!, d[first]!)].reverse();
    const away = [crossing(rb, d[last]!, d[last + 1]!), ...d.slice(last + 1)];
    arms.push({ roadId: road.id, road, keepsFrom: true, outward: toward, angle: Math.atan2(toward[0]![1], toward[0]![0]) });
    arms.push({ roadId: `${road.id}~${rb.id}`, road, keepsFrom: false, outward: away, angle: Math.atan2(away[0]![1], away[0]![0]) });
  }
  arms.sort((a, b) => a.angle - b.angle);
  return { arms, absorbedNodes: [...absorbed], removedRoadIds: removed, overlaps: [...overlaps] };
}

export function insertRoundabout(net: Network, rb: Roundabout): Network {
  const f = new LocalFrame(rb.center);
  const plan = planRoundabout(net, rb);
  const roads = { ...net.roads };
  const nodes = { ...net.nodes };
  const junctions = { ...net.junctions };
  const absorbed = new Set(plan.absorbedNodes);
  const replaced = {
    roads: [] as Road[], nodes: [] as RoadNode[], junctions: [] as JunctionSpec[], signalPlans: [] as SignalPlan[], createdRoadIds: [] as string[],
  };
  for (const id of plan.absorbedNodes) {
    replaced.nodes.push(net.nodes[id]!);
    delete nodes[id];
    if (junctions[id]) { replaced.junctions.push(junctions[id]!); delete junctions[id]; }
  }
  const signalPlans = Object.fromEntries(Object.entries(net.signalPlans).filter(([, p]) => {
    if (!absorbed.has(p.nodeId)) return true;
    replaced.signalPlans.push(p);
    return false;
  }));
  for (const id of plan.removedRoadIds) { replaced.roads.push(net.roads[id]!); delete roads[id]; }
  const seen = new Set<string>();
  for (const arm of plan.arms) if (!seen.has(arm.road.id)) { seen.add(arm.road.id); replaced.roads.push(arm.road); }

  // Ring nodes: one per arm, plus evenly spaced ones so the ring always has at least 3.
  const ringStops: { angle: number; arm: ArmCut | null }[] = plan.arms.map((a) => ({ angle: a.angle, arm: a }));
  if (ringStops.length === 0) {
    const base = ((90 - rb.orientationDeg) * Math.PI) / 180;
    for (let k = 0; k < 3; k++) ringStops.push({ angle: base + (k * 2 * Math.PI) / 3, arm: null });
  } else if (ringStops.length === 1) {
    const a = ringStops[0]!.angle;
    ringStops.push({ angle: a + (2 * Math.PI) / 3, arm: null }, { angle: a + (4 * Math.PI) / 3, arm: null });
  } else if (ringStops.length === 2) {
    const [x, y] = [...ringStops].sort((p, q) => p.angle - q.angle) as [typeof ringStops[number], typeof ringStops[number]];
    const g1 = y.angle - x.angle, g2 = 2 * Math.PI - g1;
    ringStops.push({ angle: g1 >= g2 ? x.angle + g1 / 2 : y.angle + g2 / 2, arm: null });
  }
  // Keep angles in (−π, π] so the ring is ordered consistently.
  for (const st of ringStops) st.angle = Math.atan2(Math.sin(st.angle), Math.cos(st.angle));
  ringStops.sort((a, b) => a.angle - b.angle);
  const ringPoint = (angle: number): LngLat => { const R = centreRadius(rb, angle); return f.toLngLat([R * Math.cos(angle), R * Math.sin(angle)]); };

  ringStops.forEach((stop, i) => {
    const nid = `${rb.id}:n${i}`;
    nodes[nid] = { id: nid, at: stop.arm ? f.toLngLat(stop.arm.outward[0]!) : ringPoint(stop.angle) };
    const arm = stop.arm;
    if (!arm) return;
    const outward = simplify(arm.outward).map((q) => f.toLngLat(q));
    outward[0] = nodes[nid]!.at;
    const far = arm.keepsFrom ? arm.road.from : arm.road.to;
    const axis = arm.keepsFrom ? [...outward].reverse() : outward;
    const base = { ...arm.road, id: arm.roadId, provenance: { ...arm.road.provenance, geometry: PROJECT } };
    roads[arm.roadId] = arm.keepsFrom ? { ...base, axis, from: far, to: nid } : { ...base, axis, from: nid, to: far };
    if (arm.roadId !== arm.road.id) replaced.createdRoadIds.push(arm.roadId);
  });

  const laneW = rb.circulatoryWidthM / rb.lanes;
  ringStops.forEach((stop, i) => {
    const next = ringStops[(i + 1) % ringStops.length]!;
    let a1 = next.angle;
    while (a1 <= stop.angle) a1 += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil((a1 - stop.angle) / (Math.PI / 36)));
    const axis: LngLat[] = [];
    for (let s = 0; s <= steps; s++) axis.push(ringPoint(stop.angle + ((a1 - stop.angle) * s) / steps));
    const from = `${rb.id}:n${i}`, to = `${rb.id}:n${(i + 1) % ringStops.length}`;
    axis[0] = nodes[from]!.at;
    axis[axis.length - 1] = nodes[to]!.at;
    const id = `${rb.id}:ring${i}`;
    const lanes = makeLanes(id, rb.lanes, laneW, 'forward', ['car', 'bus', 'truck', 'bike', 'emergency']);
    roads[id] = {
      id, from, to, name: rb.name, roadClass: 'roundabout', axis, oneway: 'forward', speedKmh: rb.speedKmh,
      lanes, section: { elements: lanes.map((l) => ({ id: `${l.id}:e`, kind: 'lane' as const, widthM: l.widthM, laneId: l.id })).reverse() },
      provenance: { geometry: PROJECT, width: PROJECT }, tags: { roundabout: rb.id },
    };
  });

  const armSpecs = plan.arms.map((a) => rb.arms.find((s) => s.roadId === a.roadId) ?? {
    roadId: a.roadId, entryRadiusM: Math.max(6, rb.outerDiameterM * 0.35), exitRadiusM: Math.max(8, rb.outerDiameterM * 0.45),
    splitter: rb.type !== 'mini' && rb.outerDiameterM >= 26, splitterLengthM: 10, splitterWidthM: 1.5, crossing: false,
  });
  return {
    ...net, roads, nodes, junctions, signalPlans,
    roundabouts: { ...net.roundabouts, [rb.id]: { ...rb, arms: armSpecs, replaced } },
  };
}

export function extractRoundabout(net: Network, rbId: string): Network {
  const rb = net.roundabouts[rbId]!;
  const rep = rb.replaced;
  const roads = { ...net.roads };
  const nodes = { ...net.nodes };
  for (const r of Object.values(net.roads)) if (r.tags?.roundabout === rbId) delete roads[r.id];
  for (const id of Object.keys(nodes)) if (id.startsWith(`${rbId}:n`)) delete nodes[id];
  for (const id of rep?.createdRoadIds ?? []) delete roads[id];
  for (const n of rep?.nodes ?? []) nodes[n.id] = n;
  for (const orig of rep?.roads ?? []) {
    const now = net.roads[orig.id];
    const wasArm = now && (now.from.startsWith(`${rbId}:n`) || now.to.startsWith(`${rbId}:n`));
    // Arms keep later edits (section, name…) and get their original course back; swallowed roads return as they were.
    if (wasArm) roads[orig.id] = { ...now, axis: orig.axis, from: orig.from, to: orig.to, provenance: orig.provenance };
    else if (!now) roads[orig.id] = orig;
  }
  const junctions = { ...net.junctions };
  for (const j of rep?.junctions ?? []) junctions[j.nodeId] = j;
  const signalPlans = { ...net.signalPlans };
  for (const p of rep?.signalPlans ?? []) signalPlans[p.id] = p;
  const roundabouts = { ...net.roundabouts };
  delete roundabouts[rbId];
  return { ...net, roads, nodes, junctions, signalPlans, roundabouts };
}
