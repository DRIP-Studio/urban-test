/// <reference lib="webworker" />
import { FlowSimulation, NetworkReplayer, type CityBaseline, type Network, type SimOptions, type SimView } from '@drip-urban/core';
import type { EngineRequest, EngineResponse } from './protocol';
declare const self: DedicatedWorkerGlobalScope;
let baseline: CityBaseline | null = null, net: Network | null = null;
const replayer = new NetworkReplayer();
let sim: FlowSimulation | null = null, options: SimOptions | null = null, pending: SimOptions | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let speed = 4, paused = false, remainder = 0, inFlight: number | null = null, nextFrameId = 0;
let meterAt = performance.now(), meterSteps = 0, solverHz = 0;
let seekGeneration = 0;
let view: SimView = { budget: 2000 };
const post = (m: EngineResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);
function stop() { seekGeneration++; if (timer) clearInterval(timer); timer = null; sim = null; options = null; pending = null; inFlight = null; remainder = 0; }
function start(opts: SimOptions) {
  if (!net || !baseline) { pending = opts; return; }
  seekGeneration++;
  const next = new FlowSimulation(net, baseline, opts);
  if (timer) clearInterval(timer);
  sim = next; options = opts; paused = false; remainder = 0; inFlight = null;
  meterAt = performance.now(); meterSteps = 0; solverHz = 0;
  speed = opts.clock?.speed ?? speed;
  timer = setInterval(tick, 100);
}
function tick() {
  if (!sim || paused) return;
  const started = performance.now();
  remainder += speed * 0.1;
  const steps = Math.floor(remainder / 0.25); remainder -= steps * 0.25;
  for (let i = 0; i < steps; i++) sim.step(0.25);
  meterSteps += steps;
  if (started - meterAt >= 1000) { solverHz = meterSteps * 1000 / (started - meterAt); meterSteps = 0; meterAt = started; }
  if (sim.finished) paused = true;
  if (inFlight !== null) return;
  const frame = sim.frameData(view); inFlight = ++nextFrameId;
  post({ type: 'simFrame', frame, frameId: inFlight, solverHz, tickMs: performance.now() - started, sentAt: performance.timeOrigin + performance.now() }, [frame.data.buffer]);
}
async function seek(targetS: number) {
  if (!baseline || !net || !options || !sim) throw new Error('Nessuna simulazione da posizionare');
  if (!Number.isFinite(targetS) || targetS < 0 || targetS > (options.clock?.durationS ?? 86400)) throw new Error('Tempo fuori dalla durata della simulazione');
  const generation = ++seekGeneration;
  paused = true;
  const replay = new FlowSimulation(net, baseline, options);
  let lastProgress = 0;
  while (replay.elapsedS < targetS && generation === seekGeneration) {
    const started = performance.now();
    do { replay.step(Math.min(0.25, targetS - replay.elapsedS)); } while (replay.elapsedS < targetS && performance.now() - started < 20);
    if (performance.now() - lastProgress > 100) {
      post({ type: 'simSeekProgress', elapsedS: replay.elapsedS, targetS, complete: false }); lastProgress = performance.now();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (generation !== seekGeneration) return;
  sim = replay; remainder = 0; inFlight = null;
  const frame = replay.frameData(view);
  post({ type: 'simSeekProgress', elapsedS: targetS, targetS, complete: true });
  post({ type: 'simSought', frame }, [frame.data.buffer]);
}
self.onmessage = (ev: MessageEvent<EngineRequest>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') { stop(); baseline = m.baseline; net = null; post({ type: 'simStopped' }); return; }
    if (m.type === 'build' && baseline) {
      const previous = net, next = replayer.derive(baseline, m.ops).net, changed = net !== next; net = next;
      if (changed && sim && options) {
        seekGeneration++;
        const sameGeometry = previous && Object.keys(next).every((key) => ['clock','presentation','materials','buildingStyles','cityModels','environment','assets','utilityNodes','utilityLinks'].includes(key) || next[key as keyof Network] === previous[key as keyof Network]);
        const a = previous?.clock ?? options.clock, b = next.clock;
        const sameCalendar = a?.anchor === b?.anchor && a?.timeZone === b?.timeZone && a?.holiday === b?.holiday;
        if (sameGeometry && sameCalendar) {
          if(b){options = { ...options, clock: b }; sim.setDuration(b.durationS); speed = b.speed;}
        } else {
          if (b) { options = { ...options, clock: b }; speed = b.speed; }
          sim = new FlowSimulation(net, baseline, options); remainder = 0; inFlight = null;
          const frame = sim.frameData(view); post({ type: 'simRestarted', frame }, [frame.data.buffer]);
        }
      }
      if (pending) { const opts = pending; pending = null; start(opts); }
      return;
    }
    if (m.type === 'simSeek') { void seek(m.elapsedS).catch((e) => { post({ type: 'simSeekProgress', elapsedS: 0, targetS: m.elapsedS, complete: true }); post({ type: 'error', message: String(e) }); }); return; }
    if (m.type === 'simAck') { if (m.frameId === undefined || m.frameId === inFlight) inFlight = null; return; }
    if (m.type === 'simView') {
      if (!Number.isFinite(m.view.budget) || m.view.budget < 0 || m.view.budget > 10000) throw new Error('Budget grafico non valido');
      view = { ...m.view, trackedId: view.trackedId }; return;
    }
    if (m.type === 'simTrack') {
      if (m.vehicleId !== undefined && (!Number.isSafeInteger(m.vehicleId) || m.vehicleId < 1)) throw new Error('Veicolo non valido');
      view = { ...view, trackedId: m.vehicleId };
      if (sim && paused) { const frame = sim.frameData(view); post({ type: 'simSought', frame }, [frame.data.buffer]); }
      return;
    }
    if (m.type === 'simFocus') { sim?.setMicroFocus(m.bounds); if (options) options = { ...options, microBounds: m.bounds }; return; }
    if (m.type === 'sim') {
      if (m.cmd === 'start' && m.options) start(m.options);
      else if (m.cmd === 'stop') { stop(); post({ type: 'simStopped' }); }
      else if (m.cmd === 'pause') paused = true;
      else if (m.cmd === 'resume') paused = false;
      else if (m.cmd === 'speed') { if (!Number.isFinite(m.speed) || m.speed! <= 0 || m.speed! > 60) throw new Error('Velocità simulazione non valida'); speed = m.speed!; }
    }
  } catch (e) {
    if (m.type === 'sim' && m.cmd === 'start') { stop(); post({ type: 'simStopped' }); }
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
