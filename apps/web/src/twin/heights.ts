import { LocalFrame, crossSection, designElevation, geom, layoutSection, type LngLat, type Network, type Road, type TerrainGrid, type VerticalProfile } from '@drip-urban/core';

/**
 * Heights for the Twin (InfraWorks-like model): terrain from the project DTM, road corridors on their
 * vertical profile, earthwork side slopes. Pure functions (no Cesium) so they can be unit-tested and
 * moved to a worker; the Twin turns the results into Cesium geometry.
 *
 * Datum: the DTM is orthometric (metres a.s.l., Italian DTMs on the national geoid ≈ EGM2008/ITALGEO),
 * Cesium wants heights above the WGS84 ellipsoid → h = H + N, with N the geoid undulation.
 */

type V = readonly [number, number];

/**
 * Geoid undulation N (EGM2008, metres) at Italian reference points. Coarse: ±1–2 m between points,
 * which is far below the DTM accuracy that matters here (only the absolute placement against other
 * ellipsoidal data — e.g. photogrammetric 3D tiles — depends on it; the model is internally consistent).
 */
export const GEOID_IT: readonly { readonly name: string; readonly lon: number; readonly lat: number; readonly n: number }[] = [
  { name: 'Torino', lon: 7.69, lat: 45.07, n: 48.5 },
  { name: 'Milano', lon: 9.19, lat: 45.46, n: 47.0 },
  { name: 'Venezia', lon: 12.33, lat: 45.44, n: 44.5 },
  { name: 'Genova', lon: 8.93, lat: 44.41, n: 48.5 },
  { name: 'Bologna', lon: 11.34, lat: 44.49, n: 46.0 },
  { name: 'Firenze', lon: 11.25, lat: 43.77, n: 47.5 },
  { name: 'Ancona', lon: 13.52, lat: 43.62, n: 44.5 },
  { name: 'Roma', lon: 12.5, lat: 41.9, n: 48.0 },
  { name: 'Pescara', lon: 14.21, lat: 42.46, n: 45.0 },
  { name: 'Napoli', lon: 14.27, lat: 40.85, n: 46.0 },
  { name: 'Bari', lon: 16.87, lat: 41.12, n: 41.0 },
  { name: 'Potenza', lon: 15.8, lat: 40.64, n: 43.5 },
  { name: 'Reggio Calabria', lon: 15.65, lat: 38.11, n: 42.0 },
  { name: 'Palermo', lon: 13.36, lat: 38.12, n: 43.0 },
  { name: 'Catania', lon: 15.09, lat: 37.5, n: 40.5 },
  { name: 'Cagliari', lon: 9.12, lat: 39.22, n: 46.0 },
];
/** Fallback outside Italy (and default for Campania, where most DRIP projects are). */
export const GEOID_DEFAULT_M = 46;

/**
 * Geoid undulation at a point: `override` when given (a configurable constant, e.g. from the local
 * ITALGEO value), else inverse-distance interpolation of GEOID_IT within ~300 km, else GEOID_DEFAULT_M.
 */
export function geoidUndulation(lon: number, lat: number, override?: number | null): number {
  if (override !== undefined && override !== null && Number.isFinite(override)) return override;
  let sw = 0, sn = 0;
  for (const p of GEOID_IT) {
    const dx = (lon - p.lon) * Math.cos((lat * Math.PI) / 180), dy = lat - p.lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return p.n;
    if (d2 > 9) continue; // ~330 km
    const w = 1 / d2;
    sw += w; sn += w * p.n;
  }
  return sw > 0 ? Math.round((sn / sw) * 10) / 10 : GEOID_DEFAULT_M;
}

/** Bilinear sample of the DTM, clamped to the nearest edge outside the grid (no cliffs at the border). */
export function sampleClamped(g: TerrainGrid, lon: number, lat: number): number {
  const fx = Math.min(g.nx - 1, Math.max(0, ((lon - g.west) / (g.east - g.west)) * (g.nx - 1)));
  const fy = Math.min(g.ny - 1, Math.max(0, ((lat - g.south) / (g.north - g.south)) * (g.ny - 1)));
  const i = Math.min(Math.floor(fx), g.nx - 2), j = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - i, ty = fy - j;
  const c = [[i, j, (1 - tx) * (1 - ty)], [i + 1, j, tx * (1 - ty)], [i, j + 1, (1 - tx) * ty], [i + 1, j + 1, tx * ty]] as const;
  let sw = 0, sz = 0;
  for (const [ii, jj, w] of c) {
    const z = g.z[jj * g.nx + ii];
    if (typeof z === 'number' && Number.isFinite(z)) { sw += w; sz += w * z; }
  }
  return sw > 1e-9 ? sz / sw : Number.NaN;
}

export function gridRange(g: TerrainGrid): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const z of g.z) if (Number.isFinite(z)) { if (z < min) min = z; if (z > max) max = z; }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

export interface HeightOptions {
  /** Geoid undulation (m) added to orthometric heights. */
  readonly geoidM: number;
  /** Vertical exaggeration of the ground (1 = true scale), same law as Cesium's scene.verticalExaggeration. */
  readonly exaggeration?: number;
  /** Ellipsoidal height that the exaggeration keeps fixed (scene.verticalExaggerationRelativeHeight). */
  readonly relativeHeight?: number;
}

interface Axis { readonly pts: V[]; readonly length: number; readonly v: VerticalProfile; readonly halfLeft: number; readonly halfRight: number }

/** Kerb height of sidewalks on a profiled road (the physical model carries it as `heightM`). */
export const KERB_M = 0.15;
/** Markings above their surface. */
export const MARKING_LIFT_M = 0.02;

/**
 * Orthometric height model of the project: terrain, road design elevations by chainage, junction
 * platforms from the incident roads. `toEllipsoid` converts to Cesium heights (geoid + exaggeration).
 */
export class HeightModel {
  readonly frame: LocalFrame;
  private readonly axes = new Map<string, Axis | null>();
  private readonly nodes = new Map<string, number | null>();
  private readonly byNode = new Map<string, Road[]>();
  private readonly profiled: Road[];

  constructor(readonly grid: TerrainGrid, readonly net: Network | null, readonly origin: LngLat, readonly opts: HeightOptions) {
    this.frame = new LocalFrame(origin);
    const roads = net ? Object.values(net.roads) : [];
    for (const r of roads) for (const n of [r.from, r.to]) (this.byNode.get(n) ?? this.byNode.set(n, []).get(n)!).push(r);
    this.profiled = roads.filter((r) => (r.vertical?.pvis.length ?? 0) >= 2);
  }

  get hasProfiles(): boolean { return this.profiled.length > 0; }
  get profiledRoads(): readonly Road[] { return this.profiled; }

  terrain(lon: number, lat: number): number {
    const z = sampleClamped(this.grid, lon, lat);
    return Number.isFinite(z) ? z : 0;
  }

  /** Ellipsoidal height for Cesium from an orthometric ground height, plus an unscaled offset (kerbs, objects). */
  toEllipsoid(ortho: number, offset = 0): number {
    const k = this.opts.exaggeration ?? 1, rel = this.opts.relativeHeight ?? 0;
    return (ortho + this.opts.geoidM - rel) * k + rel + offset;
  }

  private axis(roadId: string): Axis | null {
    if (this.axes.has(roadId)) return this.axes.get(roadId)!;
    const r = this.net?.roads[roadId];
    let a: Axis | null = null;
    if (r?.vertical && r.vertical.pvis.length >= 2) {
      const pts = r.axis.map((q) => this.frame.toMetric(q) as V);
      const lay = layoutSection(r);
      a = { pts, length: geom.lengthOf(pts), v: r.vertical, halfLeft: Math.abs(lay.outerLeft), halfRight: Math.abs(lay.outerRight) };
    }
    this.axes.set(roadId, a);
    return a;
  }

  /** Chainage of a point projected on the road axis and its distance from it; null when the road has no profile. */
  station(roadId: string, lon: number, lat: number): { station: number; offset: number } | null {
    const a = this.axis(roadId);
    if (!a) return null;
    const pr = geom.project(a.pts, this.frame.toMetric([lon, lat]) as V);
    return { station: pr.along, offset: pr.d };
  }

  /** Design elevation (grade line, crossfall ignored) of a profiled road at the projection of the point. */
  roadZ(roadId: string, lon: number, lat: number): number | null {
    const a = this.axis(roadId);
    if (!a) return null;
    const s = this.station(roadId, lon, lat)!.station;
    const z = designElevation(a.v, Math.min(a.length, Math.max(0, s)));
    return Number.isFinite(z) ? z : null;
  }

  /**
   * Junction platform: average of the incident roads' elevations at the node — profile end for
   * profiled roads, terrain at the node otherwise. Null when no incident road is profiled (→ terrain).
   */
  nodeZ(nodeId: string): number | null {
    if (this.nodes.has(nodeId)) return this.nodes.get(nodeId)!;
    const roads = this.byNode.get(nodeId) ?? [];
    const at = this.net?.nodes[nodeId]?.at;
    const zs: number[] = [];
    let any = false;
    for (const r of roads) {
      const v = r.vertical;
      if (v && v.pvis.length >= 2) {
        any = true;
        zs.push(r.from === nodeId ? designElevation(v, v.pvis[0]!.station) : designElevation(v, v.pvis[v.pvis.length - 1]!.station));
        if (r.from === nodeId && r.to === nodeId) zs.push(designElevation(v, v.pvis[v.pvis.length - 1]!.station));
      } else if (at) zs.push(this.terrain(at[0], at[1]));
    }
    const out = any && zs.length ? zs.reduce((s, z) => s + z, 0) / zs.length : null;
    this.nodes.set(nodeId, out);
    return out;
  }

  /** Base (orthometric) of a surface vertex: profiled road → grade line; junction → node platform; else terrain. */
  surfaceZ(props: { roadId?: string | null; nodeId?: string | null }, lon: number, lat: number): number {
    if (props.roadId) { const z = this.roadZ(props.roadId, lon, lat); if (z !== null) return z; }
    if (props.nodeId) { const z = this.nodeZ(props.nodeId); if (z !== null) return z; }
    return this.terrain(lon, lat);
  }

  /** Ground under an object: the platform of a profiled road when the point lies on it, else terrain. */
  groundZ(lon: number, lat: number): number {
    for (const r of this.profiled) {
      const a = this.axis(r.id)!;
      const pr = geom.project(a.pts, this.frame.toMetric([lon, lat]) as V);
      if (pr.d <= Math.max(a.halfLeft, a.halfRight) && pr.along > 0 && pr.along < a.length) {
        const z = designElevation(a.v, pr.along);
        if (Number.isFinite(z)) return z;
      }
    }
    return this.terrain(lon, lat);
  }
}

/** Inserts vertices so that no edge of the closed ring is longer than `stepM` (surfaces follow the ground). */
export function densifyRing(ring: readonly LngLat[], frame: LocalFrame, stepM = 8): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    out.push(a);
    const ma = frame.toMetric(a), mb = frame.toMetric(b);
    const n = Math.max(0, Math.ceil(Math.hypot(mb[0] - ma[0], mb[1] - ma[1]) / stepM - 1e-9) - 1);
    for (let k = 1; k <= n; k++) { const t = k / (n + 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/** Flat [lon, lat, h, …] with ellipsoidal heights for a surface ring; `lift` is added unscaled. */
export function ringHeights(hm: HeightModel, ring: readonly LngLat[], props: { roadId?: string | null; nodeId?: string | null }, lift: number): { flat: number[]; min: number } {
  const flat: number[] = [];
  let min = Infinity;
  for (const p of ring) {
    const h = hm.toEllipsoid(hm.surfaceZ(props, p[0], p[1]), lift);
    flat.push(p[0], p[1], h);
    if (h < min) min = h;
  }
  return { flat, min };
}

/** Lowest terrain under a footprint (vertices and centroid) — base of an extruded building. */
export function footprintBase(hm: HeightModel, footprint: readonly (readonly [number, number])[]): number {
  let min = Infinity, cx = 0, cy = 0;
  for (const p of footprint) { min = Math.min(min, hm.terrain(p[0], p[1])); cx += p[0]; cy += p[1]; }
  if (footprint.length) min = Math.min(min, hm.terrain(cx / footprint.length, cy / footprint.length));
  return Number.isFinite(min) ? min : 0;
}

export interface SlopeQuad {
  /** Four corners [lon, lat, orthometric z]: platform edge at s0, s1, daylight at s1, s0. */
  readonly ring: readonly (readonly [number, number, number])[];
  readonly side: 'left' | 'right';
  /** Cut (sterro, platform below ground) vs fill (rilevato). */
  readonly cut: boolean;
}

export interface CorridorSlopes {
  readonly quads: SlopeQuad[];
  /** Runs of the corridor in cut (platform + slopes), for clipping the terrain mesh over the road. */
  readonly cutFootprints: LngLat[][];
}

/**
 * Earthwork side slopes of a profiled road (corridor «scarpate»), from core `crossSection` every `step`
 * metres: 1:1 in cut, 3:2 in fill, from the platform edges at the design elevation to the daylight
 * point on the terrain. Sections where the platform is within `minM` of the ground get no slope.
 */
export function corridorSlopes(road: Road, grid: TerrainGrid, origin: LngLat, step = 5, opts: { minM?: number; trimEndsM?: number } = {}): CorridorSlopes {
  const v = road.vertical;
  if (!v || v.pvis.length < 2) return { quads: [], cutFootprints: [] };
  const frame = new LocalFrame(origin);
  const pts = road.axis.map((q) => frame.toMetric(q) as V);
  const length = geom.lengthOf(pts);
  const minM = opts.minM ?? 0.05;
  const n = Math.max(1, Math.ceil(length / step));
  type Edge = { inner: [number, number, number]; outer: [number, number, number]; h: number };
  const secs: { s: number; left?: Edge; right?: Edge; axisCut: boolean }[] = [];
  for (let k = 0; k <= n; k++) {
    const s = Math.min(length, k * step);
    const c = crossSection(road, v, grid, origin, s, 3);
    if (!Number.isFinite(c.design)) continue;
    const { p, t } = geom.sampleAt(pts, s);
    const nrm = geom.leftNormal(t);
    const at = (o: number) => frame.toLngLat([p[0] + nrm[0] * o, p[1] + nrm[1] * o]);
    const sec: (typeof secs)[number] = { s, axisCut: Number.isFinite(c.ground[1]!) && c.ground[1]! > c.design + 0.1 };
    for (const sl of c.slopes) {
      const edgeO = sl.side === 'left' ? c.left : c.right;
      const h = sl.z - c.design;
      if (Math.abs(h) < minM) continue;
      const a = at(edgeO), b = at(sl.x);
      const zb = sampleClamped(grid, b[0], b[1]);
      sec[sl.side] = { inner: [a[0], a[1], c.design], outer: [b[0], b[1], Number.isFinite(zb) ? zb : sl.z], h };
    }
    secs.push(sec);
  }
  const quads: SlopeQuad[] = [];
  for (let k = 1; k < secs.length; k++) {
    for (const side of ['left', 'right'] as const) {
      const e0 = secs[k - 1]![side], e1 = secs[k]![side];
      if (!e0 || !e1) continue;
      quads.push({ ring: [e0.inner, e1.inner, e1.outer, e0.outer], side, cut: e0.h + e1.h > 0 });
    }
  }
  // Cut runs (away from the road ends, where junction platforms take over) clip the terrain mesh.
  const trim = opts.trimEndsM ?? 12;
  const cutFootprints: LngLat[][] = [];
  let run: (typeof secs)[number][] = [];
  const flush = () => {
    if (run.length >= 2) {
      const left = run.map((q) => q.left?.outer ?? q.left?.inner).filter((q): q is [number, number, number] => !!q);
      const right = run.map((q) => q.right?.outer ?? q.right?.inner).filter((q): q is [number, number, number] => !!q);
      if (left.length >= 2 && right.length >= 2) cutFootprints.push([...left.map((q) => [q[0], q[1]] as LngLat), ...right.reverse().map((q) => [q[0], q[1]] as LngLat)]);
    }
    run = [];
  };
  for (const sec of secs) {
    if (sec.axisCut && sec.s >= trim && sec.s <= length - trim && sec.left && sec.right) run.push(sec);
    else flush();
  }
  flush();
  return { quads, cutFootprints };
}

/** Terrain heightmap tile (row 0 = north) for Cesium's CustomHeightmapTerrainProvider, ellipsoidal heights. */
export function heightmapTile(grid: TerrainGrid, rect: { west: number; south: number; east: number; north: number }, width: number, height: number, geoidM: number): Float32Array {
  const out = new Float32Array(width * height);
  const fallback = gridRange(grid).min;
  for (let j = 0; j < height; j++) {
    const lat = rect.north - ((rect.north - rect.south) * j) / (height - 1);
    for (let i = 0; i < width; i++) {
      const lon = rect.west + ((rect.east - rect.west) * i) / (width - 1);
      const z = sampleClamped(grid, lon, lat);
      out[j * width + i] = (Number.isFinite(z) ? z : fallback) + geoidM;
    }
  }
  return out;
}
