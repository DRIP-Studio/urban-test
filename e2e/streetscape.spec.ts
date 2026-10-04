import { expect, test, type Page } from '@playwright/test';
import { createProject, focus, opCount, openWorkspace } from './helpers';

type LngLat = [number, number];

/** A long two-way urban road and a point in the middle of its axis. */
async function midRoad(page: Page): Promise<{ id: string; at: LngLat; text: LngLat }> {
  return page.evaluate(() => {
    type R = { id: string; axis: LngLat[]; speedKmh: number; oneway: string; tags?: Record<string, string> };
    const s = (window as unknown as { __drip: { useApp: { getState(): { network: { roads: Record<string, R> } } } } }).__drip.useApp.getState();
    const len = (a: LngLat[]) => a.slice(1).reduce((t, p, i) => t + Math.hypot((p[0] - a[i]![0]) * 72000, (p[1] - a[i]![1]) * 111000), 0);
    const r = Object.values(s.network.roads).filter((x) => x.axis.length === 2 && !x.tags?.roundabout).sort((a, b) => len(b.axis) - len(a.axis))[0]!;
    const [a, b] = r.axis as [LngLat, LngLat];
    const lerp = (t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { id: r.id, at: lerp(0.5), text: lerp(0.62) };
  });
}

test('traffic calming and custom markings: palette, placement, map hit-test, inspector, undo', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E segnaletica');
  await openWorkspace(page, pid);
  const road = await midRoad(page);
  const p = await focus(page, road.at, 19);

  // Raised pedestrian crossing (default calming kind).
  await page.keyboard.press('d');
  await expect(page.getByText('Moderazione del traffico e rialzati')).toBeVisible();
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => opCount(page)).toBe(1);
  await expect(page.getByRole('button', { name: 'Attraversamento pedonale rialzato', expanded: true })).toBeVisible();

  // Next-step suggestion: a speed table must be announced by the «dosso» warning sign (art. 85 Reg.).
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await page.locator('.mk-tile', { hasText: 'Piattaforma rialzata' }).click();
  await page.mouse.click(p.x, p.y - 60);
  await expect.poll(() => opCount(page)).toBe(2);
  const card = page.locator('.suggest-card', { hasText: 'dosso' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Posiziona a 30 m' }).click();
  await expect.poll(() => opCount(page)).toBe(3);
  await expect(card).toHaveCount(0);

  // Custom road text: one click on the lane, oriented on the direction of travel.
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await page.locator('.mk-tile', { hasText: 'Scritta' }).click();
  const q = await focus(page, road.text, 19.5);
  await page.mouse.click(q.x + 12, q.y);
  await expect.poll(() => opCount(page)).toBe(4);

  // The letters are physical marking polygons with the marking's own ids (clickable on the map).
  const ids = await page.evaluate(async () => {
    const map = (window as unknown as { __dripMap: { getMap(): { once(e: string, f: () => void): void; triggerRepaint(): void; querySourceFeatures(s: string): { properties: { id: string } }[] } } }).__dripMap.getMap();
    map.triggerRepaint();
    await Promise.race([new Promise<void>((r) => map.once('idle', () => r())), new Promise((r) => setTimeout(r, 4000))]);
    return map.querySourceFeatures('markings').map((f) => String(f.properties.id));
  });
  expect(ids.some((id) => id.startsWith('cm:'))).toBeTruthy();
  expect(ids.some((id) => id.startsWith('fm:'))).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(() => opCount(page)).toBe(3);
});
