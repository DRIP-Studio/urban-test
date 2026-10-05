import { registerLive } from './live';
import { create } from 'zustand';
import type { SidewalkCoverage, SidewalkSide } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { useApp } from './store';
import { importExistingSidewalks } from './existingState';

/**
 * Estimated sidewalks: an overlay computed from the scenario network (never a change to the roads).
 * The project doc `sidewalks` stores whether the overlay is on and which sides are switched off.
 */
interface SidewalkDoc { enabled: boolean; disabled: string[]; autoImportedAt?: string }
interface State {
  doc: SidewalkDoc;
  coverage: SidewalkCoverage | null;
  bySide: Map<string, SidewalkSide>;
  loading: boolean;
}

export const useSidewalks = create<State>(() => ({ doc: { enabled: true, disabled: [] }, coverage: null, bySide: new Map(), loading: false }));

export function redrawSidewalks(): void { draw(); }

function draw(): void {
  const { doc, coverage } = useSidewalks.getState();
  if (!coverage || !doc.enabled) { setSource('sidewalks-est', null); return; }
  const off = new Set(doc.disabled);
  const poly = (id: string, ring: readonly (readonly [number, number])[], props: Record<string, unknown>): Feature => ({
    type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [[...ring.map((p) => [p[0], p[1]]), [ring[0]![0], ring[0]![1]]]] }, properties: { id, ...props },
  });
  const edge = (id: string, line: readonly (readonly [number, number])[]): Feature => ({ type: 'Feature', id, geometry: { type: 'LineString', coordinates: line.map((p) => [p[0], p[1]]) }, properties: { id, edge: true } });
  const sides = coverage.sides.filter((s) => s.status === 'estimated' && !off.has(s.key));
  const feats: Feature[] = sides.flatMap((s) => [
    ...(s.rings ?? (s.ring ? [s.ring] : [])).map((ring, i) => poly(`${s.key}:${i}`, ring, { side: s.key, roadId: s.roadId, widthM: s.widthM })),
    ...(s.edges ?? []).map((line, i) => edge(`${s.key}:e${i}`, line)),
  ]);
  // A corner exists only while both sides it joins are switched on.
  for (const c of coverage.corners ?? []) {
    if (off.has(c.sides[0]) || off.has(c.sides[1])) continue;
    feats.push(poly(`c:${c.key}`, c.ring, { corner: true, side: c.sides[0] }), edge(`c:${c.key}:e`, c.outer));
  }
  setSource('sidewalks-est', fc(feats));
}

async function saveDoc(doc: SidewalkDoc): Promise<void> {
  useSidewalks.setState({ doc });
  draw();
  const p = useApp.getState().project;
  if (p) await api.put(`/api/projects/${encodeURIComponent(p.id)}/docs/sidewalks`, doc).catch(() => undefined);
}

export async function refreshSidewalks(): Promise<void> {
  useSidewalks.setState({ loading: true });
  try {
    const coverage = await engine.job<SidewalkCoverage>('sidewalks', {});
    useSidewalks.setState({ coverage, bySide: new Map(coverage.sides.map((s) => [s.key, s])), loading: false });
    draw();
  } catch { useSidewalks.setState({ loading: false }); }
}

/** Loads the doc; on the very first open imports the measured existing sidewalks automatically. */
export async function initSidewalks(): Promise<void> {
  const p = useApp.getState().project;
  if (!p) return;
  const doc = await api.get<SidewalkDoc | null>(`/api/projects/${encodeURIComponent(p.id)}/docs/sidewalks`).catch(() => null);
  if (!doc) {
    const fresh: SidewalkDoc = { enabled: true, disabled: [], autoImportedAt: new Date().toISOString() };
    await saveDoc(fresh);
    if (Object.keys(useApp.getState().baseline?.roads ?? {}).length) {
      await importExistingSidewalks({ silent: true });
    }
  } else {
    useSidewalks.setState({ doc: { enabled: doc.enabled ?? true, disabled: doc.disabled ?? [], autoImportedAt: doc.autoImportedAt } });
  }
  void refreshSidewalks();
}

export const setSidewalksEnabled = (enabled: boolean) => void saveDoc({ ...useSidewalks.getState().doc, enabled });
export function setSideEnabled(key: string, on: boolean): void {
  const d = useSidewalks.getState().doc;
  void saveDoc({ ...d, disabled: on ? d.disabled.filter((k) => k !== key) : [...new Set([...d.disabled, key])] });
}
export function setAllSides(on: boolean): void {
  const cov = useSidewalks.getState().coverage;
  void saveDoc({ ...useSidewalks.getState().doc, enabled: true, disabled: on ? [] : (cov?.sides.filter((s) => s.status === 'estimated').map((s) => s.key) ?? []) });
}

// Live: recomputed after every edit (debounced by the live hub), so new roads get their estimate.
registerLive('sidewalks', () => (useApp.getState().project ? refreshSidewalks() : undefined));
