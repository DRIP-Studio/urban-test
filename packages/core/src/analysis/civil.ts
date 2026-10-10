import {LocalFrame} from '../geo/projection';
import {lengthOf,ringArea,type V} from '../geo/polyline';
import type {HorizontalDesign,CorridorAssembly,LngLat,Road,TerrainGrid,VerticalProfile} from '../model/types';
import {earthworks,stationing} from './vertical';
import {layoutSection} from '../physical/section';
export function alignmentDesignErrors(design:HorizontalDesign):string[]{
 if(!Number.isFinite(design.bearingDeg)||!design.elements.length)return['Direzione o elementi mancanti'];
 if(design.elements.reduce((sum,e)=>sum+e.lengthM,0)>100000)return['Tracciato oltre 100 km: suddividere in più strade'];
 if(design.elements.length>500)return['Massimo 500 elementi per tracciato'];
 const issues:string[]=[];let curvature=0;
 for(const e of design.elements){if(!Number.isFinite(e.lengthM)||e.lengthM<=0||e.lengthM>20000)issues.push('Lunghezza elemento non valida');if(e.kind==='arc'&&(!Number.isFinite(e.radiusM)||e.radiusM!<2||!['left','right'].includes(e.turn!)))issues.push('Raggio o verso arco non valido');if(e.kind==='clothoid'&&(!Number.isFinite(e.startCurvature)||!Number.isFinite(e.endCurvature)||Math.abs(e.startCurvature!)>.5||Math.abs(e.endCurvature!)>.5))issues.push('Curvature clotoide non valide');if(!['arc','clothoid','tangent'].includes(e.kind))issues.push('Elemento sconosciuto');
  const start=e.kind==='arc'?(e.turn==='left'?-1:1)/e.radiusM!:e.kind==='clothoid'?e.startCurvature!:0;
  if(e.kind==='clothoid'&&Math.abs(start-curvature)>1e-5)issues.push('La clotoide non raccorda la curvatura precedente');curvature=e.kind==='clothoid'?e.endCurvature!:start;
 }return issues;
}
/** ENU integration of a linear curvature law (Euler spiral), Gauss quadrature in intervals <= 1 m. */
export function designAlignment(start:LngLat,design:HorizontalDesign){
 const errors=alignmentDesignErrors(design);if(errors.length)throw Error(errors.join(' · '));
 const frame=new LocalFrame(start),axis:LngLat[]=[start],samples:{station:number;bearingDeg:number;curvature:number;at:LngLat;kind:string}[]=[];
 let x=0,y=0,heading=design.bearingDeg*Math.PI/180,station=0;
 for(const e of design.elements){const k0=e.kind==='arc'?(e.turn==='left'?-1:1)/e.radiusM!:e.kind==='clothoid'?e.startCurvature!:0,k1=e.kind==='clothoid'?e.endCurvature!:k0,rate=(k1-k0)/e.lengthM,n=Math.ceil(e.lengthM),ds=e.lengthM/n,initial=heading;
  for(let i=0;i<n;i++){const s0=i*ds,mid=s0+ds/2,g=ds/(2*Math.sqrt(3));for(const t of [mid-g,mid+g]){const angle=initial+k0*t+.5*rate*t*t;x+=Math.sin(angle)*ds/2;y+=Math.cos(angle)*ds/2;}const s=(i+1)*ds,at=frame.toLngLat([x,y]);axis.push(at);samples.push({station:station+s,bearingDeg:((initial+k0*s+.5*rate*s*s)*180/Math.PI+360)%360,curvature:k0+rate*s,at,kind:e.kind});}
  heading=initial+(k0+k1)*e.lengthM/2;station+=e.lengthM;
 }return{axis,samples,lengthM:station,endBearingDeg:heading*180/Math.PI};
}
export {corridorCrossfall} from './crossfall';
export function corridorErrors(c:CorridorAssembly):string[]{
 if(!Number.isFinite(c.cutSlope)||c.cutSlope<.1||c.cutSlope>5||!Number.isFinite(c.fillSlope)||c.fillSlope<.1||c.fillSlope>5)return['Scarpate H/V fuori intervallo'];
 if(c.layers.some(l=>!l.id||!l.material||!Number.isFinite(l.thicknessM)||l.thicknessM<=0||l.thicknessM>3||l.widthM!==undefined&&(!Number.isFinite(l.widthM)||l.widthM<=0||l.widthM>100)||l.unitCostM3!==undefined&&(!Number.isFinite(l.unitCostM3)||l.unitCostM3<0)))return['Strato o costo non valido'];
 if(c.crossfall.some((p,i)=>!Number.isFinite(p.station)||p.station<0||i>0&&p.station<=c.crossfall[i-1]!.station||!Number.isFinite(p.leftPct)||Math.abs(p.leftPct)>12||!Number.isFinite(p.rightPct)||Math.abs(p.rightPct)>12))return['Progressive o pendenze trasversali non valide'];return[];
}
export function corridorQuantities(road:Road,origin:LngLat){
 const length=stationing(road,origin).length,section=layoutSection(road),width=section.outerLeft-section.outerRight;
 const layers=(road.corridor?.layers??[]).map(l=>({...l,volumeM3:length*(l.widthM??width)*l.thicknessM,cost:length*(l.widthM??width)*l.thicknessM*(l.unitCostM3??0)}));
 return{lengthM:length,widthM:width,layers,totalCost:layers.reduce((sum,l)=>sum+l.cost,0),thicknessM:layers.reduce((sum,l)=>sum+l.thicknessM,0)};
}
export function massHaul(road:Road,profile:VerticalProfile,terrain:TerrainGrid,origin:LngLat,step=10){
 const earth=earthworks(road,profile,terrain,origin,step);let cumulative=0;const rows=earth.rows.map((r,i)=>{if(i){const prev=earth.rows[i-1]!,ds=r.station-prev.station;cumulative+=((prev.cutM2+r.cutM2)-(prev.fillM2+r.fillM2))*.5*ds;}return{station:r.station,cumulativeM3:cumulative,cutM2:r.cutM2,fillM2:r.fillM2};});
 return{...earth,rows,balanceM3:cumulative,method:earth.method+'; diagramma masse = sterro meno riporto, senza fattori di rigonfiamento non forniti'};
}
