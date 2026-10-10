import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { FlowSimulation, NetworkReplayer, type CityBaseline } from '@drip-urban/core';
import { simulationScope } from '../src/traffic/simulationScope';

const baseline = JSON.parse(gunzipSync(readFileSync(resolve(process.cwd(), '../../services/api/seed/frattamaggiore.baseline.json.gz'))).toString()) as CityBaseline;
const net = new NetworkReplayer().derive(baseline, []).net;
it('selected corridor produces real reachable Flow routes and does not include unrelated selected objects', () => {
  const road = Object.values(net.roads).find((r) => r.roadClass === 'residential')!;
  const extent = simulationScope('corridor', net, { kind: 'road', ids: [road.id] }, baseline.bbox);
  const sim = new FlowSimulation(net, baseline, { ...extent, initialVehicles: 1000, dailyTrips: 0, day: 1, hour: 8, scale: 1, seed: 42 });
  for (let i = 0; i < 20; i++) sim.step(0.25);
  const f = sim.frameData({ budget: 40 });
  expect(f.metrics.vehicles + f.metrics.completed).toBe(1000);
  expect(f.data.length).toBeLessThanOrEqual(240);
  expect(() => simulationScope('corridor', net, { kind: 'asset', ids: ['x'] }, baseline.bbox)).toThrow('strade');
});
it('polygon scope uses the selected authored geometry and rejects insufficient usable nodes', () => {
  const polygon = [[0, 0], [0.001, 0], [0, 0.001]] as const;
  const authored = { ...net, zones: { z: { id: 'z', name: 'Scope', kind: 'ztl' as const, polygon, allowedModes: [] } } };
  const extent = simulationScope('polygon', authored, { kind: 'zone', ids: ['z'] }, baseline.bbox);
  expect(extent.focusPolygon).toEqual(polygon);
  expect(() => new FlowSimulation(authored, baseline, { ...extent, dailyTrips: 60000, day: 1, hour: 8, scale: 1, seed: 42 })).toThrow('meno di due nodi');
  expect(() => simulationScope('junction', net, null, baseline.bbox)).toThrow('Seleziona');
});

