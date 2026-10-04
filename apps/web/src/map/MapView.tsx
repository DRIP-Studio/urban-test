import { api } from '../api/client';
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { MapMouseEvent, RasterSourceSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useLive } from '../traffic/live';
import { engine } from '../engine/engine';
import { useApp } from '../state/store';
import { selectionFC } from '../tools/select';
import { NetworkIndex } from '../tools/snap';
import { toolById } from '../tools/registry';
import type { ToolContext, ToolEvent } from '../tools/types';
import { removeVertexAt } from '../tools/edit';
import { useContextMenu } from '../shell/contextMenu';
import { basemapById } from './basemaps';
import { installImageLoader } from './images';
import { PX_PER_M } from './furnitureSprite';
import { SIGN_PLATE_M } from './sources';
import { addProjectLayers, allLayerDefs, setLayerOpacity, setLayerVisible } from './layers';
import { setMapInstance, setSource, syncSource, updateSource, useMapUi } from './mapStore';
import { drawDrainage } from '../state/drainage';
import { assetsFC, buildingsFC, structuresFC, contextFC, labelsFC, zonesFC, restrictionsFC, preferentialLanesFC } from './sources';
import { renderSignalHeads } from './signalsLive';
import { loadWms, syncWmsOverlays, useWms } from './wms';

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
  const b = basemapById(id);
  map.setPaintProperty('background', 'background-color', b.background);
  // By style layer, so that basemaps no longer configured (official WMS removed) are hidden too.
  for (const l of map.getStyle().layers) {
    if (l.id.startsWith('basemap-')) map.setLayoutProperty(l.id, 'visibility', l.id === `basemap-${b.id}` || l.id === `basemap-${b.id}-overlay` ? 'visible' : 'none');
  }
  if (b.tiles && !map.getSource(`basemap-${b.id}`)) {
    const src: RasterSourceSpecification = { type: 'raster', tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution, ...(b.minzoom ? { minzoom: b.minzoom } : {}) };
    map.addSource(`basemap-${b.id}`, src);
    map.addLayer({ id: `basemap-${b.id}`, type: 'raster', source: `basemap-${b.id}`, paint: { 'raster-fade-duration': 120 } }, 'context-fill');
    if (b.overlay) {
      map.addSource(`basemap-${b.id}-overlay`, { type: 'raster', tiles: [b.overlay], tileSize: 256, maxzoom: b.maxzoom });
      map.addLayer({ id: `basemap-${b.id}-overlay`, type: 'raster', source: `basemap-${b.id}-overlay` });
    }
  }
  // Over imagery the city context is hidden; the project's physical model stays.
  const imagery = !!b.imagery;
  const visibleOpacity: Record<string, [string, number]> = { 'context-fill': ['fill-opacity', 0.9], 'buildings-fill': ['fill-opacity', 0.95], 'buildings-line': ['line-opacity', 1] };
  for (const [l, [prop, v]] of Object.entries(visibleOpacity)) if (map.getLayer(l)) map.setPaintProperty(l, prop as never, (imagery ? 0 : v) as never);
  if (map.getLayer('surfaces-fill')) map.setPaintProperty('surfaces-fill', 'fill-opacity', imagery ? ['case', ['in', ['get', 'kind'], ['literal', ['sidewalk', 'corner', 'footpath']]], 0.55, 0.92] : ['case', ['==', ['get', 'kind'], 'area'], 0.92, 1]);
  applyCtr(map, b.id === 'ctr');
}

/**
 * Carta tecnica (CTR / carta tecnica comunale): black linework on white, buildings with a diagonal hatch,
 * no carriageway colours or horizontal markings, labels in black. Paint values are restored when leaving.
 */
const CTR_PAINT: [string, string, unknown][] = [
  ['buildings-fill', 'fill-color', '#ffffff'], ['buildings-line', 'line-color', '#111111'], ['buildings-line', 'line-width', 0.9],
  ['context-fill', 'fill-color', ['match', ['get', 'kind'], 'water', '#e4eef5', 'green', '#f3f7ef', 'leisure', '#f3f7ef', '#ffffff']],
  ['surfaces-fill', 'fill-color', ['match', ['get', 'kind'], 'sidewalk', '#fafafa', 'corner', '#fafafa', 'green', '#f3f7ef', 'roundabout_island', '#f3f7ef', '#ffffff']],
  ['surfaces-outline', 'line-color', '#111111'], ['kerbs-line', 'line-color', '#111111'], ['kerbs-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 15, 0.5, 20, 1.2]],
  ['markings-fill', 'fill-opacity', 0], ['labels-text', 'text-color', '#111111'],
];
const saved = new Map<string, unknown>();
function applyCtr(map: maplibregl.Map, on: boolean): void {
  for (const [layer, prop, value] of CTR_PAINT) {
    if (!map.getLayer(layer)) continue;
    const key = `${layer}|${prop}`;
    if (on) {
      if (!saved.has(key)) saved.set(key, map.getPaintProperty(layer, prop as never));
      map.setPaintProperty(layer, prop as never, value as never);
    } else if (saved.has(key)) {
      map.setPaintProperty(layer, prop as never, saved.get(key) as never);
      saved.delete(key);
    }
  }
  if (map.getLayer('buildings-hatch')) map.setLayoutProperty('buildings-hatch', 'visibility', on ? 'visible' : 'none');
}

function themeOf(id: string): 'light' | 'dark' { return basemapById(id).theme; }

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
    installImageLoader(map, catalogs.materials.items, () => useApp.getState().catalogs?.furniture.items ?? []);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');

    // Rebuilt when the catalogue changes (project 3D models are added after the map opens).
    let furnCat = catalogs.furniture;
    let furnitureById = new Map(furnCat.items.map((i) => [i.id, i]));
    let theme = themeOf(basemap);
    // Tilted map: plate offsets follow the pitch (a vertical metre is ~ ground metre × sin(pitch) on screen).
    let removedRef: Readonly<Record<string, true>> | undefined;
    let signs3dBase: ReturnType<typeof assetsFC>['signs3d'] | null = null;
    let signsRaf = 0;
    const updateSigns3d = () => {
      if (!signs3dBase || map.getPitch() <= 12) return;
      const k = Math.sin((map.getPitch() * Math.PI) / 180) * (48 / SIGN_PLATE_M); // 96 px raster at ratio 2 = 48 css px
      setSource('signs3d', { ...signs3dBase, features: signs3dBase.features.map((f) => ({ ...f, properties: { ...f.properties, off: [0, -Number(f.properties.hm) * k] } })) });
    };
    map.on('pitch', () => { cancelAnimationFrame(signsRaf); signsRaf = requestAnimationFrame(updateSigns3d); });
    const pushNetwork = () => {
      const { network, selection } = useApp.getState();
      if (!network) return;
      syncSource('labels', labelsFC(network));
      syncSource('zones', zonesFC(network));
      syncSource('restrictions', restrictionsFC(network));
      syncSource('lanes-pref', preferentialLanesFC(network));
      const cat = useApp.getState().catalogs?.furniture;
      if (cat && cat !== furnCat) { furnCat = cat; furnitureById = new Map(cat.items.map((i) => [i.id, i])); }
      const a = assetsFC(network, baseline.origin, furnitureById);
      syncSource('asset-fp', a.fp); syncSource('asset-pt', a.pt); syncSource('signals', a.signals); syncSource('asset-parts', a.parts);
      syncSource('sign-poles', a.poles);
      syncSource('structures', structuresFC(network, baseline.origin));
      drawDrainage(network);
      if (network.removedBuildings !== removedRef) { removedRef = network.removedBuildings; setSource('buildings', buildingsFC(baseline, removedRef)); }
      signs3dBase = a.signs3d; updateSigns3d();
      setSource('selection', selectionFC(selection, network));
    };
    const init = () => {
      addProjectLayers(map, catalogs.materials.items, theme === 'dark');
      removedRef = useApp.getState().network?.removedBuildings; setSource('buildings', buildingsFC(baseline, removedRef));
      setSource('context', contextFC(baseline));
      // Large project: whole-city roads around the loaded work area.
      const proj = useApp.getState().project;
      if (proj?.large) {
        const [w, s, e, n] = baseline.bbox;
        setSource('work-area', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] }, properties: {} }] });
        void api.get<{ type: 'FeatureCollection'; features: unknown[] }>(`/api/projects/${encodeURIComponent(proj.id)}/overview`).then((fcx) => setSource('overview', fcx as never)).catch(() => undefined);
      } else { setSource('overview', null); setSource('work-area', null); }
      if (engine.lastPhysical) {
        setSource('surfaces', engine.lastPhysical.surfaces); setSource('markings', engine.lastPhysical.markings); setSource('lines', engine.lastPhysical.lines);
      }
      pushNetwork();
      renderSignalHeads();
      void import('../state/sidewalks').then((m) => m.redrawSidewalks());
      applyBasemap(map, useMapUi.getState().basemap);
      const st = useMapUi.getState();
      syncWmsOverlays(map, useWms.getState().services, st.visible, st.opacity);
      for (const def of allLayerDefs()) { setLayerVisible(map, def, st.visible[def.id] ?? def.defaultVisible); if (st.opacity[def.id] !== undefined) setLayerOpacity(map, def, st.opacity[def.id]!); }
      // Furniture symbols are drawn at PX_PER_M px/m (pixelRatio 2): size them in metres at this latitude.
      const pxPerM19 = 2 ** 19 * 512 / (40_075_016.7 * Math.cos((baseline.origin[1] * Math.PI) / 180));
      const k = pxPerM19 / (PX_PER_M / 2);
      // Real scale, but never smaller than a readable minimum (minK per item, see sources.ts).
      // Sign plates in 3D at their real size (0.6 m), 96 px rasters.
      const plate = (z: number) => (pxPerM19 * 2 ** (z - 19) * SIGN_PLATE_M) / 48;
      if (map.getLayer('signs-3d')) map.setLayoutProperty('signs-3d', 'icon-size', ['interpolate', ['exponential', 2], ['zoom'], 15, Math.max(0.08, plate(15)), 19, plate(19), 22, plate(22)] as never);
      const atLeast = (v: number) => ['max', v, ['coalesce', ['get', 'minK'], 0]];
      if (map.getLayer('asset-3d')) map.setLayoutProperty('asset-3d', 'icon-size', ['interpolate', ['exponential', 2], ['zoom'], 15, atLeast(k / 16), 19, atLeast(k), 22, atLeast(k * 8)] as never);
      applyPitchMode();
      useMapUi.setState({ ready: true });
    };
    // Tilted map: furniture and buildings become real extrusions; flat map: plan symbols with volume.
    const applyPitchMode = () => {
      const tilted = map.getPitch() > 12;
      for (const id of ['asset-fp-extrude', 'buildings-extrude', 'surfaces-raised', 'structures-piers', 'vehicles-extrude', 'buildings-roof']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', tilted ? 'visible' : 'none');
      if (map.getLayer('asset-3d')) map.setLayoutProperty('asset-3d', 'visibility', tilted ? 'none' : 'visible');
      if (map.getLayer('vehicles-fill') && map.getLayoutProperty('vehicles-fill', 'visibility') !== 'none' === tilted) map.setLayoutProperty('vehicles-fill', 'visibility', tilted ? 'none' : 'visible');
      for (const id of ['asset-pt-sign', 'sign-poles-icon']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', tilted ? 'none' : 'visible');
      if (map.getLayer('signs-3d')) map.setLayoutProperty('signs-3d', 'visibility', tilted ? 'visible' : 'none');
      updateSigns3d();
    };
    map.on('pitchend', applyPitchMode);
    map.on('load', init);
    // ZTL LED panels follow the clock: refresh their state every minute.
    const ledTimer = window.setInterval(() => { if (map.loaded()) pushNetwork(); }, 60_000);
    // PMV in live mode follow each traffic refresh.
    const offLive = useLive.subscribe((s, prev) => { if (s.capturedAt !== prev.capturedAt || s.status !== prev.status) { if (map.loaded()) pushNetwork(); } });

    // Only what changed goes to MapLibre: re-indexing the whole city on each edit cost ~350 ms.
    const offPhys = engine.onPhysical((m) => {
      for (const id of ['surfaces', 'markings', 'lines'] as const) {
        const d = m.diff[id];
        if (d.full) setSource(id, engine.lastPhysical![id]);
        else if (d.add.length || d.remove.length) updateSource(id, { add: d.add, remove: d.remove });
      }
    });
    const offApp = useApp.subscribe((st, prev) => {
      if (st.netVersion !== prev.netVersion || st.catalogs !== prev.catalogs) pushNetwork();
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
        syncWmsOverlays(map, useWms.getState().services, st.visible, st.opacity);
        for (const def of allLayerDefs()) setLayerVisible(map, def, st.visible[def.id] ?? def.defaultVisible);
      }
      applyBasemap(map, st.basemap);
    });
    // Official WMS list (re)loaded: add/remove overlays, re-apply a WMS basemap chosen before the list arrived.
    const offWms = useWms.subscribe((w, prev) => {
      if (w.services === prev.services || !useMapUi.getState().ready) return;
      const st = useMapUi.getState();
      syncWmsOverlays(map, w.services, st.visible, st.opacity);
      applyBasemap(map, st.basemap);
    });
    void loadWms();

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
      offPhys(); offApp(); offUi(); offWms(); ro.disconnect(); window.clearInterval(ledTimer); offLive();
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
