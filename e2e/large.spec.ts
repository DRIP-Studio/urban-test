import { expect, test } from '@playwright/test';
import { API, openWorkspace } from './helpers';

test('large project: work area, whole-city overview, move the work area', async ({ page, request }) => {
  // An empty area of ~ 100 km² is a «large» project (tiled baseline, work area of 9 km²).
  const r = await request.post(`${API}/api/projects`, { data: { template: 'empty', name: 'E2E città grande', bbox: [12.40, 41.80, 12.52, 41.89] } });
  expect(r.ok()).toBeTruthy();
  const pid = (await r.json()).id as string;
  const meta = await (await request.get(`${API}/api/projects/${pid}`)).json();
  expect(meta.large).toBe(true);
  await openWorkspace(page, pid);
  const ctl = page.getByRole('button', { name: /Zona di lavoro/ });
  await expect(ctl).toBeVisible();
  await expect(ctl).toContainText('km²');
  await page.evaluate(() => (window as unknown as { __dripMap: { getMap(): { jumpTo(o: object): void } } }).__dripMap.getMap().jumpTo({ center: [12.49, 41.87], zoom: 15 }));
  await ctl.click();
  await expect.poll(async () => (await (await request.get(`${API}/api/projects/${pid}`)).json()).workArea[0], { timeout: 30_000 }).toBeGreaterThan(12.47);
  await expect(page.getByRole('button', { name: /Zona di lavoro/ })).toBeVisible({ timeout: 30_000 });
});
