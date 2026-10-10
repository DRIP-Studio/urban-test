import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { analyzeJunction, ScenarioHistory, suggestSignalPlan, type CityBaseline, type Operation } from '@drip-urban/core';
import type { EngineRequest, EngineResponse } from '../src/engine/protocol';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('a network edit restarts active Flow on the effective network and a new project stops the old timer', async () => {
  vi.useFakeTimers();
  const messages: EngineResponse[] = [];
  const worker = { onmessage: null as ((ev: { data: EngineRequest }) => void) | null, postMessage: (m: EngineResponse) => messages.push(m) };
  vi.stubGlobal('self', worker);
  await import('../src/engine/simulation.worker');
  const send = (data: EngineRequest) => worker.onmessage!({ data });
  const baseline = JSON.parse(gunzipSync(readFileSync(resolve(process.cwd(), '../../services/api/seed/frattamaggiore.baseline.json.gz'))).toString()) as CityBaseline;
  const history = new ScenarioHistory(baseline, { id: 's', name: 'Test', isBaseline: false, locked: false, archived: false, operations: [], createdAt: '2026-10-08' }, 'test', () => crypto.randomUUID());
  const counts = new Map<string, number>();
  for (const road of Object.values(history.network.roads)) for (const id of [road.from, road.to]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const nodeId = [...counts].find(([, count]) => count === 4)![0];
  const analysis = analyzeJunction(history.network, baseline.origin, nodeId)!;
  const plan = suggestSignalPlan(history.network, analysis);
  history.commit({ type: 'signal.setPlan', payload: { plan, conflicts: analysis.incompatible } });
  send({ type: 'init', baseline });
  // A baseline reload can leave a short interval before the build. Starting here must queue.
  send({ type: 'sim', cmd: 'start', options: { day: 1, hour: 8, dailyTrips: 60000, scale: 0.1, seed: 42 } });
  send({ type: 'build', rev: 1, ops: history.scenario.operations });
  send({ type: 'sim', cmd: 'start', options: { day: 1, hour: 8, dailyTrips: 60000, scale: 0.1, seed: 42 } });
  for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(100); send({ type: 'simAck' }); }
  expect(messages.some((m) => m.type === 'simFrame' && m.frame.metrics.t > 0)).toBe(true);
  expect(messages.some((m) => m.type === 'simFrame' && m.frame.signals.length > 0)).toBe(true);
  const delivered = messages.filter((m) => m.type === 'simFrame').length;
  vi.advanceTimersByTime(1000); // no acknowledgement: one outstanding frame, simulation continues
  expect(messages.filter((m) => m.type === 'simFrame').length).toBe(delivered + 1);
  vi.advanceTimersByTime(1000);
  expect(messages.filter((m) => m.type === 'simFrame').length).toBe(delivered + 1);
  send({ type: 'simAck' }); vi.advanceTimersByTime(100);
  const latest = messages.filter((m) => m.type === 'simFrame').at(-1)!;
  if (latest.type === 'simFrame') expect(latest.frame.metrics.t).toBeGreaterThanOrEqual(12);
  if (latest.type === 'simFrame') {
    send({ type: 'simAck', frameId: latest.frameId! - 1 });
    const beforeStaleAck = messages.filter((m) => m.type === 'simFrame').length;
    vi.advanceTimersByTime(300);
    expect(messages.filter((m) => m.type === 'simFrame').length).toBe(beforeStaleAck);
    send({ type: 'simAck', frameId: latest.frameId });
    vi.advanceTimersByTime(100);
    expect(messages.filter((m) => m.type === 'simFrame').length).toBe(beforeStaleAck + 1);
  }
  send({ type: 'sim', cmd: 'pause' });
  const op: Operation = { id: 'edit', type: 'junction.set', payload: { spec: { ...history.network.junctions[nodeId]!, control: 'uncontrolled', minorRoadIds: [] } }, author: 'test', at: '2026-10-08T10:00:00Z' };
  send({ type: 'build', rev: 2, ops: [...history.scenario.operations, op] });
  const restarted = messages.find((m) => m.type === 'simRestarted');
  expect(restarted?.type).toBe('simRestarted');
  if (restarted?.type === 'simRestarted') {
    expect(restarted.frame.metrics.t).toBe(0);
    expect(restarted.frame.signals).toEqual([]);
  }
  const frames = () => messages.filter((m) => m.type === 'simFrame').length;
  const count = frames();
  vi.advanceTimersByTime(500);
  expect(frames()).toBe(count); // network edit preserves pause
  send({ type: 'sim', cmd: 'resume' });
  send({ type: 'simAck' });
  vi.advanceTimersByTime(100);
  expect(frames()).toBeGreaterThan(count);
  send({ type: 'init', baseline: { ...baseline, id: 'another-project' } });
  const after = frames();
  vi.advanceTimersByTime(1000);
  expect(frames()).toBe(after);
  expect(messages.filter((m) => m.type === 'error')).toEqual([]);
});
