import {LocalFrame} from '../geo/projection';
import type { LngLat, Network } from '../model/types';
import { analyzeJunction } from './junction';
import type { GraphEdge, RoadGraph } from './graph';

const rules = new WeakMap<Network, Map<string, ReadonlySet<string> | null>>();
const restricted = new WeakMap<Network, Set<string>>();
/** Uses the same lane connections and authored arrow movements as Junction Lab and Flow. */
export function turnAllowed(net: Network, origin: LngLat, graph: RoadGraph, incoming: GraphEdge, outgoing: GraphEdge): boolean {
  if (incoming.to !== outgoing.from) return false;
  if (incoming.roadId === outgoing.roadId) return incoming.forward === outgoing.forward;
  if (graph.ctx.mode === 'walk' || graph.ctx.mode === 'bike') return true;
  let nodes = restricted.get(net);
  if (!nodes) {
    nodes = new Set(Object.values(net.junctions).filter(j=>Object.keys(j.laneConnections??{}).length).map(j=>j.nodeId));
    for (const road of Object.values(net.roads)) for (const lane of road.lanes) if (lane.turns.length && !(lane.turns.length===1&&lane.turns[0]==='through')) {
      if(lane.direction!=='backward')nodes.add(road.to);
      if(lane.direction!=='forward')nodes.add(road.from);
    }
    restricted.set(net,nodes);
  }
  const nodeId=graph.nodeIds[incoming.to]!;
  if(!nodes.has(nodeId))return true;
  let cache=rules.get(net);if(!cache){cache=new Map();rules.set(net,cache);}
  if(!cache.has(nodeId)){
    const junction=analyzeJunction(net,origin,nodeId);
    cache.set(nodeId,junction?new Set(junction.movements.map(m=>`${m.fromRoadId}>${m.toRoadId}`)):null);
  }
  const allowed=cache.get(nodeId);
  if(allowed)return allowed.has(`${incoming.roadId}>${outgoing.roadId}`);
  // Junction Lab has no surface model for a two-arm connection; native lane rules still apply.
  const a=net.roads[incoming.roadId]!,b=net.roads[outgoing.roadId]!,f=new LocalFrame(origin);
  const heading=(road:typeof a,forward:boolean,entering:boolean)=>{const pts=forward?road.axis:[...road.axis].reverse();const i=entering?pts.length-2:0,p=f.toMetric(pts[i]!),q=f.toMetric(pts[i+1]!);return[q[0]-p[0],q[1]-p[1]];};
  const x=heading(a,incoming.forward,true),y=heading(b,outgoing.forward,false);
  const angle=Math.atan2(x[0]!*y[1]!-x[1]!*y[0]!,x[0]!*y[0]!+x[1]!*y[1]!)*180/Math.PI;
  const turn=Math.abs(angle)<35?'through':Math.abs(angle)>155?'uturn':angle>0?'left':'right';
  const lanes=(road:typeof a,forward:boolean)=>road.lanes.filter(l=>forward?l.direction!=='backward':l.direction!=='forward');
  const overrides=net.junctions[nodeId]?.laneConnections??{};
  return lanes(a,incoming.forward).some(from=>lanes(b,outgoing.forward).some(to=>overrides[`${from.id}>${to.id}`]??(!from.turns.length||from.turns.length===1&&from.turns[0]==='through'||from.turns.includes(turn))));
}

/** Edge-state shortest paths retain alternate arrivals at a junction, which a node-only tree loses. */
export function turnRouteTree(g: RoadGraph, sources: readonly { edge: number; cost: number }[], allowed: (a: GraphEdge,b: GraphEdge)=>boolean, costOf:(e:GraphEdge)=>number, delay:(a:GraphEdge,b:GraphEdge)=>number) {
  const dist=new Float64Array(g.edges.length).fill(Infinity), parent=new Int32Array(g.edges.length).fill(-1);
  const heap:{edge:number;cost:number}[]=[];
  const push=(edge:number,cost:number)=>{heap.push({edge,cost});let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]!.cost<=cost)break;[heap[i],heap[p]]=[heap[p]!,heap[i]!];i=p;}};
  const pop=()=>{const top=heap[0]!,last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;for(;;){const a=i*2+1,b=a+1;let m=i;if(a<heap.length&&heap[a]!.cost<heap[m]!.cost)m=a;if(b<heap.length&&heap[b]!.cost<heap[m]!.cost)m=b;if(m===i)break;[heap[i],heap[m]]=[heap[m]!,heap[i]!];i=m;}}return top;};
  for(const s of sources)if(s.cost<dist[s.edge]!){dist[s.edge]=s.cost;push(s.edge,s.cost);}
  while(heap.length){const {edge,cost}=pop();if(cost>dist[edge]!)continue;const incoming=g.edges[edge]!;for(const id of g.out[incoming.to]!){const next=g.edges[id]!;if(!allowed(incoming,next))continue;const total=cost+costOf(next)+delay(incoming,next);if(total<dist[id]!){dist[id]=total;parent[id]=edge;push(id,total);}}}
  const incoming=new Map<number,number[]>();for(const e of g.edges){const list=incoming.get(e.to)??[];list.push(e.id);incoming.set(e.to,list);}
  return {
    arrival(node:number,next:GraphEdge):{cost:number;edge:number}{let cost=Infinity,edge=-1;for(const id of incoming.get(node)??[]){const last=g.edges[id]!;if(allowed(last,next)){const value=dist[id]!+delay(last,next);if(value<cost){cost=value;edge=id;}}}return{cost,edge};},
    path(edge:number):GraphEdge[]{const result:GraphEdge[]=[];for(let i=edge;i>=0&&parent[i]!>=0;i=parent[i]!)result.push(g.edges[i]!);return result.reverse();},
  };
}
