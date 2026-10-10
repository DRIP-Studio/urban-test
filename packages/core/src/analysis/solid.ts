import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type {Asset,UrbanSolid} from '../model/types';
import {LocalFrame} from '../geo/projection';
import {ringArea,ringSelfIntersects,polygonIntersectionArea,type V} from '../geo/polyline';
export function solidErrors(solid:UrbanSolid):string[]{
 if(!Number.isFinite(solid.heightM)||solid.heightM<.005||solid.heightM>2000||!solid.polygons?.length)return['Altezza o sagoma del solido non valida'];
 if(solid.polygons.length>500)return['Suddividere il solido in meno di 500 componenti'];
 for(const polygon of solid.polygons){if(!polygon.length)return['Sagoma vuota'];for(const ring of polygon)if(ring.length<3||ring.length>5000||ring.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))||ring.some((p,i)=>Math.hypot(p[0]-ring[(i+1)%ring.length]![0],p[1]-ring[(i+1)%ring.length]![1])<1e-8)||ringSelfIntersects(ring as readonly V[])||Math.abs(ringArea(ring as readonly V[]))<1e-5)return['Poligono degenerato o autointersecante'];const outer=polygon[0]! as readonly V[];for(const hole of polygon.slice(1))if(Math.abs(polygonIntersectionArea(outer,hole as readonly V[])-Math.abs(ringArea(hole as readonly V[])))>1e-5)return['Foro fuori dal poligono'];}
 for(const polygon of solid.polygons){for(let i=1;i<polygon.length;i++)for(let j=i+1;j<polygon.length;j++)if(polygonIntersectionArea(polygon[i]! as readonly V[],polygon[j]! as readonly V[])>1e-6)return['Fori sovrapposti'];}
 for(let i=0;i<solid.polygons.length;i++)for(let j=i+1;j<solid.polygons.length;j++)if(polygonClipping.intersection(solid.polygons[i]!.map(r=>r.map(p=>[...p])) as polygonClipping.Polygon,solid.polygons[j]!.map(r=>r.map(p=>[...p])) as polygonClipping.Polygon).some(p=>Math.abs(ringArea(p[0]! as V[]))-p.slice(1).reduce((s,r)=>s+Math.abs(ringArea(r as V[])),0)>1e-6))return['Componenti del solido sovrapposte'];
 return[];
}
export function solidMesh(solid:UrbanSolid){
 const issues=solidErrors(solid);if(issues.length)throw Error(issues.join(' · '));const positions:number[]=[],normals:number[]=[];let areaM2=0;
 const triangle=(a:readonly number[],b:readonly number[],c:readonly number[],n:readonly number[])=>{for(const p of [a,b,c]){positions.push(...p);normals.push(...n);}};
 for(const polygon of solid.polygons){
  const rings=polygon.map((r,i)=>{const area=ringArea(r as readonly V[]);return i===0?area>0?[...r]:[...r].reverse():area<0?[...r]:[...r].reverse();});
  areaM2+=Math.abs(ringArea(rings[0]! as V[]))-rings.slice(1).reduce((sum,r)=>sum+Math.abs(ringArea(r as V[])),0);
  const coords=rings.flatMap(r=>r.flatMap(p=>[p[0],p[1]])),holes:number[]=[];let offset=rings[0]!.length;for(const r of rings.slice(1)){holes.push(offset);offset+=r.length;}
  const indices=earcut(coords,holes,2);for(let i=0;i<indices.length;i+=3){let ids=indices.slice(i,i+3);const p=ids.map(k=>[coords[k*2]!,coords[k*2+1]!] as V);const cross=(p[1]![0]-p[0]![0])*(p[2]![1]-p[0]![1])-(p[1]![1]-p[0]![1])*(p[2]![0]-p[0]![0]);if(cross<0)ids=[ids[0]!,ids[2]!,ids[1]!];const pts=ids.map(k=>[coords[k*2]!,coords[k*2+1]!] as V);triangle([...pts[0]!,solid.heightM],[...pts[1]!,solid.heightM],[...pts[2]!,solid.heightM],[0,0,1]);triangle([...pts[0]!,0],[...pts[2]!,0],[...pts[1]!,0],[0,0,-1]);}
  for(const r of rings)for(let i=0;i<r.length;i++){const a=r[i]!,b=r[(i+1)%r.length]!,dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy),n=[dy/L,-dx/L,0];triangle([...a,0],[...b,0],[...b,solid.heightM],n);triangle([...a,0],[...b,solid.heightM],[...a,solid.heightM],n);}
 }return{positions,normals,areaM2,volumeM3:areaM2*solid.heightM};
}
export function solidWorldPolygons(asset:Asset){
 if(!asset.solid)return[];const f=new LocalFrame(asset.at),angle=-asset.rotationDeg*Math.PI/180,k=asset.scale??1;
 return asset.solid.polygons.map(p=>p.map(r=>r.map(([x,y])=>f.toLngLat([(x*Math.cos(angle)-y*Math.sin(angle))*k,(x*Math.sin(angle)+y*Math.cos(angle))*k]))));
}
export function wallSolid(line:readonly V[],widthM:number,heightM:number):UrbanSolid{
 if(line.length<2||!Number.isFinite(widthM)||widthM<=0)throw Error('Polilinea o spessore muro non validi');
 const shapes:polygonClipping.Polygon[]=[];
 for(let i=1;i<line.length;i++){const a=line[i-1]!,b=line[i]!,L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!L)continue;const x=-(b[1]-a[1])/L*widthM/2,y=(b[0]-a[0])/L*widthM/2;shapes.push([[[a[0]+x,a[1]+y],[b[0]+x,b[1]+y],[b[0]-x,b[1]-y],[a[0]-x,a[1]-y],[a[0]+x,a[1]+y]]]);}
 if(!shapes.length)throw Error('Polilinea degenerata');const polygons=polygonClipping.union(shapes[0]!,...shapes.slice(1));return{heightM,polygons:polygons.map(p=>p.map(r=>r.slice(0,-1) as V[]))};
}
