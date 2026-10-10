import {expect,it} from 'vitest';
import * as C from 'cesium';
import {buildingGeometry} from '../src/twin/buildingMesh';
import {LocalFrame} from '@drip-urban/core';
import {buildingTiles,buildingLod} from '../src/twin/buildingLod';
it('spatial tiles retain every native ID once and rendering quality never edits the model',()=>{
 const origin=[14.27,40.94] as const,f=new LocalFrame(origin),buildings=Array.from({length:1000},(_,i)=>({id:`b${i}`,footprint:[f.toLngLat([i*15,0]),f.toLngLat([i*15+5,5]),f.toLngLat([i*15,10])]}));
 const tiles=buildingTiles(buildings,origin);expect(tiles.size).toBeGreaterThan(70);const all=[...tiles.values()].flat();expect(new Set(all.map(b=>b.id)).size).toBe(1000);expect(all.every(b=>buildings.includes(b))).toBe(true);
 expect(buildingLod(400,'balanced')).toBe('near');expect(buildingLod(400,'balanced',true)).toBe('medium');expect(buildingLod(4000,'ultra')).toBe('far');expect(buildingLod(11000,'balanced')).toBe('hidden');
});

it('distant building geometry removes balcony detail and retains authored roof height',async()=>{
 const f=new LocalFrame([14.27,40.94]),b={id:'lod-real',heightM:30,minHeightM:0,levels:8,balconies:true,roofShape:'flat' as const,footprint:[[0,0],[20,0],[20,20],[0,20]].map(q=>f.toLngLat(q as [number,number]))};
 const near=buildingGeometry([b],()=>0,false,'all',true)!,far=buildingGeometry([b],()=>0,false,'all',false)!;
 expect(far.indices!.length).toBeLessThan(near.indices!.length);expect(far.attributes.position!.values.length).toBeLessThan(near.attributes.position!.values.length);
 const height=(g:typeof near)=>{const p=g.attributes.position!.values;let max=-Infinity;for(let i=0;i<p.length;i+=3)max=Math.max(max,C.Cartographic.fromCartesian(new C.Cartesian3(p[i],p[i+1],p[i+2])).height);return max;};
 expect(height(far)).toBeCloseTo(height(near),3);expect(height(far)).toBeGreaterThanOrEqual(30);
 expect(b.balconies).toBe(true);expect(b.footprint).toHaveLength(4);
});
