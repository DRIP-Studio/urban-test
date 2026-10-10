import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type {Area,LngLat,TerrainGrid} from '../model/types';
import {LocalFrame} from '../geo/projection';
import {pointInRing,project,ringArea,ringSelfIntersects,type V} from '../geo/polyline';
import {sampleTerrain} from './vertical';
export function gradingErrors(area:Area):string[]{
 const g=area.grading;if(!g)return[];
 if(area.kind==='crossing'||area.polygon.length<3||ringSelfIntersects(area.polygon)||Math.abs(ringArea(area.polygon))<1e-12)return['Sagoma grading non valida'];
 if(!Object.values(g).every(v=>typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))||g.elevationM< -500||g.elevationM>9000||Math.abs(g.eastPct)>30||Math.abs(g.northPct)>30||g.cutSlope<.1||g.cutSlope>5||g.fillSlope<.1||g.fillSlope>5||g.maxDaylightM<0||g.maxDaylightM>200||typeof g.retaining!=='boolean')return['Quote, pendenze o scarpate grading non valide'];
 return[];
}
const gradingGeometry=new WeakMap<Area,{frame:LocalFrame;ring:V[];bounds:readonly[number,number,number,number]}>();
function geometry(area:Area){let cached=gradingGeometry.get(area);if(!cached){const frame=new LocalFrame(area.polygon[0]!),ring=area.polygon.map(p=>frame.toMetric(p) as V);cached={frame,ring,bounds:[Math.min(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[1]))]};gradingGeometry.set(area,cached);}return cached;}
export function gradingElevation(area:Area,at:LngLat):number {
 const g=area.grading!,[x,y]=geometry(area).frame.toMetric(at);return g.elevationM+x*g.eastPct/100+y*g.northPct/100;
}
/** Exterior slopes daylight against the supplied terrain, bounded by the declared extent. */
export function gradedTerrainElevation(area:Area,at:LngLat,ground:number):number {
 if(!area.grading||area.state==='removed'||!Number.isFinite(ground))return ground;
 const {frame:f,ring,bounds}=geometry(area),point=f.toMetric(at) as V,extent=area.grading.maxDaylightM;
 if(point[0]<bounds[0]-extent||point[0]>bounds[1]+extent||point[1]<bounds[2]-extent||point[1]>bounds[3]+extent)return ground;
 if(pointInRing(point,ring))return gradingElevation(area,at);
 const g=area.grading;if(g.retaining)return ground;
 const nearest=project([...ring,ring[0]!],point);if(nearest.d>g.maxDaylightM)return ground;
 const edge=gradingElevation(area,f.toLngLat(nearest.at)),fill=edge>ground;
 return fill?Math.max(ground,edge-nearest.d/g.fillSlope):Math.min(ground,edge+nearest.d/g.cutSlope);
}
/** Cell clipping integrates the actual platform outline; exterior sampling follows the explicit grid. */
export function gradingQuantities(area:Area,grid:TerrainGrid,stepM=2) {
 const errors=gradingErrors(area);if(errors.length)throw Error(errors.join(' · '));if(!area.grading)throw Error('Grading assente');
 if(!Number.isFinite(stepM)||stepM<.25||stepM>50)throw Error('Passo grading 0,25–50 m');
 const frame=new LocalFrame(area.polygon[0]!),ring=area.polygon.map(p=>[...frame.toMetric(p)] as [number,number]);
 const pad=area.grading.retaining?0:area.grading.maxDaylightM,x0=Math.floor((Math.min(...ring.map(p=>p[0]))-pad)/stepM)*stepM,x1=Math.max(...ring.map(p=>p[0]))+pad,y0=Math.floor((Math.min(...ring.map(p=>p[1]))-pad)/stepM)*stepM,y1=Math.max(...ring.map(p=>p[1]))+pad;
 if((x1-x0)*(y1-y0)/stepM**2>500000)throw Error('Oltre 500.000 celle: aumentare il passo di integrazione');
 let cutM3=0,fillM3=0,missingM2=0,platformM2=0,slopeM2=0;
 const samples:{at:LngLat;groundM:number;designM:number;areaM2:number}[]=[];
 for(let y=y0;y<y1;y+=stepM)for(let x=x0;x<x1;x+=stepM){
  const cell:[[number,number],[number,number],[number,number],[number,number]]=[[x,y],[x+stepM,y],[x+stepM,y+stepM],[x,y+stepM]],clipped=polygonClipping.intersection([ring],[cell]);
  const integrate=(polygons:polygonClipping.MultiPolygon,inside:boolean)=>{
   for(const polygon of polygons){const rings=polygon.map(r=>r.slice(0,-1)),coords=rings.flatMap(r=>r.flat()),holes:number[]=[];let offset=rings[0]!.length;for(const r of rings.slice(1)){holes.push(offset);offset+=r.length;}const triangles=earcut(coords,holes,2);
    for(let i=0;i<triangles.length;i+=3){const triangle=triangles.slice(i,i+3).map(k=>[coords[k*2]!,coords[k*2+1]!] as V),size=Math.abs(ringArea(triangle));if(size<1e-9)continue;const point:V=[triangle.reduce((s,p)=>s+p[0],0)/3,triangle.reduce((s,p)=>s+p[1],0)/3];
     if(!inside&&project([...ring,ring[0]!],point).d>pad)continue;
     const at=frame.toLngLat(point),ground=sampleTerrain(grid,at[0],at[1]);if(inside)platformM2+=size;if(!Number.isFinite(ground)){missingM2+=size;continue;}
     const design=inside?gradingElevation(area,at):gradedTerrainElevation(area,at,ground),difference=design-ground;
     if(inside||Math.abs(difference)>.001){if(!inside)slopeM2+=size;cutM3+=Math.max(0,-difference)*size;fillM3+=Math.max(0,difference)*size;samples.push({at,groundM:ground,designM:design,areaM2:size});}
    }
   }
  };
  integrate(clipped,true);
  if(pad)integrate(polygonClipping.difference([cell],[ring]),false);
 }
 return{cutM3,fillM3,balanceM3:cutM3-fillM3,platformM2,slopeM2,missingM2,stepM,samples,method:'Integrazione numerica su celle metriche, clipping e centroidi dei triangoli interni/esterni; DTM bilineare, piattaforma planare, scarpate H/V fino al terreno o limite dichiarato. Nessun fattore di rigonfiamento/geotecnico. Ripetere con passo dimezzato per convergenza.'};
}
