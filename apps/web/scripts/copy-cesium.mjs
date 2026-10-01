// Copies Cesium's static runtime (workers, assets, widgets CSS) next to the app: one local version, no CDN.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('cesium/package.json'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const src = join(root, 'Build', 'Cesium');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cesium');
const stamp = join(out, '.version');
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) process.exit(0);
mkdirSync(out, { recursive: true });
for (const d of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) cpSync(join(src, d), join(out, d), { recursive: true });
writeFileSync(stamp, version);
console.log(`Cesium ${version} copied to public/cesium`);
