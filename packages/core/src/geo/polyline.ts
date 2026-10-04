/** Planar geometry in the local metric frame (east, north). */
export type V = readonly [number, number];

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: V, b: V): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: V): number => Math.hypot(a[0], a[1]);
export const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export function unit(a: V): V {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
}
/** Left normal (counter-clockwise 90°). */
export const leftNormal = (u: V): V => [-u[1], u[0]];
export const angleOf = (u: V): number => Math.atan2(u[1], u[0]);

export function lengthOf(pts: readonly V[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/** Removes consecutive points closer than `eps` metres. */
export function dedupe(pts: readonly V[], eps = 0.01): V[] {
  const out: V[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1]!, p) > eps) out.push(p);
  return out;
}

/** Point and unit tangent at distance `d` along the polyline (clamped). */
export function sampleAt(pts: readonly V[], d: number): { p: V; t: V } {
  if (pts.length < 2) return { p: pts[0] ?? [0, 0], t: [1, 0] };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = dist(a, b);
    if (acc + seg >= d || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (d - acc) / seg)) : 0;
      return { p: lerp(a, b, t), t: unit(sub(b, a)) };
    }
    acc += seg;
  }
  return { p: pts[pts.length - 1]!, t: unit(sub(pts[pts.length - 1]!, pts[pts.length - 2]!)) };
}

/** Sub-polyline between distances [d0, d1] along the line. */
export function slice(pts: readonly V[], d0: number, d1: number): V[] {
  if (pts.length < 2 || d1 <= d0) return [];
  const out: V[] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = dist(a, b);
    const s0 = acc, s1 = acc + seg;
    if (s1 >= d0 && s0 <= d1 && seg > 0) {
      const ta = Math.max(0, (d0 - s0) / seg), tb = Math.min(1, (d1 - s0) / seg);
      if (!out.length) out.push(lerp(a, b, ta));
      out.push(lerp(a, b, tb));
    }
    acc = s1;
    if (acc > d1) break;
  }
  return dedupe(out, 1e-4);
}

/**
 * Offsets a polyline by `d` metres (positive = left of travel direction).
 * Miter joins, converted to a bevel when the miter would exceed `miterLimit`·|d|.
 */
export function offset(pts: readonly V[], d: number, miterLimit = 3): V[] {
  const p = dedupe(pts);
  if (p.length < 2 || d === 0) return [...p];
  const out: V[] = [];
  for (let i = 0; i < p.length; i++) {
    const prev = i > 0 ? unit(sub(p[i]!, p[i - 1]!)) : null;
    const next = i < p.length - 1 ? unit(sub(p[i + 1]!, p[i]!)) : null;
    if (!prev) { out.push(add(p[i]!, mul(leftNormal(next!), d))); continue; }
    if (!next) { out.push(add(p[i]!, mul(leftNormal(prev), d))); continue; }
    const n0 = leftNormal(prev), n1 = leftNormal(next);
    const bis = unit(add(n0, n1));
    const cosHalf = dot(bis, n1);
    if (cosHalf < 1e-3 || 1 / cosHalf > miterLimit) {
      out.push(add(p[i]!, mul(n0, d)), add(p[i]!, mul(n1, d)));
    } else {
      out.push(add(p[i]!, mul(bis, d / cosHalf)));
    }
  }
  return out;
}

/** Closed ring for the band between offsets `left` and `right` (left > right). */
export function band(pts: readonly V[], left: number, right: number): V[] {
  const l = offset(pts, left);
  const r = offset(pts, right);
  return [...l, ...r.reverse()];
}

/** Intersection of lines p + s·u and q + t·v. Returns null when parallel. */
export function intersectLines(p: V, u: V, q: V, v: V): { s: number; t: number; at: V } | null {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(q, p);
  const s = cross(w, v) / den;
  const t = cross(w, u) / den;
  return { s, t, at: add(p, mul(u, s)) };
}

/** Quadratic Bézier from a to b with control c, sampled with `n` segments. */
export function quadBezier(a: V, c: V, b: V, n = 8): V[] {
  const out: V[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, m = 1 - t;
    out.push([m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]]);
  }
  return out;
}

export function ringArea(ring: readonly V[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += cross(ring[j]!, ring[i]!);
  return a / 2;
}

/** Arc points on a circle, angles in radians, counter-clockwise from a0 to a1. */
export function arc(center: V, r: number, a0: number, a1: number, stepRad = Math.PI / 48): V[] {
  let end = a1;
  while (end < a0) end += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((end - a0) / stepRad));
  const out: V[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((end - a0) * i) / n;
    out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return out;
}

export function circle(center: V, r: number, n = 96): V[] {
  const out: V[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Shortest distance from p to the polyline, with the distance along it. */
export function project(pts: readonly V[], p: V): { d: number; along: number; at: V } {
  let best = { d: Infinity, along: 0, at: pts[0] ?? p };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const at = add(a, mul(ab, t));
    const d = dist(p, at);
    if (d < best.d) best = { d, along: acc + Math.sqrt(l2) * t, at };
    acc += Math.sqrt(l2);
  }
  return best;
}

/**
 * Outline of the area within `radius` of a set of polylines (metric), as one simple ring: the cells of
 * a grid (step ≈ radius / 3) covered by the buffer are traced along their outer boundary and simplified.
 * Unlike a convex hull it follows the streets (a ZTL "around Via Roma" stays a corridor).
 */
export function bufferOutline(lines: readonly (readonly V[])[], radius: number): V[] {
  const step = Math.max(1, radius / 3);
  const pts = lines.flat();
  if (!pts.length) return [];
  const minX = Math.min(...pts.map((p) => p[0])) - radius - step, minY = Math.min(...pts.map((p) => p[1])) - radius - step;
  const maxX = Math.max(...pts.map((p) => p[0])) + radius + step, maxY = Math.max(...pts.map((p) => p[1])) + radius + step;
  const W = Math.ceil((maxX - minX) / step), H = Math.ceil((maxY - minY) / step);
  if (W * H > 4_000_000) return [];
  const grid = new Uint8Array(W * H);
  const r2 = radius * radius;
  for (const line of lines) for (let i = 0; i < line.length; i++) {
    const a = line[i]!, b = line[Math.min(i + 1, line.length - 1)]!;
    const x0 = Math.floor((Math.min(a[0], b[0]) - radius - minX) / step), x1 = Math.ceil((Math.max(a[0], b[0]) + radius - minX) / step);
    const y0 = Math.floor((Math.min(a[1], b[1]) - radius - minY) / step), y1 = Math.ceil((Math.max(a[1], b[1]) + radius - minY) / step);
    const d = sub(b, a), L2 = d[0] * d[0] + d[1] * d[1];
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const c: V = [minX + (x + 0.5) * step, minY + (y + 0.5) * step];
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1]) / L2)) : 0;
      const q: V = [a[0] + d[0] * t - c[0], a[1] + d[1] * t - c[1]];
      if (q[0] * q[0] + q[1] * q[1] <= r2) grid[y * W + x] = 1;
    }
  }
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? grid[y * W + x]! : 0);
  // Directed boundary edges (filled cell on the left), keyed by start corner.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (W + 1) + x;
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); (next.get(k) ?? next.set(k, []).get(k)!).push(key(x1, y1)); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!at(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) addEdge(x, y + 1, x, y);
  }
  // Trace every loop, keep the longest (outer boundary of the largest component).
  let best: number[] = [];
  const used = new Set<string>();
  for (const [start, outs] of next) for (const first of outs) {
    if (used.has(`${start}>${first}`)) continue;
    const loop = [start];
    let prev = start, cur = first;
    used.add(`${start}>${first}`);
    while (cur !== start && loop.length < 1e6) {
      loop.push(cur);
      const cands = (next.get(cur) ?? []).filter((n) => !used.has(`${cur}>${n}`));
      if (!cands.length) break;
      const nx = cands[0]!;
      used.add(`${cur}>${nx}`);
      prev = cur; cur = nx;
    }
    void prev;
    if (loop.length > best.length) best = loop;
  }
  const ring = best.map((k): V => [minX + (k % (W + 1)) * step, minY + Math.floor(k / (W + 1)) * step]);
  return simplifyRing(ring, step * 0.8);
}

/** Douglas–Peucker on a closed ring. */
export function simplifyRing(ring: readonly V[], tol: number): V[] {
  if (ring.length < 5) return [...ring];
  const dp = (pts: readonly V[]): V[] => {
    if (pts.length < 3) return [...pts];
    const a = pts[0]!, b = pts[pts.length - 1]!;
    let idx = 0, dmax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = project([a, b], pts[i]!).d;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax <= tol) return [a, b];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  const half = Math.floor(ring.length / 2);
  const out = [...dp(ring.slice(0, half + 1)).slice(0, -1), ...dp([...ring.slice(half), ring[0]!]).slice(0, -1)];
  return out.length >= 3 ? out : [...ring];
}

/** True when a closed ring crosses itself (O(n²), for small rings such as junction corners). */
export function ringSelfIntersects(ring: readonly V[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = ring[j]!, d = ring[(j + 1) % n]!;
      const h = intersectLines(a, sub(b, a), c, sub(d, c));
      if (h && h.s > 1e-6 && h.s < 1 - 1e-6 && h.t > 1e-6 && h.t < 1 - 1e-6) return true;
    }
  }
  return false;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: readonly V[]): V[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V[] = [], hi: V[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Point-in-polygon (even–odd), any orientation; points on the boundary may go either way. */
export function pointInRing(p: V, ring: readonly V[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Ear-clipping triangulation of a simple ring (any orientation, closing point optional).
 * Degenerate (collinear) ears are dropped; a ring that is not simple is triangulated as far as possible.
 */
export function triangulate(ring: readonly V[]): [V, V, V][] {
  let pts = dedupe(ring, 1e-6);
  if (pts.length > 1 && dist(pts[0]!, pts[pts.length - 1]!) <= 1e-6) pts = pts.slice(0, -1);
  if (pts.length < 3) return [];
  if (ringArea(pts) < 0) pts = [...pts].reverse();
  const idx = pts.map((_, i) => i);
  const out: [V, V, V][] = [];
  const cr = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 4 * pts.length * pts.length) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]!, ib = idx[k]!, ic = idx[(k + 1) % idx.length]!;
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!;
      const turn = cr(a, b, c);
      if (turn < 0) continue;
      if (turn > 1e-12) {
        let blocked = false;
        for (const iv of idx) {
          if (iv === ia || iv === ib || iv === ic) continue;
          const v = pts[iv]!;
          if (cr(a, b, v) >= 0 && cr(b, c, v) >= 0 && cr(c, a, v) >= 0) { blocked = true; break; }
        }
        if (blocked) continue;
        out.push([a, b, c]);
      }
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    const [a, b, c] = idx.map((i) => pts[i]!) as [V, V, V];
    if (Math.abs(cr(a, b, c)) > 1e-12) out.push([a, b, c]);
  }
  return out;
}

/** Area of the intersection of two convex counter-clockwise polygons (Sutherland–Hodgman). */
export function convexIntersectionArea(subject: readonly V[], clip: readonly V[]): number {
  let poly: V[] = [...subject];
  for (let i = 0; i < clip.length && poly.length; i++) {
    const a = clip[i]!, b = clip[(i + 1) % clip.length]!;
    const side = (p: V) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const next: V[] = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j]!, q = poly[(j + 1) % poly.length]!;
      const sp = side(p), sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) next.push(lerp(p, q, sp / (sp - sq)));
    }
    poly = next;
  }
  return poly.length >= 3 ? Math.abs(ringArea(poly)) : 0;
}

/** Area (m²) of the intersection of two simple polygons, via their triangulations. Shared edges count zero. */
export function polygonIntersectionArea(a: readonly V[], b: readonly V[]): number {
  const box = (r: readonly V[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1] as const;
  };
  const A = box(a), B = box(b);
  if (A[0] > B[2] || B[0] > A[2] || A[1] > B[3] || B[1] > A[3]) return 0;
  const ta = triangulate(a).map((t) => ({ t, b: box(t) }));
  const tb = triangulate(b).map((t) => ({ t, b: box(t) }));
  let s = 0;
  for (const x of ta) for (const y of tb) {
    if (x.b[0] > y.b[2] || y.b[0] > x.b[2] || x.b[1] > y.b[3] || y.b[1] > x.b[3]) continue;
    s += convexIntersectionArea(x.t, y.t);
  }
  return s;
}
