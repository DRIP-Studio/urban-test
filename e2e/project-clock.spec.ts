import { expect, test } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';

test('one undoable clock drives calendar, routing and actual deterministic solver seeking', async ({ page, request }) => {
  const pid = await createProject(request, 'Project clock');
  await openWorkspace(page, pid);
  await page.getByLabel('Data progetto', { exact: true }).fill('2026-11-17');
  await page.getByLabel('Ora progetto', { exact: true }).fill('07:45');
  await expect(page.getByText('Martedì', { exact: true }).first()).toBeVisible();
  const configured = await page.evaluate(async () => {
    const path = '/src/state/projectTime.ts'; return (await import(path)).getProjectClock();
  });
  expect(configured.anchor).toBe('2026-11-17T06:45:00.000Z');
  await page.evaluate(async () => {
    const p = '/src/engine/engine.ts', t = '/src/state/projectTime.ts';
    const { engine } = await import(p), { getProjectClock } = await import(t);
    const state = (window as any).__drip.useApp.getState();
    engine.simulationBaseline(state.baseline, state.scenario.operations);
    engine.simStart({ mode: 'hybrid', initialVehicles: 1000, dailyTrips: 0, day: 1, hour: 7.75, scale: 1, seed: 42, clock: getProjectClock() });
  });
  await expect.poll(() => page.evaluate(async () => { const p = '/src/engine/engine.ts'; return (await import(p)).engine.lastSim?.metrics.t ?? 0; })).toBeGreaterThan(1);
  await page.evaluate(async () => { const p = '/src/state/projectTime.ts'; (await import(p)).seekProjectTime(65); });
  await expect.poll(() => page.evaluate(async () => { const p = '/src/engine/engine.ts'; return (await import(p)).engine.lastSim?.metrics.t; })).toBe(65);
  await expect(page.getByLabel('Ora progetto', { exact: true })).toHaveValue('07:46');
  await page.evaluate(async () => { const p = '/src/state/projectTime.ts'; (await import(p)).configureProjectClock({ speed: 10 }); });
  await page.waitForTimeout(400);
  await expect(page.getByLabel('Ora progetto', { exact: true })).toHaveValue('07:46');
  expect(await page.evaluate(async () => { const p = '/src/engine/engine.ts'; return (await import(p)).engine.lastSim?.metrics.t; })).toBe(65);
  await page.screenshot({ path: '.shots/project-clock-map.png', fullPage: true });
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  await expect(page.getByLabel('Data progetto', { exact: true })).toHaveValue('2026-11-17');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '.shots/project-clock-twin.png', fullPage: true });
});
