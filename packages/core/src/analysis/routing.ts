import { LocalFrame, bearingDeg } from '../geo/projection';
import { slice, type V } from '../geo/polyline';
import type { LngLat, Network } from '../model/types';
import { buildGraph, dijkstra, snapToGraph, type GraphEdge, type RoadGraph, type RoutingContext } from './graph';

export interface RouteStep {
  readonly roadName: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly maneuver: 'depart' | 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' | 'uturn' | 'roundabout' | 'arrive';
  readonly instruction: string;
  readonly at: LngLat;
}

export interface Route {
  readonly found: boolean;
  readonly distanceM: number;
  readonly durationS: number;
  readonly line: readonly LngLat[];
  readonly roadIds: readonly string[];
  readonly steps: readonly RouteStep[];
  readonly warnings: readonly string[];
  readonly mode: RoutingContext['mode'];
}

/** Average control delay per crossing (s): HCM-style simplification, documented in PROVIDERS.md. */
export function junctionDelay(net: Network, nodeId: string, from: GraphEdge | null, to: GraphEdge): number {
  if (!from) return 0;
  const plan = Object.values(net.signalPlans).find((p) => p.nodeId === nodeId);
  if (plan) {
    const g = plan.phases.reduce((s, p) => s + p.greenS, 0) / Math.max(1, plan.phases.length);
    const r = plan.cycleS - g;
    return (r * r) / (2 * plan.cycleS);
  }
  const spec = net.junctions[nodeId];
  if (spec?.control === 'stop' && spec.minorRoadIds.includes(from.roadId)) return 9;
  if (spec?.control === 'priority' && spec.minorRoadIds.includes(from.roadId)) return 5;
  const toRoad = net.roads[to.roadId];
  if (toRoad?.tags?.roundabout && !net.roads[from.roadId]?.tags?.roundabout) return 4;
  return 1;
}

const MANEUVER_IT: Record<RouteStep['maneuver'], string> = {
  depart: 'Parti su', straight: 'Prosegui su', left: 'Svolta a sinistra in', right: 'Svolta a destra in',
  slight_left: 'Tieni la sinistra su', slight_right: 'Tieni la destra su', uturn: 'Inversione su', roundabout: 'In rotatoria, esci su', arrive: 'Arrivo',
};

function maneuverFor(turn: number, enteringRoundabout: boolean): RouteStep['maneuver'] {
  if (enteringRoundabout) return 'roundabout';
  const t = ((turn + 540) % 360) - 180; // -180..180, positive = right
  if (Math.abs(t) < 20) return 'straight';
  if (Math.abs(t) > 160) return 'uturn';
  if (t > 0) return t < 45 ? 'slight_right' : 'right';
  return t > -45 ? 'slight_left' : 'left';
}

export function route(net: Network, frameOrigin: LngLat, from: LngLat, to: LngLat, ctx: RoutingContext, prebuilt?: RoadGraph): Route {
  const frame = new LocalFrame(frameOrigin);
  const g = prebuilt ?? buildGraph(net, frame, ctx);
  const empty = (w: string[]): Route => ({ found: false, distanceM: 0, durationS: 0, line: [], roadIds: [], steps: [], warnings: w, mode: ctx.mode });
  const a = snapToGraph(net, g, frame, from), b = snapToGraph(net, g, frame, to);
  if (!a || !b) return empty(['Nessuna strada percorribile vicino ai punti scelti']);
  const warnings: string[] = [];
  if (a.distM > 60) warnings.push(`Partenza a ${Math.round(a.distM)} m dalla strada più vicina`);
  if (b.distM > 60) warnings.push(`Arrivo a ${Math.round(b.distM)} m dalla strada più vicina`);
  const speedOf = (roadId: string, fwd: boolean) => g.edges.find((e) => e.roadId === roadId && e.forward === fwd);
  const ra = net.roads[a.roadId]!, rb = net.roads[b.roadId]!;
  const sources: { node: number; cost: number }[] = [];
  const ef = speedOf(a.roadId, true), eb = speedOf(a.roadId, false);
  if (ef) sources.push({ node: g.index.get(ra.to)!, cost: (a.length - a.along) / (ef.speedKmh / 3.6) });
  if (eb) sources.push({ node: g.index.get(ra.from)!, cost: a.along / (eb.speedKmh / 3.6) });
  const turnPenalty = (p: GraphEdge | null, e: GraphEdge) => junctionDelay(net, g.nodeIds[e.from]!, p, e);
  const { dist, prev } = dijkstra(g, sources, { turnPenalty });

  // Same road, reachable directly along it?
  let best = Infinity;
  let endVia: { node: number; fwd: boolean } | null = null;
  let direct: { fwd: boolean } | null = null;
  if (a.roadId === b.roadId) {
    if (ef && b.along >= a.along) { best = (b.along - a.along) / (ef.speedKmh / 3.6); direct = { fwd: true }; }
    if (eb && b.along <= a.along) { best = (a.along - b.along) / (eb.speedKmh / 3.6); direct = { fwd: false }; }
  }
  const bf = speedOf(b.roadId, true), bb = speedOf(b.roadId, false);
  if (bf) { const n = g.index.get(rb.from)!; const c = dist[n]! + b.along / (bf.speedKmh / 3.6); if (c < best) { best = c; endVia = { node: n, fwd: true }; direct = null; } }
  if (bb) { const n = g.index.get(rb.to)!; const c = dist[n]! + (b.length - b.along) / (bb.speedKmh / 3.6); if (c < best) { best = c; endVia = { node: n, fwd: false }; direct = null; } }
  if (!Number.isFinite(best)) {
    const reasons = [...new Set(g.blocked.values())];
    return empty(['Nessun percorso disponibile con le regole dello scenario', ...reasons.slice(0, 4)]);
  }

  const axisM = (id: string) => net.roads[id]!.axis.map((q) => frame.toMetric(q) as V);
  const toLL = (pts: V[]) => pts.map((q) => frame.toLngLat(q));
  const pieces: { roadId: string; pts: LngLat[]; lengthM: number; durationS: number }[] = [];
  if (direct) {
    const s = Math.min(a.along, b.along), e = Math.max(a.along, b.along);
    let pts = toLL(slice(axisM(a.roadId), s, e));
    if (!direct.fwd) pts = pts.reverse();
    pieces.push({ roadId: a.roadId, pts, lengthM: e - s, durationS: best });
  } else {
    const chain: GraphEdge[] = [];
    let n = endVia!.node;
    while (prev[n]! >= 0) { const e = g.edges[prev[n]!]!; chain.push(e); n = e.from; }
    chain.reverse();
    const firstFwd = chain.length ? g.nodeIds[chain[0]!.from] === ra.to : endVia!.node === g.index.get(ra.to);
    const startPts = firstFwd ? toLL(slice(axisM(a.roadId), a.along, a.length)) : toLL(slice(axisM(a.roadId), 0, a.along)).reverse();
    const sp = firstFwd ? ef! : eb!;
    pieces.push({ roadId: a.roadId, pts: startPts, lengthM: firstFwd ? a.length - a.along : a.along, durationS: (firstFwd ? a.length - a.along : a.along) / (sp.speedKmh / 3.6) });
    for (const e of chain) {
      let pts = [...net.roads[e.roadId]!.axis];
      if (!e.forward) pts = pts.reverse();
      pieces.push({ roadId: e.roadId, pts, lengthM: e.lengthM, durationS: e.costS });
    }
    const endPts = endVia!.fwd ? toLL(slice(axisM(b.roadId), 0, b.along)) : toLL(slice(axisM(b.roadId), b.along, b.length)).reverse();
    const ep = endVia!.fwd ? bf! : bb!;
    const endLen = endVia!.fwd ? b.along : b.length - b.along;
    pieces.push({ roadId: b.roadId, pts: endPts, lengthM: endLen, durationS: endLen / (ep.speedKmh / 3.6) });
  }

  const line: LngLat[] = [];
  for (const p of pieces) for (const q of p.pts) if (!line.length || line[line.length - 1]![0] !== q[0] || line[line.length - 1]![1] !== q[1]) line.push(q);
  // Steps: merge consecutive pieces on the same named road.
  const steps: RouteStep[] = [];
  let prevBearing: number | null = null;
  for (const p of pieces) {
    if (p.pts.length < 2 || p.lengthM < 0.5) continue;
    const road = net.roads[p.roadId]!;
    const name = road.name || (road.tags?.roundabout ? 'rotatoria' : 'strada senza nome');
    const startBearing = bearingDeg(p.pts[0]!, p.pts[Math.min(1, p.pts.length - 1)]!);
    const last = steps[steps.length - 1];
    const inRb = Boolean(road.tags?.roundabout);
    if (last && (last.roadName === name || (inRb && last.maneuver === 'roundabout'))) {
      steps[steps.length - 1] = { ...last, distanceM: last.distanceM + p.lengthM, durationS: last.durationS + p.durationS };
    } else {
      const m: RouteStep['maneuver'] = prevBearing === null ? 'depart' : maneuverFor(startBearing - prevBearing, inRb);
      steps.push({ roadName: name, distanceM: p.lengthM, durationS: p.durationS, maneuver: m, instruction: `${MANEUVER_IT[m]} ${name}`, at: p.pts[0]! });
    }
    prevBearing = bearingDeg(p.pts[p.pts.length - 2]!, p.pts[p.pts.length - 1]!);
  }
  steps.push({ roadName: '', distanceM: 0, durationS: 0, maneuver: 'arrive', instruction: 'Arrivo a destinazione', at: line[line.length - 1] ?? to });
  const distanceM = pieces.reduce((s, p) => s + p.lengthM, 0);
  return { found: true, distanceM, durationS: best, line, roadIds: [...new Set(pieces.map((p) => p.roadId))], steps, warnings, mode: ctx.mode };
}


/**
 * Route through several points in order (origin, stops…, destination): one graph, one leg per pair.
 * Steps of intermediate arrivals become "Tappa" steps; the route is found only if every leg is.
 */
export function routeVia(net: Network, frameOrigin: LngLat, points: readonly LngLat[], ctx: RoutingContext): Route & { legs: readonly { distanceM: number; durationS: number; found: boolean }[] } {
  const frame = new LocalFrame(frameOrigin);
  const g = buildGraph(net, frame, ctx);
  const legs = points.slice(1).map((to, i) => route(net, frameOrigin, points[i]!, to, ctx, g));
  const found = legs.every((l) => l.found);
  const line: LngLat[] = [];
  const steps: RouteStep[] = [];
  legs.forEach((l, i) => {
    for (const q of l.line) if (!line.length || line[line.length - 1]![0] !== q[0] || line[line.length - 1]![1] !== q[1]) line.push(q);
    for (const s of l.steps) {
      if (s.maneuver === 'arrive' && i < legs.length - 1) steps.push({ ...s, instruction: `Tappa ${i + 1} raggiunta` });
      else if (s.maneuver === 'depart' && i > 0) steps.push({ ...s, maneuver: 'straight', instruction: `Riparti su ${s.roadName}` });
      else steps.push(s);
    }
  });
  return {
    found, mode: ctx.mode, line, steps,
    distanceM: legs.reduce((t, l) => t + l.distanceM, 0), durationS: legs.reduce((t, l) => t + l.durationS, 0),
    roadIds: [...new Set(legs.flatMap((l) => l.roadIds))],
    warnings: [...new Set(legs.flatMap((l, i) => l.warnings.map((w) => (legs.length > 1 && !l.found ? `Tratto ${i + 1}: ${w}` : w))))],
    legs: legs.map((l) => ({ distanceM: l.distanceM, durationS: l.durationS, found: l.found })),
  };
}
