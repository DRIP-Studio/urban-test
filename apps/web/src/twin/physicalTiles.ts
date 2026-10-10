import {LocalFrame,type LngLat} from '@drip-urban/core';
import type {PhysicalPayload} from '../engine/protocol';
/** Partition only the renderer payload; keep every physical feature and native ID unchanged. */
export function physicalTiles(payload:PhysicalPayload,origin:LngLat,cellM=200):PhysicalPayload[]{
 const frame=new LocalFrame(origin),tiles=new Map<string,PhysicalPayload>();
 for(const layer of ['surfaces','markings'] as const)for(const feature of payload[layer].features){
  const ring=feature.geometry.coordinates[0];if(!ring?.length)continue;
  const center=ring.reduce<[number,number]>((p,q)=>[p[0]+q[0]!/ring.length,p[1]+q[1]!/ring.length] as [number,number],[0,0] as [number,number]),m=frame.toMetric(center),key=`${Math.floor(m[0]/cellM)},${Math.floor(m[1]/cellM)}`;
  let tile=tiles.get(key);if(!tile){tile={...payload,surfaces:{...payload.surfaces,features:[]},markings:{...payload.markings,features:[]}};tiles.set(key,tile);}
  tile[layer].features.push(feature);
 }
 return [...tiles.values()];
}
