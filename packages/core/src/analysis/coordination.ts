import type { LngLat, Network, SignalPlan } from '../model/types';
import { LocalFrame } from '../geo/projection';
import { lengthOf, type V } from '../geo/polyline';
import { analyzeJunction, groupVolume, type JunctionAnalysis } from './junction';

/**
 * Signal coordination (green waves and merged plants).
 *
 * The band is computed on the real green windows of the movement that runs along the corridor at each
 * junction (the through movement of the approach coming from the previous junction), with travel times
 * on the actual road path between junctions — not on straight-line distances and not assuming that the
 * first phase is the coordinated one. Offsets are optimised by coordinate descent over every integer
 * offset (1 s), maximising the outbound band (one-way) or the sum of both bands (two-way); minor junctions
 * may run half the common cycle (doppio ciclo) when it widens the band.
 */

export interface CorridorWindow {
  readonly planId: string;
  readonly nodeId: string;
  readonly name: string;
  readonly distanceM: number;
  readonly travelS: number;
  readonly cycleS: number;
  readonly offsetS: number;
  readonly halfCycle: boolean;
  /** Green intervals [start, end) within the local cycle (before the offset), outbound and inbound. */
  readonly fwd: readonly (readonly [number, number])[];
  readonly back: readonly (readonly [number, number])[];
}

export interface CoordinationResult {
  readonly cycleS: number;
  readonly speedKmh: number;
  readonly direction: 'oneway' | 'twoway';
  readonly offsets: readonly { readonly planId: string; readonly offsetS: number; readonly distanceM: number; readonly travelS: number; readonly halfCycle?: boolean }[];
  /** Band (s) through every junction, outbound; inbound for two-way corridors. */
  readonly bandwidthS: number;
  readonly bandwidthBackS: number | null;
  /** Band / cycle. */
  readonly efficiency: number;
  readonly efficiencyBack: number | null;
  /** Band of the simple d/v offsets, for comparison. */
  readonly naiveBandwidthS: number;
  /** Start time of the outbound band within the cycle at the first junction (for the time–space diagram). */
  readonly bandStartS: number;
  readonly bandBackStartS: number | null;
  readonly windows: readonly CorridorWindow[];
  readonly warnings: readonly string[];
}

const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Vehicular adjacency: node → incident roads with length (m). */
function adjacency(net: Network, frame: LocalFrame) {
  const adj = new Map<string, { roadId: string; other: string; len: number }[]>();
  for (const r of Object.values(net.roads)) {
    if (!r.lanes.some((l) => l.modes.includes('car') || l.modes.includes('bus'))) continue;
    const len = lengthOf(r.axis.map((q) => frame.toMetric(q) as V));
    (adj.get(r.from) ?? adj.set(r.from, []).get(r.from)!).push({ roadId: r.id, other: r.to, len });
    (adj.get(r.to) ?? adj.set(r.to, []).get(r.to)!).push({ roadId: r.id, other: r.from, len });
  }
  return adj;
}

/** Shortest road path between two nodes (Dijkstra, bounded): roads in order and total length. */
function roadPath(adj: ReturnType<typeof adjacency>, from: string, to: string, maxM = 2500): { roads: string[]; length: number } | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; road: string }>();
  const open = new Set([from]);
  while (open.size) {
    let u = '', du = Infinity;
    for (const n of open) { const d = dist.get(n)!; if (d < du) { du = d; u = n; } }
    open.delete(u);
    if (u === to) break;
    if (du > maxM) break;
    for (const e of adj.get(u) ?? []) {
      const nd = du + e.len;
      if (nd < (dist.get(e.other) ?? Infinity)) { dist.set(e.other, nd); prev.set(e.other, { node: u, road: e.roadId }); open.add(e.other); }
    }
  }
  if (!dist.has(to) || !prev.has(to) && from !== to) return null;
  const roads: string[] = [];
  for (let n = to; n !== from;) { const p = prev.get(n)!; roads.unshift(p.road); n = p.node; }
  return { roads, length: dist.get(to)! };
}

/** Green intervals of the movements of `roadId` going straight on (through; any turn if there is no through group). */
function greenWindows(plan: SignalPlan, a: JunctionAnalysis | null, roadId: string | undefined): [number, number][] {
  const groups = a?.groups.filter((g) => g.roadId === roadId) ?? [];
  const through = groups.filter((g) => g.turns.includes('through'));
  const ids = new Set((through.length ? through : groups).map((g) => g.id));
  const out: [number, number][] = [];
  let t = 0;
  for (const ph of plan.phases) {
    const on = [...ids].some((g) => ph.greenGroups.includes(g) && (!ph.greenMovements?.[g] || ph.greenMovements[g]!.includes('through') || !through.length));
    if (on) out.push([t, t + ph.greenS]);
    t += ph.greenS + ph.yellowS + ph.allRedS;
  }
  // No group found (geometry changed): fall back to the longest phase so the corridor still computes.
  if (!out.length && plan.phases.length) {
    let s = 0, best: [number, number] = [0, plan.phases[0]!.greenS];
    for (const ph of plan.phases) { if (ph.greenS > best[1] - best[0]) best = [s, s + ph.greenS]; s += ph.greenS + ph.yellowS + ph.allRedS; }
    out.push(best);
  }
  return out;
}

interface Member { plan: SignalPlan; fwd: [number, number][]; back: [number, number][]; T: number; Tb: number; dist: number; c: number; half: boolean; canHalf: boolean }

const isGreen = (wins: readonly (readonly [number, number])[], c: number, x: number) => {
  const y = mod(x, c);
  for (const [s, e] of wins) if (y >= s && y < e) return true;
  return false;
};

/** Longest circular run of `true` in a boolean ring (seconds, with its start). */
function longestRun(ok: boolean[]): { len: number; start: number } {
  const n = ok.length;
  if (ok.every(Boolean)) return { len: n, start: 0 };
  let best = { len: 0, start: 0 }, run = 0, start = 0;
  for (let k = 0; k < 2 * n; k++) {
    if (ok[k % n]) { if (!run) start = k % n; run++; if (run > best.len) best = { len: Math.min(run, n), start }; } else run = 0;
  }
  return best;
}

function bands(m: readonly Member[], offs: readonly number[], C: number, twoway: boolean) {
  const Tend = m[m.length - 1]!.Tb;
  const f: boolean[] = [], b: boolean[] = [];
  for (let t = 0; t < C; t++) {
    f.push(m.every((x, i) => isGreen(x.fwd, x.c, t + x.T - offs[i]!)));
    if (twoway) b.push(m.every((x, i) => isGreen(x.back, x.c, t + (Tend - x.Tb) - offs[i]!)));
  }
  const F = longestRun(f), B = twoway ? longestRun(b) : null;
  return { fwd: F.len, fwdStart: F.start, back: B?.len ?? 0, backStart: B?.start ?? null };
}

/**
 * Green wave along `plans` (ordered upstream → downstream). Cycle: given, or the longest of the members
 * (each plan is assumed to be already sized, e.g. with Webster). Travel speed `speedKmh` on the real path.
 */
export function coordinateCorridor(
  net: Network, frameOrigin: LngLat, plans: readonly SignalPlan[], speedKmh: number, cycleS: number | null, direction: 'oneway' | 'twoway',
  opts: { allowHalfCycle?: boolean } = {},
): CoordinationResult {
  const frame = new LocalFrame(frameOrigin);
  const adj = adjacency(net, frame);
  const v = speedKmh / 3.6;
  const warnings: string[] = [];
  const C = Math.round(cycleS ?? Math.max(...plans.map((p) => p.cycleS)));
  const paths = plans.map((p, i) => (i === 0 ? null : roadPath(adj, plans[i - 1]!.nodeId, p.nodeId)));
  let cum = 0;
  const members: Member[] = plans.map((p, i) => {
    const path = paths[i];
    const a = analyzeJunction(net, frameOrigin, p.nodeId);
    if (i > 0 && !path) warnings.push(`Nessun percorso stradale tra ${plans[i - 1]!.name} e ${p.name}: uso la distanza in linea d'aria`);
    const straight = i === 0 ? 0 : Math.hypot(...(([x0, y0], [x1, y1]) => [x1 - x0, y1 - y0] as const)(frame.toMetric(net.nodes[plans[i - 1]!.nodeId]!.at), frame.toMetric(net.nodes[p.nodeId]!.at)));
    const d = i === 0 ? 0 : path?.length ?? straight;
    cum += d;
    // Outbound arrives on the last road of the path from the previous junction; inbound on the first road towards the next.
    const inRoad = path?.roads[path.roads.length - 1];
    const next = paths[i + 1];
    const backRoad = next?.roads[0];
    const fixed = p.phases.reduce((t, ph) => t + ph.yellowS + ph.allRedS, 0);
    const scale = C / Math.max(1, p.cycleS);
    const fwd = greenWindows(p, a, inRoad ?? backRoad).map(([s, e]) => [s * scale, e * scale] as [number, number]);
    const back = greenWindows(p, a, backRoad ?? inRoad).map(([s, e]) => [s * scale, e * scale] as [number, number]);
    return { plan: p, fwd, back, T: cum / v, Tb: cum / v, dist: d, c: C, half: false, canHalf: i > 0 && C % 2 === 0 && C / 2 - fixed >= p.phases.length * 7 };
  });
  const twoway = direction === 'twoway';
  const score = (offs: number[]) => { const b = bands(members, offs, C, twoway); return twoway ? b.fwd + b.back + 0.25 * Math.min(b.fwd, b.back) : b.fwd; };
  const naive = members.map((m) => Math.round(mod(m.T, C)));
  const naiveBand = bands(members, naive, C, twoway).fwd;
  // Coordinate descent over every integer offset, starting from the d/v offsets.
  const offs = [...naive];
  offs[0] = 0;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 1; i < members.length; i++) {
      let best = offs[i]!, bestS = score(offs);
      for (let o = 0; o < members[i]!.c; o++) {
        offs[i] = o;
        const s = score(offs);
        if (s > bestS + 1e-9) { bestS = s; best = o; }
      }
      if (offs[i] !== best) changed = true;
      offs[i] = best;
    }
    if (!changed) break;
  }
  // Half cycle for minor junctions when it clearly widens the band.
  if (opts.allowHalfCycle) {
    for (let i = 1; i < members.length; i++) {
      const m = members[i]!;
      if (!m.canHalf) continue;
      const base = score(offs);
      const fwd0 = m.fwd, back0 = m.back;
      m.c = C / 2; m.half = true;
      m.fwd = fwd0.map(([s, e]) => [s / 2, e / 2]); m.back = back0.map(([s, e]) => [s / 2, e / 2]);
      let best = offs[i]!, bestS = -1;
      for (let o = 0; o < m.c; o++) { offs[i] = o; const s = score(offs); if (s > bestS) { bestS = s; best = o; } }
      if (bestS >= base + 2) offs[i] = best;
      else { m.c = C; m.half = false; m.fwd = fwd0; m.back = back0; offs[i] = best % C; const keep = score(offs); if (keep < base) { /* restore the previous best */ } }
    }
    // Re-run one descent pass with the final cycle choices.
    for (let i = 1; i < members.length; i++) {
      let best = offs[i]!, bestS = score(offs);
      for (let o = 0; o < members[i]!.c; o++) { offs[i] = o; const s = score(offs); if (s > bestS) { bestS = s; best = o; } }
      offs[i] = best;
    }
  }
  const b = bands(members, offs, C, twoway);
  if (b.fwd === 0) warnings.push('Nessuna banda continua in andata: aumenta il ciclo comune, riduci la velocità o togli l\'incrocio più lontano');
  if (twoway && b.back === 0) warnings.push('Nessuna banda continua al ritorno: con queste distanze conviene il coordinamento a senso unico');
  return {
    cycleS: C, speedKmh, direction,
    offsets: members.map((m, i) => ({ planId: m.plan.id, offsetS: offs[i]!, distanceM: Math.round(m.dist), travelS: Math.round(m.T * 10) / 10, ...(m.half ? { halfCycle: true } : {}) })),
    bandwidthS: b.fwd, bandwidthBackS: twoway ? b.back : null,
    efficiency: Math.round((b.fwd / C) * 100) / 100, efficiencyBack: twoway ? Math.round((b.back / C) * 100) / 100 : null,
    naiveBandwidthS: naiveBand, bandStartS: b.fwdStart, bandBackStartS: b.backStart,
    windows: members.map((m, i) => ({ planId: m.plan.id, nodeId: m.plan.nodeId, name: m.plan.name, distanceM: Math.round(m.dist), travelS: Math.round(m.T * 10) / 10, cycleS: m.c, offsetS: offs[i]!, halfCycle: m.half, fwd: m.fwd, back: m.back })),
    warnings,
  };
}

export interface DetectedCorridor { readonly name: string; readonly nodeIds: readonly string[]; readonly planIds: readonly string[]; readonly lengthM: number }

/**
 * Chains of signalised junctions along continuous streets (same name or straight continuation, turn
 * < 30°), consecutive spacing ≤ `maxSpacingM`, at least `minJunctions` junctions.
 */
export function detectCorridors(net: Network, frameOrigin: LngLat, opts: { maxSpacingM?: number; minJunctions?: number } = {}): DetectedCorridor[] {
  const frame = new LocalFrame(frameOrigin);
  const maxSp = opts.maxSpacingM ?? 800, minN = opts.minJunctions ?? 2;
  const planAt = new Map(Object.values(net.signalPlans).map((p) => [p.nodeId, p]));
  const adj = adjacency(net, frame);
  const bearing = (roadId: string, atNode: string) => {
    const r = net.roads[roadId]!;
    const pts = r.from === atNode ? r.axis : [...r.axis].reverse();
    const a = frame.toMetric(pts[0]!), b = frame.toMetric(pts[Math.min(2, pts.length - 1)]!);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const deflection = (b1: number, b2: number) => Math.abs(mod(b2 - b1 + Math.PI, 2 * Math.PI) - Math.PI);
  // From a signalised node, follow a road straight on until the next signalised node.
  const follow = (start: string, roadId: string): { node: string; length: number; name: string; outBearing: number; inBearing: number } | null => {
    let node = start, road = roadId, length = 0;
    const name = net.roads[roadId]!.name;
    const outBearing = bearing(roadId, start);
    for (let guard = 0; guard < 40; guard++) {
      const e = (adj.get(node) ?? []).find((x) => x.roadId === road);
      if (!e) return null;
      length += e.len;
      if (length > maxSp) return null;
      const here = e.other;
      const arrive = bearing(road, here) + Math.PI; // direction of travel when arriving
      if (planAt.has(here)) return { node: here, length, name, outBearing, inBearing: bearing(road, here) };
      const nexts = (adj.get(here) ?? []).filter((x) => x.roadId !== road);
      const scored = nexts.map((x) => ({ x, d: deflection(arrive, bearing(x.roadId, here)), same: net.roads[x.roadId]!.name === name && !!name }))
        .filter((s) => s.d < Math.PI / 6 || (s.same && s.d < Math.PI / 3)).sort((a, b) => Number(b.same) - Number(a.same) || a.d - b.d);
      if (!scored.length) return null;
      node = here; road = scored[0]!.x.roadId;
    }
    return null;
  };
  // Links between signalised junctions, keyed by the departure bearing.
  const links = new Map<string, { to: string; length: number; name: string; out: number; inB: number }[]>();
  for (const n of planAt.keys()) for (const e of adj.get(n) ?? []) {
    const f = follow(n, e.roadId);
    if (f && f.node !== n) (links.get(n) ?? links.set(n, []).get(n)!).push({ to: f.node, length: f.length, name: f.name, out: f.outBearing, inB: f.inBearing });
  }
  const used = new Set<string>();
  const out: DetectedCorridor[] = [];
  for (const [n, ls] of links) for (const l of ls) {
    const key = `${n}>${l.to}`;
    if (used.has(key)) continue;
    // Walk backwards to the start of the chain, then forwards.
    const chain = [n, l.to];
    let length = l.length;
    used.add(key); used.add(`${l.to}>${n}`);
    let cur = l, at = l.to;
    for (let guard = 0; guard < 30; guard++) {
      const goOn = (links.get(at) ?? []).filter((x) => !chain.includes(x.to) && deflection(cur.inB + Math.PI, x.out) < Math.PI / 5).sort((a, b) => deflection(cur.inB + Math.PI, a.out) - deflection(cur.inB + Math.PI, b.out))[0];
      if (!goOn) break;
      used.add(`${at}>${goOn.to}`); used.add(`${goOn.to}>${at}`);
      chain.push(goOn.to); length += goOn.length; cur = goOn; at = goOn.to;
    }
    let back = (links.get(n) ?? []).find((x) => x !== l && deflection(l.out + Math.PI, x.out) < Math.PI / 5 && !chain.includes(x.to));
    let bat = n;
    for (let guard = 0; back && guard < 30; guard++) {
      used.add(`${bat}>${back.to}`); used.add(`${back.to}>${bat}`);
      chain.unshift(back.to); length += back.length;
      const prevOut: number = back.inB + Math.PI;
      bat = back.to;
      back = (links.get(bat) ?? []).find((x) => !chain.includes(x.to) && deflection(prevOut, x.out) < Math.PI / 5);
    }
    if (chain.length >= minN) {
      const names = chain.map((c) => planAt.get(c)!.name);
      out.push({ name: l.name || names[0] || 'Corridoio', nodeIds: chain, planIds: chain.map((c) => planAt.get(c)!.id), lengthM: Math.round(length) });
    }
  }
  return out.sort((a, b) => b.nodeIds.length - a.nodeIds.length || b.lengthM - a.lengthM);
}

export interface PlantDesign {
  readonly cycleS: number;
  readonly plans: readonly { readonly planId: string; readonly offsetS: number }[];
  readonly links: readonly { readonly from: string; readonly to: string; readonly lengthM: number; readonly travelS: number; readonly storageVeh: number; readonly queueVeh: number; readonly ok: boolean }[];
  readonly warnings: readonly string[];
}

/**
 * One controller for close junctions (impianto unico): common cycle (the longest), offsets linked so the
 * platoon released at the first junction meets green at the next one, and a storage check of each
 * internal link (7 m per queued vehicle) against the arrivals during the red.
 */
export function designPlant(net: Network, frameOrigin: LngLat, plans: readonly SignalPlan[], speedKmh = 30): PlantDesign {
  const frame = new LocalFrame(frameOrigin);
  const adj = adjacency(net, frame);
  const C = Math.max(...plans.map((p) => p.cycleS));
  const v = speedKmh / 3.6;
  const out: { planId: string; offsetS: number }[] = [{ planId: plans[0]!.id, offsetS: 0 }];
  const links: { from: string; to: string; lengthM: number; travelS: number; storageVeh: number; queueVeh: number; ok: boolean }[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < plans.length; i++) {
    const a = plans[i - 1]!, b = plans[i]!;
    const path = roadPath(adj, a.nodeId, b.nodeId, 600);
    const len = path?.length ?? 0;
    const travel = len / v;
    const ja = analyzeJunction(net, frameOrigin, b.nodeId);
    const inRoad = path?.roads[path.roads.length - 1];
    const wins = greenWindows(b, ja, inRoad);
    const green = wins.reduce((t, [s, e]) => t + (e - s), 0) * (C / Math.max(1, b.cycleS));
    const red = Math.max(0, C - green);
    const g = ja?.groups.filter((x) => x.roadId === inRoad) ?? [];
    const vol = g.reduce((t, x) => t + groupVolume(net, x), 0) || 300;
    const lanes = Math.max(1, g.reduce((t, x) => t + x.laneIds.length, 0));
    const storage = Math.floor((len * lanes) / 7);
    const queue = Math.ceil((vol * red) / 3600);
    const ok = queue <= storage;
    if (!ok) warnings.push(`Tratto ${a.name} → ${b.name} (${Math.round(len)} m): coda attesa ${queue} veicoli oltre la capacità di accumulo (${storage})`);
    links.push({ from: a.id, to: b.id, lengthM: Math.round(len), travelS: Math.round(travel * 10) / 10, storageVeh: storage, queueVeh: queue, ok });
    // Green at b opens when the platoon from a arrives: offset_b = offset_a + start(a out) + travel − start(b in).
    const startA = greenWindows(a, analyzeJunction(net, frameOrigin, a.nodeId), path?.roads[0])[0]?.[0] ?? 0;
    const startB = wins[0]?.[0] ?? 0;
    out.push({ planId: b.id, offsetS: Math.round(mod(out[i - 1]!.offsetS + startA * (C / Math.max(1, a.cycleS)) + travel - startB * (C / Math.max(1, b.cycleS)), C)) });
  }
  return { cycleS: C, plans: out, links, warnings };
}
