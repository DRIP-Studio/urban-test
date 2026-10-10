import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FlowSimulation, NetworkReplayer, type CityBaseline } from '../src/index';
const baseline = JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url)))).toString()) as CityBaseline;
const net = new NetworkReplayer().derive(baseline, []).net;
it('hybrid solver conserves the routed population across moving detail zones, arrivals and snapshots', () => {
  const sim = new FlowSimulation(net, baseline, { mode: 'hybrid', initialVehicles: 5000, dailyTrips: 0, day: 1, hour: 8, scale: 1, seed: 42, microBounds: [0, 0, 1, 1] });
  for (let i = 0; i < 120; i++) {
    sim.step(0.25);
    const frame = sim.frameData({ budget: i % 2 ? 0 : 80 });
    expect(frame.metrics.vehicles + frame.metrics.completed).toBe(5000);
    expect(frame.metrics.microscopic! + frame.metrics.aggregated!).toBe(frame.metrics.vehicles);
    expect(frame.data.length).toBeLessThanOrEqual(80 * 6);
    expect(frame.metrics.avgSpeedKmh).toBeGreaterThanOrEqual(0);
    if (i === 50) sim.setMicroFocus(baseline.bbox);
    if (i === 100) sim.setMicroFocus([0, 0, 1, 1]);
  }
  expect(sim.frameData().metrics.aggregated).toBeGreaterThan(0);
  expect(sim.frameData().aggregates?.length).toBeGreaterThan(0);
}, 30000);
it.each(['microscopic', 'hybrid'] as const)('%s warm start represents exactly 50,000 valid routed agents', (mode) => {
  const sim = new FlowSimulation(net, baseline, { mode, initialVehicles: 50000, dailyTrips: 0, day: 1, hour: 8, scale: 1, seed: 123 });
  for (let i = 0; i < 20; i++) sim.step(0.25);
  const frame = sim.frameData({ budget: 2000 });
  expect(frame.metrics.vehicles + frame.metrics.completed).toBe(50000);
  expect(frame.data.length).toBeLessThanOrEqual(12000);
  expect([...frame.data].every(Number.isFinite)).toBe(true);
}, 30000);
