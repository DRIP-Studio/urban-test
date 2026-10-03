import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LocalFrame, ScenarioHistory, buildGraph, geom, checkRestrictions, osmRestrictions, parseOpeningHours, route, routeVia, zoneGates,
  type CityBaseline, type Network, type Road, type Scenario,
} from '../src';

const baseline = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../../../services/api/seed/frattamaggiore.baseline.json.gz'))).toString('utf8')) as CityBaseline;
let n = 0;
const ids = () => `t${++n}`;
const scenario = (): Scenario => ({ id: 's', name: 'S', isBaseline: false, locked: false, archived: false, createdAt: '2026-01-01', operations: [] });
const ctx = { mode: 'car' as const, day: 1, minutes: 9 * 60 };

function longNamedRoad(net: Network): Road {
  const f = new LocalFrame(baseline.origin);
  return Object.values(net.roads).filter((r) => r.name === 'Via Roma' && r.lanes.length >= 2).sort((a, b) => {
    const L = (r: Road) => r.axis.reduce((t, q, i) => (i ? t + Math.hypot(...(f.toMetric(q).map((v, k) => v - f.toMetric(r.axis[i - 1]!)[k]!) as [number, number])) : 0), 0);
    return L(b) - L(a);
  })[0]!;
}

describe('road restrictions (art. 6 CdS)', () => {
  it('parses OSM restriction tags and conditional opening hours (days 0 = Monday)', () => {
    expect(parseOpeningHours('Mo-Fr 07:00-20:00; Sa 07:00-13:00')).toEqual([
      { days: [0, 1, 2, 3, 4], from: '07:00', to: '20:00' }, { days: [5], from: '07:00', to: '13:00' },
    ]);
    const r = osmRestrictions({ hgv: 'no', maxweight: '7.5', maxheight: '3,5', 'hgv:conditional': 'no @ (Mo-Fr 07:00-20:00)' })!;
    expect(r.hgv).toBe('no');
    expect(r.maxWeightT).toBe(7.5);
    expect(r.maxHeightM).toBe(3.5);
    expect(r.schedule).toEqual([{ days: [0, 1, 2, 3, 4], from: '07:00', to: '20:00' }]);
    expect(osmRestrictions({ highway: 'residential' })).toBeUndefined();
  });

  it('lets trucks route at all (general lanes accept trucks) and blocks them on an HGV ban', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const truckGraph = buildGraph(h.network, new LocalFrame(baseline.origin), { ...ctx, mode: 'truck' });
    expect(truckGraph.edges.length).toBeGreaterThan(1000);
    const road = longNamedRoad(h.network);
    h.commit({ type: 'road.setRestrictions', payload: { roadIds: [road.id], restrictions: { hgv: 'no' } } });
    expect(checkRestrictions(h.network.roads[road.id]!, 'truck', undefined, 1, 600).blocked).toMatch(/pesanti/);
    expect(checkRestrictions(h.network.roads[road.id]!, 'car', undefined, 1, 600).blocked).toBeNull();
    // Only in the time window.
    h.commit({ type: 'road.setRestrictions', payload: { roadIds: [road.id], restrictions: { hgv: 'no', schedule: [{ days: [0, 1, 2, 3, 4], from: '07:00', to: '20:00' }] } } });
    expect(checkRestrictions(h.network.roads[road.id]!, 'truck', undefined, 1, 9 * 60).blocked).not.toBeNull();
    expect(checkRestrictions(h.network.roads[road.id]!, 'truck', undefined, 1, 22 * 60).blocked).toBeNull();
    expect(checkRestrictions(h.network.roads[road.id]!, 'truck', undefined, 6, 9 * 60).blocked).toBeNull();
    // Mass limit with an explicit vehicle.
    h.commit({ type: 'road.setRestrictions', payload: { roadIds: [road.id], restrictions: { maxWeightT: 7.5 } } });
    expect(checkRestrictions(h.network.roads[road.id]!, 'truck', { weightT: 5 }, 1, 600).blocked).toBeNull();
    expect(checkRestrictions(h.network.roads[road.id]!, 'truck', { weightT: 12 }, 1, 600).blocked).toMatch(/massa/);
    expect(() => h.commit({ type: 'road.setRestrictions', payload: { roadIds: [road.id], restrictions: { maxHeightM: 12 } } })).toThrow();
  });

  it('a preferential bus lane is closed to cars only inside its hours', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const road = Object.values(h.network.roads).find((r) => r.oneway !== 'no' && r.lanes.length === 1 && r.lanes[0]!.modes.includes('car'))!;
    const lane = road.lanes[0]!;
    h.commit({ type: 'road.setSection', payload: { roadId: road.id, section: road.section, lanes: [{ ...lane, restriction: 'bus_only', modes: ['bus', 'emergency'], restrictionSchedule: [{ days: [0, 1, 2, 3, 4], from: '07:00', to: '20:00' }] }] } });
    const f = new LocalFrame(baseline.origin);
    const has = (minutes: number, mode: 'car' | 'bus') => buildGraph(h.network, f, { mode, day: 1, minutes }).edges.some((e) => e.roadId === road.id);
    expect(has(9 * 60, 'car')).toBe(false);
    expect(has(9 * 60, 'bus')).toBe(true);
    expect(has(22 * 60, 'car')).toBe(true);
  });
});

describe('ZTL gates and waypoint routing', () => {
  it('finds the entry gates of a ZTL and routes trucks inside only in delivery windows', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const c: [number, number] = [14.2745, 40.9416];
    const d = 0.0015;
    h.commit({ type: 'zone.set', payload: { zone: { id: 'ztl', kind: 'ztl', name: 'ZTL', allowedModes: ['bus', 'emergency', 'bike', 'walk'],
      polygon: [[c[0] - d, c[1] - d], [c[0] + d, c[1] - d], [c[0] + d, c[1] + d], [c[0] - d, c[1] + d]],
      schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' }], deliveryWindows: [{ days: [0, 1, 2, 3, 4], from: '06:00', to: '10:00' }] } } });
    const gates = zoneGates(h.network, baseline.origin, h.network.zones.ztl!);
    expect(gates.filter((g) => g.entry).length).toBeGreaterThan(3);
    const f = new LocalFrame(baseline.origin);
    const inside = (minutes: number) => buildGraph(h.network, f, { mode: 'truck', day: 1, minutes }).blocked.size;
    expect(inside(8 * 60)).toBeLessThan(inside(12 * 60));
  });

  it('routes through intermediate stops: legs add up and the line passes the stop', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const a: [number, number] = [14.262, 40.935], via: [number, number] = [14.2745, 40.9416], b: [number, number] = [14.285, 40.948];
    const direct = route(h.network, baseline.origin, a, b, ctx);
    const r = routeVia(h.network, baseline.origin, [a, via, b], ctx);
    expect(r.found).toBe(true);
    expect(r.legs).toHaveLength(2);
    expect(Math.abs(r.distanceM - r.legs[0]!.distanceM - r.legs[1]!.distanceM)).toBeLessThan(1);
    expect(r.distanceM).toBeGreaterThanOrEqual(direct.distanceM - 1);
    expect(r.steps.some((s) => s.instruction === 'Tappa 1 raggiunta')).toBe(true);
    const f = new LocalFrame(baseline.origin);
    const v = f.toMetric(via);
    expect(Math.min(...r.line.map((q) => { const m = f.toMetric(q); return Math.hypot(m[0] - v[0], m[1] - v[1]); }))).toBeLessThan(80);
  });
});

describe('buffer outline', () => {
  it('follows an L-shaped street instead of filling its convex hull', () => {
    const L: [number, number][] = [[0, 0], [200, 0], [200, 200]];
    const ring = geom.bufferOutline([L], 20);
    expect(ring.length).toBeGreaterThan(4);
    const area = Math.abs(geom.ringArea(ring));
    // Corridor ≈ 2·20·400 + caps ≈ 17 000 m²; the hull would be ≈ 30 000 m².
    expect(area).toBeGreaterThan(13_000);
    expect(area).toBeLessThan(22_000);
    // Every vertex is within ~radius + one cell of the street.
    for (const p of ring) expect(geom.project(L, p).d).toBeLessThan(20 + 20 / 3 + 1);
  });
});
