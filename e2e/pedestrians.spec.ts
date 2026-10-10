import { test, expect } from '@playwright/test';
import { createProject, openWorkspace, focus } from './helpers';

test('declared pedestrian demand advances in the real worker and renders in Map and Twin', async ({ page, request }) => {
  await openWorkspace(page, await createProject(request, 'Pedestrian simulation'));
  await page.evaluate(async () => {
    const path = '/src/state/projectTime.ts'; (await import(path)).setProjectWallTime('2026-10-09', 720);
  });
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
  await page.getByLabel('Domanda pedonale', { exact: true }).fill('7200');
  await page.getByLabel('Domanda pedonale', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Avvia simulazione comunale', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ferma', exact: true })).toBeVisible();
  await page.evaluate(async () => { const path = '/src/engine/engine.ts'; (await import(path)).engine.simSpeed(30); });
  const population = () => page.evaluate(async () => { const path = '/src/engine/engine.ts'; return (await import(path)).engine.lastSim?.pedestrians?.metrics.active ?? 0; });
  await expect.poll(population).toBeGreaterThan(30);
  await page.evaluate(async () => { const path = '/src/engine/engine.ts'; (await import(path)).engine.simPause(true); });
  await page.waitForTimeout(400);
  const at = await page.evaluate(async () => { const path = '/src/engine/engine.ts', data = (await import(path)).engine.lastSim.pedestrians.data; return [data[0], data[1]] as [number, number]; });
  await focus(page, at, 19);
  await page.screenshot({ path: '.shots/pedestrians-map.png', fullPage: true });
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  await page.waitForFunction(() => !!(window as any).__dripTwin);
  await page.evaluate(at => { const { viewer, Cesium: C } = (window as any).__dripTwin; viewer.camera.lookAt(C.Cartesian3.fromDegrees(at[0], at[1], 0), new C.HeadingPitchRange(.3, -1.5, 25)); viewer.scene.requestRender(); }, at);
  await page.waitForTimeout(2500);
  await expect.poll(() => page.evaluate(() => { const {viewer,Cesium:C}=(window as any).__dripTwin;let count=0;for(let i=0;i<viewer.scene.primitives.length;i++){const collection=viewer.scene.primitives.get(i);if(collection instanceof C.BillboardCollection)for(let j=0;j<collection.length;j++)if(collection.get(j).show&&collection.get(j).id?.kind==='pedestrian')count++;}return count; })).toBeGreaterThan(0);
  await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const {viewer,Cesium:C}=(window as any).__dripTwin; let count=0; for(let i=0;i<viewer.scene.primitives.length;i++){const model=viewer.scene.primitives.get(i);if(model instanceof C.Model&&model.ready&&model.show&&model.id?.kind==='pedestrian')count++;}return count;})).toBeGreaterThan(0);
  await page.screenshot({ path: '.shots/pedestrians-twin.png', fullPage: true });
});
