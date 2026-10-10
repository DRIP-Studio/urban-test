import type { LngLat, Network, SimOptions } from '@drip-urban/core';
import type { Selection } from '../state/store';

export type SimulationScope = 'municipality' | 'visible' | 'junction' | 'corridor' | 'neighbourhood' | 'district' | 'polygon';
export const SIMULATION_SCOPES: { value: SimulationScope; label: string }[] = [
  { value: 'municipality', label: 'Intero comune' }, { value: 'visible', label: 'Area visibile' },
  { value: 'junction', label: 'Incrocio selezionato · 300 m' }, { value: 'corridor', label: 'Corridoio selezionato · fascia 200 m' },
  { value: 'neighbourhood', label: 'Quartiere · raggio 1 km' }, { value: 'district', label: 'Distretto · raggio 2,5 km' },
  { value: 'polygon', label: 'Poligono selezionato' },
];

/** Demand scope only; the solver retains the connected project network for through routes. */
export function simulationScope(scope: SimulationScope, net: Network, selection: Selection | null, visible: readonly [number, number, number, number] | null): Pick<SimOptions, 'focus' | 'focusPolygon' | 'focusCorridor' | 'scopeName'> {
  const scopeName = SIMULATION_SCOPES.find((s) => s.value === scope)!.label;
  if (scope === 'municipality') return { scopeName };
  if (scope === 'visible') { if (!visible) throw new Error('La mappa non ha ancora un’area visibile.'); return { scopeName, focus: visible }; }
  const id = selection?.ids[0];
  const extent = (points: readonly LngLat[], metres: number): readonly [number, number, number, number] => {
    const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
    const dx = metres / (111320 * Math.cos(lat * Math.PI / 180)), dy = metres / 110540;
    return [Math.min(...points.map((p) => p[0])) - dx, Math.min(...points.map((p) => p[1])) - dy, Math.max(...points.map((p) => p[0])) + dx, Math.max(...points.map((p) => p[1])) + dy];
  };
  if (scope === 'junction') {
    const at = id && (selection?.kind === 'node' ? net.nodes[id]?.at : selection?.kind === 'roundabout' ? net.roundabouts[id]?.center : undefined);
    if (!at) throw new Error('Seleziona un incrocio o una rotatoria per questo ambito.');
    return { scopeName, focus: extent([at], 300) };
  }
  if (scope === 'corridor') {
    const roads = selection?.kind === 'road' ? selection.ids.map((id) => net.roads[id]).filter((r) => !!r) : [];
    if (!roads.length) throw new Error('Seleziona una o più strade del corridoio.');
    return { scopeName, focus: extent(roads.flatMap((r) => [...r.axis]), 200), focusCorridor: { roadIds: roads.map((r) => r.id), widthM: 200 } };
  }
  if (scope === 'polygon') {
    const polygon = id && (selection?.kind === 'zone' ? net.zones[id]?.polygon : selection?.kind === 'area' ? net.areas[id]?.polygon : undefined);
    if (!polygon || polygon.length < 3) throw new Error('Seleziona una zona o un’area poligonale.');
    return { scopeName, focus: extent(polygon, 0), focusPolygon: polygon };
  }
  if (!visible) throw new Error('La mappa non ha ancora un centro.');
  const center: LngLat = [(visible[0] + visible[2]) / 2, (visible[1] + visible[3]) / 2];
  // Named local study extents, explicit radii rather than invented administrative boundaries.
  const radius = scope === 'district' ? 2500 : 1000;
  const dx = radius / (111320 * Math.cos(center[1] * Math.PI / 180)), dy = radius / 110540;
  const focusPolygon: LngLat[] = Array.from({ length: 64 }, (_, i) => [center[0] + dx * Math.cos(i * Math.PI / 32), center[1] + dy * Math.sin(i * Math.PI / 32)]);
  return { scopeName, focus: extent([center], radius), focusPolygon };
}
