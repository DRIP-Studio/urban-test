// Vectorizes the official raster logos into per-colour SVG layers.
// Usage: node tools/brand/vectorize.cjs
// Colours are the ones measured on the official files (see DESIGN-SYSTEM.md).
const path = require('node:path');
const fs = require('node:fs');
const Jimp = require('jimp');
const potrace = require('potrace');

const SRC = path.join(__dirname, '../../packages/assets/brand/source');
const OUT = path.join(__dirname, '../../packages/assets/brand');

const FST_RED = '#8B0209', FST_INK = '#131212';
const DRIP_BLUE = '#5587A2', DRIP_INK = '#1D1D1B', ID_INK = '#0D0D0D';

const JOBS = [
  { file: 'fst-lockup-full', palette: [FST_RED, FST_INK] },
  { file: 'fst-mark', palette: [FST_RED] },
  { file: 'fst-wordmark', palette: [FST_RED, FST_INK] },
  { file: 'fst-si-trasforma', palette: [FST_RED] },
  { file: 'drip-mark', palette: [DRIP_BLUE] },
  { file: 'drip-lockup-stacked', palette: [DRIP_BLUE, DRIP_INK] },
  { file: 'drip-id', palette: [DRIP_BLUE, ID_INK] },
];

const SCALE = 4;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const traceAsync = (img, opts) => new Promise((res, rej) => {
  const t = new potrace.Potrace(opts);
  t.loadImage(img, (err) => (err ? rej(err) : res(t.getPathTag())));
});

async function run(job) {
  const img = await Jimp.read(path.join(SRC, `${job.file}.png`));
  const { width: w, height: h, data } = img.bitmap;
  // Opaque bounding box.
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const rgb = job.palette.map(hex);
  const layers = [];
  for (let ci = 0; ci < rgb.length; ci++) {
    // Mask: dark where the pixel belongs to this colour, weighted by alpha.
    const mask = new Jimp(cw, ch, 0xffffffff);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = ((y + y0) * w + (x + x0)) * 4;
      const a = data[i + 3];
      if (a < 8) continue;
      let best = 0, bd = Infinity;
      rgb.forEach((c, k) => { const d = (c[0] - data[i]) ** 2 + (c[1] - data[i + 1]) ** 2 + (c[2] - data[i + 2]) ** 2; if (d < bd) { bd = d; best = k; } });
      if (best !== ci) continue;
      const v = 255 - a;
      const o = (y * cw + x) * 4;
      mask.bitmap.data[o] = mask.bitmap.data[o + 1] = mask.bitmap.data[o + 2] = v;
    }
    mask.resize(cw * SCALE, ch * SCALE, Jimp.RESIZE_BICUBIC);
    const buf = await mask.getBufferAsync(Jimp.MIME_PNG);
    const tag = await traceAsync(buf, { threshold: 128, turdSize: 4, optTolerance: 0.15, color: job.palette[ci] });
    layers.push(tag.replace('<path', `<path transform="scale(${1 / SCALE})"`));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" width="${cw}" height="${ch}">${layers.join('')}</svg>\n`;
  fs.writeFileSync(path.join(OUT, `${job.file}.svg`), svg);
  // Reverse variants for the dark technical shell. DRIP keeps its blue and turns
  // the ink ivory; FST (red ≈ 2:1 on black) becomes monochrome ivory.
  const IVORY = '#F5F3EF';
  const reverse = job.file.startsWith('fst')
    ? svg.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${IVORY}"`)
    : svg.replaceAll(`fill="${DRIP_INK}"`, `fill="${IVORY}"`).replaceAll(`fill="${ID_INK}"`, `fill="${IVORY}"`);
  fs.writeFileSync(path.join(OUT, `${job.file}-reverse.svg`), reverse);
  console.log(job.file, `${cw}x${ch}`, `${(svg.length / 1024).toFixed(1)} KB`);
}

// The stacked DRIP lockup holds the mark (blue layer) above the wordmark (ink layer).
// The header composes them horizontally, so extract the wordmark on its own,
// cropped to the ink bounds measured on the source (x 192–832, y 608–812 of 1024).
function extractDripWordmark() {
  for (const suffix of ['', '-reverse']) {
    const svg = fs.readFileSync(path.join(OUT, `drip-lockup-stacked${suffix}.svg`), 'utf8');
    const ink = suffix ? '#F5F3EF' : DRIP_INK;
    const layer = svg.match(new RegExp(`<path[^>]*fill="${ink}"[^>]*/>`));
    if (!layer) throw new Error('wordmark layer not found');
    fs.writeFileSync(
      path.join(OUT, `drip-wordmark${suffix}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 401 641 205" width="641" height="205">${layer[0]}</svg>\n`,
    );
  }
}

(async () => { for (const j of JOBS) await run(j); extractDripWordmark(); })().catch((e) => { console.error(e); process.exit(1); });
