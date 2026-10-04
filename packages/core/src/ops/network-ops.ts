import { LocalFrame } from '../geo/projection';
import { add, dist, lengthOf, mul, project, slice, sub, type V } from '../geo/polyline';
import type {
  Area, JunctionSpec, LngLat, Network, Oneway, Road, RoadNode, Roundabout, SignalPlan, TurnKind, Zone,
} from '../model/types';
import { planIssues, rescalePlan } from '../analysis/junction';
import { defineOperation, operationSpec, type Issue } from './registry';
import { makeLanes } from './road-factory';
import { extractRoundabout, insertRoundabout, planRoundabout } from './roundabout-insert';

const warn = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'warning', message, ...(targetIds ? { targetIds } : {}) });
export { centreRadius, extractRoundabout, insertRoundabout, planRoundabout } from './roundabout-insert';

const err = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'error', message, ...(targetIds ? { targetIds } : {}) });
const PROJECT = { kind: 'project', source: 'DRIP Urban scenario' } as const;

const okLL = (p: unknown): p is LngLat => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isFinite(x)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
/** Endpoint tolerance ≈ 10 cm; apply() then pins the axis exactly to the node. */
const near = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1.2e-6 && Math.abs(a[1] - b[1]) < 1.2e-6;

function frameFor(net: Network): LocalFrame {
  const first = Object.values(net.nodes)[0];
  return new LocalFrame(first ? first.at : [0, 0]);
}

function dropOrphanNodes(net: Network, candidates: Iterable<string>): Network {
  const used = new Set<string>();
  for (const r of Object.values(net.roads)) { used.add(r.from); used.add(r.to); }
  let nodes: Record<string, RoadNode> | null = null;
  for (const id of candidates) {
    if (!used.has(id) && net.nodes[id] && !net.junctions[id]) {
      nodes ??= { ...net.nodes };
      delete nodes[id];
    }
  }
  return nodes ? { ...net, nodes } : net;
}

function markProject(road: Road, ...keys: string[]): Road {
  const provenance = { ...road.provenance };
  for (const k of keys) provenance[k] = PROJECT;
  return { ...road, provenance };
}

// ---------------------------------------------------------------- roads

export interface RoadAddPayload { readonly road: Road; readonly nodes: readonly RoadNode[] }

export const roadAdd = defineOperation<RoadAddPayload>({
  type: 'road.add',
  label: (p) => `Nuova strada ${p.road.name || p.road.id}`,
  validate(net, p) {
    const issues: Issue[] = [];
    const r = p.road;
    if (net.roads[r.id]) issues.push(err('road.duplicateId', `Id strada già in uso: ${r.id}`, [r.id]));
    if (r.axis.length < 2 || !r.axis.every(okLL)) issues.push(err('road.axis', 'Asse non valido (minimo 2 punti)', [r.id]));
    if (!r.lanes.length) issues.push(err('road.lanes', 'La strada deve avere almeno una corsia', [r.id]));
    const nodes = new Map(p.nodes.map((n) => [n.id, n]));
    for (const id of [r.from, r.to]) {
      const n = nodes.get(id) ?? net.nodes[id];
      if (!n) issues.push(err('road.node', `Nodo ${id} inesistente`, [r.id]));
      else if (nodes.has(id) && net.nodes[id]) issues.push(err('node.duplicateId', `Nodo già esistente: ${id}`, [id]));
    }
    const a = nodes.get(r.from) ?? net.nodes[r.from], b = nodes.get(r.to) ?? net.nodes[r.to];
    if (a && !near(a.at, r.axis[0]!)) issues.push(err('road.endpoint', 'Il primo punto dell\'asse non coincide con il nodo iniziale', [r.id]));
    if (b && !near(b.at, r.axis[r.axis.length - 1]!)) issues.push(err('road.endpoint', 'L\'ultimo punto dell\'asse non coincide con il nodo finale', [r.id]));
    return issues;
  },
  apply(net, p) {
    const nodes = { ...net.nodes };
    for (const n of p.nodes) nodes[n.id] = n;
    const axis = [...p.road.axis];
    axis[0] = nodes[p.road.from]!.at;
    axis[axis.length - 1] = nodes[p.road.to]!.at;
    return { ...net, nodes, roads: { ...net.roads, [p.road.id]: { ...p.road, axis, provenance: { ...p.road.provenance, geometry: PROJECT, width: PROJECT } } } };
  },
});

export interface RoadRemovePayload { readonly roadIds: readonly string[] }

export const roadRemove = defineOperation<RoadRemovePayload>({
  type: 'road.remove',
  label: (p) => (p.roadIds.length === 1 ? `Elimina strada ${p.roadIds[0]}` : `Elimina ${p.roadIds.length} strade`),
  validate(net, p) {
    const missing = p.roadIds.filter((id) => !net.roads[id]);
    const ring = p.roadIds.filter((id) => net.roads[id]?.tags?.roundabout);
    return [
      ...(missing.length ? [err('road.missing', `Strade inesistenti: ${missing.join(', ')}`, missing)] : []),
      ...(ring.length ? [err('road.ring', 'Le corsie dell\'anello si modificano dalla rotatoria', ring)] : []),
    ];
  },
  apply(net, p) {
    const roads = { ...net.roads };
    const touched: string[] = [];
    for (const id of p.roadIds) { touched.push(roads[id]!.from, roads[id]!.to); delete roads[id]; }
    return dropOrphanNodes({ ...net, roads }, touched);
  },
});

export interface RoadSetAxisPayload { readonly roadId: string; readonly axis: readonly LngLat[] }

export const roadSetAxis = defineOperation<RoadSetAxisPayload>({
  type: 'road.setAxis',
  label: () => 'Modifica tracciato',
  validate(net, p) {
    const r = net.roads[p.roadId];
    if (!r) return [err('road.missing', `Strada ${p.roadId} inesistente`, [p.roadId])];
    if (p.axis.length < 2 || !p.axis.every(okLL)) return [err('road.axis', 'Asse non valido', [p.roadId])];
    if (!near(p.axis[0]!, net.nodes[r.from]!.at) || !near(p.axis[p.axis.length - 1]!, net.nodes[r.to]!.at)) {
      return [err('road.endpoint', 'Gli estremi si spostano con lo strumento Nodi', [p.roadId])];
    }
    return [];
  },
  apply(net, p) {
    const r = net.roads[p.roadId]!;
    const axis = [...p.axis];
    axis[0] = net.nodes[r.from]!.at;
    axis[axis.length - 1] = net.nodes[r.to]!.at;
    return { ...net, roads: { ...net.roads, [r.id]: markProject({ ...r, axis }, 'geometry') } };
  },
});

export interface RoadSetSectionPayload {
  readonly roadId: string;
  readonly lanes: Road['lanes'];
  readonly section: Road['section'];
  readonly oneway?: Oneway;
}

export const roadSetSection = defineOperation<RoadSetSectionPayload>({
  type: 'road.setSection',
  label: () => 'Modifica sezione stradale',
  validate(net, p) {
    const issues: Issue[] = [];
    if (!net.roads[p.roadId]) issues.push(err('road.missing', `Strada ${p.roadId} inesistente`, [p.roadId]));
    if (!p.lanes.length) issues.push(err('road.lanes', 'Almeno una corsia', [p.roadId]));
    for (const e of p.section.elements) {
      if (!(e.widthM >= 0.1 && e.widthM <= 30)) issues.push(err('section.width', `Larghezza fuori intervallo per ${e.kind}`, [p.roadId]));
      if (e.laneId && !p.lanes.some((l) => l.id === e.laneId)) issues.push(err('section.lane', `Elemento collegato a corsia inesistente ${e.laneId}`, [p.roadId]));
    }
    return issues;
  },
  apply(net, p) {
    const r = net.roads[p.roadId]!;
    const next = { ...r, lanes: p.lanes, section: p.section, ...(p.oneway ? { oneway: p.oneway } : {}) };
    return { ...net, roads: { ...net.roads, [r.id]: markProject(next, 'width', 'section', 'lanes') } };
  },
});

export interface RoadSplitPayload { readonly roadId: string; readonly at: LngLat; readonly nodeId: string; readonly newRoadIds: readonly [string, string] }

export const roadSplit = defineOperation<RoadSplitPayload>({
  type: 'road.split',
  label: () => 'Dividi strada',
  validate(net, p) {
    const r = net.roads[p.roadId];
    if (!r) return [err('road.missing', `Strada ${p.roadId} inesistente`, [p.roadId])];
    if (net.nodes[p.nodeId]) return [err('node.duplicateId', `Nodo già esistente ${p.nodeId}`)];
    if (p.newRoadIds.some((id) => net.roads[id])) return [err('road.duplicateId', 'Id strade già in uso')];
    const f = frameFor(net);
    const axis = r.axis.map((q) => f.toMetric(q) as V);
    const pr = project(axis, f.toMetric(p.at) as V);
    const L = lengthOf(axis);
    if (pr.along < 0.75 || pr.along > L - 0.75) return [err('road.split.end', 'Punto di taglio troppo vicino a un estremo', [p.roadId])];
    return [];
  },
  apply(net, p) {
    const r = net.roads[p.roadId]!;
    const f = frameFor(net);
    const axis = r.axis.map((q) => f.toMetric(q) as V);
    const pr = project(axis, f.toMetric(p.at) as V);
    const L = lengthOf(axis);
    const toLL = (pts: V[]) => pts.map((q) => f.toLngLat(q));
    const cut = f.toLngLat(pr.at);
    const a1 = toLL(slice(axis, 0, pr.along)), a2 = toLL(slice(axis, pr.along, L));
    a1[0] = r.axis[0]!; a1[a1.length - 1] = cut; a2[0] = cut; a2[a2.length - 1] = r.axis[r.axis.length - 1]!;
    const relane = (road: Road, id: string): Road => ({
      ...road, id,
      lanes: road.lanes.map((l) => ({ ...l, id: l.id.replace(r.id, id) })),
      section: { elements: road.section.elements.map((e) => ({ ...e, id: e.id.replace(r.id, id), ...(e.laneId ? { laneId: e.laneId.replace(r.id, id) } : {}) })) },
    });
    const [idA, idB] = p.newRoadIds;
    const roads = { ...net.roads };
    delete roads[r.id];
    roads[idA] = markProject(relane({ ...r, to: p.nodeId, axis: a1 }, idA), 'geometry');
    roads[idB] = markProject(relane({ ...r, from: p.nodeId, axis: a2 }, idB), 'geometry');
    return { ...net, roads, nodes: { ...net.nodes, [p.nodeId]: { id: p.nodeId, at: cut } } };
  },
});

export interface NodeMovePayload { readonly nodeId: string; readonly to: LngLat; readonly falloffM: number }

export const nodeMove = defineOperation<NodeMovePayload>({
  type: 'node.move',
  label: () => 'Sposta nodo',
  validate(net, p) {
    if (!net.nodes[p.nodeId]) return [err('node.missing', `Nodo ${p.nodeId} inesistente`, [p.nodeId])];
    if (!okLL(p.to)) return [err('node.target', 'Destinazione non valida')];
    return [];
  },
  apply(net, p) {
    const f = frameFor(net);
    const from = f.toMetric(net.nodes[p.nodeId]!.at) as V;
    const delta = sub(f.toMetric(p.to) as V, from);
    const roads = { ...net.roads };
    for (const r of Object.values(net.roads)) {
      if (r.from !== p.nodeId && r.to !== p.nodeId) continue;
      let axis = r.axis.map((q) => f.toMetric(q) as V);
      const shift = (pts: V[]): V[] => {
        // Smooth falloff along the road: the endpoint moves fully, interior points less.
        let acc = 0;
        return pts.map((q, i) => {
          if (i > 0) acc += dist(pts[i - 1]!, q);
          const w = p.falloffM > 0 ? Math.max(0, 1 - acc / p.falloffM) : i === 0 ? 1 : 0;
          const s = w * w * (3 - 2 * w);
          return add(q, mul(delta, s));
        });
      };
      if (r.from === p.nodeId) axis = shift(axis);
      if (r.to === p.nodeId) axis = shift([...axis].reverse()).reverse();
      const ll = axis.map((q) => f.toLngLat(q));
      if (r.from === p.nodeId) ll[0] = p.to;
      if (r.to === p.nodeId) ll[ll.length - 1] = p.to;
      roads[r.id] = markProject({ ...r, axis: ll }, 'geometry');
    }
    return { ...net, roads, nodes: { ...net.nodes, [p.nodeId]: { id: p.nodeId, at: p.to } } };
  },
});

export interface NodeMergePayload { readonly sourceId: string; readonly targetId: string }

/**
 * Joins two nodes: every road ending at `source` now ends at `target`. Only the last axis vertex of those
 * roads moves (onto the target); the rest of the network keeps its geometry. Used to connect roads drawn
 * without snapping, so that routing sees a real junction.
 */
export const nodeMerge = defineOperation<NodeMergePayload>({
  type: 'node.merge',
  label: () => 'Aggancia strada',
  validate(net, p) {
    if (!net.nodes[p.sourceId]) return [err('node.missing', `Nodo ${p.sourceId} inesistente`)];
    if (!net.nodes[p.targetId]) return [err('node.missing', `Nodo ${p.targetId} inesistente`)];
    if (p.sourceId === p.targetId) return [err('node.same', 'Stesso nodo')];
    const loops = Object.values(net.roads).filter((r) => (r.from === p.sourceId && r.to === p.targetId) || (r.to === p.sourceId && r.from === p.targetId));
    const short = loops.filter((r) => r.axis.length <= 2);
    if (short.length) return [err('node.loop', 'I due nodi sono gli estremi della stessa strada corta: eliminala invece di unirli', short.map((r) => r.id))];
    if (Object.values(net.roundabouts).some((rb) => Object.values(net.roads).some((r) => r.tags?.roundabout === rb.id && (r.from === p.sourceId || r.to === p.sourceId)))) {
      return [err('node.ring', 'I nodi dell\'anello si modificano dalla rotatoria')];
    }
    return [];
  },
  apply(net, p) {
    const target = net.nodes[p.targetId]!;
    const roads = { ...net.roads };
    for (const r of Object.values(net.roads)) {
      if (r.from !== p.sourceId && r.to !== p.sourceId) continue;
      const axis = [...r.axis];
      let from = r.from, to = r.to;
      if (r.from === p.sourceId) { from = p.targetId; axis[0] = target.at; }
      if (r.to === p.sourceId) { to = p.targetId; axis[axis.length - 1] = target.at; }
      if (from === to) { delete roads[r.id]; continue; }
      roads[r.id] = markProject({ ...r, from, to, axis }, 'geometry');
    }
    const nodes = { ...net.nodes };
    delete nodes[p.sourceId];
    const junctions = { ...net.junctions };
    delete junctions[p.sourceId];
    return { ...net, roads, nodes, junctions };
  },
});

export interface DanglingLink {
  /** Dead-end node of a road (degree 1). */
  readonly nodeId: string;
  readonly roadId: string;
  readonly kind: 'node' | 'edge';
  readonly targetNodeId?: string;
  readonly targetRoadId?: string;
  readonly along?: number;
  readonly at: LngLat;
  readonly distM: number;
}

/**
 * Dead ends that are almost touching the network (≤ `tolM`): the nearest node (preferred within
 * `nodePreferM`) or the nearest point on another road. Roads drawn without snapping show up here.
 */
export function danglingLinks(net: Network, tolM = 12, nodePreferM = 6): DanglingLink[] {
  const f = frameFor(net);
  const degree = new Map<string, number>();
  for (const r of Object.values(net.roads)) for (const n of [r.from, r.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const axes = new Map(Object.values(net.roads).map((r) => [r.id, r.axis.map((q) => f.toMetric(q) as V)]));
  const nodesM = Object.values(net.nodes).map((n) => ({ id: n.id, p: f.toMetric(n.at) as V }));
  const out: DanglingLink[] = [];
  for (const [nid, deg] of degree) {
    if (deg !== 1) continue;
    const road = Object.values(net.roads).find((r) => r.from === nid || r.to === nid)!;
    if (road.tags?.roundabout) continue;
    const p = f.toMetric(net.nodes[nid]!.at) as V;
    // The road's own other end and its own axis are not targets.
    const own = new Set([road.from, road.to]);
    let bestNode: { id: string; d: number } | null = null;
    for (const n of nodesM) {
      if (own.has(n.id)) continue;
      const d = dist(p, n.p);
      if (d <= tolM && (!bestNode || d < bestNode.d)) bestNode = { id: n.id, d };
    }
    let bestEdge: { id: string; d: number; along: number; at: V; length: number } | null = null;
    for (const [rid, axis] of axes) {
      if (rid === road.id) continue;
      const r = net.roads[rid]!;
      if (r.tags?.roundabout) continue;
      const pr = project(axis, p);
      if (pr.d <= tolM && (!bestEdge || pr.d < bestEdge.d)) bestEdge = { id: rid, d: pr.d, along: pr.along, at: pr.at, length: lengthOf(axis) };
    }
    // Prefer the node when it is close, or when the edge point is too near the edge's own ends to split.
    const edgeUsable = bestEdge && bestEdge.along > 1 && bestEdge.along < bestEdge.length - 1;
    if (bestNode && (bestNode.d <= nodePreferM || !edgeUsable || bestNode.d <= bestEdge!.d + 2)) {
      out.push({ nodeId: nid, roadId: road.id, kind: 'node', targetNodeId: bestNode.id, at: net.nodes[bestNode.id]!.at, distM: Math.round(bestNode.d * 10) / 10 });
    } else if (bestEdge && edgeUsable) {
      out.push({ nodeId: nid, roadId: road.id, kind: 'edge', targetRoadId: bestEdge.id, along: bestEdge.along, at: f.toLngLat(bestEdge.at), distM: Math.round(bestEdge.d * 10) / 10 });
    }
  }
  return out.sort((a, b) => a.distM - b.distM);
}

/**
 * Connection that leaves every existing geometry untouched: the target road is split exactly on its
 * own axis (no vertex moves) and a short connector road («raccordo», same section as the dangling
 * road) joins the free end to it. Gaps under 30 cm are merged instead (no visible change).
 */
export function connectorOps(net: Network, link: DanglingLink, ids: { node: string; roads: [string, string]; connector: string }): { type: string; payload: unknown }[] {
  if (link.distM < 0.3) return linkOps(link, ids);
  const src = net.roads[link.roadId]!;
  const ops: { type: string; payload: unknown }[] = [];
  let target = link.targetNodeId;
  if (link.kind === 'edge') {
    ops.push({ type: 'road.split', payload: { roadId: link.targetRoadId, at: link.at, nodeId: ids.node, newRoadIds: ids.roads } });
    target = ids.node;
  }
  const remap = <T>(v: T): T => JSON.parse(JSON.stringify(v).split(src.id).join(ids.connector)) as T;
  const from = net.nodes[link.nodeId]!.at;
  const connector: Road = {
    ...src, id: ids.connector, from: link.nodeId, to: target!, axis: [from, link.at],
    lanes: remap(src.lanes), section: remap(src.section), vertical: undefined, structure: undefined,
    tags: { ...(src.tags ?? {}), connector: 'yes' },
    provenance: { geometry: { kind: 'project', source: 'Raccordo DRIP (geometrie esistenti invariate)' }, width: { kind: 'project', source: 'Raccordo DRIP' } },
  };
  ops.push({ type: 'road.add', payload: { road: connector, nodes: [] } });
  return ops;
}

/** Operations that connect a dangling end: split the target road if needed, then merge the nodes. */
export function linkOps(link: DanglingLink, ids: { node: string; roads: [string, string] }): { type: string; payload: unknown }[] {
  if (link.kind === 'node') return [{ type: 'node.merge', payload: { sourceId: link.nodeId, targetId: link.targetNodeId } }];
  return [
    { type: 'road.split', payload: { roadId: link.targetRoadId, at: link.at, nodeId: ids.node, newRoadIds: ids.roads } },
    { type: 'node.merge', payload: { sourceId: link.nodeId, targetId: ids.node } },
  ];
}

// ---------------------------------------------------------------- junctions, signals, zones

export const junctionSet = defineOperation<{ readonly spec: JunctionSpec }>({
  type: 'junction.set',
  label: () => 'Regolazione incrocio',
  validate(net, p) {
    if (!net.nodes[p.spec.nodeId]) return [err('node.missing', 'Incrocio inesistente', [p.spec.nodeId])];
    if (!(p.spec.cornerRadiusM >= 0 && p.spec.cornerRadiusM <= 25)) return [err('junction.radius', 'Raggio di raccordo fuori intervallo 0–25 m')];
    const bad = [...p.spec.minorRoadIds, ...p.spec.crossingRoadIds].filter((id) => { const r = net.roads[id]; return !r || (r.from !== p.spec.nodeId && r.to !== p.spec.nodeId); });
    return bad.length ? [err('junction.arm', `Strade non afferenti all'incrocio: ${bad.join(', ')}`)] : [];
  },
  apply: (net, p) => ({ ...net, junctions: { ...net.junctions, [p.spec.nodeId]: p.spec } }),
});

export interface SignalPlanSetPayload {
  readonly plan: SignalPlan;
  /** Group-level conflicts (1.0 payloads). */
  readonly conflicts: readonly (readonly [string, string])[];
  /** Movement-level conflicts `<group>:<turn>`; when present they replace `conflicts` (directional control). */
  readonly movementConflicts?: readonly (readonly [string, string])[];
  readonly permissivePairs?: readonly (readonly [string, string])[];
  /** Turns of each group, needed to resolve movement-level checks. */
  readonly groupTurns?: Readonly<Record<string, readonly TurnKind[]>>;
}

export const signalPlanSet = defineOperation<SignalPlanSetPayload>({
  type: 'signal.setPlan',
  label: (p) => `Piano semaforico ${p.plan.name}`,
  validate(net, p) {
    const issues: Issue[] = [];
    const total = p.plan.phases.reduce((s, ph) => s + ph.greenS + ph.yellowS + ph.allRedS, 0);
    if (!net.nodes[p.plan.nodeId]) issues.push(err('signal.node', 'Incrocio inesistente'));
    if (!p.plan.phases.length) issues.push(err('signal.phases', 'Il piano deve avere almeno una fase'));
    if (!(p.plan.cycleS >= 20 && p.plan.cycleS <= 240)) issues.push(err('signal.cycle', 'Ciclo fuori intervallo 20–240 s'));
    if (Math.abs(total - p.plan.cycleS) > 0.5) issues.push(err('signal.cycle', `La somma delle fasi (${total.toFixed(0)} s) deve essere uguale al ciclo (${p.plan.cycleS} s)`));
    for (const ph of p.plan.phases) {
      if (ph.yellowS < 3) issues.push(err('signal.yellow', `Fase ${ph.name}: giallo minimo 3 s`));
      if (ph.greenS < 5) issues.push(err('signal.green', `Fase ${ph.name}: verde minimo 5 s`));
    }
    if (p.movementConflicts && p.groupTurns) {
      const turns = p.groupTurns;
      const groups = Object.entries(turns).map(([id, t]) => ({ id, turns: t }));
      for (const i of planIssues(p.plan, { groups: groups.map((g) => ({ ...g, label: g.id })) as never, movementConflicts: p.movementConflicts, permissivePairs: p.permissivePairs ?? [] })) {
        if (i.kind === 'conflict') issues.push(err('signal.conflict', i.message));
      }
    } else {
      for (const ph of p.plan.phases) for (const [a, b] of p.conflicts) {
        if (ph.greenGroups.includes(a) && ph.greenGroups.includes(b)) issues.push(err('signal.conflict', `Fase ${ph.name}: verdi in conflitto (${a} × ${b})`));
      }
    }
    return issues;
  },
  apply(net, p) {
    const junction: JunctionSpec = net.junctions[p.plan.nodeId] ?? { nodeId: p.plan.nodeId, control: 'signal', cornerRadiusM: 4, minorRoadIds: [], crossingRoadIds: [] };
    return {
      ...net,
      signalPlans: { ...net.signalPlans, [p.plan.id]: p.plan },
      junctions: { ...net.junctions, [p.plan.nodeId]: { ...junction, control: 'signal' } },
    };
  },
});

/** Switches single signal heads off (or back on) without touching the timing. */
export const signalSetHeads = defineOperation<{ readonly planId: string; readonly disabledHeads: readonly string[] }>({
  type: 'signal.setHeads',
  label: (p) => (p.disabledHeads.length ? `Lanterne rimosse: ${p.disabledHeads.length}` : 'Tutte le lanterne installate'),
  validate: (net, p) => (net.signalPlans[p.planId] ? [] : [err('signal.missing', 'Piano inesistente')]),
  apply(net, p) {
    const plan = net.signalPlans[p.planId]!;
    return { ...net, signalPlans: { ...net.signalPlans, [plan.id]: { ...plan, disabledHeads: [...new Set(p.disabledHeads)] } } };
  },
});

export interface SignalCoordinatePayload {
  readonly coordination: { readonly id: string; readonly name: string; readonly speedKmh: number; readonly direction: 'oneway' | 'twoway' };
  readonly cycleS: number;
  /**
   * Ordered upstream → downstream. `halfCycle`: the junction runs cycleS/2 (doppio ciclo).
   * `shared`: the junction already belongs to another corridor (crossing of two corridors): its
   * offset is kept as given and it stays in its own corridor.
   */
  readonly plans: readonly { readonly planId: string; readonly offsetS: number; readonly halfCycle?: boolean; readonly shared?: boolean }[];
  /** Plans off the corridor that move with it (other members of a merged plant): new offset only. */
  readonly extraPlans?: readonly { readonly planId: string; readonly offsetS: number }[];
}

const mod = (x: number, m: number) => ((x % m) + m) % m;
const fixedTime = (pl: SignalPlan) => pl.phases.reduce((t, ph) => t + ph.yellowS + ph.allRedS + 5, 0);

/**
 * Keeps the common-cycle invariant: every plan reachable from `seeds` through corridors and plants
 * runs `cycleS` (half of it for half-cycle corridor members); offsets are kept modulo the new cycle.
 */
function syncCycles(signalPlans: Record<string, SignalPlan>, seeds: readonly string[], cycleS: number): void {
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id) || !signalPlans[id]) continue;
    seen.add(id);
    const pl = signalPlans[id]!;
    const target = pl.coordination?.halfCycle ? cycleS / 2 : cycleS;
    if (pl.cycleS !== target) {
      const r = rescalePlan(pl, target);
      signalPlans[id] = { ...r, offsetS: mod(Math.round(pl.offsetS), r.cycleS) };
    }
    for (const other of Object.values(signalPlans)) {
      if (seen.has(other.id)) continue;
      if ((pl.coordination && other.coordination?.id === pl.coordination.id) || (pl.plant && other.plant?.id === pl.plant.id)) queue.push(other.id);
    }
  }
}

/** Links the plans of several junctions in one corridor: common cycle, computed offsets. */
export const signalCoordinate = defineOperation<SignalCoordinatePayload>({
  type: 'signal.coordinate',
  label: (p) => `Coordinamento ${p.coordination.name} (${p.plans.length} incroci)`,
  validate(net, p) {
    const issues: Issue[] = [];
    if (p.plans.length < 2) issues.push(err('coord.size', 'Servono almeno due incroci semaforizzati'));
    const all = [...p.plans, ...(p.extraPlans ?? [])];
    const missing = all.filter((x) => !net.signalPlans[x.planId]);
    if (missing.length) issues.push(err('coord.missing', `Piani inesistenti: ${missing.map((x) => x.planId).join(', ')}`));
    if (!(p.cycleS >= 30 && p.cycleS <= 180)) issues.push(err('coord.cycle', 'Ciclo comune fuori intervallo 30–180 s'));
    if (!(p.coordination.speedKmh >= 10 && p.coordination.speedKmh <= 90)) issues.push(err('coord.speed', 'Velocità di progetto 10–90 km/h'));
    for (const x of all) {
      const pl = net.signalPlans[x.planId];
      const half = 'halfCycle' in x && x.halfCycle;
      if (half && (p.cycleS % 2 || p.cycleS / 2 < 20)) issues.push(err('coord.half', `Doppio ciclo non ammesso per ${pl?.name ?? x.planId}: ciclo comune dispari o mezzo ciclo < 20 s`));
      if (pl && fixedTime(pl) > (half ? p.cycleS / 2 : p.cycleS)) issues.push(err('coord.short', `Ciclo comune troppo corto per ${pl.name}`));
    }
    return issues;
  },
  apply(net, p) {
    const signalPlans = { ...net.signalPlans };
    p.plans.forEach((x, order) => {
      const cyc = x.halfCycle ? p.cycleS / 2 : p.cycleS;
      const pl = rescalePlan(signalPlans[x.planId]!, cyc);
      const keep = x.shared && pl.coordination && pl.coordination.id !== p.coordination.id;
      signalPlans[x.planId] = {
        ...pl, offsetS: mod(Math.round(x.offsetS), pl.cycleS), mode: pl.mode === 'fixed_time' ? 'green_wave' : pl.mode,
        coordination: keep ? pl.coordination : { ...p.coordination, order, mode: 'corridor', ...(x.halfCycle ? { halfCycle: true } : {}) },
      };
    });
    for (const x of p.extraPlans ?? []) {
      const pl = rescalePlan(signalPlans[x.planId]!, p.cycleS);
      signalPlans[x.planId] = { ...pl, offsetS: mod(Math.round(x.offsetS), pl.cycleS) };
    }
    syncCycles(signalPlans, [...p.plans, ...(p.extraPlans ?? [])].map((x) => x.planId), p.cycleS);
    return { ...net, signalPlans };
  },
});

export const signalUncoordinate = defineOperation<{ readonly coordinationId: string }>({
  type: 'signal.uncoordinate',
  label: () => 'Scollega incroci coordinati',
  validate: (net, p) => (Object.values(net.signalPlans).some((x) => x.coordination?.id === p.coordinationId) ? [] : [err('coord.missing', 'Coordinamento inesistente')]),
  apply(net, p) {
    const signalPlans = { ...net.signalPlans };
    for (const pl of Object.values(signalPlans)) {
      if (pl.coordination?.id !== p.coordinationId) continue;
      const { coordination: _c, ...rest } = pl;
      // A half-cycle junction goes back to the full cycle of the corridor.
      const restored = pl.coordination.halfCycle ? rescalePlan(rest, pl.cycleS * 2) : rest;
      signalPlans[pl.id] = { ...restored, mode: pl.mode === 'green_wave' ? 'fixed_time' : pl.mode };
    }
    return { ...net, signalPlans };
  },
});

export interface SignalMergePlantPayload {
  readonly plant: { readonly id: string; readonly name: string; readonly speedKmh?: number };
  readonly cycleS: number;
  /** Offsets fixed by the internal travel times (see designPlant). */
  readonly plans: readonly { readonly planId: string; readonly offsetS: number }[];
}

/**
 * Merges close junctions into one plant (impianto unico): one cycle, offsets linked by the travel time
 * on the short internal links so they never store a queue. Corridors touching the plant follow the
 * new cycle.
 */
export const signalMergePlant = defineOperation<SignalMergePlantPayload>({
  type: 'signal.mergePlant',
  label: (p) => `Impianto unico ${p.plant.name} (${p.plans.length} incroci)`,
  validate(net, p) {
    const issues: Issue[] = [];
    if (p.plans.length < 2) issues.push(err('plant.size', 'Servono almeno due incroci semaforizzati'));
    if (new Set(p.plans.map((x) => x.planId)).size !== p.plans.length) issues.push(err('plant.dup', 'Incrocio ripetuto'));
    const missing = p.plans.filter((x) => !net.signalPlans[x.planId]);
    if (missing.length) issues.push(err('plant.missing', `Piani inesistenti: ${missing.map((x) => x.planId).join(', ')}`));
    if (!(p.cycleS >= 30 && p.cycleS <= 180)) issues.push(err('plant.cycle', 'Ciclo comune fuori intervallo 30–180 s'));
    for (const x of p.plans) {
      const pl = net.signalPlans[x.planId];
      if (!pl) continue;
      if (fixedTime(pl) > p.cycleS) issues.push(err('plant.short', `Ciclo comune troppo corto per ${pl.name}`));
      if (pl.plant && pl.plant.id !== p.plant.id) issues.push(warn('plant.moved', `${pl.name} lascia l'impianto ${pl.plant.name}`, [pl.id]));
      if (pl.coordination && pl.cycleS !== p.cycleS) issues.push(warn('plant.corridor', `Il corridoio ${pl.coordination.name} passa al ciclo ${p.cycleS} s: ricalcola l'onda verde`, [pl.id]));
    }
    return issues;
  },
  apply(net, p) {
    const signalPlans = { ...net.signalPlans };
    const ids = new Set(p.plans.map((x) => x.planId));
    // Members leaving another plant: a plant left with a single junction is dissolved.
    const left = new Set(p.plans.map((x) => signalPlans[x.planId]!.plant?.id).filter((x): x is string => !!x && x !== p.plant.id));
    for (const pid of left) {
      const rest = Object.values(signalPlans).filter((x) => x.plant?.id === pid && !ids.has(x.id));
      if (rest.length < 2) for (const x of rest) { const { plant: _p, ...r } = x; signalPlans[x.id] = r; }
    }
    p.plans.forEach((x, order) => {
      const pl = rescalePlan(signalPlans[x.planId]!, p.cycleS);
      const coordination = pl.coordination?.halfCycle ? { ...pl.coordination, halfCycle: false } : pl.coordination;
      signalPlans[x.planId] = {
        ...pl, coordination, offsetS: mod(Math.round(x.offsetS), pl.cycleS),
        plant: { id: p.plant.id, name: p.plant.name, order, speedKmh: p.plant.speedKmh ?? 30, direction: 'twoway', mode: 'plant', merged: true },
      };
    });
    syncCycles(signalPlans, [...ids], p.cycleS);
    return { ...net, signalPlans };
  },
});

/** Splits a merged plant back into independent junctions (timings unchanged). */
export const signalSplitPlant = defineOperation<{ readonly plantId: string }>({
  type: 'signal.splitPlant',
  label: () => 'Separa impianto unico',
  validate: (net, p) => (Object.values(net.signalPlans).some((x) => x.plant?.id === p.plantId) ? [] : [err('plant.missing', 'Impianto inesistente')]),
  apply(net, p) {
    const signalPlans = { ...net.signalPlans };
    for (const pl of Object.values(signalPlans)) {
      if (pl.plant?.id !== p.plantId) continue;
      const { plant: _p, ...rest } = pl;
      signalPlans[pl.id] = rest;
    }
    return { ...net, signalPlans };
  },
});

export const signalPlanRemove = defineOperation<{ readonly planId: string }>({
  type: 'signal.removePlan',
  label: () => 'Rimuovi piano semaforico',
  validate: (net, p) => (net.signalPlans[p.planId] ? [] : [err('signal.missing', 'Piano inesistente')]),
  apply(net, p) {
    const signalPlans = { ...net.signalPlans };
    delete signalPlans[p.planId];
    return { ...net, signalPlans };
  },
});

export const zoneSet = defineOperation<{ readonly zone: Zone }>({
  type: 'zone.set',
  label: (p) => `Zona ${p.zone.name}`,
  validate: (_n, p) => (p.zone.polygon.length >= 3 && p.zone.polygon.every(okLL) ? [] : [err('zone.polygon', 'Poligono non valido (minimo 3 vertici)')]),
  apply: (net, p) => ({ ...net, zones: { ...net.zones, [p.zone.id]: p.zone } }),
});

export const zoneRemove = defineOperation<{ readonly zoneId: string }>({
  type: 'zone.remove',
  label: () => 'Elimina zona',
  validate: (net, p) => (net.zones[p.zoneId] ? [] : [err('zone.missing', 'Zona inesistente')]),
  apply(net, p) {
    const zones = { ...net.zones };
    delete zones[p.zoneId];
    return { ...net, zones };
  },
});

// ---------------------------------------------------------------- roundabouts

/** Ring centre-line radius in direction `angle` (ellipse aware). */
function validateRoundabout(net: Network, rb: Roundabout, replacing = false): Issue[] {
  const issues: Issue[] = [];
  if (!replacing && net.roundabouts[rb.id]) issues.push(err('rb.duplicateId', `Id già in uso: ${rb.id}`));
  if (!replacing && rb.replacedNodeId && !net.nodes[rb.replacedNodeId]) issues.push(err('rb.node', 'Incrocio inesistente'));
  const D = rb.outerDiameterM;
  // DM 19/04/2006: mini 14–25 m, compatta 25–40 m, convenzionale > 40 m.
  const min = rb.type === 'mini' ? 14 : rb.type === 'compact' ? 25 : 40;
  const max = rb.type === 'mini' ? 25 : rb.type === 'compact' ? 40 : 70;
  if (D < min || D > max) issues.push(err('rb.diameter', `Diametro esterno ${D} m fuori intervallo per il tipo (${min}–${max} m, DM 19/04/2006)`));
  if (rb.circulatoryWidthM < 6 || rb.circulatoryWidthM > 12) issues.push(err('rb.width', 'Larghezza anello 6–12 m'));
  if (rb.circulatoryWidthM + rb.apronWidthM >= D / 2 - 0.5 && rb.type !== 'mini') issues.push(err('rb.island', 'Isola centrale troppo piccola per anello e fascia sormontabile'));
  const base = replacing ? extractRoundabout(net, rb.id) : net;
  const plan = planRoundabout(base, rb);
  if (plan.overlaps.length) issues.push(err('rb.overlap', "Si sovrappone a un'altra rotatoria"));
  // Arms that leave the ring and end almost at once cannot carry an entry: report, don't block.
  const stubby = plan.arms.filter((a) => lengthOf(a.outward) < 3);
  if (stubby.length) issues.push(warn('rb.short', `Bracci che finiscono a meno di 3 m dall'anello: ${[...new Set(stubby.map((a) => a.road.name || a.roadId))].join(', ')}`, stubby.map((a) => a.roadId)));
  return issues;
}

export const roundaboutAdd = defineOperation<{ readonly roundabout: Roundabout }>({
  type: 'roundabout.add',
  label: (p) => `Rotatoria ${p.roundabout.name}`,
  validate: (net, p) => validateRoundabout(net, p.roundabout),
  apply: (net, p) => insertRoundabout(net, p.roundabout),
});

export const roundaboutUpdate = defineOperation<{ readonly roundabout: Roundabout }>({
  type: 'roundabout.update',
  label: (p) => `Modifica rotatoria ${p.roundabout.name}`,
  validate(net, p) {
    if (!net.roundabouts[p.roundabout.id]) return [err('rb.missing', 'Rotatoria inesistente')];
    return validateRoundabout(net, p.roundabout, true);
  },
  apply: (net, p) => insertRoundabout(extractRoundabout(net, p.roundabout.id), p.roundabout),
});

export const roundaboutRemove = defineOperation<{ readonly roundaboutId: string }>({
  type: 'roundabout.remove',
  label: () => 'Elimina rotatoria',
  validate: (net, p) => (net.roundabouts[p.roundaboutId] ? [] : [err('rb.missing', 'Rotatoria inesistente')]),
  apply: (net, p) => extractRoundabout(net, p.roundaboutId),
});


// ---------------------------------------------------------------- areas

export const areaSet = defineOperation<{ readonly area: Area }>({
  type: 'area.set',
  label: (p) => `${p.area.name ?? p.area.kind}`,
  validate(_net, p) {
    const min = p.area.kind === 'crossing' ? 2 : 3;
    if (p.area.polygon.length < min || !p.area.polygon.every(okLL)) return [err('area.polygon', `Geometria non valida (minimo ${min} vertici)`)];
    if (p.area.kind === 'crossing' && !(p.area.depthM && p.area.depthM >= 2 && p.area.depthM <= 8)) return [err('area.depth', 'Profondità attraversamento 2–8 m')];
    return [];
  },
  apply: (net, p) => ({ ...net, areas: { ...net.areas, [p.area.id]: p.area } }),
});

export const areaRemove = defineOperation<{ readonly areaIds: readonly string[] }>({
  type: 'area.remove',
  label: (p) => (p.areaIds.length === 1 ? 'Elimina superficie' : `Elimina ${p.areaIds.length} superfici`),
  validate(net, p) {
    const missing = p.areaIds.filter((id) => !net.areas[id]);
    return missing.length ? [err('area.missing', `Superfici inesistenti: ${missing.join(', ')}`)] : [];
  },
  apply(net, p) {
    const areas = { ...net.areas };
    for (const id of p.areaIds) {
      const a = areas[id]!;
      if (a.state === 'existing') areas[id] = { ...a, state: 'removed' };
      else delete areas[id];
    }
    return { ...net, areas };
  },
});

// ---------------------------------------------------------------- batch

/** Several operations committed as one undoable step (compound tools, array placement, previews). */
export const batch = defineOperation<{ readonly label: string; readonly ops: readonly { readonly type: string; readonly payload: unknown }[] }>({
  type: 'batch',
  label: (p) => p.label,
  validate(net, p) {
    if (!p.ops.length) return [err('batch.empty', 'Nessuna operazione')];
    let cur = net;
    const issues: Issue[] = [];
    for (const o of p.ops) {
      if (o.type === 'batch') return [err('batch.nested', 'Batch annidati non ammessi')];
      const spec = operationSpec(o.type);
      const found = spec.validate(cur, o.payload);
      issues.push(...found);
      if (found.some((i) => i.severity === 'error')) return issues;
      cur = spec.apply(cur, o.payload);
    }
    return issues;
  },
  apply(net, p) {
    let cur = net;
    for (const o of p.ops) cur = operationSpec(o.type).apply(cur, o.payload);
    return cur;
  },
});
