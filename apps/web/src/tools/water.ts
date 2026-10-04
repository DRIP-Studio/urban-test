import { WATER_MATERIALS, geom, sampleTerrain, type LngLat, type WaterNode, type WaterNodeKind, type WaterPipe } from '@drip-urban/core';
import { fc } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, useApp } from '../state/store';
import { useTerrain } from '../state/terrain';
import { toast } from '../state/toasts';
import { useTool } from './toolState';
import type { ToolHandler } from './types';

/**
 * Acquedotto: each click adds a node (giunzione, serbatoio, idrante…) and the pipe from the previous
 * node of the chain; clicking an existing node connects to it (loops are normal in water networks).
 * Elevation from the DTM when loaded; reservoirs get head = ground + 40 m by default.
 */
let chain: string | null = null;

function near(at: LngLat, frame: { toMetric(p: LngLat): readonly number[] }): WaterNode | null {
  const p = frame.toMetric(at);
  let best: { n: WaterNode; d: number } | null = null;
  for (const n of Object.values(useApp.getState().network?.waterNodes ?? {})) {
    const q = frame.toMetric(n.at), d = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
    if (d < 2.5 && (!best || d < best.d)) best = { n, d };
  }
  return best?.n ?? null;
}

export const waterTool: ToolHandler = {
  activate() { chain = null; },
  deactivate() { chain = null; setSource('draft', null); },
  move(e) {
    const from = chain ? useApp.getState().network?.waterNodes?.[chain] : undefined;
    setSource('draft', from ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[from.at[0], from.at[1]], [e.lngLat[0], e.lngLat[1]]] }, properties: {} }]) : null);
  },
  click(e, ctx) {
    const idx = ctx.index();
    const net = useApp.getState().network;
    if (!idx || !net) return;
    const t = useTool.getState();
    const prev = chain ? net.waterNodes?.[chain] : undefined;
    let node = near(e.lngLat, idx.frame);
    const ops: { type: string; payload: unknown }[] = [];
    if (!node) {
      const grid = useTerrain.getState().grid;
      const z = grid ? sampleTerrain(grid, e.lngLat[0], e.lngLat[1]) : NaN;
      const elevation = Number.isFinite(z) ? Math.round(z * 100) / 100 : 0;
      const kind: WaterNodeKind = t.waterKind;
      node = { id: newId('wn'), kind, at: e.lngLat, elevation, ...(kind === 'reservoir' || kind === 'tank' ? { headM: elevation + t.waterHeadM } : { demandLs: kind === 'junction' ? t.waterDemandLs : 0 }) };
      ops.push({ type: 'water.addNode', payload: { node } });
    }
    if (prev && prev.id !== node.id) {
      const mat = WATER_MATERIALS.find((m) => m.id === t.waterMaterial) ?? WATER_MATERIALS[0]!;
      const pipe: WaterPipe = { id: newId('wp'), from: prev.id, to: node.id, diameterMm: t.waterDn, material: mat.label, c: mat.c };
      ops.push({ type: 'water.addPipe', payload: { pipe } });
    }
    chain = node.id;
    if (!ops.length) return;
    const res = ops.length === 1 ? commit(ops[0]!.type, ops[0]!.payload) : commit('batch', { label: 'Rete acquedotto', ops });
    if (!res.ok) chain = prev?.id ?? null;
    void geom;
  },
  key(e) {
    if (e.key === 'Escape' || e.key === 'Enter') { chain = null; setSource('draft', null); if (e.key === 'Enter') toast.info('Tratto chiuso', 'Clic per iniziarne un altro'); return true; }
  },
};

export const WATER_KINDS: { value: WaterNodeKind; label: string }[] = [
  { value: 'junction', label: 'Nodo / utenza' }, { value: 'hydrant', label: 'Idrante' }, { value: 'reservoir', label: 'Serbatoio / fonte' }, { value: 'valve', label: 'Valvola' },
];
