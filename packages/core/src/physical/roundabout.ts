import { add, intersectLines, leftNormal, mul, quadBezier, sampleAt, sub, unit, type V } from '../geo/polyline';
import type { Network, Roundabout } from '../model/types';
import { armKey } from './junction';
import { dashes, MARKING } from './markings';
import { layoutSection } from './section';
import { buildArm, incidence, type MetricCache } from './topology';

export interface RbPolygon {
  readonly id: string;
  readonly kind: 'roundabout_ring' | 'roundabout_island' | 'roundabout_apron' | 'splitter' | 'carriageway' | 'give_way' | 'ring_line' | 'zebra' | 'custom';
  readonly ring: V[];
  readonly holes?: V[][];
  readonly nodeId?: string;
  readonly roadId?: string;
  readonly state: 'project' | 'existing';
  readonly material: string;
  readonly z: number;
  readonly heightM: number;
}

export interface RoundaboutBuild {
  readonly polygons: RbPolygon[];
  readonly markings: RbPolygon[];
  readonly setbacks: Map<string, number>;
  readonly ownedNodes: Set<string>;
  readonly ringRoadIds: Set<string>;
}

/** Shape of the outer edge: ellipse with semi-axes (a, b) rotated by `rot` (radians, CCW from east). */
export interface RoundaboutShape {
  readonly c: V;
  readonly a: number;
  readonly b: number;
  readonly rot: number;
}

export function shapeOf(rb: Roundabout, centre: V, inset = 0): RoundaboutShape {
  const R = rb.outerDiameterM / 2 - inset;
  const aspect = rb.type === 'elliptical' ? Math.min(1, Math.max(0.5, rb.aspect)) : 1;
  return { c: centre, a: R, b: R * aspect, rot: ((90 - rb.orientationDeg) * Math.PI) / 180 };
}

export function pointAt(s: RoundaboutShape, theta: number): V {
  const x = s.a * Math.cos(theta), y = s.b * Math.sin(theta);
  const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
  return [s.c[0] + x * cr - y * sr, s.c[1] + x * sr + y * cr];
}

/** Parametric angle of the shape point in world direction `angle`. */
export function thetaFor(s: RoundaboutShape, angle: number): number {
  const local = angle - s.rot;
  return Math.atan2(Math.sin(local) * s.a, Math.cos(local) * s.b);
}

export function outline(s: RoundaboutShape, n = 128): V[] {
  return Array.from({ length: n }, (_, i) => pointAt(s, (2 * Math.PI * i) / n));
}

function radiusTowards(s: RoundaboutShape, angle: number): number {
  const p = pointAt(s, thetaFor(s, angle));
  return Math.hypot(p[0] - s.c[0], p[1] - s.c[1]);
}

export function buildRoundabouts(net: Network, metric: MetricCache): RoundaboutBuild {
  const out: RoundaboutBuild = { polygons: [], markings: [], setbacks: new Map(), ownedNodes: new Set(), ringRoadIds: new Set() };
  const inc = incidence(net);
  for (const rb of Object.values(net.roundabouts)) {
    const c = metric.frame.toMetric(rb.center) as V;
    const outer = shapeOf(rb, c);
    const inner = shapeOf(rb, c, rb.circulatoryWidthM);
    const apron = shapeOf(rb, c, rb.circulatoryWidthM + rb.apronWidthM);
    const ringNodes = new Set<string>();
    for (const road of Object.values(net.roads)) {
      if (road.tags?.roundabout === rb.id) {
        out.ringRoadIds.add(road.id);
        ringNodes.add(road.from);
        ringNodes.add(road.to);
      }
    }
    ringNodes.forEach((n) => out.ownedNodes.add(n));
    const id = rb.id;
    out.polygons.push({ id: `rb:${id}:ring`, kind: 'roundabout_ring', ring: outline(outer), holes: [outline(inner)], state: 'project', material: 'asphalt', z: 4, heightM: 0 });
    if (rb.apronWidthM > 0) {
      out.polygons.push({ id: `rb:${id}:apron`, kind: 'roundabout_apron', ring: outline(inner), holes: [outline(apron)], state: 'project', material: 'porphyry', z: 5, heightM: 0.05 });
    }
    out.polygons.push({ id: `rb:${id}:island`, kind: 'roundabout_island', ring: outline(rb.apronWidthM > 0 ? apron : inner), state: 'project', material: rb.islandMaterial, z: 6, heightM: rb.type === 'mini' ? 0.05 : 0.2 });
    if (rb.lanes === 2) {
      const mid = shapeOf(rb, c, rb.circulatoryWidthM / 2);
      const ringLine = [...outline(mid, 160), pointAt(mid, 0)];
      dashes(ringLine, MARKING.urbanDashed).forEach((r, i) =>
        out.markings.push({ id: `rb:${id}:lane:${i}`, kind: 'ring_line', ring: r, state: 'project', material: 'road_marking_white', z: 10, heightM: 0 }));
    }

    // Arms: every non-ring road ending on a ring node.
    // Arm angles first: each throat may spread at most to 45 % of the gap to its neighbours,
    // so adjacent entries can never overlap (no wedges when arms arrive close together).
    const armsAll = [...ringNodes].flatMap((nodeId) => (inc.byNode.get(nodeId) ?? [])
      .filter((end) => !out.ringRoadIds.has(end.road.id))
      .map((end) => buildArm(end.road, nodeId, end.atStart, metric))
      .filter((a) => !a.pedestrian));
    const angles = armsAll.map((a) => Math.atan2(a.axis[0]![1] - c[1], a.axis[0]![0] - c[0]));
    const gapTo = (i: number, dir: 1 | -1): number => {
      let best = Math.PI;
      angles.forEach((b, j) => {
        if (j === i) return;
        let d = (b - angles[i]!) * dir;
        while (d <= 0) d += 2 * Math.PI;
        best = Math.min(best, d);
      });
      return best;
    };
    for (const [ai, arm] of armsAll.entries()) {
      {
        const maxLeft = 0.45 * gapTo(ai, 1), maxRight = 0.45 * gapTo(ai, -1);
        const spec = rb.arms.find((a) => a.roadId === arm.road.id);
        const entryR = spec?.entryRadiusM ?? Math.max(6, rb.outerDiameterM * 0.35);
        // Everything is measured in the arm's own frame (s along its axis from the ring node, w to its
        // left), so oblique arms of a freely placed ring line up with their road strip.
        const axis = arm.axis;
        const P = (s: number, w: number): V => {
          const q = s >= 0 ? sampleAt(axis, Math.min(s, arm.length)) : { p: add(axis[0]!, mul(unit(sub(axis[1]!, axis[0]!)), s)), t: unit(sub(axis[1]!, axis[0]!)) };
          return add(q.p, mul(leftNormal(q.t), w));
        };
        const dirAt = (s: number): V => sampleAt(axis, Math.max(0, Math.min(s, arm.length))).t;
        const outside = (q: V) => Math.hypot(q[0] - c[0], q[1] - c[1]) >= radiusTowards(outer, Math.atan2(q[1] - c[1], q[0] - c[0]));
        /** Distance along the arm where its edge line at offset w leaves the outer ring edge. */
        const along = (w: number): number => {
          let lo = -outer.a, hi = Math.min(arm.length, outer.a * 2 + 10);
          if (outside(P(lo, w))) return lo;
          if (!outside(P(hi, w))) return hi;
          for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (outside(P(m, w))) hi = m; else lo = m; }
          return hi;
        };
        const angle = Math.atan2(P(along(0), 0)[1] - c[1], P(along(0), 0)[0] - c[0]);
        const Ro = radiusTowards(outer, angle);
        const wl = arm.cwLeft, wr = arm.cwRight;
        const edge0 = along(0);
        const wanted = spec?.splitter ? splitterShape(spec.splitterLengthM, spec.splitterWidthM) : null;
        const S = Math.max(along(wl), along(wr), wanted ? edge0 + wanted.reach : 0) + entryR;
        const setback = Math.max(0, Math.min(S, arm.length * 0.6));
        // Short arm: the road strip (and its lane lines) starts earlier, so the island and its hatch must
        // end before it: shorter hatch first, then a shorter island; below 4 m there is no room for one.
        const room = setback - entryR * 0.3 - edge0 - 1.0;
        const island = !wanted || room >= wanted.reach - 1.0 ? wanted
          : room >= 4 + 3 ? splitterShape(Math.min(spec!.splitterLengthM, room - Math.min(HATCH_M, room / 3)), spec!.splitterWidthM, Math.min(HATCH_M, room / 3))
          : room >= 4 ? splitterShape(room, spec!.splitterWidthM, 0) : null;
        out.setbacks.set(armKey(arm), setback);

        // Tangent fillets from both carriageway edges onto the outer edge.
        const throat: V[] = [P(setback, wr), P(setback, wl)];
        const tangent = (w: number, side: 1 | -1): V[] => {
          const hit = P(along(w), w);
          const edgeAng = Math.atan2(hit[1] - c[1], hit[0] - c[0]);
          const spread = Math.min(side > 0 ? maxLeft : maxRight, Math.max(0, (edgeAng - angle) * side) + Math.min(0.9, entryR / Ro));
          const ang = angle + side * spread;
          const tp = pointAt(outer, thetaFor(outer, ang));
          const tdir: V = [-Math.sin(ang) * side, Math.cos(ang) * side];
          const meet = intersectLines(P(setback, w), mul(dirAt(setback), -1), tp, tdir);
          const ctrl = meet && meet.s > 0 ? meet.at : hit;
          return quadBezier(P(setback, w), ctrl, tp, 12);
        };
        const leftCurve = tangent(wl, 1);
        const rightCurve = tangent(wr, -1);
        const tl = leftCurve[leftCurve.length - 1]!, tr = rightCurve[rightCurve.length - 1]!;
        const angL = Math.atan2(tl[1] - c[1], tl[0] - c[0]), angR = Math.atan2(tr[1] - c[1], tr[0] - c[0]);
        // Arc along the outer edge from the left tangent point clockwise to the right one (inside the throat).
        const arcPts: V[] = [];
        let a1 = angR;
        while (a1 > angL) a1 -= 2 * Math.PI;
        const steps = 12;
        for (let i = 1; i < steps; i++) {
          const a = angL + ((a1 - angL) * i) / steps;
          const p = pointAt(outer, thetaFor(outer, a));
          // Push slightly inside so the throat overlaps the ring surface (no hairline gap).
          arcPts.push(add(p, mul([c[0] - p[0], c[1] - p[1]], 0.06)));
        }
        throat.push(...leftCurve.slice(1), ...arcPts, ...[...rightCurve].reverse().slice(0, -1));
        out.polygons.push({ id: `rb:${id}:throat:${arm.road.id}`, kind: 'carriageway', ring: throat, roadId: arm.road.id, state: 'project', material: 'asphalt', z: 4, heightM: 0 });
        const edgeS = edge0;

        // Crossing station: through the island (pedestrian refuge) or 6 m from the ring.
        const crossS = edgeS + (island ? island.start + island.length * 0.55 : 6);
        if (island) {
          // Teardrop island (DM 19/04/2006 § 4.5.3): wide towards the ring, nose outwards, kerbed 15 cm.
          // The carriageway flares around it so both lanes keep their width, and a hatched taper
          // (zebratura, art. 150 Reg.) leads to the nose.
          const s0 = edgeS + island.start;
          const pieces = spec!.crossing ? [[0, island.length * 0.55 - 1.4], [island.length * 0.55 + 1.4, island.length]] : [[0, island.length]];
          pieces.forEach(([a = 0, b = 0], k) => {
            if (b - a < 0.8) return;
            const ring = island.outline(a, b).map(([t, w]) => P(s0 + t, w));
            out.polygons.push({ id: `rb:${id}:splitter:${arm.road.id}${k ? `:${k}` : ''}`, kind: 'splitter', ring, roadId: arm.road.id, state: 'project', material: 'concrete', z: 6, heightM: 0.15 });
          });
          // Flares: each carriageway edge pushed out by the island half-width, tapering back over 15 m.
          const taper = island.hatch + 6, end = island.length + taper;
          for (const side of [1, -1] as const) {
            const base = side > 0 ? wl : wr;
            const inner: V[] = [], outerEdge: V[] = [];
            for (let i = 0; i <= 24; i++) {
              const t = -island.start + ((end + island.start) * i) / 24;
              const h = t <= island.length ? island.half(Math.max(0, t)) : island.half(island.length) * Math.max(0, 1 - (t - island.length) / taper);
              inner.push(P(s0 + t, base));
              outerEdge.push(P(s0 + t, base + side * (h + 0.05)));
            }
            out.polygons.push({ id: `rb:${id}:flare:${arm.road.id}:${side > 0 ? 'l' : 'r'}`, kind: 'carriageway', ring: [...inner, ...outerEdge.reverse()], roadId: arm.road.id, state: 'project', material: 'asphalt', z: 4, heightM: 0 });
          }
          // Zebratura ahead of the nose: two converging edge lines and 45° stripes every 1.5 m.
          const hz = island.half(island.length), Lz = island.hatch;
          const zs = s0 + island.length;
          const edgeAt = (t: number) => hz * (1 - t / Lz);
          let k = 0;
          if (Lz >= 1) {
          const mk = (ring: V[]) => out.markings.push({ id: `rb:${id}:hatch:${arm.road.id}:${k++}`, kind: 'custom', ring, roadId: arm.road.id, state: 'project', material: 'road_marking_white', z: 10, heightM: 0 });
          for (const side of [1, -1] as const) {
            const pts: V[] = [], back: V[] = [];
            for (let i = 0; i <= 8; i++) { const t = (Lz * i) / 8; pts.push(P(zs + t, side * edgeAt(t))); back.push(P(zs + t, side * Math.max(0, edgeAt(t) - 0.12))); }
            mk([...pts, ...back.reverse()]);
          }
          for (let t = 0.8; t < Lz - 1; t += 1.5) {
            const w = edgeAt(t) - 0.12;
            if (w < 0.25) break;
            mk([P(zs + t - w, w), P(zs + t - w + 0.5, w), P(zs + t + w + 0.5, -w), P(zs + t + w, -w)]);
          }
          }
        }
        // Give-way line across the inbound lanes at the ring edge (yield control is the legal default).
        if (rb.control === 'yield') {
          const lay = layoutSection(arm.road);
          const inbound = arm.road.lanes.filter((l) => (arm.atStart ? l.direction === 'backward' : l.direction !== 'backward'));
          const offs = lay.elements.filter((e) => inbound.some((l) => l.id === e.el.laneId)).flatMap((e) => (arm.atStart ? [e.left, e.right] : [-e.left, -e.right]));
          if (offs.length) {
            const lo = Math.min(...offs), hi = Math.max(...offs);
            const s = Math.max(along(lo), along(hi)) + 0.6;
            dashes([P(s, lo), P(s, hi)], MARKING.giveWayDash).forEach((r, i) =>
              out.markings.push({ id: `rb:${id}:gw:${arm.road.id}:${i}`, kind: 'give_way', ring: r, roadId: arm.road.id, state: 'project', material: 'road_marking_white', z: 10, heightM: 0 }));
          }
        }
        if (spec?.crossing) {
          const s = crossS;
          const depth = MARKING.zebraDepthM / 2;
          const width = arm.cwLeft - arm.cwRight;
          const period = MARKING.zebraStripeM + MARKING.zebraGapM;
          const count = Math.max(1, Math.floor((width + MARKING.zebraGapM) / period));
          const start = arm.cwRight + (width - (count * period - MARKING.zebraGapM)) / 2;
          for (let i = 0; i < count; i++) {
            const o0 = start + i * period, o1 = o0 + MARKING.zebraStripeM;
            out.markings.push({
              id: `rb:${id}:zebra:${arm.road.id}:${i}`, kind: 'zebra', roadId: arm.road.id, state: 'project', material: 'road_marking_white', z: 10, heightM: 0,
              ring: [P(s - depth, o0), P(s + depth, o0), P(s + depth, o1), P(s - depth, o1)],
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * Splitter island outline in its own frame: t from the ring end (0) to the nose (length), w lateral.
 * Width `widthM` at the ring end narrowing to a 0,6 m rounded nose; ring-end corners rounded 0,5 m.
 */
/** Painted hatch (zebratura) ahead of a splitter nose, metres. */
const HATCH_M = 12;

export function splitterShape(lengthM: number, widthM: number, hatchM: number = HATCH_M): {
  readonly start: number; readonly length: number; readonly reach: number; readonly hatch: number;
  half(t: number): number;
  outline(a: number, b: number): [number, number][];
} {
  // Kerbed part: from W/2 to a blunt 0,3·W nose; the painted hatch then tapers it to the centre line.
  const length = Math.max(4, lengthM), W = Math.max(1.5, widthM), nose = Math.max(0.45, 0.3 * W);
  const half = (t: number) => nose + (W / 2 - nose) * Math.pow(1 - Math.min(1, Math.max(0, t / length)), 0.75);
  const outline = (a: number, b: number): [number, number][] => {
    const n = 12, left: [number, number][] = [], right: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = a + ((b - a) * i) / n;
      // Round the ends: shrink the half-width over the first and last 0,5 m (nose: a semicircle).
      const ra = Math.min(0.5, (b - a) / 2), dA = t - a, dB = b - t;
      let h = half(t);
      if (dA < ra) h *= Math.sqrt(Math.max(0, 1 - ((ra - dA) / ra) ** 2)) * 0.6 + 0.4;
      if (dB < ra) h *= Math.sqrt(Math.max(0, 1 - ((ra - dB) / ra) ** 2)) * 0.6 + 0.4;
      left.push([t, h]); right.push([t, -h]);
    }
    return [...left, ...right.reverse()];
  };
  return { start: 1.0, length, reach: 1.0 + length + hatchM + 6, hatch: hatchM, half, outline };
}
