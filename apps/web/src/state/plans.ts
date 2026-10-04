import { create } from 'zustand';
import {
  DM1444_COLOR, EMPTY_URBAN_PLAN, FUNCTIONAL_COLOR, effectiveFunctionalClasses,
  type EnvironmentalIsland, type UrbanPlanDoc,
} from '@drip-urban/core';
import { api } from '../api/client';
import { fc, type Feature } from '../engine/geojson';
import { setSource, toggleLayer } from '../map/mapStore';
import { useApp } from './store';
import { toast } from './toasts';

/**
 * Piano urbanistico (document `urbanplan`) and the map overlays of the «Piani» sheet: plan zones
 * coloured by DM 1444/68 class, constraints, PGTU functional classes and proposed environmental islands.
 */
interface PlansState { doc: UrbanPlanDoc; loaded: boolean; islands: EnvironmentalIsland[] }
export const usePlans = create<PlansState>(() => ({ doc: EMPTY_URBAN_PLAN, loaded: false, islands: [] }));

const ring = (r: readonly (readonly [number, number])[]) => [...r.map((p) => [p[0], p[1]]), [r[0]![0], r[0]![1]]];

export async function loadPlan(): Promise<UrbanPlanDoc> {
  const p = useApp.getState().project;
  if (!p) return EMPTY_URBAN_PLAN;
  const doc = await api.get<UrbanPlanDoc | null>(`/api/projects/${encodeURIComponent(p.id)}/docs/urbanplan`).catch(() => null);
  const d = doc && Array.isArray(doc.zones) ? { ...EMPTY_URBAN_PLAN, ...doc } : EMPTY_URBAN_PLAN;
  usePlans.setState({ doc: d, loaded: true });
  drawPlan();
  return d;
}

export async function savePlan(doc: UrbanPlanDoc): Promise<void> {
  const p = useApp.getState().project;
  if (!p) return;
  usePlans.setState({ doc });
  drawPlan();
  await api.put(`/api/projects/${encodeURIComponent(p.id)}/docs/urbanplan`, { ...doc, updatedAt: new Date().toISOString() }).catch((e: unknown) => toast.error('Piano non salvato', e instanceof Error ? e.message : String(e)));
}

export function drawPlan(): void {
  const { doc, islands } = usePlans.getState();
  setSource('plan-zones', fc(doc.zones.filter((z) => z.polygon.length >= 3).map((z): Feature => ({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(z.polygon), ...(z.holes ?? []).filter((h) => h.length >= 3).map(ring)] },
    properties: { id: z.id, code: z.code, cls: z.dm1444, color: DM1444_COLOR[z.dm1444] },
  }))));
  setSource('plan-constraints', fc(doc.constraints.filter((c) => c.polygon.length >= 3).map((c): Feature => ({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(c.polygon), ...(c.holes ?? []).filter((h) => h.length >= 3).map(ring)] },
    properties: { id: c.id, type: c.type, name: c.name },
  }))));
  setSource('islands', fc(islands.map((i): Feature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(i.zonePolygon)] }, properties: { id: i.id, proposal: i.proposal } }))));
}

/** PGTU classes on the map (authored or OSM-derived), coloured by class. */
export function drawFunctionalClasses(): void {
  const net = useApp.getState().network;
  if (!net) return;
  const cls = effectiveFunctionalClasses(net);
  setSource('func-class', fc(Object.values(net.roads).filter((r) => cls[r.id]).map((r): Feature => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: r.axis.map((p) => [p[0], p[1]]) },
    properties: { id: r.id, cls: cls[r.id]!, color: FUNCTIONAL_COLOR[cls[r.id]!], authored: !!r.functionalClass },
  }))));
}

export function showPlanLayers(which: 'urban' | 'traffic', on = true): void {
  if (which === 'urban') { toggleLayer('plan-zones', on); toggleLayer('plan-constraints', on); }
  else { toggleLayer('func-class', on); toggleLayer('islands', on); if (on) drawFunctionalClasses(); }
}
