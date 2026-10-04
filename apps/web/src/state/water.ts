import { create } from 'zustand';
import { analyzeWater, type Network, type WaterResult } from '@drip-urban/core';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { registerLive } from './live';
import { useApp } from './store';

/** Water supply: last analysis and map overlay coloured by pressure (nodes) and velocity (pipes). */
export const useWater = create<{ result: WaterResult | null; demandFactor: number }>(() => ({ result: null, demandFactor: 1 }));

registerLive('water', () => { if (useWater.getState().result) runWater(); });

export function runWater(): WaterResult | null {
  const net = useApp.getState().network;
  if (!net) return null;
  const result = analyzeWater(net, { demandFactor: useWater.getState().demandFactor });
  useWater.setState({ result });
  drawWater(net);
  return result;
}

export function drawWater(net: Network): void {
  const r = useWater.getState().result;
  const nodes = net.waterNodes ?? {}, pipes = net.waterPipes ?? {};
  setSource('water-nodes', fc(Object.values(nodes).map((n): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.at[0], n.at[1]] }, properties: { id: n.id, kind: n.kind, p: r?.nodes[n.id]?.pressureM ?? null, label: r?.nodes[n.id]?.supplied ? `${(r.nodes[n.id]!.pressureBar).toFixed(1).replace('.', ',')} bar` : '' } }))));
  setSource('water-pipes', fc(Object.values(pipes).filter((p) => nodes[p.from] && nodes[p.to]).map((p): Feature => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: [[nodes[p.from]!.at[0], nodes[p.from]!.at[1]], [nodes[p.to]!.at[0], nodes[p.to]!.at[1]]] },
    properties: { id: p.id, v: r?.pipes[p.id]?.velocity ?? null, closed: p.status === 'closed', label: `DN ${p.diameterMm}${r ? ` · ${Math.abs(r.pipes[p.id]?.flowLs ?? 0).toFixed(1).replace('.', ',')} l/s` : ''}` },
  }))));
}
