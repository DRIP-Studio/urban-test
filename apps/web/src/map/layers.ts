import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl';
import type { MaterialItem } from '../api/types';
import { fc } from '../engine/geojson';
import { PATTERNS } from './patterns';
import { useWms, wmsLayerDefs } from './wms';

/** Every GeoJSON source of the workstation. One owner each (see sources.ts). */
export const SOURCES = [
  'buildings', 'context', 'surfaces', 'markings', 'lines', 'labels', 'zones', 'asset-fp', 'asset-pt', 'asset-parts', 'sign-poles', 'signs3d', 'signals',
  'traffic', 'route', 'iso', 'heat', 'moves', 'conflicts', 'transit-lines', 'transit-stops', 'vehicles', 'crashes',
  'selection', 'handles', 'draft', 'compare', 'plan-signals', 'rt-vehicles', 'civic', 'restrictions', 'lanes-pref', 'sidewalks-est', 'bike-stations', 'incidents', 'norms', 'structures', 'plan-zones', 'plan-constraints', 'func-class', 'islands', 'drain-pipes', 'drain-nodes', 'overview', 'work-area', 'water-pipes', 'water-nodes',
] as const;
export type SourceId = (typeof SOURCES)[number];

export interface LayerDef {
  readonly id: string;
  readonly label: string;
  readonly category: 'base' | 'official' | 'existing' | 'design' | 'mobility' | 'traffic' | 'safety' | 'environment' | 'transit' | 'analysis';
  readonly mapLayers: readonly string[];
  readonly defaultVisible: boolean;
  readonly source: string;
  readonly legend?: readonly { color: string; label: string }[];
  /** Opacity property per map layer for the opacity slider. */
  readonly opacity?: readonly [string, string][];
  /** Opacity before the user moves the slider (default 1). */
  readonly defaultOpacity?: number;
  /** Drawn only from this zoom (official WMS maps). */
  readonly minzoom?: number;
}

export const CATEGORY_LABEL: Record<LayerDef['category'], string> = {
  base: 'Base', official: 'Carte tecniche e catasto', existing: 'Città esistente', design: 'Progetto', mobility: 'Mobilità', traffic: 'Traffico', safety: 'Sicurezza',
  environment: 'Ambiente', transit: 'Trasporto pubblico', analysis: 'Analisi',
};

export const LAYERS: readonly LayerDef[] = [
  { id: 'overview', label: 'Città intera (vista d\'insieme)', category: 'base', mapLayers: ['overview-line', 'work-area-line'], defaultVisible: true, source: 'Progetto grande: tutte le strade, zona di lavoro tratteggiata' },
  { id: 'buildings', label: 'Edifici', category: 'existing', mapLayers: ['buildings-fill', 'buildings-line', 'buildings-removed', 'buildings-removed-line'], defaultVisible: true, source: 'OpenStreetMap', opacity: [['buildings-fill', 'fill-opacity']] },
  { id: 'context', label: 'Verde, acque, aree', category: 'existing', mapLayers: ['context-fill'], defaultVisible: true, source: 'OpenStreetMap', opacity: [['context-fill', 'fill-opacity']] },
  { id: 'surfaces', label: 'Superfici stradali e marciapiedi', category: 'existing', mapLayers: ['surfaces-fill', 'surfaces-outline'], defaultVisible: true, source: 'Modello fisico DRIP (da sezione e corsie)', opacity: [['surfaces-fill', 'fill-opacity']] },
  { id: 'structures', label: 'Ponti, viadotti, gallerie', category: 'existing', mapLayers: ['structures-shadow', 'structures-casing', 'structures-piers'], defaultVisible: true, source: 'Strutture stradali (OSM bridge/tunnel + progetto)' },
  { id: 'markings', label: 'Segnaletica orizzontale', category: 'existing', mapLayers: ['markings-fill'], defaultVisible: true, source: 'Generata dal modello corsie (CdS)' },
  { id: 'kerbs', label: 'Cordoli', category: 'existing', mapLayers: ['kerbs-line'], defaultVisible: true, source: 'Modello fisico DRIP' },
  { id: 'labels', label: 'Nomi delle strade', category: 'base', mapLayers: ['labels-text'], defaultVisible: true, source: 'OpenStreetMap' },
  { id: 'project', label: 'Evidenzia modifiche di progetto', category: 'design', mapLayers: ['project-outline', 'project-outline-rb'], defaultVisible: true, source: 'Scenario attivo', legend: [{ color: '#e8772e', label: 'Proposto' }] },
  { id: 'assets', label: 'Arredo, verde, segnali, semafori', category: 'design', mapLayers: ['asset-fp-fill', 'asset-fp-line', 'asset-3d', 'asset-fp-extrude', 'sign-poles-icon', 'asset-pt-sign', 'signs-3d', 'asset-pt-dot', 'signals-icon'], defaultVisible: true, source: 'Esistente (OSM) + progetto' },
  { id: 'sidewalksEst', label: 'Marciapiedi stimati', category: 'existing', mapLayers: ['sidewalks-est-fill', 'sidewalks-est-line'], defaultVisible: true, source: 'Stima DRIP dove mancano dati e percorsi pedonali (DM 5/11/2001)', legend: [{ color: '#c9b8a0', label: 'Stimato (non rilevato)' }] },
  { id: 'restrictions', label: 'Divieti e limiti di transito', category: 'mobility', mapLayers: ['restrictions-line', 'restrictions-label'], defaultVisible: true, source: 'Progetto + OpenStreetMap (hgv, maxweight, maxheight…)',
    legend: [{ color: '#b9312a', label: 'Divieto mezzi pesanti / transito' }, { color: '#d9a441', label: 'Solo destinazione o carico/scarico' }, { color: '#7e57c2', label: 'Limite di massa o dimensioni' }] },
  { id: 'lanesPref', label: 'Corsie preferenziali', category: 'mobility', mapLayers: ['lanes-pref-line'], defaultVisible: true, source: 'Scenario attivo', legend: [{ color: '#c0392b', label: 'Bus / taxi' }, { color: '#2f7d5b', label: 'Ciclabile' }] },
  { id: 'zones', label: 'Zone (ZTL, 30, pedonali…)', category: 'mobility', mapLayers: ['zones-fill', 'zones-line'], defaultVisible: true, source: 'Scenario attivo' },
  { id: 'traffic', label: 'Traffico', category: 'traffic', mapLayers: ['traffic-line'], defaultVisible: true, source: 'Live (HERE) o stima DRIP — vedi Traffic Studio',
    legend: [{ color: '#3fae6b', label: 'Scorrevole' }, { color: '#e2b13c', label: 'Rallentato' }, { color: '#e1703a', label: 'Intenso' }, { color: '#b9312a', label: 'Congestionato' }] },
  { id: 'incidents', label: 'Incidenti, cantieri e chiusure', category: 'traffic', mapLayers: ['incidents-line', 'incidents-circle', 'incidents-label'], defaultVisible: true, source: 'HERE Traffic v7 (live)',
    legend: [{ color: '#b9312a', label: 'Strada chiusa / incidente' }, { color: '#e1703a', label: 'Lavori, corsia chiusa' }, { color: '#d9a441', label: 'Altro evento' }] },
  { id: 'vehicles', label: 'Veicoli simulati', category: 'traffic', mapLayers: ['vehicles-fill', 'vehicles-extrude'], defaultVisible: true, source: 'DRIP Flow (simulazione)' },
  { id: 'route', label: 'Percorso', category: 'mobility', mapLayers: ['route-line', 'route-casing', 'compare-line'], defaultVisible: true, source: 'Navigatore DRIP sullo scenario' },
  { id: 'iso', label: 'Accessibilità / isocrone', category: 'analysis', mapLayers: ['iso-line'], defaultVisible: true, source: 'Analisi DRIP',
    legend: [{ color: '#2f7d5b', label: '≤ 5 min' }, { color: '#79a84d', label: '≤ 7 min' }, { color: '#d6a63b', label: '≤ 10 min' }, { color: '#c4643a', label: '≤ 15 min' }] },
  { id: 'heat', label: 'Heatmap sicurezza', category: 'safety', mapLayers: ['heat-layer', 'heat-points'], defaultVisible: true, source: 'Screening surrogato / sinistri importati' },
  { id: 'plan-zones', label: 'Piano urbanistico: zone omogenee', category: 'official', mapLayers: ['plan-zones-fill', 'plan-zones-line', 'plan-zones-label'], defaultVisible: false, source: 'PUC/PRG importato (DM 1444/68)', opacity: [['plan-zones-fill', 'fill-opacity']], defaultOpacity: 0.35,
    legend: [{ color: '#9c3b2a', label: 'A' }, { color: '#e8862e', label: 'B' }, { color: '#f2cf3a', label: 'C' }, { color: '#8a5aa8', label: 'D' }, { color: '#8fb36a', label: 'E' }, { color: '#4f86c6', label: 'F' }] },
  { id: 'plan-constraints', label: 'Vincoli e fasce di rispetto', category: 'official', mapLayers: ['plan-constraints-fill', 'plan-constraints-line'], defaultVisible: false, source: 'PUC/PRG importato o generato' },
  { id: 'func-class', label: 'Classificazione funzionale (PGTU)', category: 'traffic', mapLayers: ['func-class-line'], defaultVisible: false, source: 'Direttive 12/4/1995' },
  { id: 'islands', label: 'Isole ambientali proposte', category: 'traffic', mapLayers: ['islands-fill', 'islands-line'], defaultVisible: false, source: 'PGTU (proposta DRIP)' },
  { id: 'water', label: 'Rete acquedotto', category: 'design', mapLayers: ['water-pipes-line', 'water-nodes-circle', 'water-label'], defaultVisible: true, source: 'Progetto (gradiente globale, Hazen–Williams)' },
  { id: 'drainage', label: 'Rete di drenaggio', category: 'design', mapLayers: ['drain-pipes-line', 'drain-nodes-circle', 'drain-pipes-label'], defaultVisible: true, source: 'Progetto (metodo razionale)' },
  { id: 'norms', label: 'Verifiche normative', category: 'analysis', mapLayers: ['norms-circle'], defaultVisible: true, source: 'Normativa e verifiche (DRIP)',
    legend: [{ color: '#b9312a', label: 'Non conforme' }, { color: '#d9a441', label: 'Da verificare' }, { color: '#5587a2', label: 'Informazione' }] },
  { id: 'crashes', label: 'Sinistri importati', category: 'safety', mapLayers: ['crashes-circle'], defaultVisible: true, source: 'Dataset importato dall\'utente' },
  { id: 'junction', label: 'Junction Lab (movimenti e conflitti)', category: 'safety', mapLayers: ['moves-line', 'moves-arrow', 'conflicts-circle', 'plan-signals-icon'], defaultVisible: true, source: 'Analisi incrocio e piani semaforici',
    legend: [{ color: '#d0614f', label: 'Attraversamento' }, { color: '#d9a441', label: 'Immissione' }, { color: '#83b4d1', label: 'Diversione' }] },
  { id: 'civic', label: 'Segnalazioni e progetti FST', category: 'analysis', mapLayers: ['civic-fill', 'civic-line', 'civic-point'], defaultVisible: true, source: 'Piattaforma Frattamaggiore Si Trasforma (API pubblica)', legend: [{ color: '#7a1f32', label: 'Progetto FST' }, { color: '#d9a441', label: 'Segnalazione' }, { color: '#5587a2', label: 'Segnalazione presa in carico' }] },
  { id: 'transit', label: 'Linee e fermate TPL', category: 'transit', mapLayers: ['transit-lines-casing', 'transit-lines-line', 'transit-lines-rail', 'transit-stops-circle', 'transit-stops-label', 'rt-vehicles-circle'], defaultVisible: true, source: 'GTFS importato / linee di progetto',
    legend: [{ color: '#d0614f', label: 'Metropolitana' }, { color: '#1d1d1b', label: 'Treno' }, { color: '#8b0209', label: 'Tram' }, { color: '#e8772e', label: 'BRT' }, { color: '#5587a2', label: 'Bus' }] },
  { id: 'bikeshare', label: 'Bike sharing', category: 'transit', mapLayers: ['bike-stations-circle', 'bike-stations-label'], defaultVisible: true, source: 'Stazioni di progetto', legend: [{ color: '#2f7d5b', label: 'Stazione (stalli)' }] },
];

/** Static layers plus the official WMS overlays configured by the administrator. */
export function allLayerDefs(): readonly LayerDef[] {
  const wms = useWms.getState().services;
  return wms.length ? [...LAYERS, ...wmsLayerDefs(wms)] : LAYERS;
}

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
  L({ id: 'overview-line', type: 'line', source: 'overview', paint: { 'line-color': dark ? '#5a5f66' : '#a9a49a', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'c'], ['motorway', 'trunk', 'primary'], 1.4, 0.4], 15, ['match', ['get', 'c'], ['motorway', 'trunk', 'primary'], 5, ['secondary', 'tertiary'], 3, 1.5]], 'line-opacity': 0.85 } });
  L({ id: 'work-area-line', type: 'line', source: 'work-area', paint: { 'line-color': '#e8772e', 'line-width': 2, 'line-dasharray': [3, 2] } });
  L({ id: 'buildings-fill', type: 'fill', source: 'buildings', filter: ['!', ['get', 'removed']], paint: { 'fill-color': dark ? '#2b2e33' : '#d6d1c7', 'fill-opacity': 0.95 } });
  L({ id: 'buildings-removed', type: 'fill', source: 'buildings', filter: ['get', 'removed'], paint: { 'fill-color': '#d0614f', 'fill-opacity': 0.08 } });
  L({ id: 'buildings-removed-line', type: 'line', source: 'buildings', filter: ['get', 'removed'], paint: { 'line-color': '#d0614f', 'line-width': 1.2, 'line-dasharray': [3, 2] } });
  L({ id: 'buildings-hatch', type: 'fill', source: 'buildings', filter: ['!', ['get', 'removed']], layout: { visibility: 'none' }, paint: { 'fill-pattern': 'ctr-hatch' } });
  L({ id: 'buildings-line', type: 'line', source: 'buildings', minzoom: 15, filter: ['!', ['get', 'removed']], paint: { 'line-color': dark ? '#3a3e44' : '#b9b3a7', 'line-width': 0.6 } });
  L({ id: 'structures-shadow', type: 'fill', source: 'structures', filter: ['all', ['!=', ['get', 'kind'], 'pier'], ['!=', ['get', 'kind'], 'tunnel']], paint: { 'fill-color': '#000000', 'fill-opacity': 0.22, 'fill-translate': [5, 5], 'fill-translate-anchor': 'viewport' } });
  L({ id: 'structures-casing', type: 'line', source: 'structures', filter: ['!=', ['get', 'kind'], 'pier'], paint: { 'line-color': dark ? '#8d949c' : '#5b5f64', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 20, 3], 'line-dasharray': ['case', ['==', ['get', 'kind'], 'tunnel'], ['literal', [2, 2]], ['literal', [1, 0]]] } });
  L({ id: 'surfaces-fill', type: 'fill', source: 'surfaces', layout: { 'fill-sort-key': ['get', 'z'] }, paint: { 'fill-color': mat, 'fill-opacity': ['case', ['==', ['get', 'kind'], 'area'], 0.92, 1], 'fill-antialias': false } });
  // Real-scale paving textures over the flat colour (one image per zoom step; see patterns.ts).
  const patterned = materials.filter((m) => PATTERNS.has(m.pattern)).map((m) => m.id);
  const pat = (z: number): ExpressionSpecification => ['concat', 'mat:', ['get', 'material'], `:${z}`];
  L({ id: 'surfaces-pattern', type: 'fill', source: 'surfaces', minzoom: 17.5, filter: ['in', ['get', 'material'], ['literal', patterned]],
    layout: { 'fill-sort-key': ['get', 'z'] },
    paint: { 'fill-pattern': ['step', ['zoom'], pat(18), 18.5, pat(19), 19.5, pat(20), 20.5, pat(21), 21.5, pat(22)], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 17.5, 0, 18.2, 1] } });
  L({ id: 'surfaces-outline', type: 'line', source: 'surfaces', minzoom: 17, filter: ['in', ['get', 'kind'], ['literal', ['area', 'roundabout_island', 'splitter', 'median', 'green']]], paint: { 'line-color': dark ? '#4a4f55' : '#8f8a80', 'line-width': 0.6 } });
  L({ id: 'markings-fill', type: 'fill', source: 'markings', minzoom: 15.5, paint: { 'fill-color': ['match', ['get', 'material'], 'road_marking_white', '#f4f3ef', mat], 'fill-antialias': true } });
  L({ id: 'kerbs-line', type: 'line', source: 'lines', minzoom: 16, filter: ['==', ['get', 'kind'], 'kerb'], paint: { 'line-color': dark ? '#6c7178' : '#77746d', 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.4, 20, 1.4] } });
  // Proposed changes are outlined along their kerbs (and roundabout outer edge), not on every internal surface seam.
  L({ id: 'project-outline', type: 'line', source: 'lines', filter: ['all', ['==', ['get', 'state'], 'project'], ['==', ['get', 'kind'], 'kerb']], paint: { 'line-color': '#e8772e', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 2.2], 'line-opacity': 0.95 } });
  L({ id: 'project-outline-rb', type: 'line', source: 'surfaces', filter: ['==', ['get', 'kind'], 'roundabout_ring'], paint: { 'line-color': '#e8772e', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 2.2] } });
  L({ id: 'sidewalks-est-fill', type: 'fill', source: 'sidewalks-est', minzoom: 15, paint: { 'fill-color': dark ? '#7d7466' : '#cfc6b5', 'fill-opacity': 0.85 } });
  L({ id: 'sidewalks-est-line', type: 'line', source: 'sidewalks-est', minzoom: 16, paint: { 'line-color': dark ? '#a99c86' : '#9a8f7c', 'line-width': 1, 'line-dasharray': [2, 1.5] } });
  L({ id: 'restrictions-line', type: 'line', source: 'restrictions', layout: { 'line-cap': 'round' }, paint: {
    'line-color': ['match', ['get', 'level'], 'ban', '#b9312a', 'partial', '#d9a441', '#7e57c2'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 5], 'line-dasharray': [1.2, 1], 'line-opacity': 0.9 } });
  L({ id: 'restrictions-label', type: 'symbol', source: 'restrictions', minzoom: 16, layout: { 'symbol-placement': 'line', 'symbol-spacing': 220, 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11 }, paint: { 'text-color': '#b9312a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
  L({ id: 'lanes-pref-line', type: 'line', source: 'lanes-pref', minzoom: 14, layout: { 'line-cap': 'butt' }, paint: {
    'line-color': ['match', ['get', 'kind'], 'bike', '#2f7d5b', '#c0392b'], 'line-opacity': 0.5,
    // Metres → pixels at ~41° N: 4.4 px/m at z19, doubling per zoom level.
    'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, ['*', ['get', 'widthM'], 0.14], 19, ['*', ['get', 'widthM'], 4.4], 22, ['*', ['get', 'widthM'], 35]],
    'line-offset': ['interpolate', ['exponential', 2], ['zoom'], 14, ['*', ['get', 'offM'], 0.14], 19, ['*', ['get', 'offM'], 4.4], 22, ['*', ['get', 'offM'], 35]] } });
  L({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
  L({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } });
  L({ id: 'iso-line', type: 'line', source: 'iso', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['step', ['get', 'minutes'], '#2f7d5b', 5, '#79a84d', 7, '#d6a63b', 10, '#c4643a'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 7], 'line-opacity': 0.85 } });
  L({ id: 'traffic-line', type: 'line', source: 'traffic', layout: { 'line-cap': 'round' }, paint: {
    'line-color': ['step', ['get', 'ratio'], '#b9312a', 0.35, '#e1703a', 0.55, '#e2b13c', 0.8, '#3fae6b'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4, 19, 8], 'line-offset': ['interpolate', ['linear'], ['zoom'], 14, 1, 19, 5], 'line-opacity': 0.9 } });
  const incColor = ['case', ['get', 'roadClosed'], '#b9312a', ['match', ['get', 'kind'], 'accident', '#b9312a', ['construction', 'laneRestriction'], '#e1703a', '#d9a441']];
  L({ id: 'incidents-line', type: 'line', source: 'incidents', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round' }, paint: { 'line-color': incColor as never, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 7], 'line-dasharray': [1, 1.4], 'line-opacity': 0.95 } });
  L({ id: 'incidents-circle', type: 'circle', source: 'incidents', filter: ['has', 'pin'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 9], 'circle-color': incColor as never, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
  L({ id: 'incidents-label', type: 'symbol', source: 'incidents', filter: ['has', 'pin'], minzoom: 14, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: { 'text-color': '#b9312a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
  L({ id: 'heat-layer', type: 'heatmap', source: 'heat', maxzoom: 18, paint: {
    'heatmap-weight': ['/', ['get', 'score'], 100], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 2],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 12, 14, 17, 50],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(131,180,209,0.35)', 0.45, '#d9a441', 0.7, '#e1703a', 1, '#b9312a'],
    'heatmap-opacity': 0.75 } });
  L({ id: 'heat-points', type: 'circle', source: 'heat', minzoom: 14, filter: ['>=', ['get', 'score'], 40], paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 40, 4, 100, 10], 'circle-color': ['step', ['get', 'score'], '#d9a441', 60, '#e1703a', 80, '#b9312a'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
  L({ id: 'plan-zones-fill', type: 'fill', source: 'plan-zones', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 } });
  L({ id: 'plan-zones-line', type: 'line', source: 'plan-zones', layout: { visibility: 'none' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1.4 } });
  L({ id: 'plan-zones-label', type: 'symbol', source: 'plan-zones', minzoom: 14.5, layout: { visibility: 'none', 'text-field': ['get', 'code'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#1c1d1f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
  L({ id: 'plan-constraints-fill', type: 'fill', source: 'plan-constraints', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'type'], 'paesaggistico', '#3e8e5a', 'idrogeologico', '#2f62b0', 'rispetto_stradale', '#8a8f96', 'cimiteriale', '#6b4f8a', 'ferroviario', '#9a6a3a', '#b9312a'], 'fill-opacity': 0.16 } });
  L({ id: 'plan-constraints-line', type: 'line', source: 'plan-constraints', layout: { visibility: 'none' }, paint: { 'line-color': ['match', ['get', 'type'], 'paesaggistico', '#3e8e5a', 'idrogeologico', '#2f62b0', 'rispetto_stradale', '#5b5f64', 'cimiteriale', '#6b4f8a', 'ferroviario', '#9a6a3a', '#b9312a'], 'line-width': 1.2, 'line-dasharray': [4, 2] } });
  L({ id: 'func-class-line', type: 'line', source: 'func-class', layout: { visibility: 'none', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 7], 'line-opacity': ['case', ['get', 'authored'], 0.95, 0.6] } });
  L({ id: 'islands-fill', type: 'fill', source: 'islands', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'proposal'], 'ztl', '#d0614f', 'pedestrian', '#5f9d5a', '#e8a33d'], 'fill-opacity': 0.18 } });
  L({ id: 'islands-line', type: 'line', source: 'islands', layout: { visibility: 'none' }, paint: { 'line-color': ['match', ['get', 'proposal'], 'ztl', '#d0614f', 'pedestrian', '#5f9d5a', '#e8a33d'], 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  L({ id: 'drain-pipes-line', type: 'line', source: 'drain-pipes', paint: { 'line-color': ['case', ['>', ['coalesce', ['get', 'fill'], 0], 0.7], '#b9312a', ['>', ['coalesce', ['get', 'fill'], 0], 0.5], '#d9a441', '#2f62b0'], 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 20, ['*', 6, ['coalesce', ['get', 'dn'], 0.3]]], 'line-dasharray': [3, 1] } });
  L({ id: 'drain-pipes-label', type: 'symbol', source: 'drain-pipes', minzoom: 17.5, layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 10.5, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -0.9] }, paint: { 'text-color': '#2f62b0', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 } });
  L({ id: 'water-pipes-line', type: 'line', source: 'water-pipes', paint: { 'line-color': ['case', ['get', 'closed'], '#8a8f96', ['>', ['coalesce', ['get', 'v'], 0], 2], '#b9312a', ['<', ['coalesce', ['get', 'v'], 1], 0.3], '#d9a441', '#1f8fb0'], 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 20, 5] } });
  L({ id: 'water-nodes-circle', type: 'circle', source: 'water-nodes', paint: { 'circle-radius': ['match', ['get', 'kind'], 'reservoir', 8, 'tank', 8, 'hydrant', 6, 4.5], 'circle-color': ['case', ['==', ['get', 'p'], null], '#1f8fb0', ['<', ['get', 'p'], 15], '#b9312a', ['>', ['get', 'p'], 70], '#d9a441', '#3e8e5a'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['match', ['get', 'kind'], 'hydrant', 2.5, 1.5] } });
  L({ id: 'water-label', type: 'symbol', source: 'water-nodes', minzoom: 17, layout: { 'text-field': ['get', 'label'], 'text-size': 10.5, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.2] }, paint: { 'text-color': '#1f8fb0', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 } });
  L({ id: 'drain-nodes-circle', type: 'circle', source: 'drain-nodes', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 20, 7], 'circle-color': ['match', ['get', 'kind'], 'inlet', '#ffffff', 'outfall', '#2f62b0', '#5b5f64'], 'circle-stroke-color': '#2f62b0', 'circle-stroke-width': ['match', ['get', 'kind'], 'inlet', 2, 1.2] } });
  L({ id: 'norms-circle', type: 'circle', source: 'norms', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 18, 8], 'circle-color': ['match', ['get', 'severity'], 'error', '#b9312a', 'warning', '#d9a441', '#5587a2'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
  L({ id: 'crashes-circle', type: 'circle', source: 'crashes', paint: { 'circle-radius': ['match', ['get', 'severity'], 'fatal', 7, 'serious', 5.5, 'slight', 4, 3], 'circle-color': ['match', ['get', 'severity'], 'fatal', '#5c0d0a', 'serious', '#b9312a', 'slight', '#e1703a', '#d9a441'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  // Mode styles: rail thicker with a casing, train dashed black/white, BRT and tram solid, bus thinner.
  const modeW = (base: number): ExpressionSpecification => ['*', base, ['match', ['get', 'mode'], 'metro', 1.8, 'train', 1.6, 'tram', 1.3, 'brt', 1.4, 'funicular', 1.3, 'ferry', 1, 'on_demand', 0.8, 1]] as unknown as ExpressionSpecification;
  L({ id: 'transit-lines-casing', type: 'line', source: 'transit-lines', filter: ['in', ['get', 'mode'], ['literal', ['metro', 'train', 'tram', 'brt', 'funicular']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0d0d0d' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, modeW(3.4), 18, modeW(9)], 'line-opacity': 0.9 } });
  L({ id: 'transit-lines-line', type: 'line', source: 'transit-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, modeW(2), 18, modeW(6)], 'line-opacity': ['match', ['get', 'mode'], 'on_demand', 0.55, 0.92], 'line-dasharray': ['match', ['get', 'mode'], 'ferry', ['literal', [2, 1.5]], 'on_demand', ['literal', [1, 1]], ['literal', [1, 0]]] } });
  L({ id: 'transit-lines-rail', type: 'line', source: 'transit-lines', filter: ['==', ['get', 'mode'], 'train'], paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 18, 3], 'line-dasharray': [3, 3] } });
  L({ id: 'transit-stops-circle', type: 'circle', source: 'transit-stops', minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, ['match', ['get', 'mode'], 'metro', 4, 'train', 4.5, 2.5], 18, ['match', ['get', 'mode'], 'metro', 9, 'train', 10, 6]], 'circle-color': '#fff', 'circle-stroke-color': ['coalesce', ['get', 'color'], '#5587a2'], 'circle-stroke-width': ['match', ['get', 'mode'], 'metro', 3, 'train', 3, 2] } });
  L({ id: 'transit-stops-label', type: 'symbol', source: 'transit-stops', minzoom: 15.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': dark ? '#f5f3ef' : '#1d1d1b', 'text-halo-color': dark ? '#0d0d0d' : '#ffffff', 'text-halo-width': 1.4 } });
  L({ id: 'bike-stations-circle', type: 'circle', source: 'bike-stations', minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, ['+', 6, ['/', ['get', 'docks'], 3]]], 'circle-color': '#2f7d5b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
  L({ id: 'bike-stations-label', type: 'symbol', source: 'bike-stations', minzoom: 15, layout: { 'text-field': ['to-string', ['get', 'docks']], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
  L({ id: 'rt-vehicles-circle', type: 'circle', source: 'rt-vehicles', paint: { 'circle-radius': 6, 'circle-color': '#5fc0a8', 'circle-stroke-color': '#0d0d0d', 'circle-stroke-width': 1.5 } });
  L({ id: 'civic-fill', type: 'fill', source: 'civic', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#7a1f32', 'fill-opacity': 0.16 } });
  L({ id: 'civic-line', type: 'line', source: 'civic', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#7a1f32', 'line-width': 2.4, 'line-dasharray': [2, 1] } });
  L({ id: 'civic-point', type: 'circle', source: 'civic', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'report', '#d9a441', 'task', '#5587a2', '#7a1f32'], 'circle-stroke-color': '#f5f3ef', 'circle-stroke-width': 2 } });
  // Catalogue furniture is drawn by the volume symbol (asset-3d); the footprint only shows removed items.
  L({ id: 'asset-fp-fill', type: 'fill', source: 'asset-fp', minzoom: 15, paint: { 'fill-color': mat, 'fill-opacity': ['case', ['==', ['get', 'state'], 'removed'], 0.15, ['boolean', ['get', 'sprite'], false], 0, ['==', ['get', 'category'], 'vegetation'], 0.78, 0.95] } });
  L({ id: 'asset-fp-extrude', type: 'fill-extrusion', source: 'asset-parts', minzoom: 15, layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': mat, 'fill-extrusion-base': ['coalesce', ['get', 'b'], 0], 'fill-extrusion-height': ['coalesce', ['get', 'h'], 1], 'fill-extrusion-opacity': 0.97 } });
  L({ id: 'surfaces-raised', type: 'fill-extrusion', source: 'surfaces', minzoom: 16, filter: ['==', ['get', 'kind'], 'raised'], layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': mat, 'fill-extrusion-height': ['*', 3, ['coalesce', ['get', 'heightM'], 0.1]], 'fill-extrusion-opacity': 0.95 } });
  L({ id: 'structures-piers', type: 'fill-extrusion', source: 'structures', minzoom: 15, filter: ['==', ['get', 'kind'], 'pier'], layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': dark ? '#7d828a' : '#b9b6ae', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 } });
  L({ id: 'buildings-extrude', type: 'fill-extrusion', source: 'buildings', minzoom: 14, filter: ['!', ['get', 'removed']], layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': dark ? '#3a3e44' : ['get', 'c'], 'fill-extrusion-height': ['coalesce', ['get', 'h'], 9], 'fill-extrusion-base': ['coalesce', ['get', 'minH'], 0], 'fill-extrusion-opacity': 0.96, 'fill-extrusion-vertical-gradient': true } });
  L({ id: 'buildings-roof', type: 'fill-extrusion', source: 'buildings', minzoom: 15, filter: ['!', ['get', 'removed']], layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': dark ? '#4a4038' : ['get', 'r'], 'fill-extrusion-height': ['coalesce', ['get', 'rh'], 10], 'fill-extrusion-base': ['coalesce', ['get', 'h'], 9], 'fill-extrusion-opacity': 0.98 } });
  L({ id: 'asset-3d', type: 'symbol', source: 'asset-pt', minzoom: 16, filter: ['has', 'sprite'], layout: {
    'icon-image': ['get', 'sprite'], 'icon-size': 0.25, 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
    'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['case', ['==', ['get', 'state'], 'removed'], 0.25, 1] } });
  L({ id: 'asset-fp-line', type: 'line', source: 'asset-fp', minzoom: 16, paint: { 'line-color': ['match', ['get', 'state'], 'project', '#e8772e', 'removed', '#d0614f', dark ? '#9aa3ab' : '#4d4a45'], 'line-width': ['match', ['get', 'state'], 'project', 1.1, 0.7], 'line-opacity': ['case', ['boolean', ['get', 'sprite'], false], 0.4, 1], 'line-dasharray': ['case', ['==', ['get', 'state'], 'removed'], ['literal', [2, 2]], ['literal', [1, 0]]] } });
  L({ id: 'asset-pt-dot', type: 'circle', source: 'asset-pt', minzoom: 14, maxzoom: 16.5, paint: { 'circle-radius': 2.4, 'circle-color': ['case', ['==', ['get', 'state'], 'project'], '#e8772e', '#5587a2'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } });
  L({ id: 'sign-poles-icon', type: 'symbol', source: 'sign-poles', minzoom: 16.5, layout: {
    'icon-image': ['get', 'icon'], 'icon-size': groundScale(0.42, 0.18), 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom' } as never,
    paint: { 'icon-opacity': ['case', ['==', ['get', 'state'], 'removed'], 0.35, 1] } });
  // Tilted map: plates at real size and height, standing up (offset per pitch set by MapView).
  L({ id: 'signs-3d', type: 'symbol', source: 'signs3d', minzoom: 16, layout: {
    visibility: 'none', 'icon-image': ['get', 'type'], 'icon-size': 0.3, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom',
    'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['coalesce', ['get', 'off'], ['literal', [0, 0]]], 'symbol-sort-key': ['get', 'hm'] } as never });
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
  L({ id: 'vehicles-fill', type: 'fill', source: 'vehicles', paint: { 'fill-color': ['get', 'c'], 'fill-antialias': true } });
  L({ id: 'vehicles-extrude', type: 'fill-extrusion', source: 'vehicles', minzoom: 16, layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 1 } });
  L({ id: 'labels-text', type: 'symbol', source: 'labels', minzoom: 15, layout: {
    'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 19, 13],
    'text-max-angle': 30, 'symbol-spacing': 320, 'text-padding': 4 }, paint: { 'text-color': dark ? '#d8d6d0' : '#3b3934', 'text-halo-color': dark ? '#16181b' : '#f4f2ec', 'text-halo-width': 1.4 } });
  L({ id: 'selection-fill', type: 'fill', source: 'selection', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#83b4d1', 'fill-opacity': 0.22 } });
  L({ id: 'selection-line', type: 'line', source: 'selection', paint: { 'line-color': '#83b4d1', 'line-width': 2.2 } });
  L({ id: 'selection-point', type: 'circle', source: 'selection', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 9, 'circle-color': 'rgba(131,180,209,0.18)', 'circle-stroke-color': '#83b4d1', 'circle-stroke-width': 2 } });
  L({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#e8772e'], 'fill-opacity': ['coalesce', ['get', 'opacity'], ['case', ['boolean', ['get', 'placed'], false], 0.3, 0.16]] } });
  L({ id: 'draft-axis', type: 'line', source: 'draft', filter: ['==', ['get', 'kind'], 'road-axis'], paint: { 'line-color': '#f5f3ef', 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [3, 2] } });
  L({ id: 'draft-handle', type: 'line', source: 'draft', filter: ['==', ['get', 'kind'], 'handle'], paint: { 'line-color': '#83b4d1', 'line-width': 1.4 } });
  // Roundabout preview: arms the ring will cut (accent) and roads it will swallow (dashed red).
  L({ id: 'draft-arm', type: 'line', source: 'draft', filter: ['==', ['get', 'kind'], 'arm'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#83b4d1', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 20, 6], 'line-opacity': 0.9 } });
  L({ id: 'draft-removed', type: 'line', source: 'draft', filter: ['==', ['get', 'kind'], 'removed'], paint: { 'line-color': '#d0614f', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] } });
  L({ id: 'draft-line', type: 'line', source: 'draft', filter: ['all', ['!=', ['geometry-type'], 'Point'], ['!', ['in', ['get', 'kind'], ['literal', ['arm', 'removed', 'road-axis', 'handle']]]]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#e8772e', 'line-width': ['coalesce', ['get', 'width'], 2], 'line-dasharray': [2, 1.4] } });
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
