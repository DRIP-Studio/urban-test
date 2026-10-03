import type { MaterialItem } from '../api/types';
import { patternImage } from './patterns';
import type { Map as MLMap } from 'maplibre-gl';

/** Images are generated or rasterised on demand (styleimagemissing) — never placeholders. */

function rasterizeSvg(url: string, size: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d')!;
      const ratio = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
      const w = (img.naturalWidth || size) * ratio, h = (img.naturalHeight || size) * ratio;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = () => reject(new Error(`Immagine non caricata: ${url}`));
    img.src = url;
  });
}

/** Vehicle signal head (Italian: red top, yellow, green bottom) or 3-aspect pedestrian/arrow heads. */
function signalImage(kind: string, state: string): ImageData {
  const W = 40, H = 96, s = 2;
  const c = document.createElement('canvas');
  c.width = W * s; c.height = H * s;
  const g = c.getContext('2d')!;
  g.scale(s, s);
  g.fillStyle = '#1c1d1f';
  g.strokeStyle = '#5a5e64';
  g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(4, 2, W - 8, H - 4, 6); g.fill(); g.stroke();
  const colors: Record<string, string> = { red: '#e5483a', yellow: '#f3b52f', green: '#3fc06a' };
  const order = ['red', 'yellow', 'green'];
  order.forEach((col, i) => {
    const cy = 18 + i * 30;
    const on = state === col;
    g.fillStyle = on ? colors[col]! : '#2c2e31';
    if (on) { g.shadowColor = colors[col]!; g.shadowBlur = 10; }
    g.beginPath(); g.arc(W / 2, cy, 11, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    if (kind !== 'vehicle') {
      g.strokeStyle = on ? '#141414' : '#55595e';
      g.fillStyle = on ? '#141414' : '#55595e';
      g.lineWidth = 2.4; g.lineCap = 'round';
      const x = W / 2, y = cy;
      g.beginPath();
      if (kind === 'pedestrian') { g.arc(x, y - 6, 2, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x, y + 3); g.moveTo(x, y + 3); g.lineTo(x - 3, y + 8); g.moveTo(x, y + 3); g.lineTo(x + 3, y + 8); g.moveTo(x - 4, y - 1); g.lineTo(x + 4, y - 1); }
      else if (kind === 'arrow_left') { g.moveTo(x + 6, y); g.lineTo(x - 6, y); g.moveTo(x - 6, y); g.lineTo(x - 1, y - 5); g.moveTo(x - 6, y); g.lineTo(x - 1, y + 5); }
      else if (kind === 'arrow_right') { g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x + 6, y); g.lineTo(x + 1, y - 5); g.moveTo(x + 6, y); g.lineTo(x + 1, y + 5); }
      else if (kind === 'arrow_straight') { g.moveTo(x, y + 6); g.lineTo(x, y - 6); g.moveTo(x, y - 6); g.lineTo(x - 5, y - 1); g.moveTo(x, y - 6); g.lineTo(x + 5, y - 1); }
      else if (kind === 'cycle') { g.arc(x - 4, y + 3, 3, 0, Math.PI * 2); g.moveTo(x + 7, y + 3); g.arc(x + 4, y + 3, 3, 0, Math.PI * 2); g.moveTo(x - 4, y + 3); g.lineTo(x, y - 3); g.lineTo(x + 4, y + 3); }
      else if (kind === 'bus') { g.moveTo(x - 6, y); g.lineTo(x + 6, y); }
      g.stroke();
    }
  });
  return g.getImageData(0, 0, W * s, H * s);
}

/** LED variable-message panel of a ZTL gate: amber dot-matrix text on black, red when active. */
function ledImage(state: string): ImageData {
  const W = 120, H = 64, s = 2;
  const c = document.createElement('canvas');
  c.width = W * s; c.height = H * s;
  const g = c.getContext('2d')!;
  g.scale(s, s);
  g.fillStyle = '#26282b'; g.beginPath(); g.roundRect(1, 1, W - 2, H - 2, 6); g.fill();
  g.fillStyle = '#050505'; g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 3); g.fill();
  const on = state === 'on';
  const col = on ? '#ff3b2f' : '#3fdc6a';
  g.shadowColor = col; g.shadowBlur = 6; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 20px "Ginto", system-ui, sans-serif'; g.fillText('ZTL', W / 2, 24);
  g.font = '700 11px "Ginto", system-ui, sans-serif'; g.fillText(on ? 'ATTIVA' : 'NON ATTIVA', W / 2, 44);
  g.shadowBlur = 0;
  // Dot-matrix grain.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 7; y < H - 7; y += 2) g.fillRect(7, y, W - 14, 0.6);
  return g.getImageData(0, 0, W * s, H * s);
}

/**
 * Generates signal heads and rasterizes sign SVGs on demand. MapLibre 6 awaits this resolver before
 * drawing, so icons appear on the first frame (a `styleimagemissing` listener can no longer do that).
 * Sign rasters are cached across style reloads; a failed fetch is retried on the next request.
 */
const signCache = new Map<string, Promise<ImageData>>();

export function installImageLoader(map: MLMap, materials: readonly MaterialItem[]): void {
  const byId = new Map(materials.map((m) => [m.id, m]));
  map.setMissingStyleImageResolver(async (id) => {
    if (map.hasImage(id)) return;
    if (id.startsWith('mat:')) {
      const [, mid = '', z = '18'] = id.split(':');
      const m = byId.get(mid);
      const img = m ? patternImage(m, Number(z)) : null;
      if (img) map.addImage(id, img, { pixelRatio: 2 });
      return;
    }
    if (id.startsWith('led:')) {
      map.addImage(id, ledImage(id.slice(4)), { pixelRatio: 2 });
      return;
    }
    if (id.startsWith('sig:')) {
      const [, kind = 'vehicle', state = 'off'] = id.split(':');
      map.addImage(id, signalImage(kind, state), { pixelRatio: 2 });
      return;
    }
    if (id.startsWith('it.sign.')) {
      const file = id.slice('it.sign.'.length);
      let p = signCache.get(file);
      if (!p) { p = rasterizeSvg(`/signs/${encodeURIComponent(file)}.svg`, 96); signCache.set(file, p); }
      try {
        const data = await p;
        if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: 2 });
      } catch {
        signCache.delete(file);
      }
    }
  });
}

export { signalImage, rasterizeSvg };
