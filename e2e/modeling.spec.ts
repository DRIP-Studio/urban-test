import {expect,test} from '@playwright/test';
import {createProject,openWorkspace} from './helpers';
test('urban solids push/pull, undo, grouped arrays and native Twin geometry',async({page,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openWorkspace(page,await createProject(request,'Urban modeling'));
 await page.evaluate(async()=>{const p='/src/state/store.ts';(await import(p)).openDock('modeling');});
 await page.getByRole('button',{name:'Crea solido nel progetto',exact:true}).click();
 await expect(page.getByLabel('Push pull altezza')).toBeVisible();await page.getByLabel('Push pull altezza').fill('4');await page.getByLabel('Push pull altezza').press('Enter');
 await expect.poll(()=>page.evaluate(()=>{const s=(window as any).__drip.useApp.getState();return s.network.assets[s.selection.ids[0]].solid.heightM;})).toBe(4);
 await page.keyboard.press('Control+z');await expect(page.getByLabel('Push pull altezza')).toHaveValue('2');
 await page.getByRole('button',{name:'Inserisci foro nella prima sagoma',exact:true}).click();await expect.poll(()=>page.evaluate(()=>{const s=(window as any).__drip.useApp.getState();return s.network.assets[s.selection.ids[0]].solid.polygons[0].length;})).toBe(2);
 await page.getByRole('button',{name:'Crea serie lineare',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Object.values((window as any).__drip.useApp.getState().network.assets).filter((a:any)=>a.solid).length)).toBe(3);
 await page.screenshot({path:'.shots/modeling-editor.png',fullPage:true});
 await page.evaluate(async()=>{const p='/src/state/store.ts';(await import(p)).setDock(null);});await page.getByRole('button',{name:'Twin 3D',exact:true}).click();await page.waitForFunction(()=>Boolean((window as any).__dripTwin));
 await page.waitForFunction(()=>{const {viewer}=(window as any).__dripTwin,s=(window as any).__drip.useApp.getState();return viewer.scene.primitives._primitives.some((m:any)=>m.id===s.selection.ids[0]&&m.ready);});
 await page.evaluate(()=>{const {viewer,Cesium:C}=(window as any).__dripTwin,s=(window as any).__drip.useApp.getState(),a=s.network.assets[s.selection.ids[0]];viewer.camera.lookAt(C.Cartesian3.fromDegrees(...a.at,1),new C.HeadingPitchRange(.5,-.5,25));viewer.scene.requestRender();});await page.waitForTimeout(1800);await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);await page.screenshot({path:'.shots/modeling-twin.png',fullPage:true});expect(errors).toEqual([]);
});
