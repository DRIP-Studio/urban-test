import type { DrainageNode, DrainagePipe, LngLat, Network, TerrainGrid } from '../model/types';
import { LocalFrame } from '../geo/projection';
import { dist, type V } from '../geo/polyline';
import { sampleTerrain } from './vertical';

/**
 * Storm sewer design (rete di drenaggio urbano), preliminary level:
 *  - catchments: paved surfaces of the physical model assigned to the nearest inlet (raster Voronoi);
 *  - runoff: rational method Q = φ·i·A with a two-parameter IDF curve h = a·t^n;
 *  - time of concentration: inlet time + travel time in the pipes (velocity at partial flow);
 *  - hydraulics: circular pipes, Gauckler–Strickler, partial-flow filling ratio solved numerically;
 *  - checks: filling ≤ 70 %, velocity 0,5–5 m/s, slope ≥ 0,2 %, no adverse slopes, no cycles;
 *  - auto-sizing to commercial diameters.
 * Not modelled: surcharge/backwater, hydrograph routing, storage, inlet capture efficiency, losses at manholes.
 */

/** IDF curve h = a·t^n (h mm, t hours). */
export interface IdfParams {
  readonly a: number;
  readonly n: number;
}

/** Example parameters (order of magnitude for Campania, T ≈ 10 years). Replace with the regional VAPI/IDF of the site. */
export const DEFAULT_IDF: IdfParams = { a: 50, n: 0.35 };
export const DEFAULT_IDF_NOTE = 'Parametri IDF di esempio (a = 50 mm·h⁻ⁿ, n = 0,35): sostituirli con la curva di possibilità pluviometrica del sito (VAPI / Autorità di bacino)';

/** Commercial internal diameters used for sizing, mm. */
export const COMMERCIAL_DN: readonly number[] = [250, 315, 400, 500, 630, 800, 1000, 1200];

export const PIPE_MATERIALS: readonly { id: string; label: string; ks: number }[] = [
  { id: 'pvc', label: 'PVC-U SN8', ks: 90 },
  { id: 'pead', label: 'PEAD corrugato', ks: 85 },
  { id: 'gres', label: 'Gres ceramico', ks: 80 },
  { id: 'cls', label: 'Calcestruzzo', ks: 70 },
  { id: 'ghisa', label: 'Ghisa sferoidale', ks: 80 },
];

export const MAX_FILL = 0.7;
export const MIN_VELOCITY = 0.5;
export const MAX_VELOCITY = 5;
export const MIN_SLOPE = 0.002;
const INLET_TIME_MIN = 5;

/** Runoff coefficient φ of a surface (by material first, then by kind). */
export function runoffCoefficient(kind: string, material?: string): number {
  const m = material ?? '';
  if (/porous|permeable/.test(m)) return 0.5;
  if (/asphalt|cycle_pavement|concrete(?!_pavers)|rubber/.test(m)) return 0.9;
  if (/grass|meadow|soil/.test(m)) return 0.2;
  if (/gravel/.test(m)) return 0.4;
  if (/pavers|brick|porphyry|sampietrini|cobbles|basalt|granite|stone|travertine|slab/.test(m)) return 0.7;
  if (/green|island|tree_pit|rain_garden|bioswale/.test(kind)) return 0.2;
  if (/carriageway|junction|roundabout_ring|bus|parking|shoulder|cycle/.test(kind)) return 0.9;
  return 0.7;
}

/** Rainfall intensity (mm/h) for a duration in minutes. */
export function intensity(idf: IdfParams, minutes: number): number {
  const t = Math.max(1, minutes) / 60;
  return idf.a * t ** (idf.n - 1);
}

// ---------------------------------------------------------------- hydraulics

export function fullFlow(diameterM: number, slope: number, ks: number): { q: number; v: number; area: number } {
  const area = (Math.PI * diameterM * diameterM) / 4;
  const v = ks * (diameterM / 4) ** (2 / 3) * Math.sqrt(Math.max(0, slope));
  return { q: v * area, v, area };
}

/** Flow area and hydraulic radius for a filling ratio y = h/D. */
export function partialSection(diameterM: number, y: number): { area: number; rh: number } {
  const yy = Math.min(1, Math.max(0, y));
  const theta = 2 * Math.acos(1 - 2 * yy);
  const area = (diameterM * diameterM / 8) * (theta - Math.sin(theta));
  const wet = (diameterM * theta) / 2;
  return { area, rh: wet > 0 ? area / wet : 0 };
}

export function partialFlow(diameterM: number, slope: number, ks: number, y: number): number {
  const s = partialSection(diameterM, y);
  return ks * s.area * s.rh ** (2 / 3) * Math.sqrt(Math.max(0, slope));
}

/** Filling ratio at which the circular section carries its maximum discharge. */
export const Y_QMAX = 0.938;

/**
 * Filling ratio h/D for a discharge (bisection on the monotonic branch 0…0.938).
 * Returns y > 1 (ratio Q/Qmax) when the pipe cannot carry Q in free surface flow.
 */
export function fillRatio(q: number, diameterM: number, slope: number, ks: number): number {
  if (q <= 0) return 0;
  const qmax = partialFlow(diameterM, slope, ks, Y_QMAX);
  if (!(qmax > 0)) return Number.POSITIVE_INFINITY;
  if (q > qmax) return 1 + (q - qmax) / qmax;
  let lo = 0, hi = Y_QMAX;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (partialFlow(diameterM, slope, ks, mid) < q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Mean velocity at partial flow (m/s). */
export function velocityAt(q: number, diameterM: number, slope: number, ks: number): number {
  const y = fillRatio(q, diameterM, slope, ks);
  if (y <= 0) return 0;
  if (y >= 1) return q / fullFlow(diameterM, slope, ks).area;
  return q / partialSection(diameterM, y).area;
}

/** Smallest commercial DN with h/D ≤ maxFill (null when even the largest is not enough). */
export function sizePipe(q: number, slope: number, ks: number, maxFill = MAX_FILL, list: readonly number[] = COMMERCIAL_DN): number | null {
  for (const dn of list) if (fillRatio(q, dn / 1000, slope, ks) <= maxFill) return dn;
  return null;
}

// ---------------------------------------------------------------- topology

export const drainageNodesOf = (net: Network): Readonly<Record<string, DrainageNode>> => net.drainageNodes ?? {};
export const drainagePipesOf = (net: Network): Readonly<Record<string, DrainagePipe>> => net.drainagePipes ?? {};

/** Planimetric pipe length (m). */
export function pipeLength(a: DrainageNode, b: DrainageNode): number {
  const f = new LocalFrame(a.at);
  return dist(f.toMetric(a.at) as V, f.toMetric(b.at) as V);
}

export function pipeSlope(a: DrainageNode, b: DrainageNode): number {
  return (a.invertElevation - b.invertElevation) / Math.max(1e-6, pipeLength(a, b));
}

/** Topological order of the nodes (Kahn) and the nodes left in cycles. */
export function drainageOrder(nodes: Readonly<Record<string, DrainageNode>>, pipes: readonly DrainagePipe[]): { order: string[]; cycles: string[] } {
  const indeg = new Map<string, number>(Object.keys(nodes).map((id) => [id, 0]));
  const out = new Map<string, DrainagePipe[]>();
  for (const p of pipes) {
    if (!indeg.has(p.from) || !indeg.has(p.to)) continue;
    indeg.set(p.to, indeg.get(p.to)! + 1);
    (out.get(p.from) ?? out.set(p.from, []).get(p.from)!).push(p);
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const p of out.get(id) ?? []) {
      const d = indeg.get(p.to)! - 1;
      indeg.set(p.to, d);
      if (d === 0) queue.push(p.to);
    }
  }
  const seen = new Set(order);
  return { order, cycles: Object.keys(nodes).filter((id) => !seen.has(id)) };
}

// ---------------------------------------------------------------- catchments

export interface CatchmentSurface {
  readonly id: string;
  readonly kind: string;
  readonly material?: string;
  readonly ring: readonly LngLat[];
  readonly holes?: readonly (readonly LngLat[])[];
}

export interface Catchment {
  /** Total area drained to the inlet, m². */
  readonly areaM2: number;
  /** Σ φ·A, m². */
  readonly effectiveM2: number;
  readonly surfaces: number;
}

function inside(p: V, ring: readonly V[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function shoelace(r: readonly V[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
  return Math.abs(s) / 2;
}

/**
 * Drained area per inlet: every surface is sampled on a grid (≤ ~200 points per surface) and each sample
 * goes to the nearest inlet within `maxDistanceM` (surfaces farther from every inlet are not drained by
 * the network). Equivalent to clipping the surfaces with the Voronoi cells of the inlets.
 */
export function assignCatchments(net: Network, surfaces: readonly CatchmentSurface[], origin: LngLat, maxDistanceM = 40): Record<string, Catchment> {
  const f = new LocalFrame(origin);
  const inlets = Object.values(drainageNodesOf(net)).filter((n) => n.kind === 'inlet').map((n) => ({ id: n.id, p: f.toMetric(n.at) as V }));
  const acc: Record<string, { areaM2: number; effectiveM2: number; surfaces: Set<string> }> = {};
  for (const i of inlets) acc[i.id] = { areaM2: 0, effectiveM2: 0, surfaces: new Set() };
  if (!inlets.length) return {};
  const ix = inlets.map((i) => i.p[0]), iy = inlets.map((i) => i.p[1]);
  const box = [Math.min(...ix) - maxDistanceM, Math.min(...iy) - maxDistanceM, Math.max(...ix) + maxDistanceM, Math.max(...iy) + maxDistanceM];
  for (const s of surfaces) {
    if (s.ring.length < 3) continue;
    const ring = s.ring.map((q) => f.toMetric(q) as V);
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 < box[0]! || x0 > box[2]! || y1 < box[1]! || y0 > box[3]!) continue;
    const holes = (s.holes ?? []).map((h) => h.map((q) => f.toMetric(q) as V));
    const area = Math.max(0, shoelace(ring) - holes.reduce((t, h) => t + shoelace(h), 0));
    if (area <= 0) continue;
    const step = Math.max(0.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 200));
    const hits = new Map<string, number>();
    let total = 0;
    for (let x = x0 + step / 2; x < x1; x += step) {
      for (let y = y0 + step / 2; y < y1; y += step) {
        const p: V = [x, y];
        if (!inside(p, ring) || holes.some((h) => inside(p, h))) continue;
        total++;
        let best: string | null = null, bd = maxDistanceM;
        for (const i of inlets) { const d = dist(p, i.p); if (d <= bd) { bd = d; best = i.id; } }
        if (best) hits.set(best, (hits.get(best) ?? 0) + 1);
      }
    }
    if (!total) {
      // Sliver smaller than the grid: the centroid decides.
      const c: V = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
      let best: string | null = null, bd = maxDistanceM;
      for (const i of inlets) { const d = dist(c, i.p); if (d <= bd) { bd = d; best = i.id; } }
      if (best) { hits.set(best, 1); total = 1; }
    }
    const phi = runoffCoefficient(s.kind, s.material);
    for (const [id, n] of hits) {
      const a = (area * n) / total;
      acc[id]!.areaM2 += a;
      acc[id]!.effectiveM2 += a * phi;
      acc[id]!.surfaces.add(s.id);
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([id, c]) => [id, { areaM2: c.areaM2, effectiveM2: c.effectiveM2, surfaces: c.surfaces.size }]));
}

// ---------------------------------------------------------------- network analysis

export interface DrainageIssue { readonly severity: 'error' | 'warning'; readonly message: string; readonly pipeId?: string; readonly nodeId?: string }

export interface NodeResult {
  readonly catchmentM2: number;
  readonly effectiveM2: number;
  /** Σ φ·A of everything upstream including the node itself, m². */
  readonly accumulatedEffM2: number;
  /** Time of concentration at the node, minutes. */
  readonly tcMin: number;
}

export interface PipeResult {
  readonly lengthM: number;
  readonly slope: number;
  readonly diameterMm: number;
  /** Design discharge, m³/s. */
  readonly q: number;
  readonly qFull: number;
  readonly velocity: number;
  /** h/D (> 1 = not in free surface flow). */
  readonly fill: number;
  readonly tcMin: number;
  readonly intensityMmH: number;
  readonly travelMin: number;
  readonly ok: boolean;
  readonly issues: readonly DrainageIssue[];
}

export interface DrainageResult {
  readonly nodes: Readonly<Record<string, NodeResult>>;
  readonly pipes: Readonly<Record<string, PipeResult>>;
  readonly order: readonly string[];
  readonly cycles: readonly string[];
  readonly issues: readonly DrainageIssue[];
  readonly idf: IdfParams;
  readonly method: string;
}

export interface DrainageOptions {
  readonly idf?: IdfParams;
  /** Σ φ·A and area per inlet (assignCatchments), m². */
  readonly catchments?: Readonly<Record<string, Catchment>>;
  readonly inletTimeMin?: number;
  /** Pick the diameter of every pipe while travelling downstream (smallest DN with h/D ≤ 0,7, never smaller than upstream). */
  readonly autoSize?: boolean;
}

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

/** Rational method on the whole network, in topological order. */
export function analyzeDrainage(net: Network, opts: DrainageOptions = {}): DrainageResult {
  const idf = opts.idf ?? DEFAULT_IDF;
  const t0 = opts.inletTimeMin ?? INLET_TIME_MIN;
  const nodes = drainageNodesOf(net);
  const pipes = Object.values(drainagePipesOf(net)).filter((p) => nodes[p.from] && nodes[p.to]);
  const { order, cycles } = drainageOrder(nodes, pipes);
  const issues: DrainageIssue[] = [];
  if (cycles.length) issues.push({ severity: 'error', message: `Rete con anelli chiusi: ${cycles.length} pozzetti esclusi dal calcolo`, nodeId: cycles[0] });
  const outOf = new Map<string, DrainagePipe[]>(), inOf = new Map<string, DrainagePipe[]>();
  for (const p of pipes) { (outOf.get(p.from) ?? outOf.set(p.from, []).get(p.from)!).push(p); (inOf.get(p.to) ?? inOf.set(p.to, []).get(p.to)!).push(p); }

  const nodeRes: Record<string, NodeResult> = {};
  const pipeRes: Record<string, PipeResult> = {};
  const arrival = new Map<string, number>();
  const inflowEff = new Map<string, number>();
  const maxUpDn = new Map<string, number>();
  for (const id of order) {
    const n = nodes[id]!;
    const c = n.kind === 'inlet' ? opts.catchments?.[id] : undefined;
    const own = c?.effectiveM2 ?? 0;
    const acc = own + (inflowEff.get(id) ?? 0);
    const tc = Math.max(own > 0 ? t0 : 0, arrival.get(id) ?? 0) || t0;
    nodeRes[id] = { catchmentM2: c?.areaM2 ?? 0, effectiveM2: own, accumulatedEffM2: acc, tcMin: tc };
    const outs = outOf.get(id) ?? [];
    if (!outs.length && n.kind !== 'outfall' && (inOf.get(id)?.length ?? 0) > 0) issues.push({ severity: 'warning', nodeId: id, message: `${n.name ?? id}: nodo terminale non collegato a uno scarico` });
    if (outs.length > 1) issues.push({ severity: 'warning', nodeId: id, message: `${n.name ?? id}: ${outs.length} condotte in uscita, portata ripartita in parti uguali` });
    for (const p of outs) {
      const b = nodes[p.to]!;
      const L = pipeLength(n, b), i = pipeSlope(n, b);
      const iMmH = intensity(idf, tc);
      const q = (acc * iMmH) / 1000 / 3600 / outs.length;
      const iCalc = Math.max(i, 1e-5);
      let dn = p.diameterMm;
      const pi: DrainageIssue[] = [];
      if (opts.autoSize) {
        const sized = sizePipe(q, iCalc, p.ks);
        dn = Math.max(sized ?? COMMERCIAL_DN[COMMERCIAL_DN.length - 1]!, maxUpDn.get(id) ?? 0);
        if (sized === null) pi.push({ severity: 'error', pipeId: p.id, message: `${p.name ?? p.id}: nessun diametro commerciale fino a DN ${COMMERCIAL_DN[COMMERCIAL_DN.length - 1]} basta con la pendenza attuale` });
      }
      const D = dn / 1000;
      const full = fullFlow(D, iCalc, p.ks);
      const y = fillRatio(q, D, iCalc, p.ks);
      const v = velocityAt(q, D, iCalc, p.ks);
      const travel = v > 0.05 ? L / v / 60 : L / Math.max(0.3, full.v) / 60;
      const label = p.name ?? p.id;
      if (i < 0) pi.push({ severity: 'error', pipeId: p.id, message: `${label}: contropendenza (${fmt(i * 100, 2)}%)` });
      else if (i < MIN_SLOPE) pi.push({ severity: 'warning', pipeId: p.id, message: `${label}: pendenza ${fmt(i * 100, 2)}% sotto lo 0,2%` });
      if (y > 1) pi.push({ severity: 'error', pipeId: p.id, message: `${label}: DN ${dn} insufficiente, la condotta va in pressione (Q ${fmt(q * 1000)} l/s)` });
      else if (y > MAX_FILL) pi.push({ severity: 'warning', pipeId: p.id, message: `${label}: grado di riempimento ${Math.round(y * 100)}% oltre il 70%` });
      if (q > 0 && v < MIN_VELOCITY) pi.push({ severity: 'warning', pipeId: p.id, message: `${label}: velocità ${fmt(v, 2)} m/s sotto 0,5 m/s (rischio di sedimentazione)` });
      if (v > MAX_VELOCITY) pi.push({ severity: 'warning', pipeId: p.id, message: `${label}: velocità ${fmt(v, 2)} m/s oltre 5 m/s (abrasione)` });
      if (b.rimElevation !== undefined && n.rimElevation !== undefined) {
        const cover = Math.min(n.rimElevation - n.invertElevation, b.rimElevation - b.invertElevation) - D;
        if (cover < 0.8) pi.push({ severity: 'warning', pipeId: p.id, message: `${label}: ricoprimento ${fmt(cover, 2)} m sotto 0,8 m` });
      }
      issues.push(...pi);
      pipeRes[p.id] = {
        lengthM: L, slope: i, diameterMm: dn, q, qFull: full.q, velocity: v, fill: y, tcMin: tc, intensityMmH: iMmH, travelMin: travel,
        ok: !pi.some((x) => x.severity === 'error') && y <= MAX_FILL, issues: pi,
      };
      arrival.set(p.to, Math.max(arrival.get(p.to) ?? 0, tc + travel));
      inflowEff.set(p.to, (inflowEff.get(p.to) ?? 0) + acc / outs.length);
      maxUpDn.set(p.to, Math.max(maxUpDn.get(p.to) ?? 0, dn));
    }
  }
  if (Object.keys(nodes).length && !Object.values(nodes).some((n) => n.kind === 'outfall')) issues.push({ severity: 'warning', message: 'La rete non ha uno scarico (recapito finale)' });
  return {
    nodes: nodeRes, pipes: pipeRes, order, cycles, issues, idf,
    method: `Metodo razionale (Q = φ·i·A), IDF h = ${fmt(idf.a, 1)}·t^${fmt(idf.n, 2)}, tempo di ingresso ${t0} min + percorrenza in condotta; Gauckler–Strickler a moto uniforme`,
  };
}

/** Diameters proposed by the auto-sizing (only pipes that change). */
export function sizeDrainage(net: Network, opts: Omit<DrainageOptions, 'autoSize'> = {}): Record<string, number> {
  const r = analyzeDrainage(net, { ...opts, autoSize: true });
  const pipes = drainagePipesOf(net);
  return Object.fromEntries(Object.entries(r.pipes).filter(([id, p]) => pipes[id] && pipes[id]!.diameterMm !== p.diameterMm).map(([id, p]) => [id, p.diameterMm]));
}

// ---------------------------------------------------------------- profile

export interface DrainageProfileNode { readonly nodeId: string; readonly station: number; readonly rim: number | null; readonly invert: number; readonly kind: DrainageNode['kind'] }
export interface DrainageProfileReach { readonly pipeId: string; readonly from: number; readonly to: number; readonly invertFrom: number; readonly invertTo: number; readonly diameterM: number }

/** Longitudinal profile following the first outgoing pipe from `startNodeId` down to the outfall. */
export function drainageProfile(net: Network, startNodeId: string, terrain?: TerrainGrid | null): { nodes: DrainageProfileNode[]; reaches: DrainageProfileReach[]; ground: { station: number; z: number }[] } {
  const nodes = drainageNodesOf(net);
  const pipes = Object.values(drainagePipesOf(net));
  const outNodes: DrainageProfileNode[] = [], reaches: DrainageProfileReach[] = [], ground: { station: number; z: number }[] = [];
  const seen = new Set<string>();
  let cur = nodes[startNodeId], s = 0;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    outNodes.push({ nodeId: cur.id, station: s, rim: cur.rimElevation ?? null, invert: cur.invertElevation, kind: cur.kind });
    const p = pipes.find((x) => x.from === cur!.id && nodes[x.to]);
    if (!p) break;
    const nxt = nodes[p.to]!;
    const L = pipeLength(cur, nxt);
    if (terrain) {
      const k = Math.max(1, Math.ceil(L / 5));
      for (let j = 0; j <= k; j++) {
        const t = j / k;
        const z = sampleTerrain(terrain, cur.at[0] + (nxt.at[0] - cur.at[0]) * t, cur.at[1] + (nxt.at[1] - cur.at[1]) * t);
        if (Number.isFinite(z)) ground.push({ station: s + L * t, z });
      }
    }
    reaches.push({ pipeId: p.id, from: s, to: s + L, invertFrom: cur.invertElevation, invertTo: nxt.invertElevation, diameterM: p.diameterMm / 1000 });
    s += L;
    cur = nxt;
  }
  return { nodes: outNodes, reaches, ground };
}
