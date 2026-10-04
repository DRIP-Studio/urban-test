import { PIPE_MATERIALS, geom, sampleTerrain, type DrainageNode, type DrainageNodeKind, type DrainagePipe, type LngLat } from '@drip-urban/core';
import { fc } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, select, useApp } from '../state/store';
import { useTerrain } from '../state/terrain';
import { toast } from '../state/toasts';
import { useTool } from './toolState';
import type { ToolHandler } from './types';

/**
 * Rete di drenaggio: each click adds a node (caditoia, pozzetto or scarico) and the pipe from the
 * previous node of the chain, downhill. Clicking an existing node connects to it (and continues from
 * it). Esc / Invio end the chain. Rim from the DTM when available; invert = rim − depth, never above
 * the upstream invert minus 0,3% of the length.
 */
let chain: string | null = null;

function nearNode(at: LngLat, frame: { toMetric(p: LngLat): readonly number[] }, radiusM = 2.5): DrainageNode | null {
  const net = useApp.getState().network;
  const p = frame.toMetric(at);
  let best: { n: DrainageNode; d: number } | null = null;
  for (const n of Object.values(net?.drainageNodes ?? {})) {
    const q = frame.toMetric(n.at);
    const d = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
    if (d < radiusM && (!best || d < best.d)) best = { n, d };
  }
  return best?.n ?? null;
}

function drawChain(cursor: LngLat | null): void {
  const net = useApp.getState().network;
  const from = chain ? net?.drainageNodes?.[chain] : undefined;
  setSource('draft', from && cursor ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[from.at[0], from.at[1]], [cursor[0], cursor[1]]] }, properties: {} }]) : null);
}

export const drainageTool: ToolHandler = {
  activate() { chain = null; },
  deactivate() { chain = null; setSource('draft', null); },
  move(e) { drawChain(e.lngLat); },
  click(e, ctx) {
    const idx = ctx.index();
    const net = useApp.getState().network;
    if (!idx || !net) return;
    const t = useTool.getState();
    const hit = nearNode(e.lngLat, idx.frame);
    const prev = chain ? net.drainageNodes?.[chain] : undefined;
    const ops: { type: string; payload: unknown }[] = [];
    let node = hit;
    if (!node) {
      const grid = useTerrain.getState().grid;
      const z = grid ? sampleTerrain(grid, e.lngLat[0], e.lngLat[1]) : NaN;
      const rim = Number.isFinite(z) ? Math.round(z * 100) / 100 : undefined;
      let invert = (rim ?? 0) - t.drainDepthM;
      if (prev) {
        const L = geom.dist(idx.frame.toMetric(prev.at) as geom.V, idx.frame.toMetric(e.lngLat) as geom.V);
        invert = Math.min(invert, prev.invertElevation - Math.max(0.003, 0.005) * L);
      }
      node = { id: newId('dn'), kind: t.drainKind, at: e.lngLat, invertElevation: Math.round(invert * 100) / 100, ...(rim !== undefined ? { rimElevation: rim, rimSource: 'dtm' as const } : {}) };
      ops.push({ type: 'drainage.addNode', payload: { node } });
    }
    if (prev && prev.id !== node.id) {
      const mat = PIPE_MATERIALS.find((m) => m.id === t.drainMaterial) ?? PIPE_MATERIALS[0]!;
      const pipe: DrainagePipe = { id: newId('dp'), from: prev.id, to: node.id, diameterMm: t.drainDn, material: mat.label, ks: mat.ks };
      ops.push({ type: 'drainage.addPipe', payload: { pipe } });
    }
    if (!ops.length) { chain = node.id; return; }
    const res = ops.length === 1 ? commit(ops[0]!.type, ops[0]!.payload) : commit('batch', { label: 'Rete di drenaggio', ops });
    if (!res.ok) return;
    chain = node.kind === 'outfall' ? null : node.id;
    if (node.kind === 'outfall') toast.info('Scarico raggiunto', 'Tratto chiuso: clic per iniziarne un altro, o apri «Drenaggio urbano» per la verifica.');
    select(null);
  },
  key(e) {
    if (e.key === 'Escape' || e.key === 'Enter') { chain = null; setSource('draft', null); return true; }
  },
};

export const DRAIN_KINDS: { value: DrainageNodeKind; label: string }[] = [
  { value: 'inlet', label: 'Caditoia' }, { value: 'manhole', label: 'Pozzetto' }, { value: 'outfall', label: 'Scarico / recapito' },
];
