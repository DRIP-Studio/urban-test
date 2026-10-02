import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl';
import type { MaterialItem } from '../api/types';
import { fc } from '../engine/geojson';

/** Every GeoJSON source of the workstation. One owner each (see sources.ts). */
export const SOURCES = [
  'buildings', 'context', 'surfaces', 'markings', 'lines', 'labels', 'zones', 'asset-fp', 'asset-pt', 'signals',
  'traffic', 'route', 'iso', 'heat', 'moves', 'conflicts', 'transit-lines', 'transit-stops', 'vehicles', 'crashes',
  'selection', 'handles', 'draft', 'compare', 'plan-signals', 'rt-vehicles', 'civic',
] as const;
export type SourceId = (typeof SOURCES)[number];

export interface LayerDef {
  readonly id: string;
  readonly label: string;
  readonly category: 'base' | 'existing' | 'design' | 'mobility' | 'traffic' | 'safety' | 'environment' | 'transit' | 'analysis';
  readonly mapLayers: readonly string[];
  readonly defaultVisible: boolean;
  readonly source: string;
  readonly legend?: readonly { color: string; label: string }[];
  /** Opacity property per map layer for the opacity slider. */
  readonly opacity?: readonly [string, string][];
}

export const CATEGORY_LABEL: Record<LayerDef['category'], string> = {
  base: 'Base', existing: 'Città esistente', design: 'Progetto', mobility: 'Mobilità', traffic: 'Traffico', safety: 'Sicurezza',
  environment: 'Ambiente', transit: 'Trasporto pubblico', analysis: 'Analisi',
};

export const LAYERS: readonly LayerDef[] = [
  { id: 'buildings', label: 'Edifici', category: 'existing', mapLayers: ['buildings-fill', 'buildings-line'], defaultVisible: true, source: 'OpenStreetMap', opacity: [['buildings-fill', 'fill-opacity']] },
  { id: 'context', label: 'Verde, acque, aree', category: 'existing', mapLayers: ['context-fill'], defaultVisible: true, source: 'OpenStreetMap', opacity: [['context-fill', 'fill-opacity']] },
  { id: 'surfaces', label: 'Superfici stradali e marciapiedi', category: 'existing', mapLayers: ['surfaces-fill', 'surfaces-outline'], defaultVisible: true, source: 'Modello fisico DRIP (da sezione e corsie)', opacity: [['surfaces-fill', 'fill-opacity']] },
  { id: 'markings', label: 'Segnaletica orizzontale', category: 'existing', mapLayers: ['markings-fill'], defaultVisible: true, source: 'Generata dal modello corsie (CdS)' },
  { id: 'kerbs', label: 'Cordoli', category: 'existing', mapLayers: ['kerbs-line'], defaultVisible: true, source: 'Modello fisico DRIP' },
  { id: 'labels', label: 'Nomi delle strade', category: 'base', mapLayers: ['labels-text'], defaultVisible: true, source: 'OpenStreetMap' },
  { id: 'project', label: 'Evidenzia modifiche di progetto', category: 'design', mapLayers: ['project-outline', 'project-outline-rb'], defaultVisible: true, source: 'Scenario attivo', legend: [{ color: '#e8772e', label: 'Proposto' }] },
  { id: 'assets', label: 'Arredo, verde, segnali, semafori', category: 'design', mapLayers: ['asset-fp-fill', 'asset-fp-line', 'asset-pt-sign', 'asset-pt-dot', 'signals-icon'], defaultVisible: true, source: 'Esistente (OSM) + progetto' },
  { id: 'zones', label: 'Zone (ZTL, 30, pedonali…)', category: 'mobility', mapLayers: ['zones-fill', 'zones-line'], defaultVisible: true, source: 'Scenario attivo' },
  { id: 'traffic', label: 'Traffico', category: 'traffic', mapLayers: ['traffic-line'], defaultVisible: true, source: 'Live (HERE) o stima DRIP — vedi Traffic Studio',
    legend: [{ color: '#3fae6b', label: 'Scorrevole' }, { color: '#e2b13c', label: 'Rallentato' }, { color: '#e1703a', label: 'Intenso' }, { color: '#b9312a', label: 'Congestionato' }] },
  { id: 'vehicles', label: 'Veicoli simulati', category: 'traffic', mapLayers: ['vehicles-fill'], defaultVisible: true, source: 'DRIP Flow (simulazione)' },
  { id: 'route', label: 'Percorso', category: 'mobility', mapLayers: ['route-line', 'route-casing', 'compare-line'], defaultVisible: true, source: 'Navigatore DRIP sullo scenario' },
  { id: 'iso', label: 'Accessibilità / isocrone', category: 'analysis', mapLayers: ['iso-line'], defaultVisible: true, source: 'Analisi DRIP',
    legend: [{ color: '#2f7d5b', label: '≤ 5 min' }, { color: '#79a84d', label: '≤ 7 min' }, { color: '#d6a63b', label: '≤ 10 min' }, { color: '#c4643a', label: '≤ 15 min' }] },
  { id: 'heat', label: 'Heatmap sicurezza', category: 'safety', mapLayers: ['heat-layer', 'heat-points'], defaultVisible: true, source: 'Screening surrogato / sinistri importati' },
  { id: 'crashes', label: 'Sinistri importati', category: 'safety', mapLayers: ['crashes-circle'], defaultVisible: true, source: 'Dataset importato dall\'utente' },
  { id: 'junction', label: 'Junction Lab (movimenti e conflitti)', category: 'safety', mapLayers: ['moves-line', 'moves-arrow', 'conflicts-circle', 'plan-signals-icon'], defaultVisible: true, source: 'Analisi incrocio e piani semaforici',
    legend: [{ color: '#d0614f', label: 'Attraversamento' }, { color: '#d9a441', label: 'Immissione' }, { color: '#83b4d1', label: 'Diversione' }] },
  { id: 'civic', label: 'Segnalazioni e progetti FST', category: 'analysis', mapLayers: ['civic-fill', 'civic-line', 'civic-point'], defaultVisible: true, source: 'Piattaforma Frattamaggiore Si Trasforma (API pubblica)', legend: [{ color: '#7a1f32', label: 'Progetto FST' }, { color: '#d9a441', label: 'Segnalazione' }] },
  { id: 'transit', label: 'Linee e fermate TPL', category: 'transit', mapLayers: ['transit-lines-line', 'transit-stops-circle', 'rt-vehicles-circle'], defaultVisible: true, source: 'GTFS importato / linee di progetto' },
];

export function materialColorExpr(materials: readonly MaterialItem[], fallback = '#8a8d90'): ExpressionSpecification {
  const pairs = materials.flatMap((m) => [m.id, m.color]);
  return ['match', ['get', 'material'], ...pairs, fallback] as unknown as ExpressionSpecification;
}

/** Sizes that track the ground (metres-like) between z15 and z22, clamped for legibility. */
const groundScale = (atZ19: number, min: number): ExpressionSpecification =>
  ['interpolate', ['exponential', 2], ['zoom'], 15, Math.max(min, atZ19 / 16), 19, atZ19, 22, atZ19 * 8] as unknown as ExpressionSpecification;

export function addProjectLayers(map: MLMap, materials: readonly MaterialItem[], dark: boolean): void {
  for (const id of SOURCES) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: fc(), promoteId: 'id', tolerance: id === 'surfaces' || id === 'markings' ? 0.2 : 0.375 });
  }
  const mat = materialColorExpr(materials);
  const L = (spec: Parameters<MLMap['addLayer']>[0]) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };

  L({ id: 'context-fill', type: 'fill', source: 'context', paint: { 'fill-color': ['match', ['get', 'kind'], 'water', dark ? '#24394a' : '#b9cfd9', 'green', dark ? '#22301f' : '#cdd8bf', 'leisure', dark ? '#22301f' : '#d3dcc4', 'parking', dark ? '#25272a' : '#dcd9d2', 'square', dark ? '#2a2b2d' : '#e2ddd3', dark ? '#202225' : '#dfdbd2'], 'fill-opacity': 0.9 } });
  L({ id: 'buildings-fill', type: 'fill', source: 'buildings', paint: { 'fill-color': dark ? '#2b2e33' : '#d6d1c7', 'fill-opacity': 0.95 } });
  L({ id: 'buildings-line', type: 'line', source: 'buildings', minzoom: 15, paint: { 'line-color': dark ? '#3a3e44' : '#b9b3a7', 'line-width': 0.6 } });
  L({ id: 'surfaces-fill', type: 'fill', source: 'surfaces', paint: { 'fill-color': mat, 'fill-opacity': ['case', ['==', ['get', 'kind'], 'area'], 0.92, 1], 'fill-antialias': false } });
  L({ id: 'surfaces-outline', type: 'line', source: 'surfaces', minzoom: 17, filter: ['in', ['get', 'kind'], ['literal', ['area', 'roundabout_island', 'splitter', 'median', 'green']]], paint: { 'line-color': dark ? '#4a4f55' : '#8f8a80', 'line-width': 0.6 } });
  L({ id: 'markings-fill', type: 'fill', source: 'markings', minzoom: 15.5, paint: { 'fill-color': ['case', ['==', ['get', 'material'], 'road_marking_yellow'], '#f2c230', '#f4f3ef'], 'fill-antialias': true } });
  L({ id: 'kerbs-line', type: 'line', source: 'lines', minzoom: 16, filter: ['==', ['get', 'kind'], 'kerb'], paint: { 'line-color': dark ? '#6c7178' : '#77746d', 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.4, 20, 1.4] } });
  // Proposed changes are outlined along their kerbs (and roundabout outer edge), not on every internal surface seam.
  L({ id: 'project-outline', type: 'line', source: 'lines', filter: ['all', ['==', ['get', 'state'], 'project'], ['==', ['get', 'kind'], 'kerb']], paint: { 'line-color': '#e8772e', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 2.2], 'line-opacity': 0.95 } });
  L({ id: 'project-outline-rb', type: 'line', source: 'surfaces', filter: ['==', ['get', 'kind'], 'roundabout_ring'], paint: { 'line-color': '#e8772e', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 2.2] } });
  L({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
  L({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } });
  L({ id: 'iso-line', type: 'line', source: 'iso', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['step', ['get', 'minutes'], '#2f7d5b', 5, '#79a84d', 7, '#d6a63b', 10, '#c4643a'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 7], 'line-opacity': 0.85 } });
  L({ id: 'traffic-line', type: 'line', source: 'traffic', layout: { 'line-cap': 'round' }, paint: {
    'line-color': ['step', ['get', 'ratio'], '#b9312a', 0.35, '#e1703a', 0.55, '#e2b13c', 0.8, '#3fae6b'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4, 19, 8], 'line-offset': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 5], 'line-opacity': 0.9 } });
  L({ id: 'heat-layer', type: 'heatmap', source: 'heat', maxzoom: 18, paint: {
    'heatmap-weight': ['/', ['get', 'score'], 100], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 2],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 12, 14, 17, 50],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(131,180,209,0.35)', 0.45, '#d9a441', 0.7, '#e1703a', 1, '#b9312a'],
    'heatmap-opacity': 0.75 } });
  L({ id: 'heat-points', type: 'circle', source: 'heat', minzoom: 14, filter: ['>=', ['get', 'score'], 40], paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 40, 4, 100, 10], 'circle-color': ['step', ['get', 'score'], '#d9a441', 60, '#e1703a', 80, '#b9312a'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
  L({ id: 'crashes-circle', type: 'circle', source: 'crashes', paint: { 'circle-radius': ['match', ['get', 'severity'], 'fatal', 7, 'serious', 5.5, 'slight', 4, 3], 'circle-color': ['match', ['get', 'severity'], 'fatal', '#5c0d0a', 'serious', '#b9312a', 'slight', '#e1703a', '#d9a441'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  L({ id: 'transit-lines-line', type: 'line', source: 'transit-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 6], 'line-opacity': 0.9 } });
  L({ id: 'transit-stops-circle', type: 'circle', source: 'transit-stops', minzoom: 13, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 18, 6], 'circle-color': '#fff', 'circle-stroke-color': ['coalesce', ['get', 'color'], '#5587a2'], 'circle-stroke-width': 2 } });
  L({ id: 'rt-vehicles-circle', type: 'circle', source: 'rt-vehicles', paint: { 'circle-radius': 6, 'circle-color': '#5fc0a8', 'circle-stroke-color': '#0d0d0d', 'circle-stroke-width': 1.5 } });
  L({ id: 'civic-fill', type: 'fill', source: 'civic', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#7a1f32', 'fill-opacity': 0.16 } });
  L({ id: 'civic-line', type: 'line', source: 'civic', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#7a1f32', 'line-width': 2.4, 'line-dasharray': [2, 1] } });
  L({ id: 'civic-point', type: 'circle', source: 'civic', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'report', '#d9a441', '#7a1f32'], 'circle-stroke-color': '#f5f3ef', 'circle-stroke-width': 2 } });
  L({ id: 'asset-fp-fill', type: 'fill', source: 'asset-fp', minzoom: 15, paint: { 'fill-color': mat, 'fill-opacity': ['case', ['==', ['get', 'state'], 'removed'], 0.15, ['==', ['get', 'category'], 'vegetation'], 0.78, 0.95] } });
  L({ id: 'asset-fp-line', type: 'line', source: 'asset-fp', minzoom: 16, paint: { 'line-color': ['match', ['get', 'state'], 'project', '#e8772e', 'removed', '#d0614f', dark ? '#9aa3ab' : '#4d4a45'], 'line-width': ['match', ['get', 'state'], 'project', 1.4, 0.7], 'line-dasharray': ['case', ['==', ['get', 'state'], 'removed'], ['literal', [2, 2]], ['literal', [1, 0]]] } });
  L({ id: 'asset-pt-dot', type: 'circle', source: 'asset-pt', minzoom: 14, maxzoom: 16.5, paint: { 'circle-radius': 2.4, 'circle-color': ['case', ['==', ['get', 'state'], 'project'], '#e8772e', '#5587a2'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } });
  L({ id: 'asset-pt-sign', type: 'symbol', source: 'asset-pt', minzoom: 16.5, layout: {
    'icon-image': ['get', 'type'], 'icon-size': groundScale(0.42, 0.18), 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    'icon-anchor': 'bottom', 'icon-offset': ['coalesce', ['get', 'off'], ['literal', [0, 0]]], 'symbol-sort-key': ['get', 'stack'] } as never, paint: { 'icon-opacity': ['case', ['==', ['get', 'state'], 'removed'], 0.35, 1] } });
  L({ id: 'signals-icon', type: 'symbol', source: 'signals', minzoom: 16, layout: {
    'icon-image': ['get', 'icon'], 'icon-size': groundScale(0.3, 0.14), 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom',
    'icon-rotate': 0, 'icon-rotation-alignment': 'viewport' } });
  L({ id: 'plan-signals-icon', type: 'symbol', source: 'plan-signals', minzoom: 15, layout: {
    'icon-image': ['get', 'icon'], 'icon-size': groundScale(0.3, 0.14), 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom' } });
  L({ id: 'moves-line', type: 'line', source: 'moves', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['match', ['get', 'turn'], 'left', '#c98bb0', 'right', '#83b4d1', '#e8e4dc'], 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.2, 20, 3], 'line-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.18, 0.9] } });
  L({ id: 'moves-arrow', type: 'symbol', source: 'moves', layout: { 'symbol-placement': 'line', 'symbol-spacing': 30, 'text-field': '›', 'text-font': ['Noto Sans Bold'], 'text-size': 16, 'text-keep-upright': false, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#1c1d1f', 'text-halo-width': 1 } });
  L({ id: 'conflicts-circle', type: 'circle', source: 'conflicts', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 3, 20, 8], 'circle-color': ['match', ['get', 'kind'], 'crossing', '#d0614f', 'merge', '#d9a441', '#83b4d1'], 'circle-stroke-color': '#131416', 'circle-stroke-width': 1.5 } });
  L({ id: 'compare-line', type: 'line', source: 'compare', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9aa3ab', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 8], 'line-dasharray': [1.5, 1.2], 'line-opacity': 0.9 } });
  L({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d0d0d', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 18, 13], 'line-opacity': 0.55 } });
  L({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#83b4d1'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 18, 8] } });
  L({ id: 'vehicles-fill', type: 'fill', source: 'vehicles', paint: { 'fill-color': ['match', ['get', 'cls'], 0, '#f4f3ef', 1, '#d9d4c8', 2, '#e8772e', 3, '#5587a2', 4, '#d0614f', '#ffffff'], 'fill-outline-color': '#1c1d1f' } });
  L({ id: 'labels-text', type: 'symbol', source: 'labels', minzoom: 15, layout: {
    'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 19, 13],
    'text-max-angle': 30, 'symbol-spacing': 320, 'text-padding': 4 }, paint: { 'text-color': dark ? '#d8d6d0' : '#3b3934', 'text-halo-color': dark ? '#16181b' : '#f4f2ec', 'text-halo-width': 1.4 } });
  L({ id: 'selection-fill', type: 'fill', source: 'selection', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#83b4d1', 'fill-opacity': 0.22 } });
  L({ id: 'selection-line', type: 'line', source: 'selection', paint: { 'line-color': '#83b4d1', 'line-width': 2.2 } });
  L({ id: 'selection-point', type: 'circle', source: 'selection', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 9, 'circle-color': 'rgba(131,180,209,0.18)', 'circle-stroke-color': '#83b4d1', 'circle-stroke-width': 2 } });
  L({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e8772e', 'fill-opacity': 0.18 } });
  L({ id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#e8772e', 'line-width': ['coalesce', ['get', 'width'], 2], 'line-dasharray': [2, 1.4] } });
  L({ id: 'draft-point', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['boolean', ['get', 'snap'], false], 7, 4.5], 'circle-color': ['case', ['boolean', ['get', 'snap'], false], '#83b4d1', '#e8772e'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  L({ id: 'draft-label', type: 'symbol', source: 'draft', filter: ['has', 'label'], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, -1.4], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#0d0d0d', 'text-halo-width': 1.6 } });
  L({ id: 'handles-circle', type: 'circle', source: 'handles', paint: { 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 7, 5], 'circle-color': ['match', ['get', 'role'], 'end', '#83b4d1', 'mid', 'rgba(255,255,255,0.65)', '#ffffff'], 'circle-stroke-color': '#0d0d0d', 'circle-stroke-width': 1.5 } });
}

export function setLayerVisible(map: MLMap, def: LayerDef, visible: boolean): void {
  for (const id of def.mapLayers) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

export function setLayerOpacity(map: MLMap, def: LayerDef, value: number): void {
  for (const [layer, prop] of def.opacity ?? []) if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never);
}
