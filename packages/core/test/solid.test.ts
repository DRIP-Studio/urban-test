import {expect,it} from 'vitest';
import {solidMesh,solidErrors,wallSolid} from '../src/index';
it('extrudes a courtyard without filling its hole, with outward normals',()=>{
 const solid={heightM:3,polygons:[[[[0,0],[10,0],[10,10],[0,10]],[[2,2],[2,8],[8,8],[8,2]]]]} as const;
 const mesh=solidMesh(solid);expect(mesh.areaM2).toBe(64);expect(mesh.volumeM3).toBe(192);expect(mesh.positions.length).toBe(mesh.normals.length);expect(mesh.normals.every(Number.isFinite)).toBe(true);
 let topArea=0;for(let i=0;i<mesh.positions.length;i+=9)if(mesh.normals[i+2]===1){const p=mesh.positions.slice(i,i+9);const cross=(p[3]!-p[0]!)*(p[7]!-p[1]!)-(p[4]!-p[1]!)*(p[6]!-p[0]!);expect(cross).toBeGreaterThan(0);topArea+=cross/2;}expect(topArea).toBe(64);
});
it('rejects degenerate and self-crossing rings and unions a bent wall',()=>{
 expect(solidErrors({heightM:2,polygons:[[[[0,0],[1,0],[1,0],[0,1]]]]})).not.toEqual([]);
 expect(solidErrors({heightM:2,polygons:[[[[0,0],[1,1],[0,1],[1,0]]]]})).not.toEqual([]);
 const mesh=solidMesh(wallSolid([[0,0],[10,0],[10,10]],.4,2));expect(mesh.areaM2).toBeCloseTo(7.96,6);expect(mesh.normals.every(Number.isFinite)).toBe(true);
});
