import { create } from 'zustand';
import type { Map as MLMap } from 'maplibre-gl';
import { api } from '../api/client';
import type { WmsPublic } from '../api/types';
import type { Basemap } from './basemaps';
import type { LayerDef } from './layers';

/**
 * Official technical maps (WMS: regional CTR/DBT, cadastre) configured by the administrator.
 * The browser only knows ids: tiles come from the server proxy /api/tiles/wms/<id>/{z}/{x}/{y}.png.
 */
export const useWms = create<{ services: readonly WmsPublic[]; loaded: boolean }>(() => ({ services: [], loaded: false }));

export async function loadWms(): Promise<void> {
  try {
    useWms.setState({ services: await api.get<WmsPublic[]>('/api/tiles/wms'), loaded: true });
  } catch {
    useWms.setState({ loaded: true }); // keep the last list: the map works without official layers
  }
}

export const WMS_DEFAULT_OPACITY = 0.85;
/** Map layer / source / layer-registry id of a WMS overlay. */
export const wmsLayerId = (id: string) => `wms-${id}`;
export const wmsTiles = (id: string) => `/api/tiles/wms/${encodeURIComponent(id)}/{z}/{x}/{y}.png`;

export function wmsBasemaps(services: readonly WmsPublic[]): Basemap[] {
  return services.filter((s) => s.kind === 'basemap').map((s) => ({
    id: `wms-${s.id}`, label: s.label, tiles: wmsTiles(s.id), attribution: s.attribution || s.label, maxzoom: 22, minzoom: s.minzoom || 0,
    theme: 'light', background: '#ffffff', imagery: true,
  }));
}

export function wmsLayerDefs(services: readonly WmsPublic[]): LayerDef[] {
  return services.filter((s) => s.kind === 'overlay').map((s) => ({
    id: wmsLayerId(s.id), label: s.label, category: 'official', mapLayers: [wmsLayerId(s.id)], defaultVisible: false,
    source: s.attribution || 'Servizio WMS', opacity: [[wmsLayerId(s.id), 'raster-opacity']], defaultOpacity: WMS_DEFAULT_OPACITY,
    ...(s.minzoom ? { minzoom: s.minzoom } : {}),
  }));
}

/**
 * Adds the raster layers of the configured overlays (under road surfaces and assets) and removes
 * the ones no longer configured. Idempotent: called on load, after a theme rebuild and when the list changes.
 */
export function syncWmsOverlays(map: MLMap, services: readonly WmsPublic[], visible: Record<string, boolean>, opacity: Record<string, number>): void {
  const overlays = services.filter((s) => s.kind === 'overlay');
  const want = new Set(overlays.map((s) => wmsLayerId(s.id)));
  const style = map.getStyle();
  for (const l of style.layers) if (l.id.startsWith('wms-') && !want.has(l.id)) map.removeLayer(l.id);
  for (const id of Object.keys(style.sources)) if (id.startsWith('wms-') && !want.has(id)) map.removeSource(id);
  const before = map.getLayer('surfaces-fill') ? 'surfaces-fill' : undefined;
  for (const s of overlays) {
    const id = wmsLayerId(s.id);
    if (!map.getSource(id)) map.addSource(id, { type: 'raster', tiles: [wmsTiles(s.id)], tileSize: 256, minzoom: s.minzoom || 0, maxzoom: 22, attribution: s.attribution || s.label });
    if (!map.getLayer(id)) {
      map.addLayer({
        id, type: 'raster', source: id, layout: { visibility: visible[id] ? 'visible' : 'none' },
        paint: { 'raster-opacity': opacity[id] ?? WMS_DEFAULT_OPACITY, 'raster-fade-duration': 120 },
      }, before);
    }
  }
}
