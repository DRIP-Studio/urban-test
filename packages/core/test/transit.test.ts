import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect,it } from 'vitest';
import { applyOperation,FlowSimulation,NetworkReplayer,LocalFrame,geom,projectInstant,nextTransitDeparture,transitHeadway,type CityBaseline,type TransitLine } from '../src/index';
const baseline=JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz',import.meta.url)))).toString()) as CityBaseline;
const net=new NetworkReplayer().derive(baseline,[]).net;
const f=new LocalFrame(baseline.origin);
const road=Object.values(net.roads).find(r=>r.axis.length===2&&r.lanes.length&&geom.lengthOf(r.axis.map(q=>f.toMetric(q)))>250)!;
const length=geom.lengthOf(road.axis.map(q=>f.toMetric(q)));
const points=[.15,.5,.85].map(t=>f.toLngLat(geom.sampleAt(road.axis.map(q=>f.toMetric(q)),length*t).p));
const line:TransitLine={id:'tpl',name:'QA bus',mode:'bus',color:'#e8772e',line:[points[0]!,points[2]!],stops:points.map((at,i)=>({id:`s${i}`,name:`Stop ${i}`,at,arrivalsPerHour:360,alightFraction:1})),headways:{peak:2,offpeak:5,evening:10,weekend:15},firstDeparture:'08:00',lastDeparture:'20:00',vehicle:'Bus',capacity:30,speedKmh:30,dwellS:10};
it('uses peak/weekend/overnight slots and suppresses zero-frequency service',()=>{
 expect(transitHeadway(line,1,480)).toBe(2);expect(transitHeadway(line,6,480)).toBe(15);
 expect(nextTransitDeparture(line,1,8*3600+1)).toBe(8*3600+120);
 expect(nextTransitDeparture({...line,headways:{...line.headways,peak:0}},1,8*3600)).toBe(9*3600);
 expect(nextTransitDeparture({...line,firstDeparture:'23:00',lastDeparture:'02:00'},1,60*60)).toBe(60*60);
});
it('runs actual road bus stops, passenger boarding, dwell, completions and bounded rendering',()=>{
 const flow=new FlowSimulation({...net,transit:[line]},baseline,{clock:{anchor:projectInstant('2026-10-09',480,'Europe/Rome'),timeZone:'Europe/Rome',durationS:600,speed:1,holiday:false},mode:'hybrid',day:4,hour:8,dailyTrips:0,scale:1,seed:42});
 let stoppedAtStop=false;let picked=0;
 for(let i=0;i<2400;i++){flow.step(.25);if(i%4===0){const frame=flow.frameData({budget:20,trackedId:picked||undefined});if(!picked&&frame.data.length)picked=frame.data[5]!;if(frame.tracked?.transit?.dwellRemainingS && frame.tracked.speedKmh===0)stoppedAtStop=true;}}
 const stats=flow.frameData({budget:0}).metrics.transit![0]!;
 expect(stats.issue).toBeUndefined();expect(stats.departed).toBeGreaterThanOrEqual(4);expect(stats.completed).toBeGreaterThan(0);expect(stats.boarded).toBeGreaterThan(0);expect(stoppedAtStop).toBe(true);
});
it('renders and tracks actual vehicles following a dedicated rail alignment',()=>{
 const flow=new FlowSimulation({...net,transit:[{...line,mode:'train',stops:[],speedKmh:45}]},baseline,{day:4,hour:8,dailyTrips:0,scale:1,seed:42});
 flow.step(1);const first=flow.frameData();expect(first.data.length).toBe(6);expect(first.data[3]).toBe(6);const id=first.data[5]!;
 for(let i=0;i<10;i++)flow.step(1);const next=flow.frameData({budget:1,trackedId:id});expect(next.tracked?.transit?.lineId).toBe('tpl');expect(next.tracked?.speedKmh).toBeGreaterThan(0);expect(next.data[0]).not.toBe(first.data[0]);
});

it('counts scheduled slots even when a disconnected line cannot depart',()=>{
 const far=f.toLngLat([100000,100000]),bad={...line,line:[far,f.toLngLat([100100,100000])],stops:[]};
 const flow=new FlowSimulation({...net,transit:[bad]},baseline,{clock:{anchor:projectInstant('2026-10-09',480,'Europe/Rome'),timeZone:'Europe/Rome',durationS:300,speed:1,holiday:false},day:4,hour:8,dailyTrips:0,scale:1,seed:42});
 for(let i=0;i<1200;i++)flow.step(.25);
 const metrics=flow.frameData({budget:0}).metrics.transit![0]!;
 expect(metrics.issue).toBeDefined();expect(metrics.scheduled).toBe(3);expect(metrics.departed).toBe(0);expect(metrics.missed).toBe(3);
});
it('keeps departure counts monotonic across midnight on overnight service',()=>{
 const night={...line,mode:'train' as const,stops:[],firstDeparture:'23:00',lastDeparture:'02:00',headways:{peak:1,offpeak:1,evening:1,weekend:1}};
 const flow=new FlowSimulation({...net,transit:[night]},baseline,{clock:{anchor:projectInstant('2026-10-09',1439,'Europe/Rome'),timeZone:'Europe/Rome',durationS:180,speed:1,holiday:false},day:4,hour:23.983333333,dailyTrips:0,scale:1,seed:42});
 for(let i=0;i<720;i++)flow.step(.25);
 const metrics=flow.frameData({budget:0}).metrics.transit![0]!;
 // The integration interval is [23:59, 00:02): the endpoint slot belongs to the next step.
 expect(metrics.scheduled).toBe(3);expect(metrics.departed).toBe(3);expect(metrics.missed).toBe(0);
});

it('stores validated bike sharing in the native scenario instead of a parallel editable document',()=>{
 const bike={system:'QA bike',dockless:false,stations:[{id:'bs',name:'Central',at:baseline.origin,docks:15,ebikeShare:.4}]};
 const operation={id:'op-bike',type:'transit.set',payload:{lines:[],bikeShare:bike},at:'',author:'QA'};
 const applied=applyOperation(net,operation).net;expect(applied.bikeShare?.stations[0]?.docks).toBe(15);expect(net.bikeShare).toBeUndefined();
 expect(()=>applyOperation(net,{...operation,payload:{lines:[],bikeShare:{...bike,stations:[{...bike.stations[0]!,docks:-1}]}}})).toThrow();
});
