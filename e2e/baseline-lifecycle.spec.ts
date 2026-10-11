import {expect,test} from '@playwright/test';
import {createProject,openWorkspace} from './helpers';
test('refreshing existing geometry preserves independent simulation and native redo',async({page,request})=>{
 await openWorkspace(page,await createProject(request,'Baseline lifecycle'));
 await page.evaluate(async()=>{
  const storePath='/src/state/store.ts',enginePath='/src/engine/engine.ts';
  const store=await import(storePath),{engine}=await import(enginePath),state=store.useApp.getState();
  const road=Object.values(state.network.roads)[0] as any;
  if(!store.commit('road.update',{roadId:road.id,changes:{name:'Redo preserved'}}).ok)throw Error('Edit rejected');
  store.undo();
  engine.simulationBaseline(state.baseline,store.useApp.getState().scenario.operations);
  engine.simStart({mode:'hybrid',initialVehicles:1000,dailyTrips:0,day:1,hour:8,scale:1,seed:42});
 });
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/engine/engine.ts';return (await import(p)).engine.lastSim?.metrics.t??0;})).toBeGreaterThan(2);
 const before=await page.evaluate(async()=>{
  const p='/src/engine/engine.ts',s='/src/state/store.ts';
  const {engine}=await import(p),store=await import(s),t=engine.lastSim.metrics.t;
  await store.reloadBaseline();
  if(!store.useApp.getState().canRedo)throw Error('Redo lost during refresh');
  return t;
 });
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/engine/engine.ts';return (await import(p)).engine.lastSim?.metrics.t??0;})).toBeGreaterThan(before);
 await page.evaluate(async()=>{const p='/src/state/store.ts';const store=await import(p);store.redo();if(!Object.values(store.useApp.getState().network.roads).some((r:any)=>r.name==='Redo preserved'))throw Error('Redo did not restore edit');});
});
