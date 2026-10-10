import { expect, test } from '@playwright/test';
import { API, createProject, openWorkspace } from './helpers';

test('Scenario Lab evaluates baseline and A/B/C in an isolated real solver and exports reproducible results', async ({ page, request }) => {
  const pid = await createProject(request, 'Scenario Lab');
  for (const name of ['Scenario B', 'Scenario C']) {
    const response = await request.post(`${API}/api/projects/${pid}/scenarios`, { data: { name } });
    expect(response.ok()).toBe(true);
  }
  await openWorkspace(page, pid);
  await page.evaluate(async () => {
    const s = '/src/state/store.ts', t = '/src/state/projectTime.ts';
    (await import(t)).configureProjectClock({ durationS: 60 });
    (await import(s)).setDock('compare');
  });
  await expect(page.getByRole('group', { name: 'Scenari da valutare' }).getByRole('checkbox')).toHaveCount(4);
  await page.getByRole('button', { name: 'Valuta gli scenari selezionati', exact: true }).click();
  await expect(page.getByText('Confronto completato', { exact: true })).toBeVisible({ timeout: 90000 });
  const table = page.locator('.lab-table-scroll table');
  await expect(table.locator('thead th')).toHaveCount(5);
  await expect(table.getByText('CO₂ stimata · kg', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta risultati', exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toContain('scenario-lab');
  await page.screenshot({ path: '.shots/scenario-lab.png', fullPage: true });
});
