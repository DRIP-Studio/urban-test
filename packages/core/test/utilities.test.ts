import {expect,it} from 'vitest';
import {segmentClearance,detectUtilityClashes,LocalFrame,type CityBaseline,type Network,type UtilityNode} from '../src/index';
it('measures finite 3D segments, parallel tubes and skew crossings',()=>{
 expect(segmentClearance([0,0,0],[10,0,0],[5,-5,2],[5,5,2]).distanceM).toBe(2);
 expect(segmentClearance([0,0,0],[10,0,0],[20,0,0],[30,0,0]).distanceM).toBe(10);
 expect(segmentClearance([0,0,0],[10,0,0],[0,1,0],[10,1,0]).distanceM).toBe(1);
});
it('reports insufficient clearance, preserves different datums and suppresses designed junction connections',()=>{
 const origin=[14.28,40.94] as const,f=new LocalFrame(origin),node=(id:string,point:readonly[number,number],z:number,system:UtilityNode['system']):UtilityNode=>({id,name:id,system,at:f.toLngLat(point),elevationM:z,kind:'junction',datum:'orthometric'});
 const utilityNodes={a:node('a',[-10,0],-2,'gas'),b:node('b',[10,0],-2,'gas'),c:node('c',[0,-10],-1.8,'electricity'),d:node('d',[0,10],-1.8,'electricity')};
 const net={nodes:{},roads:{},assets:{},junctions:{},roundabouts:{},signalPlans:{},zones:{},areas:{},utilityNodes,utilityLinks:{ab:{id:'ab',name:'Gas',from:'a',to:'b',diameterMm:200,clearanceM:.3,material:'PE'},cd:{id:'cd',name:'Duct',from:'c',to:'d',diameterMm:100,clearanceM:.3,material:'PVC'}}} satisfies Network;
 const baseline={origin,buildings:{}} as unknown as CityBaseline;
 const result=detectUtilityClashes(net,baseline,{foundationDepthM:2,roadCoverM:.5});expect(result.clashes).toHaveLength(1);expect(result.clashes[0]!.distanceM).toBeCloseTo(.2,6);expect(result.clashes[0]!.requiredM).toBeCloseTo(.45,6);
 const incompatible=detectUtilityClashes({...net,utilityNodes:{...utilityNodes,c:{...utilityNodes.c,datum:'relative'},d:{...utilityNodes.d,datum:'relative'}}},baseline,{foundationDepthM:2,roadCoverM:.5});expect(incompatible.clashes).toHaveLength(0);expect(incompatible.skipped.join(' ')).toContain('riferimenti altimetrici differenti');
});
