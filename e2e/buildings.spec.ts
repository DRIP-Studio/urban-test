import { expect, test } from '@playwright/test';
import { createProject, focus, opCount, openWorkspace } from './helpers';

type LngLat = [number, number];

test('buildings: select, demolish in the scenario, restore from the ghost (undoable)', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E edifici');
  await openWorkspace(page, pid);
  // A mid-sized building: its centroid is inside the footprint for a convex-ish shape.
  const b = await page.evaluate(() => {
    type B = { id: string; footprint: LngLat[]; heightM: number };
    const s = (window as unknown as { __drip: { useApp: { getState(): { baseline: { buildings: Record<string, B> } } } } }).__drip.useApp.getState();
    const list = Object.values(s.baseline.buildings).filter((x) => x.footprint.length === 4 || x.footprint.length === 5);
    const x = list[Math.floor(list.length / 2)]!;
    const c = x.footprint.reduce((a, p) => [a[0] + p[0] / x.footprint.length, a[1] + p[1] / x.footprint.length], [0, 0]) as LngLat;
    return { id: x.id, at: c };
  });
  const p = await focus(page, b.at, 19);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('button', { name: 'Demolisci nello scenario' })).toBeVisible();
  await page.getByRole('button', { name: 'Demolisci nello scenario' }).click();
  await expect.poll(() => opCount(page)).toBe(1);
  await expect(page.getByText('Demolito nello scenario')).toBeVisible();
  await page.getByRole('button', { name: 'Ripristina edificio' }).click();
  await expect.poll(() => opCount(page)).toBe(2);
  await expect(page.getByRole('button', { name: 'Demolisci nello scenario' })).toBeVisible();
});
