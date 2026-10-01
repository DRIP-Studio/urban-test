import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MaterialItem } from '../api/types';
import type { FeatureCollection } from '../engine/geojson';
import { materialColorExpr } from '../map/layers';
import { Segmented } from '../ui/controls';

export type CompareMode = 'slider' | 'side' | 'toggle';
export interface Camera { center: [number, number]; zoom: number; bearing: number; pitch: number }

export interface StateData { surfaces: FeatureCollection; markings?: FeatureCollection; buildings?: FeatureCollection; assets?: FeatureCollection; label: string }

function style(data: StateData, materials: readonly MaterialItem[], editorial: boolean): StyleSpecification {
  return {
    version: 8,
    glyphs: `${location.origin}/glyphs/{fontstack}/{range}.pbf`,
    sources: {
      base: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© CARTO, © OpenStreetMap contributors' },
      s: { type: 'geojson', data: data.surfaces as never },
      m: { type: 'geojson', data: (data.markings ?? { type: 'FeatureCollection', features: [] }) as never },
      b: { type: 'geojson', data: (data.buildings ?? { type: 'FeatureCollection', features: [] }) as never },
      a: { type: 'geojson', data: (data.assets ?? { type: 'FeatureCollection', features: [] }) as never },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': editorial ? '#f5f3ef' : '#e9e6df' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': editorial ? 0.55 : 0.8, 'raster-saturation': -0.6 } },
      { id: 'b', type: 'fill', source: 'b', paint: { 'fill-color': editorial ? '#e4ddd2' : '#d6d1c7' } },
      { id: 's', type: 'fill', source: 's', paint: { 'fill-color': materialColorExpr(materials), 'fill-antialias': false } },
      { id: 'sp', type: 'line', source: 's', filter: ['==', ['get', 'state'], 'project'], paint: { 'line-color': editorial ? '#7a1f32' : '#e8772e', 'line-width': 1.6 } },
      { id: 'm', type: 'fill', source: 'm', minzoom: 15.5, paint: { 'fill-color': '#f4f3ef' } },
      { id: 'a', type: 'circle', source: 'a', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 20, 6], 'circle-color': editorial ? '#7a1f32' : '#e8772e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },
    ],
  };
}

export function BeforeAfter({ before, after, materials, initial, editorial = false, camera }: {
  before: StateData; after: StateData; materials: readonly MaterialItem[]; initial: [number, number, number, number]; editorial?: boolean; camera?: Camera | null;
}) {
  const [mode, setMode] = useState<CompareMode>('slider');
  const [pos, setPos] = useState(50);
  const [showAfter, setShowAfter] = useState(true);
  const aRef = useRef<HTMLDivElement>(null), bRef = useRef<HTMLDivElement>(null);
  const maps = useRef<{ a: MLMap; b: MLMap } | null>(null);
  useEffect(() => {
    if (!aRef.current || !bRef.current) return;
    const opts = { bounds: [[initial[0], initial[1]], [initial[2], initial[3]]] as [[number, number], [number, number]], fitBoundsOptions: { padding: 40 }, attributionControl: { compact: true }, maxZoom: 21 };
    const a = new maplibregl.Map({ container: aRef.current, style: style(before, materials, editorial), ...opts });
    const b = new maplibregl.Map({ container: bRef.current, style: style(after, materials, editorial), ...opts });
    let syncing = false;
    const sync = (from: MLMap, to: MLMap) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
      syncing = false;
    };
    a.on('move', sync(a, b));
    b.on('move', sync(b, a));
    b.on('moveend', () => window.dispatchEvent(new CustomEvent('drip:ba-camera', { detail: { center: [b.getCenter().lng, b.getCenter().lat], zoom: b.getZoom(), bearing: b.getBearing(), pitch: b.getPitch() } })));
    maps.current = { a, b };
    const ro = new ResizeObserver(() => { a.resize(); b.resize(); });
    ro.observe(aRef.current.parentElement!);
    return () => { ro.disconnect(); a.remove(); b.remove(); maps.current = null; };
  }, [before, after, materials, initial, editorial]);
  useEffect(() => {
    if (camera && maps.current) maps.current.b.flyTo({ ...camera, duration: 1200 });
  }, [camera]);
  useEffect(() => { requestAnimationFrame(() => { maps.current?.a.resize(); maps.current?.b.resize(); }); }, [mode]);
  return (
    <div className={`before-after ba-${mode} ${editorial ? 'is-editorial' : ''}`}>
      <div className="ba-maps">
        <div className="ba-map ba-before" ref={aRef} style={mode === 'toggle' ? { visibility: showAfter ? 'hidden' : 'visible' } : undefined} />
        <div className="ba-map ba-after" ref={bRef}
          style={mode === 'slider' ? { clipPath: `inset(0 0 0 ${pos}%)` } : mode === 'toggle' ? { visibility: showAfter ? 'visible' : 'hidden' } : undefined} />
        {mode === 'slider' ? (
          <>
            <input className="ba-range" type="range" min={0} max={100} value={pos} aria-label="Confronto prima/dopo" onChange={(e) => setPos(Number(e.target.value))} />
            <span className="ba-line" style={{ left: `${pos}%` }} aria-hidden />
          </>
        ) : null}
        <span className="ba-tag ba-tag-before">{before.label}</span>
        <span className="ba-tag ba-tag-after">{after.label}</span>
      </div>
      <div className="ba-controls">
        <Segmented<CompareMode> label="Modalità confronto" size="sm" value={mode} onChange={setMode} options={[{ value: 'slider', label: 'Cursore' }, { value: 'side', label: 'Affiancati' }, { value: 'toggle', label: 'Alterna' }]} />
        {mode === 'toggle' ? <Segmented<'0' | '1'> label="Stato" size="sm" value={showAfter ? '1' : '0'} onChange={(v) => setShowAfter(v === '1')} options={[{ value: '0', label: before.label }, { value: '1', label: after.label }]} /> : null}
      </div>
    </div>
  );
}
