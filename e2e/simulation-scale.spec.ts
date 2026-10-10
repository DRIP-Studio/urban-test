import { expect, test } from '@playwright/test';
import { createProject, openWorkspace } from './helpers';
import { writeFileSync } from 'node:fs';

test('municipal Flow survives switching to Twin; synthetic fleet stress separates simulation and drawing', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pid = await createProject(request, 'E2E municipal Flow');
  await openWorkspace(page, pid);
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
  await page.getByRole('button', { name: 'Avvia simulazione comunale', exact: true }).click();
  await expect(page.locator('.stat-label').filter({ hasText: 'Veicoli in rete' })).toBeVisible();
  const currentTime = () => page.evaluate(async () => {
    const path = '/src/engine/engine.ts';
    return (await import(path)).engine.lastSim?.metrics.t ?? -1;
  });
  await expect.poll(currentTime).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
  await expect(page.locator('.twin-canvas canvas').first()).toBeVisible({ timeout: 30000 });
  const t = await currentTime();
  await expect.poll(currentTime).toBeGreaterThan(t);
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ferma', exact: true }).click();
  await expect.poll(currentTime).toBe(-1);

  const results = [];
  for (const count of [1000, 5000, 10000, 25000, 50000]) {
    results.push(await page.evaluate(async (count) => {
      const path = '/src/engine/engine.ts';
      const { engine } = await import(path);
      const state = (window as any).__drip.useApp.getState();
      const nodes = Object.values(state.network.nodes) as { at: number[] }[];
      const data = new Float32Array(Math.min(2000, count) * 6);
      for (let i = 0; i < data.length / 6; i++) {
        const node = nodes[i % nodes.length]!;
        data.set([node.at[0]!, node.at[1]!, i % 360, 0, 30, i + 1], i * 6);
      }
      const frame = { data, signals: [], metrics: { t: 60, vehicles: count, avgSpeedKmh: 30, stopped: 0, completed: 0, throughputVph: 0, avgTravelS: 0, avgDelayS: 0, queues: [] } };
      const start = performance.now();
      let frames = 0;
      await new Promise<void>((resolve) => {
        const step = () => { frames++; if (performance.now() - start >= 1000) resolve(); else requestAnimationFrame(step); };
        engine.handle({ type: 'simFrame', frame, tickMs: 0, sentAt: performance.timeOrigin + performance.now() });
        requestAnimationFrame(step);
      });
      return { fixture: 'synthetic rendering only', simulated: count, drawn: data.length / 6, payloadBytes: data.byteLength, fps: frames * 1000 / (performance.now() - start), heapBytes: (performance as any).memory?.usedJSHeapSize ?? null };
    }, count));
    await expect(page.getByText('Veicoli disegnati', { exact: true })).toBeVisible();
  }
  expect(results.every((r) => r.drawn <= 2000 && r.payloadBytes <= 48000)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.shots/municipal-flow.png', fullPage: true });
  await testInfo.attach('synthetic-fleet-performance.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  writeFileSync('.shots/simulation-performance.json', JSON.stringify(results, null, 2));
});
