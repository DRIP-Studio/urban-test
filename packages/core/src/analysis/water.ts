import { LocalFrame } from '../geo/projection';
import type { LngLat, Network, WaterNode, WaterPipe } from '../model/types';

/**
 * Rete acquedotto in pressione (Civil 3D «Pressure Networks»): steady state with the Global Gradient
 * Algorithm (Todini–Pilati, as in EPANET) and Hazen–Williams losses. Fixed heads: reservoirs and tanks.
 * Checks after the Italian practice: residual pressure 15–70 m at user nodes, 0,3–2 m/s in the pipes,
 * hydrant fire flow with ≥ 20 m residual (UNI 10779 / UNI EN 14384).
 */
export const HW_N = 1.852;
export const WATER_DN: readonly number[] = [63, 75, 90, 110, 125, 160, 200, 250, 315, 400, 500];
export const WATER_MATERIALS: readonly { id: string; label: string; c: number }[] = [
  { id: 'pead', label: 'PEAD PE100', c: 150 }, { id: 'ghisa', label: 'Ghisa sferoidale', c: 130 }, { id: 'pvc', label: 'PVC-A', c: 145 }, { id: 'acciaio', label: 'Acciaio', c: 120 },
];
export const P_MIN_M = 15, P_MAX_M = 70, V_MIN = 0.3, V_MAX = 2, FIRE_MIN_M = 20;

export interface WaterNodeResult { readonly headM: number; readonly pressureM: number; readonly pressureBar: number; readonly demandLs: number; readonly supplied: boolean }
export interface WaterPipeResult { readonly flowLs: number; readonly velocity: number; readonly headlossMKm: number; readonly lengthM: number; readonly closed: boolean }
export interface WaterIssue { readonly severity: 'error' | 'warning'; readonly message: string; readonly nodeId?: string; readonly pipeId?: string }
export interface WaterResult {
  readonly nodes: Readonly<Record<string, WaterNodeResult>>;
  readonly pipes: Readonly<Record<string, WaterPipeResult>>;
  readonly iterations: number;
  readonly converged: boolean;
  readonly issues: readonly WaterIssue[];
  readonly method: string;
}

const fixedHead = (n: WaterNode) => n.kind === 'reservoir' || n.kind === 'tank';

export function waterPipeLength(net: Network, p: WaterPipe): number {
  if (p.lengthM && p.lengthM > 0) return p.lengthM;
  const a = net.waterNodes?.[p.from], b = net.waterNodes?.[p.to];
  if (!a || !b) return 0;
  const f = new LocalFrame(a.at);
  const q = f.toMetric(b.at);
  return Math.hypot(q[0], q[1]);
}

/** Hazen–Williams resistance r (SI): h = r Q^1,852, Q in m³/s. */
export function hwResistance(lengthM: number, diameterMm: number, c: number): number {
  return (10.67 * lengthM) / (c ** HW_N * (diameterMm / 1000) ** 4.87);
}

/** Conjugate gradient for the SPD system A x = b (A given by a row-sparse map). */
function cg(rows: Map<number, number>[], b: number[], x0: number[]): number[] {
  const n = b.length;
  const mul = (v: number[]) => rows.map((r) => { let s = 0; for (const [j, a] of r) s += a * v[j]!; return s; });
  const diag = rows.map((r, i) => r.get(i) || 1);
  const x = [...x0];
  const Ax = mul(x);
  const r = b.map((v, i) => v - Ax[i]!);
  let z = r.map((v, i) => v / diag[i]!);
  let p = [...z];
  let rz = r.reduce((s, v, i) => s + v * z[i]!, 0);
  const bn = Math.sqrt(b.reduce((s, v) => s + v * v, 0)) || 1;
  for (let it = 0; it < 4 * n + 50; it++) {
    const Ap = mul(p);
    const pAp = p.reduce((s, v, i) => s + v * Ap[i]!, 0);
    if (!(Math.abs(pAp) > 1e-300)) break;
    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) { x[i]! += alpha * p[i]!; r[i]! -= alpha * Ap[i]!; }
    if (Math.sqrt(r.reduce((s, v) => s + v * v, 0)) / bn < 1e-12) break;
    z = r.map((v, i) => v / diag[i]!);
    const rz2 = r.reduce((s, v, i) => s + v * z[i]!, 0);
    const beta = rz2 / rz;
    rz = rz2;
    p = z.map((v, i) => v + beta * p[i]!);
  }
  return x;
}

export interface WaterOptions { readonly extraDemandLs?: Readonly<Record<string, number>>; readonly demandFactor?: number; readonly maxIter?: number }

export function analyzeWater(net: Network, opts: WaterOptions = {}): WaterResult {
  const nodes = net.waterNodes ?? {}, allPipes = Object.values(net.waterPipes ?? {});
  const pipes = allPipes.filter((p) => p.status !== 'closed' && nodes[p.from] && nodes[p.to]);
  const issues: WaterIssue[] = [];
  const k = opts.demandFactor ?? 1;
  const demand = (n: WaterNode) => ((n.kind === 'junction' || n.kind === 'hydrant' || n.kind === 'valve' ? n.demandLs ?? 0 : 0) * k + (opts.extraDemandLs?.[n.id] ?? 0)) / 1000;
  // Nodes connected to at least one source.
  const adj = new Map<string, string[]>();
  for (const p of pipes) { (adj.get(p.from) ?? adj.set(p.from, []).get(p.from)!).push(p.to); (adj.get(p.to) ?? adj.set(p.to, []).get(p.to)!).push(p.from); }
  const supplied = new Set<string>();
  const queue = Object.values(nodes).filter(fixedHead).map((n) => n.id);
  for (const s of queue) supplied.add(s);
  while (queue.length) { const c = queue.pop()!; for (const o of adj.get(c) ?? []) if (!supplied.has(o)) { supplied.add(o); queue.push(o); } }
  if (!Object.values(nodes).some(fixedHead)) issues.push({ severity: 'error', message: 'Nessun serbatoio o fonte a carico fisso: la rete non è alimentata' });
  for (const n of Object.values(nodes)) if (!supplied.has(n.id) && !fixedHead(n)) issues.push({ severity: 'error', message: `Nodo ${n.name ?? n.id} non collegato a una fonte`, nodeId: n.id });
  const live = pipes.filter((p) => supplied.has(p.from) && supplied.has(p.to));
  const unknown = Object.values(nodes).filter((n) => supplied.has(n.id) && !fixedHead(n));
  const idx = new Map(unknown.map((n, i) => [n.id, i]));
  const H0 = (id: string) => nodes[id]!.headM ?? nodes[id]!.elevation;
  const L = new Map(live.map((p) => [p.id, waterPipeLength(net, p)]));
  const R = new Map(live.map((p) => [p.id, hwResistance(Math.max(0.1, L.get(p.id)!), p.diameterMm, p.c)]));
  // Initial flows: 1 m/s.
  const Q = new Map(live.map((p) => [p.id, Math.PI * (p.diameterMm / 2000) ** 2]));
  let H = unknown.map((n) => Math.max(...Object.values(nodes).filter(fixedHead).map((s) => H0(s.id)), n.elevation));
  let it = 0, converged = false;
  for (; it < (opts.maxIter ?? 60); it++) {
    const rows = unknown.map(() => new Map<number, number>());
    const rhs = unknown.map((n) => -demand(n));
    const pk = new Map<string, number>(), ck = new Map<string, number>();
    for (const p of live) {
      const q = Q.get(p.id)!, r = R.get(p.id)!;
      const aq = Math.max(Math.abs(q), 1e-7);
      const pp = 1 / (HW_N * r * aq ** (HW_N - 1));
      const c = q * (1 - 1 / HW_N);
      pk.set(p.id, pp); ck.set(p.id, c);
      const ia = idx.get(p.from), ib = idx.get(p.to);
      // Outflow from `from`, inflow to `to`.
      if (ia !== undefined) { rows[ia]!.set(ia, (rows[ia]!.get(ia) ?? 0) + pp); rhs[ia]! -= c; if (ib !== undefined) rows[ia]!.set(ib, (rows[ia]!.get(ib) ?? 0) - pp); else rhs[ia]! += pp * H0(p.to); }
      if (ib !== undefined) { rows[ib]!.set(ib, (rows[ib]!.get(ib) ?? 0) + pp); rhs[ib]! += c; if (ia !== undefined) rows[ib]!.set(ia, (rows[ib]!.get(ia) ?? 0) - pp); else rhs[ib]! += pp * H0(p.from); }
    }
    H = unknown.length ? cg(rows, rhs, H) : [];
    const head = (id: string) => (idx.has(id) ? H[idx.get(id)!]! : H0(id));
    let dq = 0, qs = 0;
    for (const p of live) {
      const qn = ck.get(p.id)! + pk.get(p.id)! * (head(p.from) - head(p.to));
      dq += Math.abs(qn - Q.get(p.id)!); qs += Math.abs(qn);
      Q.set(p.id, qn);
    }
    if (dq / Math.max(qs, 1e-9) < 1e-7) { converged = true; it++; break; }
  }
  if (!converged && live.length) issues.push({ severity: 'warning', message: `Calcolo non convergente in ${it} iterazioni: verifica diametri e collegamenti` });
  const head = (id: string) => (idx.has(id) ? H[idx.get(id)!]! : H0(id));
  const nodeRes: Record<string, WaterNodeResult> = {};
  for (const n of Object.values(nodes)) {
    const sup = supplied.has(n.id) || fixedHead(n);
    const h = sup ? head(n.id) : NaN, pM = h - n.elevation;
    nodeRes[n.id] = { headM: h, pressureM: pM, pressureBar: pM / 10.2, demandLs: demand(n) * 1000, supplied: sup };
    if (!sup || fixedHead(n)) continue;
    if (demand(n) > 0 && pM < P_MIN_M) issues.push({ severity: 'error', message: `${n.name ?? n.id}: pressione ${pM.toFixed(1).replace('.', ',')} m sotto i ${P_MIN_M} m`, nodeId: n.id });
    if (pM > P_MAX_M) issues.push({ severity: 'warning', message: `${n.name ?? n.id}: pressione ${pM.toFixed(1).replace('.', ',')} m oltre i ${P_MAX_M} m (riduttore di pressione)`, nodeId: n.id });
  }
  const pipeRes: Record<string, WaterPipeResult> = {};
  for (const p of allPipes) {
    const q = Q.get(p.id) ?? 0, A = Math.PI * (p.diameterMm / 2000) ** 2, len = waterPipeLength(net, p);
    const v = Math.abs(q) / A;
    const hl = live.includes(p) ? (R.get(p.id)! * Math.abs(q) ** HW_N) / Math.max(0.1, len) * 1000 : 0;
    pipeRes[p.id] = { flowLs: q * 1000, velocity: v, headlossMKm: hl, lengthM: len, closed: p.status === 'closed' };
    if (p.status === 'closed' || !live.includes(p)) continue;
    if (v > V_MAX) issues.push({ severity: 'warning', message: `Condotta DN ${p.diameterMm}: velocità ${v.toFixed(2).replace('.', ',')} m/s oltre ${V_MAX} m/s`, pipeId: p.id });
    else if (v < V_MIN && Math.abs(q) > 1e-6) issues.push({ severity: 'warning', message: `Condotta DN ${p.diameterMm}: velocità ${v.toFixed(2).replace('.', ',')} m/s (ristagno, qualità dell'acqua)`, pipeId: p.id });
  }
  return { nodes: nodeRes, pipes: pipeRes, iterations: it, converged, issues, method: `Gradiente globale (Todini–Pilati), Hazen–Williams; ${unknown.length} nodi, ${live.length} condotte, ${it} iterazioni.` };
}

/** Fire flow at a hydrant: residual pressure with an extra withdrawal (default 10 l/s, UNI 10779). */
export function fireFlowCheck(net: Network, hydrantId: string, flowLs = 10): { residualM: number; minPressureM: number; ok: boolean; result: WaterResult } {
  const result = analyzeWater(net, { extraDemandLs: { [hydrantId]: flowLs } });
  const r = result.nodes[hydrantId];
  const others = Object.entries(result.nodes).filter(([id, x]) => id !== hydrantId && x.supplied && x.demandLs > 0).map(([, x]) => x.pressureM);
  const residual = r?.pressureM ?? NaN;
  return { residualM: residual, minPressureM: others.length ? Math.min(...others) : residual, ok: residual >= FIRE_MIN_M, result };
}

/** Smallest commercial DN with v ≤ 1,5 m/s at the computed flow (3 passes, flows redistribute). */
export function sizeWaterPipes(net: Network, vMax = 1.5): Record<string, number> {
  let cur = net;
  const out: Record<string, number> = {};
  for (let pass = 0; pass < 3; pass++) {
    const r = analyzeWater(cur);
    const pipes = { ...(cur.waterPipes ?? {}) };
    for (const p of Object.values(pipes)) {
      if (p.status === 'closed') continue;
      const q = Math.abs(r.pipes[p.id]?.flowLs ?? 0) / 1000;
      const dn = WATER_DN.find((d) => q / (Math.PI * (d / 2000) ** 2) <= vMax) ?? WATER_DN[WATER_DN.length - 1]!;
      if (dn !== p.diameterMm) { pipes[p.id] = { ...p, diameterMm: dn }; out[p.id] = dn; }
    }
    cur = { ...cur, waterPipes: pipes };
  }
  for (const [id, dn] of Object.entries(out)) if (net.waterPipes?.[id]?.diameterMm === dn) delete out[id];
  return out;
}

export const waterAt = (n: WaterNode): LngLat => n.at;
