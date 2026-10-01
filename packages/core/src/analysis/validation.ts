import { LocalFrame } from '../geo/projection';
import { lengthOf, type V } from '../geo/polyline';
import type { LngLat, Network } from '../model/types';
import type { Issue } from '../ops/registry';
import { layoutSection } from '../physical/section';
import { incidence } from '../physical/topology';
import { analyzeJunction } from './junction';
import type { TrafficResult } from './traffic';

export type AuditCategory = 'geometry' | 'topology' | 'signals' | 'traffic' | 'safety' | 'accessibility';

export interface AuditItem extends Issue {
  readonly category: AuditCategory;
  readonly at?: LngLat;
}

function selfIntersects(pts: readonly V[]): boolean {
  const o = (a: V, b: V, c: V) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 1; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
    const a = pts[i - 1]!, b = pts[i]!, c = pts[j - 1]!, d = pts[j]!;
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
  }
  return false;
}

/**
 * Audits the authored part of the scenario (project roads, controls, zones) plus
 * traffic/safety results when provided. Baseline OSM defects are not reported
 * one by one: they belong to the data source, not to the project.
 */
export function auditScenario(net: Network, origin: LngLat, traffic: TrafficResult | null): AuditItem[] {
  const frame = new LocalFrame(origin);
  const out: AuditItem[] = [];
  const inc = incidence(net);
  const isProject = (id: string) => Object.values(net.roads[id]?.provenance ?? {}).some((p) => p.kind === 'project');
  for (const road of Object.values(net.roads)) {
    if (!isProject(road.id)) continue;
    const axis = road.axis.map((p) => frame.toMetric(p) as V);
    const L = lengthOf(axis);
    if (L < 3) out.push({ category: 'geometry', code: 'road.short', severity: 'warning', message: `${road.name || road.id}: tratto di ${L.toFixed(1)} m`, targetIds: [road.id], at: road.axis[0] });
    if (selfIntersects(axis)) out.push({ category: 'geometry', code: 'road.selfIntersection', severity: 'error', message: `${road.name || road.id}: l'asse si interseca`, targetIds: [road.id], at: road.axis[0] });
    for (const [nodeId, end] of [[road.from, 'inizio'], [road.to, 'fine']] as const) {
      const degree = inc.byNode.get(nodeId)?.length ?? 0;
      if (degree === 1 && !road.tags?.roundabout) out.push({ category: 'topology', code: 'road.dangling', severity: 'warning', message: `${road.name || road.id}: ${end} non collegato alla rete`, targetIds: [road.id], at: net.nodes[nodeId]?.at });
    }
    if (road.oneway !== 'no') {
      const ends = [road.from, road.to].map((n) => (inc.byNode.get(n) ?? []).filter((e) => e.road.id !== road.id && !layoutSection(e.road).pedestrianOnly).length);
      if (ends.some((c) => c === 0)) out.push({ category: 'topology', code: 'oneway.deadEnd', severity: 'error', message: `${road.name || road.id}: senso unico che termina in un vicolo cieco`, targetIds: [road.id], at: road.axis[0] });
    }
    const lay = layoutSection(road);
    const hasWalk = lay.elements.some((e) => e.el.kind === 'sidewalk');
    if (!lay.pedestrianOnly && !hasWalk && ['residential', 'tertiary', 'secondary', 'living_street'].includes(road.roadClass)) {
      out.push({ category: 'accessibility', code: 'sidewalk.missing', severity: 'warning', message: `${road.name || road.id}: strada di progetto senza marciapiede`, targetIds: [road.id], at: road.axis[0] });
    }
  }
  // One-way pairs that make a node unreachable or unexitable.
  for (const [nodeId, ends] of inc.byNode) {
    const veh = ends.filter((e) => !layoutSection(e.road).pedestrianOnly);
    if (veh.length < 2 || !veh.some((e) => isProject(e.road.id))) continue;
    const enters = veh.some((e) => e.road.oneway === 'no' || (e.road.oneway === 'forward') !== e.atStart);
    const exits = veh.some((e) => e.road.oneway === 'no' || (e.road.oneway === 'forward') === e.atStart);
    if (!enters || !exits) out.push({ category: 'topology', code: 'node.trap', severity: 'error', message: !enters ? 'Nodo da cui si può solo uscire: sensi unici incoerenti' : 'Nodo in cui si entra senza poter uscire: sensi unici incoerenti', targetIds: veh.map((e) => e.road.id), at: net.nodes[nodeId]?.at });
  }
  for (const plan of Object.values(net.signalPlans)) {
    const a = analyzeJunction(net, origin, plan.nodeId);
    const at = net.nodes[plan.nodeId]?.at;
    if (!a) { out.push({ category: 'signals', code: 'signal.node', severity: 'error', message: `${plan.name}: l'incrocio non esiste più`, at }); continue; }
    const groups = new Set(a.groups.map((g) => g.id));
    const served = new Set(plan.phases.flatMap((p) => p.greenGroups));
    for (const g of groups) if (!served.has(g)) out.push({ category: 'signals', code: 'signal.unserved', severity: 'error', message: `${plan.name}: gruppo ${g} senza verde nel ciclo`, at });
    for (const p of plan.phases) for (const x of p.greenGroups) if (!groups.has(x)) out.push({ category: 'signals', code: 'signal.stale', severity: 'warning', message: `${plan.name}: gruppo ${x} non più presente (geometria cambiata)`, at });
    const bad = new Set(a.incompatible.map(([x, y]) => `${x}|${y}`));
    for (const p of plan.phases) for (const x of p.greenGroups) for (const y of p.greenGroups) {
      if (x < y && bad.has(`${x}|${y}`)) out.push({ category: 'signals', code: 'signal.conflict', severity: 'error', message: `${plan.name} · ${p.name}: verdi in conflitto ${x} × ${y}`, at });
    }
    const total = plan.phases.reduce((s, p) => s + p.greenS + p.yellowS + p.allRedS, 0);
    if (Math.abs(total - plan.cycleS) > 0.5) out.push({ category: 'signals', code: 'signal.cycle', severity: 'error', message: `${plan.name}: fasi ${total} s ≠ ciclo ${plan.cycleS} s`, at });
    if (plan.cycleS > 120) out.push({ category: 'signals', code: 'signal.longCycle', severity: 'warning', message: `${plan.name}: ciclo di ${plan.cycleS} s, attese pedonali lunghe`, at });
  }
  if (traffic) {
    const worst = traffic.flows.filter((f) => f.vc > 1).sort((a, b) => b.vc - a.vc).slice(0, 15);
    for (const f of worst) {
      const r = net.roads[f.roadId];
      out.push({ category: 'traffic', code: 'traffic.overCapacity', severity: 'warning', message: `${r?.name || f.roadId}: v/c ${f.vc.toFixed(2)} (stima)`, targetIds: [f.roadId], at: r?.axis[Math.floor((r.axis.length - 1) / 2)] });
    }
  }
  for (const z of Object.values(net.zones)) {
    if (z.polygon.length < 3) out.push({ category: 'geometry', code: 'zone.polygon', severity: 'error', message: `${z.name}: poligono non valido`, at: z.polygon[0] });
  }
  return out;
}
