import { LocalFrame } from '../geo/projection';
import { lengthOf, ringArea, simplifyRing, type V } from '../geo/polyline';
import type { CityBaseline, FunctionalClass, LngLat, Network, Road, Zone, ZoneKind } from '../model/types';
import { isPedestrianRoad } from '../physical/section';
import type { SafetyScore } from './safety';
import type { TrafficResult } from './traffic';
import { centroidOf, estimateResidents, inPolygon, insetRing, metricPolygon, pointInRing, type ResidentPoint, type UrbanPlanDoc } from './urbanplan';
import { verticalRules } from './vertical';

/**
 * Piano Generale del Traffico Urbano (Direttive 12/4/1995) and PUMS (DM 4/8/2017 n. 397, DM 396/2019):
 * functional classification of the network, environmental islands (isole ambientali) and a selection
 * of PUMS indicators. Everything here is a planning estimate from the scenario network.
 */

/** From the highest to the lowest rank. */
export const FUNCTIONAL_CLASSES: readonly FunctionalClass[] = ['autostrada', 'scorrimento_veloce', 'scorrimento', 'interquartiere', 'quartiere', 'interzonale', 'locale'];

export const FUNCTIONAL_LABEL: Readonly<Record<FunctionalClass, string>> = {
  autostrada: 'Autostrada', scorrimento_veloce: 'Strada di scorrimento veloce', scorrimento: 'Strada di scorrimento', interquartiere: 'Strada interquartiere',
  quartiere: 'Strada di quartiere', interzonale: 'Strada locale interzonale', locale: 'Strada locale',
};

export const FUNCTIONAL_COLOR: Readonly<Record<FunctionalClass, string>> = {
  autostrada: '#5b2a86', scorrimento_veloce: '#8b0209', scorrimento: '#d0312d', interquartiere: '#e8772e', quartiere: '#e2b13c', interzonale: '#5587a2', locale: '#9aa3ab',
};

/** DM 5/11/2001 categories compatible with each functional class (urban and extra-urban). */
export const FUNCTIONAL_DM_CATEGORIES: Readonly<Record<FunctionalClass, readonly string[]>> = {
  autostrada: ['A'], scorrimento_veloce: ['A', 'B', 'D'], scorrimento: ['B', 'D'], interquartiere: ['C', 'D', 'E'], quartiere: ['C', 'E'], interzonale: ['E', 'F'], locale: ['F'],
};

/** Principal network: bounds the environmental islands. */
export const PRINCIPAL: ReadonlySet<FunctionalClass> = new Set(['autostrada', 'scorrimento_veloce', 'scorrimento', 'interquartiere', 'quartiere']);
export const rankOf = (c: FunctionalClass) => FUNCTIONAL_CLASSES.indexOf(c);

const NON_VEHICULAR = new Set(['footway', 'pedestrian', 'cycleway', 'path', 'steps', 'bridleway', 'construction', 'proposed', 'platform', 'corridor', 'elevator']);

/** Roads that carry motor traffic and are therefore classified. */
export function isVehicularRoad(r: Road): boolean {
  return !NON_VEHICULAR.has(r.roadClass) && !isPedestrianRoad(r);
}

const OSM_CLASS: Readonly<Record<string, FunctionalClass>> = {
  motorway: 'autostrada', trunk: 'scorrimento_veloce', primary: 'scorrimento', secondary: 'interquartiere', tertiary: 'quartiere', unclassified: 'interzonale',
};

export function osmFunctionalClass(r: Road): FunctionalClass {
  return OSM_CLASS[r.roadClass.replace(/_link$/, '')] ?? 'locale';
}

export interface ClassProposal {
  readonly roadId: string;
  readonly cls: FunctionalClass;
  /** Why: 'osm', 'traffico', 'connettività', 'frammento'. */
  readonly basis: readonly string[];
}

export interface ClassificationResult {
  readonly proposals: readonly ClassProposal[];
  /** Number of connected components of the principal network after the proposal (1 = skeleton). */
  readonly principalComponents: number;
  readonly principalKm: number;
  readonly method: string;
}

interface Adj { readonly road: Road; readonly other: string; readonly lengthM: number }

function adjacency(net: Network, roads: readonly Road[], f: LocalFrame): { adj: Map<string, Adj[]>; len: Map<string, number> } {
  const adj = new Map<string, Adj[]>();
  const len = new Map<string, number>();
  for (const r of roads) {
    const L = lengthOf(r.axis.map((q) => f.toMetric(q) as V));
    len.set(r.id, L);
    if (!net.nodes[r.from] || !net.nodes[r.to]) continue;
    (adj.get(r.from) ?? adj.set(r.from, []).get(r.from)!).push({ road: r, other: r.to, lengthM: L });
    (adj.get(r.to) ?? adj.set(r.to, []).get(r.to)!).push({ road: r, other: r.from, lengthM: L });
  }
  return { adj, len };
}

function components(roadIds: readonly string[], net: Network): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let p = parent.get(x) ?? x; while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p; parent.set(x, p); return p; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const id of roadIds) { const r = net.roads[id]!; union(`n:${r.from}`, `n:${r.to}`); }
  const by = new Map<string, string[]>();
  for (const id of roadIds) { const k = find(`n:${net.roads[id]!.from}`); (by.get(k) ?? by.set(k, []).get(k)!).push(id); }
  return [...by.values()];
}

/**
 * Automatic PGTU classification of the vehicular network:
 *  1. from the OSM class (motorway → autostrada, trunk → scorrimento veloce, primary → scorrimento,
 *     secondary → interquartiere, tertiary → quartiere, unclassified → interzonale, others → locale);
 *  2. traffic: local roads carrying > 400 veic/h in the peak hour become interzonali, interzonali
 *     > 800 veic/h become di quartiere (estimate from `estimateTraffic`, when given);
 *  3. connectivity: the principal network must be one connected skeleton. Small isolated principal
 *     fragments (< 300 m) are demoted to interzonale; larger ones are joined to the skeleton through
 *     the shortest path on the network, upgraded to strada di quartiere.
 */
export function proposeFunctionalClasses(net: Network, baseline: CityBaseline, traffic: TrafficResult | null = null): ClassificationResult {
  const f = new LocalFrame(baseline.origin);
  const roads = Object.values(net.roads).filter(isVehicularRoad).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cls = new Map<string, FunctionalClass>();
  const basis = new Map<string, string[]>();
  for (const r of roads) { cls.set(r.id, osmFunctionalClass(r)); basis.set(r.id, ['osm']); }
  if (traffic) {
    const vol = new Map<string, number>();
    for (const fl of traffic.flows) vol.set(fl.roadId, (vol.get(fl.roadId) ?? 0) + fl.volumeVph);
    for (const r of roads) {
      const v = vol.get(r.id) ?? 0, c = cls.get(r.id)!;
      if (c === 'locale' && v > 400) { cls.set(r.id, 'interzonale'); basis.get(r.id)!.push('traffico'); }
      else if (c === 'interzonale' && v > 800) { cls.set(r.id, 'quartiere'); basis.get(r.id)!.push('traffico'); }
    }
  }
  const { adj, len } = adjacency(net, roads, f);
  const principalIds = () => roads.filter((r) => PRINCIPAL.has(cls.get(r.id)!)).map((r) => r.id);
  const compLen = (c: readonly string[]) => c.reduce((s, id) => s + (len.get(id) ?? 0), 0);
  let comps = components(principalIds(), net).sort((a, b) => compLen(b) - compLen(a) || (a[0]! < b[0]! ? -1 : 1));
  if (comps.length > 1) {
    const skeletonNodes = new Set<string>();
    const addNodes = (ids: readonly string[]) => { for (const id of ids) { skeletonNodes.add(net.roads[id]!.from); skeletonNodes.add(net.roads[id]!.to); } };
    addNodes(comps[0]!);
    const weight = (r: Road) => { const c = cls.get(r.id)!; return PRINCIPAL.has(c) ? 1 : c === 'interzonale' ? 1.6 : 3; };
    for (const comp of comps.slice(1)) {
      const demote = () => { for (const id of comp) { cls.set(id, 'interzonale'); basis.get(id)!.push('frammento'); } };
      if (compLen(comp) < 300) { demote(); continue; }
      // Multi-source Dijkstra from the fragment to the skeleton.
      const src = new Set<string>();
      for (const id of comp) { src.add(net.roads[id]!.from); src.add(net.roads[id]!.to); }
      const dist = new Map<string, number>(), prev = new Map<string, Adj & { from: string }>();
      const heap: [number, string][] = [];
      const push = (d: number, n: string) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
      const pop = (): [number, string] => { const top = heap[0]!; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
      for (const n of src) { dist.set(n, 0); push(0, n); }
      let hit: string | null = null;
      while (heap.length) {
        const [d, n] = pop();
        if (d > (dist.get(n) ?? Infinity)) continue;
        if (skeletonNodes.has(n) && !src.has(n)) { hit = n; break; }
        if (d > 5000) break;
        for (const e of adj.get(n) ?? []) {
          const nd = d + e.lengthM * weight(e.road);
          if (nd < (dist.get(e.other) ?? Infinity)) { dist.set(e.other, nd); prev.set(e.other, { ...e, from: n }); push(nd, e.other); }
        }
      }
      if (!hit) { demote(); continue; }
      let n = hit;
      while (!src.has(n)) {
        const e = prev.get(n)!;
        if (!PRINCIPAL.has(cls.get(e.road.id)!)) { cls.set(e.road.id, 'quartiere'); basis.get(e.road.id)!.push('connettività'); }
        n = e.from;
      }
      // The fragment and its connector are now part of the skeleton.
      addNodes(comp);
      addNodes(roads.filter((r) => PRINCIPAL.has(cls.get(r.id)!)).map((r) => r.id));
    }
    comps = components(principalIds(), net);
  }
  const pIds = principalIds();
  return {
    proposals: roads.map((r) => ({ roadId: r.id, cls: cls.get(r.id)!, basis: basis.get(r.id)! })),
    principalComponents: comps.length,
    principalKm: pIds.reduce((s, id) => s + (len.get(id) ?? 0), 0) / 1000,
    method: 'Proposta DRIP: classe OSM → classe funzionale PGTU (Direttive 12/4/1995), promozione delle strade locali con traffico stimato elevato, ricucitura della rete principale in un unico scheletro connesso. Da verificare con il PGTU vigente.',
  };
}

/** Functional class of every vehicular road: authored value, otherwise the given proposal / OSM default. */
export function effectiveFunctionalClasses(net: Network, proposal: ClassificationResult | null = null): Record<string, FunctionalClass> {
  const p = new Map(proposal?.proposals.map((x) => [x.roadId, x.cls]) ?? []);
  const out: Record<string, FunctionalClass> = {};
  for (const r of Object.values(net.roads)) {
    if (!isVehicularRoad(r)) continue;
    out[r.id] = r.functionalClass ?? p.get(r.id) ?? osmFunctionalClass(r);
  }
  return out;
}

export interface ClassIssue { readonly roadId: string; readonly severity: 'warning' | 'info'; readonly message: string }

/**
 * Consistency of the functional class with the DM 5/11/2001 category of the road (as used in the
 * vertical design rules) and with its section and speed.
 */
export function checkFunctionalClasses(net: Network, classes: Readonly<Record<string, FunctionalClass>>): ClassIssue[] {
  const out: ClassIssue[] = [];
  for (const [id, c] of Object.entries(classes)) {
    const r = net.roads[id];
    if (!r) continue;
    const nm = r.name || r.id;
    const cat = verticalRules(r).category.charAt(0);
    if (/[A-F]/.test(cat) && !FUNCTIONAL_DM_CATEGORIES[c].includes(cat)) {
      out.push({ roadId: id, severity: 'warning', message: `${nm}: ${FUNCTIONAL_LABEL[c].toLowerCase()} su strada di categoria ${cat} (DM 5/11/2001); categorie coerenti: ${FUNCTIONAL_DM_CATEGORIES[c].join(', ')}` });
    }
    const perDir = Math.max(r.lanes.filter((l) => l.direction === 'forward').length, r.lanes.filter((l) => l.direction === 'backward').length);
    const hasMedian = r.section.elements.some((e) => e.kind === 'median');
    if ((c === 'scorrimento' || c === 'scorrimento_veloce') && !r.tags?.roundabout && (perDir < 2 || (r.oneway === 'no' && !hasMedian))) {
      out.push({ roadId: id, severity: 'info', message: `${nm}: le strade di scorrimento richiedono carreggiate separate con almeno 2 corsie per senso (DM 5/11/2001 cat. D)` });
    }
    if ((c === 'locale' || c === 'interzonale') && r.speedKmh > 50) out.push({ roadId: id, severity: 'warning', message: `${nm}: limite ${r.speedKmh} km/h su strada locale` });
    if (c === 'locale' && r.lanes.some((l) => l.modes.includes('bus')) && r.tags?.['bus'] === 'designated') out.push({ roadId: id, severity: 'info', message: `${nm}: linea bus su strada locale` });
  }
  return out;
}

// ---------------------------------------------------------------- environmental islands

export type IslandProposal = Extract<ZoneKind, 'zone30' | 'ztl' | 'pedestrian'>;

export interface EnvironmentalIsland {
  readonly id: string;
  /** Face of the principal network (closed ring, CCW). */
  readonly polygon: readonly LngLat[];
  /** Polygon inset from the principal axes: ready for `zone.set`. */
  readonly zonePolygon: readonly LngLat[];
  readonly areaHa: number;
  readonly perimeterM: number;
  readonly residents: number;
  readonly densityPerHa: number;
  readonly internalRoadIds: readonly string[];
  readonly internalKm: number;
  readonly boundaryRoads: readonly string[];
  readonly existingZoneId: string | null;
  readonly proposal: IslandProposal;
  readonly reason: string;
}

interface HalfEdge { from: string; to: string; pts: V[]; angle: number; roadId: string; used: boolean }

/**
 * Isole ambientali: faces of the planar graph formed by the principal network (classes from
 * autostrada to quartiere). Dangling principal branches are pruned; faces under `minAreaHa` or too
 * thin (dual carriageways, ramps) are discarded. Each island gets a proposal (Zona 30 by default,
 * ZTL in historic centres — zone A of the plan —, area pedonale for small dense cores).
 */
export function environmentalIslands(net: Network, baseline: CityBaseline, classes: Readonly<Record<string, FunctionalClass>>, opts: { minAreaHa?: number; maxAreaHa?: number; insetM?: number; plan?: UrbanPlanDoc | null; residents?: readonly ResidentPoint[] } = {}): EnvironmentalIsland[] {
  const f = new LocalFrame(baseline.origin);
  const minA = (opts.minAreaHa ?? 1) * 10_000, maxA = (opts.maxAreaHa ?? 400) * 10_000, inset = opts.insetM ?? 8;
  let edges = Object.entries(classes).filter(([id, c]) => PRINCIPAL.has(c) && net.roads[id] && net.nodes[net.roads[id]!.from] && net.nodes[net.roads[id]!.to]).map(([id]) => net.roads[id]!);
  // Prune dangling branches (degree-1 nodes) repeatedly.
  for (;;) {
    const deg = new Map<string, number>();
    for (const r of edges) { deg.set(r.from, (deg.get(r.from) ?? 0) + 1); deg.set(r.to, (deg.get(r.to) ?? 0) + 1); }
    const next = edges.filter((r) => r.from !== r.to && (deg.get(r.from) ?? 0) > 1 && (deg.get(r.to) ?? 0) > 1);
    if (next.length === edges.length) break;
    edges = next;
  }
  const out = new Map<string, HalfEdge[]>();
  const all: HalfEdge[] = [];
  const dirAngle = (pts: readonly V[]) => {
    const a = pts[0]!;
    const b = pts.find((p) => Math.hypot(p[0] - a[0], p[1] - a[1]) > 2) ?? pts[pts.length - 1]!;
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (const r of edges) {
    const pts = r.axis.map((q) => f.toMetric(q) as V);
    const rev = [...pts].reverse();
    const h1: HalfEdge = { from: r.from, to: r.to, pts, angle: dirAngle(pts), roadId: r.id, used: false };
    const h2: HalfEdge = { from: r.to, to: r.from, pts: rev, angle: dirAngle(rev), roadId: r.id, used: false };
    for (const h of [h1, h2]) { (out.get(h.from) ?? out.set(h.from, []).get(h.from)!).push(h); all.push(h); }
  }
  for (const list of out.values()) list.sort((a, b) => a.angle - b.angle || (a.roadId < b.roadId ? -1 : 1));
  const twinIndex = (h: HalfEdge) => {
    const list = out.get(h.to)!;
    return list.findIndex((t) => t.roadId === h.roadId && t.to === h.from && t !== h);
  };
  const res = opts.residents ?? estimateResidents(baseline, opts.plan ?? null);
  const zonesA = (opts.plan?.zones ?? []).filter((z) => z.dm1444 === 'A').map((z) => metricPolygon(f, z.polygon, z.holes));
  const existing = Object.values(net.zones).filter((z) => z.kind === 'zone30' || z.kind === 'ztl' || z.kind === 'pedestrian' || z.kind === 'school').map((z) => ({ z, ring: z.polygon.map((q) => f.toMetric(q) as V) }));
  const islands: EnvironmentalIsland[] = [];
  for (const start of all) {
    if (start.used) continue;
    const ring: V[] = [];
    const roadIds: string[] = [];
    let h = start, guard = 0;
    do {
      h.used = true;
      ring.push(...h.pts.slice(0, -1));
      roadIds.push(h.roadId);
      const list = out.get(h.to)!;
      const ti = twinIndex(h);
      h = list[(ti - 1 + list.length) % list.length]!;
    } while (h !== start && ++guard < 20000);
    const area = ringArea(ring);
    if (area <= minA || area > maxA) continue;
    const perim = lengthOf([...ring, ring[0]!]);
    if ((4 * Math.PI * area) / (perim * perim) < 0.08) continue;
    const simple = simplifyRing(ring, 2);
    const zoneRing = insetRing(simple, inset);
    const okInset = Math.abs(ringArea(zoneRing)) > 0.4 * area && ringArea(zoneRing) > 0;
    const zr = okInset ? zoneRing : simple;
    const poly = { outer: ring, holes: [], bbox: bboxOf(ring), area } as const;
    const inside = res.filter((p) => inPolygon(p.at, poly));
    const residents = inside.reduce((s, p) => s + p.residents, 0);
    const boundary = new Set(roadIds);
    const internal = Object.values(net.roads).filter((r) => !boundary.has(r.id) && isVehicularRoad(r) && !PRINCIPAL.has(classes[r.id] ?? 'locale') && inPolygon(midpoint(r, f), poly));
    const internalKm = internal.reduce((s, r) => s + lengthOf(r.axis.map((q) => f.toMetric(q) as V)), 0) / 1000;
    const c = centroidOf(ring);
    const ex = existing.find((e) => pointInRing(c, e.ring)) ?? null;
    const ha = area / 10_000, dens = residents / ha;
    const pedestrianStreets = Object.values(net.roads).filter((r) => (r.roadClass === 'pedestrian' || r.roadClass === 'living_street') && inPolygon(midpoint(r, f), poly)).length;
    let proposal: IslandProposal = 'zone30';
    let reason = 'Isola ambientale delimitata dalla rete principale: Zona 30 con moderazione del traffico (Direttive PGTU § 3.1.2)';
    if (zonesA.some((z) => inPolygon(c, z))) { proposal = 'ztl'; reason = 'Isola nel centro storico (zona A del piano): ZTL con accesso ai residenti'; }
    else if (ha <= 3 && pedestrianStreets > 0 && dens > 150) { proposal = 'pedestrian'; reason = 'Nucleo piccolo e denso con strade già pedonali o residenziali: area pedonale'; }
    const names = [...new Set(roadIds.map((id) => net.roads[id]?.name).filter((n): n is string => !!n))];
    islands.push({
      id: `isola-${islands.length + 1}`,
      polygon: simple.map((p) => f.toLngLat(p)), zonePolygon: zr.map((p) => f.toLngLat(p)),
      areaHa: Math.round(ha * 100) / 100, perimeterM: Math.round(perim), residents: Math.round(residents), densityPerHa: Math.round(dens),
      internalRoadIds: internal.map((r) => r.id), internalKm: Math.round(internalKm * 100) / 100, boundaryRoads: names.slice(0, 6),
      existingZoneId: ex?.z.id ?? null, proposal, reason,
    });
  }
  islands.sort((a, b) => b.areaHa - a.areaHa);
  return islands.map((x, i) => ({ ...x, id: `isola-${i + 1}` }));
}

function bboxOf(ring: readonly V[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}

function midpoint(r: Road, f: LocalFrame): V {
  const pts = r.axis.map((q) => f.toMetric(q) as V);
  const L = lengthOf(pts);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + d >= L / 2 && d > 0) { const t = (L / 2 - acc) / d; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    acc += d;
  }
  return pts[0]!;
}

/** The zone a «Crea Zona 30» on an island commits (zone.set payload). */
export function islandZone(island: EnvironmentalIsland, id: string, kind: IslandProposal = island.proposal): Zone {
  const name = `${kind === 'ztl' ? 'ZTL' : kind === 'pedestrian' ? 'Area pedonale' : 'Zona 30'} — ${island.boundaryRoads.slice(0, 2).join(' / ') || island.id}`;
  return {
    id, kind, name, polygon: island.zonePolygon,
    allowedModes: kind === 'ztl' ? ['bus', 'emergency', 'bike', 'walk'] : kind === 'pedestrian' ? ['walk', 'bike', 'emergency'] : ['car', 'bus', 'truck', 'bike', 'walk', 'emergency'],
    ...(kind === 'zone30' ? { speedKmh: 30 } : {}),
    ...(kind === 'ztl' ? { schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '24:00' }], permits: ['residenti', 'disabili'] } : {}),
  };
}

// ---------------------------------------------------------------- PUMS indicators

export type PumsMacro = 'A' | 'B' | 'C' | 'D';
export const PUMS_MACRO_LABEL: Readonly<Record<PumsMacro, string>> = {
  A: 'A — Efficacia ed efficienza del sistema di mobilità', B: 'B — Sostenibilità energetica e ambientale', C: 'C — Sicurezza della mobilità stradale', D: 'D — Sostenibilità socio-economica',
};

export interface PumsIndicator {
  readonly id: string;
  readonly macro: PumsMacro;
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly note?: string;
}

export interface PumsInput {
  readonly net: Network;
  readonly baseline: CityBaseline;
  readonly classes?: Readonly<Record<string, FunctionalClass>>;
  readonly residents?: readonly ResidentPoint[];
  readonly transitStops?: readonly LngLat[];
  readonly bikeStations?: readonly LngLat[];
  readonly traffic?: TrafficResult | null;
  readonly safety?: readonly SafetyScore[] | null;
}

export const PUMS_NOTE = 'Selezione di indicatori del DM 4/8/2017 n. 397 (allegato 2), come modificato dal DM 396/2019, calcolabili dal modello: non è l\'elenco completo né sostituisce il monitoraggio del PUMS.';

/** A selection of the PUMS indicators (DM 397/2017 all. 2, DM 396/2019), computed on one network. */
export function pumsIndicators(input: PumsInput): PumsIndicator[] {
  const { net, baseline } = input;
  const f = new LocalFrame(baseline.origin);
  const res = input.residents ?? estimateResidents(baseline);
  const pop = res.reduce((s, r) => s + r.residents, 0);
  const classes = input.classes ?? effectiveFunctionalClasses(net);
  const zonePolys = (kinds: readonly ZoneKind[]) => Object.values(net.zones).filter((z) => kinds.includes(z.kind) && z.polygon.length >= 3).map((z) => metricPolygon(f, z.polygon));
  const z30 = zonePolys(['zone30', 'school']), ztl = zonePolys(['ztl']), ped = zonePolys(['pedestrian']);
  let vehM = 0, pedClassM = 0, inZ30 = 0, inZtl = 0, inPed = 0, cycleM = 0, onStreetParkM = 0, principalM = 0, localM = 0;
  const lenOf = new Map<string, number>();
  for (const r of Object.values(net.roads).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const L = lengthOf(r.axis.map((q) => f.toMetric(q) as V));
    lenOf.set(r.id, L);
    const cycles = r.section.elements.filter((e) => e.kind === 'cycle').length + r.lanes.filter((l) => l.restriction === 'bike_only').length;
    if (r.roadClass === 'cycleway') cycleM += L; else cycleM += cycles * L;
    if (r.roadClass === 'pedestrian') pedClassM += L;
    if (!isVehicularRoad(r)) continue;
    vehM += L;
    onStreetParkM += r.section.elements.filter((e) => e.kind === 'parking').length * L;
    const c = classes[r.id];
    if (c && PRINCIPAL.has(c)) principalM += L; else localM += L;
    const m = midpoint(r, f);
    if (r.speedKmh <= 30 || z30.some((p) => inPolygon(m, p))) inZ30 += L;
    if (ztl.some((p) => inPolygon(m, p))) inZtl += L;
    if (ped.some((p) => inPolygon(m, p))) inPed += L;
  }
  const covered = (pts: readonly LngLat[] | undefined, radius: number) => {
    if (!pts?.length) return 0;
    const s = pts.map((p) => f.toMetric(p) as V);
    const cell = radius;
    const grid = new Map<string, V[]>();
    for (const q of s) { const k = `${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(q); }
    let n = 0;
    for (const r of res) {
      if (!r.residents) continue;
      const cx = Math.floor(r.at[0] / cell), cy = Math.floor(r.at[1] / cell);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(q[0] - r.at[0], q[1] - r.at[1]) <= radius) { hit = true; break; }
      if (hit) n += r.residents;
    }
    return n;
  };
  let offStreetM2 = 0;
  for (const ft of Object.values(baseline.features)) {
    if (ft.geometry === 'polygon' && ft.properties.amenity === 'parking' && ft.properties.access !== 'private' && ft.coords.length >= 3) offStreetM2 += Math.abs(ringArea(ft.coords.map((q) => f.toMetric(q) as V)));
  }
  for (const a of Object.values(net.areas)) if (a.kind === 'parking' && a.state !== 'removed' && a.polygon.length >= 3) offStreetM2 += Math.abs(ringArea(a.polygon.map((q) => f.toMetric(q) as V)));
  const totalStreet = vehM + pedClassM;
  const pct = (x: number, t: number) => (t > 0 ? Math.round((x / t) * 1000) / 10 : 0);
  const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
  const tr = input.traffic ?? null;
  let congested: number | null = null;
  if (tr) {
    let all = 0, hi = 0;
    for (const fl of tr.flows) { const vk = fl.volumeVph * (lenOf.get(fl.roadId) ?? 0); all += vk; if (fl.vc > 0.9) hi += vk; }
    congested = all > 0 ? Math.round((hi / all) * 1000) / 10 : 0;
  }
  const transitCov = input.transitStops?.length ? covered(input.transitStops, 300) : 0;
  const bikeCov = input.bikeStations?.length ? covered(input.bikeStations, 300) : 0;
  return [
    { id: 'residents', macro: 'D', label: 'Abitanti stimati', value: Math.round(pop), unit: 'ab', note: 'Da volume residenziale / 100 m³/ab' },
    { id: 'cycle_km', macro: 'A', label: 'Percorsi ciclabili (per lato)', value: r2(cycleM / 1000), unit: 'km', note: 'Piste ciclabili e corsie riservate alle bici della sezione' },
    { id: 'cycle_per_inh', macro: 'A', label: 'Percorsi ciclabili per abitante', value: pop > 0 ? r2(cycleM / pop) : null, unit: 'm/ab' },
    { id: 'zone30_pct', macro: 'C', label: 'Rete stradale in Zona 30 (o limite ≤ 30 km/h)', value: pct(inZ30, vehM), unit: '%' },
    { id: 'ztl_pct', macro: 'B', label: 'Rete stradale in ZTL', value: pct(inZtl, vehM), unit: '%' },
    { id: 'pedestrian_pct', macro: 'B', label: 'Strade pedonali o in area pedonale', value: pct(inPed + pedClassM, totalStreet), unit: '%' },
    { id: 'transit_300', macro: 'A', label: 'Popolazione entro 300 m da una fermata TPL', value: pop > 0 ? pct(transitCov, pop) : null, unit: '%', note: input.transitStops?.length ? `${input.transitStops.length} fermate` : 'Nessuna fermata nel progetto' },
    { id: 'bikeshare_300', macro: 'A', label: 'Popolazione entro 300 m da una stazione di bike sharing', value: pop > 0 ? pct(bikeCov, pop) : null, unit: '%', note: input.bikeStations?.length ? `${input.bikeStations.length} stazioni` : 'Nessuna stazione' },
    { id: 'avg_speed', macro: 'A', label: 'Velocità media di rete (ora di punta)', value: tr ? tr.totals.avgSpeedKmh : null, unit: 'km/h', note: tr ? 'Stima DRIP (assegnazione BPR)' : 'Esegui la stima del traffico' },
    { id: 'congestion', macro: 'A', label: 'Percorrenze in congestione (v/c > 0,9)', value: congested, unit: '% veic·km' },
    { id: 'veh_hours', macro: 'B', label: 'Tempo speso in auto nell\'ora di punta', value: tr ? tr.totals.vehHours : null, unit: 'veic·h' },
    { id: 'safety_hotspots', macro: 'C', label: 'Intersezioni critiche (screening ≥ 60/100)', value: input.safety ? input.safety.filter((s) => s.score >= 60).length : null, unit: 'n.', note: 'Screening surrogato DRIP, non analisi ufficiale dei punti neri' },
    { id: 'parking_onstreet', macro: 'A', label: 'Sosta su strada (stalli stimati)', value: Math.round(onStreetParkM / 5), unit: 'stalli', note: '5 m per stallo in linea' },
    { id: 'parking_offstreet', macro: 'A', label: 'Parcheggi in struttura / a raso (superficie)', value: Math.round(offStreetM2), unit: 'm²', note: `≈ ${Math.round(offStreetM2 / 25)} posti a 25 m²/posto` },
    { id: 'principal_km', macro: 'A', label: 'Rete principale (scorrimento, interquartiere, quartiere)', value: r2(principalM / 1000), unit: 'km' },
    { id: 'local_km', macro: 'A', label: 'Rete locale', value: r2(localM / 1000), unit: 'km' },
  ].map((x) => (x.value !== null && typeof x.value === 'number' && x.unit === 'km/h' ? { ...x, value: r1(x.value) } : x)) as PumsIndicator[];
}
