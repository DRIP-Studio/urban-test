import type { LngLat, Network, PhysicalModel, TerrainGrid } from '@drip-urban/core';
import { toUtm, utmZone } from './dxf';
import { gridLngLat, sampleTerrain, utmEpsg } from './terrain';

/**
 * IFC 4.3 (IFC4X3_ADD2, STEP physical file) of the project for BIM viewers, InfraWorks, Revit,
 * Civil 3D: IfcProject → IfcSite → IfcRoad, with the physical surfaces as triangulated courses,
 * green as vegetation, the DTM as terrain, furniture and signs as boxes at their position.
 * Local coordinates are metres east/north of the project origin in WGS84 / UTM; IfcMapConversion
 * georeferences them (EPSG:326xx). GlobalIds are derived from the element ids, so a re-export of
 * the same project keeps them stable.
 */

// ---------------------------------------------------------------- GlobalId

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** 128-bit hash (cyrb128) of a string as 16 bytes. */
function hash128(s: string): Uint8Array {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  const out = new Uint8Array(16);
  [h1, h2, h3, h4].forEach((h, i) => { for (let b = 0; b < 4; b++) out[i * 4 + b] = (h >>> (24 - 8 * b)) & 0xff; });
  return out;
}

/** IFC compressed GUID: 128 bits → 22 characters (2 for the first byte, 4 for each following 3 bytes). */
export function compressGuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('GUID di 16 byte richiesto');
  let s = B64[bytes[0]! >> 6]! + B64[bytes[0]! & 63]!;
  for (let i = 1; i < 16; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  return s;
}

// ---------------------------------------------------------------- STEP encoding

/** STEP string literal: apostrophes and backslashes doubled, non-ASCII as \X2\…\X0\ (UTF-16). */
export function stepString(s: string): string {
  let out = '';
  let wide = '';
  const flush = () => { if (wide) { out += `\\X2\\${wide}\\X0\\`; wide = ''; } };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 && c <= 126) {
      flush();
      const ch = s[i]!;
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else if (c === 10 || c === 13 || c === 9) {
      flush(); out += ' ';
    } else if (c >= 32) {
      wide += c.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  flush();
  return `'${out}'`;
}

const real = (v: number) => {
  const x = Number.isFinite(v) && Math.abs(v) >= 5e-7 ? v : 0;
  return x.toFixed(6).replace(/0+$/, ''); // always keeps the decimal point, as STEP requires
};

// ---------------------------------------------------------------- Geometry

type P2 = readonly [number, number];

/** Ear-clipping triangulation of a simple polygon; returns index triples (CCW). */
export function triangulate(pts: readonly P2[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i]!, b = pts[(i + 1) % n]!; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse();
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const eps = 1e-10 * Math.max(1, Math.abs(area));
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!, i1 = idx[k]!, i2 = idx[(k + 1) % idx.length]!;
      const a = pts[i0]!, b = pts[i1]!, c = pts[i2]!;
      const cr = cross(a, b, c);
      if (Math.abs(cr) <= eps) { idx.splice(k, 1); clipped = true; break; } // collinear / duplicate: drop vertex
      if (cr < 0) continue; // reflex
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = pts[j]!;
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (inside(p, a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) {
      // Self-intersecting or numerically degenerate remainder: close it with a fan.
      for (let k = 1; k < idx.length - 1; k++) tris.push([idx[0]!, idx[k]!, idx[k + 1]!]);
      return tris;
    }
  }
  if (idx.length === 3 && Math.abs(cross(pts[idx[0]!]!, pts[idx[1]!]!, pts[idx[2]!]!)) > eps) tris.push([idx[0]!, idx[1]!, idx[2]!]);
  return tris;
}

// ---------------------------------------------------------------- Writer

const SURFACE_NAME: Record<string, string> = {
  carriageway: 'Carreggiata', bus: 'Corsia riservata bus', median: 'Spartitraffico', cycle: 'Pista ciclabile', parking: 'Sosta',
  sidewalk: 'Marciapiede', furniture: 'Fascia arredo', green: 'Aiuola', shoulder: 'Banchina', curb: 'Cordolo', junction: 'Intersezione',
  corner: 'Angolo marciapiede', footpath: 'Percorso pedonale', roundabout_ring: 'Anello rotatoria', roundabout_island: 'Isola centrale rotatoria',
  roundabout_apron: 'Corona sormontabile', splitter: 'Isola spartitraffico', area: 'Area di progetto',
};
const GREEN = new Set(['green', 'roundabout_island']);
const COLOUR: Record<string, [number, number, number]> = {
  asphalt: [0.25, 0.25, 0.26], pavement: [0.72, 0.71, 0.68], green: [0.36, 0.55, 0.27], terrain: [0.62, 0.55, 0.43],
  furniture: [0.35, 0.37, 0.4], sign: [0.85, 0.12, 0.12], cycle: [0.62, 0.25, 0.2], bus: [0.6, 0.18, 0.15],
};
const colourOf = (kind: string) => GREEN.has(kind) ? 'green' : kind === 'cycle' ? 'cycle' : kind === 'bus' ? 'bus'
  : ['sidewalk', 'corner', 'furniture', 'footpath', 'curb', 'splitter', 'median', 'roundabout_apron'].includes(kind) ? 'pavement' : 'asphalt';

export interface FurnitureDims { id: string; label: string; dims: { w: number; d: number; h: number } }

export function buildIfc(opts: {
  network: Network; physical: PhysicalModel | null; origin: LngLat; title: string;
  terrain?: TerrainGrid | null; furniture?: readonly FurnitureDims[]; fileName?: string; now?: Date;
}): string {
  const zone = utmZone(opts.origin[0]);
  const epsg = utmEpsg(zone, opts.origin[1]);
  const [E0, N0] = toUtm(opts.origin[0], opts.origin[1], zone);
  const local = (p: LngLat): [number, number] => { const [e, n] = toUtm(p[0], p[1], zone); return [e - E0, n - N0]; };
  const terrain = opts.terrain && opts.terrain.nx >= 1 && opts.terrain.ny >= 1 && opts.terrain.z.length >= opts.terrain.nx * opts.terrain.ny ? opts.terrain : null;
  const elev = (p: LngLat) => (terrain ? sampleTerrain(terrain, p) : 0);

  const lines: string[] = [];
  let next = 1;
  const add = (body: string): number => { const id = next++; lines.push(`#${id}=${body};`); return id; };
  const ref = (id: number | null | undefined) => (id ? `#${id}` : '$');
  const list = (ids: readonly number[]) => `(${ids.map((i) => `#${i}`).join(',')})`;
  const str = (s: string | null | undefined) => (s ? stepString(s) : '$');

  const usedGuids = new Set<string>();
  const seed = `${opts.title}|${opts.origin[0].toFixed(6)},${opts.origin[1].toFixed(6)}`;
  const guid = (key: string) => {
    let g = compressGuid(hash128(`${seed}|${key}`));
    for (let k = 1; usedGuids.has(g); k++) g = compressGuid(hash128(`${seed}|${key}#${k}`));
    usedGuids.add(g);
    return stepString(g);
  };

  const point = (x: number, y: number, z: number) => add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
  const dir = (x: number, y: number, z: number) => add(`IFCDIRECTION((${real(x)},${real(y)},${real(z)}))`);
  const origin3 = point(0, 0, 0);
  const zAxis = dir(0, 0, 1), xAxis = dir(1, 0, 0);
  const wcs = add(`IFCAXIS2PLACEMENT3D(#${origin3},#${zAxis},#${xAxis})`);
  /** Identity placement is shared; others get their own. */
  const placement3 = (loc = origin3, refDir = xAxis) => (loc === origin3 && refDir === xAxis ? wcs : add(`IFCAXIS2PLACEMENT3D(#${loc},#${zAxis},#${refDir})`));

  // Units and contexts.
  const metre = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const units = add(`IFCUNITASSIGNMENT((#${metre},#${add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)')},#${add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)')},#${add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')}))`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${wcs},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`);
  const hemi = opts.origin[1] < 0 ? 'S' : 'N';
  const crs = add(`IFCPROJECTEDCRS('EPSG:${epsg}',${stepString(`WGS 84 / UTM zone ${zone}${hemi}`)},'WGS84',$,'UTM','${zone}${hemi}',#${metre})`);
  add(`IFCMAPCONVERSION(#${ctx},#${crs},${real(E0)},${real(N0)},0.,1.,0.,1.,$,$)`);

  const project = add(`IFCPROJECT(${guid('project')},$,${str(opts.title)},'Esportato da DRIP Urban',$,$,$,(#${ctx}),#${units})`);

  // Spatial structure: site → road.
  const dms = (deg: number) => {
    // Integer millionths of arc-second first, so 40.94° gives 40°56'24" and not 23.999999".
    const sgn = deg < 0 ? -1 : 1, t = Math.round(Math.abs(deg) * 3600e6);
    const d = Math.floor(t / 3600e6), m = Math.floor((t % 3600e6) / 60e6), s = Math.floor((t % 60e6) / 1e6), u = t % 1e6;
    return `(${sgn * d},${sgn * m},${sgn * s},${sgn * u})`;
  };
  const sitePl = add(`IFCLOCALPLACEMENT($,#${placement3()})`);
  const site = add(`IFCSITE(${guid('site')},$,'Sito',${str(opts.title)},$,#${sitePl},$,$,.ELEMENT.,${dms(opts.origin[1])},${dms(opts.origin[0])},0.,$,$)`);
  const roadPl = add(`IFCLOCALPLACEMENT(#${sitePl},#${placement3()})`);
  const road = add(`IFCROAD(${guid('road')},$,'Rete stradale',${str(opts.title)},$,#${roadPl},$,$,.ELEMENT.,.NOTDEFINED.)`);
  add(`IFCRELAGGREGATES(${guid('rel:project-site')},$,$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES(${guid('rel:site-road')},$,$,$,#${site},(#${road}))`);

  // Presentation styles, created on demand.
  const styles = new Map<string, number>();
  const style = (key: string) => {
    let s = styles.get(key);
    if (!s) {
      const [r, g, b] = COLOUR[key] ?? COLOUR.asphalt!;
      const rgb = add(`IFCCOLOURRGB($,${real(r)},${real(g)},${real(b)})`);
      const shading = add(`IFCSURFACESTYLESHADING(#${rgb},0.)`);
      s = add(`IFCSURFACESTYLE(${stepString(key)},.BOTH.,(#${shading}))`);
      styles.set(key, s);
    }
    return s;
  };
  const shape = (item: number, type: 'Tessellation' | 'SweptSolid', styleKey: string) => {
    add(`IFCSTYLEDITEM(#${item},(#${style(styleKey)}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(#${body},'Body','${type}',(#${item}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
  };
  const faceSet = (coords: readonly (readonly [number, number, number])[], tris: readonly (readonly [number, number, number])[]) => {
    const pl = add(`IFCCARTESIANPOINTLIST3D((${coords.map((c) => `(${real(c[0])},${real(c[1])},${real(c[2])})`).join(',')}),$)`);
    return add(`IFCTRIANGULATEDFACESET(#${pl},$,$,(${tris.map((t) => `(${t[0] + 1},${t[1] + 1},${t[2] + 1})`).join(',')}),$)`);
  };

  const contained: number[] = [];
  const materials = new Map<string, number[]>();
  const roadNames = opts.network.roads;

  // Physical surfaces, draped on the terrain and raised by their kerb height.
  for (const s of opts.physical?.surfaces ?? []) {
    const ring = s.ring.slice();
    if (ring.length > 1) { const a = ring[0]!, b = ring[ring.length - 1]!; if (a[0] === b[0] && a[1] === b[1]) ring.pop(); }
    if (ring.length < 3) continue;
    const xy = ring.map(local);
    const tris = triangulate(xy);
    if (!tris.length) continue;
    const dz = Number.isFinite(s.heightM) ? s.heightM : 0;
    const fs = faceSet(ring.map((p, i) => [xy[i]![0], xy[i]![1], elev(p) + dz] as const), tris);
    const label = SURFACE_NAME[s.kind] ?? s.kind;
    const roadName = s.roadId ? roadNames[s.roadId]?.name : undefined;
    const name = roadName ? `${label} · ${roadName}` : label;
    const pl = add(`IFCLOCALPLACEMENT(#${roadPl},#${placement3()})`);
    const green = GREEN.has(s.kind);
    const rep = shape(fs, 'Tessellation', colourOf(s.kind));
    const desc = s.state === 'project' ? 'Di progetto' : 'Esistente';
    const el = green
      ? add(`IFCGEOGRAPHICELEMENT(${guid(`surface:${s.id}`)},$,${str(name)},${str(desc)},${str(s.kind)},#${pl},#${rep},${str(s.id)},.VEGETATION.)`)
      : add(`IFCCOURSE(${guid(`surface:${s.id}`)},$,${str(name)},${str(desc)},${str(s.kind)},#${pl},#${rep},${str(s.id)},.PAVEMENT.)`);
    contained.push(el);
    if (s.material) { const m = materials.get(s.material) ?? []; m.push(el); materials.set(s.material, m); }
  }

  // Terrain as a triangulated geographic element.
  if (terrain && terrain.nx >= 2 && terrain.ny >= 2) {
    const coords: [number, number, number][] = [];
    for (let j = 0; j < terrain.ny; j++) for (let i = 0; i < terrain.nx; i++) { const [x, y] = local(gridLngLat(terrain, i, j)); coords.push([x, y, terrain.z[j * terrain.nx + i]!]); }
    const tris: [number, number, number][] = [];
    for (let j = 0; j < terrain.ny - 1; j++) for (let i = 0; i < terrain.nx - 1; i++) {
      const a = j * terrain.nx + i, b = a + 1, c = a + terrain.nx + 1, d = a + terrain.nx;
      tris.push([a, b, c], [a, c, d]);
    }
    const pl = add(`IFCLOCALPLACEMENT(#${roadPl},#${placement3()})`);
    const rep = shape(faceSet(coords, tris), 'Tessellation', 'terrain');
    contained.push(add(`IFCGEOGRAPHICELEMENT(${guid('terrain')},$,'Terreno (DTM)',${str(`${terrain.source} · ${terrain.resolutionM} m`)},$,#${pl},#${rep},$,.TERRAIN.)`));
  }

  // Furniture and vertical signs: boxes of the catalogue size at the asset position and heading.
  const dims = new Map((opts.furniture ?? []).map((f) => [f.id, f]));
  const box = (w: number, d: number, h: number, styleKey: string) => {
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,$,${real(Math.max(0.01, w))},${real(Math.max(0.01, d))})`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},#${placement3()},#${zAxis},${real(Math.max(0.01, h))})`);
    return shape(solid, 'SweptSolid', styleKey);
  };
  for (const a of Object.values(opts.network.assets)) {
    if (a.state === 'removed') continue;
    const sign = a.type.startsWith('it.sign.');
    const [x, y] = local(a.at);
    const z = elev(a.at) + (a.elevationM ?? 0); // elevationM is an offset above the ground
    const r = ((a.rotationDeg || 0) * Math.PI) / 180; // clockwise from north → local x axis turns clockwise from east
    const pl = add(`IFCLOCALPLACEMENT(#${roadPl},#${placement3(point(x, y, z), dir(Math.cos(r), -Math.sin(r), 0))})`);
    const desc = a.state === 'project' ? 'Di progetto' : 'Esistente';
    if (sign) {
      const rep = box(0.6, 0.06, 2.6, 'sign');
      const label = `Segnale ${a.type.replace(/^it\.sign\./, '').replace(/_/g, ' ')}`;
      contained.push(add(`IFCSIGN(${guid(`asset:${a.id}`)},$,${str(label)},${str(desc)},${str(a.type)},#${pl},#${rep},${str(a.id)},.PICTORAL.)`));
    } else {
      const f = dims.get(a.type);
      const rep = box(f?.dims.w ?? 0.5, f?.dims.d ?? 0.5, f?.dims.h ?? 1, 'furniture');
      contained.push(add(`IFCFURNITURE(${guid(`asset:${a.id}`)},$,${str(f?.label ?? a.type)},${str(desc)},${str(a.type)},#${pl},#${rep},${str(a.id)},.NOTDEFINED.)`));
    }
    if (a.material) { const m = materials.get(a.material) ?? []; m.push(contained[contained.length - 1]!); materials.set(a.material, m); }
  }

  if (contained.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid('rel:road-contains')},$,'Elementi della rete',$,${list(contained)},#${road})`);
  for (const [name, els] of materials) {
    const m = add(`IFCMATERIAL(${stepString(name)},$,$)`);
    add(`IFCRELASSOCIATESMATERIAL(${guid(`rel:material:${name}`)},$,$,$,${list(els)},#${m})`);
  }

  const now = (opts.now ?? new Date()).toISOString().slice(0, 19);
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [Reference View]'),'2;1');",
    `FILE_NAME(${stepString(opts.fileName ?? 'drip-urban.ifc')},'${now}',('DRIP Urban'),('DRIP'),'DRIP Urban 2.0','DRIP Urban','');`,
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    'ENDSEC;',
    'DATA;',
  ];
  return [...header, ...lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
