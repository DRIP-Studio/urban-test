import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { LocalFrame, NetworkReplayer, analyzeJunction, buildGraph, type CityBaseline, type GraphEdge, type RoadGraph } from '../src/index';
import { turnAllowed, turnRouteTree } from '../src/analysis/turn-routing';
it('retains a slower legal arrival when the cheapest junction arrival cannot turn',()=>{
  const edge=(id:number,from:number,to:number,costS:number):GraphEdge=>({id,from,to,costS,roadId:`r${id}`,forward:true,lengthM:10,speedKmh:30,capacityVph:800});
  const edges=[edge(0,0,1,0),edge(1,1,3,1),edge(2,0,2,2),edge(3,2,3,1),edge(4,3,4,1)];
  const graph:RoadGraph={edges,nodeIds:['a','b','c','d','e'],index:new Map(),out:[[0,2],[1],[3],[4],[]],blocked:new Map(),ctx:{mode:'car',day:4,minutes:480}};
  const tree=turnRouteTree(graph,[{edge:0,cost:0}],(a,b)=>!(a.id===1&&b.id===4),e=>e.costS,()=>0);
  // The seed enters B; add a real alternative B→C so both paths reach D.
  expect(tree.arrival(3,edges[4]!).cost).toBe(Infinity);
  const alternative={...graph,edges:[...edges,edge(5,1,2,2)],out:[[0,2],[1,5],[3],[4],[]]};
  const valid=turnRouteTree(alternative,[{edge:0,cost:0}],(a,b)=>!(a.id===1&&b.id===4),e=>e.costS,()=>0);
  const arrival=valid.arrival(3,edges[4]!);expect(arrival.cost).toBe(3);expect(valid.path(arrival.edge).map(e=>e.id)).toEqual([5,3]);
});
it('reads native lane-connection prohibitions and invalidates rules with immutable scenario edits',()=>{
  const baseline=JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz',import.meta.url)))).toString()) as CityBaseline;
  const net=new NetworkReplayer().derive(baseline,[]).net,origin=baseline.origin,graph=buildGraph(net,new LocalFrame(origin),{mode:'car',day:4,minutes:480});
  const junction=Object.values(net.nodes).map(n=>analyzeJunction(net,origin,n.id)).find(j=>j&&j.movements.length>3)!;
  const movement=junction.movements[0]!,incoming=graph.edges.find(e=>e.roadId===movement.fromRoadId&&graph.nodeIds[e.to]===junction.nodeId)!,outgoing=graph.edges.find(e=>e.roadId===movement.toRoadId&&graph.nodeIds[e.from]===junction.nodeId)!;
  const overrides=Object.fromEntries(junction.movements.filter(m=>m.fromRoadId===movement.fromRoadId&&m.toRoadId===movement.toRoadId).map(m=>[m.id,false]));
  const edited={...net,junctions:{...net.junctions,[junction.nodeId]:{nodeId:junction.nodeId,control:'uncontrolled' as const,cornerRadiusM:4,minorRoadIds:[],crossingRoadIds:[],laneConnections:overrides}}};
  expect(turnAllowed(edited,origin,graph,incoming,outgoing)).toBe(false);
  expect(turnAllowed(net,origin,graph,incoming,outgoing)).toBe(true);
});

it('honours explicit lane prohibitions at a two-arm connection without a junction surface',()=>{
 const baseline=JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz',import.meta.url)))).toString()) as CityBaseline;
 const net=new NetworkReplayer().derive(baseline,[]).net,origin=baseline.origin,graph=buildGraph(net,new LocalFrame(origin),{mode:'car',day:4,minutes:480});
 const incoming=graph.edges.find(a=>graph.out[a.to]!.some(id=>graph.edges[id]!.roadId!==a.roadId)&&Object.values(net.roads).filter(r=>r.from===graph.nodeIds[a.to]||r.to===graph.nodeIds[a.to]).length===2)!;
 const outgoing=graph.edges[graph.out[incoming.to]!.find(id=>graph.edges[id]!.roadId!==incoming.roadId)!]!,nodeId=graph.nodeIds[incoming.to]!;
 const a=net.roads[incoming.roadId]!,b=net.roads[outgoing.roadId]!,laneConnections=Object.fromEntries(a.lanes.flatMap(x=>b.lanes.map(y=>[`${x.id}>${y.id}`,false])));
 const edited={...net,junctions:{...net.junctions,[nodeId]:{nodeId,control:'uncontrolled' as const,cornerRadiusM:4,minorRoadIds:[],crossingRoadIds:[],laneConnections}}};
 expect(turnAllowed(net,origin,graph,incoming,outgoing)).toBe(true);expect(turnAllowed(edited,origin,graph,incoming,outgoing)).toBe(false);
});
