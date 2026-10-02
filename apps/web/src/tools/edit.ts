import { geom, type LngLat } from '@drip-urban/core';
import type { Map as MLMap } from 'maplibre-gl';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, select, setDock, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { pickAt } from './select';
import { snap, type NetworkIndex } from './snap';
import { useTool } from './toolState';
import type { ToolHandler } from './types';

// ---------------------------------------------------------------- vertex / node editing

interface Handle { roadId: string; index: number; role: 'end' | 'vertex' | 'mid'; at: LngLat; nodeId?: string }
let handles: Handle[] = [];
let dragging: { h: Handle; to: LngLat } | null = null;

function refreshHandles(): void {
  const { network, selection } = useApp.getState();
  handles = [];
  if (!network || selection?.kind !== 'road') { setSource('handles', null); return; }
  for (const id of selection.ids) {
    const r = network.roads[id];
    if (!r) continue;
    r.axis.forEach((p, i) => {
      const end = i === 0 || i === r.axis.length - 1;
      handles.push({ roadId: id, index: i, role: end ? 'end' : 'vertex', at: p, ...(end ? { nodeId: i === 0 ? r.from : r.to } : {}) });
      if (i > 0) {
        const a = r.axis[i - 1]!;
        handles.push({ roadId: id, index: i, role: 'mid', at: [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2] });
      }
    });
  }
  setSource('handles', fc(handles.map((h, i): Feature => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [...h.at] }, properties: { id: i, role: h.role } }))));
}

function nearestHandle(map: MLMap, point: { x: number; y: number }): Handle | null {
  const f = map.queryRenderedFeatures([[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]], { layers: ['handles-circle'] })[0];
  return f ? handles[Number(f.properties.id)] ?? null : null;
}

export const nodeTool: ToolHandler = {
  activate() { refreshHandles(); },
  deactivate() { setSource('handles', null); setSource('draft', null); dragging = null; },
  click(e, ctx) {
    if (nearestHandle(ctx.map, e.point)) return;
    const hit = pickAt(ctx.map, e.point);
    select(hit?.kind === 'road' ? hit : null);
    refreshHandles();
  },
  down(e, ctx) {
    const h = nearestHandle(ctx.map, e.point);
    if (!h || e.button !== 0) return;
    dragging = { h, to: h.at };
    return true;
  },
  move(e, ctx) {
    if (!dragging) return;
    const idx = ctx.index();
    const p = idx ? snap(ctx.map, idx, e.lngLat, { disable: e.alt }) : { at: e.lngLat, kind: 'free' as const };
    dragging.to = p.kind === 'node' && dragging.h.role !== 'end' ? e.lngLat : p.at;
    const r = useApp.getState().network?.roads[dragging.h.roadId];
    if (!r) return;
    const axis = [...r.axis];
    if (dragging.h.role === 'mid') axis.splice(dragging.h.index, 0, dragging.to); else axis[dragging.h.index] = dragging.to;
    setSource('draft', fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: axis.map((q) => [...q]) }, properties: { width: 3 } }]));
  },
  up() {
    if (!dragging) return;
    const { h, to } = dragging;
    dragging = null;
    setSource('draft', null);
    const r = useApp.getState().network?.roads[h.roadId];
    if (!r) return;
    if (h.role === 'end' && h.nodeId) {
      commit('node.move', { nodeId: h.nodeId, to, falloffM: 25 });
    } else {
      const axis = [...r.axis];
      if (h.role === 'mid') axis.splice(h.index, 0, to); else axis[h.index] = to;
      commit('road.setAxis', { roadId: r.id, axis });
    }
    refreshHandles();
  },
  key(e) {
    if (e.key === 'Escape') { select(null); refreshHandles(); return true; }
  },
};

/** Right-click on a vertex handle removes it. */
export function removeVertexAt(map: MLMap, point: { x: number; y: number }): boolean {
  const h = nearestHandle(map, point);
  if (!h || h.role !== 'vertex') return false;
  const r = useApp.getState().network?.roads[h.roadId];
  if (!r || r.axis.length <= 2) return false;
  commit('road.setAxis', { roadId: r.id, axis: r.axis.filter((_, i) => i !== h.index) });
  refreshHandles();
  return true;
}

useApp.subscribe((s, prev) => {
  if ((s.netVersion !== prev.netVersion || s.selection !== prev.selection) && s.tool === 'nodes') refreshHandles();
});

// ---------------------------------------------------------------- cut

export const cutTool: ToolHandler = {
  move(e, ctx) {
    const idx = ctx.index();
    if (!idx) return;
    const p = snap(ctx.map, idx, e.lngLat);
    setSource('draft', p.kind === 'edge' || p.kind === 'midpoint' ? fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [...p.at] }, properties: { snap: true, label: 'Taglia qui' } }]) : null);
  },
  click(e, ctx) {
    const idx = ctx.index();
    if (!idx) return;
    const p = snap(ctx.map, idx, e.lngLat);
    if (!(p.kind === 'edge' || p.kind === 'midpoint') || !p.roadId) { toast.info('Taglia', 'Clicca sull\'asse di una strada.'); return; }
    const a = newId('r'), b = newId('r');
    if (commit('road.split', { roadId: p.roadId, at: p.at, nodeId: newId('n'), newRoadIds: [a, b] }).ok) select({ kind: 'road', ids: [a, b] });
  },
  deactivate() { setSource('draft', null); },
};

// ---------------------------------------------------------------- pickers for panels

function junctionAt(e: { point: { x: number; y: number }; lngLat: LngLat }, map: MLMap, idx: NetworkIndex | null): string | null {
  const hit = pickAt(map, e.point, 8);
  if (hit?.kind === 'node') return hit.ids[0]!;
  if (!idx) return null;
  const n = idx.nearestNode(idx.frame.toMetric(e.lngLat) as geom.V, 25);
  return n?.id ?? null;
}

export function makeJunctionPicker(dock: string | null, then?: (nodeId: string) => void): ToolHandler {
  return {
    click(e, ctx) {
      const nodeId = junctionAt(e, ctx.map, ctx.index());
      if (!nodeId) { toast.info('Seleziona un incrocio', 'Clicca al centro di un incrocio esistente.'); return; }
      select({ kind: 'node', ids: [nodeId] });
      if (dock && useApp.getState().dock !== dock) setDock(dock);
      then?.(nodeId);
    },
  };
}

export const sectionTool: ToolHandler = {
  click(e, ctx) {
    // Rendered features first; fall back to the spatial index so a click near a kerb still finds the road.
    const hit = pickAt(ctx.map, e.point);
    let roadId = hit?.kind === 'road' ? hit.ids[0] : undefined;
    const idx = ctx.index();
    if (!roadId && idx) roadId = idx.nearestRoad(idx.frame.toMetric(e.lngLat) as geom.V, 12)?.id;
    if (!roadId) { toast.info('Sezione', 'Clicca su una strada per aprirne la sezione.'); return; }
    select({ kind: 'road', ids: [roadId] });
    if (useApp.getState().dock !== 'section') setDock('section');
  },
};
