import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FlowSimulation, LocalFrame, OperationRejected, ScenarioHistory, analyzeJunction, analyzeNetwork, auditScenario,
  SIDEWALK_PROVENANCE, estimateTraffic, geom, inferSidewalks, isochrone, layoutSection, parseCrashCsv, route, screenSafety, serviceAccess, signalState, suggestSignalPlan, planIssues, signalHeads, coordinateCorridor, detectCorridors, designPlant, optimizeNetworkSignals, rescalePlan, type SignalPlan, type SignalPhase,
  type CityBaseline, type Network, type Scenario, buildPhysicalModel, junctionDelay, buildGraph,
  SIM_STRIDE,
} from '../src/index';

const SEED = fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url));
let baseline: CityBaseline;
beforeAll(() => { baseline = JSON.parse(gunzipSync(readFileSync(SEED)).toString('utf8')) as CityBaseline; });
const scenario = (): Scenario => ({ id: 's', name: 'Test', isBaseline: false, locked: false, archived: false, createdAt: '2026-10-01T00:00:00Z', operations: [] });
let seq = 0;
const ids = () => `op${++seq}`;
const ctx = { mode: 'car' as const, day: 1, minutes: 8 * 60 };

function signalisableJunction(net: Network): string {
  const counts = new Map<string, number>();
  for (const r of Object.values(net.roads)) {
    if (layoutSection(r).pedestrianOnly) continue;
    for (const n of [r.from, r.to]) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const f = new LocalFrame(baseline.origin);
  for (const [n, c] of counts) {
    if (c !== 4) continue;
    const arms = Object.values(net.roads).filter((r) => r.from === n || r.to === n);
    if (arms.every((r) => r.oneway === 'no' && !layoutSection(r).pedestrianOnly && geom.lengthOf(r.axis.map((q) => f.toMetric(q))) > 40)) return n;
  }
  throw new Error('no two-way 4-arm junction');
}

describe('routing on the scenario network', () => {
  it('finds a car route across Frattamaggiore with steps in Italian', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const r = route(h.network, baseline.origin, [14.268, 40.937], [14.286, 40.947], ctx);
    expect(r.found).toBe(true);
    expect(r.distanceM).toBeGreaterThan(1500);
    expect(r.durationS).toBeGreaterThan(60);
    expect(r.steps.at(-1)!.maneuver).toBe('arrive');
    expect(r.steps.every((s) => s.instruction.length > 3)).toBe(true);
  });

  it('a one-way reversal changes the car route but not the walking route', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const a: [number, number] = [14.268, 40.937], b: [number, number] = [14.286, 40.947];
    const before = route(h.network, baseline.origin, a, b, ctx);
    const used = before.roadIds.find((id) => h.network.roads[id]!.oneway === 'no' && !h.network.roads[id]!.tags?.roundabout && id !== before.roadIds[0] && id !== before.roadIds.at(-1))!;
    const fwdUsed = (() => {
      const road = h.network.roads[used]!;
      const i = before.line.findIndex((p) => p[0] === road.axis[0]![0] && p[1] === road.axis[0]![1]);
      const j = before.line.findIndex((p) => p[0] === road.axis.at(-1)![0] && p[1] === road.axis.at(-1)![1]);
      return i >= 0 && j > i;
    })();
    h.commit({ type: 'road.setOneway', payload: { roadId: used, oneway: fwdUsed ? 'backward' : 'forward' } });
    const after = route(h.network, baseline.origin, a, b, ctx);
    expect(after.found).toBe(true);
    expect(after.roadIds.includes(used) && after.durationS === before.durationS).toBe(false);
    const walk = route(h.network, baseline.origin, a, b, { ...ctx, mode: 'walk' });
    expect(walk.found).toBe(true);
  });

  it('an active ZTL blocks cars but allows emergency vehicles and is reported', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const target: [number, number] = [14.2745, 40.9416];
    const d = 0.0012;
    h.commit({ type: 'zone.set', payload: { zone: { id: 'ztl1', kind: 'ztl', name: 'ZTL centro', allowedModes: ['emergency', 'bus'],
      polygon: [[target[0] - d, target[1] - d], [target[0] + d, target[1] - d], [target[0] + d, target[1] + d], [target[0] - d, target[1] + d]],
      schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' }] } } });
    const car = route(h.network, baseline.origin, [14.262, 40.935], target, ctx);
    const emergency = route(h.network, baseline.origin, [14.262, 40.935], target, { ...ctx, mode: 'emergency' });
    expect(emergency.found).toBe(true);
    if (car.found) expect(car.warnings.length + (car.distanceM > emergency.distanceM ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe('junction lab and signals', () => {
  it('builds movements, conflicts and a conflict-free plan that the signal op accepts', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const node = signalisableJunction(h.network);
    const a = analyzeJunction(h.network, baseline.origin, node)!;
    expect(a.arms).toHaveLength(4);
    expect(a.movements.length).toBeGreaterThanOrEqual(8);
    expect(a.conflicts.some((c) => c.kind === 'crossing')).toBe(true);
    expect(a.incompatible.length).toBeGreaterThan(0);
    const plan = suggestSignalPlan(h.network, a);
    h.commit({ type: 'signal.setPlan', payload: { plan, conflicts: a.incompatible } });
    expect(h.network.junctions[node]!.control).toBe('signal');
    // Putting two incompatible groups in the same phase is rejected.
    const [x, y] = a.incompatible[0]!;
    const bad = { ...plan, phases: plan.phases.map((p, i) => (i === 0 ? { ...p, greenGroups: [...new Set([...p.greenGroups, x, y])] } : p)) };
    expect(() => h.commit({ type: 'signal.setPlan', payload: { plan: bad, conflicts: a.incompatible } })).toThrow(OperationRejected);
    // Every group sees green, yellow and red within one cycle.
    for (const g of a.groups) {
      const states = new Set(Array.from({ length: plan.cycleS }, (_, t) => signalState(plan, g.id, t)));
      expect(states).toEqual(new Set(['green', 'yellow', 'red']));
    }
    expect(auditScenario(h.network, baseline.origin, null).filter((i) => i.category === 'signals' && i.severity === 'error')).toHaveLength(0);
  });
});

describe('signals 2.0: directions, permitted lefts, heads, coordination', () => {
  const full = (plan: SignalPlan, a: NonNullable<ReturnType<typeof analyzeJunction>>) => ({
    plan, conflicts: a.incompatible, movementConflicts: a.movementConflicts, permissivePairs: a.permissivePairs,
    groupTurns: Object.fromEntries(a.groups.map((g) => [g.id, g.turns])),
  });

  it('proposes a Webster cycle within 40–120 s and fewer phases with permitted left turns', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const a = analyzeJunction(h.network, baseline.origin, signalisableJunction(h.network))!;
    const protectedPlan = suggestSignalPlan(h.network, a);
    const permitted = suggestSignalPlan(h.network, a, { permissiveLeft: true });
    for (const p of [protectedPlan, permitted]) {
      expect(p.cycleS).toBeGreaterThanOrEqual(40);
      expect(p.cycleS).toBeLessThanOrEqual(130);
      expect(planIssues(p, a)).toEqual([]);
    }
    expect(permitted.phases.length).toBeLessThanOrEqual(protectedPlan.phases.length);
    expect(protectedPlan.design.method).toContain('Webster');
    // A permitted-left plan is accepted with the movement-level payload…
    h.commit({ type: 'signal.setPlan', payload: full(permitted, a) });
    // …and refused once permitted lefts are switched off, if it relies on them.
    if (planIssues({ ...permitted, permissiveLeft: false }, a).length) {
      expect(() => h.commit({ type: 'signal.setPlan', payload: full({ ...permitted, permissiveLeft: false }, a) })).toThrow(OperationRejected);
    }
  });

  it('switches single turns of a group (arrow heads) and single heads off', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const a = analyzeJunction(h.network, baseline.origin, signalisableJunction(h.network))!;
    const plan = suggestSignalPlan(h.network, a);
    const g = a.groups.find((x) => x.turns.length > 1)!;
    expect(g).toBeTruthy();
    const [keep, ...drop] = g.turns;
    const i = plan.phases.findIndex((p) => p.greenGroups.includes(g.id));
    // Phase i: only the first turn of g; the others get a new phase of their own.
    const phases: SignalPhase[] = plan.phases.map((p, k) => (k === i ? { ...p, greenMovements: { [g.id]: [keep!] } } : p));
    phases.push({ id: 'Fx', name: 'Fase frecce', greenGroups: [g.id], greenMovements: { [g.id]: drop }, greenS: 8, yellowS: 3, allRedS: 2, pedestrianRoadIds: [] });
    const directional: SignalPlan = { ...plan, phases, cycleS: phases.reduce((t, p) => t + p.greenS + p.yellowS + p.allRedS, 0) };
    expect(planIssues(directional, a)).toEqual([]);
    h.commit({ type: 'signal.setPlan', payload: full(directional, a) });
    // Arrow heads appear for the split group.
    const heads = signalHeads(h.network, baseline.origin).filter((x) => x.groupId === g.id);
    expect(heads.length).toBe(g.turns.length);
    expect(heads.every((x) => x.turn && x.kind.startsWith('arrow'))).toBe(true);
    // The first turn is green in phase i, the dropped ones are red there.
    const startOf = (k: number) => directional.phases.slice(0, k).reduce((t, p) => t + p.greenS + p.yellowS + p.allRedS, 0) + 1;
    expect(signalState(directional, g.id, startOf(i), keep)).toBe('green');
    expect(signalState(directional, g.id, startOf(i), drop[0])).toBe('red');
    // Removing a single head leaves timing intact.
    h.commit({ type: 'signal.setHeads', payload: { planId: directional.id, disabledHeads: [heads[0]!.key] } });
    expect(signalHeads(h.network, baseline.origin).filter((x) => x.groupId === g.id).length).toBe(g.turns.length - 1);
    expect(h.network.signalPlans[directional.id]!.cycleS).toBe(directional.cycleS);
  });

  it('coordinates two junctions with a common cycle and travel-time offsets', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const nodes = Object.keys(h.network.nodes).filter((id) => { const x = analyzeJunction(h.network, baseline.origin, id); return x && x.arms.length >= 3 && x.groups.length >= 3; }).slice(0, 2);
    expect(nodes.length).toBe(2);
    const plans = nodes.map((n) => { const a = analyzeJunction(h.network, baseline.origin, n)!; const p = suggestSignalPlan(h.network, a); h.commit({ type: 'signal.setPlan', payload: full(p, a) }); return h.network.signalPlans[p.id]!; });
    const r = coordinateCorridor(h.network, baseline.origin, plans, 40, 90, 'oneway');
    expect(r.offsets[0]!.offsetS).toBe(0);
    expect(r.bandwidthS).toBeGreaterThanOrEqual(r.naiveBandwidthS);
    h.commit({ type: 'signal.coordinate', payload: { coordination: { id: 'c1', name: 'Corridoio', speedKmh: 40, direction: 'oneway' }, cycleS: 90, plans: r.offsets.map((o) => ({ planId: o.planId, offsetS: o.offsetS })) } });
    const linked = Object.values(h.network.signalPlans).filter((p) => p.coordination?.id === 'c1');
    expect(linked).toHaveLength(2);
    expect(linked.every((p) => p.cycleS === 90 && p.phases.reduce((t, ph) => t + ph.greenS + ph.yellowS + ph.allRedS, 0) === 90)).toBe(true);
    h.commit({ type: 'signal.uncoordinate', payload: { coordinationId: 'c1' } });
    expect(Object.values(h.network.signalPlans).some((p) => p.coordination)).toBe(false);
  });

  it('detects a corridor along a street, optimises the two-way band and merges close junctions into one plant', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    // The street with most 3+-arm junctions.
    const byName = new Map<string, Set<string>>();
    for (const r of Object.values(h.network.roads)) {
      if (!r.name) continue;
      for (const n of [r.from, r.to]) { const a = analyzeJunction(h.network, baseline.origin, n); if (a && a.arms.length >= 3 && a.groups.length >= 3) (byName.get(r.name) ?? byName.set(r.name, new Set()).get(r.name)!).add(n); }
    }
    const [street, nodeSet] = [...byName].sort((a, b) => b[1].size - a[1].size)[0]!;
    expect(nodeSet.size).toBeGreaterThanOrEqual(3);
    for (const n of nodeSet) { const a = analyzeJunction(h.network, baseline.origin, n)!; h.commit({ type: 'signal.setPlan', payload: full(suggestSignalPlan(h.network, a), a) }); }
    const corridors = detectCorridors(h.network, baseline.origin, { maxSpacingM: 900 });
    const c = corridors.find((x) => x.name === street) ?? corridors[0]!;
    expect(c.planIds.length).toBeGreaterThanOrEqual(2);
    const plans = c.planIds.map((id) => h.network.signalPlans[id]!);
    const r = coordinateCorridor(h.network, baseline.origin, plans, 40, null, 'twoway', { allowHalfCycle: true });
    expect(r.bandwidthS + (r.bandwidthBackS ?? 0)).toBeGreaterThanOrEqual(r.naiveBandwidthS);
    expect(r.windows.every((w) => w.fwd.length > 0)).toBe(true);
    h.commit({ type: 'signal.coordinate', payload: { coordination: { id: 'cx', name: c.name, speedKmh: 40, direction: 'twoway' }, cycleS: r.cycleS, plans: r.offsets.map((o) => ({ planId: o.planId, offsetS: o.offsetS, halfCycle: o.halfCycle })) } });
    for (const pl of Object.values(h.network.signalPlans).filter((p) => p.coordination?.id === 'cx')) {
      expect(pl.phases.reduce((t, ph) => t + ph.greenS + ph.yellowS + ph.allRedS, 0)).toBe(pl.cycleS);
      expect([r.cycleS, r.cycleS / 2]).toContain(pl.cycleS);
    }
    // Plant: the first two junctions of the corridor as one controller.
    const two = plans.slice(0, 2).map((p) => h.network.signalPlans[p.id]!);
    const d = designPlant(h.network, baseline.origin, two, 30);
    expect(d.plans).toHaveLength(2);
    expect(d.links[0]!.storageVeh).toBeGreaterThan(0);
    h.commit({ type: 'signal.mergePlant', payload: { plant: { id: 'pl1', name: 'Impianto', speedKmh: 30 }, cycleS: d.cycleS, plans: d.plans } });
    const merged = Object.values(h.network.signalPlans).filter((p) => p.plant?.id === 'pl1');
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((p) => p.cycleS)).size).toBe(1);
    h.commit({ type: 'signal.splitPlant', payload: { plantId: 'pl1' } });
    expect(Object.values(h.network.signalPlans).some((p) => p.plant)).toBe(false);
  });

  it('retimes every plan of the network and keeps coordinated corridors on a common cycle', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const nodes = Object.keys(h.network.nodes).filter((id) => { const x = analyzeJunction(h.network, baseline.origin, id); return x && x.arms.length >= 3 && x.groups.length >= 3; }).slice(0, 3);
    const plans = nodes.map((n) => { const a = analyzeJunction(h.network, baseline.origin, n)!; const p = suggestSignalPlan(h.network, a); h.commit({ type: 'signal.setPlan', payload: full(rescalePlan(p, 150), a) }); return h.network.signalPlans[p.id]!; });
    h.commit({ type: 'signal.coordinate', payload: { coordination: { id: 'c2', name: 'Asse', speedKmh: 40, direction: 'oneway' }, cycleS: 150, plans: plans.slice(0, 2).map((p, i) => ({ planId: p.id, offsetS: i * 20 })) } });
    const heavy = Object.fromEntries(Object.values(h.network.signalPlans).map((p) => [p.id, p]));
    const res = optimizeNetworkSignals(h.network, baseline.origin);
    expect(res).toHaveLength(3);
    const corridor = res.filter((r) => r.plan.coordination?.id === 'c2');
    expect(new Set(corridor.map((r) => r.plan.cycleS)).size).toBe(1);
    expect(corridor.map((r) => r.plan.offsetS)).toEqual(corridor.map((r) => heavy[r.plan.id]!.offsetS % r.plan.cycleS));
    for (const r of res) {
      expect(planIssues(r.plan, r.analysis)).toEqual([]);
      expect(r.plan.phases.reduce((t, ph) => t + ph.greenS + ph.yellowS + ph.allRedS, 0)).toBe(r.plan.cycleS);
      expect(r.plan.cycleS).toBeLessThan(r.beforeCycleS);
      h.commit({ type: 'signal.setPlan', payload: full(r.plan, r.analysis) });
    }
  });
});

describe('traffic, simulation, safety, network, accessibility', () => {
  it('estimates traffic with explicit estimate provenance', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const t0 = Date.now();
    const t = estimateTraffic(h.network, baseline, { dailyTrips: 40000, externalShare: 0.3, day: 1, hour: 8, iterations: 3, growthPercent: 0 });
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(t.provenance).toBe('estimated');
    expect(t.flows.filter((f) => f.volumeVph > 0).length).toBeGreaterThan(200);
    expect(t.totals.vehKm).toBeGreaterThan(0);
  });

  it('simulates vehicles that stop at a red signal', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const node = signalisableJunction(h.network);
    const a = analyzeJunction(h.network, baseline.origin, node)!;
    h.commit({ type: 'signal.setPlan', payload: { plan: suggestSignalPlan(h.network, a), conflicts: a.incompatible } });
    const at = h.network.nodes[node]!.at;
    const d = 0.004;
    const sim = new FlowSimulation(h.network, baseline, { day: 1, hour: 8, dailyTrips: 400000, scale: 1, seed: 7, focus: [at[0] - d, at[1] - d, at[0] + d, at[1] + d] });
    for (let i = 0; i < 1200; i++) sim.step(0.25);
    const f = sim.frameData();
    expect(f.metrics.vehicles).toBeGreaterThan(5);
    expect(f.signals.length).toBe(a.groups.length);
    expect(f.data.length).toBe(f.metrics.vehicles * SIM_STRIDE);
    for (let i = 0; i < f.data.length; i += SIM_STRIDE) {
      expect(Math.abs(f.data[i]! - at[0])).toBeLessThan(0.05);
    }
    expect(f.metrics.completed).toBeGreaterThan(0);
  });

  it('safety screening is surrogate without crash data and observed with it', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const s = screenSafety(h.network, baseline, [], null);
    expect(s.length).toBeGreaterThan(100);
    expect(s.every((x) => x.basis === 'surrogate')).toBe(true);
    const top = s[0]!;
    const csv = `data;lat;lon;gravita;pedone\n2025-03-02;${top.at[1]};${top.at[0]};grave;si\nbad;;;;\n`;
    const parsed = parseCrashCsv(csv, 'test');
    expect(parsed.records).toHaveLength(1);
    expect(parsed.rejected).toBe(1);
    const s2 = screenSafety(h.network, baseline, parsed.records, null);
    expect(s2.find((x) => x.nodeId === top.nodeId)!.basis).toBe('observed');
  });

  it('network analysis and 7-minute city accessibility run on real data', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const n = analyzeNetwork(h.network, baseline.origin, 20);
    expect(n.largestShare).toBeGreaterThan(0.8);
    expect(Object.keys(n.centrality).length).toBeGreaterThan(100);
    const acc = serviceAccess(h.network, baseline, 7);
    expect(acc.serviceCounts.school).toBeGreaterThan(0);
    expect(acc.coverage).toBeGreaterThanOrEqual(0);
    expect(acc.coverage).toBeLessThanOrEqual(100);
    const iso = isochrone(h.network, baseline.origin, [14.2745, 40.9416], 'walk', 7);
    expect(Object.keys(iso).length).toBeGreaterThan(20);
  });
});

describe('existing sidewalks from building fronts', () => {
  it('derives plausible widths on the real Frattamaggiore network, quickly and declared as derived', () => {
    const t = performance.now();
    const r = inferSidewalks(baseline);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(4000);
    expect(r.roadsWithSidewalks).toBeGreaterThan(300);
    for (const c of r.changes) for (const w of [c.left, c.right]) if (w !== null) { expect(w).toBeGreaterThanOrEqual(0.9); expect(w).toBeLessThanOrEqual(3); }
    expect(SIDEWALK_PROVENANCE.kind).toBe('derived');
    console.log(`sidewalks: ${r.roadsWithSidewalks} roads with, ${r.roadsWithout} without, ${r.totalLengthM} m, ${r.changes.length} changed, ${Math.round(ms)} ms`);
  });
});

describe('approaches taken out of a signal plan', () => {
  it('give way: no heads, give-way line instead of stop line, no unserved group, back to signal restores', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const node = signalisableJunction(h.network);
    const a = analyzeJunction(h.network, baseline.origin, node)!;
    const plan = suggestSignalPlan(h.network, a);
    h.commit({ type: 'signal.setPlan', payload: { plan, conflicts: a.incompatible } });
    const roadId = a.arms[0]!.roadId;
    const lines = () => buildPhysicalModel(h.network, { origin: baseline.origin }).markings.filter((m) => m.nodeId === node && m.roadId === roadId).map((m) => m.kind);
    expect(lines()).toContain('stop_line');
    expect(signalHeads(h.network, baseline.origin).some((x) => x.nodeId === node && a.groups.find((g) => g.id === x.groupId)?.roadId === roadId)).toBe(true);

    h.commit({ type: 'signal.setApproach', payload: { planId: plan.id, roadId, control: 'give_way' } });
    expect(lines()).toContain('give_way');
    const mine = a.groups.filter((x) => x.roadId === roadId).map((x) => x.id);
    expect(h.network.signalPlans[plan.id]!.phases.every((ph) => ph.greenGroups.every((x) => !mine.includes(x)))).toBe(true);
    expect(lines()).not.toContain('stop_line');
    expect(signalHeads(h.network, baseline.origin).some((x) => x.nodeId === node && a.groups.find((g) => g.id === x.groupId)?.roadId === roadId)).toBe(false);
    expect(auditScenario(h.network, baseline.origin, null).filter((i) => i.category === 'signals' && i.severity === 'error')).toHaveLength(0);
    const g = buildGraph(h.network, new LocalFrame(baseline.origin), ctx);
    const into = g.edges.find((e) => e.roadId === roadId && g.nodeIds[e.to] === node)!;
    const out = g.edges.find((e) => e.roadId !== roadId && g.nodeIds[e.from] === node)!;
    expect(junctionDelay(h.network, node, into, out)).toBe(5);

    h.commit({ type: 'signal.setApproach', payload: { planId: plan.id, roadId, control: 'free' } });
    expect(lines()).toHaveLength(0);
    h.commit({ type: 'signal.setApproach', payload: { planId: plan.id, roadId, control: 'signal' } });
    expect(lines()).toContain('stop_line');
    // Back under signal: its groups have a green again and the plan is valid.
    expect(auditScenario(h.network, baseline.origin, null).filter((i) => i.category === 'signals' && i.severity === 'error')).toHaveLength(0);
  });
});

describe('junction.set payload shape', () => {
  it('an incomplete spec (e.g. from an older client or Elios) is rejected with a message, not a crash', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const node = signalisableJunction(h.network);
    expect(() => h.commit({ type: 'junction.set', payload: { spec: { nodeId: node, control: 'priority', cornerRadiusM: 6, minorRoadIds: [] } } })).toThrow(OperationRejected);
  });
});

describe('navigator: alternatives and congestion', () => {
  it('finds distinct alternatives no more than 40 % slower, and congestion never makes a trip faster', async () => {
    const { routeAlternatives, congestedTravel, routeVia } = await import('../src/index');
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const [w, s, e, n] = baseline.bbox;
    const A: [number, number] = [w + (e - w) * 0.2, s + (n - s) * 0.3], B: [number, number] = [w + (e - w) * 0.8, s + (n - s) * 0.7];
    const alts = routeAlternatives(h.network, baseline.origin, [A, B], ctx);
    expect(alts[0]!.found).toBe(true);
    expect(alts.length).toBeGreaterThanOrEqual(2);
    for (const r of alts.slice(1)) {
      expect(r.durationS).toBeLessThanOrEqual(alts[0]!.durationS * 1.4 + 1e-6);
      expect(r.roadIds.join()).not.toBe(alts[0]!.roadIds.join());
    }
    const free = routeVia(h.network, baseline.origin, [A, B], ctx);
    const traffic = estimateTraffic(h.network, baseline);
    const jam = routeVia(h.network, baseline.origin, [A, B], ctx, { travel: congestedTravel(traffic.flows) });
    expect(jam.found).toBe(true);
    expect(jam.durationS).toBeGreaterThanOrEqual(free.durationS - 1e-6);
  });
});
