import { test, expect } from '@playwright/test';
import { createProject, openWorkspace, opCount } from './helpers';

test('provider weather snapshot is native, undoable and rejects stale acquisitions', async ({ page, request }) => {
  let stale = false;
  await page.route('**/api/environment?*', route => route.fulfill({ json: {
    status: 'partial', message: 'Fixture: CAMS unavailable', weather: {
      source: 'Open-Meteo contract fixture', validAt: new Date(Date.now() - (stale ? 86400000 : 1000)).toISOString(), retrievedAt: new Date().toISOString(),
      values: { weather_code: 63, precipitation: 1, interval: 900 }, units: { precipitation: 'mm' }
    }
  } }));
  await openWorkspace(page, await createProject(request, 'Weather snapshot'));
  await page.locator('.environment-status').click();
  const dialog = page.getByRole('dialog', { name: 'Ambiente globale del progetto' });
  const before = await opCount(page);
  await dialog.getByRole('button', { name: 'Acquisisci meteo attuale' }).click();
  await expect(dialog).toContainText('WMO 63');
  await expect(page.locator('.environment-status')).toContainText('Pioggia');
  expect(await opCount(page)).toBe(before + 1);
  await page.screenshot({ path: '.shots/environment-provider.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.environment-status')).toContainText('Sereno');
  stale = true;
  await page.locator('.environment-status').click();
  await dialog.getByRole('button', { name: 'Acquisisci meteo attuale' }).click();
  await expect(page.getByText('Istante meteorologico assente o non attuale: acquisizione non applicata.', { exact: true })).toBeVisible();
  expect(await opCount(page)).toBe(before);
});

test('global environment follows wall time, freezes for study and preserves weather through undo', async ({ page, request }) => {
  await openWorkspace(page, await createProject(request, 'Global environment'));
  await page.locator('.environment-status').click();
  const dialog = page.getByRole('dialog', { name: 'Ambiente globale del progetto' });
  await dialog.getByRole('radio', { name: 'Ora reale', exact: true }).click();
  await expect(page.locator('.environment-status')).toContainText('LIVE');
  const now = await page.evaluate(async () => { const path = '/src/state/projectTime.ts'; return (await import(path)).getProjectTime().instant; });
  expect(Math.abs(Date.now() - Date.parse(now))).toBeLessThan(3000);
  const beforeWeather = await opCount(page);
  await dialog.getByRole('button', { name: 'Meteo globale' }).click();
  await dialog.getByRole('option', { name: 'Pioggia', exact: true }).click();
  await expect(page.locator('.environment-status')).toContainText('Pioggia');
  expect(await opCount(page)).toBe(beforeWeather + 1);
  await dialog.getByRole('radio', { name: 'Studio', exact: true }).click();
  const instant = await page.evaluate(async () => { const path = '/src/state/projectTime.ts'; return (await import(path)).getProjectTime().instant; });
  await page.waitForTimeout(1100);
  expect(await page.evaluate(async () => { const path = '/src/state/projectTime.ts'; return (await import(path)).getProjectTime().instant; })).toBe(instant);
  await page.screenshot({ path: '.shots/environment-control.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.environment-status')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.environment-status')).toContainText('LIVE');
  await expect(page.locator('.environment-status')).toContainText('Pioggia');
});
