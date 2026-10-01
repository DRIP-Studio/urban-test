import type { LocalFrame } from '../geo/projection';
import { lengthOf, sampleAt, sub, unit, type V } from '../geo/polyline';
import type { Network, Road } from '../model/types';
import { layoutSection } from './section';

/** One road end meeting a node, expressed in the arm's own frame (pointing away from the node). */
export interface Arm {
  readonly road: Road;
  readonly nodeId: string;
  /** True when the node is the start of the road axis. */
  readonly atStart: boolean;
  /** Metric axis oriented away from the node. */
  readonly axis: readonly V[];
  readonly length: number;
  readonly u: V;
  readonly angle: number;
  /** Carriageway / outer offsets in the arm frame (left > 0 > right). */
  readonly cwLeft: number;
  readonly cwRight: number;
  readonly outLeft: number;
  readonly outRight: number;
  readonly pedestrian: boolean;
}

export class MetricCache {
  private readonly axes = new WeakMap<Road, V[]>();
  constructor(readonly frame: LocalFrame) {}

  axis(road: Road): V[] {
    let a = this.axes.get(road);
    if (!a) {
      a = road.axis.map((p) => this.frame.toMetric(p) as V);
      this.axes.set(road, a);
    }
    return a;
  }
}

export function buildArm(road: Road, nodeId: string, atStart: boolean, metric: MetricCache): Arm {
  const fwd = metric.axis(road);
  const axis = atStart ? fwd : [...fwd].reverse();
  const length = lengthOf(axis);
  const probe = sampleAt(axis, Math.min(6, length / 3)).p;
  const u = unit(sub(probe, axis[0]!));
  const s = layoutSection(road);
  // Seen from the far end the sides swap and offsets change sign.
  const [cwLeft, cwRight, outLeft, outRight] = atStart
    ? [s.cwLeft, s.cwRight, s.outerLeft, s.outerRight]
    : [-s.cwRight, -s.cwLeft, -s.outerRight, -s.outerLeft];
  return {
    road, nodeId, atStart, axis, length, u, angle: Math.atan2(u[1], u[0]),
    cwLeft, cwRight, outLeft, outRight, pedestrian: s.pedestrianOnly,
  };
}

export interface NodeIncidence {
  readonly byNode: ReadonlyMap<string, readonly { road: Road; atStart: boolean }[]>;
}

const incidenceCache = new WeakMap<Network['roads'], NodeIncidence>();

export function incidence(net: Network): NodeIncidence {
  const hit = incidenceCache.get(net.roads);
  if (hit) return hit;
  const byNode = new Map<string, { road: Road; atStart: boolean }[]>();
  for (const road of Object.values(net.roads)) {
    if (!byNode.has(road.from)) byNode.set(road.from, []);
    byNode.get(road.from)!.push({ road, atStart: true });
    if (!byNode.has(road.to)) byNode.set(road.to, []);
    byNode.get(road.to)!.push({ road, atStart: false });
  }
  const out = { byNode };
  incidenceCache.set(net.roads, out);
  return out;
}

/** Vehicular arms at a node, sorted counter-clockwise by angle. */
export function vehicularArms(net: Network, nodeId: string, metric: MetricCache): Arm[] {
  const ends = incidence(net).byNode.get(nodeId) ?? [];
  return ends
    .map((e) => buildArm(e.road, nodeId, e.atStart, metric))
    .filter((a) => !a.pedestrian && a.length > 0.5)
    .sort((a, b) => a.angle - b.angle);
}

