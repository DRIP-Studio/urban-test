import type { FurnitureItem, MaterialItem, ModelPart } from '../api/types';

/**
 * Plan symbol with volume for every catalogue item ("3D anche in 2D"): the same parts used by the Twin
 * (box, cylinder, sphere, cone) drawn in cabinet projection — the top face lifted up-left by its height,
 * the visible sides shaded, a soft cast shadow on the ground. Drawn at real scale: PX_PER_M pixels per
 * metre at pixelRatio 2, so the map can size it in metres.
 */
export const PX_PER_M = 40;
const LIFT = 0.26; // cabinet projection: screen offset per metre of height (up-left)
const MAX = 512;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

interface Placed { part: ModelPart; top: number }

export function furnitureSprite(item: FurnitureItem, materials: ReadonlyMap<string, MaterialItem>, materialOverride?: string): ImageData | null {
  const { w, d, h } = item.dims;
  // Canvas covers the footprint plus the lifted top and the shadow.
  const pad = Math.max(w, d) * 0.15 + h * LIFT + 0.6;
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
  const at = (x: number, y: number, z: number): [number, number] => [cx + (x - z * LIFT) * px, cy - (y + z * LIFT) * px];
  const color = (mat: string) => {
    const id = mat === 'foliage' && materialOverride ? materialOverride : mat;
    return materials.get(id)?.color ?? '#9a948a';
  };

  // 1. Cast shadow: footprint of every part, offset to the south-east, blurred.
  g.save();
  g.filter = `blur(${Math.max(1, px * 0.12)}px)`;
  g.fillStyle = 'rgba(20, 18, 15, 0.28)';
  for (const p of item.model) {
    const top = p.at[2] + (p.shape === 'sphere' ? (p.r ?? 0.5) * 2 : p.h ?? p.size?.[2] ?? 0.5);
    const off = top * 0.35 * px;
    g.beginPath();
    if (p.shape === 'box' && p.size) g.rect(cx + (p.at[0] - p.size[0] / 2) * px + off, cy - (p.at[1] + p.size[1] / 2) * px + off, p.size[0] * px, p.size[1] * px);
    else g.ellipse(cx + p.at[0] * px + off, cy - p.at[1] * px + off, (p.r ?? 0.3) * px, (p.r ?? 0.3) * px, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // 2. Parts, lowest top first so taller parts overlap.
  const placed: Placed[] = item.model.map((part) => ({ part, top: part.at[2] + (part.shape === 'sphere' ? (part.r ?? 0.5) * 2 : part.h ?? part.size?.[2] ?? 0.5) }))
    .sort((a, b) => a.top - b.top);
  for (const { part: p } of placed) {
    const base = color(p.mat);
    const [x, y, z] = p.at;
    g.lineWidth = Math.max(0.6, px * 0.02);
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    if (p.shape === 'box' && p.size) {
      const [sx, sy, sz] = p.size;
      const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z1 = z + sz;
      const quad = (pts: [number, number][], fill: string) => { g.beginPath(); g.moveTo(...pts[0]!); for (const q of pts.slice(1)) g.lineTo(...q); g.closePath(); g.fillStyle = fill; g.fill(); g.stroke(); };
      // Visible sides in cabinet view (lift up-left): south and east faces.
      quad([at(x0, y0, z), at(x1, y0, z), at(x1, y0, z1), at(x0, y0, z1)], shade(base, 0.72));
      quad([at(x1, y0, z), at(x1, y1, z), at(x1, y1, z1), at(x1, y0, z1)], shade(base, 0.6));
      quad([at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], shade(base, 1.08));
    } else if (p.shape === 'cylinder' || p.shape === 'cone') {
      const r = p.r ?? 0.2, hh = p.h ?? 1;
      const [bx, by] = at(x, y, z), [tx, ty] = at(x, y, z + hh);
      // Side band between base and top circle.
      const grad = g.createLinearGradient(bx - r * px, by, bx + r * px, by);
      grad.addColorStop(0, shade(base, 0.95)); grad.addColorStop(0.5, shade(base, 0.8)); grad.addColorStop(1, shade(base, 0.55));
      g.fillStyle = grad;
      g.beginPath();
      const ang = Math.atan2(ty - by, tx - bx) + Math.PI / 2;
      const tr = p.shape === 'cone' ? 0.02 : r;
      g.moveTo(bx + Math.cos(ang) * r * px, by + Math.sin(ang) * r * px);
      g.lineTo(tx + Math.cos(ang) * tr * px, ty + Math.sin(ang) * tr * px);
      g.lineTo(tx - Math.cos(ang) * tr * px, ty - Math.sin(ang) * tr * px);
      g.lineTo(bx - Math.cos(ang) * r * px, by - Math.sin(ang) * r * px);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(bx, by, r * px, 0, Math.PI * 2); g.fill();
      if (p.shape === 'cylinder') {
        g.beginPath(); g.arc(tx, ty, r * px, 0, Math.PI * 2); g.fillStyle = shade(base, 1.12); g.fill(); g.stroke();
      }
    } else if (p.shape === 'sphere') {
      const r = p.r ?? 0.5;
      const [sx, sy] = at(x, y, z + r);
      const grad = g.createRadialGradient(sx - r * px * 0.35, sy - r * px * 0.35, r * px * 0.1, sx, sy, r * px);
      grad.addColorStop(0, shade(base, 1.3)); grad.addColorStop(0.65, shade(base, 0.95)); grad.addColorStop(1, shade(base, 0.62));
      g.fillStyle = grad;
      g.beginPath(); g.arc(sx, sy, r * px, 0, Math.PI * 2); g.fill();
      if (item.category === 'vegetation') {
        // Canopy texture: a few darker clumps.
        g.fillStyle = 'rgba(0, 0, 0, 0.08)';
        for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; g.beginPath(); g.arc(sx + Math.cos(a) * r * px * 0.5, sy + Math.sin(a) * r * px * 0.5, r * px * 0.28, 0, Math.PI * 2); g.fill(); }
      }
    }
  }
  return g.getImageData(0, 0, W, H);
}
