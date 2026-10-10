import { describe, expect, it } from 'vitest';
import {
  LocalFrame, NetworkReplayer, ROAD_TEMPLATES, ScenarioHistory, buildPhysicalModel, connectorOps, danglingLinks, geom, linkOps, roadFromTemplate, route,
  designElevation, serviceAccess,type CityBaseline, type Operation, type Scenario,
} from '../src';

const origin: [number, number] = [14.27, 40.94];
const f = new LocalFrame(origin);
const LL = (x: number, y: number) => f.toLngLat([x, y]);
const tpl = ROAD_TEMPLATES.find((t) => t.id === 'neighbourhood')!;

function straightCity(): CityBaseline {
  const b: CityBaseline = { id: 'b', name: 'b', bbox: [14.26, 40.93, 14.28, 40.95], origin, nodes: { n0: { id: 'n0', at: LL(0, 0) }, n1: { id: 'n1', at: LL(200, 0) } }, roads: {}, buildings: {}, features: {}, assets: {}, sources: [] };
  (b as { roads: Record<string, unknown> }).roads.rA = roadFromTemplate(tpl, 'rA', 'n0', 'n1', [LL(0, 0), LL(200, 0)], 'A');
  return b;
}
const scenario = (): Scenario => ({ id: 's', name: 'S', isBaseline: false, locked: false, archived: false, createdAt: '2026-01-01', operations: [] });
let n = 0;
const ids = () => `x${++n}`;

describe('junction geometry when a road meets another a few metres from its end', () => {
  it('never produces self-intersecting surfaces', () => {
    const base = straightCity();
    for (const d of [0.9, 2, 4, 8, 20]) for (const ang of [90, 60, 45, 25]) {
      const a = (ang * Math.PI) / 180;
      const end = LL(d + 60 * Math.cos(a), 60 * Math.sin(a));
      const ops: Operation[] = [
        { id: 'o1', type: 'road.split', payload: { roadId: 'rA', at: LL(d, 0), nodeId: 'nx', newRoadIds: ['rA1', 'rA2'] }, author: 't', at: '' },
        { id: 'o2', type: 'road.add', payload: { road: roadFromTemplate(tpl, 'rB', 'nx', 'ny', [LL(d, 0), end], 'B'), nodes: [{ id: 'ny', at: end }] }, author: 't', at: '' },
      ];
      const r = new NetworkReplayer().derive(base, ops);
      expect(r.failed).toHaveLength(0);
      const m = buildPhysicalModel(r.net, { origin, features: {} });
      for (const s of m.surfaces) expect(geom.ringSelfIntersects(s.ring.map((q) => f.toMetric(q) as geom.V)), `${s.id} d=${d} ang=${ang}`).toBe(false);
    }
  });
});

describe('connecting roads drawn without snapping', () => {
  it('finds a loose end near a road, splits that road in place and joins only the loose end', () => {
    const h = new ScenarioHistory(straightCity(), scenario(), 't', ids);
    // A road that stops 4 m short of road A.
    const near = LL(80, 4), far = LL(80, 120);
    h.commit({ type: 'road.add', payload: { road: roadFromTemplate(tpl, 'rB', 'nb0', 'nb1', [far, near], 'B'), nodes: [{ id: 'nb0', at: far }, { id: 'nb1', at: near }] } });
    const before = route(h.network, origin, LL(5, -1), LL(80, 110), { mode: 'car', day: 1, minutes: 600 });
    expect(before.found).toBe(false);
    const links = danglingLinks(h.network, 10);
    const link = links.find((l) => l.nodeId === 'nb1')!;
    expect(link.kind).toBe('edge');
    expect(link.distM).toBeCloseTo(4, 0);
    const axisBefore = h.network.roads.rA!.axis;
    h.commit({ type: 'batch', payload: { label: 'Aggancia', ops: linkOps(link, { node: 'nj', roads: ['rA1', 'rA2'] }) } });
    // Road A keeps its geometry (split exactly on its axis), road B only moved its last vertex.
    const a1 = h.network.roads.rA1!, a2 = h.network.roads.rA2!;
    expect(a1.axis[0]).toEqual(axisBefore[0]);
    expect(a2.axis[a2.axis.length - 1]).toEqual(axisBefore[axisBefore.length - 1]);
    expect(Math.abs(f.toMetric(a1.axis[a1.axis.length - 1]!)[1])).toBeLessThan(0.01);
    expect(h.network.roads.rB!.to).toBe('nj');
    expect(h.network.roads.rB!.axis[0]).toEqual(far);
    expect(h.network.nodes.nb1).toBeUndefined();
    const after = route(h.network, origin, LL(5, -1), LL(80, 110), { mode: 'car', day: 1, minutes: 600 });
    expect(after.found).toBe(true);
    expect(danglingLinks(h.network, 10).some((l) => l.nodeId === 'nb1')).toBe(false);
  });

  it('merges a loose end onto a nearby junction', () => {
    const h = new ScenarioHistory(straightCity(), scenario(), 't', ids);
    const near = LL(203, 2), far = LL(260, 60);
    h.commit({ type: 'road.add', payload: { road: roadFromTemplate(tpl, 'rC', 'nc0', 'nc1', [far, near], 'C'), nodes: [{ id: 'nc0', at: far }, { id: 'nc1', at: near }] } });
    const link = danglingLinks(h.network, 10).find((l) => l.nodeId === 'nc1')!;
    expect(link.kind).toBe('node');
    expect(link.targetNodeId).toBe('n1');
    h.commit({ type: 'batch', payload: { label: 'Aggancia', ops: linkOps(link, { node: 'unused', roads: ['u1', 'u2'] }) } });
    expect(h.network.roads.rC!.to).toBe('n1');
    expect(h.network.roads.rC!.axis[h.network.roads.rC!.axis.length - 1]).toEqual(h.network.nodes.n1!.at);
  });

  it('connects with a connector road: no existing vertex moves', () => {
    const h = new ScenarioHistory(straightCity(), scenario(), 't', ids);
    const near = LL(80, 6), far = LL(80, 120);
    h.commit({ type: 'road.add', payload: { road: roadFromTemplate(tpl, 'rB', 'nb0', 'nb1', [far, near], 'B'), nodes: [{ id: 'nb0', at: far }, { id: 'nb1', at: near }] } });
    const axisB = h.network.roads.rB!.axis, axisA = h.network.roads.rA!.axis;
    const link = danglingLinks(h.network, 10).find((l) => l.nodeId === 'nb1')!;
    h.commit({ type: 'batch', payload: { label: 'Raccordo', ops: connectorOps(h.network, link, { node: 'nj', roads: ['rA1', 'rA2'], connector: 'rK' }) } });
    expect(h.network.roads.rB!.axis).toEqual(axisB);
    expect(h.network.nodes.nb1).toBeDefined();
    const k = h.network.roads.rK!;
    expect(k.from).toBe('nb1');
    expect(k.to).toBe('nj');
    expect(k.tags?.connector).toBe('yes');
    expect(h.network.roads.rA1!.axis[0]).toEqual(axisA[0]);
    const after = route(h.network, origin, LL(5, -1), LL(80, 110), { mode: 'car', day: 1, minutes: 600 });
    expect(after.found).toBe(true);
  });
});


it('reports each service coverage independently of earlier missing categories',()=>{
 const city=straightCity(),features={health:{id:'health',kind:'amenity',category:'pharmacy',geometry:'point',properties:{},provenance:{kind:'project',source:'Test fixture'},coords:[LL(100,0)]}} as CityBaseline['features'];
 const base={...city,features},net=new NetworkReplayer().derive(base,[]).net,result=serviceAccess(net,base,7,'walk');
 expect(result.categoryCoverage.school).toBe(0);expect(result.categoryCoverage.health).toBe(100);expect(result.coverage).toBe(0);
});

it('native split preserves a vertical curve across undo and redo',()=>{
 const b=straightCity(),h=new ScenarioHistory(b,scenario(),'t',ids);
 const vertical={pvis:[{station:0,elevation:10},{station:100,elevation:15,curveLength:80},{station:200,elevation:10}]};
 expect(h.commit({type:'road.setVertical',payload:{roadId:'rA',vertical}}).op.type).toBe('road.setVertical');
 const road=h.network.roads.rA!;
 expect(h.commit({type:'road.split',payload:{roadId:'rA',at:LL(88,0),nodeId:'cut',newRoadIds:['left','right']}}).op.type).toBe('road.split');
 for(let station=0;station<=200;station+=.5){const r=station<=88?h.network.roads.left!:h.network.roads.right!;expect(designElevation(r.vertical!,station<=88?station:station-88)).toBeCloseTo(designElevation(vertical,station),7);}
 expect(h.network.roads.rA).toBeUndefined();h.undo();expect(h.network.roads.rA!.vertical).toEqual(road.vertical);h.redo();expect(h.network.roads.left!.vertical).toBeDefined();
});
