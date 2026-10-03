import type { LngLat, Network, PhysicalModel } from '@drip-urban/core';

/**
 * DXF (AutoCAD R12, ASCII) of the project for Civil 3D, AutoCAD, BricsCAD, QGIS: real coordinates in
 * WGS84 / UTM (zone from the project centre, EPSG:326xx), metres, one layer per element type
 * (Italian layer names as in a municipal technical drawing).
 */

/** WGS84 → UTM (Krüger series, mm accuracy within the zone). */
export function toUtm(lon: number, lat: number, zone: number): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

export const utmZone = (lon: number) => Math.floor((lon + 180) / 6) + 1;

const LAYERS: Record<string, number> = {
  ASSI_STRADALI: 1, CARREGGIATA: 8, MARCIAPIEDI: 9, CORDOLI: 7, SEGNALETICA_ORIZZONTALE: 2, ROTATORIE: 4, EDIFICI: 7,
  VERDE: 3, AREE_PROGETTO: 30, ARREDO: 94, SEGNALI_VERTICALI: 1, ZONE: 6, TESTI: 7,
};

const SURFACE_LAYER: Record<string, string> = {
  carriageway: 'CARREGGIATA', bus: 'CARREGGIATA', parking: 'CARREGGIATA', cycle: 'CARREGGIATA', junction: 'CARREGGIATA', shoulder: 'CARREGGIATA',
  sidewalk: 'MARCIAPIEDI', corner: 'MARCIAPIEDI', furniture: 'MARCIAPIEDI', footpath: 'MARCIAPIEDI',
  green: 'VERDE', median: 'VERDE', roundabout_island: 'ROTATORIE', roundabout_ring: 'ROTATORIE', roundabout_apron: 'ROTATORIE', splitter: 'ROTATORIE', area: 'AREE_PROGETTO',
};

export function buildDxf(opts: {
  network: Network; physical: PhysicalModel | null; buildings: { footprint: readonly LngLat[]; heightM: number }[];
  origin: LngLat; title: string;
}): string {
  const zone = utmZone(opts.origin[0]);
  const P = (p: LngLat) => toUtm(p[0], p[1], zone);
  const out: string[] = [];
  const w = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? value.toFixed(3) : value);
  // Header and layer table.
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, '6'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, String(Object.keys(LAYERS).length));
  for (const [name, color] of Object.entries(LAYERS)) { w(0, 'LAYER'); w(2, name); w(70, '0'); w(62, String(color)); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  const poly = (layer: string, pts: readonly LngLat[], closed: boolean, elevation = 0) => {
    if (pts.length < 2) return;
    w(0, 'POLYLINE'); w(8, layer); w(66, '1'); w(10, 0); w(20, 0); w(30, elevation); w(70, closed ? '1' : '0');
    for (const q of pts) { const [x, y] = P(q); w(0, 'VERTEX'); w(8, layer); w(10, x); w(20, y); w(30, elevation); }
    w(0, 'SEQEND'); w(8, layer);
  };
  const text = (layer: string, at: LngLat, h: number, s: string, rot = 0) => {
    const [x, y] = P(at);
    w(0, 'TEXT'); w(8, layer); w(10, x); w(20, y); w(30, 0); w(40, h); w(1, s.replace(/[\r\n]/g, ' ').slice(0, 250)); w(50, rot);
  };
  const point = (layer: string, at: LngLat) => { const [x, y] = P(at); w(0, 'POINT'); w(8, layer); w(10, x); w(20, y); w(30, 0); };

  for (const b of opts.buildings) poly('EDIFICI', b.footprint, true);
  if (opts.physical) {
    for (const s of opts.physical.surfaces) poly(SURFACE_LAYER[s.kind] ?? 'CARREGGIATA', s.ring, true);
    for (const m of opts.physical.markings) poly('SEGNALETICA_ORIZZONTALE', m.ring, true);
    for (const l of opts.physical.lines) if (l.kind === 'kerb') poly('CORDOLI', l.line, false);
  }
  for (const r of Object.values(opts.network.roads)) {
    poly('ASSI_STRADALI', r.axis, false);
    if (r.name && r.axis.length >= 2) {
      const mid = r.axis[Math.floor(r.axis.length / 2)]!, nxt = r.axis[Math.min(r.axis.length - 1, Math.floor(r.axis.length / 2) + 1)]!;
      const [x0, y0] = P(mid), [x1, y1] = P(nxt);
      let ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      text('TESTI', mid, 2.2, r.name, ang);
    }
  }
  for (const z of Object.values(opts.network.zones)) { poly('ZONE', z.polygon, true); if (z.polygon[0]) text('ZONE', z.polygon[0], 3, z.name); }
  for (const a of Object.values(opts.network.assets)) {
    if (a.state === 'removed') continue;
    const layer = a.type.startsWith('it.sign.') ? 'SEGNALI_VERTICALI' : 'ARREDO';
    point(layer, a.at);
    text(layer, a.at, 0.6, a.type.replace(/^it\.sign\./, '').replace(/_/g, ' '));
  }
  text('TESTI', opts.origin, 4, `${opts.title} · WGS84 / UTM ${zone}N (EPSG:326${String(zone).padStart(2, '0')}) · metri · DRIP Urban`);
  w(0, 'ENDSEC'); w(0, 'EOF');
  return out.join('\r\n');
}
