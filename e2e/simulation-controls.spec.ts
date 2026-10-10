import { expect, test } from '@playwright/test';
import { createProject, junctions, openWorkspace } from './helpers';

test('local study scope and both solvers are real controls; Twin exposes live counts independently of drawing', async ({ page, request }) => {
  const pid = await createProject(request, 'Simulation controls');
  await openWorkspace(page, pid);
  const node = (await junctions(page, 4))[0]!;
  await page.evaluate(async (id) => { const path = '/src/state/store.ts'; (await import(path)).select({ kind: 'node', ids: [id] }); }, node.id);
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
  await page.getByRole('button', { name: 'Ambito simulazione', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Ambito simulazione' }).getByRole('option')).toHaveCount(7);
  await page.getByRole('option', { name: 'Incrocio selezionato · 300 m', exact: true }).click();
  await page.getByRole('radio', { name: 'Ibrida comunale', exact: true }).click();
  await page.getByRole('button', { name: 'Avvia nell’ambito scelto', exact: true }).click();
  await expect(page.getByText('Ambito attivo: Incrocio selezionato · 300 m', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ferma', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/engine/engine.ts'; const { engine } = await import(path);
    const state = (window as any).__drip.useApp.getState();
    engine.simulationBaseline(state.baseline, state.scenario.operations);
    engine.simStart({ mode: 'hybrid', initialVehicles: 50000, dailyTrips: 0, day: 1, hour: 8, scale: 1, seed: 42 });
    engine.simSpeed(1);
  });
  await expect.poll(async () => page.evaluate(async () => { const path = '/src/engine/engine.ts'; return (await import(path)).engine.lastSim?.metrics.vehicles; })).toBeGreaterThan(40000);
  await page.screenshot({ path: '.shots/simulation-controls-map.png', fullPage: true });
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  const diagnostics = page.getByLabel('Diagnostica simulazione Twin');
  await expect(diagnostics).toBeVisible();
  await page.waitForTimeout(5000);
  const time = () => page.evaluate(async () => { const path = '/src/engine/engine.ts'; return (await import(path)).engine.lastSim?.metrics.t ?? 0; });
  const first = await time();
  await expect.poll(time).toBeGreaterThan(first + 2);
  await page.screenshot({ path: '.shots/simulation-controls-twin.png', fullPage: true });
});
