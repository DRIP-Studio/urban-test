import { LocalFrame } from '../geo/projection';
import { band, lengthOf, ringArea, type V } from '../geo/polyline';
import type { CityBaseline, LngLat, Network, Road } from '../model/types';
import { isPedestrianRoad } from '../physical/section';

/**
 * Piano urbanistico (PUC/PRG) inside the workstation: zoning (zone territoriali omogenee, DM 1444/1968),
 * constraint layers (vincoli), urban standards (DM 1444/1968 art. 3), building compliance with the zone
 * rules and the check of the scenario against the constraints.
 *
 * Stored as the project document `urbanplan` (UrbanPlanDoc). Every number derived here is an estimate
 * from the data at hand (OSM footprints and heights, mapped features): it supports, never replaces,
 * the official verification of the plan.
 */

export type Dm1444Class = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type StandardKind = 'istruzione' | 'interesse_comune' | 'verde' | 'parcheggi';
export type ConstraintType = 'paesaggistico' | 'idrogeologico' | 'rispetto_stradale' | 'cimiteriale' | 'ferroviario' | 'altro';

export interface ZoneRules {
  /** Indice di fabbricabilità fondiaria, m³/m². */
  readonly maxIndexFondiario?: number;
  /** Rapporto di copertura, % of the lot. */
  readonly maxCoverage?: number;
  /** Altezza massima, m. */
  readonly maxHeight?: number;
  /** Distanza minima tra fabbricati / dai confini, m. */
  readonly minDistanceM?: number;
  /** Destinazioni d'uso ammesse (free text items). */
  readonly uses?: readonly string[];
}

export interface PlanZone {
  readonly id: string;
  /** Zone code as in the plan, e.g. 'A1', 'B2', 'D', 'E', 'F1'. */
  readonly code: string;
  readonly dm1444: Dm1444Class;
  readonly name: string;
  /** Outer ring (first point not repeated). */
  readonly polygon: readonly LngLat[];
  readonly holes?: readonly (readonly LngLat[])[];
  readonly rules: ZoneRules;
  /** Area reserved by the plan for a DM 1444 standard (zone F / standard areas). */
  readonly standard?: StandardKind;
  readonly source: string;
}

export interface PlanConstraint {
  readonly id: string;
  readonly type: ConstraintType;
  readonly name: string;
  readonly polygon: readonly LngLat[];
  readonly holes?: readonly (readonly LngLat[])[];
  readonly note?: string;
  readonly source: string;
}

export interface UrbanPlanSettings {
  /** m³ of residential volume per inhabitant (DM 1444/1968 art. 3 last paragraph: 100 m³/ab, 80 + 20). */
  readonly m3PerResident: number;
  /** Count standard areas in zones A and B twice (DM 1444/1968 art. 4 c. 2). */
  readonly doubleCountAB: boolean;
}

export interface UrbanPlanDoc {
  readonly zones: readonly PlanZone[];
  readonly constraints: readonly PlanConstraint[];
  readonly settings?: Partial<UrbanPlanSettings>;
  readonly sources?: readonly string[];
  readonly updatedAt?: string;
}

export const DEFAULT_PLAN_SETTINGS: UrbanPlanSettings = { m3PerResident: 100, doubleCountAB: true };
export const EMPTY_URBAN_PLAN: UrbanPlanDoc = { zones: [], constraints: [] };

/** DM 1444/1968 art. 3: 18 m² per inhabitant. */
export const DM1444_STANDARDS: Readonly<Record<StandardKind, number>> = { istruzione: 4.5, interesse_comune: 2.0, verde: 9.0, parcheggi: 2.5 };
export const STANDARD_LABEL: Readonly<Record<StandardKind, string>> = {
  istruzione: 'Istruzione (asili, scuole dell\'obbligo)', interesse_comune: 'Attrezzature di interesse comune', verde: 'Verde pubblico attrezzato, gioco e sport', parcheggi: 'Parcheggi pubblici',
};

export const DM1444_LABEL: Readonly<Record<Dm1444Class, string>> = {
  A: 'A — centro storico', B: 'B — completamento', C: 'C — espansione', D: 'D — produttiva', E: 'E — agricola', F: 'F — attrezzature di interesse generale',
};
/** Classic PRG palette. */
export const DM1444_COLOR: Readonly<Record<Dm1444Class, string>> = { A: '#9c3b2a', B: '#e8862e', C: '#f2cf3a', D: '#8a5aa8', E: '#9ccc7a', F: '#3f7fc4' };

/**
 * Indicative default rules per class when a zone is created without the plan's norme tecniche
 * (DM 1444/1968 art. 7–8 limits where they exist). Always to be replaced with the NTA values.
 */
export const DEFAULT_RULES: Readonly<Record<Dm1444Class, ZoneRules>> = {
  A: { maxIndexFondiario: 5, maxCoverage: 70, maxHeight: 14, minDistanceM: 10, uses: ['residenziale', 'commerciale', 'servizi'] },
  B: { maxIndexFondiario: 3, maxCoverage: 50, maxHeight: 13, minDistanceM: 10, uses: ['residenziale', 'commerciale', 'servizi'] },
  C: { maxIndexFondiario: 1.5, maxCoverage: 30, maxHeight: 10.5, minDistanceM: 10, uses: ['residenziale'] },
  D: { maxIndexFondiario: 3, maxCoverage: 50, maxHeight: 12, minDistanceM: 10, uses: ['produttivo', 'artigianale', 'commerciale'] },
  E: { maxIndexFondiario: 0.03, maxCoverage: 5, maxHeight: 7.5, minDistanceM: 20, uses: ['agricolo', 'residenza agricola'] },
  F: { maxCoverage: 40, maxHeight: 12, uses: ['attrezzature pubbliche'] },
};

export const CONSTRAINT_LABEL: Readonly<Record<ConstraintType, string>> = {
  paesaggistico: 'Vincolo paesaggistico (D.Lgs 42/2004)', idrogeologico: 'Vincolo idrogeologico / PAI', rispetto_stradale: 'Fascia di rispetto stradale (DPR 495/1992 art. 26–28)',
  cimiteriale: 'Fascia di rispetto cimiteriale (RD 1265/1934 art. 338)', ferroviario: 'Fascia di rispetto ferroviaria (DPR 753/1980 art. 49)', altro: 'Altro vincolo',
};

export const planSettings = (doc: UrbanPlanDoc | null | undefined): UrbanPlanSettings => ({ ...DEFAULT_PLAN_SETTINGS, ...(doc?.settings ?? {}) });

/** DM 1444 class from a zone code ('B2' → B, 'zona C1' → C); null when not recognisable. */
export function dm1444FromCode(code: string): Dm1444Class | null {
  const m = /(?:^|[^a-z])([a-f])(?=[\d\s._\-/]|$)/i.exec(code.trim());
  return m ? (m[1]!.toUpperCase() as Dm1444Class) : null;
}

// ---------------------------------------------------------------- geometry helpers

export function pointInRing(p: V, ring: readonly V[]): boolean {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) r = !r;
  }
  return r;
}

/** A polygon (outer ring + holes) in local metres, with bbox for fast rejection. */
export interface MetricPolygon { readonly outer: readonly V[]; readonly holes: readonly (readonly V[])[]; readonly bbox: readonly [number, number, number, number]; readonly area: number }

export function metricPolygon(f: LocalFrame, outer: readonly LngLat[], holes: readonly (readonly LngLat[])[] = []): MetricPolygon {
  const o = outer.map((q) => f.toMetric(q) as V);
  const h = holes.map((r) => r.map((q) => f.toMetric(q) as V));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of o) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const area = Math.max(0, Math.abs(ringArea(o)) - h.reduce((s, r) => s + Math.abs(ringArea(r)), 0));
  return { outer: o, holes: h, bbox: [x0, y0, x1, y1], area };
}

export function inPolygon(p: V, poly: MetricPolygon): boolean {
  const [x0, y0, x1, y1] = poly.bbox;
  if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) return false;
  return pointInRing(p, poly.outer) && !poly.holes.some((h) => pointInRing(p, h));
}

function segCross(a: V, b: V, c: V, d: V): boolean {
  const o = (p: V, q: V, r: V) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Whether a polyline (or ring, when closed) touches the polygon: a vertex inside or an edge crossing. */
export function lineTouchesPolygon(line: readonly V[], poly: MetricPolygon, closed = false): boolean {
  if (line.some((p) => inPolygon(p, poly))) return true;
  const [x0, y0, x1, y1] = poly.bbox;
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i++) {
    const a = line[i]!, b = line[(i + 1) % line.length]!;
    if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1 || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1) continue;
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let k = 0; k < ring.length; k++) if (segCross(a, b, ring[k]!, ring[(k + 1) % ring.length]!)) return true;
    }
  }
  // Polygon entirely inside a closed ring.
  return closed && pointInRing(poly.outer[0]!, line);
}

export function centroidOf(ring: readonly V[]): V {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j]!, q = ring[i]!;
    const k = p[0] * q[1] - q[0] * p[1];
    a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// ---------------------------------------------------------------- residents

/** OSM tags of features where buildings are not residential. */
const NON_RESIDENTIAL: Readonly<Record<string, ReadonlySet<string>>> = {
  amenity: new Set(['school', 'kindergarten', 'college', 'university', 'hospital', 'clinic', 'place_of_worship', 'marketplace', 'fuel', 'theatre', 'cinema', 'events_venue', 'townhall', 'police', 'fire_station', 'waste_transfer_station', 'prison', 'library']),
  leisure: new Set(['sports_centre', 'stadium', 'pitch']),
  landuse: new Set(['industrial', 'commercial', 'retail', 'cemetery', 'railway', 'military', 'farmyard']),
  shop: new Set(['supermarket', 'mall', 'department_store']),
};
const tagIn = (props: Readonly<Record<string, unknown>>, table: Readonly<Record<string, ReadonlySet<string>>>) =>
  Object.entries(table).some(([k, set]) => typeof props[k] === 'string' && set.has(props[k] as string));

export interface ResidentPoint { readonly id: string; readonly at: V; readonly volumeM3: number; readonly footprintM2: number; readonly heightM: number; readonly residents: number; readonly residential: boolean }

/**
 * Residents per building from the residential volume (footprint × height) divided by `m3PerResident`
 * (DM 1444/1968 art. 3: 100 m³/ab). Buildings inside non-residential features (schools, hospitals,
 * industrial land…) or plan zones D/F, and sheds under 20 m², have no residents.
 */
export function estimateResidents(baseline: CityBaseline, plan: UrbanPlanDoc | null = null, m3PerResident = DEFAULT_PLAN_SETTINGS.m3PerResident): ResidentPoint[] {
  const f = new LocalFrame(baseline.origin);
  const blockers: MetricPolygon[] = [];
  for (const ft of Object.values(baseline.features)) {
    if (ft.geometry === 'polygon' && ft.coords.length >= 3 && tagIn(ft.properties, NON_RESIDENTIAL)) blockers.push(metricPolygon(f, ft.coords));
  }
  for (const z of plan?.zones ?? []) if (z.dm1444 === 'D' || z.dm1444 === 'F') blockers.push(metricPolygon(f, z.polygon, z.holes));
  const per = Math.max(1, m3PerResident);
  const out: ResidentPoint[] = [];
  for (const b of Object.values(baseline.buildings)) {
    if (b.footprint.length < 3) continue;
    const ring = b.footprint.map((q) => f.toMetric(q) as V);
    const area = Math.abs(ringArea(ring));
    const h = Math.max(0, (b.heightM || 0) - (b.minHeightM || 0)) || 6;
    const c = centroidOf(ring);
    const residential = area >= 20 && !blockers.some((p) => inPolygon(c, p));
    const vol = area * h;
    out.push({ id: b.id, at: c, volumeM3: vol, footprintM2: area, heightM: b.heightM, residents: residential ? vol / per : 0, residential });
  }
  return out;
}

// ---------------------------------------------------------------- standards (DM 1444/1968 art. 3)

export function requiredStandards(residents: number): Record<StandardKind, number> {
  return {
    istruzione: residents * DM1444_STANDARDS.istruzione, interesse_comune: residents * DM1444_STANDARDS.interesse_comune,
    verde: residents * DM1444_STANDARDS.verde, parcheggi: residents * DM1444_STANDARDS.parcheggi,
  };
}

const STD_TAGS: readonly [StandardKind, string, ReadonlySet<string>][] = [
  ['istruzione', 'amenity', new Set(['school', 'kindergarten', 'prep_school', 'childcare'])],
  ['interesse_comune', 'amenity', new Set(['townhall', 'place_of_worship', 'library', 'theatre', 'social_facility', 'community_centre', 'arts_centre', 'police', 'post_office', 'marketplace', 'events_venue', 'clinic', 'social_centre', 'courthouse', 'fire_station'])],
  ['verde', 'leisure', new Set(['park', 'garden', 'playground', 'pitch', 'sports_centre', 'recreation_ground', 'dog_park'])],
  ['verde', 'landuse', new Set(['recreation_ground', 'village_green'])],
  ['parcheggi', 'amenity', new Set(['parking'])],
];

/** DM 1444 standard of a mapped feature (by OSM tags), or null. Private or underground parking is excluded. */
export function standardOfFeature(props: Readonly<Record<string, unknown>>): StandardKind | null {
  if (typeof props.dm1444 === 'string' && props.dm1444 in DM1444_STANDARDS) return props.dm1444 as StandardKind;
  if (props.access === 'private' || props.parking === 'underground' || (props.parking === 'multi-storey' && props.access === 'customers')) return null;
  for (const [kind, key, set] of STD_TAGS) if (typeof props[key] === 'string' && set.has(props[key] as string)) return kind;
  return null;
}

const AREA_STANDARD: Readonly<Record<string, StandardKind>> = { green: 'verde', playground: 'verde', rain_garden: 'verde', parking: 'parcheggi' };

export interface StandardArea {
  readonly id: string;
  readonly kind: StandardKind;
  readonly name: string;
  readonly areaM2: number;
  readonly at: V;
  readonly origin: 'esistente' | 'progetto' | 'piano';
}

/** Existing standard areas (mapped polygons, nested duplicates removed) plus the project areas of the scenario. */
export function standardAreas(baseline: CityBaseline, net: Network | null, plan: UrbanPlanDoc | null = null): { areas: StandardArea[]; points: Record<StandardKind, number> } {
  const f = new LocalFrame(baseline.origin);
  const cands: (StandardArea & { poly: MetricPolygon })[] = [];
  const points: Record<StandardKind, number> = { istruzione: 0, interesse_comune: 0, verde: 0, parcheggi: 0 };
  for (const ft of Object.values(baseline.features)) {
    const k = standardOfFeature(ft.properties);
    if (!k) continue;
    if (ft.geometry !== 'polygon' || ft.coords.length < 3) { if (ft.geometry === 'point') points[k]++; continue; }
    const poly = metricPolygon(f, ft.coords);
    cands.push({ id: ft.id, kind: k, name: ft.name ?? (typeof ft.properties.name === 'string' ? ft.properties.name : '') ?? '', areaM2: poly.area, at: centroidOf(poly.outer), origin: 'esistente', poly });
  }
  // A pitch inside a park, or a school yard inside the school lot: count the containing polygon only.
  cands.sort((a, b) => b.areaM2 - a.areaM2);
  const kept: (StandardArea & { poly: MetricPolygon })[] = [];
  for (const c of cands) if (!kept.some((k) => k.kind === c.kind && k.areaM2 > c.areaM2 && inPolygon(c.at, k.poly))) kept.push(c);
  const areas: StandardArea[] = kept.map(({ poly: _p, ...a }) => a);
  for (const a of Object.values(net?.areas ?? {})) {
    if (a.state === 'removed') continue;
    const k = (typeof a.properties.dm1444 === 'string' ? a.properties.dm1444 as StandardKind : null) ?? AREA_STANDARD[a.kind];
    if (!k || a.polygon.length < 3) continue;
    const ring = a.polygon.map((q) => f.toMetric(q) as V);
    areas.push({ id: a.id, kind: k, name: a.name ?? '', areaM2: Math.abs(ringArea(ring)), at: centroidOf(ring), origin: a.state === 'project' ? 'progetto' : 'esistente' });
  }
  for (const z of plan?.zones ?? []) {
    if (!z.standard) continue;
    const poly = metricPolygon(f, z.polygon, z.holes);
    areas.push({ id: z.id, kind: z.standard, name: `${z.code} ${z.name}`.trim(), areaM2: poly.area, at: centroidOf(poly.outer), origin: 'piano' });
  }
  return { areas, points };
}

export interface StandardsRow {
  readonly kind: StandardKind;
  readonly requiredM2: number;
  readonly existingM2: number;
  readonly projectM2: number;
  readonly plannedM2: number;
  /** existing + project (+ plan reservations when counted), with the art. 4 doubling applied. */
  readonly computedM2: number;
  /** computed − required: negative = deficit. */
  readonly balanceM2: number;
  readonly perResidentM2: number;
  readonly standardPerResident: number;
}

export interface StandardsSummary {
  readonly scope: string;
  readonly zoneId: string | null;
  readonly dm1444: Dm1444Class | null;
  readonly residents: number;
  readonly residentialVolumeM3: number;
  readonly rows: readonly StandardsRow[];
  readonly totalRequiredM2: number;
  readonly totalComputedM2: number;
}

export interface StandardsResult {
  readonly town: StandardsSummary;
  readonly zones: readonly StandardsSummary[];
  readonly settings: UrbanPlanSettings;
  readonly mappedPoints: Record<StandardKind, number>;
  readonly method: string;
}

function summarize(scope: string, zone: PlanZone | null, residents: number, volume: number, areas: readonly StandardArea[], includePlanned: boolean, double: (a: StandardArea) => number): StandardsSummary {
  const req = requiredStandards(residents);
  const rows = (Object.keys(DM1444_STANDARDS) as StandardKind[]).map((kind): StandardsRow => {
    const of = (o: StandardArea['origin']) => areas.filter((a) => a.kind === kind && a.origin === o);
    const sum = (xs: StandardArea[]) => xs.reduce((s, a) => s + a.areaM2, 0);
    const counted = areas.filter((a) => a.kind === kind && (includePlanned || a.origin !== 'piano'));
    const computed = counted.reduce((s, a) => s + a.areaM2 * double(a), 0);
    return {
      kind, requiredM2: req[kind], existingM2: sum(of('esistente')), projectM2: sum(of('progetto')), plannedM2: sum(of('piano')),
      computedM2: computed, balanceM2: computed - req[kind], perResidentM2: residents > 0 ? computed / residents : 0, standardPerResident: DM1444_STANDARDS[kind],
    };
  });
  return {
    scope, zoneId: zone?.id ?? null, dm1444: zone?.dm1444 ?? null, residents, residentialVolumeM3: volume, rows,
    totalRequiredM2: rows.reduce((s, r) => s + r.requiredM2, 0), totalComputedM2: rows.reduce((s, r) => s + r.computedM2, 0),
  };
}

/**
 * Verification of the DM 1444/1968 art. 3 standards for the whole town and per plan zone.
 * Residents from the residential volume; standard areas from mapped features, the scenario project
 * areas and (optionally) the plan reservations. Plan reservations (zones with `standard`) are counted
 * only when `includePlanned` (verifica di piano) — otherwise the balance is the existing state + project.
 */
export function urbanStandards(baseline: CityBaseline, net: Network | null, plan: UrbanPlanDoc | null, opts: { includePlanned?: boolean; residents?: readonly ResidentPoint[] } = {}): StandardsResult {
  const settings = planSettings(plan);
  const f = new LocalFrame(baseline.origin);
  const res = opts.residents ?? estimateResidents(baseline, plan, settings.m3PerResident);
  const { areas, points } = standardAreas(baseline, net, plan);
  const zones = (plan?.zones ?? []).map((z) => ({ z, poly: metricPolygon(f, z.polygon, z.holes) }));
  const zoneAt = (p: V) => zones.find((x) => inPolygon(p, x.poly))?.z ?? null;
  const double = (a: StandardArea) => {
    if (!settings.doubleCountAB) return 1;
    const z = a.origin === 'piano' ? (plan?.zones.find((q) => q.id === a.id) ?? null) : zoneAt(a.at);
    return z && (z.dm1444 === 'A' || z.dm1444 === 'B') ? 2 : 1;
  };
  const includePlanned = opts.includePlanned ?? false;
  const town = summarize('Intero territorio', null, res.reduce((s, r) => s + r.residents, 0), res.reduce((s, r) => s + (r.residential ? r.volumeM3 : 0), 0), areas, includePlanned, double);
  const perZone = zones.map(({ z, poly }) => {
    const inside = res.filter((r) => inPolygon(r.at, poly));
    const zAreas = areas.filter((a) => (a.origin === 'piano' ? a.id === z.id : inPolygon(a.at, poly)));
    return summarize(`Zona ${z.code}${z.name ? ` — ${z.name}` : ''}`, z, inside.reduce((s, r) => s + r.residents, 0), inside.reduce((s, r) => s + (r.residential ? r.volumeM3 : 0), 0), zAreas, includePlanned, double);
  });
  return {
    town, zones: perZone, settings, mappedPoints: points,
    method: `Abitanti = volume residenziale (sagoma × altezza degli edifici) / ${settings.m3PerResident} m³/ab (DM 1444/1968 art. 3). Aree a standard: poligoni mappati (scuole, attrezzature, verde attrezzato, parcheggi pubblici) e superfici di progetto dello scenario${includePlanned ? ', più le aree riservate dal piano' : ''}${settings.doubleCountAB ? '; nelle zone A e B le aree sono computate in misura doppia (art. 4 c. 2)' : ''}. Stima: le altezze OSM sono spesso stimate.`,
  };
}

// ---------------------------------------------------------------- building compliance

export interface ZoneCompliance {
  readonly zoneId: string;
  readonly code: string;
  readonly dm1444: Dm1444Class;
  readonly areaM2: number;
  readonly buildings: number;
  readonly footprintM2: number;
  readonly volumeM3: number;
  readonly coveragePct: number;
  /** Volume / zone area: close to the territorial index (the zone area includes streets). */
  readonly indexM3M2: number;
  readonly tallest: number;
  readonly overHeight: readonly string[];
  readonly coverageOk: boolean | null;
  readonly indexOk: boolean | null;
  readonly heightOk: boolean | null;
}

/** Existing buildings against the zone rules (coverage, index, height). Null = rule not set. */
export function buildingCompliance(baseline: CityBaseline, plan: UrbanPlanDoc | null): ZoneCompliance[] {
  const f = new LocalFrame(baseline.origin);
  const bs = Object.values(baseline.buildings).filter((b) => b.footprint.length >= 3).map((b) => {
    const ring = b.footprint.map((q) => f.toMetric(q) as V);
    const area = Math.abs(ringArea(ring));
    return { id: b.id, c: centroidOf(ring), area, h: b.heightM, vol: area * Math.max(0, b.heightM - (b.minHeightM || 0)) };
  });
  return (plan?.zones ?? []).map((z) => {
    const poly = metricPolygon(f, z.polygon, z.holes);
    const inside = bs.filter((b) => inPolygon(b.c, poly));
    const fp = inside.reduce((s, b) => s + b.area, 0), vol = inside.reduce((s, b) => s + b.vol, 0);
    const cov = poly.area > 0 ? (fp / poly.area) * 100 : 0, idx = poly.area > 0 ? vol / poly.area : 0;
    const over = z.rules.maxHeight !== undefined ? inside.filter((b) => b.h > z.rules.maxHeight! + 0.5).map((b) => b.id) : [];
    return {
      zoneId: z.id, code: z.code, dm1444: z.dm1444, areaM2: poly.area, buildings: inside.length, footprintM2: fp, volumeM3: vol,
      coveragePct: cov, indexM3M2: idx, tallest: inside.reduce((m, b) => Math.max(m, b.h), 0), overHeight: over,
      coverageOk: z.rules.maxCoverage !== undefined ? cov <= z.rules.maxCoverage : null,
      indexOk: z.rules.maxIndexFondiario !== undefined ? idx <= z.rules.maxIndexFondiario : null,
      heightOk: z.rules.maxHeight !== undefined ? over.length === 0 : null,
    };
  });
}

// ---------------------------------------------------------------- scenario vs constraints

export interface PlanCheckIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly targetKind: 'road' | 'area' | 'asset';
  readonly targetId: string;
  readonly constraintId?: string;
  readonly zoneId?: string;
}

const isProjectRoad = (r: Road) => r.provenance.geometry?.kind === 'project';

/**
 * «Verifica del progetto»: project items of the scenario (new or re-traced roads, project areas and
 * new building footprints) that intersect constraints or sensitive plan zones.
 */
export function checkScenarioAgainstPlan(net: Network, origin: LngLat, plan: UrbanPlanDoc | null): PlanCheckIssue[] {
  if (!plan) return [];
  const f = new LocalFrame(origin);
  const cons = plan.constraints.map((c) => ({ c, poly: metricPolygon(f, c.polygon, c.holes) }));
  const zones = plan.zones.map((z) => ({ z, poly: metricPolygon(f, z.polygon, z.holes) }));
  const out: PlanCheckIssue[] = [];
  const label = (c: PlanConstraint) => `${CONSTRAINT_LABEL[c.type]}${c.name ? ` «${c.name}»` : ''}`;
  for (const r of Object.values(net.roads)) {
    if (!isProjectRoad(r)) continue;
    const line = r.axis.map((q) => f.toMetric(q) as V);
    const nm = r.name || r.id;
    for (const { c, poly } of cons) {
      if (!lineTouchesPolygon(line, poly)) continue;
      const sev = c.type === 'paesaggistico' || c.type === 'idrogeologico' ? 'warning' : 'info';
      const what = c.type === 'paesaggistico' ? 'serve l\'autorizzazione paesaggistica (art. 146)' : c.type === 'idrogeologico' ? 'verificare la compatibilità idraulica/geologica (PAI)' : c.type === 'rispetto_stradale' ? 'opera stradale in fascia di rispetto: ammessa, verificare accessi e distanze (art. 26–28 Reg. CdS)' : c.type === 'ferroviario' ? 'serve il nulla osta del gestore ferroviario' : c.type === 'cimiteriale' ? 'opera pubblica in fascia cimiteriale: verificare la compatibilità' : 'verificare la disciplina del vincolo';
      out.push({ severity: sev, code: `plan.road.${c.type}`, message: `Strada di progetto ${nm} in ${label(c)}: ${what}`, targetKind: 'road', targetId: r.id, constraintId: c.id });
    }
    for (const { z, poly } of zones) {
      if ((z.dm1444 === 'A' || z.dm1444 === 'E') && lineTouchesPolygon(line, poly)) {
        out.push({ severity: z.dm1444 === 'A' ? 'warning' : 'info', code: `plan.road.zone${z.dm1444}`, message: `Strada di progetto ${nm} in zona ${z.code} (${DM1444_LABEL[z.dm1444]}): ${z.dm1444 === 'A' ? 'intervento nel centro storico, verificare il piano di recupero / le NTA' : 'nuova viabilità in zona agricola, verificare la conformità urbanistica'}`, targetKind: 'road', targetId: r.id, zoneId: z.id });
      }
    }
  }
  for (const a of Object.values(net.areas)) {
    if (a.state !== 'project' || a.kind === 'crossing' || a.polygon.length < 3) continue;
    const ring = a.polygon.map((q) => f.toMetric(q) as V);
    const building = a.kind === 'building_footprint';
    const nm = a.name || (building ? 'Nuovo edificio' : `Superficie ${a.kind}`);
    for (const { c, poly } of cons) {
      if (!lineTouchesPolygon(ring, poly, true)) continue;
      const inedificabile = c.type === 'rispetto_stradale' || c.type === 'cimiteriale' || c.type === 'ferroviario';
      const sev = building ? (inedificabile ? 'error' : 'warning') : c.type === 'paesaggistico' || c.type === 'idrogeologico' ? 'warning' : 'info';
      const what = building
        ? (inedificabile ? 'area inedificabile per la fascia di rispetto' : c.type === 'paesaggistico' ? 'serve l\'autorizzazione paesaggistica' : 'verificare la compatibilità con il vincolo')
        : (c.type === 'paesaggistico' ? 'sistemazione in area vincolata: autorizzazione paesaggistica (anche semplificata, DPR 31/2017)' : 'verificare la disciplina del vincolo');
      out.push({ severity: sev, code: `plan.area.${c.type}`, message: `${nm} in ${label(c)}: ${what}`, targetKind: 'area', targetId: a.id, constraintId: c.id });
    }
    if (building) {
      for (const { z, poly } of zones) {
        if (!lineTouchesPolygon(ring, poly, true)) continue;
        if (z.dm1444 === 'F' || z.dm1444 === 'E' || z.standard) {
          out.push({ severity: 'warning', code: `plan.building.zone${z.dm1444}`, message: `${nm} in zona ${z.code} (${z.standard ? `area a standard: ${STANDARD_LABEL[z.standard]}` : DM1444_LABEL[z.dm1444]}): verificare la destinazione ammessa`, targetKind: 'area', targetId: a.id, zoneId: z.id });
        }
        const h = typeof a.properties.heightM === 'number' ? a.properties.heightM : null;
        if (h !== null && z.rules.maxHeight !== undefined && h > z.rules.maxHeight) {
          out.push({ severity: 'error', code: 'plan.building.height', message: `${nm}: altezza ${h} m oltre il massimo di zona ${z.code} (${z.rules.maxHeight} m)`, targetKind: 'area', targetId: a.id, zoneId: z.id });
        }
      }
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------- generated constraint bands

/**
 * Setback distances of DPR 495/1992 (Regolamento CdS) by DM 5/11/2001 category:
 * art. 26 outside built-up areas (A 60 m, B 40 m, C 30 m, F 20 m — 10 m for strade vicinali);
 * art. 28 inside built-up areas (A 30 m, D 20 m; E and F set by the plan).
 */
export const ROAD_SETBACK_M: Readonly<Record<'outside' | 'inside', Readonly<Record<string, number>>>> = {
  outside: { A: 60, B: 40, C: 30, F: 20 },
  inside: { A: 30, D: 20 },
};

/** DM 5/11/2001 category of a road for the setback, from its OSM class and the setting. */
export function setbackCategory(road: Road, where: 'outside' | 'inside'): string | null {
  const c = road.roadClass.replace(/_link$/, '');
  if (c === 'motorway') return 'A';
  if (c === 'trunk') return where === 'outside' ? 'B' : 'D';
  if (c === 'primary') return where === 'outside' ? 'C' : 'D';
  if (c === 'secondary') return where === 'outside' ? 'C' : 'E';
  if (c === 'tertiary' || c === 'unclassified') return where === 'outside' ? 'F' : 'E';
  return where === 'outside' && (c === 'residential' || c === 'track') ? 'F' : null;
}

/**
 * Indicative constraint polygons generated from the network and the mapped features:
 * fasce di rispetto stradale (per road, setback from the carriageway edge), cimiteriale (200 m from the
 * cemetery, reducible to 50 m by the council) and ferroviaria (30 m from the outer rail).
 */
export function generateConstraints(net: Network, baseline: CityBaseline, opts: { where?: 'outside' | 'inside'; cemeteryM?: number; railwayM?: number; idPrefix?: string } = {}): PlanConstraint[] {
  const where = opts.where ?? 'inside';
  const f = new LocalFrame(baseline.origin);
  const out: PlanConstraint[] = [];
  const pre = opts.idPrefix ?? 'gen';
  const src = 'Generata da DRIP (indicativa, da verificare sugli atti)';
  for (const r of Object.values(net.roads)) {
    if (isPedestrianRoad(r)) continue;
    const cat = setbackCategory(r, where);
    const d = cat ? ROAD_SETBACK_M[where][cat] : undefined;
    if (!d) continue;
    const pts = r.axis.map((q) => f.toMetric(q) as V);
    if (lengthOf(pts) < 5) continue;
    const half = r.lanes.reduce((s, l) => s + l.widthM, 0) / 2 || 3;
    const ring = band(pts, half + d, -(half + d));
    out.push({ id: `${pre}-rs-${r.id}`, type: 'rispetto_stradale', name: `${r.name || r.roadClass} (cat. ${cat}, ${d} m)`, polygon: ring.map((p) => f.toLngLat(p)), note: `${where === 'outside' ? 'Fuori' : 'Dentro'} il centro abitato, DPR 495/1992 art. ${where === 'outside' ? 26 : 28}`, source: src });
  }
  const cem = opts.cemeteryM ?? 200, rail = opts.railwayM ?? 30;
  for (const ft of Object.values(baseline.features)) {
    if (ft.geometry === 'polygon' && ft.properties.landuse === 'cemetery' && ft.coords.length >= 3 && cem > 0) {
      const ring = ft.coords.map((q) => f.toMetric(q) as V);
      const outline = bufferRing(ring, cem);
      if (outline.length >= 3) out.push({ id: `${pre}-cim-${ft.id}`, type: 'cimiteriale', name: `${ft.name ?? (ft.properties.name as string | undefined) ?? 'Cimitero'} (${cem} m)`, polygon: outline.map((p) => f.toLngLat(p)), note: 'RD 1265/1934 art. 338 (riducibile a 50 m con delibera)', source: src });
    }
    if (ft.geometry === 'line' && ft.kind === 'railway' && ft.coords.length >= 2 && rail > 0) {
      const pts = ft.coords.map((q) => f.toMetric(q) as V);
      const ring = band(pts, rail + 2, -(rail + 2));
      out.push({ id: `${pre}-fer-${ft.id}`, type: 'ferroviario', name: `${ft.name ?? 'Ferrovia'} (${rail} m)`, polygon: ring.map((p) => f.toLngLat(p)), note: 'DPR 753/1980 art. 49: 30 m dalla rotaia più vicina', source: src });
    }
  }
  return out;
}

/** Outward buffer of a ring (vertex normals with a miter limit), good for convex-ish shapes such as cemeteries. */
function bufferRing(ring: readonly V[], d: number): V[] {
  return insetRing(ring, -d, 1.6);
}

/**
 * Ring offset inwards by `d` metres (negative = outwards), mitred with a limit. Works on simple rings
 * of either orientation; meant for moderate distances on block-sized polygons.
 */
export function insetRing(ring: readonly V[], d: number, miterLimit = 3): V[] {
  const n = ring.length;
  if (n < 3) return [...ring];
  const ccw = ringArea(ring) > 0;
  const s = ccw ? d : -d;
  const out: V[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n]!, c = ring[i]!, q = ring[(i + 1) % n]!;
    const u1 = norm2([c[0] - p[0], c[1] - p[1]]), u2 = norm2([q[0] - c[0], q[1] - c[1]]);
    // Left normals point inside a counter-clockwise ring.
    const n1: V = [-u1[1], u1[0]], n2: V = [-u2[1], u2[0]];
    const bis = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = bis[0] * n2[0] + bis[1] * n2[1];
    const k = Math.min(miterLimit, 1 / Math.max(cos, 1e-6));
    out.push([c[0] + bis[0] * s * k, c[1] + bis[1] * s * k]);
  }
  return out;
}

function norm2(v: V): V {
  const L = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / L, v[1] / L];
}
