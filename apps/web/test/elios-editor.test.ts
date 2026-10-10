// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { ScenarioHistory, type CityBaseline, type Roundabout } from '@drip-urban/core';
const st = vi.hoisted(() => ({ current: {} as any, commit: vi.fn() }));
vi.mock('../src/state/store', () => ({ useApp: { getState: () => st.current }, commit: st.commit, newId: vi.fn(), openDock: vi.fn(), select: vi.fn(), setMode: vi.fn(), undo: vi.fn() }));
vi.mock('../src/state/actions', () => ({ plateOnPoleOps: vi.fn() }));
vi.mock('../src/map/mapStore', () => ({ fitBounds: vi.fn(), flyTo: vi.fn(), getMap: () => null }));
import { toolByName } from '../src/elios/tools';
const baseline = JSON.parse(gunzipSync(readFileSync(resolve(process.cwd(), '../../services/api/seed/frattamaggiore.baseline.json.gz'))).toString()) as CityBaseline;
let h: ScenarioHistory;
beforeEach(() => {
  h = new ScenarioHistory(baseline, { id: 's', name: 'Test', isBaseline: false, locked: false, archived: false, createdAt: '2026-10-08', operations: [] }, 'test', () => crypto.randomUUID());
  st.current = { network: h.network, baseline, project: { name: 'Test' }, selection: null };
  st.commit.mockImplementation((type, payload) => {
    try { h.commit({ type, payload }); st.current.network = h.network; return { ok: true, issues: [] }; }
    catch (e) { return { ok: false, issues: [{ severity: 'error', message: (e as Error).message }] }; }
  });
});
it('Elios edits the selected roundabout through actual core validation and undo', () => {
  const rb: Roundabout = { id: 'rb', name: 'Test', type: 'compact', center: baseline.origin, outerDiameterM: 32, aspect: 1, orientationDeg: 0, circulatoryWidthM: 7, apronWidthM: 1, lanes: 1, islandMaterial: 'grass', control: 'yield', speedKmh: 30, arms: [] };
  h.commit({ type: 'roundabout.add', payload: { roundabout: rb } });
  st.current.network = h.network;
  st.current.selection = { kind: 'roundabout', ids: ['rb'] };
  const tool = toolByName('edit_roundabout')!;
  tool.run({ lanes: 2, circulatoryWidthM: 8 });
  expect(h.network.roundabouts.rb!.lanes).toBe(2);
  expect(() => tool.run({ circulatoryWidthM: 99 })).toThrow();
  expect(h.network.roundabouts.rb!.circulatoryWidthM).toBe(8);
  h.undo();
  expect(h.network.roundabouts.rb!.lanes).toBe(1);
  expect(() => tool.run({ entryRadiusM: 10 })).toThrow('armRoadId');
});
it('Elios requires explicit minor approaches before applying priority control', () => {
  const road = Object.values(h.network.roads)[0]!;
  st.current.selection = { kind: 'node', ids: [road.from] };
  const tool = toolByName('set_junction_control')!;
  expect(() => tool.run({ control: 'stop' })).toThrow('minorRoadIds');
  tool.run({ control: 'stop', minorRoadIds: [road.id] });
  expect(h.network.junctions[road.from]!.control).toBe('stop');
  h.undo();
  expect(h.network.junctions[road.from]).toBeUndefined();
});
