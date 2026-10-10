import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { createProject, openWorkspace } from './helpers';

test.skip(process.env.DRIP_LEGACY_REPRO !== '1', 'Historical crash reproduction in its own disposable browser');
test('historical municipal geometry path stalls or crashes a constrained renderer; bounded replacement stays responsive', async ({ request }) => {
  test.setTimeout(90000);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=512'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, baseURL: 'http://127.0.0.1:5190' });
  let crashed = false, stalled = false, reason = '';
  page.on('console', (m) => console.log('legacy browser:', m.text().slice(0, 160)));
  page.on('crash', () => console.log('legacy browser: renderer crash event')); 
  page.on('crash', () => { crashed = true; });
  try {
    const pid = await createProject(request, 'Historical geometry stress');
    await openWorkspace(page, pid);
    const bounded = await page.evaluate(async () => {
      const sources = '/src/map/sources.ts'; const { vehiclesFC } = await import(sources);
      const s = (window as any).__drip.useApp.getState(), [x, y] = s.baseline.origin;
      const data = new Float32Array(2000 * 6);
      for (let i = 0; i < 2000; i++) data.set([x + (i % 100) * 0.00001, y + Math.floor(i / 100) * 0.00001, 0, 0, 20, i + 1], i * 6);
      const frame = { data, metrics: { vehicles: 50000 }, signals: [] };
      const start = performance.now();
      const collection = vehiclesFC(frame, [x, y]);
      return { simulated: 50000, drawn: 2000, features: collection.features.length, elapsedMs: performance.now() - start, serializedBytes: JSON.stringify(collection).length };
    });
    expect(bounded.features).toBe(2000);
    const bundle = await rolldown({ input: 'e2e/fixtures/legacy-vehicles.ts' });
    const compiled = await bundle.generate({ format: 'iife', name: 'legacyVehicles' });
    await bundle.close();
    const execution = page.evaluate(({ source }) => {
      const { vehiclesFC: generate } = new Function(source + '; return legacyVehicles;')();
      console.info('Legacy geometry dependencies loaded');
      const s = (window as any).__drip.useApp.getState(), [x, y] = s.baseline.origin;
      const data = new Float32Array(50000 * 6);
      for (let i = 0; i < 50000; i++) data.set([x, y, i % 360, 0, 20, i + 1], i * 6);
      (window as any).__legacyGeometry = generate({ data, metrics: { vehicles: 50000 }, signals: [] }, [x, y]);
    }, { source: compiled.output[0]!.code }).catch((e: Error) => { reason = e.message; });
    await Promise.race([execution, new Promise<void>((resolve) => setTimeout(() => { stalled = true; reason ||= 'Historical geometry did not return within 30 seconds'; resolve(); }, 30000))]);
    expect(crashed || stalled).toBe(true);
    mkdirSync('.shots', { recursive: true });
    writeFileSync('.shots/legacy-crash.json', JSON.stringify({ source: 'git HEAD vehiclesFC before geometry LOD', rendererHeapLimitMB: 512, legacyRequestedAgents: 50000, crashed, stalled, reason, bounded, caveat: 'Controlled resource reproduction of the original geometry path; does not identify the user hardware or exact original workload.' }, null, 2));
  } finally { await browser.close().catch(() => undefined); }
});
