// MapLibre v6 loads its worker relative to its own module URL, which bundlers rewrite.
// Ship the worker (and the shared chunk it imports) as static files and point setWorkerUrl at them.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');
mkdirSync(out, { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(join(dist, f), join(out, f));
console.log('MapLibre', JSON.parse(readFileSync(join(dist, '..', 'package.json'), 'utf8')).version, 'worker copied to public/maplibre');
