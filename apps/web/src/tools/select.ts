import { LocalFrame, geom, type LngLat, type Network } from '@drip-urban/core';
import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import { moveAssets } from '../state/actions';
import { select, useApp, type Selection } from '../state/store';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import type { ToolEvent, ToolHandler } from './types';

const PICK_LAYERS = ['signals-icon', 'asset-pt-sign', 'asset-pt-dot', 'asset-fp-fill', 'markings-fill', 'surfaces-fill', 'structures-casing', 'zones-fill', 'buildings-removed', 'buildings-fill'];

export function pickAt(map: MLMap, point: { x: number; y: number }, tolerancePx = 5): Selection | null {
  const layers = PICK_LAYERS.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
  const feats = map.queryRenderedFeatures([[point.x - tolerancePx, point.y - tolerancePx], [point.x + tolerancePx, point.y + tolerancePx]], { layers });
  return selectionFromFeatures(feats);
}

export function selectionFromFeatures(feats: MapGeoJSONFeature[]): Selection | null {
  const by = (l: string) => feats.filter((f) => f.layer.id === l);
  const asset = [...by('signals-icon'), ...by('asset-pt-sign'), ...by('asset-pt-dot'), ...by('asset-fp-fill')][0];
  if (asset) return { kind: 'asset', ids: [String(asset.properties.id)] };
  const ownId = (l: string, pre: string) => by(l).map((f) => String(f.properties.id)).find((id) => id.startsWith(pre))?.split(':')[1];
  const marking = ownId('markings-fill', 'cm:');
  if (marking) return { kind: 'marking', ids: [marking] };
  const feature = ownId('markings-fill', 'fm:') ?? ownId('surfaces-fill', 'f:');
  if (feature) return { kind: 'feature', ids: [feature] };
  const surfaces = by('surfaces-fill');
  const area = surfaces.find((f) => f.properties.areaId);
  if (area) return { kind: 'area', ids: [String(area.properties.areaId)] };
  const rb = surfaces.find((f) => String(f.properties.id).startsWith('rb:'));
  if (rb) return { kind: 'roundabout', ids: [String(rb.properties.id).split(':')[1]!] };
  const junction = surfaces.find((f) => f.properties.kind === 'junction' || f.properties.kind === 'corner');
  if (junction && junction.properties.nodeId) return { kind: 'node', ids: [String(junction.properties.nodeId)] };
  const road = surfaces.find((f) => f.properties.roadId);
  if (road) return { kind: 'road', ids: [String(road.properties.roadId)] };
  const deck = by('structures-casing')[0];
  if (deck?.properties.roadId) return { kind: 'road', ids: [String(deck.properties.roadId)] };
  const zone = by('zones-fill')[0];
  if (zone) return { kind: 'zone', ids: [String(zone.properties.id)] };
  const bld = [...by('buildings-removed'), ...by('buildings-fill')][0];
  if (bld) return { kind: 'building', ids: [String(bld.properties.id)] };
  return null;
}

/** Highlight geometry for the current selection (single owner of the 'selection' source). */
export function selectionFC(sel: Selection | null, net: Network | null) {
  if (!sel || !net) return fc();
  const out: Feature[] = [];
  for (const id of sel.ids) {
    if (sel.kind === 'road' && net.roads[id]) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((p) => [p[0], p[1]]) }, properties: {} });
    if (sel.kind === 'asset' && net.assets[id]) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...net.assets[id]!.at] }, properties: {} });
    if (sel.kind === 'node' && net.nodes[id]) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...net.nodes[id]!.at] }, properties: {} });
    if (sel.kind === 'area' && net.areas[id]) {
      const a = net.areas[id]!;
      out.push(a.kind === 'crossing'
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: a.polygon.map((p) => [p[0], p[1]]) }, properties: {} }
        : { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...a.polygon.map((p) => [p[0], p[1]]), [a.polygon[0]![0], a.polygon[0]![1]]]] }, properties: {} });
    }
    if (sel.kind === 'zone' && net.zones[id]) {
      const z = net.zones[id]!;
      out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...z.polygon.map((p) => [p[0], p[1]]), [z.polygon[0]![0], z.polygon[0]![1]]]] }, properties: {} });
    }
    const bl = sel.kind === 'building' ? useApp.getState().baseline?.buildings[id] : undefined;
    if (bl) out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...bl.footprint.map((p) => [p[0], p[1]]), [bl.footprint[0]![0], bl.footprint[0]![1]]]] }, properties: {} });
    if (sel.kind === 'marking' && net.markings?.[id]) {
      const g = net.markings[id]!.geometry.map((p) => [p[0], p[1]]);
      out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ['hatch', 'chevrons', 'box_junction', 'parking_bays'].includes(net.markings[id]!.kind) && g.length > 2 ? [...g, g[0]!] : g }, properties: {} });
    }
    if (sel.kind === 'feature' && net.features?.[id]) {
      const ft = net.features[id]!, road = ft.roadId ? net.roads[ft.roadId] : undefined;
      const at = road ? pointAlong(road.axis, ft.station ?? 0) : ft.nodeId ? net.nodes[ft.nodeId]?.at : undefined;
      if (at) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [at[0], at[1]] }, properties: {} });
    }
    if (sel.kind === 'roundabout' && net.roundabouts[id]) {
      for (const r of Object.values(net.roads)) if (r.tags?.roundabout === id) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.axis.map((p) => [p[0], p[1]]) }, properties: {} });
    }
  }
  return fc(out);
}

function pointAlong(axis: readonly LngLat[], d: number): LngLat {
  const f = new LocalFrame(axis[0]!);
  const { p } = geom.sampleAt(axis.map((q) => f.toMetric(q)), d);
  return f.toLngLat(p);
}

interface Drag { kind: 'move'; ids: string[]; start: LngLat; last: LngLat }
interface Box { kind: 'box'; start: { x: number; y: number }; startLL: LngLat }
let drag: Drag | Box | null = null;

export const selectTool: ToolHandler = {
  down(e, ctx) {
    const sel = useApp.getState().selection;
    if (e.button !== 0) return;
    if (e.shift && !pickAt(ctx.map, e.point)) {
      drag = { kind: 'box', start: e.point, startLL: e.lngLat };
      return true;
    }
    const hit = pickAt(ctx.map, e.point);
    if (hit?.kind === 'asset' && sel?.kind === 'asset' && sel.ids.includes(hit.ids[0]!)) {
      drag = { kind: 'move', ids: [...sel.ids], start: e.lngLat, last: e.lngLat };
      return true; // swallow: map must not pan while moving objects
    }
  },
  move(e) {
    if (!drag) return;
    if (drag.kind === 'move') {
      drag.last = e.lngLat;
      const { network, baseline } = useApp.getState();
      if (!network || !baseline) return;
      const f = new LocalFrame(baseline.origin);
      const a = f.toMetric(drag.start), b = f.toMetric(e.lngLat);
      setSource('draft', fc(drag.ids.filter((id) => network.assets[id]).map((id) => {
        const m = f.toMetric(network.assets[id]!.at);
        const ll = f.toLngLat([m[0] + b[0] - a[0], m[1] + b[1] - a[1]]);
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [...ll] }, properties: {} } as Feature;
      })));
    } else {
      const s = drag.startLL, t = e.lngLat;
      setSource('draft', fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[s[0], s[1]], [t[0], s[1]], [t[0], t[1]], [s[0], t[1]], [s[0], s[1]]]] }, properties: {} }]));
    }
  },
  up(e, ctx) {
    if (!drag) return;
    const d = drag;
    drag = null;
    setSource('draft', null);
    const { baseline } = useApp.getState();
    if (d.kind === 'move' && baseline) {
      const f = new LocalFrame(baseline.origin);
      const a = f.toMetric(d.start), b = f.toMetric(e.lngLat);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.05) moveAssets(d.ids, b[0] - a[0], b[1] - a[1]);
    } else if (d.kind === 'box') {
      const feats = ctx.map.queryRenderedFeatures([[Math.min(d.start.x, e.point.x), Math.min(d.start.y, e.point.y)], [Math.max(d.start.x, e.point.x), Math.max(d.start.y, e.point.y)]], { layers: ['asset-fp-fill', 'asset-pt-sign', 'asset-pt-dot', 'signals-icon'].filter((l) => ctx.map.getLayer(l)) });
      const ids = [...new Set(feats.map((f) => String(f.properties.id)))];
      select(ids.length ? { kind: 'asset', ids } : null);
    }
  },
  click(e: ToolEvent, ctx) {
    const hit = pickAt(ctx.map, e.point);
    const cur = useApp.getState().selection;
    if (e.shift && hit && cur && cur.kind === hit.kind) {
      const id = hit.ids[0]!;
      const ids = cur.ids.includes(id) ? cur.ids.filter((x) => x !== id) : [...cur.ids, id];
      select(ids.length ? { kind: cur.kind, ids } : null);
      return;
    }
    select(hit);
  },
};
