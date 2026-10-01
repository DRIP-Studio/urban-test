import { LocalFrame } from '../geo/projection';
import { add, dist, lengthOf, mul, project, slice, sub, type V } from '../geo/polyline';
import type {
  Area, JunctionSpec, LngLat, Network, Oneway, Road, RoadNode, Roundabout, SignalPlan, Zone,
} from '../model/types';
import { defineOperation, operationSpec, type Issue } from './registry';
import { makeLanes } from './road-factory';

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

export const signalPlanSet = defineOperation<{ readonly plan: SignalPlan; readonly conflicts: readonly (readonly [string, string])[] }>({
  type: 'signal.setPlan',
  label: (p) => `Piano semaforico ${p.plan.name}`,
  validate(net, p) {
    const issues: Issue[] = [];
    const total = p.plan.phases.reduce((s, ph) => s + ph.greenS + ph.yellowS + ph.allRedS, 0);
    if (!net.nodes[p.plan.nodeId]) issues.push(err('signal.node', 'Incrocio inesistente'));
    if (!p.plan.phases.length) issues.push(err('signal.phases', 'Il piano deve avere almeno una fase'));
    if (Math.abs(total - p.plan.cycleS) > 0.5) issues.push(err('signal.cycle', `La somma delle fasi (${total.toFixed(0)} s) deve essere uguale al ciclo (${p.plan.cycleS} s)`));
    for (const ph of p.plan.phases) {
      if (ph.yellowS < 3) issues.push(err('signal.yellow', `Fase ${ph.name}: giallo minimo 3 s`));
      if (ph.greenS < 5) issues.push(err('signal.green', `Fase ${ph.name}: verde minimo 5 s`));
      for (const [a, b] of p.conflicts) {
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
function centreRadius(rb: Roundabout, angle: number): number {
  const a = rb.outerDiameterM / 2 - rb.circulatoryWidthM / 2;
  const b = rb.type === 'elliptical' ? (rb.outerDiameterM / 2) * Math.min(1, Math.max(0.5, rb.aspect)) - rb.circulatoryWidthM / 2 : a;
  const rot = ((90 - rb.orientationDeg) * Math.PI) / 180;
  const t = angle - rot;
  return (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t));
}

export function insertRoundabout(net: Network, rb: Roundabout): Network {
  const f = new LocalFrame(rb.center);
  const nodeId = rb.replacedNodeId!;
  const ends = Object.values(net.roads).filter((r) => r.from === nodeId || r.to === nodeId);
  const arms = ends.map((r) => {
    const atStart = r.from === nodeId;
    const pts = (atStart ? r.axis : [...r.axis].reverse()).map((q) => f.toMetric(q) as V);
    // First point at the ring centre line along the arm.
    let k = 1;
    let ring: V = pts[pts.length - 1]!;
    let angle = 0;
    for (; k < pts.length; k++) {
      const q = pts[k]!;
      angle = Math.atan2(q[1], q[0]);
      const R = centreRadius(rb, angle);
      if (Math.hypot(q[0], q[1]) >= R) {
        const p0 = pts[k - 1]!;
        const d0 = Math.hypot(p0[0], p0[1]), d1 = Math.hypot(q[0], q[1]);
        const t = (R - d0) / Math.max(1e-6, d1 - d0);
        ring = add(p0, mul(sub(q, p0), Math.max(0, Math.min(1, t))));
        break;
      }
    }
    angle = Math.atan2(ring[1], ring[0]);
    return { road: r, atStart, rest: pts.slice(k), ring, angle };
  }).sort((a, b) => a.angle - b.angle);

  const roads = { ...net.roads };
  const nodes = { ...net.nodes };
  delete nodes[nodeId];
  arms.forEach((arm, i) => {
    const nid = `${rb.id}:n${i}`;
    nodes[nid] = { id: nid, at: f.toLngLat(arm.ring) };
    const outward = [arm.ring, ...arm.rest].map((q) => f.toLngLat(q));
    const axis = arm.atStart ? outward : [...outward].reverse();
    axis[arm.atStart ? 0 : axis.length - 1] = nodes[nid]!.at;
    roads[arm.road.id] = markProject({ ...arm.road, axis, ...(arm.atStart ? { from: nid } : { to: nid }) }, 'geometry');
  });
  const laneW = rb.circulatoryWidthM / rb.lanes;
  arms.forEach((arm, i) => {
    const next = arms[(i + 1) % arms.length]!;
    let a1 = next.angle;
    while (a1 <= arm.angle) a1 += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil((a1 - arm.angle) / (Math.PI / 36)));
    const axis: LngLat[] = [];
    for (let s = 0; s <= steps; s++) {
      const a = arm.angle + ((a1 - arm.angle) * s) / steps;
      const R = centreRadius(rb, a);
      axis.push(f.toLngLat([R * Math.cos(a), R * Math.sin(a)]));
    }
    const from = `${rb.id}:n${i}`, to = `${rb.id}:n${(i + 1) % arms.length}`;
    axis[0] = nodes[from]!.at;
    axis[axis.length - 1] = nodes[to]!.at;
    const id = `${rb.id}:ring${i}`;
    const lanes = makeLanes(id, rb.lanes, laneW, 'forward', ['car', 'bus', 'truck', 'bike', 'emergency']);
    roads[id] = {
      id, from, to, name: rb.name, roadClass: 'roundabout', axis, oneway: 'forward', speedKmh: rb.speedKmh,
      lanes, section: { elements: lanes.map((l) => ({ id: `${l.id}:e`, kind: 'lane' as const, widthM: l.widthM, laneId: l.id })).reverse() },
      provenance: { geometry: PROJECT, width: PROJECT }, tags: { roundabout: rb.id },
    };
  });
  const armSpecs = arms.map((a) => rb.arms.find((s) => s.roadId === a.road.id) ?? {
    roadId: a.road.id, entryRadiusM: Math.max(6, rb.outerDiameterM * 0.35), exitRadiusM: Math.max(8, rb.outerDiameterM * 0.45),
    splitter: rb.type !== 'mini' && rb.outerDiameterM >= 26, splitterLengthM: 10, splitterWidthM: 1.5, crossing: false,
  });
  const junctions = { ...net.junctions };
  delete junctions[nodeId];
  return { ...net, roads, nodes, junctions, roundabouts: { ...net.roundabouts, [rb.id]: { ...rb, arms: armSpecs } } };
}

export function extractRoundabout(net: Network, rbId: string): Network {
  const rb = net.roundabouts[rbId]!;
  const nodeId = rb.replacedNodeId ?? `${rb.id}:centre`;
  const roads = { ...net.roads };
  const nodes = { ...net.nodes, [nodeId]: { id: nodeId, at: rb.center } };
  for (const r of Object.values(net.roads)) {
    if (r.tags?.roundabout === rbId) { delete roads[r.id]; continue; }
    const fromRing = r.from.startsWith(`${rbId}:n`), toRing = r.to.startsWith(`${rbId}:n`);
    if (!fromRing && !toRing) continue;
    let axis = [...r.axis];
    if (fromRing) axis = [rb.center, ...axis];
    if (toRing) axis = [...axis, rb.center];
    roads[r.id] = { ...r, axis, ...(fromRing ? { from: nodeId } : {}), ...(toRing ? { to: nodeId } : {}) };
  }
  for (const id of Object.keys(nodes)) if (id.startsWith(`${rbId}:n`)) delete nodes[id];
  const roundabouts = { ...net.roundabouts };
  delete roundabouts[rbId];
  return { ...net, roads, nodes, roundabouts };
}

function validateRoundabout(net: Network, rb: Roundabout, replacing = false): Issue[] {
  const issues: Issue[] = [];
  if (!replacing && net.roundabouts[rb.id]) issues.push(err('rb.duplicateId', `Id già in uso: ${rb.id}`));
  if (!rb.replacedNodeId || (!replacing && !net.nodes[rb.replacedNodeId])) issues.push(err('rb.node', 'La rotatoria si inserisce su un incrocio esistente'));
  const D = rb.outerDiameterM;
  // DM 19/04/2006: mini 14–25 m, compatta 25–40 m, convenzionale > 40 m.
  const min = rb.type === 'mini' ? 14 : rb.type === 'compact' ? 25 : 40;
  const max = rb.type === 'mini' ? 25 : rb.type === 'compact' ? 40 : 70;
  if (D < min || D > max) issues.push(err('rb.diameter', `Diametro esterno ${D} m fuori intervallo per il tipo (${min}–${max} m, DM 19/04/2006)`));
  if (rb.circulatoryWidthM < 6 || rb.circulatoryWidthM > 12) issues.push(err('rb.width', 'Larghezza anello 6–12 m'));
  if (rb.circulatoryWidthM + rb.apronWidthM >= D / 2 - 0.5 && rb.type !== 'mini') issues.push(err('rb.island', 'Isola centrale troppo piccola per anello e fascia sormontabile'));
  if (!replacing && rb.replacedNodeId) {
    const arms = Object.values(net.roads).filter((r) => r.from === rb.replacedNodeId || r.to === rb.replacedNodeId);
    if (arms.length < 3) issues.push(err('rb.arms', 'Servono almeno 3 bracci'));
    const short = arms.filter((r) => lengthOf(r.axis.map((q) => new LocalFrame(rb.center).toMetric(q) as V)) < D / 2 + 3);
    if (short.length) issues.push(err('rb.short', `Bracci troppo corti per il diametro scelto: ${short.map((r) => r.name || r.id).join(', ')}`, short.map((r) => r.id)));
  }
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
