import type { CityBaseline, Operation, SimFrame, SimOptions, SimView } from '@drip-urban/core';
import { toast } from '../state/toasts';
import type { Feature, Geometry } from './geojson';
import type { EngineRequest, EngineResponse, LayerDiff, PhysicalPayload } from './protocol';

type PhysicalListener = (p: Extract<EngineResponse, { type: 'physical' }>) => void;
type SimListener = (f: SimFrame | null) => void | Promise<void>;

/** Main-thread proxy of the engine worker. Only the latest build request is honoured. */
export class Engine {
  lastSim: SimFrame | null = null;
  lastSimOptions: SimOptions | null = null;
  simPaused = false;
  simSeeking: { elapsedS: number; targetS: number } | null = null;
  playbackSpeed = 4;
  simPerformance = { tickMs: 0, latencyMs: 0, solverHz: 0, renderingMs: 0 };
  private worker: Worker;
  private simulationWorker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private physicalListeners = new Set<PhysicalListener>();
  private simListeners = new Map<SimListener, { released: Promise<void>; release: () => void }>();
  private latestRev = 0;
  private ready: Promise<void> = Promise.resolve();
  private independentSimulation = false;
  /** Current physical model, kept in sync by applying every worker diff in order. */
  private layers = { surfaces: new Map<string, Feature>(), markings: new Map<string, Feature>(), lines: new Map<string, Feature>() };
  private heads: PhysicalPayload['heads'] = [];
  private hasPhysical = false;
  private snapshot: PhysicalPayload | null = null;

  /** Whole model as feature collections (built on demand; surfaces in draw order). */
  get lastPhysical(): PhysicalPayload | null {
    if (!this.hasPhysical) return null;
    if (!this.snapshot) {
      const fcOf = (m: Map<string, Feature>) => ({ type: 'FeatureCollection' as const, features: [...m.values()] });
      const surfaces = fcOf(this.layers.surfaces);
      surfaces.features.sort((a, b) => Number(a.properties.z) - Number(b.properties.z));
      this.snapshot = { surfaces, markings: fcOf(this.layers.markings), lines: fcOf(this.layers.lines), heads: this.heads } as unknown as PhysicalPayload;
    }
    return this.snapshot;
  }

  private apply(layer: keyof Engine['layers'], d: LayerDiff<Geometry>): void {
    const m = this.layers[layer];
    if (d.full) m.clear();
    for (const id of d.remove) m.delete(id);
    for (const f of d.add) m.set(String(f.properties.id), f as Feature);
  }

  constructor() {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<EngineResponse>) => this.handle(ev.data);
    this.simulationWorker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    this.simulationWorker.onmessage = (ev: MessageEvent<EngineResponse>) => this.handle(ev.data);
  }

  private async handle(m: EngineResponse): Promise<void> {
    if (m.type === 'physical') {
      // Diffs are sequential: every one is applied, even if a newer build is already queued.
      this.apply('surfaces', m.diff.surfaces as LayerDiff<Geometry>);
      this.apply('markings', m.diff.markings as LayerDiff<Geometry>);
      this.apply('lines', m.diff.lines as LayerDiff<Geometry>);
      this.heads = m.diff.heads;
      this.hasPhysical = true;
      this.snapshot = null;
      this.physicalListeners.forEach((l) => l(m));
    } else if (m.type === 'job') {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (!p) return;
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error ?? 'Errore di analisi'));
    } else if (m.type === 'simFrame' || m.type === 'simRestarted' || m.type === 'simSought') {
      this.lastSim = m.frame;
      if (m.frame.metrics.finished) this.simPaused = true;
      if (m.type === 'simFrame') this.simPerformance = { ...this.simPerformance, tickMs: m.tickMs, solverHz: m.solverHz ?? 0, latencyMs: Math.max(0, performance.timeOrigin + performance.now() - m.sentAt) };
      const drawingAt = performance.now();
      try { await this.deliverSim(m.frame); }
      finally { this.simPerformance.renderingMs = performance.now() - drawingAt; if (m.type === 'simFrame') this.send({ type: 'simAck', frameId: m.frameId }); }
      if (m.type === 'simRestarted') toast.info('Simulazione ricalcolata', 'Rete modificata: percorsi e controlli aggiornati. Il tempo simulato riparte da zero.');
    }
    else if (m.type === 'simSeekProgress') { this.simSeeking = m.complete ? null : { elapsedS: m.elapsedS, targetS: m.targetS }; }
    else if (m.type === 'simStopped') { this.lastSim = null; await this.deliverSim(null); }
    else if (m.type === 'error') { console.error('[engine]', m.message); toast.error('Motore DRIP', m.message); }
  }

  private send(m: EngineRequest): void {
    if (m.type.startsWith('sim')) this.simulationWorker.postMessage(m);
    else {
      this.worker.postMessage(m);
      if (m.type === 'build') this.simulationWorker.postMessage(m);
      if (m.type === 'init') this.simulationWorker.postMessage({ ...m, baseline: { ...m.baseline, features: {}, buildings: {} } });
    }
  }

  private async deliverSim(frame: SimFrame | null): Promise<void> {
    await Promise.all([...this.simListeners].map(([listener, registration]) => Promise.race([
      Promise.resolve().then(() => { if (this.simListeners.get(listener) === registration) return listener(frame); }).catch((e) => console.error('[simulation renderer]', e)),
      registration.released,
    ])));
  }
  simulationBaseline(baseline: CityBaseline, ops: readonly Operation[]): void {
    this.independentSimulation = true;
    this.simulationWorker.postMessage({ type: 'init', baseline: { ...baseline, features: {}, buildings: {} } });
    this.simulationWorker.postMessage({ type: 'build', rev: this.latestRev, ops });
  }

  init(baseline: CityBaseline, preserveSimulation = false): Promise<void> {
    this.ready = new Promise((resolve) => {
      const onReady = (ev: MessageEvent<EngineResponse>) => {
        if (ev.data.type === 'ready') { this.worker.removeEventListener('message', onReady); resolve(); }
      };
      this.worker.addEventListener('message', onReady);
    });
    this.latestRev = 0;
    for (const m of Object.values(this.layers)) m.clear();
    this.hasPhysical = false; this.snapshot = null;
    if (preserveSimulation && this.independentSimulation) this.worker.postMessage({ type: 'init', baseline });
    else { this.independentSimulation = false; this.send({ type: 'init', baseline }); }
    return this.ready;
  }

  build(ops: readonly Operation[], worksDate?:string): void {
    this.latestRev += 1;
    this.send({ type: 'build', rev: this.latestRev, ops,worksDate });
  }

  async job<T>(kind: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.ready;
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'job', id, kind, args });
    });
  }

  simStart(options: SimOptions): void { this.lastSimOptions = options; this.simPaused = false; this.send({ type: 'sim', cmd: 'start', options }); }
  simStop(): void { this.independentSimulation = false; this.send({ type: 'sim', cmd: 'stop' }); }
  simPause(paused: boolean): void { this.simPaused = paused; this.send({ type: 'sim', cmd: paused ? 'pause' : 'resume' }); }
  simSpeed(speed: number): void { this.playbackSpeed = speed; this.send({ type: 'sim', cmd: 'speed', speed }); }
  simSeek(elapsedS: number): void { this.simPaused = true; this.simSeeking = { elapsedS: 0, targetS: elapsedS }; this.send({ type: 'simSeek', elapsedS }); }
  simView(view: SimView): void { this.send({ type: 'simView', view }); }
  simFocus(bounds?: readonly [number, number, number, number]): void { this.send({ type: 'simFocus', bounds }); }
  simTrack(vehicleId?: number): void { this.send({ type: 'simTrack', vehicleId }); }

  onPhysical(l: PhysicalListener): () => void { this.physicalListeners.add(l); return () => this.physicalListeners.delete(l); }
  onSim(l: SimListener): () => void {
    this.simListeners.get(l)?.release();
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const registration = { released, release };
    this.simListeners.set(l, registration);
    const f = this.lastSim;
    if (f) void Promise.resolve().then(() => { if (this.simListeners.get(l) === registration) return l(f); }).catch((e) => console.error('[simulation renderer]', e));
    return () => { release(); if (this.simListeners.get(l) === registration) this.simListeners.delete(l); };
  }
}

export const engine = new Engine();
