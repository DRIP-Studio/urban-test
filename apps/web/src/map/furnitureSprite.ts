import type { FurnitureItem, MaterialItem } from '../api/types';
import { hull2d as hull, partFaces, type V3 } from '../models/parts';

/**
 * Plan symbol with volume for every catalogue item ("3D anche in 2D"): the same parts used by the Twin,
 * turned into faces and drawn in cabinet projection — top lifted up-left by its height, faces shaded by a
 * light from the north-west, painter's order, soft cast shadow on the ground. Drawn at real scale:
 * PX_PER_M pixels per metre at pixelRatio 2, so the map can size it in metres.
 */
export const PX_PER_M = 40;
const LIFT = 0.26; // cabinet projection: screen offset per metre of height (up-left)
const MAX = 512;
const VIEW: V3 = (() => { const v: V3 = [LIFT, -LIFT, 1]; const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; })();
const LIGHT: V3 = (() => { const v: V3 = [-0.45, 0.55, 1]; const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; })();
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(c: [number, number, number], k: number, alpha = 1): string {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return alpha < 1 ? `rgba(${f(c[0])}, ${f(c[1])}, ${f(c[2])}, ${alpha})` : `rgb(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
}

export function furnitureSprite(item: FurnitureItem, materials: ReadonlyMap<string, MaterialItem>, materialOverride?: string): ImageData | null {
  const { w, d, h } = item.dims;
  // Canvas covers the footprint plus the lifted top and the shadow.
  const pad = Math.max(w, d) * 0.15 + h * Math.max(LIFT, 0.35) + 0.6;
  const spanX = w + 2 * pad, spanY = d + 2 * pad;
  let px = PX_PER_M;
  if (Math.max(spanX, spanY) * px > MAX) px = MAX / Math.max(spanX, spanY);
  const W = Math.max(8, Math.ceil(spanX * px)), H = Math.max(8, Math.ceil(spanY * px));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  const cx = W / 2, cy = H / 2;
  // Model x → east (screen right), y → north (screen up), z → height.
  const at = (q: V3): [number, number] => [cx + (q[0] - q[2] * LIFT) * px, cy - (q[1] + q[2] * LIFT) * px];
  const color = (mat: string) => rgb(materials.get(mat === 'foliage' && materialOverride ? materialOverride : mat)?.color ?? '#9a948a');
  const glass = (mat: string) => mat === 'glass' || mat === 'water';
  const seg = Math.max(8, Math.min(18, Math.round(Math.max(w, d) * px / 6)));
  const parts = item.model.map((p) => ({ p, faces: partFaces(p, seg) }));

  // 1. Cast shadow: each part's vertices dropped to the ground and pushed south-east by their height.
  g.save();
  g.filter = `blur(${Math.max(1, px * 0.1)}px)`;
  g.fillStyle = 'rgba(20, 18, 15, 0.26)';
  for (const { p, faces } of parts) {
    if (glass(p.mat)) continue;
    const pts = faces.flatMap((f) => f.pts.map((q): [number, number] => [cx + (q[0] + q[2] * 0.35) * px, cy - (q[1] - q[2] * 0.35) * px]));
    const hl = hull(pts);
    if (hl.length < 3) continue;
    g.beginPath(); g.moveTo(...hl[0]!); for (const q of hl.slice(1)) g.lineTo(...q); g.closePath(); g.fill();
  }
  g.restore();

  // 2. Visible faces of all parts, far to near.
  const faces = parts.flatMap(({ p, faces: fs }) => fs.filter((f) => dot(f.n, VIEW) > 1e-3).map((f) => ({
    f, p, depth: f.pts.reduce((s, q) => s + dot(q, VIEW), 0) / f.pts.length,
  }))).sort((a, b) => a.depth - b.depth);
  g.lineJoin = 'round';
  g.lineWidth = Math.max(0.5, px * 0.012);
  for (const { f, p } of faces) {
    const k = 0.58 + 0.55 * Math.max(0, dot(f.n, LIGHT));
    const a = glass(p.mat) ? 0.45 : 1;
    const fill = shade(color(p.mat), k, a);
    g.beginPath();
    const q0 = at(f.pts[0]!); g.moveTo(...q0);
    for (const q of f.pts.slice(1)) g.lineTo(...at(q));
    g.closePath();
    g.fillStyle = fill; g.fill();
    // Hairline in the face colour closes anti-aliasing seams; boxes get a darker edge for definition.
    g.strokeStyle = p.shape === 'box' && f.pts.length === 4 ? shade(color(p.mat), k * 0.7, a) : fill;
    g.stroke();
  }
  if (item.category === 'vegetation') {
    // Canopy texture: darker clumps on the crowns.
    g.fillStyle = 'rgba(0, 0, 0, 0.07)';
    for (const { p } of parts) {
      if (p.shape !== 'sphere' && p.shape !== 'ellipsoid') continue;
      const r = p.r ?? p.size?.[0] ?? 1;
      const [sx, sy] = at([p.at[0], p.at[1], p.at[2] + r * 0.4]);
      for (let k = 0; k < 7; k++) { const an = (k / 7) * Math.PI * 2; g.beginPath(); g.arc(sx + Math.cos(an) * r * px * 0.5, sy + Math.sin(an) * r * px * 0.5, r * px * 0.26, 0, Math.PI * 2); g.fill(); }
    }
  }
  return g.getImageData(0, 0, W, H);
}
