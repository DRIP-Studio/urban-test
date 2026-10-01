import type { CityBaseline, Operation, SimFrame, SimOptions } from '@drip-urban/core';
import type { EngineRequest, EngineResponse, PhysicalPayload } from './protocol';

type PhysicalListener = (p: Extract<EngineResponse, { type: 'physical' }>) => void;
type SimListener = (f: SimFrame | null) => void;

/** Main-thread proxy of the engine worker. Only the latest build request is honoured. */
export class Engine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private physicalListeners = new Set<PhysicalListener>();
  private simListeners = new Set<SimListener>();
  private latestRev = 0;
  private ready: Promise<void> = Promise.resolve();
  lastPhysical: PhysicalPayload | null = null;

  constructor() {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<EngineResponse>) => this.handle(ev.data);
  }

  private handle(m: EngineResponse): void {
    if (m.type === 'physical') {
      if (m.rev < this.latestRev) return; // stale
      this.lastPhysical = m.payload;
      this.physicalListeners.forEach((l) => l(m));
    } else if (m.type === 'job') {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (!p) return;
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error ?? 'Errore di analisi'));
    } else if (m.type === 'simFrame') this.simListeners.forEach((l) => l(m.frame));
    else if (m.type === 'simStopped') this.simListeners.forEach((l) => l(null));
    else if (m.type === 'error') console.error('[engine]', m.message);
  }

  private send(m: EngineRequest): void { this.worker.postMessage(m); }

  init(baseline: CityBaseline): Promise<void> {
    this.ready = new Promise((resolve) => {
      const onReady = (ev: MessageEvent<EngineResponse>) => {
        if (ev.data.type === 'ready') { this.worker.removeEventListener('message', onReady); resolve(); }
      };
      this.worker.addEventListener('message', onReady);
    });
    this.latestRev = 0;
    this.send({ type: 'init', baseline });
    return this.ready;
  }

  build(ops: readonly Operation[]): void {
    this.latestRev += 1;
    this.send({ type: 'build', rev: this.latestRev, ops });
  }

  async job<T>(kind: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.ready;
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'job', id, kind, args });
    });
  }

  simStart(options: SimOptions): void { this.send({ type: 'sim', cmd: 'start', options }); }
  simStop(): void { this.send({ type: 'sim', cmd: 'stop' }); }
  simPause(paused: boolean): void { this.send({ type: 'sim', cmd: paused ? 'pause' : 'resume' }); }
  simSpeed(speed: number): void { this.send({ type: 'sim', cmd: 'speed', speed }); }

  onPhysical(l: PhysicalListener): () => void { this.physicalListeners.add(l); return () => this.physicalListeners.delete(l); }
  onSim(l: SimListener): () => void { this.simListeners.add(l); return () => this.simListeners.delete(l); }
}

export const engine = new Engine();
