import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {LocalFrame,NetworkReplayer,fuseTraffic,route,trafficKey,type CityBaseline,type TrafficObservation,type TrafficSegment} from '../src/index';
const baseline=JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz',import.meta.url)))).toString()) as CityBaseline;
const source=new NetworkReplayer().derive(baseline,[]).net,frame=new LocalFrame(baseline.origin),at=(x:number,y=0)=>frame.toLngLat([x,y]);
const template=Object.values(source.roads).find(r=>r.oneway==='no'&&r.lanes.some(l=>l.modes.includes('car')))!;
const roads=Object.fromEntries([0,1,2].map(i=>[`r${i}`,{...template,id:`r${i}`,from:`n${i}`,to:`n${i+1}`,axis:[at(i*100),at((i+1)*100)],speedKmh:40,tags:{},restrictions:undefined}]));
const net={...source,roads,nodes:Object.fromEntries([0,1,2,3].map(i=>[`n${i}`,{id:`n${i}`,at:at(i*100)}])),zones:{},signalPlans:{},roundabouts:{},junctions:{}};
const now=Date.parse('2026-10-09T12:00:00Z');
const observation=(changes:Partial<TrafficObservation>={}):TrafficObservation=>({id:'measured',geometry:[at(0),at(300)],source:'live',provider:'Test provider',capturedAt:new Date(now-60000).toISOString(),retrievedAt:new Date(now).toISOString(),speedKmh:10,freeFlowKmh:40,flowVph:null,densityVehKm:null,confidence:.9,...changes});
it('active closures survive flow updates in either response order',()=>{
 const closed=observation({id:'closure',closed:true,speedKmh:null,confidence:.3}),flow=observation();
 for(const observations of [[closed,flow],[flow,closed]]){
  const state=fuseTraffic(net,baseline.origin,'live',observations,[],now);
  expect(state.segments[trafficKey('r1',true)]?.closed).toBe(true);
  expect(state.calibration.samples).toBe(0);
 }
});
it('calibration counts each selected observation once regardless of road segmentation',()=>{
 const state=fuseTraffic(net,baseline.origin,'live',[observation()],[],now);
 expect(state.coverage.observedDirections).toBe(3);
 expect(state.calibration.samples).toBe(1);
});
it('does not extrapolate a short feed shape past its endpoints',()=>{
 const short={...net,roads:{r0:{...roads.r0!,axis:[at(105),at(115)]}}};
 const state=fuseTraffic(short,baseline.origin,'live',[observation({geometry:[at(0),at(100)]})],[],now);
 expect(state.coverage.observedDirections).toBe(0);
});
it('maps one provider shape to actual directed roads and changes their route ETA without inventing counts',()=>{
 const state=fuseTraffic(net,baseline.origin,'live',[observation()],[],now);
 expect(state.coverage.observedDirections).toBe(3);expect(state.segments[trafficKey('r1',false)]).toBeUndefined();expect(state.segments[trafficKey('r1',true)]?.flowVph).toBeNull();
 const ctx={mode:'car' as const,day:4,minutes:840},free=route(net,baseline.origin,at(10),at(290),ctx),live=route(net,baseline.origin,at(10),at(290),{...ctx,trafficState:state});
 expect(live.found).toBe(true);expect(live.durationS).toBeGreaterThan(free.durationS*2.5);
 const reverse=route(net,baseline.origin,at(290),at(10),{...ctx,trafficState:state});expect(reverse.durationS).toBeLessThan(live.durationS/2);
});
it('rejects stale, future, missing timestamp and perpendicular observations',()=>{
 for(const change of [{capturedAt:null},{capturedAt:new Date(now-600000).toISOString()},{capturedAt:new Date(now+600000).toISOString()}])expect(fuseTraffic(net,baseline.origin,'live',[observation(change)],[],now).coverage.staleObservations).toBe(1);
 const bad=fuseTraffic(net,baseline.origin,'live',[observation({geometry:[at(150,-100),at(150,100)]})],[],now);expect(Object.keys(bad.segments)).toHaveLength(0);
});
it('closures remove the affected direction from the actual routing graph',()=>{
 const state=fuseTraffic(net,baseline.origin,'live',[observation({geometry:[at(100),at(200)],closed:true,speedKmh:0})],[],now);
 expect(route(net,baseline.origin,at(10),at(290),{mode:'car',day:4,minutes:840,trafficState:state}).found).toBe(false);
 expect(route(net,baseline.origin,at(290),at(10),{mode:'car',day:4,minutes:840,trafficState:state}).found).toBe(true);
});
it('hybrid fills only gaps and records observed calibration while historical timestamps remain explicit',()=>{
 const estimate:TrafficSegment={roadId:'r1',forward:false,speedKmh:32,flowVph:150,densityVehKm:4.69,confidence:.4,source:'estimated',provider:'DRIP',capturedAt:new Date(now).toISOString(),closed:false,matchDistanceM:0};
 const state=fuseTraffic(net,baseline.origin,'hybrid',[observation()],[estimate],now);
 expect(state.segments[trafficKey('r1',false)]?.speedKmh).toBe(8);expect(state.segments[trafficKey('r1',true)]?.speedKmh).toBe(10);expect(state.calibration.speedRatio).toBe(.25);
 const old=observation({source:'historical',capturedAt:'2026-09-01T12:00:00Z'});expect(fuseTraffic(net,baseline.origin,'historical',[old],[],now).coverage.observedDirections).toBe(3);
});
