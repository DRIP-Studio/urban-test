import {expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({state:{project:{id:'p'}},get:vi.fn(),subscribe:vi.fn()}));
vi.mock('../src/state/store',()=>({useApp:{getState:()=>mock.state,subscribe:mock.subscribe}}));
vi.mock('../src/api/client',()=>({api:{get:mock.get}}));
import {loadTerrain,useTerrain} from '../src/state/terrain';
it('discards a late DTM response after navigating to another project',async()=>{
 let resolve!:(value:unknown)=>void;mock.get.mockImplementation(()=>new Promise(r=>resolve=r));const loading=loadTerrain();mock.state={project:{id:'other'}};useTerrain.setState({grid:null,loaded:false});resolve({grid:{source:'Previous project terrain'}});expect(await loading).toBeNull();expect(useTerrain.getState().grid).toBeNull();expect(useTerrain.getState().loaded).toBe(false);
});
