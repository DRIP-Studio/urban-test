import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocalFrame, designElevation, layoutSection, type CityBaseline, type Network, type Road, type TerrainGrid } from '@drip-urban/core';
import { GEOID_DEFAULT_M, HeightModel, corridorSlopes, densifyRing, footprintBase, geoidUndulation, heightmapTile, ringHeights, sampleClamped } from '../src/twin/heights';

const SEED = fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url));
const origin: [number, number] = [14.27, 40.94];
const f = new LocalFrame(origin);
let template: Road;
beforeAll(() => {
  const b = JSON.parse(gunzipSync(readFileSync(SEED)).toString('utf8')) as CityBaseline;
  template = Object.values(b.roads).find((r) => r.lanes.filter((l) => l.modes.includes('car')).length === 2 && layoutSection(r).outerLeft > 3)!;
});

/** Plane terrain z = z0 + gx·east + gy·north over ±600 m around the origin. */
function plane(z0: number, gx = 0, gy = 0): TerrainGrid {
  const [w, s] = f.toLngLat([-600, -600]), [e, n] = f.toLngLat([600, 600]);
  const nx = 61, ny = 61, z: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z.push(z0 + gx * (-600 + 20 * i) + gy * (-600 + 20 * j));
  return { west: w, south: s, east: e, north: n, nx, ny, z, source: 'test', resolutionM: 20 };
}

/** Straight east-bound road from (x0, 0) to (x1, 0) with a constant-grade profile z0 → z1. */
function road(id: string, from: string, to: string, x0: number, x1: number, z?: [number, number]): Road {
  const L = Math.abs(x1 - x0);
  return { ...template, id, from, to, axis: [f.toLngLat([x0, 0]), f.toLngLat([x1, 0])], vertical: z ? { pvis: [{ station: 0, elevation: z[0] }, { station: L, elevation: z[1] }] } : undefined };
}
const net = (roads: Road[]): Network => ({
  roads: Object.fromEntries(roads.map((r) => [r.id, r])),
  nodes: { A: { id: 'A', at: f.toLngLat([-200, 0]) }, N: { id: 'N', at: f.toLngLat([0, 0]) }, B: { id: 'B', at: f.toLngLat([200, 0]) }, C: { id: 'C', at: f.toLngLat([0, 200]) } },
} as unknown as Network);

describe('Twin: geoide', () => {
  it('uses the Italian table, an explicit override, and the default far away', () => {
    expect(geoidUndulation(14.27, 40.85)).toBe(46);
    const fratta = geoidUndulation(14.27, 40.94);
    expect(fratta).toBeGreaterThan(44);
    expect(fratta).toBeLessThan(48);
    expect(geoidUndulation(14.27, 40.94, 45.2)).toBe(45.2);
    expect(geoidUndulation(14.27, 40.94, null)).toBe(fratta);
    expect(geoidUndulation(-70, -30)).toBe(GEOID_DEFAULT_M);
  });

  it('converts orthometric heights to ellipsoidal ones, with exaggeration about the relative height', () => {
    const hm = new HeightModel(plane(20), null, origin, { geoidM: 46 });
    expect(hm.toEllipsoid(20)).toBe(66);
    expect(hm.toEllipsoid(20, 0.15)).toBeCloseTo(66.15, 9);
    const ex = new HeightModel(plane(20), null, origin, { geoidM: 46, exaggeration: 3, relativeHeight: 60 });
    expect(ex.toEllipsoid(20)).toBeCloseTo(60 + 6 * 3, 9);
    // Offsets (kerbs, buildings) are not exaggerated.
    expect(ex.toEllipsoid(20, 10) - ex.toEllipsoid(20)).toBeCloseTo(10, 9);
  });
});

describe('Twin: terreno', () => {
  it('samples bilinearly inside and clamps to the nearest edge outside the grid', () => {
    const g = plane(10, 0.01, 0.02);
    const p = f.toLngLat([105, -47]);
    expect(sampleClamped(g, p[0], p[1])).toBeCloseTo(10 + 1.05 - 0.94, 2);
    const east = f.toLngLat([900, 100]), edge = f.toLngLat([600, 100]);
    expect(sampleClamped(g, east[0], east[1])).toBeCloseTo(sampleClamped(g, edge[0], edge[1]), 6);
    const tile = heightmapTile(g, { west: g.west, south: g.south, east: g.east, north: g.north }, 5, 5, 46);
    expect(tile[0]).toBeCloseTo(10 - 6 + 12 + 46, 3); // north-west corner first
    expect(tile[24]).toBeCloseTo(10 + 6 - 12 + 46, 3); // south-east corner last
  });

  it('puts buildings on the lowest ground under the footprint', () => {
    const hm = new HeightModel(plane(10, 0.1), null, origin, { geoidM: 0 });
    const fp = [f.toLngLat([0, 0]), f.toLngLat([20, 0]), f.toLngLat([20, 10]), f.toLngLat([0, 10])];
    expect(footprintBase(hm, fp)).toBeCloseTo(10, 3);
  });
});

describe('Twin: corridoio stradale', () => {
  it('projects vertices on the axis and takes the grade line at their chainage', () => {
    const r = road('r1', 'A', 'N', -200, 0, [30, 34]);
    const hm = new HeightModel(plane(20), net([r]), origin, { geoidM: 46 });
    const p = f.toLngLat([-150, 4.2]); // 50 m from A, 4.2 m left of the axis
    const st = hm.station('r1', p[0], p[1])!;
    expect(st.station).toBeCloseTo(50, 1);
    expect(st.offset).toBeCloseTo(4.2, 1);
    expect(hm.roadZ('r1', p[0], p[1])).toBeCloseTo(designElevation(r.vertical!, 50), 3);
    expect(hm.roadZ('r1', p[0], p[1])).toBeCloseTo(31, 2);
    // Surfaces of other roads and objects off the platform follow the terrain.
    expect(hm.surfaceZ({ roadId: 'nope' }, p[0], p[1])).toBeCloseTo(20, 6);
    const far = f.toLngLat([-150, 60]);
    expect(hm.groundZ(far[0], far[1])).toBeCloseTo(20, 6);
    const on = f.toLngLat([-150, 1]);
    expect(hm.groundZ(on[0], on[1])).toBeCloseTo(31, 2);
    const { flat, min } = ringHeights(hm, [p, f.toLngLat([-100, 4.2]), f.toLngLat([-100, -4.2])], { roadId: 'r1' }, 0.15);
    expect(flat[2]).toBeCloseTo(31 + 46 + 0.15, 2);
    expect(flat[5]).toBeCloseTo(32 + 46 + 0.15, 2);
    expect(min).toBeCloseTo(77.15, 2);
  });

  it('levels junction platforms at the average of the incident roads at the node', () => {
    const roads = [road('a', 'A', 'N', -200, 0, [30, 34]), road('b', 'N', 'B', 0, 200, [36, 40]), { ...road('c', 'N', 'C', 0, 0), axis: [f.toLngLat([0, 0]), f.toLngLat([0, 200])] }];
    const hm = new HeightModel(plane(20), net(roads), origin, { geoidM: 0 });
    expect(hm.nodeZ('N')).toBeCloseTo((34 + 36 + 20) / 3, 6);
    const q = f.toLngLat([3, 3]);
    expect(hm.surfaceZ({ nodeId: 'N' }, q[0], q[1])).toBeCloseTo(30, 6);
    // No profiled road at the node: terrain.
    const flatNet = new HeightModel(plane(20), net([road('a', 'A', 'N', -200, 0)]), origin, { geoidM: 0 });
    expect(flatNet.nodeZ('N')).toBeNull();
    expect(flatNet.surfaceZ({ nodeId: 'N' }, q[0], q[1])).toBeCloseTo(20, 6);
  });

  it('densifies long edges so surfaces follow the ground', () => {
    const ring = densifyRing([f.toLngLat([0, 0]), f.toLngLat([40, 0]), f.toLngLat([40, 4])], f, 8);
    expect(ring.length).toBe(3 + 4 + 0 + 5);
  });

  it('builds 3:2 fill and 1:1 cut side slopes down to the terrain', () => {
    const fill = corridorSlopes(road('a', 'A', 'B', -200, 200, [23, 23]), plane(20), origin, 5);
    const lay = layoutSection(template);
    expect(fill.quads.length).toBe(2 * 80);
    expect(fill.quads.every((q) => !q.cut)).toBe(true);
    expect(fill.cutFootprints).toHaveLength(0);
    const q = fill.quads.find((x) => x.side === 'left')!;
    const inner = f.toMetric([q.ring[0]![0], q.ring[0]![1]]), outer = f.toMetric([q.ring[3]![0], q.ring[3]![1]]);
    expect(inner[1]).toBeCloseTo(lay.outerLeft, 1);
    expect(outer[1] - inner[1]).toBeCloseTo(3 * 1.5, 1);
    expect(q.ring[0]![2]).toBeCloseTo(23, 6);
    expect(q.ring[3]![2]).toBeCloseTo(20, 3);

    const cut = corridorSlopes(road('a', 'A', 'B', -200, 200, [17, 17]), plane(20), origin, 5);
    expect(cut.quads.every((x) => x.cut)).toBe(true);
    const c = cut.quads.find((x) => x.side === 'right')!;
    const ci = f.toMetric([c.ring[0]![0], c.ring[0]![1]]), co = f.toMetric([c.ring[3]![0], c.ring[3]![1]]);
    expect(ci[1] - co[1]).toBeCloseTo(3, 1);
    expect(cut.cutFootprints).toHaveLength(1);
    expect(cut.cutFootprints[0]!.length).toBeGreaterThan(4);
    // At grade: no slopes.
    expect(corridorSlopes(road('a', 'A', 'B', -200, 200, [20, 20]), plane(20), origin, 5).quads).toHaveLength(0);
    expect(corridorSlopes(road('a', 'A', 'B', -200, 200), plane(20), origin, 5).quads).toHaveLength(0);
  });
});
