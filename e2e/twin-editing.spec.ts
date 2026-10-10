import { expect, test } from '@playwright/test';
import { createProject, openWorkspace, opCount } from './helpers';

test('Twin edits share history, real gizmo commits once, and actual solver vehicle can be followed', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const pid = await createProject(request, 'Twin editing'); await openWorkspace(page, pid);
  await page.evaluate(async () => {
    const path = '/src/state/store.ts', { commit, select, useApp } = await import(path);
    const s = useApp.getState(), item = s.catalogs.furniture.items.find((i: any) => /bench|panchina/i.test(i.id + i.label));
    const result = commit('asset.add', { assets: [{ id: 'twin-qa-bench', type: item.id, at: s.baseline.origin, rotationDeg: 0, state: 'project', material: item.material, properties: {}, provenance: { kind: 'project', source: 'Twin QA' } }] });
    if (!result.ok) throw new Error(JSON.stringify(result));
    select({ kind: 'asset', ids: ['twin-qa-bench'] });
  });
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  await expect(page.getByLabel('Inspector oggetti Twin')).toBeVisible();
  await page.getByRole('radio', { name: 'Incrocio', exact: true }).click();
  await page.getByLabel('Twin Z', { exact: true }).fill('1.25'); await page.getByLabel('Twin Z', { exact: true }).press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__drip.useApp.getState().network.assets['twin-qa-bench'].elevationM)).toBe(1.25);
  await page.getByLabel('Twin Z', { exact: true }).blur();
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__drip.useApp.getState().network.assets['twin-qa-bench'].elevationM ?? 0)).toBe(0);
  await page.getByLabel('Twin Z', { exact: true }).blur();
  await page.waitForTimeout(2000);
  const count = await opCount(page);
  const handle = await page.evaluate(() => {
    const { viewer, Cesium: C } = (window as any).__dripTwin;
    const entity = viewer.entities.values.find((e: any) => e.properties?.gizmoAxis?.getValue() === 'x');
    const point = C.SceneTransforms.worldToWindowCoordinates(viewer.scene, entity.position.getValue(viewer.clock.currentTime));
    const box = viewer.canvas.getBoundingClientRect(); return { x: box.left + point.x, y: box.top + point.y };
  });
  await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(handle.x + 35, handle.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => opCount(page)).toBe(count + 1);
  await page.screenshot({ path: '.shots/twin-editing.png', fullPage: true });
  await page.evaluate(async () => {
    const p = '/src/engine/engine.ts', t = '/src/state/projectTime.ts'; const { engine } = await import(p);
    const s = (window as any).__drip.useApp.getState(); engine.simulationBaseline(s.baseline, s.scenario.operations);
    engine.simStart({ mode: 'hybrid', initialVehicles: 1000, dailyTrips: 0, day: 1, hour: 8, scale: 1, seed: 42, clock: (await import(t)).getProjectClock() });
  });
  await expect.poll(() => page.evaluate(async () => { const p = '/src/engine/engine.ts'; return (await import(p)).engine.lastSim?.metrics.t ?? 0; })).toBeGreaterThan(1);
  await page.evaluate(async () => {
    const p = '/src/engine/engine.ts', ui = '/src/twin/viewState.ts'; const { engine } = await import(p);
    const id = engine.lastSim.data[5]; (await import(ui)).pickTwinVehicle(id);
  });
  await page.getByRole('button', { name: 'Segui veicolo', exact: true }).click();
  await expect(page.getByLabel('Telemetria veicolo Twin')).toContainText('Corsia');
  for (const name of ['Dall’alto', 'Laterale', 'Davanti', 'Drone / orbita', 'Chase']) {
    await page.getByLabel('Camera inseguimento', { exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '.shots/twin-follow.png', fullPage: true });
  expect(errors).toEqual([]);
});
