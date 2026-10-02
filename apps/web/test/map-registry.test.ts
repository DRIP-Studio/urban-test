import { describe, expect, it } from 'vitest';
import type { Map as MLMap } from 'maplibre-gl';
import { BASEMAPS, tileFor } from '../src/map/basemaps';
import { addProjectLayers, LAYERS, SOURCES } from '../src/map/layers';

/** Minimal stand-in that records what addProjectLayers creates. */
function recordingMap() {
  const sources = new Set<string>();
  const layers: { id: string; source?: string }[] = [];
  const map = {
    addSource: (id: string) => { sources.add(id); },
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addLayer: (l: { id: string; source?: string }) => { layers.push(l); },
    getLayer: (id: string) => layers.find((l) => l.id === id),
  };
  return { map: map as unknown as MLMap, sources, layers };
}

describe('layer registry', () => {
  const { map, sources, layers } = recordingMap();
  addProjectLayers(map, [{ id: 'asphalt', color: '#444' } as never], false);

  it('creates every declared source exactly once', () => {
    expect([...sources].sort()).toEqual([...SOURCES].sort());
  });
  it('has unique layer ids', () => {
    const ids = layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(LAYERS.map((l) => l.id)).size).toBe(LAYERS.length);
  });
  it('every registry entry points to map layers that exist and declare their data source', () => {
    for (const def of LAYERS) {
      expect(def.source.trim(), `${def.id} needs a data attribution`).not.toBe('');
      for (const id of def.mapLayers) {
        const l = layers.find((x) => x.id === id);
        expect(l, `${def.id} → ${id}`).toBeDefined();
      }
    }
  });
});

describe('basemaps', () => {
  it('computes slippy tiles (Frattamaggiore, z16)', () => {
    expect(tileFor(14.2747, 40.9416, 16)).toEqual({ x: 35366, y: 24585, z: 16 });
  });
  it('only lists keyless tile servers unless the provider is declared', () => {
    for (const b of BASEMAPS) {
      if (b.tiles?.startsWith('/api/')) expect(b.requires).toBeDefined();
      expect(b.tiles ?? '').not.toMatch(/cartocdn|api[_-]?key=/i);
    }
  });
});
