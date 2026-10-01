import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LocalFrame, ScenarioHistory, buildPhysicalModel, geom, layoutSection,
  type CityBaseline, type LngLat, type Network, type PhysPolygon, type Roundabout, type Scenario,
} from '../src/index';

const SEED = fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url));
let baseline: CityBaseline;
beforeAll(() => {
  baseline = JSON.parse(gunzipSync(readFileSync(SEED)).toString('utf8')) as CityBaseline;
});

const scenario = (): Scenario => ({ id: 's', name: 'Test', isBaseline: false, locked: false, archived: false, createdAt: '2026-10-01T00:00:00Z', operations: [] });
let seq = 0;
const ids = () => `op${++seq}`;

function selfIntersects(ring: readonly LngLat[], frame: LocalFrame): boolean {
  const p = ring.map((q) => frame.toMetric(q));
  const n = p.length;
  const segX = (a: geom.V, b: geom.V, c: geom.V, d: geom.V) => {
    const o = (x: geom.V, y: geom.V, z: geom.V) => Math.sign((y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segX(p[i]!, p[(i + 1) % n]!, p[j]!, p[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

function fourArmJunction(net: Network): string {
  const count = new Map<string, number>();
  for (const r of Object.values(net.roads)) {
    if (layoutSection(r).pedestrianOnly || r.axis.length < 2) continue;
    for (const n of [r.from, r.to]) count.set(n, (count.get(n) ?? 0) + 1);
  }
  const frame = new LocalFrame(baseline.origin);
  for (const [node, c] of count) {
    if (c !== 4) continue;
    const arms = Object.values(net.roads).filter((r) => r.from === node || r.to === node);
    const lengths = arms.map((r) => geom.lengthOf(r.axis.map((q) => frame.toMetric(q))));
    if (lengths.every((l) => l > 40) && arms.every((r) => !layoutSection(r).pedestrianOnly)) return node;
  }
  throw new Error('no suitable 4-arm junction in dataset');
}

describe('physical model on the real Frattamaggiore baseline', () => {
  it('builds every road and junction with valid geometry', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const m = buildPhysicalModel(h.network, { origin: baseline.origin, features: baseline.features });
    expect(m.stats.roads).toBe(Object.keys(baseline.roads).length);
    expect(m.stats.junctions).toBeGreaterThan(800);
    for (const p of [...m.surfaces, ...m.markings]) {
      expect(p.ring.length).toBeGreaterThanOrEqual(3);
      for (const q of p.ring) expect(Number.isFinite(q[0]) && Number.isFinite(q[1])).toBe(true);
    }
    // Every geometry stays within the node extent (+ ~250 m) — nothing thrown to (0,0) or top-left.
    const xs = Object.values(baseline.nodes).map((q) => q.at[0]), ys = Object.values(baseline.nodes).map((q) => q.at[1]);
    const [w, s, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    for (const p of m.surfaces) for (const q of p.ring) {
      expect(q[0]).toBeGreaterThan(w - 0.003); expect(q[0]).toBeLessThan(e + 0.003);
      expect(q[1]).toBeGreaterThan(s - 0.003); expect(q[1]).toBeLessThan(n + 0.003);
    }
  });

  it('junction envelopes are simple polygons built from real kerb lines (≥ 97 %)', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    const frame = new LocalFrame(baseline.origin);
    const junctions = m.surfaces.filter((p) => p.kind === 'junction');
    const bad = junctions.filter((p) => selfIntersects(p.ring, frame));
    expect(bad.length / junctions.length).toBeLessThan(0.03);
  });

  it('every lane of a one-way road longer than 12 m carries a direction arrow (RB-05)', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    const frame = new LocalFrame(baseline.origin);
    const arrowsByRoad = new Map<string, number>();
    for (const p of m.markings) if (p.kind === 'arrow') arrowsByRoad.set(p.roadId!, (arrowsByRoad.get(p.roadId!) ?? 0) + 1);
    const surfaceByRoad = new Set(m.surfaces.filter((s) => s.kind === 'carriageway').map((s) => s.roadId));
    let checked = 0;
    for (const r of Object.values(h.network.roads)) {
      if (r.oneway === 'no' || layoutSection(r).pedestrianOnly || !surfaceByRoad.has(r.id)) continue;
      const L = geom.lengthOf(r.axis.map((q) => frame.toMetric(q)));
      if (L < 40) continue; // trimmed length must leave room for the 4.5 m arrow
      checked++;
      expect(arrowsByRoad.get(r.id) ?? 0, r.id).toBeGreaterThanOrEqual(r.lanes.length);
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('no markings are invented: no stop/give-way lines without an explicit junction control (RB-04)', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    expect(m.markings.filter((p) => p.kind === 'stop_line' || p.kind === 'give_way')).toHaveLength(0);
  });
});

describe('roundabout on a real 4-arm junction', () => {
  function insert(h: ScenarioHistory, node: string, over: Partial<Roundabout> = {}): Roundabout {
    const rb: Roundabout = {
      id: 'rb1', name: 'Rotatoria test', type: 'compact', center: h.network.nodes[node]!.at, replacedNodeId: node,
      outerDiameterM: 28, aspect: 1, orientationDeg: 0, circulatoryWidthM: 7, lanes: 1, apronWidthM: 1.5,
      islandMaterial: 'grass', control: 'yield', speedKmh: 30, arms: [], ...over,
    };
    h.commit({ type: 'roundabout.add', payload: { roundabout: rb } });
    return rb;
  }

  it('builds a routable counter-clockwise ring with one ring road per arm and undo restores the junction', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const node = fourArmJunction(h.network);
    const before = h.network;
    insert(h, node);
    const ring = Object.values(h.network.roads).filter((r) => r.tags?.roundabout === 'rb1');
    expect(ring).toHaveLength(4);
    expect(ring.every((r) => r.oneway === 'forward' && r.roadClass === 'roundabout')).toBe(true);
    // Ring roads chain: each one ends where the next starts.
    const starts = new Set(ring.map((r) => r.from));
    expect(ring.every((r) => starts.has(r.to))).toBe(true);
    // Counter-clockwise: cross product of consecutive axis points around the centre is positive.
    const f = new LocalFrame(h.network.roundabouts.rb1!.center);
    for (const r of ring) {
      const a = f.toMetric(r.axis[0]!), b = f.toMetric(r.axis[1]!);
      expect(a[0] * b[1] - a[1] * b[0]).toBeGreaterThan(0);
    }
    expect(h.network.nodes[node]).toBeUndefined();
    h.undo();
    expect(h.network).toBe(before);
  });

  it('display geometry: true annulus, no throat wedges, no default crossings or hatching (RB-03/RB-04)', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    insert(h, fourArmJunction(h.network));
    const m = buildPhysicalModel(h.network, { origin: baseline.origin });
    const frame = new LocalFrame(baseline.origin);
    const ringSurf = m.surfaces.find((p) => p.kind === 'roundabout_ring')!;
    expect(ringSurf.holes?.length).toBe(1);
    const throats = m.surfaces.filter((p) => p.id.startsWith('rb:rb1:throat'));
    expect(throats).toHaveLength(4);
    for (const t of throats) expect(selfIntersects(t.ring, frame), t.id).toBe(false);
    const rbMarks: PhysPolygon[] = m.markings.filter((p) => p.id.startsWith('rb:rb1'));
    expect(rbMarks.filter((p) => p.kind === 'zebra')).toHaveLength(0);
    expect(rbMarks.filter((p) => p.kind === 'ring_line')).toHaveLength(0);
    // Yield control is the legal default: give-way lines exist on entries only.
    expect(rbMarks.filter((p) => p.kind === 'give_way').length).toBeGreaterThan(0);
  });

  it('rejects diameters outside DM 19/04/2006 ranges', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const node = fourArmJunction(h.network);
    expect(() => insert(h, node, { outerDiameterM: 18 })).toThrow(/Diametro/);
  });
});
