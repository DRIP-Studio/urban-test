import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FlowSimulation, NetworkReplayer, evaluateScenario, DEFAULT_TRAFFIC, projectInstant, type CityBaseline, type ProjectClock, type Zone } from '../src/index';
const baseline = JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url)))).toString()) as CityBaseline;
const net = new NetworkReplayer().derive(baseline, []).net;
const clock: ProjectClock = { anchor: projectInstant('2026-11-17', 7 * 60 + 45, 'Europe/Rome'), timeZone: 'Europe/Rome', durationS: 120, speed: 1, holiday: false };
const [w, s, e, n] = baseline.bbox;
const zone: Zone = { id: 'closure', name: 'Temporal closure', kind: 'ztl', polygon: [[w - .01, s - .01], [e + .01, s - .01], [e + .01, n + .01], [w - .01, n + .01]], allowedModes: ['walk', 'bike', 'emergency'], schedule: [{ days: [1], from: '07:46', to: '08:00' }] };

it('Flow actually stops new car routes at the ZTL boundary time, retains demand, and ends at the configured duration', () => {
  const options = { clock, mode: 'hybrid' as const, day: 1, hour: 7.75, dailyTrips: 60000, scale: 1, seed: 42 };
  const unrestricted = new FlowSimulation(net, baseline, options);
  const restricted = new FlowSimulation({ ...net, zones: { closure: zone } }, baseline, options);
  for (let i = 0; i < 480; i++) { unrestricted.step(.25); restricted.step(.25); }
  const a = unrestricted.frameData({ budget: 0 }).metrics, b = restricted.frameData({ budget: 0 }).metrics;
  expect(b.vehicles + b.completed).toBeLessThan(a.vehicles + a.completed);
  expect(b.waitingDemand).toBeGreaterThan(10);
  expect(b.finished).toBe(true);
  restricted.step(10);
  expect(restricted.elapsedS).toBe(120);
});

it('Scenario Lab uses identical deterministic simulation conditions and real impact metrics', async () => {
  const settings = { clock: { ...clock, durationS: 15 }, traffic: DEFAULT_TRAFFIC, seed: 42, mode: 'hybrid' as const, co2GPerKm: 160, idleCo2GPerSecond: 1 };
  const first = await evaluateScenario(baseline, [], settings);
  const second = await evaluateScenario(baseline, [], settings);
  expect(second).toEqual(first);
  expect(first.metrics.t).toBe(15);
  expect(first.vehicleKm).toBeGreaterThan(0);
  expect(first.co2EstimateKg).toBeGreaterThan(0);
  expect(first.method).toContain('stimata');
  await expect(evaluateScenario(baseline, [], settings, () => {}, () => true)).rejects.toThrow('annullato');
}, 30000);
