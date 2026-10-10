import {expect,it} from 'vitest';
import {LocalFrame} from '@drip-urban/core';
import {physicalTiles} from '../src/twin/physicalTiles';
import type {PhysicalPayload} from '../src/engine/protocol';
it('retains surfaces, marking holes and feature references exactly once across municipal tiles',()=>{
 const origin=[14.27,40.94] as const,f=new LocalFrame(origin),features=Array.from({length:1000},(_,i)=>({type:'Feature' as const,properties:{id:`surface-${i}`},geometry:{type:'Polygon' as const,coordinates:[[[i*20,0],[i*20+8,0],[i*20+8,8],[i*20,0]].map(p=>[...f.toLngLat(p as [number,number])])]}}));
 features[0]!.geometry.coordinates.push([[2,2],[4,2],[4,4],[2,2]].map(p=>[...f.toLngLat(p as [number,number])]));
 const p:PhysicalPayload={surfaces:{type:'FeatureCollection',features},markings:{type:'FeatureCollection',features:features.slice(0,20)},lines:{type:'FeatureCollection',features:[]},heads:[]},tiles=physicalTiles(p,origin);
 expect(tiles.length).toBeGreaterThan(90);const all=tiles.flatMap(t=>t.surfaces.features);expect(all).toHaveLength(1000);expect(new Set(all).size).toBe(1000);expect(all.every(x=>features.includes(x as typeof features[number]))).toBe(true);expect(tiles.flatMap(t=>t.markings.features)).toHaveLength(20);expect(p.surfaces.features).toHaveLength(1000);expect(all[0]!.geometry.coordinates).toHaveLength(2);
});
