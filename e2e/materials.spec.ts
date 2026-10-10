import { expect, test } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';

test('custom texture uploads to project, applies through history, renders in Map and Twin', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const pid = await createProject(request, 'Materials'); await openWorkspace(page, pid);
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    g.fillStyle = '#baab97'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#64584e'; g.lineWidth = 3; g.strokeRect(0, 0, 32, 32); g.strokeRect(32, 32, 32, 32); return c.toDataURL().split(',')[1]!;
  });
  await page.evaluate(async () => {
    const path = '/src/state/store.ts', { useApp, commit, select, openDock } = await import(path);
    const [x, y] = useApp.getState().baseline.origin;
    commit('area.set', { area: { id: 'material-qa', kind: 'plaza', polygon: [[x-.00007,y-.00004],[x+.00007,y-.00004],[x+.00007,y+.00004],[x-.00007,y+.00004]], material: 'asphalt', state: 'project', properties: {}, provenance: { kind: 'project', source: 'Material QA' } } });
    select({ kind: 'area', ids: ['material-qa'] }); openDock('materials');
  });
  await page.getByLabel('Importa texture', { exact: true }).setInputFiles({ name: 'pavers.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('button', { name: 'Rimuovi immagine' })).toBeVisible();
  await page.getByLabel('Materiale scaleM', { exact: true }).fill('2'); await page.getByLabel('Materiale scaleM', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Applica alla selezione', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__drip.useApp.getState().network.areas['material-qa'].material)).toMatch(/^custom\./);
  await page.locator('.sheet-body').evaluate((el) => el.scrollTop = 0);
  await page.screenshot({ path: '.shots/material-editor.png', fullPage: true });
  await page.evaluate(async () => { const p = '/src/state/store.ts'; (await import(p)).openDock('materials'); (await import(p)).setDock('materials'); });
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).__dripTwin));
  await page.evaluate(() => {
    const { viewer, Cesium: C } = (window as any).__dripTwin, s = (window as any).__drip.useApp.getState(), [x,y] = s.baseline.origin;
    viewer.camera.lookAt(C.Cartesian3.fromDegrees(x,y,0), new C.HeadingPitchRange(0,-1.2,90)); viewer.scene.requestRender();
  });
  await page.waitForTimeout(5000); await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await page.screenshot({ path: '.shots/material-twin.png', fullPage: true });
  expect(errors).toEqual([]);
});
