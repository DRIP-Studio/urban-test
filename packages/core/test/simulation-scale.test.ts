import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FlowSimulation, NetworkReplayer, SIM_STRIDE, type CityBaseline } from '../src/index';

const baseline = JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url)))).toString()) as CityBaseline;
const net = new NetworkReplayer().derive(baseline, []).net;
const options = { day: 1, hour: 8, dailyTrips: 1000000, scale: 1, seed: 42 };

it('viewport and graphic budgets never change microscopic agents or results', () => {
  const a = new FlowSimulation(net, baseline, options), b = new FlowSimulation(net, baseline, options);
  for (let i = 0; i < 80; i++) {
    a.step(0.25); b.step(0.25);
    a.frameData({ budget: 0, bounds: [0, 0, 1, 1] });
  }
  const full = b.frameData(), reduced = a.frameData({ budget: 12 });
  expect(full.metrics.vehicles).toBeGreaterThan(12);
  expect(reduced.metrics).toEqual(full.metrics);
  expect(reduced.data.length).toBe(12 * SIM_STRIDE);
  expect(a.frameData().data).toEqual(full.data);
  expect(a.frameData({ budget: 100, bounds: [0, 0, 1, 1] }).data.length).toBe(0);
});

it.each([1000, 5000, 10000, 25000, 50000])('synthetic %i-agent frame transfer stays bounded independently of fleet size', (count) => {
  const sim = new FlowSimulation(net, baseline, options);
  for (let i = 0; i < 4; i++) sim.step(0.25);
  // Stress fixture only: duplicate real routed agents, without presenting it as calibrated traffic.
  const internal = sim as unknown as { vehicles: { id: number; path: number[] }[]; nextId: number };
  const seeds = internal.vehicles;
  expect(seeds.length).toBeGreaterThan(0);
  internal.vehicles = Array.from({ length: count }, (_, i) => ({ ...seeds[i % seeds.length]!, id: i + 1 }));
  internal.nextId = count + 1;
  const frame = sim.frameData({ budget: 2000 });
  expect(frame.metrics.vehicles).toBe(count);
  expect(frame.data.byteLength).toBe(Math.min(count, 2000) * SIM_STRIDE * 4);
  expect(frame.metrics.avgSpeedKmh).toBeGreaterThan(0);
  const started = performance.now();
  sim.step(0.25);
  const stepped = sim.frameData({ budget: 2000 });
  expect(stepped.metrics.vehicles).toBeGreaterThanOrEqual(count);
  console.info(JSON.stringify({ fixture: 'synthetic collocated routed agents, one step only', agents: count, stepAndFrameMs: Math.round(performance.now() - started), payloadBytes: stepped.data.byteLength }));
});

it('gridlocked vehicles are not silently removed after their old timeout', () => {
  const sim = new FlowSimulation(net, baseline, options);
  for (let i = 0; i < 4; i++) sim.step(0.25);
  const internal = sim as unknown as { vehicles: { born: number }[] };
  const count = internal.vehicles.length;
  for (const v of internal.vehicles) v.born = -100000;
  sim.step(0.25);
  expect(sim.frameData().metrics.vehicles).toBeGreaterThanOrEqual(count);
});
