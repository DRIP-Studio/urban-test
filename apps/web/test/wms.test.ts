import { describe, expect, it } from 'vitest';
import type { Map as MLMap } from 'maplibre-gl';
import type { WmsPublic } from '../src/api/types';
import { CATEGORY_LABEL } from '../src/map/layers';
import { syncWmsOverlays, wmsBasemaps, wmsLayerDefs, WMS_DEFAULT_OPACITY } from '../src/map/wms';

const svc = (id: string, kind: 'basemap' | 'overlay'): WmsPublic => ({ id, label: id, kind, attribution: `© ${id}`, transparent: kind === 'overlay', minzoom: 15, format: 'image/png' });

describe('official WMS maps', () => {
  const list = [svc('catasto', 'overlay'), svc('ctr', 'basemap')];
  it('splits basemaps and overlays, tiles only through the server proxy', () => {
    const b = wmsBasemaps(list);
    expect(b.map((x) => x.id)).toEqual(['wms-ctr']);
    expect(b[0]!.tiles).toBe('/api/tiles/wms/ctr/{z}/{x}/{y}.png');
    const l = wmsLayerDefs(list);
    expect(l.map((x) => x.id)).toEqual(['wms-catasto']);
    expect(CATEGORY_LABEL[l[0]!.category]).toBeTruthy();
    expect(l[0]!.defaultOpacity).toBe(WMS_DEFAULT_OPACITY);
    expect(l[0]!.source).toBe('© catasto');
  });

  it('adds overlays under the road surfaces and removes the ones no longer configured', () => {
    const layers: { id: string; before?: string; paint?: Record<string, unknown> }[] = [{ id: 'context-fill' }, { id: 'surfaces-fill' }, { id: 'wms-old' }];
    const sources = new Set(['wms-old']);
    const map = {
      getStyle: () => ({ layers: [...layers], sources: Object.fromEntries([...sources].map((s) => [s, {}])) }),
      getLayer: (id: string) => layers.find((l) => l.id === id),
      getSource: (id: string) => (sources.has(id) ? {} : undefined),
      addSource: (id: string) => { sources.add(id); },
      removeSource: (id: string) => { sources.delete(id); },
      addLayer: (l: { id: string; paint?: Record<string, unknown> }, before?: string) => { layers.push({ ...l, before }); },
      removeLayer: (id: string) => { layers.splice(layers.findIndex((l) => l.id === id), 1); },
    } as unknown as MLMap;
    syncWmsOverlays(map, list, {}, {});
    const added = layers.find((l) => l.id === 'wms-catasto')!;
    expect(added.before).toBe('surfaces-fill');
    expect(added.paint!['raster-opacity']).toBe(WMS_DEFAULT_OPACITY);
    expect(layers.some((l) => l.id === 'wms-old')).toBe(false);
    expect([...sources]).toEqual(['wms-catasto']);
    // Idempotent.
    syncWmsOverlays(map, list, {}, {});
    expect(layers.filter((l) => l.id === 'wms-catasto')).toHaveLength(1);
  });
});
