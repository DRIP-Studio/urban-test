import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://127.0.0.1:8790';
type LngLat = [number, number];

/** Creates a project on the real Frattamaggiore baseline through the public API. */
export async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const r = await request.post(`${API}/api/projects`, { data: { template: 'frattamaggiore', name } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).id as string;
}

/** Opens the workspace and waits for map, scenario and physical model. */
export async function openWorkspace(page: Page, pid: string): Promise<void> {
  await page.goto(`/#/p/${pid}`);
  await page.waitForFunction(() => {
    const w = window as unknown as { __drip?: { useApp: { getState(): { physStats: unknown; scenario?: { isBaseline: boolean } } } }; __dripMap?: { getMap(): { loaded(): boolean } | null } };
    const s = w.__drip?.useApp.getState();
    return !!(s?.physStats && s.scenario && !s.scenario.isBaseline && w.__dripMap?.getMap()?.loaded());
  }, null, { timeout: 60_000 }).catch(async (e: Error) => {
    // Say which condition never became true.
    const state = await page.evaluate(() => {
      const w = window as unknown as { __drip?: { useApp: { getState(): { physStats: unknown; scenario?: { isBaseline: boolean }; loading: unknown; loadError: unknown } } }; __dripMap?: { getMap(): { loaded(): boolean; isStyleLoaded(): boolean | void } | null } };
      const s = w.__drip?.useApp.getState();
      const m = w.__dripMap?.getMap();
      return { physStats: !!s?.physStats, scenario: s?.scenario ? (s.scenario.isBaseline ? 'baseline' : 'project') : null, loading: s?.loading, loadError: s?.loadError, mapLoaded: m?.loaded(), styleLoaded: m?.isStyleLoaded() };
    }).catch(() => 'page unavailable');
    throw new Error(`${e.message}
stato: ${JSON.stringify(state)}`);
  });
}

export async function opCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __drip: { useApp: { getState(): { scenario: { operations: unknown[] } } } } }).__drip.useApp.getState().scenario.operations.length);
}

/** Junction nodes with exactly `arms` vehicular roads, each ≥ 40 m long, sorted by distance from the city origin. */
export async function junctions(page: Page, arms: number): Promise<{ id: string; at: LngLat }[]> {
  return page.evaluate((arms) => {
    type R = { from: string; to: string; axis: [number, number][]; roadClass: string };
    const s = (window as unknown as { __drip: { useApp: { getState(): { network: { nodes: Record<string, { id: string; at: [number, number] }>; roads: Record<string, R> }; baseline: { origin: [number, number] } } } } }).__drip.useApp.getState();
    const m = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 84_000, (a[1] - b[1]) * 111_000);
    const len = (r: R) => r.axis.slice(1).reduce((t, p, i) => t + m(r.axis[i]!, p), 0);
    const deg = new Map<string, number>();
    for (const r of Object.values(s.network.roads)) {
      if (['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'service'].includes(r.roadClass)) continue;
      const ok = len(r) >= 40 ? 1 : -99;
      deg.set(r.from, (deg.get(r.from) ?? 0) + ok);
      deg.set(r.to, (deg.get(r.to) ?? 0) + ok);
    }
    const o = s.baseline.origin;
    return Object.values(s.network.nodes).filter((n) => deg.get(n.id) === arms)
      .sort((a, b) => m(a.at, o) - m(b.at, o)).map((n) => ({ id: n.id, at: n.at }));
  }, arms);
}

/** Centres the map on a point and returns its screen position. */
export async function focus(page: Page, at: LngLat, zoom = 18.5): Promise<{ x: number; y: number }> {
  return page.evaluate(async ({ at, zoom }) => {
    const map = (window as unknown as { __dripMap: { getMap(): { stop(): void; jumpTo(o: object): void; triggerRepaint(): void; once(e: string, f: () => void): void; project(p: [number, number]): { x: number; y: number }; getContainer(): HTMLElement } } }).__dripMap.getMap();
    map.stop();
    map.jumpTo({ center: at, zoom, bearing: 0, pitch: 0 });
    map.triggerRepaint();
    // 'idle' never fires if nothing changed: force a frame and cap the wait.
    await Promise.race([new Promise<void>((r) => map.once('idle', () => r())), new Promise((r) => setTimeout(r, 5000))]);
    const p = map.project(at);
    const box = map.getContainer().getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  }, { at, zoom });
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator('.topbar').getByText('Salvato', { exact: true })).toBeVisible({ timeout: 30_000 });
}
