import {expect,test} from '@playwright/test';
import {createProject,openWorkspace,opCount} from './helpers';
test('renderer failure isolates Twin, preserves native history, retries and returns to Map',async({page,request})=>{
 await openWorkspace(page,await createProject(request,'Renderer recovery QA'));
 await page.evaluate(async()=>{const p='/src/state/store.ts';const s=await import(p);if(!s.commit('environment.set',{weather:'cloudy',intensity:1}).ok)throw Error('Native operation failed');});const count=await opCount(page);
 await page.getByRole('button',{name:'Twin 3D',exact:true}).click();await page.waitForFunction(()=>Boolean((window as any).__dripTwin));
 await page.evaluate(()=>{const v=(window as any).__dripTwin.viewer;v.scene.renderError.raiseEvent(v.scene,new Error('QA injected render failure'));});
 await expect(page.getByText('Twin 3D non disponibile',{exact:true})).toBeVisible();expect(await opCount(page)).toBe(count);await page.screenshot({path:'.shots/renderer-recovery.png',fullPage:true});
 await page.getByRole('button',{name:'Riprova Twin 3D',exact:true}).click();await page.waitForFunction(()=>Boolean((window as any).__dripTwin));await expect(page.getByText('Twin 3D non disponibile',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{(window as any).__dripTwin.viewer.canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));});await expect(page.getByText('Twin 3D non disponibile',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Torna alla mappa',exact:true}).click();await expect(page.getByRole('application',{name:'Mappa di lavoro'})).toBeVisible();expect(await opCount(page)).toBe(count);
});
