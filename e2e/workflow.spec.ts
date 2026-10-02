import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createProject, focus, junctions, opCount, openWorkspace, waitSaved } from './helpers';

/**
 * Main design flow on the real Frattamaggiore network:
 * road → undo/redo → roundabout → signal plan → simulation → save → reload → export.
 */
test('design flow persists and exports', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E flusso');
  await openWorkspace(page, pid);
  expect(await opCount(page)).toBe(0);

  const four = await junctions(page, 4);
  const three = await junctions(page, 3);
  expect(four.length).toBeGreaterThan(2);
  expect(three.length).toBeGreaterThan(2);

  // --- road: two clicks + Enter; snap is on, so the second click may land on an existing road.
  const rb = four[0]!;
  const start = await focus(page, rb.at, 18);
  await page.keyboard.press('r');
  await page.mouse.click(start.x + 140, start.y - 160);
  await page.mouse.click(start.x + 300, start.y - 160);
  await page.keyboard.press('Enter');
  await expect.poll(() => opCount(page)).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => opCount(page)).toBe(0);
  await page.keyboard.press('Control+y');
  await expect.poll(() => opCount(page)).toBe(1);
  await page.keyboard.press('Escape');

  // --- roundabout on a 4-arm junction.
  const p = await focus(page, rb.at);
  await page.keyboard.press('o');
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: 'Crea rotatoria' }).click();
  await expect.poll(() => opCount(page)).toBe(2);
  const rbCount = await page.evaluate(() => Object.keys((window as unknown as { __drip: { useApp: { getState(): { network: { roundabouts: object } } } } }).__drip.useApp.getState().network.roundabouts).length);
  expect(rbCount).toBe(1);
  await page.keyboard.press('Escape');

  // --- signal plan on another junction, from the conflict-free proposal.
  const sj = four.find((j) => Math.hypot((j.at[0] - rb.at[0]) * 84_000, (j.at[1] - rb.at[1]) * 111_000) > 150) ?? three[0]!;
  const q = await focus(page, sj.at);
  await page.keyboard.press('t');
  await page.mouse.click(q.x, q.y);
  await page.getByRole('button', { name: 'Proposta automatica' }).click();
  await page.getByRole('button', { name: /Applica piano|Aggiorna piano/ }).click();
  await expect.poll(() => opCount(page)).toBe(3);
  await page.keyboard.press('Escape');

  // --- simulation in the visible area produces vehicles.
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radio', { name: 'Simulazione' }).click();
  await page.getByRole('button', { name: "Avvia nell'area visibile" }).click();
  await expect(page.getByRole('button', { name: 'Ferma' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const map = (window as unknown as { __dripMap: { getMap(): { querySourceFeatures(s: string): unknown[] } } }).__dripMap.getMap();
    return map.querySourceFeatures('vehicles').length;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Ferma' }).click();

  // --- save + reload: the scenario comes back from disk.
  await waitSaved(page);
  await openWorkspace(page, pid);
  expect(await opCount(page)).toBe(3);

  // --- export GeoJSON with provenance.
  await page.keyboard.press('Control+e');
  const row = page.locator('.export-list li', { hasText: 'GeoJSON del progetto' });
  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Esporta' }).click()]);
  const gj = JSON.parse(readFileSync((await download.path())!, 'utf-8')) as { type: string; features: { properties: Record<string, unknown> }[] };
  expect(gj.type).toBe('FeatureCollection');
  expect(gj.features.length).toBeGreaterThan(1000);
  expect(gj.features.some((f) => f.properties.state === 'project')).toBeTruthy();
});

test('saving conflicts never lose work', async ({ page, request }) => {
  const pid = await createProject(request, 'E2E conflitto');
  await openWorkspace(page, pid);
  // Another client saves first (stale revision for this page).
  const sc = await (await request.get(`http://127.0.0.1:8790/api/projects/${pid}/scenarios/scenario-a`)).json();
  const put = await request.put(`http://127.0.0.1:8790/api/projects/${pid}/scenarios/scenario-a`, { data: { scenario: { ...sc, name: 'Scenario A (altro client)' }, baseRevision: sc.revision } });
  expect(put.ok(), await put.text()).toBeTruthy();
  // This page edits: the store must rebase on the server version and keep its operation.
  const j = (await junctions(page, 4))[0]!;
  const p = await focus(page, j.at);
  await page.keyboard.press('o');
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: 'Crea rotatoria' }).click();
  await waitSaved(page);
  const after = await (await request.get(`http://127.0.0.1:8790/api/projects/${pid}/scenarios/scenario-a`)).json();
  expect(after.operations.length).toBe(1);
});
