import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createProject, openWorkspace } from './helpers';
import { simulationWorkerHeap } from './worker-heap';

// Explicit extended QA command: $env:DRIP_LONG_STRESS='1'; npx playwright test e2e/simulation-long.spec.ts
test.skip(process.env.DRIP_LONG_STRESS !== '1', 'Extended real-worker stress, run separately from quick editor regressions');
for (const mode of ['microscopic', 'hybrid'] as const) test(`${mode}: real routed workloads through 50k, long run, transitions, memory plateau`, async ({ page, request }, testInfo) => {
  const longMs=Number(process.env.DRIP_STRESS_MS??120000);
  if(!Number.isFinite(longMs)||longMs<120000)throw Error('Stress esteso richiede almeno 120 secondi');
  test.setTimeout(longMs+240000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('crash', () => errors.push('renderer process crashed'));
  const pid = await createProject(request, `Stress ${mode}`);
  await openWorkspace(page, pid);
  await page.getByRole('button', { name: 'Traffico', exact: true }).click();
  await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
  if (mode === 'hybrid') await page.getByRole('radio', { name: 'Ibrida comunale', exact: true }).click();
  const renderer=await page.evaluate(()=>{const canvas=(window as any).__dripMap.getMap().getCanvas(),gl=canvas.getContext('webgl2')??canvas.getContext('webgl'),debug=gl?.getExtension('WEBGL_debug_renderer_info');return debug?String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'Unavailable';});
  if(process.env.DRIP_E2E_GPU==='hardware')expect(renderer).not.toMatch(/swiftshader|llvmpipe|software|warp/i);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'JSHeapUsedSize')!.value;
  };
  const results: unknown[] = [];
  mkdirSync('.shots', { recursive: true });
  const save = () => writeFileSync(`.shots/long-stress-${mode}.json`, JSON.stringify({ errors, renderer, results }, null, 2));
  for (const count of [1000, 5000, 10000, 25000, 50000]) {
    await page.evaluate(async ({ count, mode }) => {
      const path = '/src/engine/engine.ts'; const { engine } = await import(path);
      const s = (window as any).__drip.useApp.getState();
      engine.simulationBaseline(s.baseline, s.scenario.operations);
      const [x, y] = s.baseline.origin;
      engine.simStart({ mode, initialVehicles: count, dailyTrips: 0, day: 1, hour: 8, scale: 1, seed: 20261008, microBounds: [x - 0.003, y - 0.002, x + 0.003, y + 0.002] });
      engine.simSpeed(1); engine.simView({ budget: 2000 });
    }, { count, mode });
    const state = () => page.evaluate(async () => {
      const path = '/src/engine/engine.ts'; const { engine } = await import(path);
      const f = engine.lastSim;
      return f ? { t: f.metrics.t, balance: f.metrics.vehicles + f.metrics.completed, drawn: f.data.length / 6, tickMs: engine.simPerformance.tickMs, metrics: f.metrics } : null;
    });
    await expect.poll(state, { timeout: 30000 }).not.toBeNull();
    await expect.poll(async () => (await state())?.balance).toBe(count);
    const start = Date.now(), samples = [];
    const duration = count === 50000 ? longMs : 5000;
    const initialHeap = await heap();
    const initialWorkerHeap = await simulationWorkerHeap(cdp);
    let transitions = 0, previousTime = -1;
    const record = { mode, workload: 'synthetic spatially distributed real routed agents; real simulation worker', initialAgents: count, initialHeap, initialWorkerHeap, samples };
    results.push(record); save();
    while (Date.now() - start < duration) {
      const responsiveness = await page.evaluate(async () => {
        const start = performance.now(); let frames = 0;
        await new Promise<void>((resolve) => { const frame = () => { frames++; if (performance.now() - start > 1000) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
        return { fps: frames * 1000 / (performance.now() - start), elapsed: performance.now() - start };
      });
      const snapshot = await state();
      expect(snapshot!.t, 'Fresh simulation frames must continue through Map/Twin teardown').toBeGreaterThan(previousTime);
      previousTime = snapshot!.t;
      expect(snapshot?.balance).toBe(count);
      expect(snapshot!.drawn).toBeLessThanOrEqual(4096);
      
      samples.push({ ...snapshot, ...responsiveness, wallMs: Date.now() - start, adaptive: await page.getByText(/Carico grafico ridotto automaticamente/).count() }); save();
      if (count === 50000 && transitions % 2 === 1 && !samples.some((s: any) => s.screenshot === transitions)) {
        await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.screenshot({ path: `.shots/long-stress-${mode}-twin-${transitions}.png`, fullPage: true });
        samples.push({ screenshot: transitions });
      }
      if (count === 50000 && transitions < 4 && Date.now() - start > (transitions + 1) * 20000) {
        const action = Date.now();
        if (transitions % 2 === 0) {
          await page.getByRole('button', { name: 'Twin 3D', exact: true }).click();
          await expect(page.locator('.twin-canvas canvas').first()).toBeVisible();
          await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
          await expect(page.getByRole('alert')).toHaveCount(0);
        } else {
          await page.getByRole('button', { name: 'Traffico', exact: true }).click();
          await page.getByRole('radio', { name: 'Simulazione', exact: true }).click();
        }
        samples.push({ transition: transitions, interactionMs: Date.now() - action }); transitions++; save();
      }
      await page.waitForTimeout(4000);
    }
    const finalHeap = await heap();
    const finalWorkerHeap = await simulationWorkerHeap(cdp);
    const last = await state();
    expect(last!.t).toBeGreaterThan(count === 50000 ? 80 : 1);
    // Same population/run and collected main-thread heap; room for lazy Twin module and renderer pools.
    expect(finalHeap - initialHeap).toBeLessThan(160 * 1024 * 1024);
    Object.assign(record, { mode, workload: 'synthetic spatially distributed real routed agents; real simulation worker', initialAgents: count, elapsedWallMs: Date.now() - start, initialHeap, finalHeap, finalWorkerHeap, final: last, transitions, samples }); save();
    expect(finalWorkerHeap - initialWorkerHeap).toBeLessThan(32 * 1024 * 1024);
    // Cold scene compilation is recorded separately; steady interaction must remain responsive.
    const steady = samples.filter((s: any) => s.fps !== undefined && s.wallMs > 30000 && !(s.wallMs > 20000 && s.wallMs < 30000) && !(s.wallMs > 60000 && s.wallMs < 70000)) as { fps: number }[];
    if (count === 50000) expect(steady.every((s) => s.fps > 3), JSON.stringify(steady)).toBe(true);
    await page.evaluate(async () => { const path = '/src/engine/engine.ts'; (await import(path)).engine.simStop(); });
    await expect.poll(state).toBeNull();
  }
  expect(errors).toEqual([]);
  mkdirSync('.shots', { recursive: true });
  writeFileSync(`.shots/long-stress-${mode}.json`, JSON.stringify({ errors, renderer, results }, null, 2));
  await testInfo.attach(`long-stress-${mode}.json`, { body: JSON.stringify(results), contentType: 'application/json' });
  await page.screenshot({ path: `.shots/long-stress-${mode}.png`, fullPage: true });
});
