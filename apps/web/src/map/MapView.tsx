import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { MapMouseEvent, RasterSourceSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { engine } from '../engine/engine';
import { useApp } from '../state/store';
import { selectionFC } from '../tools/select';
import { NetworkIndex } from '../tools/snap';
import { toolById } from '../tools/registry';
import type { ToolContext, ToolEvent } from '../tools/types';
import { removeVertexAt } from '../tools/edit';
import { useContextMenu } from '../shell/contextMenu';
import { BASEMAPS } from './basemaps';
import { installImageLoader } from './images';
import { LAYERS, addProjectLayers, setLayerOpacity, setLayerVisible } from './layers';
import { setMapInstance, setSource, syncSource, updateSource, useMapUi } from './mapStore';
import { assetsFC, buildingsFC, contextFC, labelsFC, zonesFC } from './sources';
import { renderSignalHeads } from './signalsLive';

let index: NetworkIndex | null = null;
let indexVersion = -1;
/** Spatial index of the current scenario network (shared by map events and keyboard-driven tool actions). */
export function getIndex(): NetworkIndex | null {
  const { network, baseline, netVersion } = useApp.getState();
  if (!network || !baseline) return null;
  if (indexVersion !== netVersion || !index) { index = new NetworkIndex(network, baseline.origin); indexVersion = netVersion; }
  return index;
}

function applyBasemap(map: maplibregl.Map, id: string): void {
  const b = BASEMAPS.find((x) => x.id === id) ?? BASEMAPS[0]!;
  map.setPaintProperty('background', 'background-color', b.background);
  for (const other of BASEMAPS) {
    for (const suffix of ['', '-overlay']) {
      const lid = `basemap-${other.id}${suffix}`;
      if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', other.id === b.id ? 'visible' : 'none');
    }
  }
  if (b.tiles && !map.getSource(`basemap-${b.id}`)) {
    const src: RasterSourceSpecification = { type: 'raster', tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
    map.addSource(`basemap-${b.id}`, src);
    map.addLayer({ id: `basemap-${b.id}`, type: 'raster', source: `basemap-${b.id}`, paint: { 'raster-fade-duration': 120 } }, 'context-fill');
    if (b.overlay) {
      map.addSource(`basemap-${b.id}-overlay`, { type: 'raster', tiles: [b.overlay], tileSize: 256, maxzoom: b.maxzoom });
      map.addLayer({ id: `basemap-${b.id}-overlay`, type: 'raster', source: `basemap-${b.id}-overlay` });
    }
  }
  // Over imagery the city context is hidden; the project's physical model stays.
  const imagery = b.id === 'satellite' || b.id === 'hybrid' || b.id === 'google_satellite' || b.id === 'osm' || b.id === 'terrain';
  const visibleOpacity: Record<string, [string, number]> = { 'context-fill': ['fill-opacity', 0.9], 'buildings-fill': ['fill-opacity', 0.95], 'buildings-line': ['line-opacity', 1] };
  for (const [l, [prop, v]] of Object.entries(visibleOpacity)) if (map.getLayer(l)) map.setPaintProperty(l, prop as never, (imagery ? 0 : v) as never);
  if (map.getLayer('surfaces-fill')) map.setPaintProperty('surfaces-fill', 'fill-opacity', imagery ? ['case', ['in', ['get', 'kind'], ['literal', ['sidewalk', 'corner', 'footpath']]], 0.55, 0.92] : ['case', ['==', ['get', 'kind'], 'area'], 0.92, 1]);
}

function themeOf(id: string): 'light' | 'dark' { return (BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0]!).theme; }

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const openMenu = useContextMenu((s) => s.open);

  useEffect(() => {
    const { baseline, catalogs } = useApp.getState();
    if (!el.current || !baseline || !catalogs) return;
    const [w, s, e, n] = baseline.bbox;
    const basemap = useMapUi.getState().basemap;
    const map = new maplibregl.Map({
      container: el.current,
      style: { version: 8, glyphs: `${location.origin}/glyphs/{fontstack}/{range}.pbf`, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9e6df' } }] },
      bounds: [[w, s], [e, n]], fitBoundsOptions: { padding: 40 }, maxZoom: 22, minZoom: 10, attributionControl: { compact: true },
      boxZoom: false, doubleClickZoom: false, dragRotate: true, pitchWithRotate: true, canvasContextAttributes: { antialias: true },
    });
    setMapInstance(map);
    installImageLoader(map, catalogs.materials.items);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');

    const furnitureById = new Map(catalogs.furniture.items.map((i) => [i.id, i]));
    let theme = themeOf(basemap);
    const pushNetwork = () => {
      const { network, selection } = useApp.getState();
      if (!network) return;
      syncSource('labels', labelsFC(network));
      syncSource('zones', zonesFC(network));
      const a = assetsFC(network, baseline.origin, furnitureById);
      syncSource('asset-fp', a.fp); syncSource('asset-pt', a.pt); syncSource('signals', a.signals);
      setSource('selection', selectionFC(selection, network));
    };
    const init = () => {
      addProjectLayers(map, catalogs.materials.items, theme === 'dark');
      setSource('buildings', buildingsFC(baseline));
      setSource('context', contextFC(baseline));
      if (engine.lastPhysical) {
        setSource('surfaces', engine.lastPhysical.surfaces); setSource('markings', engine.lastPhysical.markings); setSource('lines', engine.lastPhysical.lines);
      }
      pushNetwork();
      renderSignalHeads();
      applyBasemap(map, useMapUi.getState().basemap);
      const st = useMapUi.getState();
      for (const def of LAYERS) { setLayerVisible(map, def, st.visible[def.id] ?? def.defaultVisible); if (st.opacity[def.id] !== undefined) setLayerOpacity(map, def, st.opacity[def.id]!); }
      useMapUi.setState({ ready: true });
    };
    map.on('load', init);

    // Only what changed goes to MapLibre: re-indexing the whole city on each edit cost ~350 ms.
    const offPhys = engine.onPhysical((m) => {
      for (const id of ['surfaces', 'markings', 'lines'] as const) {
        const d = m.diff[id];
        if (d.full) setSource(id, engine.lastPhysical![id]);
        else if (d.add.length || d.remove.length) updateSource(id, { add: d.add, remove: d.remove });
      }
    });
    const offApp = useApp.subscribe((st, prev) => {
      if (st.netVersion !== prev.netVersion) pushNetwork();
      else if (st.selection !== prev.selection) setSource('selection', selectionFC(st.selection, st.network));
      if (st.tool !== prev.tool) {
        toolById(prev.tool).handler.deactivate?.(ctx);
        toolById(st.tool).handler.activate?.(ctx);
        map.getCanvas().style.cursor = toolById(st.tool).cursor ?? '';
      }
    });
    const offUi = useMapUi.subscribe((st, prev) => {
      if (st.basemap === prev.basemap || !map.isStyleLoaded()) return;
      const nextTheme = themeOf(st.basemap);
      if (nextTheme !== theme) {
        theme = nextTheme;
        // Theme-dependent paints: rebuild project layers, sources (and data) stay.
        for (const l of [...map.getStyle().layers].reverse()) if (l.id !== 'background' && !l.id.startsWith('basemap-')) map.removeLayer(l.id);
        addProjectLayers(map, catalogs.materials.items, theme === 'dark');
        for (const def of LAYERS) setLayerVisible(map, def, st.visible[def.id] ?? def.defaultVisible);
      }
      applyBasemap(map, st.basemap);
    });

    const ctx: ToolContext = { map, index: getIndex };
    const ev = (e: MapMouseEvent): ToolEvent => ({
      lngLat: [e.lngLat.lng, e.lngLat.lat], point: e.point, shift: e.originalEvent.shiftKey, alt: e.originalEvent.altKey,
      ctrl: e.originalEvent.ctrlKey || e.originalEvent.metaKey, button: e.originalEvent.button, features: [],
    });
    const tool = () => toolById(useApp.getState().tool).handler;
    map.on('click', (e) => tool().click?.(ev(e), ctx));
    map.on('dblclick', (e) => { e.preventDefault(); tool().dblclick?.(ev(e), ctx); });
    map.on('mousedown', (e) => { if (tool().down?.(ev(e), ctx)) { map.dragPan.disable(); } });
    map.on('mouseup', (e) => { tool().up?.(ev(e), ctx); map.dragPan.enable(); });
    let raf = 0;
    map.on('mousemove', (e) => {
      const te = ev(e);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        tool().move?.(te, ctx);
        useMapUi.setState({ pointer: [te.lngLat[0], te.lngLat[1]] });
      });
    });
    map.on('contextmenu', (e) => {
      e.preventDefault();
      if (useApp.getState().tool === 'nodes' && removeVertexAt(map, e.point)) return;
      openMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, lngLat: [e.lngLat.lng, e.lngLat.lat], point: e.point });
    });
    const updateView = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** z);
      useMapUi.setState({ zoom: z, center: [c.lng, c.lat], mpp });
    };
    map.on('moveend', updateView);
    map.on('load', updateView);
    const canvas = map.getCanvasContainer();
    const onWheel = (e: WheelEvent) => { if (tool().wheel?.(e, ctx)) { e.preventDefault(); e.stopPropagation(); } };
    canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => {
      offPhys(); offApp(); offUi(); ro.disconnect();
      canvas.removeEventListener('wheel', onWheel, { capture: true });
      useMapUi.setState({ ready: false });
      setMapInstance(null);
      map.remove();
    };
  }, [openMenu]);

  return <div className="map" ref={el} role="application" aria-label="Mappa di lavoro" />;
}

/** Captures the current map canvas as the project thumbnail (real view, not a placeholder). */
export async function captureThumbnail(map: maplibregl.Map): Promise<Blob | null> {
  return new Promise((resolve) => {
    map.once('render', () => {
      const src = map.getCanvas();
      const c = document.createElement('canvas');
      const W = 640, H = 400;
      c.width = W; c.height = H;
      const ratio = Math.max(W / src.width, H / src.height);
      const w = src.width * ratio, h = src.height * ratio;
      c.getContext('2d')!.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
      c.toBlob((b) => resolve(b), 'image/png');
    });
    map.triggerRepaint();
  });
}
