import { add, intersectLines, leftNormal, mul, quadBezier, sampleAt, sub, unit, type V } from '../geo/polyline';
import type { Network, Roundabout } from '../model/types';
import { armKey } from './junction';
import { dashes, MARKING } from './markings';
import { layoutSection } from './section';
import { buildArm, incidence, type MetricCache } from './topology';

export interface RbPolygon {
  readonly id: string;
  readonly kind: 'roundabout_ring' | 'roundabout_island' | 'roundabout_apron' | 'splitter' | 'carriageway' | 'give_way' | 'ring_line' | 'zebra';
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
        const S = Math.max(along(wl), along(wr)) + entryR;
        const setback = Math.max(0, Math.min(S, arm.length * 0.6));
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
        const edgeS = along(0);

        if (spec?.splitter) {
          const L0 = edgeS + 1.0, L1 = edgeS + 1.0 + spec.splitterLengthM, hw = spec.splitterWidthM / 2;
          const island: V[] = [];
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            island.push(P(L0 + (L1 - L0) * t, hw * Math.sin(Math.PI * (0.5 + 0.5 * t))));
          }
          for (let i = 8; i >= 0; i--) {
            const t = i / 8;
            island.push(P(L0 + (L1 - L0) * t, -hw * Math.sin(Math.PI * (0.5 + 0.5 * t))));
          }
          out.polygons.push({ id: `rb:${id}:splitter:${arm.road.id}`, kind: 'splitter', ring: island, roadId: arm.road.id, state: 'project', material: 'granite', z: 6, heightM: 0.15 });
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
          const s = edgeS + (spec.splitter ? 1.0 + spec.splitterLengthM * 0.55 : 6);
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
