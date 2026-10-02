import type { MaterialItem } from '../api/types';

/**
 * Procedural paving textures at real-world scale.
 *
 * MapLibre fill patterns are screen-space, so each material is drawn once per zoom step with the
 * pixels-per-metre of that zoom (Frattamaggiore latitude): a 10 cm sett stays 10 cm at 18, 19, 20, 21.
 * The same canvases feed the Twin as material images. Deterministic (seeded) so tiles never flicker.
 */

export const PATTERN_ZOOMS = [18, 19, 20, 21, 22] as const;
const LAT = 40.94;
/** Device pixels per metre at a zoom (pattern images are registered with pixelRatio 2). */
const pxPerM = (z: number) => (2 * 2 ** z) / (78271.52 * Math.cos((LAT * Math.PI) / 180)); // MapLibre: 512 px tiles

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}
const hash = (str: string) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

type Painter = (g: CanvasRenderingContext2D, W: number, H: number, ppm: number, base: string, r: () => number) => void;

/** Tile size in metres per pattern (one repeat). */
const TILE_M: Record<string, [number, number]> = {
  setts: [0.6, 0.6], sampietrini: [0.6, 0.6], slabs: [1.2, 0.8], pavers: [0.8, 0.4], pavers_open: [0.8, 0.8],
  brick: [0.8, 0.8], noise: [1, 1], grass: [1, 1], gravel: [0.5, 0.5], planks: [1.2, 0.6],
  tactile_warning: [0.6, 0.6], tactile_direction: [0.6, 0.6], cobbles: [0.8, 0.8],
};

const grain = (g: CanvasRenderingContext2D, W: number, H: number, r: () => number, alpha: number, n: number) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha * r()})` : `rgba(0,0,0,${alpha * r()})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
  }
};

const PAINT: Record<string, Painter> = {
  noise(g, W, H, _ppm, base, r) { g.fillStyle = base; g.fillRect(0, 0, W, H); grain(g, W, H, r, 0.16, W * H * 0.08); },
  setts(g, W, H, ppm, base, r) {
    // 10 cm porphyry/basalt cubes in fan-free grid with 1 cm joints.
    const s = 0.1 * ppm, j = Math.max(1, 0.012 * ppm);
    g.fillStyle = shade(base, 0.62); g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += s) for (let x = (Math.floor(y / s) % 2) * s * 0.5 - s; x < W; x += s) {
      g.fillStyle = shade(base, 0.85 + r() * 0.3);
      g.fillRect(x + j / 2, y + j / 2, s - j, s - j);
    }
    grain(g, W, H, r, 0.1, W * H * 0.03);
  },
  sampietrini(g, W, H, ppm, base, r) { PAINT.setts!(g, W, H, ppm * 1.2, base, r); },
  cobbles(g, W, H, ppm, base, r) {
    const s = 0.16 * ppm;
    g.fillStyle = shade(base, 0.55); g.fillRect(0, 0, W, H);
    for (let y = 0; y < H + s; y += s * 0.85) for (let x = 0; x < W + s; x += s) {
      g.fillStyle = shade(base, 0.8 + r() * 0.35);
      g.beginPath(); g.ellipse(x + (r() - 0.5) * s * 0.2, y + (r() - 0.5) * s * 0.2, s * 0.44, s * 0.38, r() * 3, 0, Math.PI * 2); g.fill();
    }
  },
  slabs(g, W, H, ppm, base, r) {
    // 60 × 40 cm stone slabs, staggered rows.
    const w = 0.6 * ppm, h = 0.4 * ppm, j = Math.max(1, 0.006 * ppm);
    g.fillStyle = shade(base, 0.72); g.fillRect(0, 0, W, H);
    for (let row = 0, y = 0; y < H; row++, y += h) for (let x = (row % 2) * w * 0.5 - w; x < W; x += w) {
      g.fillStyle = shade(base, 0.93 + r() * 0.12);
      g.fillRect(x + j, y + j, w - j, h - j);
    }
    grain(g, W, H, r, 0.08, W * H * 0.04);
  },
  pavers(g, W, H, ppm, base, r) {
    // 20 × 10 cm concrete pavers, running bond.
    const w = 0.2 * ppm, h = 0.1 * ppm, j = Math.max(1, 0.005 * ppm);
    g.fillStyle = shade(base, 0.7); g.fillRect(0, 0, W, H);
    for (let row = 0, y = 0; y < H; row++, y += h) for (let x = (row % 2) * w * 0.5 - w; x < W; x += w) {
      g.fillStyle = shade(base, 0.92 + r() * 0.14);
      g.fillRect(x + j, y + j, w - j, h - j);
    }
  },
  pavers_open(g, W, H, ppm, base, r) {
    // Drainage pavers with green joints.
    const s = 0.2 * ppm, j = 0.025 * ppm;
    g.fillStyle = '#6f8f52'; g.fillRect(0, 0, W, H);
    grain(g, W, H, r, 0.25, W * H * 0.05);
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      g.fillStyle = shade(base, 0.9 + r() * 0.15);
      g.fillRect(x + j, y + j, s - 2 * j, s - 2 * j);
    }
  },
  brick(g, W, H, ppm, base, r) {
    // Herringbone, 20 × 10 cm.
    const u = 0.1 * ppm, j = Math.max(1, 0.006 * ppm);
    g.fillStyle = shade(base, 0.68); g.fillRect(0, 0, W, H);
    for (let y = -4 * u; y < H + 4 * u; y += 2 * u) for (let x = -4 * u; x < W + 4 * u; x += 2 * u) {
      const k = (Math.round(x / (2 * u)) + Math.round(y / (2 * u))) % 2;
      g.fillStyle = shade(base, 0.88 + r() * 0.2);
      if (k === 0) g.fillRect(x + j, y + j, 2 * u - j, u - j); else g.fillRect(x + j, y + j, u - j, 2 * u - j);
    }
  },
  grass(g, W, H, ppm, base, r) {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < W * H * 0.02; i++) {
      const x = r() * W, y = r() * H;
      g.strokeStyle = shade(base, 0.75 + r() * 0.5); g.lineWidth = Math.max(1, ppm * 0.006);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * ppm * 0.03, y - ppm * 0.03); g.stroke();
    }
  },
  gravel(g, W, H, ppm, base, r) {
    g.fillStyle = shade(base, 0.85); g.fillRect(0, 0, W, H);
    for (let i = 0; i < W * H * 0.06; i++) {
      g.fillStyle = shade(base, 0.7 + r() * 0.6);
      g.beginPath(); g.arc(r() * W, r() * H, Math.max(0.6, ppm * (0.006 + r() * 0.008)), 0, Math.PI * 2); g.fill();
    }
  },
  planks(g, W, H, ppm, base, r) {
    const h = 0.12 * ppm, j = Math.max(1, 0.008 * ppm);
    g.fillStyle = shade(base, 0.6); g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += h) { g.fillStyle = shade(base, 0.85 + r() * 0.25); g.fillRect(0, y + j / 2, W, h - j); }
  },
  tactile_warning(g, W, H, ppm, base) {
    // LOGES "attenzione/pericolo valicabile": truncated domes, 5 cm pitch.
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const p = 0.05 * ppm;
    for (let y = p / 2; y < H; y += p) for (let x = p / 2; x < W; x += p) {
      g.fillStyle = shade(base, 1.12); g.beginPath(); g.arc(x, y, p * 0.32, 0, Math.PI * 2); g.fill();
      g.fillStyle = shade(base, 0.8); g.beginPath(); g.arc(x + p * 0.06, y + p * 0.06, p * 0.32, 0, Math.PI); g.fill();
    }
  },
  tactile_direction(g, W, H, ppm, base) {
    // LOGES "rettilineo": raised parallel ribs.
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const p = 0.06 * ppm;
    for (let x = p / 2; x < W; x += p) { g.fillStyle = shade(base, 1.15); g.fillRect(x - p * 0.18, 0, p * 0.36, H); g.fillStyle = shade(base, 0.82); g.fillRect(x + p * 0.18, 0, p * 0.06, H); }
  },
};

/** Image for material `m` at zoom `z`, or null if the material is drawn flat. */
export function patternImage(m: MaterialItem, z: number): ImageData | null {
  const paint = PAINT[m.pattern];
  const tile = TILE_M[m.pattern];
  if (!paint || !tile) return null;
  const ppm = pxPerM(z);
  // Several repeats per image so the random variation does not tile visibly; capped for memory.
  const reps = Math.max(1, Math.min(4, Math.floor(256 / (tile[0] * ppm))));
  const W = Math.max(8, Math.min(512, Math.round(tile[0] * ppm * reps)));
  const H = Math.max(8, Math.min(512, Math.round(tile[1] * ppm * reps)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  paint(g, W, H, ppm, m.color, rng(hash(`${m.id}:${z}`)));
  return g.getImageData(0, 0, W, H);
}

/** Patterns that have a painter (anything else is drawn as flat colour). */
export const PATTERNS: ReadonlySet<string> = new Set(Object.keys(PAINT));

export const patternId = (materialId: string, z: number) => `mat:${materialId}:${z}`;
