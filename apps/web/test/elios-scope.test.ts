import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({state:{project:{id:'p'},scenario:{id:'s',operations:[] as unknown[]}},commit:vi.fn()}));
vi.mock('../src/state/store',()=>({useApp:{getState:()=>mock.state},commit:mock.commit}));
import {captureEliosScope,setEliosSignal} from '../src/elios/scope';
beforeEach(()=>{mock.state={project:{id:'p'},scenario:{id:'s',operations:[]}};setEliosSignal(null);mock.commit.mockImplementation((type,payload)=>{mock.state.scenario.operations=[...mock.state.scenario.operations,{type,payload}];return{ok:true,issues:[]};});});
it('accepts own commits but rejects foreign edits before any additional mutation',()=>{
 const guard=captureEliosScope();guard.commit('a',{});guard.commit('b',{});expect(mock.commit).toHaveBeenCalledTimes(2);
 mock.state.scenario.operations=[...mock.state.scenario.operations,{type:'user edit'}];expect(()=>guard.commit('c',{})).toThrow('Scenario modificato');expect(mock.commit).toHaveBeenCalledTimes(2);
});
it('rejects project switches and cancellation while a tool is awaiting data',()=>{
 const guard=captureEliosScope();mock.state.project={id:'another'};expect(()=>guard.commit('a',{})).toThrow('Scenario modificato');expect(mock.commit).not.toHaveBeenCalled();
 const controller=new AbortController();setEliosSignal(controller.signal);const canceled=captureEliosScope();controller.abort();expect(()=>canceled.commit('a',{})).toThrow('annullata');expect(mock.commit).not.toHaveBeenCalled();
});
