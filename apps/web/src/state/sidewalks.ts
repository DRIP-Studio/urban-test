import { create } from 'zustand';
import type { SidewalkCoverage, SidewalkSide } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { useApp } from './store';
import { toast } from './toasts';
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
  const feats: Feature[] = coverage.sides.filter((s) => s.status === 'estimated' && s.ring && !off.has(s.key)).map((s) => ({
    type: 'Feature', id: s.key, geometry: { type: 'Polygon', coordinates: [[...s.ring!.map((p) => [p[0], p[1]]), [s.ring![0]![0], s.ring![0]![1]]]] },
    properties: { id: s.key, roadId: s.roadId, widthM: s.widthM },
  }));
  setSource('sidewalks-est', fc(feats));
}

async function saveDoc(doc: SidewalkDoc): Promise<void> {
  useSidewalks.setState({ doc });
  draw();
  const p = useApp.getState().project;
  if (p) await api.put(`/api/projects/${encodeURIComponent(p.id)}/docs/sidewalks`, doc).catch(() => undefined);
}

let timer: ReturnType<typeof setTimeout> | null = null;
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
      toast.info('Marciapiedi', 'Importo automaticamente i marciapiedi esistenti misurati sulle sagome degli edifici…');
      await importExistingSidewalks({ silent: true });
      return; // the project reopens with the new baseline; init runs again with the saved doc
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

// Recompute after network edits (debounced), so new roads get their estimate.
useApp.subscribe((st, prev) => {
  if (st.netVersion === prev.netVersion || !st.project) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refreshSidewalks(), 1500);
});
