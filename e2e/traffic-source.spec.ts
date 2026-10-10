import { test, expect } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';

test('source selection fuses observed roads, excludes stale feeds and seeds the real simulation', async ({ page, request }) => {
  const pid = await createProject(request, 'Traffic source contract fixture');
  await openWorkspace(page, pid);
  const road = await page.evaluate(() => Object.values((window as any).__drip.useApp.getState().network.roads).find((r: any) => r.oneway === 'no' && r.roadClass === 'residential') as any);
  let stale = false;
  // Explicit provider contract fixture: no credentials or production observations are invented.
  await page.route('**/api/traffic/live?*', route => route.fulfill({ json: {
    status: 'ok', provider: 'Fixture HERE contract', capturedAt: new Date(Date.now() - (stale ? 600000 : 0)).toISOString(), retrievedAt: new Date().toISOString(),
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: road.axis }, properties: { id: 'fixture-observed', speedKmh: 9, freeFlowKmh: 36, confidence: .95, flowVph: null, densityVehKm: null } }], incidents: [],
  } }));
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Fonte traffico', exact: true }).getByRole('radio', { name: 'Live', exact: true }).click();
  const sources = page.getByRole('radiogroup', { name: 'Fonte traffico condivisa' });
  await sources.getByRole('radio', { name: 'Live', exact: true }).click();
  const traffic = () => page.evaluate(async () => { const path = '/src/traffic/live.ts'; return (await import(path)).useLive.getState().traffic; });
  await expect.poll(async () => (await traffic())?.coverage.observedDirections).toBeGreaterThan(0);
  expect(Object.values((await traffic()).segments).some((s: any) => s.flowVph !== null)).toBe(false);
  await page.screenshot({ path: '.shots/traffic-source-live.png', fullPage: true });
  await sources.getByRole('radio', { name: 'Ibrido', exact: true }).click();
  await expect.poll(async () => (await traffic())?.coverage.estimatedDirections).toBeGreaterThan(0);
  await expect.poll(async () => (await traffic())?.calibration.speedRatio).toBe(.25);
  await page.screenshot({ path: '.shots/traffic-source-hybrid.png', fullPage: true });
  stale = true;
  await page.getByRole('button', { name: 'Aggiorna area visibile' }).click();
  await expect.poll(async () => (await traffic())?.coverage.observedDirections).toBe(0);
  await expect(page.getByText(/Rilevazione scaduta, esclusa dai calcoli/)).toBeVisible();
  expect((await traffic()).calibration.speedRatio).toBe(1);
  await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
  await page.getByRole('button', { name: 'Avvia simulazione comunale', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ferma', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => { const path = '/src/engine/engine.ts'; return (await import(path)).engine.lastSim?.metrics.t ?? 0; })).toBeGreaterThan(0);
  const seed = await page.evaluate(async () => { const path = '/src/engine/engine.ts'; return (await import(path)).engine.lastSimOptions?.trafficState; });
  expect(seed.mode).toBe('hybrid');
  expect(seed.coverage.observedDirections).toBe(0);
  expect(seed.coverage.estimatedDirections).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Ferma', exact: true }).click();
});
