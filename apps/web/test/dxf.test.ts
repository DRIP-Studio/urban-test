import { describe, expect, it } from 'vitest';
import { LocalFrame, type Network } from '@drip-urban/core';
import { buildDxf, toUtm, utmZone } from '../src/export/dxf';

describe('DXF export', () => {
  it('projects to UTM with metric distances consistent with the local frame', () => {
    const o: [number, number] = [14.2745, 40.9416];
    expect(utmZone(o[0])).toBe(33);
    const [e, n] = toUtm(o[0], o[1], 33);
    // Frattamaggiore lies around E 438 km, N 4 532 km in UTM 33N.
    expect(e).toBeGreaterThan(420_000); expect(e).toBeLessThan(460_000);
    expect(n).toBeGreaterThan(4_510_000); expect(n).toBeLessThan(4_550_000);
    const f = new LocalFrame(o);
    const p = f.toLngLat([800, 600]);
    const [e2, n2] = toUtm(p[0], p[1], 33);
    // Scale factor 0.9996 near the central meridian zone edge: within 0.2 %.
    expect(Math.hypot(e2 - e, n2 - n) / 1000).toBeCloseTo(1, 2);
  });

  it('writes layered R12 entities for roads, zones and assets', () => {
    const o: [number, number] = [14.27, 40.94];
    const f = new LocalFrame(o);
    const net = {
      nodes: {}, junctions: {}, roundabouts: {}, signalPlans: {}, areas: {},
      roads: { r1: { id: 'r1', from: 'a', to: 'b', name: 'Via Roma', roadClass: 'residential', axis: [f.toLngLat([0, 0]), f.toLngLat([50, 0])], oneway: 'no', speedKmh: 30, lanes: [], section: { elements: [] }, provenance: {} } },
      zones: { z1: { id: 'z1', kind: 'ztl', name: 'ZTL', polygon: [f.toLngLat([0, 0]), f.toLngLat([10, 0]), f.toLngLat([10, 10])], allowedModes: [] } },
      assets: { a1: { id: 'a1', type: 'it.sign.zona_30_kmh', at: f.toLngLat([5, 5]), rotationDeg: 0, state: 'project', properties: {}, provenance: { kind: 'project', source: 't' } } },
    } as unknown as Network;
    const dxf = buildDxf({ network: net, physical: null, buildings: [], origin: o, title: 'Test' });
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf).toContain('ASSI_STRADALI');
    expect(dxf).toContain('Via Roma');
    expect(dxf).toContain('SEGNALI_VERTICALI');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
    expect((dxf.match(/\r\nPOLYLINE\r\n/g) ?? []).length).toBe(2);
  });
});
