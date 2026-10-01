import { LocalFrame } from '../geo/projection';
import type { CityBaseline, LngLat, Network } from '../model/types';
import { layoutSection } from '../physical/section';
import { incidence } from '../physical/topology';
import { analyzeJunction } from './junction';
import type { TrafficResult } from './traffic';

export type CrashSeverity = 'fatal' | 'serious' | 'slight' | 'damage';

export interface CrashRecord {
  readonly id: string;
  readonly at: LngLat;
  readonly date: string;
  readonly severity: CrashSeverity;
  readonly vehicles?: number;
  readonly pedestrian?: boolean;
  readonly cyclist?: boolean;
  readonly fatalities?: number;
  readonly injuries?: number;
  readonly source: string;
}

export interface SafetyScore {
  readonly nodeId: string;
  readonly at: LngLat;
  readonly score: number;
  readonly basis: 'surrogate' | 'observed';
  readonly factors: {
    readonly conflicts: number;
    readonly crossingConflicts: number;
    readonly maxSpeedKmh: number;
    readonly volumeVph: number | null;
    readonly pedestrianExposure: number;
    readonly arms: number;
    readonly skewDeg: number;
    readonly crashes: number;
    readonly crashWeight: number;
  };
  readonly name: string;
}

const CRASH_WEIGHT: Record<CrashSeverity, number> = { fatal: 10, serious: 5, slight: 2, damage: 1 };
const EXPOSURE_KINDS = new Set(['amenity', 'shop', 'transit_stop', 'leisure', 'school', 'crossing']);

/**
 * Surrogate safety screening (never presented as official black-spot analysis).
 * Ranks junctions by geometric conflicts, speed, volume, pedestrian exposure and
 * skew; observed crashes, when imported, dominate the score and change the basis.
 */
export function screenSafety(net: Network, baseline: CityBaseline, crashes: readonly CrashRecord[], traffic: TrafficResult | null): SafetyScore[] {
  const frame = new LocalFrame(baseline.origin);
  const inc = incidence(net);
  const vol = new Map<string, number>();
  traffic?.flows.forEach((f) => vol.set(f.roadId, (vol.get(f.roadId) ?? 0) + f.volumeVph));
  const exposurePts = Object.values(baseline.features).filter((f) => EXPOSURE_KINDS.has(f.kind) || f.category === 'school').map((f) => frame.toMetric(f.coords[0]!));
  const crashPts = crashes.map((c) => ({ c, m: frame.toMetric(c.at) }));
  const out: SafetyScore[] = [];
  for (const [nodeId, ends] of inc.byNode) {
    const veh = ends.filter((e) => !layoutSection(e.road).pedestrianOnly);
    if (veh.length < 3 || net.roads[veh[0]!.road.id]?.tags?.roundabout) continue;
    const node = net.nodes[nodeId];
    if (!node) continue;
    const a = analyzeJunction(net, baseline.origin, nodeId);
    if (!a) continue;
    const p = frame.toMetric(node.at);
    const near = (q: readonly [number, number], r: number) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r * r;
    const exposure = exposurePts.filter((q) => near(q, 120)).length;
    const nodeCrashes = crashPts.filter((x) => near(x.m, 35)).map((x) => x.c);
    const crashWeight = nodeCrashes.reduce((s, c) => s + CRASH_WEIGHT[c.severity] + (c.pedestrian ? 2 : 0) + (c.cyclist ? 1 : 0), 0);
    const bearings = a.arms.map((x) => x.bearingDeg).sort((x, y) => x - y);
    let skew = 0;
    for (let i = 0; i < bearings.length; i++) {
      const d = (((bearings[(i + 1) % bearings.length]! - bearings[i]!) % 360) + 360) % 360;
      skew = Math.max(skew, Math.abs(d - 360 / bearings.length));
    }
    const maxSpeed = Math.max(...veh.map((e) => e.road.speedKmh));
    const volume = traffic ? veh.reduce((s, e) => s + (vol.get(e.road.id) ?? 0), 0) / 2 : null;
    const crossing = a.conflicts.filter((c) => c.kind === 'crossing');
    const signalised = Object.values(net.signalPlans).some((pl) => pl.nodeId === nodeId);
    const geometric = a.conflicts.reduce((s, c) => s + c.severity, 0) * (signalised ? 0.35 : 1);
    const surrogate = geometric * (maxSpeed / 50) ** 2 * (1 + exposure / 10) * (1 + skew / 90) * (volume !== null ? Math.sqrt(1 + volume / 800) : 1);
    out.push({
      nodeId, at: node.at, name: [...new Set(veh.map((e) => e.road.name).filter(Boolean))].slice(0, 3).join(' × ') || 'Incrocio senza nome',
      score: surrogate + crashWeight * 25, basis: nodeCrashes.length ? 'observed' : 'surrogate',
      factors: { conflicts: a.conflicts.length, crossingConflicts: crossing.length, maxSpeedKmh: maxSpeed, volumeVph: volume === null ? null : Math.round(volume),
        pedestrianExposure: exposure, arms: a.arms.length, skewDeg: Math.round(skew), crashes: nodeCrashes.length, crashWeight },
    });
  }
  const max = Math.max(1, ...out.map((s) => s.score));
  return out.map((s) => ({ ...s, score: Math.round((s.score / max) * 100) })).sort((x, y) => y.score - x.score);
}

/** Parses crash CSV (header names in Italian or English). Rejects rows without coordinates or date. */
export function parseCrashCsv(text: string, source: string): { records: CrashRecord[]; rejected: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { records: [], rejected: 0 };
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = lines[0]!.split(sep).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = {
    lat: col('lat', 'latitude', 'latitudine', 'y'), lon: col('lon', 'lng', 'longitude', 'longitudine', 'x'),
    date: col('date', 'data', 'datetime'), sev: col('severity', 'gravita', 'gravità', 'esito'),
    veh: col('vehicles', 'veicoli'), ped: col('pedestrian', 'pedone', 'pedoni'), cyc: col('cyclist', 'ciclista', 'ciclisti'),
    dead: col('fatalities', 'morti', 'deceduti'), inj: col('injuries', 'feriti'),
  };
  const sevOf = (v: string, dead: number, inj: number): CrashSeverity => {
    const s = v.toLowerCase();
    if (dead > 0 || /mort|fatal/.test(s)) return 'fatal';
    if (/grav|serious/.test(s)) return 'serious';
    if (inj > 0 || /lievi|slight|ferit/.test(s)) return 'slight';
    return 'damage';
  };
  const records: CrashRecord[] = [];
  let rejected = 0;
  lines.slice(1).forEach((line, i) => {
    const c = line.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
    const lat = parseFloat((c[ci.lat] ?? '').replace(',', '.')), lon = parseFloat((c[ci.lon] ?? '').replace(',', '.'));
    const date = c[ci.date] ?? '';
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !date) { rejected++; return; }
    const dead = parseInt(c[ci.dead] ?? '0', 10) || 0, inj = parseInt(c[ci.inj] ?? '0', 10) || 0;
    const yes = (v?: string) => /^(1|si|sì|yes|true|y)$/i.test(v ?? '');
    records.push({
      id: `crash-${i + 1}`, at: [lon, lat], date, severity: sevOf(c[ci.sev] ?? '', dead, inj), source,
      ...(ci.veh >= 0 ? { vehicles: parseInt(c[ci.veh]!, 10) || undefined } : {}),
      pedestrian: yes(c[ci.ped]), cyclist: yes(c[ci.cyc]), fatalities: dead, injuries: inj,
    } as CrashRecord);
  });
  return { records, rejected };
}
