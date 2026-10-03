import { describe, expect, it } from 'vitest';
import { LocalFrame, type CityBaseline } from '@drip-urban/core';
import { MODES, defaultLine, lineMetrics, proposeBikeStations, upgradeLine } from '../src/transit/model';

const origin: [number, number] = [14.27, 40.94];
const f = new LocalFrame(origin);
const sq = (x: number, y: number, s: number) => [f.toLngLat([x, y]), f.toLngLat([x + s, y]), f.toLngLat([x + s, y + s]), f.toLngLat([x, y + s])];
// A 1 km strip of 4-storey blocks along the line.
const buildings = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`b${i}`, { id: `b${i}`, footprint: sq(i * 25, 30, 18), heightM: 12, minHeightM: 0, provenance: { kind: 'osm', source: 't' } }]));
const baseline = { id: 'b', name: 'b', bbox: [14.26, 40.93, 14.29, 40.95], origin, nodes: {}, roads: {}, buildings, features: {}, assets: {}, sources: [] } as unknown as CityBaseline;

describe('TPL estimates', () => {
  it('derives fleet, capacity, catchment and boardings from frequencies and buildings', () => {
    const line = { ...defaultLine('l1', 'tram', [f.toLngLat([0, 0]), f.toLngLat([1000, 0])], 0), stops: [0, 250, 500, 750, 1000].map((x, i) => ({ id: `s${i}`, name: `S${i}`, at: f.toLngLat([x, 0]) })) };
    const m = lineMetrics(line, baseline);
    expect(m.lengthKm).toBeCloseTo(1, 2);
    expect(m.fleet).toBeGreaterThanOrEqual(2);
    expect(m.capacityPeak).toBe(Math.round((60 / line.headways.peak) * line.capacity));
    expect(m.catchmentPop).toBeGreaterThan(300);
    expect(m.boardingsDay).toBeGreaterThan(0);
    // More frequent service attracts more riders.
    const better = lineMetrics({ ...line, headways: { ...line.headways, peak: 4 } }, baseline);
    expect(better.boardingsDay).toBeGreaterThan(m.boardingsDay);
    expect(better.fleet).toBeGreaterThanOrEqual(m.fleet);
  });

  it('upgrades 1.0 single-headway lines and proposes bike stations where people live', () => {
    const old = upgradeLine({ id: 'x', line: [origin, f.toLngLat([500, 0])], headwayMin: 10, mode: 'bus' } as never);
    expect(old.headways.peak).toBe(10);
    expect(MODES[old.mode].onRoad).toBe(true);
    const st = proposeBikeStations(baseline, baseline.bbox, 400, 10);
    expect(st.length).toBeGreaterThan(0);
    expect(st.every((s) => s.docks >= 10 && s.docks <= 30)).toBe(true);
  });
});
