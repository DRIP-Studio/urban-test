import { expect, test, type Page } from '@playwright/test';
import { createProject, focus, junctions, opCount, openWorkspace } from './helpers';

async function openSheet(page: Page, dock: string): Promise<void> {
  await page.evaluate((d) => (window as unknown as { __drip: { useApp: { setState(s: object): void } } }).__drip.useApp.setState({ dock: d }), dock);
}

test('drainage network: draw a branch to the outfall, verify, auto-size (Civil 3D-like)', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E drenaggio');
  await openWorkspace(page, pid);
  const j = (await junctions(page, 4))[0]!;
  const p = await focus(page, j.at, 19);
  await page.keyboard.press('c');
  await expect(page.getByText('Rete di drenaggio', { exact: true })).toBeVisible();
  // Two inlets and a manhole, then the outfall (kind switched in the tool panel).
  await page.mouse.click(p.x - 150, p.y - 40);
  await page.mouse.click(p.x - 60, p.y - 40);
  await page.mouse.click(p.x + 30, p.y - 40);
  await page.getByRole('radio', { name: 'Scarico / recapito' }).click();
  await page.mouse.click(p.x + 120, p.y - 40);
  await expect.poll(() => opCount(page)).toBe(4);
  const net = await page.evaluate(() => {
    const s = (window as unknown as { __drip: { useApp: { getState(): { network: { drainageNodes?: Record<string, unknown>; drainagePipes?: Record<string, unknown> } } } } }).__drip.useApp.getState();
    return { nodes: Object.keys(s.network.drainageNodes ?? {}).length, pipes: Object.keys(s.network.drainagePipes ?? {}).length };
  });
  expect(net).toEqual({ nodes: 4, pipes: 3 });

  await page.keyboard.press('Escape');
  await openSheet(page, 'drainage');
  await page.getByRole('button', { name: 'Verifica la rete' }).click();
  await expect(page.getByText('Verifica delle condotte')).toBeVisible();
  await expect(page.locator('.table tbody tr')).toHaveCount(3);
});

test('plans: PGTU functional classification proposal, environmental islands, PUMS indicators', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E piani');
  await openWorkspace(page, pid);
  await openSheet(page, 'plans');
  await expect(page.getByText('Standard urbanistici (DM 1444/68 art. 3)')).toBeVisible();
  await page.getByRole('radio', { name: 'Traffico (PGTU)' }).click();
  await page.getByRole('button', { name: 'Proponi classificazione' }).click();
  await page.getByRole('button', { name: /Applica a \d+ strade/ }).click();
  await expect.poll(() => opCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Individua isole ambientali' }).click();
  await page.getByRole('radio', { name: 'PUMS' }).click();
  await expect(page.getByText(/Efficacia ed efficienza/)).toBeVisible();
});
