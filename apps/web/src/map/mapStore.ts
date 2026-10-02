import { create } from 'zustand';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { LAYERS, setLayerOpacity, setLayerVisible, type SourceId } from './layers';
import type { FeatureCollection } from '../engine/geojson';
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
  snap: { node: boolean; edge: boolean; grid: boolean; angle: boolean };
  gridM: number;
}

const persisted = (() => { try { return JSON.parse(localStorage.getItem('drip-urban:map') ?? '{}') as Partial<MapUiState>; } catch { return {}; } })();

export const useMapUi = create<MapUiState>(() => ({
  basemap: persisted.basemap ?? 'technical',
  visible: { ...Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultVisible])), ...(persisted.visible ?? {}) },
  opacity: persisted.opacity ?? {},
  zoom: 15, center: [14.2745, 40.9416], pointer: null, ready: false, mpp: 1,
  snap: persisted.snap ?? { node: true, edge: true, grid: false, angle: true },
  gridM: persisted.gridM ?? 1,
}));

useMapUi.subscribe((s) => {
  try { localStorage.setItem('drip-urban:map', JSON.stringify({ basemap: s.basemap, visible: s.visible, opacity: s.opacity, snap: s.snap, gridM: s.gridM })); } catch { /* storage unavailable */ }
});

let map: MLMap | null = null;
export const getMap = () => map;
export function setMapInstance(m: MLMap | null): void { map = m; }

export function setSource(id: SourceId, data: FeatureCollection | null): void {
  const s = map?.getSource(id) as GeoJSONSource | undefined;
  s?.setData((data ?? fc()) as never);
}

export function toggleLayer(id: string, visible?: boolean): void {
  const def = LAYERS.find((l) => l.id === id);
  if (!def) return;
  const v = visible ?? !useMapUi.getState().visible[id];
  useMapUi.setState((s) => ({ visible: { ...s.visible, [id]: v } }));
  if (map) setLayerVisible(map, def, v);
}

export function setOpacity(id: string, value: number): void {
  const def = LAYERS.find((l) => l.id === id);
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
