// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { LocalFrame, ROAD_TEMPLATES, roadFromTemplate, type Network } from '@drip-urban/core';
import { useMapUi } from '../src/map/mapStore';
import { NetworkIndex } from '../src/tools/snap';
vi.mock('../src/state/store', () => ({ newId: () => crypto.randomUUID() }));
import { planRoad } from '../src/tools/roadOps';
it('snap OFF splits an actual intersection at its exact coordinate rather than moving it to a nearby node', () => {
  const origin = [14.27, 40.94] as const;
  const f = new LocalFrame(origin);
  const from = f.toLngLat([0, -50]), to = f.toLngLat([0, 50]);
  const road = roadFromTemplate(ROAD_TEMPLATES[0]!, 'crossed', 'a', 'b', [from, to], 'Crossed');
  const net: Network = { nodes: { a: { id: 'a', at: from }, b: { id: 'b', at: to } }, roads: { crossed: road }, assets: {}, areas: {}, zones: {}, roundabouts: {}, junctions: {}, signalPlans: {} };
  const idx = new NetworkIndex(net, origin);
  const points = [f.toLngLat([-20, -48]), f.toLngLat([20, -48])];
  useMapUi.setState({ snapEnabled: false });
  const plan = planRoad(idx, points.map((at) => ({ at, kind: 'free' })), points, ROAD_TEMPLATES[0]!.id, 'Test');
  const split = plan.ops.find((o) => o.type === 'road.split')!;
  expect(split).toBeDefined();
  const at = (split.payload as { at: readonly [number, number] }).at;
  expect(f.toMetric(at)[1]).toBeCloseTo(-48, 4);
  useMapUi.setState({ snapEnabled: true });
});
