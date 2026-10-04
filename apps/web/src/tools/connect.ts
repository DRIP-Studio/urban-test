import { connectorOps, linkOps, geom, type DanglingLink } from '@drip-urban/core';
import { fc } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, select, useApp } from '../state/store';
import { toast } from '../state/toasts';
import type { ToolHandler } from './types';

/**
 * Aggancia: click a road end, then the road (or junction) to reach. By default a short connector
 * road is added and the target is split exactly on its own axis: no existing vertex moves.
 * Alt+click on the target moves the free end instead (classic snap).
 */
let start: { nodeId: string; roadId: string } | null = null;

export const connectTool: ToolHandler = {
  activate() { start = null; },
  deactivate() { start = null; setSource('draft', null); },
  move(e, ctx) {
    const idx = ctx.index();
    const net = useApp.getState().network;
    if (!start || !idx || !net) return;
    const a = net.nodes[start.nodeId]!.at;
    setSource('draft', fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a[0], a[1]], [e.lngLat[0], e.lngLat[1]]] }, properties: {} }]));
  },
  click(e, ctx) {
    const idx = ctx.index();
    const net = useApp.getState().network;
    if (!idx || !net) return;
    const p = idx.frame.toMetric(e.lngLat) as geom.V;
    if (!start) {
      const n = idx.nearestNode(p, 15);
      const road = n ? Object.values(net.roads).find((r) => r.from === n.id || r.to === n.id) : undefined;
      if (!n || !road) { toast.info('Scegli un estremo', 'Clic vicino all\'estremo libero di una strada.'); return; }
      start = { nodeId: n.id, roadId: road.id };
      return;
    }
    const s = start;
    const own = new Set(Object.values(net.roads).filter((r) => r.from === s.nodeId || r.to === s.nodeId).flatMap((r) => [r.from, r.to]));
    const node = idx.nearestNode(p, 6);
    const sp = idx.frame.toMetric(net.nodes[s.nodeId]!.at) as geom.V;
    let link: DanglingLink | null = null;
    if (node && !own.has(node.id)) {
      link = { nodeId: s.nodeId, roadId: s.roadId, kind: 'node', targetNodeId: node.id, at: net.nodes[node.id]!.at, distM: geom.dist(sp, idx.frame.toMetric(net.nodes[node.id]!.at) as geom.V) };
    } else {
      const r = idx.nearestRoad(p, 12);
      if (r && r.id !== s.roadId && r.along > 1 && r.along < r.length - 1) link = { nodeId: s.nodeId, roadId: s.roadId, kind: 'edge', targetRoadId: r.id, along: r.along, at: idx.frame.toLngLat(r.at), distM: geom.dist(sp, r.at) };
    }
    start = null;
    setSource('draft', null);
    if (!link) { toast.info('Nessuna destinazione', 'Clic su una strada o un incrocio diversi da quella di partenza.'); return; }
    const ids = { node: newId('n'), roads: [newId('r'), newId('r')] as [string, string], connector: newId('r') };
    const ops = e.alt ? linkOps(link, ids) : connectorOps(net, link, ids);
    if (commit('batch', { label: e.alt ? 'Aggancia strada (sposta l\'estremo)' : 'Raccordo tra strade', ops }).ok) {
      toast.success('Strade collegate', e.alt ? 'Estremo spostato sulla strada di arrivo.' : `Raccordo di ${link.distM.toFixed(1).replace('.', ',')} m: geometrie esistenti invariate.`);
      if (!e.alt && useApp.getState().network?.roads[ids.connector]) select({ kind: 'road', ids: [ids.connector] });
    }
  },
  key(e) { if (e.key === 'Escape') { start = null; setSource('draft', null); return true; } },
};
