import { create } from 'zustand';
import { DEFAULT_IDF, LocalFrame, analyzeDrainage, assignCatchments, geom, type CatchmentSurface, type DrainageResult, type IdfParams, type Network } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { useApp } from './store';
import { registerLive } from './live';

/** Storm drainage: last analysis (rational method) and the map overlay coloured by pipe filling. */
interface DrainageState { idf: IdfParams; result: DrainageResult | null; version: number }
export const useDrainage = create<DrainageState>(() => ({ idf: DEFAULT_IDF, result: null, version: -1 }));

/** Paved and green surfaces of the physical model as catchment surfaces (runoff coefficient by kind). */
export function catchmentSurfaces(): CatchmentSurface[] {
  const p = engine.lastPhysical;
  if (!p) return [];
  return p.surfaces.features.flatMap((f): CatchmentSurface[] => {
    const rings = f.geometry.coordinates as number[][][];
    if (!rings[0] || rings[0].length < 4) return [];
    const pr = f.properties as { id?: string; kind?: string; material?: string };
    return [{ id: String(pr.id ?? ''), kind: String(pr.kind ?? 'carriageway'), material: pr.material, ring: rings[0].slice(0, -1).map((q) => [q[0]!, q[1]!] as [number, number]) }];
  });
}

registerLive('drainage', () => { if (useDrainage.getState().result) runDrainage(); });

export function runDrainage(autoSize = false): DrainageResult | null {
  const { network, baseline, netVersion } = useApp.getState();
  if (!network || !baseline) return null;
  const catchments = assignCatchments(network, catchmentSurfaces(), baseline.origin);
  const result = analyzeDrainage(network, { idf: useDrainage.getState().idf, catchments, autoSize });
  useDrainage.setState({ result, version: netVersion });
  drawDrainage(network);
  return result;
}

export function drawDrainage(net: Network): void {
  const res = useDrainage.getState().result;
  const nodes = net.drainageNodes ?? {}, pipes = net.drainagePipes ?? {};
  const f = useApp.getState().baseline ? new LocalFrame(useApp.getState().baseline!.origin) : null;
  setSource('drain-nodes', fc(Object.values(nodes).map((n): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.at[0], n.at[1]] }, properties: { id: n.id, kind: n.kind } }))));
  setSource('drain-pipes', fc(Object.values(pipes).filter((p) => nodes[p.from] && nodes[p.to]).map((p): Feature => {
    const a = nodes[p.from]!, b = nodes[p.to]!;
    const r = res?.pipes[p.id];
    const L = f ? geom.dist(f.toMetric(a.at) as geom.V, f.toMetric(b.at) as geom.V) : 0;
    const slope = L > 0 ? ((a.invertElevation - b.invertElevation) / L) * 100 : 0;
    return {
      type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.at[0], a.at[1]], [b.at[0], b.at[1]]] },
      properties: { id: p.id, dn: p.diameterMm / 1000, fill: r ? r.fill : null, label: `DN ${p.diameterMm} · i ${slope.toFixed(2).replace('.', ',')}%${r ? ` · h/D ${Math.round(r.fill * 100)}%` : ''}` },
    };
  })));
}
