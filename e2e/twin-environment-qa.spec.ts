import { test, expect } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';

test('Twin renders the shared calendar and weather across the daylight QA matrix', async ({ page, request }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page, await createProject(request, 'Twin environment QA'));
  await page.getByRole('button', {name:'Twin 3D',exact:true}).click();
  await page.waitForFunction(() => !!(window as any).__dripTwin);
  await page.evaluate(() => {
    const {viewer,Cesium:C}=(window as any).__dripTwin;
    viewer.camera.lookAt(C.Cartesian3.fromDegrees(14.2745,40.94165,0),new C.HeadingPitchRange(.3,-.65,420));
    viewer.scene.requestRender();
  });
  await page.waitForTimeout(3000);
  for(const scene of [
    {name:'dawn',minutes:425,weather:'clear',intensity:1},
    {name:'midday',minutes:780,weather:'clear',intensity:1},
    {name:'sunset',minutes:1095,weather:'clear',intensity:1},
    {name:'blue-hour',minutes:1125,weather:'clear',intensity:1},
    {name:'night',minutes:1320,weather:'clear',intensity:1},
    {name:'rain',minutes:780,weather:'rain',intensity:.3},
    {name:'heavy-rain',minutes:780,weather:'rain',intensity:1},
  ]) {
    await page.evaluate(async scene => {
      const p='/src/state/projectTime.ts',s='/src/state/store.ts';
      (await import(p)).setProjectWallTime('2026-10-09',scene.minutes);
      const result=(await import(s)).commit('environment.set',{weather:scene.weather,intensity:scene.intensity,weatherSource:'simulated'});
      if(!result.ok)throw Error(JSON.stringify(result.issues));
    },scene);
    await page.waitForTimeout(900);
    await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
    const rendering=await page.evaluate(()=>{const {viewer}=(window as any).__dripTwin;return {width:viewer.canvas.width,height:viewer.canvas.height,stages:viewer.scene.postProcessStages.length};});
    expect(rendering.width).toBeGreaterThan(300);
    if(scene.weather==='rain')expect(rendering.stages).toBeGreaterThan(0);
    await page.screenshot({path:`.shots/twin-${scene.name}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});
