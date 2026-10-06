/**
 * LED panels drawn once for the 2D map and the Twin: PMV (amber dot-matrix, art. 78 Reg. CdS) with an
 * optional danger pictogram, and the ZTL gate panel (red «attiva» / green «non attiva»).
 * Text pages are separated by an empty line: the map and the Twin show them in turn.
 */
export const VMS_PAGE_MS = 3000;
export const VMS_LINES = 3, VMS_CHARS = 16, VMS_PAGES = 4;

export function vmsPages(text: string): string[] {
  const pages = text.split(/\n\s*\n/).map((p) => p.split('\n').filter((l) => l.trim()).slice(0, VMS_LINES).join('\n')).filter(Boolean);
  return pages.length ? pages.slice(0, VMS_PAGES) : [''];
}

/** Page shown at time `now` (all panels change together, like a real coordinated system). */
export const vmsPageAt = (text: string, now = Date.now()): string => { const p = vmsPages(text); return p[Math.floor(now / VMS_PAGE_MS) % p.length]!; };

export type VmsPictogram = 'none' | 'danger' | 'works' | 'queue' | 'ice';

function frame(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.fillStyle = '#26282b'; g.beginPath(); g.roundRect(1, 1, W - 2, H - 2, 6); g.fill();
  g.fillStyle = '#050505'; g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 3); g.fill();
}

/** Dot-matrix grain: the pixel grid of a real LED panel. */
function grain(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.fillStyle = 'rgba(0,0,0,0.42)';
  for (let y = 7; y < H - 7; y += 2) g.fillRect(7, y, W - 14, 0.7);
  for (let x = 7; x < W - 7; x += 2) g.fillRect(x, 7, 0.5, H - 14);
}

/** Danger triangle (fig. II.35-like outline) with a symbol, drawn in LEDs: red rim, amber symbol. */
function pictogram(g: CanvasRenderingContext2D, kind: VmsPictogram, x: number, y: number, s: number): void {
  if (kind === 'none') return;
  g.save();
  g.shadowBlur = 5; g.shadowColor = '#ff3b2f';
  g.strokeStyle = '#ff3b2f'; g.lineWidth = 3; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x + s / 2, y); g.lineTo(x + s, y + s * 0.88); g.lineTo(x, y + s * 0.88); g.closePath(); g.stroke();
  g.shadowColor = '#ffb020'; g.fillStyle = '#ffb020'; g.strokeStyle = '#ffb020';
  const cx = x + s / 2, cy = y + s * 0.58;
  if (kind === 'danger') { g.fillRect(cx - 1.5, cy - 9, 3, 9); g.fillRect(cx - 1.5, cy + 3, 3, 3); }
  if (kind === 'works') { g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx - 7, cy + 7); g.lineTo(cx + 2, cy - 6); g.moveTo(cx + 2, cy - 6); g.lineTo(cx + 7, cy - 3); g.stroke(); g.beginPath(); g.arc(cx - 4, cy - 6, 2.5, 0, Math.PI * 2); g.fill(); }
  if (kind === 'queue') { for (let i = 0; i < 3; i++) g.fillRect(cx - 8 + i * 6, cy + 1 - i * 3, 5, 4); }
  if (kind === 'ice') { g.lineWidth = 2; for (let a = 0; a < 3; a++) { const t = (a * Math.PI) / 3; g.beginPath(); g.moveTo(cx - Math.cos(t) * 7, cy - Math.sin(t) * 7); g.lineTo(cx + Math.cos(t) * 7, cy + Math.sin(t) * 7); g.stroke(); } }
  g.restore();
}

/** PMV face (`scale` = canvas pixels per unit; units ≈ CSS px of the 2D icon). */
export function vmsCanvas(text: string, pic: VmsPictogram = 'none', scale = 2): HTMLCanvasElement {
  const lines = text.split('\n').slice(0, VMS_LINES);
  const withPic = pic !== 'none';
  const W = withPic ? 190 : 150, H = 26 + Math.max(lines.length, 2) * 17;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  frame(g, W, H);
  if (withPic) pictogram(g, pic, 12, H / 2 - 17, 34);
  g.shadowColor = '#ffb020'; g.shadowBlur = 5; g.fillStyle = '#ffb020'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 12px "Ginto", system-ui, sans-serif';
  const left = withPic ? 52 : 6, width = W - left - 6;
  const top = H / 2 - ((lines.length - 1) * 17) / 2;
  lines.forEach((l, i) => g.fillText(l, left + width / 2, top + i * 17, width - 10));
  g.shadowBlur = 0;
  grain(g, W, H);
  return c;
}

/** ZTL gate panel. */
export function ledCanvas(on: boolean, scale = 2): HTMLCanvasElement {
  const W = 120, H = 64;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  frame(g, W, H);
  const col = on ? '#ff3b2f' : '#3fdc6a';
  g.shadowColor = col; g.shadowBlur = 6; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 20px "Ginto", system-ui, sans-serif'; g.fillText('ZTL', W / 2, 24);
  g.font = '700 11px "Ginto", system-ui, sans-serif'; g.fillText(on ? 'VARCO ATTIVO' : 'VARCO NON ATTIVO', W / 2, 44, W - 16);
  g.shadowBlur = 0;
  grain(g, W, H);
  return c;
}

export const canvasData = (c: HTMLCanvasElement): ImageData => c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
