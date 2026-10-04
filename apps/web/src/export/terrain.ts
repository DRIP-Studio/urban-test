import type { LngLat, TerrainGrid } from '@drip-urban/core';

/** Geographic position of grid vertex (i, j): i west→east, j south→north. */
export function gridLngLat(g: TerrainGrid, i: number, j: number): LngLat {
  return [g.west + ((g.east - g.west) * i) / Math.max(1, g.nx - 1), g.south + ((g.north - g.south) * j) / Math.max(1, g.ny - 1)];
}

/** Bilinear terrain elevation at a point (clamped to the grid extent). */
export function sampleTerrain(g: TerrainGrid, p: LngLat): number {
  if (g.nx < 1 || g.ny < 1 || g.z.length < g.nx * g.ny) return 0;
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, Number.isFinite(v) ? v : 0));
  const fx = clamp(((p[0] - g.west) / (g.east - g.west || 1)) * (g.nx - 1), g.nx - 1);
  const fy = clamp(((p[1] - g.south) / (g.north - g.south || 1)) * (g.ny - 1), g.ny - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fy), i1 = Math.min(g.nx - 1, i0 + 1), j1 = Math.min(g.ny - 1, j0 + 1);
  const tx = fx - i0, ty = fy - j0;
  const z = (i: number, j: number) => g.z[j * g.nx + i] ?? 0;
  return (z(i0, j0) * (1 - tx) + z(i1, j0) * tx) * (1 - ty) + (z(i0, j1) * (1 - tx) + z(i1, j1) * tx) * ty;
}

/** EPSG code of WGS84 / UTM for a zone and hemisphere (326xx north, 327xx south). */
export const utmEpsg = (zone: number, lat: number) => `${lat < 0 ? 327 : 326}${String(zone).padStart(2, '0')}`;
