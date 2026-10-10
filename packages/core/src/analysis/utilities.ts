import type {CityBaseline,LngLat,Network,TerrainGrid,UtilityLink,UtilitySystem} from '../model/types';
import {LocalFrame} from '../geo/projection';
import {lengthOf,pointInRing,project,sampleAt,type V} from '../geo/polyline';
import {sampleTerrain,designElevation} from './vertical';
import {layoutSection} from '../physical/section';
import {corridorCrossfall} from './crossfall';
export const UTILITY_COLORS:Record<UtilitySystem,string>={water:'#3b96df',sewer:'#86694b',stormwater:'#5cbbc6',electricity:'#df4a3e',gas:'#edb642',telecom:'#aa76d4',district:'#df823e'};
export type XYZ=readonly[number,number,number];
export interface UtilityRun {id:string;name:string;system:string;diameterM:number;clearanceM:number;datum:'orthometric'|'relative';points:readonly{at:LngLat;elevationM:number}[];nodes:readonly string[];}
export interface UtilityClash {id:string;a:string;b:string;kind:'utility'|'road'|'foundation';distanceM:number;requiredM:number;at:LngLat;z:number;message:string;}
export function utilityGeometry(net:Network,link:UtilityLink){const a=net.utilityNodes?.[link.from],b=net.utilityNodes?.[link.to];if(!a||!b)return[];return[{at:a.at,elevationM:a.elevationM},...(link.path??[]),{at:b.at,elevationM:b.elevationM}];}
export function utilityRuns(net:Network):UtilityRun[]{
 const runs:UtilityRun[]=Object.values(net.utilityLinks??{}).flatMap(link=>{const a=net.utilityNodes?.[link.from];return a?[{id:link.id,name:link.name,system:a.system,diameterM:link.diameterMm/1000,clearanceM:link.clearanceM,datum:a.datum,points:utilityGeometry(net,link),nodes:[link.from,link.to]}]:[];});
 for(const pipe of Object.values(net.drainagePipes??{})){const a=net.drainageNodes?.[pipe.from],b=net.drainageNodes?.[pipe.to];if(a&&b)runs.push({id:`drain:${pipe.id}`,name:pipe.name??pipe.id,system:'stormwater',diameterM:pipe.diameterMm/1000,clearanceM:.3,datum:a.rimSource==='dtm'&&b.rimSource==='dtm'?'orthometric':'relative',nodes:[`drain:${a.id}`,`drain:${b.id}`],points:[a,b].map(n=>({at:n.at,elevationM:n.invertElevation+pipe.diameterMm/2000}))});}
 for(const pipe of Object.values(net.waterPipes??{})){const a=net.waterNodes?.[pipe.from],b=net.waterNodes?.[pipe.to];if(a&&b)runs.push({id:`water:${pipe.id}`,name:pipe.id,system:'water',diameterM:pipe.diameterMm/1000,clearanceM:.3,datum:'orthometric',nodes:[`water:${a.id}`,`water:${b.id}`],points:[a,b].map(n=>({at:n.at,elevationM:n.elevation}))});}return runs;
}
const sub=(a:XYZ,b:XYZ)=>a.map((v,i)=>v-b[i]!) as unknown as XYZ;
const dot=(a:XYZ,b:XYZ)=>a.reduce((sum,v,i)=>sum+v*b[i]!,0);
const lerp=(a:XYZ,b:XYZ,t:number)=>a.map((v,i)=>v+(b[i]!-v)*t) as unknown as XYZ;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
/** Closest points of finite 3D segments, including parallel and degenerate segments. */
export function segmentClearance(a:XYZ,b:XYZ,c:XYZ,d:XYZ){
 const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;
 let s=A<1e-12?0:den>1e-12?clamp((B*E-C*D)/den):0,t=C<1e-12?0:(B*s+E)/C;
 if(t<0){t=0;s=A>1e-12?clamp(-D/A):0;}else if(t>1){t=1;s=A>1e-12?clamp((B-D)/A):0;}
 const p=lerp(a,b,s),q=lerp(c,d,t);return{distanceM:Math.hypot(...sub(p,q)),p,q,s,t};
}
export function utilityMetrics(net:Network,origin:LngLat){const f=new LocalFrame(origin);return utilityRuns(net).map(run=>{const pts=run.points.map(p=>{const xy=f.toMetric(p.at);return[...xy,p.elevationM] as XYZ;}),lengthM=pts.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...sub(p,pts[i]!)),0);return{...run,lengthM,slopePct:lengthM?(pts.at(-1)![2]-pts[0]![2])/lengthM*100:0};});}
export function detectUtilityClashes(net:Network,baseline:CityBaseline,options:{terrain?:TerrainGrid|null;foundationDepthM:number;roadCoverM:number}){
 if(!Number.isFinite(options.foundationDepthM)||options.foundationDepthM<0||!Number.isFinite(options.roadCoverM)||options.roadCoverM<0)throw Error('Profondità o franco non validi');
 const f=new LocalFrame(baseline.origin),runs=utilityRuns(net),clashes:UtilityClash[]=[],skipped:string[]=[],metric=runs.map(run=>run.points.map(p=>[...f.toMetric(p.at),p.elevationM] as XYZ));
 const add=(a:UtilityRun,b:string,kind:UtilityClash['kind'],distanceM:number,requiredM:number,p:XYZ,message:string)=>clashes.push({id:`${a.id}|${b}`,a:a.id,b,kind,distanceM,requiredM,at:f.toLngLat([p[0],p[1]]),z:p[2],message});
 const box=(pts:readonly XYZ[])=>[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
 const boxes=metric.map(box),overlap=(a:number[],b:number[],r=0)=>a[0]!<=b[2]!+r&&a[2]!>=b[0]!-r&&a[1]!<=b[3]!+r&&a[3]!>=b[1]!-r;
 for(let i=0;i<runs.length;i++){const a=runs[i]!,ap=metric[i]!,abox=boxes[i]!;
  for(let j=i+1;j<runs.length;j++){const b=runs[j]!;if(!overlap(abox,boxes[j]!,a.diameterM+b.diameterM+Math.max(a.clearanceM,b.clearanceM)))continue;if(a.datum!==b.datum){skipped.push(`${a.id}/${b.id}: riferimenti altimetrici differenti`);continue;}if(a.system===b.system&&a.nodes.some(id=>b.nodes.includes(id)))continue;const bp=metric[j]!;let best:ReturnType<typeof segmentClearance>|null=null;
   for(let m=1;m<ap.length;m++)for(let n=1;n<bp.length;n++){const candidate=segmentClearance(ap[m-1]!,ap[m]!,bp[n-1]!,bp[n]!);if(!best||candidate.distanceM<best.distanceM)best=candidate;}
   const required=(a.diameterM+b.diameterM)/2+Math.max(a.clearanceM,b.clearanceM);if(best&&best.distanceM<required)add(a,b.id,'utility',best.distanceM,required,best.p,'Interferenza o franco insufficiente tra reti');
  }
  if(a.datum!=='orthometric'){skipped.push(`${a.id}: confronto terreno/fondazioni richiede quote ortometriche`);continue;}
  for(const road of Object.values(net.roads)){const lay=layoutSection(road),width=Math.max(Math.abs(lay.outerLeft),Math.abs(lay.outerRight)),axis=road.axis.map(q=>f.toMetric(q) as V);let clash=false;if(!overlap(abox,box(axis.map(p=>[...p,0] as XYZ)),width))continue;
   for(let m=1;m<ap.length&&!clash;m++)for(let n=1;n<axis.length&&!clash;n++){
    const closest=segmentClearance([ap[m-1]![0],ap[m-1]![1],0],[ap[m]![0],ap[m]![1],0],[...axis[n-1]!,0],[...axis[n]!,0]);if(closest.distanceM>width)continue;
    const point=lerp(ap[m-1]!,ap[m]!,closest.s),at=f.toLngLat([point[0],point[1]]),pr=project(axis,[point[0],point[1]]),t=sampleAt(axis,pr.along).t,offset=(point[0]-pr.at[0])*(-t[1])+(point[1]-pr.at[1])*t[0];
    const grade=road.vertical?designElevation(road.vertical,pr.along):options.terrain?sampleTerrain(options.terrain,at[0],at[1]):NaN;if(!Number.isFinite(grade)){skipped.push(`${a.id}/${road.id}: copertura stradale non verificata, quota/DTM mancante al punto di interferenza`);continue;}
    const bottom=grade+corridorCrossfall(road.corridor,pr.along,offset)-(road.corridor?.layers??[]).reduce((sum,l)=>sum+l.thicknessM,0),cover=bottom-point[2]-a.diameterM/2;
    if(cover<options.roadCoverM){add(a,road.id,'road',cover,options.roadCoverM,point,'Copertura insufficiente rispetto al piano/subgrade stradale');clash=true;}
   }
  }
  if(!options.terrain){skipped.push(`${a.id}: fondazioni non verificate, DTM mancante`);continue;}
  for(const building of Object.values(baseline.buildings)){if(net.removedBuildings?.[building.id])continue;const ring=building.footprint.map(q=>f.toMetric(q) as V);if(!overlap(abox,box(ring.map(p=>[...p,0] as XYZ)),a.diameterM/2))continue;let hit=false;
   for(let m=1;m<ap.length&&!hit;m++){const start=ap[m-1]!,end=ap[m]!,steps=Math.max(1,Math.ceil(Math.hypot(end[0]-start[0],end[1]-start[1])));for(let k=0;k<=steps;k++){const p=lerp(start,end,k/steps);if(!pointInRing([p[0],p[1]],ring))continue;const at=f.toLngLat([p[0],p[1]]),ground=sampleTerrain(options.terrain,at[0],at[1]);if(!Number.isFinite(ground))skipped.push(`${a.id}/${building.id}: fondazione non verificata, DTM incompleto`);if(Number.isFinite(ground)&&p[2]+a.diameterM/2>ground-options.foundationDepthM-a.clearanceM&&p[2]-a.diameterM/2<ground+building.heightM){add(a,building.id,'foundation',ground-p[2]-a.diameterM/2,options.foundationDepthM+a.clearanceM,p,'Interferenza con volume di fondazione ipotizzato');hit=true;break;}}}
  }
 }
 return{clashes,skipped:[...new Set(skipped)],method:'Distanze 3D tra condotte finite; copertura stradale da profilo/DTM e assembly; fondazioni per profondità esplicita con campioni di 1 m. Dati con datum incompatibile esclusi, non convertiti implicitamente.'};
}
