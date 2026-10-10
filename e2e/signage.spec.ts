import { expect, test } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';
test('custom hatching edits through history and renders in both views; VMS follows project schedule', async ({page,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const pid=await createProject(request,'Signage');await openWorkspace(page,pid);
 await page.evaluate(async()=>{
  const p='/src/state/store.ts', {useApp,commit,select}=await import(p);
  const [x,y]=useApp.getState().baseline.origin;
  const result=commit('marking.set',{marking:{id:'hatch-qa',kind:'hatch',geometry:[[x-.00008,y-.00004],[x+.00008,y-.00004],[x+.00008,y+.00004],[x-.00008,y+.00004]],state:'project',provenance:{kind:'project',source:'QA'}}});
  if(!result.ok)throw Error(JSON.stringify(result));select({kind:'marking',ids:['hatch-qa']});
 });
 await page.getByLabel('Angolo strisce',{exact:true}).fill('25');await page.getByLabel('Angolo strisce',{exact:true}).press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as any).__drip.useApp.getState().network.markings['hatch-qa'].hatch.angleDeg)).toBe(25);
 await page.getByLabel('Vertice X',{exact:true}).fill('-10');await page.getByLabel('Vertice X',{exact:true}).press('Enter');
 await page.screenshot({path:'.shots/signage-editor.png',fullPage:true});
 const schedule = await page.evaluate(async()=>{
  const p='/src/state/projectTime.ts',clock=await import(p),l='/src/traffic/live.ts', {vmsMessage}=await import(l);
  const a={properties:{vmsMode:'scheduled',vmsText:'ZTL ATTIVA',vmsOutsideText:'ZTL NON ATTIVA',vmsSchedule:[{days:[0,1,2,3,4,5,6],from:'08:00',to:'10:00'}]}} as any;
  clock.setProjectWallTime('2026-10-09',540);const on=vmsMessage(a);
  clock.setProjectWallTime('2026-10-09',660);const off=vmsMessage(a);return[on,off];
 });expect(schedule).toEqual(['ZTL ATTIVA','ZTL NON ATTIVA']);
 await page.getByRole('button',{name:'Twin 3D',exact:true}).click();await page.waitForFunction(()=>Boolean((window as any).__dripTwin));
 await page.evaluate(()=>{const {viewer,Cesium:C}=(window as any).__dripTwin,[x,y]=(window as any).__drip.useApp.getState().baseline.origin;viewer.camera.lookAt(C.Cartesian3.fromDegrees(x,y,0),new C.HeadingPitchRange(0,-1.4,65));viewer.scene.requestRender();});
 await page.waitForTimeout(3500);await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);await page.screenshot({path:'.shots/signage-twin.png',fullPage:true});expect(errors).toEqual([]);
});
