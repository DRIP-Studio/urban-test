import { LocalFrame, geom, type CityBaseline, type LngLat } from '@drip-urban/core';

/**
 * Public transport modes with planning defaults (Italian practice / UITP orders of magnitude).
 * Every derived number in the TPL panel is labelled as a DRIP estimate.
 */
export type TransitMode = 'bus' | 'brt' | 'trolleybus' | 'tram' | 'metro' | 'train' | 'funicular' | 'ferry' | 'on_demand';

export interface ModeSpec {
  readonly label: string;
  readonly icon: string;
  readonly color: string;
  /** Follows the road network when drawn (bus, BRT, tram, trolleybus, on demand). */
  readonly onRoad: boolean;
  readonly speedKmh: number;
  readonly stopSpacingM: number;
  readonly dwellS: number;
  readonly layoverMin: number;
  readonly catchmentM: number;
  readonly vehicles: readonly { readonly label: string; readonly capacity: number }[];
  readonly costPerVkm: number;
  /** Attractiveness multiplier on the ridership estimate (rail factor). */
  readonly appeal: number;
  readonly rightOfWay: string;
  readonly co2gPerPkm: number;
}

export const MODES: Readonly<Record<TransitMode, ModeSpec>> = {
  bus: { label: 'Bus', icon: 'bus', color: '#5587a2', onRoad: true, speedKmh: 17, stopSpacingM: 350, dwellS: 25, layoverMin: 6, catchmentM: 400, costPerVkm: 4.2, appeal: 1, rightOfWay: 'Traffico misto', co2gPerPkm: 68,
    vehicles: [{ label: 'Minibus 8 m', capacity: 45 }, { label: 'Autobus 10 m', capacity: 70 }, { label: 'Autobus 12 m', capacity: 85 }, { label: 'Autobus snodato 18 m', capacity: 140 }, { label: 'Autobus elettrico 12 m', capacity: 80 }] },
  brt: { label: 'BRT', icon: 'bus', color: '#e8772e', onRoad: true, speedKmh: 24, stopSpacingM: 550, dwellS: 20, layoverMin: 6, catchmentM: 600, costPerVkm: 5.5, appeal: 1.15, rightOfWay: 'Corsia riservata protetta', co2gPerPkm: 45,
    vehicles: [{ label: 'BRT snodato 18 m', capacity: 150 }, { label: 'BRT bi-articolato 24 m', capacity: 200 }] },
  trolleybus: { label: 'Filobus', icon: 'bus', color: '#2f7d5b', onRoad: true, speedKmh: 18, stopSpacingM: 380, dwellS: 25, layoverMin: 6, catchmentM: 450, costPerVkm: 5.8, appeal: 1.05, rightOfWay: 'Traffico misto / riservata', co2gPerPkm: 20,
    vehicles: [{ label: 'Filobus 12 m', capacity: 90 }, { label: 'Filobus 18 m', capacity: 145 }] },
  tram: { label: 'Tram', icon: 'tram', color: '#8b0209', onRoad: true, speedKmh: 19, stopSpacingM: 450, dwellS: 20, layoverMin: 5, catchmentM: 600, costPerVkm: 9, appeal: 1.25, rightOfWay: 'Sede riservata', co2gPerPkm: 18,
    vehicles: [{ label: 'Tram 32 m', capacity: 220 }, { label: 'Tram 45 m', capacity: 300 }] },
  metro: { label: 'Metropolitana', icon: 'metro', color: '#d0614f', onRoad: false, speedKmh: 33, stopSpacingM: 900, dwellS: 25, layoverMin: 4, catchmentM: 800, costPerVkm: 14, appeal: 1.6, rightOfWay: 'Sede propria (sotterranea / viadotto)', co2gPerPkm: 12,
    vehicles: [{ label: 'Metro leggera 2 casse', capacity: 300 }, { label: 'Metro 4 casse', capacity: 700 }, { label: 'Metro 6 casse', capacity: 1200 }] },
  train: { label: 'Treno suburbano', icon: 'train', color: '#1d1d1b', onRoad: false, speedKmh: 45, stopSpacingM: 2500, dwellS: 45, layoverMin: 10, catchmentM: 1200, costPerVkm: 18, appeal: 1.4, rightOfWay: 'Ferrovia', co2gPerPkm: 22,
    vehicles: [{ label: 'Elettrotreno 4 casse', capacity: 600 }, { label: 'Doppio piano 5 casse', capacity: 1000 }] },
  funicular: { label: 'Funicolare', icon: 'train', color: '#7e57c2', onRoad: false, speedKmh: 15, stopSpacingM: 400, dwellS: 40, layoverMin: 3, catchmentM: 500, costPerVkm: 20, appeal: 1.3, rightOfWay: 'Sede propria', co2gPerPkm: 15,
    vehicles: [{ label: 'Cabina 2 vetture', capacity: 300 }] },
  ferry: { label: 'Navetta via mare', icon: 'ferry', color: '#2b6cb0', onRoad: false, speedKmh: 22, stopSpacingM: 3000, dwellS: 120, layoverMin: 10, catchmentM: 800, costPerVkm: 25, appeal: 1.1, rightOfWay: 'Via d\'acqua', co2gPerPkm: 110,
    vehicles: [{ label: 'Aliscafo 200 posti', capacity: 200 }, { label: 'Battello 120 posti', capacity: 120 }] },
  on_demand: { label: 'Bus a chiamata', icon: 'bus', color: '#d9a441', onRoad: true, speedKmh: 20, stopSpacingM: 250, dwellS: 30, layoverMin: 5, catchmentM: 500, costPerVkm: 3.5, appeal: 0.8, rightOfWay: 'Traffico misto (DRT)', co2gPerPkm: 90,
    vehicles: [{ label: 'Van 9 posti', capacity: 9 }, { label: 'Minibus 20 posti', capacity: 20 }] },
};

export interface ServiceBand { readonly id: 'peak' | 'offpeak' | 'evening' | 'weekend'; readonly label: string; readonly hours: number }
export const BANDS: readonly ServiceBand[] = [
  { id: 'peak', label: 'Punta (7–9, 17–19)', hours: 4 },
  { id: 'offpeak', label: 'Morbida', hours: 9 },
  { id: 'evening', label: 'Sera', hours: 3 },
  { id: 'weekend', label: 'Festivo (giornata)', hours: 16 },
];

export interface LineStop { readonly id: string; readonly name: string; readonly at: LngLat }

export interface TransitLine {
  readonly id: string;
  name: string;
  mode: TransitMode;
  color: string;
  line: LngLat[];
  stops: LineStop[];
  /** Minutes between departures per band (0 = no service). */
  headways: Record<ServiceBand['id'], number>;
  firstDeparture: string;
  lastDeparture: string;
  vehicle: string;
  capacity: number;
  speedKmh: number;
  /** Legacy single headway (1.0 lines); kept in sync with the peak band. */
  headwayMin?: number;
}

export interface BikeStation { readonly id: string; name: string; at: LngLat; docks: number; ebikeShare: number }
export interface BikeShare { system: string; stations: BikeStation[]; dockless: boolean }

export function defaultLine(id: string, mode: TransitMode, line: LngLat[], index: number): TransitLine {
  const m = MODES[mode];
  const v = m.vehicles[Math.min(1, m.vehicles.length - 1)]!;
  const base = mode === 'metro' ? 5 : mode === 'train' ? 20 : mode === 'tram' || mode === 'brt' ? 8 : mode === 'on_demand' ? 30 : 15;
  return {
    id, name: `${m.label} ${index + 1}`, mode, color: m.color, line, stops: [],
    headways: { peak: base, offpeak: Math.round(base * 1.5), evening: base * 2, weekend: Math.round(base * 2) },
    firstDeparture: mode === 'metro' ? '05:30' : '06:00', lastDeparture: mode === 'metro' ? '00:30' : '21:30', vehicle: v.label, capacity: v.capacity, speedKmh: m.speedKmh,
  };
}

/** Upgrades a 1.0 design (single headway, bus/brt/tram) to the multimodal line. */
export function upgradeLine(r: Partial<TransitLine> & { id: string; line: LngLat[]; headwayMin?: number }): TransitLine {
  const mode = (r.mode ?? 'bus') as TransitMode;
  const h = r.headwayMin ?? 15;
  return {
    ...defaultLine(r.id, mode, r.line, 0), ...r, mode,
    headways: r.headways ?? { peak: h, offpeak: Math.round(h * 1.5), evening: h * 2, weekend: Math.round(h * 2) },
  } as TransitLine;
}

export interface LineMetrics {
  lengthKm: number; oneWayMin: number; cycleMin: number; fleet: number; vehKmDay: number; vehHoursDay: number;
  capacityPeak: number; waitPeakMin: number; costYear: number; spacingM: number | null;
  catchmentPop: number; boardingsDay: number; loadFactorPeak: number; co2SavedTYear: number;
}

/** Residents per building: floor area (footprint × floors of 3 m) × 0.8 net / 35 m² per resident. */
function residents(b: CityBaseline, f: LocalFrame) {
  return Object.values(b.buildings).map((bd) => {
    const ring = bd.footprint.map((q) => f.toMetric(q) as geom.V);
    const area = Math.abs(geom.ringArea(ring));
    const floors = Math.max(1, Math.round((bd.heightM || 6) / 3));
    const c = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length] as geom.V, [0, 0] as geom.V);
    return { c, pop: area > 25 ? (area * floors * 0.8) / 35 : 0 };
  });
}

let popCache: { b: CityBaseline; list: { c: geom.V; pop: number }[] } | null = null;

/** Population within the catchment of the stops (each building counted once). */
export function catchment(b: CityBaseline, stops: readonly LngLat[], radiusM: number): number {
  const f = new LocalFrame(b.origin);
  if (!popCache || popCache.b !== b) popCache = { b, list: residents(b, f) };
  const s = stops.map((p) => f.toMetric(p) as geom.V);
  let pop = 0;
  for (const r of popCache.list) if (s.some((q) => Math.hypot(q[0] - r.c[0], q[1] - r.c[1]) <= radiusM)) pop += r.pop;
  return Math.round(pop);
}

/**
 * Operating and demand estimates. Ridership: catchment residents × 2,4 trips/day × transit share,
 * share = 14 % × e^(−peak headway / 25) × mode appeal (rail factor), capped by the offered capacity.
 */
export function lineMetrics(l: TransitLine, b: CityBaseline): LineMetrics {
  const m = MODES[l.mode];
  const f = new LocalFrame(b.origin);
  const L = geom.lengthOf(l.line.map((p) => f.toMetric(p) as geom.V));
  const oneWayS = L / (l.speedKmh / 3.6) + l.stops.length * m.dwellS;
  const cycleMin = (2 * oneWayS) / 60 + 2 * m.layoverMin;
  const fleetOf = (h: number) => (h > 0 ? Math.ceil(cycleMin / h) : 0);
  const fleet = Math.max(...BANDS.map((x) => fleetOf(l.headways[x.id])));
  const weekdayDepartures = BANDS.filter((x) => x.id !== 'weekend').reduce((t, x) => t + (l.headways[x.id] > 0 ? (x.hours * 60) / l.headways[x.id] : 0), 0) * 2;
  const vehKmDay = weekdayDepartures * (L / 1000);
  const vehHoursDay = (weekdayDepartures * oneWayS) / 3600 + (weekdayDepartures * m.layoverMin) / 60;
  const weekendDep = l.headways.weekend > 0 ? ((16 * 60) / l.headways.weekend) * 2 : 0;
  const vkmYear = vehKmDay * 250 + weekendDep * (L / 1000) * 115;
  const capacityPeak = l.headways.peak > 0 ? Math.round((60 / l.headways.peak) * l.capacity) : 0;
  const pop = l.stops.length ? catchment(b, l.stops.map((s) => s.at), m.catchmentM) : 0;
  const share = l.headways.peak > 0 ? 0.14 * Math.exp(-l.headways.peak / 25) * m.appeal : 0;
  const demand = pop * 2.4 * share;
  const dailyCap = weekdayDepartures * l.capacity * 0.6;
  const boardings = Math.round(Math.min(demand, dailyCap));
  // Peak hour ≈ 12 % of daily boardings, half in the main direction.
  const loadFactorPeak = capacityPeak ? Math.min(1.5, (boardings * 0.12 * 0.5) / capacityPeak) : 0;
  const avgTripKm = Math.min(L / 1000, 4.5) * 0.6;
  // CO₂ saved: car trips avoided (35 % of riders) at 160 g/km minus the line's own emissions.
  const co2 = (boardings * 250 * avgTripKm * (0.35 * 160 - m.co2gPerPkm * 0.5)) / 1e6;
  return {
    lengthKm: L / 1000, oneWayMin: oneWayS / 60, cycleMin, fleet, vehKmDay, vehHoursDay, capacityPeak, waitPeakMin: l.headways.peak / 2,
    costYear: Math.round(vkmYear * m.costPerVkm), spacingM: l.stops.length > 1 ? L / (l.stops.length - 1) : null,
    catchmentPop: pop, boardingsDay: boardings, loadFactorPeak, co2SavedTYear: Math.max(0, Math.round(co2)),
  };
}

/** Bike sharing coverage: residents within 300 m of a station, share of the project population. */
export function bikeCoverage(b: CityBaseline, stations: readonly BikeStation[]): { covered: number; total: number; docks: number } {
  const f = new LocalFrame(b.origin);
  if (!popCache || popCache.b !== b) popCache = { b, list: residents(b, f) };
  const total = popCache.list.reduce((t, r) => t + r.pop, 0);
  return { covered: catchment(b, stations.map((s) => s.at), 300), total: Math.round(total), docks: stations.reduce((t, s) => t + s.docks, 0) };
}

/**
 * Proposes bike-sharing stations on a ~`spacingM` grid where residents are densest, at least 250 m apart.
 * Station size grows with the residents within 300 m (10–30 docks).
 */
export function proposeBikeStations(b: CityBaseline, bbox: readonly [number, number, number, number], spacingM = 400, max = 40): { at: LngLat; docks: number }[] {
  const f = new LocalFrame(b.origin);
  if (!popCache || popCache.b !== b) popCache = { b, list: residents(b, f) };
  const [w, s, e, n] = bbox;
  const lo = f.toMetric([w, s]), hi = f.toMetric([e, n]);
  const cells = new Map<string, { pop: number; x: number; y: number }>();
  for (const r of popCache.list) {
    if (r.c[0] < lo[0] || r.c[0] > hi[0] || r.c[1] < lo[1] || r.c[1] > hi[1]) continue;
    const k = `${Math.floor(r.c[0] / spacingM)},${Math.floor(r.c[1] / spacingM)}`;
    const c = cells.get(k) ?? { pop: 0, x: 0, y: 0 };
    c.pop += r.pop; c.x += r.c[0] * r.pop; c.y += r.c[1] * r.pop;
    cells.set(k, c);
  }
  const ranked = [...cells.values()].filter((c) => c.pop > 150).sort((a, c) => c.pop - a.pop);
  const out: { m: geom.V; docks: number }[] = [];
  for (const c of ranked) {
    const m: geom.V = [c.x / c.pop, c.y / c.pop];
    if (out.some((o) => Math.hypot(o.m[0] - m[0], o.m[1] - m[1]) < 250)) continue;
    out.push({ m, docks: Math.max(10, Math.min(30, Math.round(c.pop / 120))) });
    if (out.length >= max) break;
  }
  return out.map((o) => ({ at: f.toLngLat(o.m), docks: o.docks }));
}
