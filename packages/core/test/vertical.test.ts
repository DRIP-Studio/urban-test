import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ScenarioHistory, checkVertical, crossSection, designElevation, earthworks, groundProfile, layoutSection, proposeVertical, sampleTerrain, stationing, verticalRules,
  type CityBaseline, type Road, type Scenario, type TerrainGrid,
} from '../src/index';

const SEED = fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url));
let baseline: CityBaseline;
beforeAll(() => { baseline = JSON.parse(gunzipSync(readFileSync(SEED)).toString('utf8')) as CityBaseline; });
const scenario = (): Scenario => ({ id: 's', name: 'Test', isBaseline: false, locked: false, archived: false, createdAt: '2026-10-04T00:00:00Z', operations: [] });
let seq = 0;
const ids = () => `v${++seq}`;

/** Plane terrain over the city: z = z0 + gx·(east metres) + gy·(north metres). */
function plane(z0: number, gx: number, gy: number): TerrainGrid {
  const [w, s, e, n] = baseline.bbox;
  const nx = 60, ny = 60, mx = (e - w) * 111_320 * Math.cos(((s + n) / 2) * Math.PI / 180), my = (n - s) * 111_320;
  const z: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z.push(z0 + gx * (mx * i / (nx - 1)) + gy * (my * j / (ny - 1)));
  return { west: w, south: s, east: e, north: n, nx, ny, z, source: 'test', resolutionM: mx / (nx - 1) };
}

function longRoad(h: ScenarioHistory): Road {
  const [w, s, e, n] = baseline.bbox;
  const pad = 0.002;
  const roads = Object.values(h.network.roads).filter((r) => r.lanes.some((l) => l.modes.includes('car')) && r.axis.every((q) => q[0] > w + pad && q[0] < e - pad && q[1] > s + pad && q[1] < n - pad));
  return roads.map((r) => ({ r, L: stationing(r, baseline.origin).length })).sort((a, b) => b.L - a.L)[0]!.r;
}

describe('altimetria', () => {
  it('samples the DTM bilinearly and builds the ground profile', () => {
    const g = plane(20, 0, 0.01);
    const [w, s, e, n] = baseline.bbox;
    expect(sampleTerrain(g, (w + e) / 2, s)).toBeCloseTo(20, 6);
    expect(Number.isNaN(sampleTerrain(g, w - 0.01, s))).toBe(true);
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = longRoad(h);
    const prof = groundProfile(road, g, baseline.origin, 5);
    expect(prof[0]!.station).toBe(0);
    expect(prof.every((p) => Number.isFinite(p.z))).toBe(true);
    void n;
  });

  it('computes parabolic vertical curves tangent to both grades', () => {
    const v = { pvis: [{ station: 0, elevation: 100 }, { station: 100, elevation: 104, curveLength: 80 }, { station: 200, elevation: 100 }] };
    expect(designElevation(v, 100)).toBeCloseTo(103.2, 6);
    expect(designElevation(v, 60)).toBeCloseTo(102.4, 6); // start of curve on the 4% grade
    expect(designElevation(v, 140)).toBeCloseTo(102.4, 6);
    expect(designElevation(v, 0)).toBe(100);
    // Tangency: slope just inside the curve equals the incoming grade.
    expect((designElevation(v, 60.01) - designElevation(v, 60)) / 0.01).toBeCloseTo(0.04, 3);
  });

  it('applies DM 5/11/2001 limits: grades and sight-distance radii', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = { ...longRoad(h), roadClass: 'residential', speedKmh: 30 };
    const r = verticalRules(road);
    expect(r.maxGradePct).toBe(10);
    expect(r.rvConvexMinM).toBeGreaterThan(100);
    const L = stationing(road, baseline.origin).length;
    const steep = { pvis: [{ station: 0, elevation: 0 }, { station: L, elevation: L * 0.15 }] };
    expect(checkVertical(road, steep, L).some((i) => i.severity === 'error' && i.message.includes('15.0%'))).toBe(true);
  });

  it('proposes a buildable grade line on steep ground and computes earthworks', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = longRoad(h);
    const st = stationing(road, baseline.origin);
    // Ground rising 14% along the road direction (steeper than any urban maximum).
    const a = st.pts[0]!, b = st.pts[st.pts.length - 1]!;
    const dir = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])];
    const g = plane(50, 0.14 * dir[0]!, 0.14 * dir[1]!);
    const v = proposeVertical(h.network, road, g, baseline.origin);
    expect(v.pvis[0]!.station).toBe(0);
    expect(v.pvis[v.pvis.length - 1]!.station).toBeCloseTo(st.length, 1);
    expect(checkVertical(road, v, st.length).filter((i) => i.severity === 'error' && i.message.includes('Livelletta'))).toEqual([]);
    h.commit({ type: 'road.setVertical', payload: { roadId: road.id, vertical: v } });
    expect(h.network.roads[road.id]!.vertical?.pvis.length).toBe(v.pvis.length);
    const ew = earthworks(h.network.roads[road.id]!, v, g, baseline.origin, 10);
    expect(ew.cutM3 + ew.fillM3).toBeGreaterThan(0);
    expect(ew.platformWidthM).toBeCloseTo(layoutSection(road).outerLeft - layoutSection(road).outerRight, 6);
    h.commit({ type: 'road.setVertical', payload: { roadId: road.id, vertical: null } });
    expect(h.network.roads[road.id]!.vertical).toBeUndefined();
  });

  it('measures fill on flat ground 1 m below a flat platform (with 3:2 slopes)', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = longRoad(h);
    const L = stationing(road, baseline.origin).length;
    const g = plane(10, 0, 0);
    const v = { pvis: [{ station: 0, elevation: 11 }, { station: L, elevation: 11 }] };
    const ew = earthworks(road, v, g, baseline.origin, 5);
    const w = layoutSection(road).outerLeft - layoutSection(road).outerRight;
    expect(ew.cutM3).toBe(0);
    expect(ew.fillM3).toBeGreaterThan(L * (w + 1.5) * 0.97);
    expect(ew.fillM3).toBeLessThan(L * (w + 1.5) * 1.03);
    const cs = crossSection(road, v, g, baseline.origin, L / 2);
    expect(cs.slopes).toHaveLength(2);
    expect(() => h.commit({ type: 'road.setVertical', payload: { roadId: road.id, vertical: { pvis: [{ station: 10, elevation: 1 }, { station: 5, elevation: 1 }] } } })).toThrow();
  });
});
