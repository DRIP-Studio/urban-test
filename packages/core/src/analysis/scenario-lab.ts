import type { CityBaseline, Network, Operation, ProjectClock } from '../model/types';
import { NetworkReplayer } from '../ops/replay';
import { FlowSimulation, type SimMetrics, type SimOptions } from './simulation';
import { estimateTraffic, type TrafficParams, type TrafficResult } from './traffic';
import { analyzeNetwork, serviceAccess } from './network';
import { projectLocalTime } from './clock';
import { screenSafety } from './safety';

export interface LabSettings {
  /** Explicit synthetic starting fleet and local study extent, identical for every candidate. */
  readonly initialVehicles?: number;
  readonly focus?: SimOptions['focus'];
  readonly clock: ProjectClock;
  readonly traffic: TrafficParams;
  readonly seed: number;
  readonly mode: NonNullable<SimOptions['mode']>;
  /** Explicit planning emission factors, never presented as measured pollutant concentrations. */
  readonly co2GPerKm: number;
  readonly idleCo2GPerSecond: number;
}
export interface LabResult {
  readonly metrics: SimMetrics;
  readonly pedestrianGreenFraction:number;
  readonly peakQueuedVehicles: number;
  readonly peakStopped: number;
  readonly meanSpeedKmh: number;
  readonly vehicleKm: number;
  readonly co2EstimateKg: number;
  readonly traffic: TrafficResult;
  readonly walkingCoverage: number;
  readonly cyclingCoverage: number;
  readonly criticalRoads: number;
  readonly components: number;
  readonly crossingConflicts: number;
  readonly failedOperations: readonly string[];
  readonly method: string;
}

/** Same calendar, seed, demand and solver for every candidate. Uses the effective operation model. */
export async function evaluateScenario(baseline: CityBaseline, operations: readonly Operation[], settings: LabSettings,
  progress: (elapsedS: number) => void = () => {}, cancelled: () => boolean = () => false): Promise<LabResult> {
  if (!Number.isFinite(settings.co2GPerKm) || settings.co2GPerKm < 0 || !Number.isFinite(settings.idleCo2GPerSecond) || settings.idleCo2GPerSecond < 0) throw new Error('Fattori emissivi non validi');
  const replay = new NetworkReplayer().derive(baseline, operations);
  if (replay.failed.length) throw new Error(`Operazioni non applicabili: ${replay.failed.map((f) => f.op.id).join(', ')}`);
  const net: Network = replay.net, at = projectLocalTime(settings.clock);
  const params = { ...settings.traffic, day: at.day, hour: at.hour, date: at.date, holiday: at.holiday };
  const sim = new FlowSimulation(net, baseline, { clock: settings.clock, mode: settings.mode, day: at.day, hour: at.hour,
    dailyTrips: params.dailyTrips * (1 + params.growthPercent / 100), scale: 1, seed: settings.seed, initialVehicles: settings.initialVehicles, focus: settings.focus });
  let pedestrianGreenS=0,pedestrianSignalS=0;
  let peakQueuedVehicles = 0, peakStopped = 0, weightedSpeed = 0, samples = 0, distanceM = 0, idleSeconds = 0;
  while (!sim.finished) {
    if (cancelled()) throw new Error('Confronto annullato');
    const started = performance.now();
    do {
      const dt = Math.min(0.25, settings.clock.durationS - sim.elapsedS);
      sim.step(dt);
      const frame = sim.frameData({ budget: 0 }),m=frame.metrics;
      for(const signal of frame.signals)if(signal.groupId?.startsWith('ped:')){pedestrianSignalS+=dt;if(signal.state==='green')pedestrianGreenS+=dt;}
      peakQueuedVehicles = Math.max(peakQueuedVehicles, (m.queuedVehicles ?? m.queues.reduce((s, q) => s + q.vehicles, 0)));
      peakStopped = Math.max(peakStopped, m.stopped);
      weightedSpeed += m.avgSpeedKmh * m.vehicles * dt; samples += m.vehicles * dt;
      distanceM += m.avgSpeedKmh / 3.6 * m.vehicles * dt; idleSeconds += m.stopped * dt;
    } while (!sim.finished && performance.now() - started < 20);
    progress(sim.elapsedS);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (cancelled()) throw new Error('Confronto annullato');
  const traffic = estimateTraffic(net, baseline, params);
  const ctx = { day: at.day, minutes: at.minutes, holiday: at.holiday, date: at.date };
  const walking = serviceAccess(net, baseline, 7, 'walk', ctx), cycling = serviceAccess(net, baseline, 7, 'bike', ctx);
  const network = analyzeNetwork(net, baseline.origin, 30, { ...ctx, mode: 'car' });
  const safety = screenSafety(net, baseline, [], traffic);
  return { pedestrianGreenFraction:pedestrianSignalS?pedestrianGreenS/pedestrianSignalS:0, metrics: sim.frameData({ budget: 0 }).metrics, peakQueuedVehicles, peakStopped,
    meanSpeedKmh: samples ? weightedSpeed / samples : 0, vehicleKm: distanceM / 1000,
    co2EstimateKg: (distanceM / 1000 * settings.co2GPerKm + idleSeconds * settings.idleCo2GPerSecond) / 1000,
    traffic, walkingCoverage: walking.coverage, cyclingCoverage: cycling.coverage,
    criticalRoads: network.criticalRoadIds.length, components: network.components,
    crossingConflicts: safety.reduce((s, x) => s + x.factors.crossingConflicts, 0), failedOperations: [],
    method: `Flow ${settings.mode}; ${settings.clock.durationS} s; seed ${settings.seed}; CO₂ stimata: ${settings.co2GPerKm} g/km + ${settings.idleCo2GPerSecond} g/s in coda. Accessibilità: quota di lunghezza residenziale entro 7 min da tutte le categorie di servizi. Popolazione non dedotta dagli edifici.` };
}
