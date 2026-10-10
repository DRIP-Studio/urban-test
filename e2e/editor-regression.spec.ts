import { expect, test } from '@playwright/test';
import { createProject, focus, junctions, opCount, openWorkspace, waitSaved } from './helpers';

test('global snap switches every coordinate snap off, persists and restores preferences', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E snap');
  await openWorkspace(page, pid);
  const button = page.getByRole('button', { name: 'Snap on · F9', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(page.getByRole('button', { name: 'Snap off · F9', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await openWorkspace(page, pid);
  await expect(page.getByRole('button', { name: 'Snap off · F9', exact: true })).toBeVisible();
  await page.keyboard.press('F9');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('roundabout inspector edits rebuild the model, undo and persist; search selects the object', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E roundabout controls');
  await openWorkspace(page, pid);
  const node = (await junctions(page, 4))[0]!;
  const p = await focus(page, node.at);
  await page.keyboard.press('o');
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: 'Crea rotatoria' }).click();
  await expect.poll(() => opCount(page)).toBe(1);
  const state = () => page.evaluate(() => {
    const s = (window as any).__drip.useApp.getState();
    const rb = Object.values(s.network.roundabouts)[0] as any;
    return { lanes: rb.lanes, width: rb.circulatoryWidthM, exit: rb.arms[0].exitRadiusM, ringLanes: Object.values(s.network.roads).filter((r: any) => r.tags?.roundabout === rb.id).map((r: any) => r.lanes.length) };
  });
  await page.getByRole('radiogroup', { name: 'Corsie anello' }).getByRole('radio', { name: '2', exact: true }).click();
  await expect.poll(async () => (await state()).lanes).toBe(2);
  expect((await state()).ringLanes.every((n: number) => n === 2)).toBe(true);
  const width = page.getByLabel('Anello', { exact: true });
  await width.fill('8');
  await width.press('Enter');
  await expect.poll(async () => (await state()).width).toBe(8);
  const exit = page.getByLabel('Raggio uscita', { exact: true }).first();
  await exit.fill('8');
  await exit.press('Enter');
  await expect.poll(async () => (await state()).exit).toBe(8);
  await page.locator('.statusbar').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state()).exit).not.toBe(8);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await state()).exit).toBe(8);
  await waitSaved(page);
  await openWorkspace(page, pid);
  expect((await state()).width).toBe(8);
  await page.getByRole('button', { name: 'Comandi e ricerca' }).click();
  await page.getByRole('textbox', { name: 'Cerca', exact: true }).fill('Rotatoria di progetto');
  await page.screenshot({path:'.shots/project-search-results.png'});
  await page.getByRole('option', {name:/^Rotatoria di progetto rb-/}).click();
  await expect(page.getByLabel('Raggio uscita', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '.shots/roundabout-controls.png' });
});
