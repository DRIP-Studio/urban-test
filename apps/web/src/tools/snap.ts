import { LocalFrame, centreRadius, geom, isPedestrianRoad, type LngLat, type Network } from '@drip-urban/core';
import type { Map as MLMap } from 'maplibre-gl';
import { useMapUi } from '../map/mapStore';

export interface SnapResult {
  readonly at: LngLat;
  readonly kind: 'node' | 'midpoint' | 'edge' | 'grid' | 'angle' | 'free';
  readonly nodeId?: string;
  readonly roadId?: string;
  readonly along?: number;
}

const CELL = 60;
/** Below this distance from a road end, snapping joins the end node instead of splitting the road. */
export const MERGE_M = 6;

/** Spatial index of the scenario network in the project metric frame, rebuilt per network version. */
export class NetworkIndex {
  readonly frame: LocalFrame;
  private nodes = new Map<string, string[]>();
  private roads = new Map<string, string[]>();
  private axes = new Map<string, geom.V[]>();
  constructor(readonly net: Network, origin: LngLat) {
    this.frame = new LocalFrame(origin);
    const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    for (const n of Object.values(net.nodes)) {
      const p = this.frame.toMetric(n.at);
      const k = key(p[0], p[1]);
      (this.nodes.get(k) ?? this.nodes.set(k, []).get(k)!).push(n.id);
    }
    for (const r of Object.values(net.roads)) {
      const axis = r.axis.map((q) => this.frame.toMetric(q) as geom.V);
      this.axes.set(r.id, axis);
      const cells = new Set<string>();
      for (let i = 1; i < axis.length; i++) {
        const a = axis[i - 1]!, b = axis[i]!;
        const steps = Math.max(1, Math.ceil(geom.dist(a, b) / (CELL / 2)));
        for (let s = 0; s <= steps; s++) { const p = geom.lerp(a, b, s / steps); cells.add(key(p[0], p[1])); }
      }
      for (const k of cells) (this.roads.get(k) ?? this.roads.set(k, []).get(k)!).push(r.id);
    }
  }

  private near<T>(index: Map<string, T[]>, p: geom.V, r: number): T[] {
    const out = new Set<T>();
    const c0 = Math.floor((p[0] - r) / CELL), c1 = Math.floor((p[0] + r) / CELL);
    const d0 = Math.floor((p[1] - r) / CELL), d1 = Math.floor((p[1] + r) / CELL);
    for (let x = c0; x <= c1; x++) for (let y = d0; y <= d1; y++) for (const v of index.get(`${x},${y}`) ?? []) out.add(v);
    return [...out];
  }

  nearestNode(p: geom.V, r: number): { id: string; d: number } | null {
    let best: { id: string; d: number } | null = null;
    for (const id of this.near(this.nodes, p, r)) {
      const d = geom.dist(p, this.frame.toMetric(this.net.nodes[id]!.at));
      if (d <= r && (!best || d < best.d)) best = { id, d };
    }
    return best;
  }

  nearestRoad(p: geom.V, r: number, vehicularOnly = false): { id: string; d: number; along: number; at: geom.V; length: number } | null {
    let best: { id: string; d: number; along: number; at: geom.V; length: number } | null = null;
    for (const id of this.near(this.roads, p, r)) {
      if (vehicularOnly && isPedestrianRoad(this.net.roads[id]!)) continue;
      const axis = this.axes.get(id)!;
      const pr = geom.project(axis, p);
      if (pr.d <= r && (!best || pr.d < best.d)) best = { id, d: pr.d, along: pr.along, at: pr.at, length: geom.lengthOf(axis) };
    }
    return best;
  }

  axis(id: string): geom.V[] { return this.axes.get(id) ?? []; }

  /** Where a new polyline crosses existing roads: distance along the new line and along the crossed road. */
  crossings(line: readonly geom.V[], accept: (roadId: string) => boolean): { roadId: string; s: number; along: number; at: geom.V }[] {
    const out: { roadId: string; s: number; along: number; at: geom.V }[] = [];
    let s0 = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const seg = geom.dist(a, b);
      const mid = geom.lerp(a, b, 0.5);
      for (const id of this.near(this.roads, mid, seg / 2 + 1)) {
        if (!accept(id)) continue;
        const ax = this.axes.get(id)!;
        let r0 = 0;
        for (let j = 1; j < ax.length; j++) {
          const c = ax[j - 1]!, d = ax[j]!;
          const L = geom.dist(c, d);
          const hit = geom.intersectLines(a, geom.sub(b, a), c, geom.sub(d, c));
          if (hit && hit.s > 0 && hit.s < 1 && hit.t > 0 && hit.t < 1) out.push({ roadId: id, s: s0 + hit.s * seg, along: r0 + hit.t * L, at: hit.at });
          r0 += L;
        }
      }
      s0 += seg;
    }
    return out.sort((x, y) => x.s - y.s);
  }
}

/** Snap a pointer position. `from` enables angle snapping for drawing tools. */
/** Objects (furniture, signs, point markings) align to the road unless Alt is held or object snap is off. */
export const objectSnap = (e: { alt: boolean }): boolean => !e.alt && useMapUi.getState().snap.objects;

/** Every snap on or off at once (F9, as in CAD): if any is on, all go off. */
export function toggleAllSnaps(): boolean {
  const s = useMapUi.getState().snap;
  const on = !(s.node || s.edge || s.objects || s.grid || s.angle);
  useMapUi.setState({ snap: { ...s, node: on, edge: on, objects: on, angle: on, grid: on ? s.grid : false } });
  return on;
}

export function snap(map: MLMap, idx: NetworkIndex, lngLat: LngLat, opts: { from?: LngLat; disable?: boolean } = {}): SnapResult {
  const s = useMapUi.getState();
  const free: SnapResult = { at: lngLat, kind: 'free' };
  if (opts.disable) return free;
  const mpp = s.mpp;
  const p = idx.frame.toMetric(lngLat) as geom.V;
  // Anywhere on a roundabout (ring or island): attach to the ring centre line at that bearing,
  // so a road drawn up to the ring becomes a new arm.
  if (s.snap.edge) {
    for (const rb of Object.values(idx.net.roundabouts)) {
      const c = idx.frame.toMetric(rb.center) as geom.V;
      const d = geom.sub(p, c);
      if (geom.len(d) > rb.outerDiameterM / 2 + 1.5) continue;
      const ang = Math.atan2(d[1], d[0]);
      const R = centreRadius(rb, ang);
      const onRing: geom.V = [c[0] + R * Math.cos(ang), c[1] + R * Math.sin(ang)];
      const r = idx.nearestRoad(onRing, 1.5);
      if (r && idx.net.roads[r.id]?.tags?.roundabout === rb.id) return { at: idx.frame.toLngLat(r.at), kind: 'edge', roadId: r.id, along: r.along };
    }
  }
  if (s.snap.node) {
    const n = idx.nearestNode(p, 12 * mpp);
    if (n) return { at: idx.net.nodes[n.id]!.at, kind: 'node', nodeId: n.id };
  }
  if (s.snap.edge) {
    const r = idx.nearestRoad(p, 9 * mpp);
    // Attaching a few metres from an existing junction would leave a road stub shorter than the
    // junction itself (the geometry folds): join the junction instead.
    const merge = Math.max(MERGE_M, 10 * mpp);
    if (r && (r.along < merge || r.length - r.along < merge)) {
      const road = idx.net.roads[r.id]!;
      const nid = r.along < merge ? road.from : road.to;
      return { at: idx.net.nodes[nid]!.at, kind: 'node', nodeId: nid };
    }
    if (r) {
      // Midpoint snap when close to the middle of the road.
      if (Math.abs(r.along - r.length / 2) < 8 * mpp) {
        const mid = geom.sampleAt(idx.axis(r.id), r.length / 2).p;
        return { at: idx.frame.toLngLat(mid), kind: 'midpoint', roadId: r.id, along: r.length / 2 };
      }
      return { at: idx.frame.toLngLat(r.at), kind: 'edge', roadId: r.id, along: r.along };
    }
  }
  let q = p;
  let kind: SnapResult['kind'] = 'free';
  if (opts.from && s.snap.angle) {
    const o = idx.frame.toMetric(opts.from) as geom.V;
    const v = geom.sub(q, o);
    const ang = Math.atan2(v[1], v[0]);
    const stepA = Math.PI / 12;
    const snapped = Math.round(ang / stepA) * stepA;
    if (Math.abs(snapped - ang) < (4 * Math.PI) / 180) {
      const L = geom.len(v);
      q = [o[0] + L * Math.cos(snapped), o[1] + L * Math.sin(snapped)];
      kind = 'angle';
    }
  }
  if (s.snap.grid) {
    const g = s.gridM;
    q = [Math.round(q[0] / g) * g, Math.round(q[1] / g) * g];
    kind = kind === 'angle' ? 'angle' : 'grid';
  }
  return { at: idx.frame.toLngLat(q), kind };
}
