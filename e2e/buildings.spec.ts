import { expect, test } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';

test('building styles use actual geometry and shared history; weather is explicitly simulated', async ({ page, request }) => {
  const errors: string[]=[];page.on('pageerror',(e)=>errors.push(e.message));
  const pid=await createProject(request,'Building geometry');await openWorkspace(page,pid);
  const id=await page.evaluate(async()=>{
    const p='/src/state/store.ts',{useApp,select}=await import(p),s=useApp.getState(),o=s.baseline.origin;
    const buildings=Object.values(s.baseline.buildings) as any[];
    buildings.sort((a,b)=>Math.hypot(a.footprint[0][0]-o[0],a.footprint[0][1]-o[1])-Math.hypot(b.footprint[0][0]-o[0],b.footprint[0][1]-o[1]));
    select({kind:'building',ids:[buildings[0].id]});return buildings[0].id;
  });
  await page.getByLabel('Altezza edificio',{exact:true}).fill('15');await page.getByLabel('Altezza edificio',{exact:true}).press('Enter');
  await page.getByLabel('Piani edificio',{exact:true}).fill('5');await page.getByLabel('Piani edificio',{exact:true}).press('Enter');
  await page.getByLabel('Copertura edificio',{exact:true}).click();await page.getByRole('option',{name:'Due falde',exact:true}).click();
  await page.getByRole('switch',{name:'Balconi procedurali',exact:true}).click();
  await expect.poll(()=>page.evaluate((id)=>(window as any).__drip.useApp.getState().network.buildingStyles[id].balconies,id)).toBe(true);
  await page.getByRole('button',{name:'Twin 3D',exact:true}).click();
  await page.waitForFunction(()=>Boolean((window as any).__dripTwin));
  await page.evaluate((id)=>{
    const {viewer,Cesium:C}=(window as any).__dripTwin,s=(window as any).__drip.useApp.getState(),b=s.baseline.buildings[id];
    const center=b.footprint.reduce((sum:number[],p:number[])=>[sum[0]+p[0]/b.footprint.length,sum[1]+p[1]/b.footprint.length],[0,0]);
    viewer.camera.lookAt(C.Cartesian3.fromDegrees(center[0],center[1],8),new C.HeadingPitchRange(-.8,-.4,65));viewer.scene.requestRender();
  },id);
  await page.waitForTimeout(4000);await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await page.screenshot({path:'.shots/building-geometry.png',fullPage:true});
  await page.getByLabel('Meteo simulato',{exact:true}).click();await page.getByRole('option',{name:'Pioggia · simulata',exact:true}).click();
  await page.waitForTimeout(1500);await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await page.screenshot({path:'.shots/weather-rain.png',fullPage:true});expect(errors).toEqual([]);
});
