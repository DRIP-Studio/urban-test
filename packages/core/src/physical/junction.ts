import { add, convexHull, dot, intersectLines, leftNormal, mul, ringSelfIntersects, sub, unit, type V } from '../geo/polyline';
import type { Arm } from './topology';

/** Point on an arm edge: `off` metres sideways (left > 0), `s` metres from the node along the arm. */
function edgePoint(arm: Arm, node: V, off: number, s: number): V {
  return add(add(node, mul(arm.u, s)), mul(leftNormal(arm.u), off));
}

/**
 * Kerb radius actually used at a corner whose kerbs meet at `angle` (radians, between the two arms).
 * Full radius for near-orthogonal corners; acute corners taper to a 0.5 m nose so the roads stay straight
 * up to the junction instead of bending over 15+ m (a constant radius has tangent length r / tan(θ/2)).
 */
export function effectiveRadius(r: number, angle: number): number {
  if (r <= 0) return 0;
  const deg = (angle * 180) / Math.PI;
  const nose = Math.min(0.5, r);
  if (deg <= 35) return nose;
  if (deg >= 60) return r;
  return nose + ((deg - 35) / 25) * (r - nose);
}

/** Tangent length of a circular fillet of radius r between two directions forming `angle`. */
const tangentLength = (r: number, angle: number) => (r <= 0 ? 0 : r / Math.tan(angle / 2));
const angleBetween = (u: V, v: V) => Math.acos(Math.max(-1, Math.min(1, dot(u, v))));

interface CornerPair {
  readonly a: Arm;
  readonly b: Arm;
  /** Distances along a (its left edge) and b (its right edge) where the edges meet, if they do ahead of the node. */
  readonly sa: number;
  readonly sb: number;
  readonly meet: V | null;
  readonly saOut: number;
  readonly sbOut: number;
  readonly meetOut: V | null;
}

export interface JunctionGeometry {
  readonly nodeId: string;
  /** Setback per road end, keyed `${roadId}|${atStart}`. Road strips are trimmed by it. */
  readonly setbacks: ReadonlyMap<string, number>;
  /** Carriageway surface of the junction (closed ring, metric). */
  readonly surface: V[];
  /** Sidewalk corner rings between consecutive arms. */
  readonly corners: V[][];
  /** For each corner, the index (in the arms passed in) of the arm whose left side it continues. */
  readonly cornerArm: number[];
  /** Kerb lines (carriageway edge fillets) — used for kerbs in 2D/3D. */
  readonly kerbs: V[][];
}

export const armKey = (arm: Pick<Arm, 'road' | 'atStart'>): string => `${arm.road.id}|${arm.atStart ? 's' : 'e'}`;

function meetDistances(a: Arm, b: Arm, node: V, offA: number, offB: number): { sa: number; sb: number; at: V } | null {
  // a's left edge (towards b, which lies counter-clockwise) and b's right edge.
  const r = intersectLines(edgePoint(a, node, offA, 0), a.u, edgePoint(b, node, offB, 0), b.u);
  if (!r || r.s <= 0 || r.t <= 0) return null;
  return { sa: r.s, sb: r.t, at: r.at };
}

/**
 * Builds the junction envelope from the actual carriageway edges of the arms:
 * consecutive arm edges are intersected, each arm is trimmed behind the
 * intersection plus the kerb radius, and the corners are tangent fillets.
 */
export function buildJunction(nodeId: string, node: V, arms: readonly Arm[], cornerRadius: number): JunctionGeometry | null {
  if (arms.length < 2) return null;
  const n = arms.length;
  const pairs: CornerPair[] = [];
  for (let i = 0; i < n; i++) {
    const a = arms[i]!, b = arms[(i + 1) % n]!;
    const cw = meetDistances(a, b, node, a.cwLeft, b.cwRight);
    const out = meetDistances(a, b, node, a.outLeft, b.outRight);
    pairs.push({
      a, b,
      sa: cw?.sa ?? 0, sb: cw?.sb ?? 0, meet: cw?.at ?? null,
      saOut: out?.sa ?? 0, sbOut: out?.sb ?? 0, meetOut: out?.at ?? null,
    });
  }
  const r = n >= 3 ? cornerRadius : 0;
  const setback = new Map<Arm, number>();
  const radius = new Map<CornerPair, number>();
  for (const arm of arms) setback.set(arm, 0);
  for (const p of pairs) {
    const angle = angleBetween(p.a.u, p.b.u);
    const re = effectiveRadius(r, angle);
    radius.set(p, re);
    const T = tangentLength(re, angle);
    const ta = p.meet ? T : 0, to = p.meetOut ? T : 0;
    setback.set(p.a, Math.max(setback.get(p.a)!, p.sa + ta, p.saOut + to));
    setback.set(p.b, Math.max(setback.get(p.b)!, p.sb + ta, p.sbOut + to));
  }
  // Never eat more than 45 % of a short road; the other end needs room too.
  for (const arm of arms) setback.set(arm, Math.min(setback.get(arm)!, arm.length * 0.45));

  const surface: V[] = [];
  const corners: V[][] = [];
  const cornerArm: number[] = [];
  const kerbs: V[][] = [];
  for (const [pi, p] of pairs.entries()) {
    const { a, b } = p;
    const SA = setback.get(a)!, SB = setback.get(b)!;
    // Cut line of arm a: right edge then left edge.
    surface.push(edgePoint(a, node, a.cwRight, SA), edgePoint(a, node, a.cwLeft, SA));
    const re = radius.get(p)!;
    const inner = cornerPath(a, b, node, a.cwLeft, b.cwRight, p.sa, p.sb, p.meet, SA, SB, re);
    surface.push(...inner.slice(1, -1));
    kerbs.push(inner);
    const hasWalk = a.outLeft - a.cwLeft > 0.2 || b.cwRight - b.outRight > 0.2;
    if (hasWalk) {
      // When the kerb has no room to round the corner (short arm trimmed), the back of the sidewalk
      // must not either: an arc behind a straight kerb folds the corner ring over itself.
      const straightKerb = inner.length <= 3;
      const outer = straightKerb
        ? [edgePoint(a, node, a.outLeft, SA), ...(inner.length === 3 && p.meetOut ? [p.meetOut] : []), edgePoint(b, node, b.outRight, SB)]
        : cornerPath(a, b, node, a.outLeft, b.outRight, p.saOut, p.sbOut, p.meetOut, SA, SB, re);
      const ring = [...inner, ...[...outer].reverse()];
      // An arm shorter than the junction needs (two nodes a few metres apart) can fold the corner:
      // fall back to its convex outline rather than drawing a twisted polygon.
      corners.push(ringSelfIntersects(ring) ? convexHull(ring) : ring);
      cornerArm.push(pi);
    }
  }
  const setbacks = new Map<string, number>();
  for (const arm of arms) setbacks.set(armKey(arm), setback.get(arm)!);
  return { nodeId, setbacks, surface, corners, cornerArm, kerbs };
}

/**
 * From a's left edge at its cut, round the corner, to b's right edge at its cut: straight kerb along a,
 * circular arc tangent to both kerbs (radius r, centre on the bisector), straight kerb along b.
 */
function cornerPath(
  a: Arm, b: Arm, node: V, offA: number, offB: number, sa: number, sb: number, meet: V | null, SA: number, SB: number, rWanted: number,
): V[] {
  const start = edgePoint(a, node, offA, SA);
  const end = edgePoint(b, node, offB, SB);
  // Kerbs that would meet beyond a cut (short arms are trimmed to 45 %): no corner to round.
  if (!meet || sa >= SA - 1e-3 || sb >= SB - 1e-3) return [start, end];
  const angle = angleBetween(a.u, b.u);
  // The fillet must end before both cuts: shrink the radius to the room available.
  const T = Math.min(tangentLength(rWanted, angle), SA - sa, SB - sb);
  if (T <= 0.05 || rWanted <= 0) return [start, meet, end];
  const r = T * Math.tan(angle / 2);
  const p0 = add(meet, mul(a.u, T));
  const p1 = add(meet, mul(b.u, T));
  const bis = unit(add(a.u, b.u));
  const centre = add(meet, mul(bis, r / Math.sin(angle / 2)));
  const a0 = Math.atan2(p0[1] - centre[1], p0[0] - centre[0]);
  let a1 = Math.atan2(p1[1] - centre[1], p1[0] - centre[0]);
  // Take the short way round (the arc spans π − angle).
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  a1 = a0 + d;
  const steps = Math.max(4, Math.ceil(Math.abs(d) / (Math.PI / 24)));
  const arc: V[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    arc.push([centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)]);
  }
  const pts: V[] = [start, ...arc, end];
  // Drop the straight ends that collapse onto the tangent points.
  return pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) > 1e-3 || i === pts.length - 1);
}
