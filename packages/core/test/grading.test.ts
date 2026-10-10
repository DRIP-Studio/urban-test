import {expect,it} from 'vitest';
import {LocalFrame,gradingQuantities,gradedTerrainElevation,gradingElevation,gradingErrors,type Area,type TerrainGrid} from '../src/index';
const origin=[14.28,40.94] as const,f=new LocalFrame(origin),sw=f.toLngLat([-100,-100]),ne=f.toLngLat([100,100]);
const grid:TerrainGrid={west:sw[0],south:sw[1],east:ne[0],north:ne[1],nx:2,ny:2,z:[10,10,10,10],resolutionM:200,source:'Explicit synthetic flat test surface'};
const area:Area={id:'g',kind:'plaza',polygon:[[0,0],[40,0],[40,20],[0,20]].map(p=>f.toLngLat(p as [number,number])),material:'asphalt',state:'project',properties:{},provenance:{kind:'project',source:'Test'},grading:{elevationM:12,eastPct:0,northPct:0,cutSlope:1,fillSlope:1.5,maxDaylightM:10,retaining:true}};
it('integrates the clipped platform against actual supplied terrain and converges',()=>{
 const a=gradingQuantities(area,grid,2),b=gradingQuantities(area,grid,1);expect(a.platformM2).toBeCloseTo(800,4);expect(a.fillM3).toBeCloseTo(1600,3);expect(a.cutM3).toBe(0);expect(b.fillM3).toBeCloseTo(a.fillM3,3);expect(a.missingM2).toBe(0);
 const plane={...area,grading:{...area.grading!,eastPct:5}};expect(gradingElevation(plane,f.toLngLat([20,10]))).toBeCloseTo(13,5);expect(gradingQuantities(plane,grid,2).fillM3).toBeCloseTo(2400,3);
});
it('daylights slopes without changing the source terrain and rejects invalid designs',()=>{
 const slopes={...area,grading:{...area.grading!,retaining:false}};expect(gradedTerrainElevation(slopes,f.toLngLat([-1.5,10]),10)).toBeCloseTo(11,4);expect(gradedTerrainElevation(slopes,f.toLngLat([-5,10]),10)).toBe(10);expect(gradedTerrainElevation(area,f.toLngLat([-1.5,10]),10)).toBe(10);expect(grid.z).toEqual([10,10,10,10]);expect(gradingErrors({...area,grading:{...area.grading!,fillSlope:0}})).not.toEqual([]);
});

it('integrates a sloping triangular boundary independently of cell clipping shape',()=>{
 const triangle={...area,polygon:[[0,0],[40,0],[0,20]].map(p=>f.toLngLat(p as [number,number])),grading:{...area.grading!,eastPct:5}};
 const coarse=gradingQuantities(triangle,grid,7),fine=gradingQuantities(triangle,grid,1);
 expect(coarse.platformM2).toBeCloseTo(400,4);expect(coarse.fillM3).toBeCloseTo(400*(2+40/3*.05),3);expect(coarse.fillM3).toBeCloseTo(fine.fillM3,3);
});
