import {LocalFrame} from '../geo/projection';
import {lengthOf,project,sampleAt,type V} from '../geo/polyline';
import type {LngLat,Network,Road} from '../model/types';

export type TrafficSourceMode='live'|'historical'|'simulated'|'hybrid';
export type TrafficProvenance='live'|'historical'|'simulated'|'estimated'|'counter'|'manual'|'fcd';
export interface TrafficObservation {
 readonly id:string; readonly geometry:readonly LngLat[]; readonly source:TrafficProvenance;
 readonly provider:string; readonly capturedAt:string|null; readonly retrievedAt:string;
 readonly speedKmh:number|null; readonly flowVph:number|null; readonly densityVehKm:number|null;
 readonly confidence:number; readonly freeFlowKmh?:number; readonly closed?:boolean;
 readonly roadId?:string; readonly forward?:boolean; readonly expiresAt?:string;
}
export interface TrafficSegment {
 readonly roadId:string;readonly forward:boolean;readonly speedKmh:number|null;
 readonly flowVph:number|null;readonly densityVehKm:number|null;readonly confidence:number;
 readonly source:TrafficProvenance;readonly provider:string;readonly capturedAt:string|null;
 readonly closed:boolean;readonly matchDistanceM:number;readonly observationId?:string;
}
export interface TrafficState {
 readonly mode:TrafficSourceMode;readonly generatedAt:string;
 readonly segments:Readonly<Record<string,TrafficSegment>>;
 readonly coverage:{totalDirections:number;observedDirections:number;estimatedDirections:number;uncoveredDirections:number;matchedObservations:number;rejectedObservations:number;staleObservations:number};
 readonly calibration:{speedRatio:number;samples:number;method:string};
}
export const trafficKey=(roadId:string,forward:boolean)=>`${roadId}|${forward?1:0}`;
export function observationFresh(observation:TrafficObservation,nowMs:number,maxAgeS=300):boolean {
 const captured=observation.capturedAt?Date.parse(observation.capturedAt):NaN,retrieved=Date.parse(observation.retrievedAt);
 return Number.isFinite(captured)&&Number.isFinite(retrieved)&&captured<=nowMs+30000&&retrieved<=nowMs+30000&&nowMs-captured<=maxAgeS*1000&&nowMs-retrieved<=maxAgeS*1000&&(!observation.expiresAt||Date.parse(observation.expiresAt)>nowMs);
}
interface IndexedRoad {road:Road;axis:V[];length:number;}
/** Immutable derived spatial index; never adds another authored project model. */
class TrafficIndex {
 readonly frame:LocalFrame;readonly roads=new Map<string,IndexedRoad>();private cells=new Map<string,Set<string>>();
 constructor(net:Network,origin:LngLat){this.frame=new LocalFrame(origin);for(const road of Object.values(net.roads)){
  if(road.axis.length<2||['footway','path','pedestrian','cycleway','steps'].includes(road.roadClass))continue;
  const axis=road.axis.map(p=>this.frame.toMetric(p) as V),length=lengthOf(axis);if(length<.1)continue;
  this.roads.set(road.id,{road,axis,length});const count=Math.max(1,Math.ceil(length/40));
  for(let i=0;i<=count;i++){const p=sampleAt(axis,length*i/count).p,key=this.key(p),set=this.cells.get(key)??new Set<string>();set.add(road.id);this.cells.set(key,set);}
 }}
 private key(p:V){return `${Math.floor(p[0]/80)},${Math.floor(p[1]/80)}`;}
 candidates(axis:V[]):Set<string>{const found=new Set<string>(),length=lengthOf(axis),count=Math.min(2000,Math.max(1,Math.ceil(length/40)));
  for(let i=0;i<=count;i++){const p=axis.length===1?axis[0]!:sampleAt(axis,length*i/count).p,x=Math.floor(p[0]/80),y=Math.floor(p[1]/80);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const id of this.cells.get(`${x+dx},${y+dy}`)??[])found.add(id);}return found;
 }
}
const indices=new WeakMap<Network,TrafficIndex>();
function validValue(v:number|null,max:number){return v===null||Number.isFinite(v)&&v>=0&&v<=max;}
export function fuseTraffic(net:Network,origin:LngLat,mode:TrafficSourceMode,observations:readonly TrafficObservation[],estimates:readonly TrafficSegment[],nowMs:number):TrafficState {
 let index=indices.get(net);if(!index){index=new TrafficIndex(net,origin);indices.set(net,index);}
 const segments:Record<string,TrafficSegment>={},ratios:number[]=[],ratioByObservation=new Map<string,number>();let matchedObservations=0,rejectedObservations=0,staleObservations=0;
 for(const observation of observations){
  if(!validValue(observation.speedKmh,300)||!validValue(observation.flowVph,50000)||!validValue(observation.densityVehKm,2000)||!Number.isFinite(observation.confidence)||observation.confidence<0||observation.confidence>1||!observation.geometry.length||observation.geometry.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)){rejectedObservations++;continue;}
  const historical=observation.source==='historical';
  if(mode==='simulated'||mode==='historical'&&!historical||mode==='live'&&historical||mode==='hybrid'&&historical)continue;
  if(!historical&&!observationFresh(observation,nowMs)){staleObservations++;continue;}
  if(historical&&(!observation.capturedAt||!Number.isFinite(Date.parse(observation.capturedAt)))){rejectedObservations++;continue;}
  const axis=observation.geometry.map(p=>index!.frame.toMetric(p) as V),ids=observation.roadId?[observation.roadId]:index.candidates(axis);let matches=0;
  for(const id of ids){const entry=index.roads.get(id);if(!entry)continue;const {road,length}=entry;
   let distance=0,dot=0,near=0;const point=axis.length===1;
   if(point){distance=project(entry.axis,axis[0]!).d;if(distance>18)continue;near=5;}
   else for(let i=0;i<5;i++){const sample=sampleAt(entry.axis,length*(i+.5)/5),p=project(axis,sample.p);distance+=p.d;const projected=sampleAt(axis,p.along),t=projected.t;dot+=sample.t[0]*t[0]+sample.t[1]*t[1];const beyond=Math.abs((sample.p[0]-projected.p[0])*t[0]+(sample.p[1]-projected.p[1])*t[1]);if(p.d<=25&&beyond<=2)near++;}
   if(!point){distance/=5;dot/=5;if(near<4||distance>25||Math.abs(dot)<.7)continue;}
   const directions=point?[true,false]:[dot>=0];
   for(const forward of directions){if(observation.forward!==undefined&&forward!==observation.forward)continue;if(road.oneway==='forward'&&!forward||road.oneway==='backward'&&forward)continue;
    const key=trafficKey(id,forward),confidence=observation.confidence*Math.max(.25,1-distance/40),previous=segments[key];
    if(previous?.closed&&!observation.closed)continue;
    if(previous&&previous.closed===!!observation.closed&&previous.confidence>confidence)continue;
    segments[key]={roadId:id,forward,speedKmh:observation.speedKmh,flowVph:observation.flowVph,densityVehKm:observation.densityVehKm,confidence,source:observation.source,provider:observation.provider,capturedAt:observation.capturedAt,closed:!!observation.closed,matchDistanceM:distance,observationId:observation.id};matches++;
    if(!observation.closed&&observation.speedKmh!==null&&(observation.freeFlowKmh??0)>0)ratioByObservation.set(observation.id,Math.max(.05,Math.min(1,observation.speedKmh/observation.freeFlowKmh!)));
   }
  }
  if(matches)matchedObservations++;else rejectedObservations++;
 }
 for(const id of new Set(Object.values(segments).filter(segment=>!segment.closed).map(segment=>segment.observationId))){const ratio=id?ratioByObservation.get(id):undefined;if(ratio!==undefined)ratios.push(ratio);}
 ratios.sort((a,b)=>a-b);const speedRatio=ratios.length?ratios[Math.floor(ratios.length/2)]!:1;
 let estimatedDirections=0;
 if(mode==='hybrid'||mode==='simulated')for(const estimate of estimates){const key=trafficKey(estimate.roadId,estimate.forward);if(segments[key]||!net.roads[estimate.roadId])continue;
  const speedKmh=estimate.speedKmh===null?null:estimate.speedKmh*(mode==='hybrid'?speedRatio:1);
  segments[key]={...estimate,speedKmh,densityVehKm:estimate.flowVph!==null&&speedKmh!==null&&speedKmh>0?estimate.flowVph/speedKmh:estimate.densityVehKm,confidence:Math.min(.6,estimate.confidence),source:estimate.source==='simulated'?'simulated':'estimated',provider:mode==='hybrid'&&ratios.length?'DRIP stima calibrata su rapporto velocità osservato':estimate.provider};estimatedDirections++;
 }
 let totalDirections=0;for(const {road}of index.roads.values())totalDirections+=road.oneway==='no'?2:1;
 return {mode,generatedAt:new Date(nowMs).toISOString(),segments,coverage:{totalDirections,observedDirections:Object.keys(segments).length-estimatedDirections,estimatedDirections,uncoveredDirections:Math.max(0,totalDirections-Object.keys(segments).length),matchedObservations,rejectedObservations,staleObservations},calibration:{speedRatio,samples:ratios.length,method:ratios.length?'Mediana del rapporto velocità osservata/libero deflusso; applicata solo alle stime scoperte. Non stima una matrice OD.':'Nessuna calibrazione disponibile: domanda e stima dichiarate.'}};
}
