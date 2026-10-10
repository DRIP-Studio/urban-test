import { test, expect } from '@playwright/test';
import { API, createProject, junctions, openWorkspace, opCount } from './helpers';

test('Elios workflow evaluates three native signal scenarios and applies a choice with undo', async ({ page, request }) => {
  test.setTimeout(180000);
  const pid = await createProject(request, 'Elios three alternatives');
  await openWorkspace(page, pid);
  const node = (await junctions(page, 4))[0]!;
  await page.evaluate(async id => {
    const toolsPath = '/src/elios/tools.ts', timePath = '/src/state/projectTime.ts';
    (await import(timePath)).setProjectWallTime('2026-10-09', 480);
    await (await import(toolsPath)).toolByName('design_signal_plan')!.run({ nodeId: id });
  }, node.id);
  const before = await opCount(page);
  const workflow = await page.evaluate(async () => {
    const toolsPath = '/src/elios/tools.ts';
    return (await import(toolsPath)).toolByName('evaluate_and_save_alternatives')!.run({ dailyTrips: 40000, initialVehicles: 150, durationS: 300, seed: 7, targetReductionPct: 25 }) as any;
  });
  expect(workflow.evaluation.candidates).toHaveLength(4);
  expect(workflow.saved.created).toHaveLength(3);
  expect(new Set(workflow.evaluation.candidates.map((candidate:any)=>JSON.stringify(candidate.result.metrics))).size).toBeGreaterThan(1);
  expect(await opCount(page)).toBe(before);
  const cycles: number[] = [];
  for (const scenario of workflow.saved.created) {
    const response = await request.get(`${API}/api/projects/${pid}/scenarios/${scenario.id}`);
    const saved = await response.json();
    cycles.push(saved.operations.at(-1).payload.ops.find((op: any) => op.type === 'signal.setPlan').payload.plan.cycleS);
  }
  expect(new Set(cycles).size).toBe(3);
  await page.evaluate(async () => { const path = '/src/elios/Elios.tsx'; (await import(path)).useElios.setState({ open: true }); });
  await expect(page.getByRole('region', { name: 'Confronto alternative Elios' })).toBeVisible();
  await page.locator('.elios-evaluation').scrollIntoViewIfNeeded();
  await expect(page.locator('.elios')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '.shots/elios-alternatives.png', fullPage: true });
  await page.getByRole('button', { name: /^Applica Cicli/ }).first().click();
  await expect.poll(() => opCount(page)).toBe(before + 1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => opCount(page)).toBe(before);
});
