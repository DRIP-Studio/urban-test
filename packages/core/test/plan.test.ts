import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DM1444_STANDARDS, LocalFrame, NetworkReplayer, PRINCIPAL, ScenarioHistory, buildingCompliance, checkFunctionalClasses, checkScenarioAgainstPlan, dm1444FromCode,
  effectiveFunctionalClasses, environmentalIslands, estimateResidents, generateConstraints, isVehicularRoad, islandZone, proposeFunctionalClasses, pumsIndicators,
  requiredStandards, roadFromTemplate, ROAD_TEMPLATES, urbanStandards,
  type CityBaseline, type LngLat, type Scenario, type UrbanPlanDoc,
} from '../src/index';

const SEED = fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url));
let baseline: CityBaseline;
beforeAll(() => { baseline = JSON.parse(gunzipSync(readFileSync(SEED)).toString('utf8')) as CityBaseline; });
const scenario = (): Scenario => ({ id: 's', name: 'Test', isBaseline: false, locked: false, archived: false, createdAt: '2026-10-01T00:00:00Z', operations: [] });
let seq = 0;
const ids = () => `op${++seq}`;

/** Rectangle of w × h metres centred at (x, y) metres from the origin. */
function rect(f: LocalFrame, x: number, y: number, w: number, h: number): LngLat[] {
  return [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map((p) => f.toLngLat(p as [number, number]));
}

function synthetic(): CityBaseline {
  const origin: LngLat = [14.28, 40.94];
  const f = new LocalFrame(origin);
  const prov = { kind: 'osm' as const, source: 'test' };
  return {
    id: 'syn', name: 'Sintetico', bbox: [14.27, 40.93, 14.29, 40.95], origin, nodes: {}, roads: {}, assets: {}, sources: [],
    // 50 × 20 m footprint, 10 m high: 10 000 m³ → 100 residents at 100 m³/ab.
    buildings: { b1: { id: 'b1', footprint: rect(f, 0, 0, 50, 20), heightM: 10, minHeightM: 0, provenance: prov } },
    features: {
      park: { id: 'park', kind: 'green', geometry: 'polygon', coords: rect(f, 200, 0, 30, 20), properties: { leisure: 'park' }, provenance: prov },
      pitch: { id: 'pitch', kind: 'leisure', geometry: 'polygon', coords: rect(f, 200, 0, 10, 10), properties: { leisure: 'pitch' }, provenance: prov },
      school: { id: 'school', kind: 'amenity', geometry: 'polygon', coords: rect(f, -200, 0, 20, 10), properties: { amenity: 'school' }, provenance: prov },
    },
  };
}

describe('Piano urbanistico: DM 1444/1968', () => {
  it('required standards are exact: 18 m²/ab split 4,5 / 2 / 9 / 2,5', () => {
    const r = requiredStandards(1000);
    expect(r).toEqual({ istruzione: 4500, interesse_comune: 2000, verde: 9000, parcheggi: 2500 });
    expect(Object.values(DM1444_STANDARDS).reduce((s, x) => s + x, 0)).toBe(18);
  });

  it('residents from volume and standard balance on a synthetic town', () => {
    const b = synthetic();
    const res = estimateResidents(b, null, 100);
    expect(res[0]!.residents).toBeCloseTo(100, 0);
    const out = urbanStandards(b, null, null, { residents: [{ ...res[0]!, residents: 100 }] });
    const row = (k: string) => out.town.rows.find((r) => r.kind === k)!;
    expect(out.town.residents).toBe(100);
    expect(row('istruzione').requiredM2).toBe(450);
    expect(row('verde').requiredM2).toBe(900);
    expect(row('parcheggi').requiredM2).toBe(250);
    expect(out.town.totalRequiredM2).toBe(1800);
    // The pitch inside the park is not counted twice.
    expect(row('verde').existingM2).toBeCloseTo(600, -1);
    expect(row('verde').balanceM2).toBeCloseTo(600 - 900, -1);
    expect(row('istruzione').existingM2).toBeCloseTo(200, -1);
  });

  it('zones double-count standards in A/B (art. 4), compliance and plan reservations', () => {
    const b = synthetic();
    const f = new LocalFrame(b.origin);
    const plan: UrbanPlanDoc = {
      zones: [
        { id: 'zb', code: 'B1', dm1444: 'B', name: 'Completamento', polygon: rect(f, 100, 0, 400, 100), rules: { maxCoverage: 1, maxHeight: 8 }, source: 't' },
        { id: 'zf', code: 'F1', dm1444: 'F', name: 'Verde', polygon: rect(f, -100, 200, 50, 40), rules: {}, standard: 'verde', source: 't' },
      ],
      constraints: [],
    };
    const res = estimateResidents(b, plan, 100);
    const out = urbanStandards(b, null, plan, { includePlanned: true, residents: res });
    const zb = out.zones.find((z) => z.zoneId === 'zb')!;
    expect(zb.residents).toBeCloseTo(100, 0);
    // Park (600 m²) inside zone B counts double; the F1 reservation (2000 m²) is outside zone B.
    expect(zb.rows.find((r) => r.kind === 'verde')!.computedM2).toBeCloseTo(1200, -1);
    expect(out.town.rows.find((r) => r.kind === 'verde')!.plannedM2).toBeCloseTo(2000, -1);
    const comp = buildingCompliance(b, plan).find((c) => c.zoneId === 'zb')!;
    expect(comp.buildings).toBe(1);
    expect(comp.heightOk).toBe(false);
    expect(comp.coverageOk).toBe(false);
    expect(dm1444FromCode('B2')).toBe('B');
    expect(dm1444FromCode('Zona F1 - verde')).toBe('F');
    expect(dm1444FromCode('ZTO_C3')).toBe('C');
    expect(dm1444FromCode('Residenziale')).toBeNull();
  });

  it('flags project roads inside constraints and generates setback bands', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const f = new LocalFrame(baseline.origin);
    const a = f.toLngLat([0, 0]), b2 = f.toLngLat([120, 0]);
    const t = ROAD_TEMPLATES.find((x) => x.id === 'local')!;
    h.commit({ type: 'road.add', payload: { road: roadFromTemplate(t, 'rnew', 'na', 'nb', [a, b2], 'Via Nuova'), nodes: [{ id: 'na', at: a }, { id: 'nb', at: b2 }] } });
    const plan: UrbanPlanDoc = { zones: [], constraints: [{ id: 'c1', type: 'paesaggistico', name: 'Parco', polygon: rect(f, 60, 0, 40, 40), source: 't' }] };
    const issues = checkScenarioAgainstPlan(h.network, baseline.origin, plan);
    expect(issues.some((i) => i.targetId === 'rnew' && i.constraintId === 'c1' && i.severity === 'warning')).toBe(true);
    const gen = generateConstraints(h.network, baseline, { where: 'outside' });
    expect(gen.some((c) => c.type === 'rispetto_stradale')).toBe(true);
    expect(gen.some((c) => c.type === 'cimiteriale')).toBe(true);
    expect(gen.some((c) => c.type === 'ferroviario')).toBe(true);
  });
});

describe('Piano del traffico: PGTU e PUMS', () => {
  it('classifies every vehicular road; the principal network is one connected skeleton', () => {
    const net = new NetworkReplayer().derive(baseline, []).net;
    const r = proposeFunctionalClasses(net, baseline, null);
    const veh = Object.values(net.roads).filter(isVehicularRoad);
    const byId = new Map(r.proposals.map((p) => [p.roadId, p.cls]));
    expect(veh.length).toBeGreaterThan(1500);
    expect(veh.every((x) => byId.has(x.id))).toBe(true);
    expect(r.principalComponents).toBe(1);
    // Independent connectivity check over the principal roads.
    const principal = r.proposals.filter((p) => PRINCIPAL.has(p.cls)).map((p) => net.roads[p.roadId]!);
    expect(principal.length).toBeGreaterThan(50);
    const adj = new Map<string, string[]>();
    for (const x of principal) { (adj.get(x.from) ?? adj.set(x.from, []).get(x.from)!).push(x.to); (adj.get(x.to) ?? adj.set(x.to, []).get(x.to)!).push(x.from); }
    const seen = new Set([principal[0]!.from]);
    const stack = [principal[0]!.from];
    while (stack.length) for (const n of adj.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    expect(principal.every((x) => seen.has(x.from) && seen.has(x.to))).toBe(true);
  });

  it('road.setFunctionalClass is validated, versioned and overrides the proposal', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const id = Object.values(h.network.roads).find((x) => x.roadClass === 'residential')!.id;
    h.commit({ type: 'road.setFunctionalClass', payload: { classes: { [id]: 'quartiere' } } });
    expect(h.network.roads[id]!.functionalClass).toBe('quartiere');
    expect(h.network.roads[id]!.provenance.functionalClass?.kind).toBe('project');
    expect(effectiveFunctionalClasses(h.network)[id]).toBe('quartiere');
    expect(() => h.commit({ type: 'road.setFunctionalClass', payload: { classes: { [id]: 'superstrada' } } })).toThrow();
    expect(() => h.commit({ type: 'road.setFunctionalClass', payload: { classes: { nope: 'locale' } } })).toThrow();
    h.undo();
    expect(h.network.roads[id]!.functionalClass).toBeUndefined();
    const issues = checkFunctionalClasses(h.network, { [id]: 'scorrimento' });
    expect(issues.length).toBeGreaterThan(0);
  });

  it('finds environmental islands larger than 1 ha and turns one into a Zona 30', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const cls = effectiveFunctionalClasses(h.network, proposeFunctionalClasses(h.network, baseline));
    const islands = environmentalIslands(h.network, baseline, cls);
    expect(islands.length).toBeGreaterThanOrEqual(1);
    expect(islands.some((i) => i.areaHa > 1)).toBe(true);
    const big = islands[0]!;
    expect(big.zonePolygon.length).toBeGreaterThanOrEqual(3);
    expect(big.internalRoadIds.length).toBeGreaterThan(0);
    h.commit({ type: 'zone.set', payload: { zone: islandZone(big, 'z30', 'zone30') } });
    expect(h.network.zones.z30!.speedKmh).toBe(30);
    const after = pumsIndicators({ net: h.network, baseline, classes: cls });
    const before = pumsIndicators({ net: new NetworkReplayer().derive(baseline, []).net, baseline, classes: cls });
    const v = (xs: typeof after, id: string) => xs.find((x) => x.id === id)!.value!;
    expect(v(after, 'zone30_pct')).toBeGreaterThan(v(before, 'zone30_pct'));
  });

  it('PUMS indicators are deterministic', () => {
    const net = new NetworkReplayer().derive(baseline, []).net;
    const stops: LngLat[] = [[14.2777, 40.9416], [14.27, 40.94]];
    const a = pumsIndicators({ net, baseline, transitStops: stops, bikeStations: [stops[0]!] });
    const b = pumsIndicators({ net, baseline, transitStops: stops, bikeStations: [stops[0]!] });
    expect(a).toEqual(b);
    const v = (id: string) => a.find((x) => x.id === id)!.value;
    expect(v('residents')).toBeGreaterThan(1000);
    expect(v('transit_300')).toBeGreaterThan(0);
    expect(v('transit_300')).toBeLessThan(100);
    expect(v('principal_km')).toBeGreaterThan(1);
    expect(v('avg_speed')).toBeNull();
  });
});
