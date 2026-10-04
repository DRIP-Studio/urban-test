import type { ModelPart } from '../api/types';

/**
 * Geometry of the catalogue's procedural parts, shared by the 2D plan symbol and the Twin.
 *
 * Conventions (item-local metres, x east, y north, z up):
 * - box: `size` [x, y, z]; cylinder / cone / frustum: `r` bottom radius, `r2` top radius (cone = 0), `h` height;
 *   without rotation `at` is the centre of the base, with `rot` it is the centre of the part.
 * - sphere (`r`) and ellipsoid (`size` = radii): `at` is always the centre.
 * - `rot` [rx, ry, rz] degrees, applied X, then Y, then Z, about the part centre.
 */
export type V3 = [number, number, number];
export interface Face { pts: V3[]; n: V3 }

const D = Math.PI / 180;

export function partCenter(p: ModelPart): V3 {
  const [x, y, z] = p.at;
  if (p.shape === 'sphere' || p.shape === 'ellipsoid' || p.rot) return [x, y, z];
  const h = p.shape === 'box' ? p.size?.[2] ?? 0.5 : p.h ?? 1;
  return [x, y, z + h / 2];
}

/** Row-major 3×3 rotation for rot [rx, ry, rz] (degrees), R = Rz · Ry · Rx. */
export function rotationMatrix(rot: readonly number[] | undefined): number[] {
  const [ax = 0, ay = 0, az = 0] = rot ?? [];
  const cx = Math.cos(ax * D), sx = Math.sin(ax * D), cy = Math.cos(ay * D), sy = Math.sin(ay * D), cz = Math.cos(az * D), sz = Math.sin(az * D);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

const mul = (m: number[], v: V3): V3 => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Faces centred on the origin, before rotation. */
function localFaces(p: ModelPart, seg: number): V3[][] {
  if (p.shape === 'box') {
    const [sx, sy, sz] = (p.size ?? [0.5, 0.5, 0.5]).map((v) => v / 2) as V3;
    const c = (i: number, j: number, k: number): V3 => [i ? sx : -sx, j ? sy : -sy, k ? sz : -sz];
    return [
      [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], [c(0, 1, 0), c(1, 1, 0), c(1, 0, 0), c(0, 0, 0)],
      [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], [c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)],
      [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], [c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)],
    ];
  }
  if (p.shape === 'sphere' || p.shape === 'ellipsoid') {
    const [rx, ry, rz] = p.shape === 'sphere' ? [p.r ?? 0.5, p.r ?? 0.5, (p.r ?? 0.5) * 0.9] : (p.size ?? [0.5, 0.5, 0.5]) as V3;
    const lat = Math.max(4, Math.round(seg / 2)), lon = seg;
    const pt = (i: number, j: number): V3 => { const th = (i / lat) * Math.PI - Math.PI / 2, ph = (j / lon) * Math.PI * 2; return [rx * Math.cos(th) * Math.cos(ph), ry * Math.cos(th) * Math.sin(ph), rz * Math.sin(th)]; };
    const out: V3[][] = [];
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) out.push([pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)]);
    return out;
  }
  const r = p.r ?? 0.2, r2 = p.shape === 'cone' ? 0 : p.r2 ?? r, h = (p.h ?? 1) / 2;
  const ring = (rr: number, z: number) => Array.from({ length: seg }, (_, j): V3 => [rr * Math.cos((j / seg) * Math.PI * 2), rr * Math.sin((j / seg) * Math.PI * 2), z]);
  const b = ring(r, -h), t = ring(r2, h);
  const out: V3[][] = [];
  for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg;
    out.push(r2 > 1e-4 ? [b[j]!, b[k]!, t[k]!, t[j]!] : [b[j]!, b[k]!, t[j]!]);
  }
  out.push([...b].reverse());
  if (r2 > 1e-4) out.push(t);
  return out;
}

/** World (item-local) faces with outward normals, rotation and placement applied. */
export function partFaces(p: ModelPart, seg = 14): Face[] {
  const m = rotationMatrix(p.rot);
  const c = partCenter(p);
  return localFaces(p, seg).map((poly) => {
    const pts = poly.map((q) => { const v = mul(m, q); return [v[0] + c[0], v[1] + c[1], v[2] + c[2]] as V3; });
    // Newell normal: robust for quads and n-gons; local faces are wound counter-clockwise from outside.
    let n: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
    if (Math.hypot(...n) < 1e-12 && pts.length >= 3) n = cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!));
    return { pts, n: norm(n) };
  });
}

/** Axis-aligned bounds of an item's parts (for checks and footprints). */
export function partsBounds(parts: readonly ModelPart[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (const f of partFaces(p, 8)) for (const q of f.pts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, q[k]!); max[k] = Math.max(max[k]!, q[k]!); }
  return { min, max };
}

/** Convex hull (monotone chain) of 2D points, counter-clockwise. */
export function hull2d(pts: readonly (readonly [number, number])[]): [number, number][] {
  const p = pts.map((q): [number, number] => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export interface PartPrint { ring: [number, number][]; base: number; top: number; mat: string }
const printCache = new WeakMap<readonly ModelPart[], PartPrint[]>();

/** Ground outline and height range of every part, for extrusions on the tilted 2D map (cached per item). */
export function partPrints(parts: readonly ModelPart[]): PartPrint[] {
  let out = printCache.get(parts);
  if (!out) {
    out = parts.flatMap((p): PartPrint[] => {
      if ((p.shape === 'sphere' || p.shape === 'ellipsoid') && !p.rot) {
        // Rounded volumes as stacked elliptical slices (fill-extrusion only makes prisms).
        const [rx, ry, rz] = p.shape === 'sphere' ? [p.r ?? 0.5, p.r ?? 0.5, (p.r ?? 0.5) * 0.9] : p.size ?? [0.5, 0.5, 0.5];
        const n = 5;
        return Array.from({ length: n }, (_, k) => {
          const z0 = -rz + (2 * rz * k) / n, z1 = z0 + (2 * rz) / n, zm = (z0 + z1) / 2;
          const f = Math.sqrt(Math.max(0.05, 1 - (zm / rz) ** 2));
          const ring = Array.from({ length: 16 }, (_, j): [number, number] => [p.at[0] + rx * f * Math.cos((j / 16) * Math.PI * 2), p.at[1] + ry * f * Math.sin((j / 16) * Math.PI * 2)]);
          return { ring, base: Math.max(0, p.at[2] + z0), top: p.at[2] + z1, mat: p.mat };
        });
      }
      const pts = partFaces(p, 10).flatMap((f) => f.pts);
      return [{ ring: hull2d(pts.map((q) => [q[0], q[1]] as const)), base: Math.max(0, Math.min(...pts.map((q) => q[2]))), top: Math.max(...pts.map((q) => q[2])), mat: p.mat }];
    }).filter((x) => x.ring.length >= 3 && x.top > 0.01);
    printCache.set(parts, out);
  }
  return out;
}
