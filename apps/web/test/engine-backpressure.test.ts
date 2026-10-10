import { afterEach, expect, it, vi } from 'vitest';
import type { EngineResponse } from '../src/engine/protocol';

afterEach(() => vi.unstubAllGlobals());
it('disposing a renderer releases its pending draw and acknowledges the frame so the next workspace can receive updates', async () => {
  const workers: { onmessage: ((event: { data: EngineResponse }) => Promise<void>) | null; postMessage: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('Worker', class {
    onmessage = null;
    postMessage = vi.fn();
    constructor() { workers.push(this); }
  });
  const { Engine } = await import('../src/engine/engine');
  const engine = new Engine();
  const simulationWorker = workers.at(-1)!;
  const frame = { data: new Float32Array(), signals: [], metrics: { t: 4, vehicles: 0, avgSpeedKmh: 0, stopped: 0, completed: 0, throughputVph: 0, avgTravelS: 0, avgDelayS: 0, queues: [] } };
  const hangingDraw = vi.fn(() => new Promise<void>(() => undefined));
  const dispose = engine.onSim(hangingDraw);
  const pending = simulationWorker.onmessage!({ data: { type: 'simFrame', frame, frameId: 7, tickMs: 1, sentAt: performance.timeOrigin + performance.now() } });
  await Promise.resolve(); await Promise.resolve();
  expect(hangingDraw).toHaveBeenCalledOnce();
  expect(simulationWorker.postMessage).not.toHaveBeenCalled();
  dispose(); await pending;
  expect(simulationWorker.postMessage).toHaveBeenCalledWith({ type: 'simAck', frameId: 7 });
  const nextRenderer = vi.fn();
  const off = engine.onSim(nextRenderer);
  await simulationWorker.onmessage!({ data: { type: 'simFrame', frame: { ...frame, metrics: { ...frame.metrics, t: 5 } }, frameId: 8, tickMs: 1, sentAt: performance.timeOrigin + performance.now() } });
  expect(nextRenderer.mock.calls.at(-1)![0].metrics.t).toBe(5);
  off();
});

it('changing a large-project work area reloads graphics while retaining the independent municipal simulation baseline', async () => {
  const workers: any[] = [];
  vi.stubGlobal('Worker', class {
    onmessage = null;
    postMessage = vi.fn();
    listeners = new Set<(event: any) => void>();
    addEventListener(_name: string, listener: (event: any) => void) { this.listeners.add(listener); }
    removeEventListener(_name: string, listener: (event: any) => void) { this.listeners.delete(listener); }
    constructor() { workers.push(this); }
  });
  const { Engine } = await import('../src/engine/engine');
  const engine = new Engine();
  const physical = workers.at(-2)!, simulation = workers.at(-1)!;
  const full = { id: 'city', name: 'City', origin: [14, 40], bbox: [13, 39, 15, 41], nodes: {}, roads: {}, assets: {}, buildings: {}, features: {}, sources: [] } as any;
  engine.simulationBaseline(full, []);
  simulation.postMessage.mockClear();
  const ready = engine.init({ ...full, bbox: [14, 40, 14.1, 40.1] }, true);
  expect(simulation.postMessage).not.toHaveBeenCalled();
  for (const listener of physical.listeners) listener({ data: { type: 'ready' } });
  await ready;
  engine.build([]);
  expect(simulation.postMessage).toHaveBeenCalledWith({ type: 'build', rev: 1, ops: [] });
  engine.simStop();
  const next = engine.init(full);
  expect(simulation.postMessage.mock.calls.at(-1)![0].type).toBe('init');
  for (const listener of physical.listeners) listener({ data: { type: 'ready' } });
  await next;
});
