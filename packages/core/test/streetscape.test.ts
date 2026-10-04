import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocalFrame, OperationRejected, ScenarioHistory, buildPhysicalModel, horizontalAlignment, layoutSection, minTangent, osmStructure, roadText, type CityBaseline, type Road, type Scenario } from '../src/index';

const SEED = fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url));
let baseline: CityBaseline;
beforeAll(() => { baseline = JSON.parse(gunzipSync(readFileSync(SEED)).toString('utf8')) as CityBaseline; });
const scenario = (): Scenario => ({ id: 's', name: 'T', isBaseline: false, locked: false, archived: false, createdAt: '2026-10-04T00:00:00Z', operations: [] });
let seq = 0;
const ids = () => `x${++seq}`;
const P = { kind: 'project' as const, source: 'test' };
const car = (r: Road) => r.lanes.some((l) => l.modes.includes('car')) && !layoutSection(r).pedestrianOnly;

describe('streetscape: traffic calming, markings, structures', () => {
  it('refuses humps above 50 km/h and builds raised crossings with ramps and markings', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = Object.values(h.network.roads).find((r) => car(r) && r.speedKmh <= 50 && r.axis.length >= 2)!;
    const fast = { ...road, speedKmh: 70 };
    h.commit({ type: 'road.update', payload: { roadId: road.id, changes: { speedKmh: 70 } } });
    expect(() => h.commit({ type: 'feature.set', payload: { feature: { id: 'f1', kind: 'speed_hump', roadId: road.id, station: 10, lengthM: 0.3, rampM: 0.3, heightM: 0.03, state: 'project', properties: {}, provenance: P } } })).toThrow(OperationRejected);
    void fast;
    h.commit({ type: 'road.update', payload: { roadId: road.id, changes: { speedKmh: 30 } } });
    h.commit({ type: 'feature.set', payload: { feature: { id: 'f2', kind: 'raised_crossing', roadId: road.id, station: 12, lengthM: 4, rampM: 1.2, heightM: 0.1, state: 'project', properties: {}, provenance: P } } });
    h.commit({ type: 'marking.set', payload: { marking: { id: 'm1', kind: 'text', geometry: [road.axis[0]!, road.axis[1]!], color: 'white', text: 'STOP', state: 'project', provenance: P } } });
    h.commit({ type: 'marking.set', payload: { marking: { id: 'm2', kind: 'symbol', symbol: 'bike', geometry: [road.axis[0]!, road.axis[1]!], color: 'white', state: 'project', provenance: P } } });
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    expect(m.surfaces.filter((s) => s.kind === 'raised').length).toBe(3);
    expect(m.surfaces.filter((s) => s.kind === 'raised').every((s) => s.heightM > 0)).toBe(true);
    expect(m.markings.filter((x) => x.id.startsWith('fm:f2')).length).toBeGreaterThan(5);
    expect(m.markings.filter((x) => x.id.startsWith('cm:m1')).length).toBeGreaterThanOrEqual(8); // S T O P strokes
    expect(m.markings.filter((x) => x.id.startsWith('cm:m2')).length).toBeGreaterThan(5);
    h.commit({ type: 'feature.remove', payload: { featureIds: ['f2'] } });
    expect(buildPhysicalModel(h.network, { origin: baseline.origin }).surfaces.some((s) => s.kind === 'raised')).toBe(false);
  });

  it('draws every custom marking kind (zebra, bike crossing, shark teeth, island, bus/bike lane, reserved bays)', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const seg = (r: Road) => Math.hypot((r.axis[1]![0] - r.axis[0]![0]) * 84000, (r.axis[1]![1] - r.axis[0]![1]) * 111000);
    const road = Object.values(h.network.roads).find((r) => car(r) && r.axis.length >= 2 && seg(r) > 40)!;
    const [a, b] = [road.axis[0]!, road.axis[1]!];
    const mid = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const across: [number, number][] = [[mid(0.5)[0] - 0.00006, mid(0.5)[1] + 0.00006], [mid(0.5)[0] + 0.00006, mid(0.5)[1] - 0.00006]];
    const poly: [number, number][] = [mid(0.2), mid(0.4), [mid(0.4)[0] + 0.00003, mid(0.4)[1] + 0.00003]];
    const kinds: [string, Partial<Record<string, unknown>>, [number, number][]][] = [
      ['zebra', {}, across], ['bike_crossing', { color: 'green' }, across], ['shark_teeth', {}, across], ['island', {}, poly],
      ['bus_lane', {}, [mid(0), mid(1)]], ['bike_lane', {}, [mid(0), mid(1)]], ['speed_number', { text: '30' }, [mid(0.5), mid(0.6)]],
      ['parking_bays', { bays: { layout: 'perpendicular', lengthM: 5, widthM: 3.2, side: 'right', purpose: 'disabled' } }, [mid(0), mid(1)]],
      ['parking_bays', { bays: { layout: 'parallel', lengthM: 5, widthM: 2, side: 'right', purpose: 'taxi' } }, [mid(0), mid(1)]],
    ];
    kinds.forEach(([kind, extra, geometry], i) => h.commit({ type: 'marking.set', payload: { marking: { id: `k${i}`, kind, geometry, color: 'white', state: 'project', provenance: P, ...extra } } }));
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    kinds.forEach(([kind], i) => expect(m.markings.filter((x) => x.id.startsWith(`cm:k${i}:`)).length, kind).toBeGreaterThan(0));
    expect(m.surfaces.some((x) => x.id === 'cm:k3:isl' && x.heightM === 0.15)).toBe(true);
    expect(m.markings.filter((x) => x.id.startsWith('cm:k7:')).every((x) => x.material === 'road_marking_yellow')).toBe(true);
    expect(m.markings.filter((x) => x.id.startsWith('cm:k4:')).some((x) => x.material === 'road_marking_yellow')).toBe(true);
  });

  it('marks reserved bus lanes in yellow with BUS', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = Object.values(h.network.roads).find((r) => car(r) && r.lanes.filter((l) => l.direction !== 'backward').length >= 2 && r.axis.length >= 2)!;
    const lane = road.lanes.filter((l) => l.direction !== 'backward').sort((x, y) => x.index - y.index)[0]!;
    h.commit({ type: 'road.setSection', payload: { roadId: road.id, lanes: road.lanes.map((l) => (l.id === lane.id ? { ...l, restriction: 'bus_only', priority: 'transit' } : l)), section: road.section } });
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    expect(m.markings.some((x) => x.id.startsWith(`m:${road.id}:`) && x.material === 'road_marking_yellow')).toBe(true);
  });

  it('draws road text across the lane with letters elongated along travel', () => {
    const r = roadText('BUS', [0, 0], [0, 1], 3, 1.6);
    const ys = r.flat().map((p) => p[1]), xs = r.flat().map((p) => p[0]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1.5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(3.1);
  });

  it('adds parking bays to parking strips and preselection arrows before junctions', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const before = buildPhysicalModel(h.network, { origin: baseline.origin });
    const withParking = Object.values(h.network.roads).filter((r) => r.section.elements.some((e) => e.kind === 'parking'));
    if (withParking.length) expect(before.markings.some((x) => x.kind === 'parking_bay')).toBe(true);
    // A two-lane one-way approach into a junction gets turn arrows.
    const deg = new Map<string, number>();
    for (const r of Object.values(h.network.roads)) if (car(r)) for (const n of [r.from, r.to]) deg.set(n, (deg.get(n) ?? 0) + 1);
    const road = Object.values(h.network.roads).find((r) => car(r) && (deg.get(r.to) ?? 0) >= 3 && r.lanes.filter((l) => l.direction !== 'backward').length >= 2);
    if (road) {
      const m = buildPhysicalModel(h.network, { origin: baseline.origin });
      expect(m.markings.some((x) => x.id.startsWith(`pa:${road.id}:`))).toBe(true);
    }
  });

  it('marks bridges and removes/restores baseline buildings', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = Object.values(h.network.roads).find(car)!;
    h.commit({ type: 'road.setStructure', payload: { roadIds: [road.id], structure: { type: 'viaduct', heightM: 6.5, layer: 1, piersEveryM: 30 } } });
    expect(h.network.roads[road.id]!.structure?.type).toBe('viaduct');
    const b = Object.keys(baseline.buildings)[0]!;
    h.commit({ type: 'building.remove', payload: { buildingIds: [b] } });
    expect(h.network.removedBuildings?.[b]).toBe(true);
    h.commit({ type: 'building.remove', payload: { buildingIds: [b], restore: true } });
    expect(h.network.removedBuildings?.[b]).toBeUndefined();
  });
});

describe('OSM structures', () => {
  it('maps bridge/tunnel/layer tags to Road.structure', () => {
    expect(osmStructure({ bridge: 'viaduct', layer: '2' })).toMatchObject({ type: 'viaduct', layer: 2, heightM: 11 });
    expect(osmStructure({ bridge: 'yes' })).toMatchObject({ type: 'bridge', layer: 1 });
    expect(osmStructure({ tunnel: 'yes', layer: '-1' })).toMatchObject({ type: 'tunnel', layer: -1 });
    expect(osmStructure({ highway: 'primary' })).toBeUndefined();
  });
});

describe('horizontal alignment (DM 5/11/2001 § 5.2)', () => {
  it('splits an axis into tangents and a curve with the right radius and flags a tight one', () => {
    const o: [number, number] = [14.27, 40.94];
    const f = new LocalFrame(o);
    // 100 m tangent, 90° curve of R = 60 m, 100 m tangent.
    const pts: [number, number][] = [];
    for (let x = 0; x <= 100; x += 5) pts.push([x, 0]);
    for (let a = 2; a <= 90; a += 2) { const t = (a * Math.PI) / 180; pts.push([100 + 60 * Math.sin(t), 60 - 60 * Math.cos(t)]); }
    for (let y = 65; y <= 160; y += 5) pts.push([160, y]);
    const road = { ...Object.values(baseline.roads).find((r) => r.roadClass === 'secondary')!, axis: pts.map((p) => f.toLngLat(p)), speedKmh: 70 } as Road;
    const al = horizontalAlignment(road, o);
    const curves = al.elements.filter((e) => e.kind === 'curve');
    expect(curves).toHaveLength(1);
    expect(curves[0]!.radiusM!).toBeGreaterThan(50);
    expect(curves[0]!.radiusM!).toBeLessThan(72);
    expect(curves[0]!.deflectionDeg!).toBeGreaterThan(80);
    expect(curves[0]!.direction).toBe('left');
    expect(al.rMinM).toBeGreaterThan(150); // V 80 km/h
    expect(al.issues.some((i) => /sotto il minimo/.test(i.message))).toBe(true);
    expect(minTangent(50)).toBe(40);
  });
});
