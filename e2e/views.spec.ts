import { expect, test, type Page } from '@playwright/test';
import { createProject, focus, junctions, openWorkspace } from './helpers';

/**
 * Every primary view opens without page errors or failed requests, and matches its visual baseline.
 * Baselines: `npx playwright test --update-snapshots` after an intentional visual change.
 * Raster basemaps are off (technical basemap = project data only), so screenshots are deterministic.
 */
function guard(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/thumbnail')) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

let pid = '';
test.beforeAll(async ({ request }) => { pid = await createProject(request, 'E2E viste'); });

test('hub', async ({ page }) => {
  const problems = guard(page);
  await page.goto('/');
  await expect(page.getByText('E2E viste')).toBeVisible();
  await expect(page).toHaveScreenshot('hub.png', { mask: [page.locator('.card-meta')] });
  expect(problems).toEqual([]);
});

test('workspace modes', async ({ page }) => {
  const problems = guard(page);
  await openWorkspace(page, pid);
  const j = (await junctions(page, 4))[0]!;
  await focus(page, j.at, 18.5);
  await expect(page).toHaveScreenshot('map-design.png');

  // Junction Lab on a real 4-arm junction.
  const p = await focus(page, j.at, 18.5);
  await page.keyboard.press('j');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.dock')).toContainText('Movimenti');
  await expect(page.locator('.dock')).toContainText('Attraversamento');
  // RB-12: dock content must fit its panel (no clipped columns).
  const clipped = await page.locator('.dock-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(clipped).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('junction-lab.png');
  await page.keyboard.press('Escape');

  for (const [mode, shot] of [['Analizza', 'analyze'], ['Traffico', 'traffic'], ['TPL', 'transit']] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot(`mode-${shot}.png`);
  }
  expect(problems).toEqual([]);
});

test('twin 3D matches the 2D model', async ({ page }) => {
  const problems = guard(page);
  await openWorkspace(page, pid);
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  const parity = page.getByText(/Parità 2D\/3D: (\d+)\/\1 oggetti/);
  await expect(parity).toBeVisible({ timeout: 60_000 });
  expect(problems).toEqual([]);
});

test('present before/after', async ({ page }) => {
  const problems = guard(page);
  await openWorkspace(page, pid);
  await page.getByRole('button', { name: 'Presenta', exact: true }).click();
  await expect(page.getByText('Strade modificate')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveScreenshot('present.png');
  expect(problems).toEqual([]);
});

test('narrow window keeps the shell usable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openWorkspace(page, pid);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('map-1024.png');
});
