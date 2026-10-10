import {roadSetStructure} from '../src/ops/streetscape-ops';
import {roadSetVertical} from '../src/ops/builtin';
import {expect,it} from 'vitest';
import {LocalFrame,underpassDesign,setUnderpass,buildGraph,type Road,type Network} from '../src/index';
const origin=[14.28,40.94] as const,f=new LocalFrame(origin);
const road={id:'r',from:'a',to:'b',name:'Passage',axis:[origin,f.toLngLat([0,180])],roadClass:'residential',speedKmh:30,oneway:'both',lanes:[],section:{elements:[]},provenance:{}} as unknown as Road;
const design={usage:'pedestrian' as const,depthM:3,clearanceM:2.5,slabM:.5,rampLengthM:70,maxGradePct:5,entryElevationM:20,exitElevationM:20};
it('designs connected ramps and rejects inadequate length/grade/clearance',()=>{
 const result=underpassDesign(road,design);expect(result.errors).toEqual([]);expect(result.coveredLengthM).toBeCloseTo(40,2);expect(result.vertical.pvis[1]?.elevation).toBe(17);
 expect(underpassDesign(road,{...design,rampLengthM:20}).errors.some(x=>x.includes('oltre limite'))).toBe(true);
 expect(underpassDesign(road,{...design,clearanceM:3}).errors.some(x=>x.includes('soletta'))).toBe(true);
 expect(underpassDesign(road,{...design,rampLengthM:100}).errors.some(x=>x.includes('corto'))).toBe(true);
});
it('uses the authored road operation without moving nodes and excludes motor traffic',()=>{
 const net={nodes:{a:{id:'a',at:origin},b:{id:'b',at:road.axis[1]!}},roads:{r:road},assets:{},areas:{},zones:{},junctions:{},roundabouts:{},signalPlans:{}} as Network;
 const result=setUnderpass.apply(net,{roadId:'r',design});expect(result.nodes).toBe(net.nodes);expect(result.roads.r?.vertical?.pvis.length).toBe(4);expect(net.roads.r?.vertical).toBeUndefined();expect(result.roads.r?.roadClass).toBe('footway');expect(buildGraph(result,f,{mode:'car',day:0,minutes:600}).edges).toHaveLength(0);expect(buildGraph(result,f,{mode:'emergency',day:0,minutes:600}).edges).toHaveLength(0);expect(buildGraph(result,f,{mode:'walk',day:0,minutes:600}).edges).toHaveLength(2);
});

it('restores original road access when a pedestrian passage is converted back',()=>{
 const net={nodes:{a:{id:'a',at:origin},b:{id:'b',at:road.axis[1]!}},roads:{r:road},assets:{},areas:{},zones:{},junctions:{},roundabouts:{},signalPlans:{}} as Network;
 const pedestrian=setUnderpass.apply(net,{roadId:'r',design});
 const edited=setUnderpass.apply(pedestrian,{roadId:'r',design:{...design,depthM:3.2,rampLengthM:75}});
 const restored=setUnderpass.apply(edited,{roadId:'r',design:{...design,usage:'road'}}).roads.r!;
 expect(restored.roadClass).toBe(road.roadClass);expect(restored.lanes).toEqual(road.lanes);expect(restored.restrictions).toEqual(road.restrictions);expect(restored.tags).toEqual(road.tags);expect(restored.structure?.underpass?.usage).toBe('road');expect(restored.vertical).toBeDefined();
});

it('removing a passage restores terrain following and rejects incompatible vertical edits',()=>{
 const net={nodes:{a:{id:'a',at:origin},b:{id:'b',at:road.axis[1]!}},roads:{r:road},assets:{},areas:{},zones:{},junctions:{},roundabouts:{},signalPlans:{}} as Network;
 const passage=setUnderpass.apply(net,{roadId:'r',design});expect(roadSetVertical.validate(passage,{roadId:'r',vertical:null})[0]?.severity).toBe('error');
 const removed=roadSetStructure.apply(passage,{roadIds:['r'],structure:null}).roads.r!;expect(removed.vertical).toBeUndefined();expect(removed.structure).toBeUndefined();expect(removed.roadClass).toBe(road.roadClass);expect(removed.lanes).toEqual(road.lanes);
});
