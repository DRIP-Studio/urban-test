import { expect, test, type Page } from '@playwright/test';
import { createProject, focus, junctions, opCount, openWorkspace } from './helpers';

type Asset = { id: string; at: [number, number]; type: string; properties: Record<string, unknown> };

async function projectAssets(page: Page): Promise<Asset[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __drip: { useApp: { getState(): { network: { assets: Record<string, Asset & { state: string }> } } } } }).__drip.useApp.getState();
    return Object.values(s.network.assets).filter((a) => a.state === 'project') as Asset[];
  });
}

/** Rendered sign ids within 3 px of where the asset's coordinate projects at the given zoom. */
async function renderedAt(page: Page, at: [number, number], zoom: number): Promise<{ ids: string[]; x: number; y: number }> {
  return page.evaluate(async ({ at, zoom }) => {
    type M = { jumpTo(o: object): void; triggerRepaint(): void; once(e: string, f: () => void): void; project(p: [number, number]): { x: number; y: number }; queryRenderedFeatures(b: [[number, number], [number, number]], o: object): { properties: { id: string } }[] };
    const map = (window as unknown as { __dripMap: { getMap(): M } }).__dripMap.getMap();
    map.jumpTo({ center: [at[0] + 0.0004, at[1] + 0.0002], zoom });
    map.triggerRepaint();
    await Promise.race([new Promise<void>((r) => map.once('idle', () => r())), new Promise((r) => setTimeout(r, 5000))]);
    const p = map.project(at);
    const hits = map.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: ['asset-pt-sign'] });
    return { ids: hits.map((h) => String(h.properties.id)), x: p.x, y: p.y };
  }, { at, zoom });
}

test('signs stay on their coordinate at every zoom and stack on one pole (RB-01, RB-02, RB-07)', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E segnali');
  await openWorkspace(page, pid);
  const j = (await junctions(page, 4))[0]!;
  const p = await focus(page, j.at, 19);

  await page.keyboard.press('g');
  await page.mouse.click(p.x + 60, p.y + 45);
  await expect.poll(() => opCount(page)).toBe(1);
  const [sign] = await projectAssets(page);
  expect(sign!.type).toBe('it.sign.dare_precedenza');

  // Static assets are GPU symbols: no DOM markers that could drift or fall to the top-left corner.
  expect(await page.locator('.maplibregl-marker').count()).toBe(0);
  for (const z of [17, 18.5, 20, 17]) {
    const r = await renderedAt(page, sign!.at, z);
    expect(r.ids, `zoom ${z}`).toContain(sign!.id);
    expect(r.x > 40 || r.y > 40, `zoom ${z}: not in the corner`).toBeTruthy();
  }

  // Alt+click on the plate adds a second plate to the same pole (one batch, one undo step).
  const q = await focus(page, sign!.at, 19);
  await page.keyboard.down('Alt');
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up('Alt');
  await expect.poll(() => opCount(page)).toBe(2);
  const plates = await projectAssets(page);
  expect(plates).toHaveLength(2);
  const poles = new Set(plates.map((a) => a.properties.poleId));
  expect(poles.size).toBe(1);
  expect([...poles][0]).toBeTruthy();
  expect(new Set(plates.map((a) => a.properties.stackOrder))).toEqual(new Set([0, 1]));

  // Twin shows exactly what 2D has.
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  await expect(page.getByText(/Parità 2D\/3D: (\d+)\/\1 oggetti/)).toBeVisible({ timeout: 60_000 });
});

test('traffic estimate and safety heatmap are never empty (RB-09, RB-10)', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E analisi');
  await openWorkspace(page, pid);
  const count = (source: string) => page.evaluate((s) => (window as unknown as { __dripMap: { getMap(): { querySourceFeatures(s: string): unknown[] } } }).__dripMap.getMap().querySourceFeatures(s).length, source);

  // No provider keys in this run: the DRIP estimate must fill the traffic layer and say it is an estimate.
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('button', { name: 'Calcola stima (oggi e progetto)' }).click();
  await expect.poll(() => count('traffic'), { timeout: 60_000 }).toBeGreaterThan(100);
  await expect(page.locator('aside, [role=complementary]').getByText('Stimato', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Analizza', exact: true }).click();
  await page.getByRole('radio', { name: 'Sicurezza' }).click();
  await expect.poll(() => count('heat'), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.getByText(/surrogat/i).first()).toBeVisible();
});
