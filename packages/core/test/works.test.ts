import {expect,it} from 'vitest';
import {networkAtWorksDate,worksErrors,type Network,type WorksPhase} from '../src/index';
const net={nodes:{},roads:{},assets:{a:{id:'a',type:'urban.solid',at:[14,41],rotationDeg:0,state:'project',properties:{},provenance:{kind:'project',source:'test'}}},areas:{},zones:{},junctions:{},roundabouts:{},signalPlans:{}} as Network;
const phase:WorksPhase={id:'p',name:'Construction',startDate:'2027-01-01',endDate:'2027-01-31',status:'planned',budget:1000,contractor:'',category:'Test',dependencies:[],targets:[{kind:'asset',id:'a',action:'construct'}]};
it('projects future construction and demolition without mutating the authored network',()=>{const authored={...net,works:[phase]};expect(networkAtWorksDate(authored,'2026-12-31').assets.a?.state).toBe('removed');expect(networkAtWorksDate(authored,'2027-01-31').assets.a?.state).toBe('removed');expect(networkAtWorksDate(authored,'2027-02-01').assets.a?.state).toBe('project');expect(authored.assets.a?.state).toBe('project');const demolish={...authored,works:[{...phase,targets:[{kind:'asset' as const,id:'a',action:'demolish' as const}]}]};expect(networkAtWorksDate(demolish,'2026-12-31').assets.a?.state).toBe('project');expect(networkAtWorksDate(demolish,'2027-01-01').assets.a?.state).toBe('removed');});
it('rejects missing or cyclic dependencies, impossible calendars and negative budgets',()=>{expect(worksErrors([phase],net)).toEqual([]);expect(worksErrors([{...phase,endDate:'2027-02-30',budget:-1}],net)).not.toEqual([]);expect(worksErrors([{...phase,dependencies:['b']},{...phase,id:'b',dependencies:['p']}],net)).toContain('Dipendenze cicliche');});

it('projects demolition then reconstruction in event order and rejects contradictory lifecycles',()=>{
 const demolish:WorksPhase={...phase,id:'d',startDate:'2026-11-01',endDate:'2026-11-30',targets:[{kind:'asset',id:'a',action:'demolish'}]};
 const authored={...net,works:[phase,demolish]};
 expect(worksErrors(authored.works,net)).toEqual([]);expect(networkAtWorksDate(authored,'2026-10-31').assets.a?.state).toBe('project');expect(networkAtWorksDate(authored,'2026-11-01').assets.a?.state).toBe('removed');expect(networkAtWorksDate(authored,'2027-01-31').assets.a?.state).toBe('removed');expect(networkAtWorksDate(authored,'2027-02-01').assets.a?.state).toBe('project');
 expect(worksErrors([phase,{...phase,id:'duplicate',startDate:'2027-03-01',endDate:'2027-03-31'}],net)).toContain('Costruzione e demolizione dello stesso oggetto devono alternarsi in date distinte');
});
