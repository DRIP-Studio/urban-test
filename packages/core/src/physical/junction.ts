import { add, intersectLines, leftNormal, mul, quadBezier, type V } from '../geo/polyline';
import type { Arm } from './topology';

/** Point on an arm edge: `off` metres sideways (left > 0), `s` metres from the node along the arm. */
function edgePoint(arm: Arm, node: V, off: number, s: number): V {
  return add(add(node, mul(arm.u, s)), mul(leftNormal(arm.u), off));
}

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
  for (const arm of arms) setback.set(arm, 0);
  for (const p of pairs) {
    const ra = p.meet ? r : 0, ro = p.meetOut ? r : 0;
    setback.set(p.a, Math.max(setback.get(p.a)!, p.sa + ra, p.saOut + ro));
    setback.set(p.b, Math.max(setback.get(p.b)!, p.sb + ra, p.sbOut + ro));
  }
  // Never eat more than 45 % of a short road; the other end needs room too.
  for (const arm of arms) setback.set(arm, Math.min(setback.get(arm)!, arm.length * 0.45));

  const surface: V[] = [];
  const corners: V[][] = [];
  const kerbs: V[][] = [];
  for (const p of pairs) {
    const { a, b } = p;
    const SA = setback.get(a)!, SB = setback.get(b)!;
    // Cut line of arm a: right edge then left edge.
    surface.push(edgePoint(a, node, a.cwRight, SA), edgePoint(a, node, a.cwLeft, SA));
    const inner = cornerPath(a, b, node, a.cwLeft, b.cwRight, p.sa, p.sb, p.meet, SA, SB, r);
    surface.push(...inner.slice(1, -1));
    kerbs.push(inner);
    const hasWalk = a.outLeft - a.cwLeft > 0.2 || b.cwRight - b.outRight > 0.2;
    if (hasWalk) {
      const outer = cornerPath(a, b, node, a.outLeft, b.outRight, p.saOut, p.sbOut, p.meetOut, SA, SB, r);
      corners.push([...inner, ...[...outer].reverse()]);
    }
  }
  const setbacks = new Map<string, number>();
  for (const arm of arms) setbacks.set(armKey(arm), setback.get(arm)!);
  return { nodeId, setbacks, surface, corners, kerbs };
}

/** From a's left edge at its cut, round the corner, to b's right edge at its cut. */
function cornerPath(
  a: Arm, b: Arm, node: V, offA: number, offB: number,
  sa: number, sb: number, meet: V | null, SA: number, SB: number, r: number,
): V[] {
  const start = edgePoint(a, node, offA, SA);
  const end = edgePoint(b, node, offB, SB);
  if (!meet || r <= 0) return [start, end];
  const t0 = edgePoint(a, node, offA, Math.min(SA, sa + r));
  const t1 = edgePoint(b, node, offB, Math.min(SB, sb + r));
  return [start, ...quadBezier(t0, meet, t1, 10), end];
}
