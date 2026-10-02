import { LocalFrame, planRoundabout, type LngLat, type Roundabout } from '@drip-urban/core';
import { fc, type Feature } from '../engine/geojson';
import { setSource, useMapUi } from '../map/mapStore';
import { commit, newId, select, setTool, useApp } from '../state/store';
import type { NetworkIndex } from './snap';
import { useTool, type ToolState } from './toolState';
import type { ToolHandler } from './types';

type Pending = NonNullable<ToolState['rb']>;

export const DEFAULT_RB: Omit<Pending, 'center' | 'nodeId' | 'placed'> = {
  type: 'compact', outerDiameterM: 30, circulatoryWidthM: 7, lanes: 1, apronWidthM: 1.5, aspect: 1, orientationDeg: 0,
  islandMaterial: 'grass', splitters: true, crossings: false,
};
const RANGE: Record<string, [number, number]> = { mini: [14, 25], compact: [25, 40], standard: [40, 70], elliptical: [40, 70], turbo: [40, 70] };

/** Roundabout described by the pending tool state (id fixed only on creation). */
export function roundaboutFrom(p: Pending, id = 'rb-preview'): Roundabout {
  return {
    id, name: 'Rotatoria di progetto', type: p.type, center: p.center, ...(p.nodeId ? { replacedNodeId: p.nodeId } : {}),
    outerDiameterM: p.outerDiameterM, aspect: p.type === 'elliptical' ? p.aspect : 1, orientationDeg: p.orientationDeg,
    circulatoryWidthM: p.circulatoryWidthM, lanes: p.lanes, apronWidthM: p.apronWidthM, islandMaterial: p.islandMaterial,
    control: 'yield', speedKmh: p.type === 'mini' ? 20 : 30, arms: [],
  };
}

function ellipse(center: LngLat, r: number, aspect: number, orientationDeg: number): number[][] {
  const f = new LocalFrame(center);
  const rot = ((90 - orientationDeg) * Math.PI) / 180;
  return Array.from({ length: 97 }, (_, i) => {
    const t = (2 * Math.PI * i) / 96;
    const x = r * Math.cos(t), y = r * aspect * Math.sin(t);
    const ll = f.toLngLat([x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
    return [ll[0], ll[1]];
  });
}

/** Ghost ring + the arms the ring will cut (accent) and the roads it swallows (dashed). */
export function drawPreview(p: Pending | null): void {
  const net = useApp.getState().network;
  if (!p || !net) { setSource('draft', null); return; }
  const rb = roundaboutFrom(p);
  const aspect = rb.aspect;
  const R = rb.outerDiameterM / 2;
  const feats: Feature[] = [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ellipse(rb.center, R, aspect, rb.orientationDeg), ellipse(rb.center, R - rb.circulatoryWidthM, aspect, rb.orientationDeg)] }, properties: { kind: 'ring', placed: p.placed } },
  ];
  const plan = planRoundabout(net, rb);
  const f = new LocalFrame(rb.center);
  for (const a of plan.arms) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: a.outward.slice(0, 60).map((q) => [...f.toLngLat(q)]) }, properties: { kind: 'arm' } });
  for (const id of plan.removedRoadIds) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((q) => [...q]) }, properties: { kind: 'removed' } });
  feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...rb.center] }, properties: { snap: true, label: `Ø ${rb.outerDiameterM} m · ${plan.arms.length} bracci` } });
  setSource('draft', fc(feats));
}

export function createRoundabout(): void {
  const p = useTool.getState().rb;
  const net = useApp.getState().network;
  if (!p || !net) return;
  const draft = roundaboutFrom(p, newId('rb'));
  const plan = planRoundabout(net, draft);
  const r: Roundabout = {
    ...draft,
    arms: plan.arms.map((a) => ({
      roadId: a.roadId, entryRadiusM: Math.max(6, p.outerDiameterM * 0.35), exitRadiusM: Math.max(8, p.outerDiameterM * 0.45),
      splitter: p.splitters && p.type !== 'mini', splitterLengthM: 10, splitterWidthM: 1.5, crossing: p.crossings,
    })),
  };
  if (commit('roundabout.add', { roundabout: r }).ok) {
    useTool.setState({ rb: null });
    setSource('draft', null);
    setTool('select');
    select({ kind: 'roundabout', ids: [r.id] });
  }
}

/** Junction centre within 14 px (≥ 3 vehicular roads), else the free point. */
function anchorAt(idx: NetworkIndex | null, at: LngLat, mpp: number): { center: LngLat; nodeId: string | null } {
  if (!idx) return { center: at, nodeId: null };
  const n = idx.nearestNode(idx.frame.toMetric(at) as never, 14 * mpp);
  if (n) {
    const deg = Object.values(idx.net.roads).filter((r) => r.from === n.id || r.to === n.id).length;
    if (deg >= 3) return { center: idx.net.nodes[n.id]!.at, nodeId: n.id };
  }
  return { center: at, nodeId: null };
}

export const roundaboutTool: ToolHandler = {
  activate() { drawPreview(useTool.getState().rb); },
  deactivate() { if (!useTool.getState().rb?.placed) useTool.setState({ rb: null }); setSource('draft', null); },
  move(e, ctx) {
    const cur = useTool.getState().rb;
    if (cur?.placed) return;
    const a = anchorAt(ctx.index(), e.lngLat, useMapUi.getState().mpp);
    const next: Pending = { ...DEFAULT_RB, ...(cur ?? {}), ...a, placed: false };
    useTool.setState({ rb: next });
    drawPreview(next);
  },
  click(e, ctx) {
    const cur = useTool.getState().rb;
    const a = anchorAt(ctx.index(), e.lngLat, useMapUi.getState().mpp);
    const next: Pending = { ...DEFAULT_RB, ...(cur ?? {}), ...a, placed: true };
    useTool.setState({ rb: next });
    drawPreview(next);
  },
  key(e) {
    const cur = useTool.getState().rb;
    if (!cur) return false;
    if (e.key === '[' || e.key === ']') {
      const [lo, hi] = RANGE[cur.type] ?? [14, 70];
      const d = Math.min(hi, Math.max(lo, cur.outerDiameterM + (e.key === ']' ? 2 : -2)));
      const next = { ...cur, outerDiameterM: d };
      useTool.setState({ rb: next });
      drawPreview(next);
      return true;
    }
    if (e.key === 'Enter' && cur.placed) { createRoundabout(); return true; }
    if (e.key === 'Escape' && cur.placed) {
      const next = { ...cur, placed: false };
      useTool.setState({ rb: next });
      drawPreview(next);
      return true;
    }
    return false;
  },
};
