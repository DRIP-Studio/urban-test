import { describe, expect, it } from 'vitest';
import {
  LocalFrame, NetworkReplayer, OperationRejected, ScenarioHistory, ScenarioReadOnly, bearingDeg, distanceM,
  type Asset, type CityBaseline, type Operation, type Road, type Scenario,
} from '../src/index';

const osm = { kind: 'osm', source: 'OpenStreetMap contributors (ODbL)' } as const;

function road(id: string, oneway: Road['oneway'] = 'no'): Road {
  return {
    id, from: 'a', to: 'b', name: 'Via Roma', roadClass: 'residential',
    axis: [[14.27, 40.94], [14.271, 40.94]], oneway, speedKmh: 50,
    lanes: [
      { id: `${id}:l0`, index: 0, direction: 'forward', widthM: 3, modes: ['car'], turns: ['through'] },
      { id: `${id}:l1`, index: 1, direction: 'backward', widthM: 3, modes: ['car'], turns: ['through'] },
    ],
    section: { elements: [] },
    provenance: { geometry: osm, width: osm },
  };
}

const existingTree: Asset = {
  id: 'tree-1', type: 'vegetation.tree.medium', at: [14.2705, 40.9401], rotationDeg: 0,
  state: 'existing', properties: {}, provenance: osm,
};

const baseline: CityBaseline = {
  id: 'base', name: 'Test', bbox: [14.26, 40.93, 14.28, 40.95], origin: [14.27, 40.94],
  nodes: { a: { id: 'a', at: [14.27, 40.94] }, b: { id: 'b', at: [14.271, 40.94] } },
  roads: { r1: road('r1') }, buildings: {}, features: {}, assets: { 'tree-1': existingTree }, sources: [osm],
};

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  id: 's1', name: 'Scenario A', isBaseline: false, locked: false, archived: false,
  createdAt: '2026-10-01T00:00:00Z', operations: [], ...over,
});

let n = 0;
const ids = () => `op-${++n}`;

it('worker structured clones preserve replay checkpoints, but changed content under the same id invalidates them', () => {
  const replayer = new NetworkReplayer();
  const op: Operation = { id: 'stable-id', type: 'road.update', payload: { roadId: 'r1', changes: { speedKmh: 30 } }, author: 'tester', at: '2026-10-08' };
  const first = replayer.derive(baseline, [op]).net;
  expect(replayer.derive(baseline, structuredClone([op])).net).toBe(first);
  const changed = { ...op, payload: { roadId: 'r1', changes: { speedKmh: 40 } } };
  expect(replayer.derive(baseline, [changed]).net.roads.r1!.speedKmh).toBe(40);
  expect(replayer.derive(baseline, [op]).net.roads.r1!.speedKmh).toBe(30);
});

describe('ScenarioHistory', () => {
  it('commits, undoes and redoes without touching the baseline', () => {
    const h = new ScenarioHistory(baseline, scenario(), 'tester', ids);
    h.commit({ type: 'road.setOneway', payload: { roadId: 'r1', oneway: 'forward' } });
    expect(h.network.roads.r1!.oneway).toBe('forward');
    expect(h.network.roads.r1!.lanes.every((l) => l.direction === 'forward')).toBe(true);
    expect(h.network.roads.r1!.provenance.oneway?.kind).toBe('project');
    expect(baseline.roads.r1!.oneway).toBe('no');

    expect(h.undo()?.label).toContain('Senso di marcia');
    expect(h.network.roads.r1!.oneway).toBe('no');
    expect(h.redo()).not.toBeNull();
    expect(h.network.roads.r1!.oneway).toBe('forward');
  });

  it('a new commit clears the redo stack', () => {
    const h = new ScenarioHistory(baseline, scenario(), 'tester', ids);
    h.commit({ type: 'road.update', payload: { roadId: 'r1', changes: { speedKmh: 30 } } });
    h.undo();
    h.commit({ type: 'road.update', payload: { roadId: 'r1', changes: { name: 'Corso Durante' } } });
    expect(h.canRedo).toBe(false);
    expect(h.network.roads.r1!.speedKmh).toBe(50);
  });

  it('rejects invalid operations and leaves state unchanged', () => {
    const h = new ScenarioHistory(baseline, scenario(), 'tester', ids);
    expect(() => h.commit({ type: 'road.update', payload: { roadId: 'r1', changes: { speedKmh: 500 } } })).toThrow(OperationRejected);
    expect(() => h.commit({ type: 'asset.add', payload: { assets: [{ ...existingTree, id: 'x', at: [Number.NaN, 0] }] } })).toThrow(OperationRejected);
    expect(h.scenario.operations).toHaveLength(0);
  });

  it('refuses edits on baseline and locked scenarios', () => {
    expect(() => new ScenarioHistory(baseline, scenario({ isBaseline: true }), 't', ids)
      .commit({ type: 'road.update', payload: { roadId: 'r1', changes: { speedKmh: 30 } } })).toThrow(ScenarioReadOnly);
    expect(() => new ScenarioHistory(baseline, scenario({ locked: true }), 't', ids)
      .commit({ type: 'road.update', payload: { roadId: 'r1', changes: { speedKmh: 30 } } })).toThrow(ScenarioReadOnly);
  });

  it('removing an existing asset marks it removed; removing a project asset deletes it', () => {
    const h = new ScenarioHistory(baseline, scenario(), 'tester', ids);
    const bench: Asset = { ...existingTree, id: 'bench-1', type: 'furniture.bench', state: 'project', provenance: { kind: 'project', source: 'test' } };
    h.commit({ type: 'asset.add', payload: { assets: [bench] } });
    h.commit({ type: 'asset.remove', payload: { assetIds: ['tree-1', 'bench-1'] } });
    expect(h.network.assets['tree-1']!.state).toBe('removed');
    expect(h.network.assets['bench-1']).toBeUndefined();
  });

  it('keeps the geographic anchor of an asset through rotation edits', () => {
    const h = new ScenarioHistory(baseline, scenario(), 'tester', ids);
    h.commit({ type: 'asset.update', payload: { assetId: 'tree-1', changes: { rotationDeg: -90 } } });
    expect(h.network.assets['tree-1']!.at).toEqual(existingTree.at);
    expect(h.network.assets['tree-1']!.rotationDeg).toBe(270);
  });
});

describe('LocalFrame', () => {
  it('round-trips WGS84 ↔ metres within a millimetre', () => {
    const f = new LocalFrame([14.2745, 40.9416]);
    const p = [14.2851, 40.9502] as const;
    const back = f.toLngLat(f.toMetric(p));
    expect(Math.abs(back[0] - p[0]) * f.scale.lon).toBeLessThan(1e-3);
    expect(Math.abs(back[1] - p[1]) * f.scale.lat).toBeLessThan(1e-3);
  });

  it('matches known distances and bearings', () => {
    // 0.001° of latitude at 40.94°N ≈ 111.04 m
    expect(distanceM([14.27, 40.94], [14.27, 40.941])).toBeCloseTo(111.04, 1);
    expect(bearingDeg([14.27, 40.94], [14.27, 40.941])).toBeCloseTo(0, 6);
    expect(bearingDeg([14.27, 40.94], [14.271, 40.94])).toBeCloseTo(90, 6);
  });
});
