import {expect,it} from 'vitest';
import {SignalController,type SignalPlan} from '../src/index';
const plan:SignalPlan={id:'p',nodeId:'n',name:'Controller',mode:'actuated',cycleS:40,offsetS:0,actuation:{minGreenS:5,maxGreenS:12,gapOutS:2,extensionS:1},phases:[{id:'a',name:'A',greenGroups:['a'],pedestrianRoadIds:[],greenS:15,yellowS:3,allRedS:2},{id:'b',name:'B',greenGroups:['b'],pedestrianRoadIds:[],greenS:15,yellowS:3,allRedS:2}]};
it('extends occupied green, respects maximum, yellow and all-red, then releases the other phase',()=>{
 const c=new SignalController(plan);const demand=new Map([['a',5],['b',3]]);
 for(let i=0;i<11;i++)c.update(plan,1,demand);expect(c.aspect('a')).toBe('green');expect(c.aspect('b')).toBe('red');
 c.update(plan,1,demand);expect(c.aspect('a')).toBe('yellow');
 for(let i=0;i<3;i++)c.update(plan,1,demand);expect(c.aspect('a')).toBe('red');expect(c.aspect('b')).toBe('red');
 for(let i=0;i<2;i++)c.update(plan,1,demand);expect(c.aspect('b')).toBe('green');
});
it('never ends an occupied pedestrian crossing without five seconds of clearance',()=>{
 const p={...plan,phases:plan.phases.map((ph,i)=>i===0?{...ph,pedestrianRoadIds:['crossing']}:ph)},c=new SignalController(p),empty=new Map<string,number>();
 for(let i=0;i<10;i++)c.update(p,1,empty);expect(c.aspect('ped:crossing')).toBe('yellow');expect(c.aspect('a')).toBe('green');
 for(let i=0;i<5;i++)c.update(p,1,empty);expect(c.aspect('a')).toBe('yellow');expect(c.aspect('ped:crossing')).toBe('red');
});
