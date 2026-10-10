import {LocalFrame,type LngLat} from '@drip-urban/core';
/** Render-only spatial tiles: authored building IDs/styles stay in the single network. */
export function buildingTiles<T extends {id:string;footprint:readonly LngLat[]}>(buildings:readonly T[],origin:LngLat,cellM=200):Map<string,T[]> {
 const f=new LocalFrame(origin),tiles=new Map<string,T[]>();
 for(const b of buildings){if(!b.footprint.length)continue;const n=b.footprint.length,p=b.footprint.reduce((q,v)=>[q[0]+v[0]/n,q[1]+v[1]/n] as [number,number],[0,0] as [number,number]),m=f.toMetric(p);const key=`${Math.floor(m[0]/cellM)},${Math.floor(m[1]/cellM)}`,list=tiles.get(key)??[];list.push(b);tiles.set(key,list);}
 return tiles;
}
export type BuildingLod='near'|'medium'|'far'|'hidden';
export function buildingLod(distanceM:number,quality:string,adaptive=false):BuildingLod {
 const detail=adaptive||quality==='performance'?350:quality==='high'||quality==='ultra'?1200:650;
 return distanceM<detail?'near':distanceM<2500?'medium':distanceM<10000?'far':'hidden';
}
