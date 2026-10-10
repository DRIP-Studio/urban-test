import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NetworkReplayer, PedestrianSimulation, type CityBaseline } from '../src/index';
const baseline = JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url)))).toString()) as CityBaseline;
const net = new NetworkReplayer().derive(baseline, []).net;
const road = Object.values(net.roads).find(r => r.axis.length === 2 && r.section.elements.some(e => e.kind === 'sidewalk'))!;

it('pedestrian demand conserves people independently of drawing budget', () => {
  const simulation = new PedestrianSimulation(net, baseline.origin, 3600, () => .5);
  for (let second = 0; second < 120; second++) simulation.step(1, { day: 4, minutes: 480 + second / 60 }, () => true);
  const all = simulation.snapshot(500), hidden = simulation.snapshot(0);
  expect(all.metrics.active + all.metrics.completed + all.metrics.waitingDemand).toBe(120);
  expect(hidden.metrics).toEqual(all.metrics);
  expect(hidden.data.length).toBe(0);
  expect(all.data.length).toBeGreaterThan(0);
});

it('crossing pedestrians wait at red, clear at green and preserve uninserted demand', () => {
  const crossingRoad = { ...road, section: { ...road.section, elements: road.section.elements.filter(e => e.kind !== 'sidewalk') } };
  const network = { ...net, roads: { [road.id]: crossingRoad }, transit: [], signalPlans: { test: { id: 'test', nodeId: road.to, phases: [{ pedestrianRoadIds: [road.id] }] } } } as unknown as typeof net;
  const simulation = new PedestrianSimulation(network, baseline.origin, 3600, () => .5);
  for (let second = 0; second < 10; second++) simulation.step(1, { day: 4, minutes: 480 }, () => false);
  const red = simulation.snapshot(100);
  expect(red.metrics.waiting).toBe(1);
  expect(red.metrics.waitingDemand).toBe(9);
  expect(simulation.crossingOccupied(road.id, road.to)).toBe(false);
  simulation.step(1, { day: 4, minutes: 480 }, () => true);
  expect(simulation.crossingOccupied(road.id, road.to)).toBe(true);
  for (let second = 0; second < 20; second++) simulation.step(1, { day: 4, minutes: 480 }, () => false);
  expect(simulation.snapshot(100).metrics.completed).toBeGreaterThan(0);
});
