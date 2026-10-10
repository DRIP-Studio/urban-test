import { create } from 'zustand';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { LAYERS, allLayerDefs, setLayerOpacity, setLayerVisible, type SourceId } from './layers';
import type { Feature, FeatureCollection } from '../engine/geojson';
import { fc } from '../engine/geojson';

interface MapUiState {
  basemap: string;
  visible: Record<string, boolean>;
  opacity: Record<string, number>;
  zoom: number;
  center: [number, number];
  pointer: [number, number] | null;
  ready: boolean;
  /** Metres per pixel at the current zoom (status bar scale). */
  mpp: number;
  /** objects: furniture and signs align to the road, point markings centre on the lane. */
  snap: { node: boolean; edge: boolean; grid: boolean; angle: boolean; objects: boolean };
  snapEnabled: boolean;
  gridM: number;
  /** Focus mode: tool rail and inspector hidden, map edge to edge. */
  focus: boolean;
}

const persisted = (() => { try { return JSON.parse(localStorage.getItem('drip-urban:map') ?? '{}') as Partial<MapUiState>; } catch { return {}; } })();

export const useMapUi = create<MapUiState>(() => ({
  basemap: persisted.basemap ?? 'technical',
  visible: { ...Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultVisible])), ...(persisted.visible ?? {}) },
  opacity: persisted.opacity ?? {},
  zoom: 15, center: [14.2745, 40.9416], pointer: null, ready: false, mpp: 1,
  snap: { node: true, edge: true, grid: false, angle: true, objects: true, ...(persisted.snap ?? {}) },
  snapEnabled: persisted.snapEnabled ?? (persisted.snap ? Object.values(persisted.snap).some(Boolean) : true),
  gridM: persisted.gridM ?? 1,
  focus: false,
}));

useMapUi.subscribe((s) => {
  try { localStorage.setItem('drip-urban:map', JSON.stringify({ basemap: s.basemap, visible: s.visible, opacity: s.opacity, snap: s.snap, snapEnabled: s.snapEnabled, gridM: s.gridM })); } catch { /* storage unavailable */ }
});

let map: MLMap | null = null;
export const getMap = () => map;
export function setMapInstance(m: MLMap | null): void { map = m; }

export function setSource(id: SourceId, data: FeatureCollection | null): void {
  const s = map?.getSource(id) as GeoJSONSource | undefined;
  s?.setData((data ?? fc()) as never);
}

const synced = new WeakMap<MLMap, Map<string, Map<string, string>>>();
/**
 * Like setSource, but after the first call only features whose content changed are sent
 * (by `properties.id`). For large sources rebuilt from the network on every edit.
 */
export function syncSource(id: SourceId, data: FeatureCollection): void {
  if (!map) return;
  const s = map.getSource(id) as GeoJSONSource | undefined;
  if (!s) return;
  let perMap = synced.get(map);
  if (!perMap) synced.set(map, (perMap = new Map()));
  const next = new Map<string, string>();
  for (const f of data.features) next.set(String(f.properties.id), JSON.stringify(f));
  const prev = perMap.get(id);
  perMap.set(id, next);
  if (!prev) { void s.setData(data as never); return; }
  const add = data.features.filter((f) => prev.get(String(f.properties.id)) !== next.get(String(f.properties.id)));
  const remove = [...prev.keys()].filter((k) => !next.has(k));
  if (add.length || remove.length) void s.updateData({ add: add as never, remove });
}

/** Incremental update by feature id (sources declare promoteId: 'id'). */
export function updateSource(id: SourceId, diff: { add?: Feature[]; remove?: string[] }): void {
  const s = map?.getSource(id) as GeoJSONSource | undefined;
  void s?.updateData({ add: diff.add as never, remove: diff.remove });
}

export function toggleLayer(id: string, visible?: boolean): void {
  const def = allLayerDefs().find((l) => l.id === id);
  if (!def) return;
  const v = visible ?? !useMapUi.getState().visible[id];
  useMapUi.setState((s) => ({ visible: { ...s.visible, [id]: v } }));
  if (map) setLayerVisible(map, def, v);
}

export function setOpacity(id: string, value: number): void {
  const def = allLayerDefs().find((l) => l.id === id);
  if (!def) return;
  useMapUi.setState((s) => ({ opacity: { ...s.opacity, [id]: value } }));
  if (map) setLayerOpacity(map, def, value);
}

export function flyTo(center: [number, number], zoom?: number): void {
  map?.flyTo({ center, zoom: zoom ?? Math.max(map.getZoom(), 17.5), duration: 700, essential: true });
}

export function fitBounds(b: readonly [number, number, number, number], padding = 60): void {
  map?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, duration: 600 });
}

// Development-only handle for automated UI verification.
if (import.meta.env.DEV) (window as unknown as { __dripMap: unknown }).__dripMap = { getMap, flyTo, useMapUi };
