import { ROAD_TEMPLATES, geom, layoutSection, roadFromTemplate, type LngLat } from '@drip-urban/core';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, select } from '../state/store';
import { toast } from '../state/toasts';
import { planRoad } from './roadOps';
import { snap, type NetworkIndex, type SnapResult } from './snap';
import { useTool } from './toolState';
import type { ToolContext, ToolEvent, ToolHandler } from './types';

/**
 * Road pen: click for a straight vertex, click-and-drag to pull tangent handles (smooth curve through
 * that vertex, like a vector pen). The preview is the real road — carriageway, lanes, sidewalks —
 * built from the chosen template, with live segment length and bearing. Shift constrains to 15°.
 */

interface Vertex { readonly p: SnapResult; readonly h: geom.V | null }

const PREVIEW_FILL: Record<string, string> = {
  lane: '#45484d', bus: '#8a3a32', cycle: '#9a4b3d', parking: '#5f6268', sidewalk: '#cfc8bb', green: '#6f8f52',
  median: '#9c9a96', furniture: '#b5ad9f', shoulder: '#3e4146', curb: '#9c9a96',
};

let verts: Vertex[] = [];
let drag: { index: number; startPx: { x: number; y: number } } | null = null;
let lastCursor: SnapResult | null = null;

const metric = (idx: NetworkIndex, p: LngLat) => idx.frame.toMetric(p) as geom.V;

/** Cubic Bézier through the vertices; a vertex handle h gives out-tangent +h and in-tangent −h. */
function axisOf(idx: NetworkIndex, vs: readonly Vertex[]): geom.V[] {
  if (vs.length < 2) return vs.map((v) => metric(idx, v.p.at));
  const out: geom.V[] = [metric(idx, vs[0]!.p.at)];
  for (let i = 0; i < vs.length - 1; i++) {
    const a = vs[i]!, b = vs[i + 1]!;
    const P0 = metric(idx, a.p.at), P3 = metric(idx, b.p.at);
    if (!a.h && !b.h) { out.push(P3); continue; }
    const P1 = a.h ? geom.add(P0, a.h) : P0;
    const P2 = b.h ? geom.sub(P3, b.h) : P3;
    const n = Math.max(4, Math.ceil(geom.dist(P0, P3) / 1.2));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      out.push([
        u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
        u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
      ]);
    }
  }
  return out;
}

function constrain(idx: NetworkIndex, from: LngLat, to: SnapResult, on: boolean): SnapResult {
  if (!on || to.kind === 'node') return to;
  const o = metric(idx, from), q = metric(idx, to.at);
  const v = geom.sub(q, o), L = geom.len(v);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(v[1], v[0]) / step) * step;
  return { at: idx.frame.toLngLat([o[0] + L * Math.cos(a), o[1] + L * Math.sin(a)]), kind: 'angle' };
}

const fmtLen = (m: number) => `${m.toFixed(1).replace('.', ',')} m`;

function render(idx: NetworkIndex, cursor: SnapResult | null): void {
  const t = useTool.getState();
  const tpl = ROAD_TEMPLATES.find((x) => x.id === t.roadTemplate) ?? ROAD_TEMPLATES[0]!;
  const vs = cursor ? [...verts, { p: cursor, h: null }] : verts;
  const axis = axisOf(idx, vs);
  const feats: Feature[] = [];
  if (axis.length >= 2 && geom.lengthOf(axis) > 0.5) {
    const ll = axis.map((p) => idx.frame.toLngLat(p));
    const road = roadFromTemplate(tpl, 'preview', 'a', 'b', ll, '');
    const lay = layoutSection(road);
    for (const pe of lay.elements) {
      const ring = geom.band(axis, pe.left, pe.right).map((p) => [...idx.frame.toLngLat(p)]);
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] }, properties: { fill: PREVIEW_FILL[pe.el.kind] ?? '#45484d', opacity: 0.82, kind: 'road-preview' } });
    }
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ll.map((p) => [...p]) }, properties: { kind: 'road-axis' } });
  }
  // Handles of curved vertices.
  for (const v of verts) {
    if (!v.h) continue;
    const c = metric(idx, v.p.at);
    const a = idx.frame.toLngLat(geom.add(c, v.h)), b = idx.frame.toLngLat(geom.sub(c, v.h));
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[...b], [...v.p.at], [...a]] }, properties: { kind: 'handle' } });
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...a] }, properties: {} });
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...b] }, properties: {} });
  }
  vs.forEach((v, i) => {
    const last = i === vs.length - 1 && vs.length >= 2;
    let label: string | undefined;
    if (last) {
      const seg = geom.dist(metric(idx, vs[i - 1]!.p.at), metric(idx, v.p.at));
      const d = geom.sub(metric(idx, v.p.at), metric(idx, vs[i - 1]!.p.at));
      const bearing = ((Math.atan2(d[0], d[1]) * 180) / Math.PI + 360) % 360;
      label = `${fmtLen(seg)} · ${Math.round(bearing)}° · totale ${fmtLen(geom.lengthOf(axis))}`;
    }
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...v.p.at] }, properties: { snap: v.p.kind === 'node' || v.p.kind === 'edge' || v.p.kind === 'midpoint', ...(label ? { label } : {}) } });
  });
  setSource('draft', fc(feats));
  useTool.setState({ measure: { total: geom.lengthOf(axis), area: null } });
}

function reset(): void {
  verts = []; drag = null; lastCursor = null;
  setSource('draft', null);
}

function finish(ctx: ToolContext): void {
  const idx = ctx.index();
  if (!idx) return;
  // A double-click also produced extra presses on the same spot: merge vertices closer than 30 cm.
  const vs = verts.filter((v, i, arr) => i === 0 || geom.dist(metric(idx, v.p.at), metric(idx, arr[i - 1]!.p.at)) > 0.3);
  if (vs.length < 2) { toast.info('Strada', 'Servono almeno due punti'); return; }
  const t = useTool.getState();
  const axis = axisOf(idx, vs).map((p) => idx.frame.toLngLat(p));
  const plan = planRoad(idx, vs.map((v) => v.p), axis, t.roadTemplate, t.roadName);
  if (plan.error) { toast.warn('Strada non creata', plan.error); return; }
  const curved = vs.some((v) => v.h);
  if (commit('batch', { label: curved ? 'Nuova strada in curva' : 'Nuova strada', ops: plan.ops }).ok) {
    const add = plan.ops.find((o) => o.type === 'road.add')!.payload as { road: { id: string } };
    select({ kind: 'road', ids: [add.road.id] });
    reset();
  }
}

function pointer(e: ToolEvent, ctx: ToolContext, idx: NetworkIndex): SnapResult {
  const prev = verts[verts.length - 1]?.p.at;
  const s = snap(ctx.map, idx, e.lngLat, { from: prev, disable: e.alt });
  return prev ? constrain(idx, prev, s, e.shift) : s;
}

export const roadPen: ToolHandler = {
  activate() { reset(); },
  deactivate() { reset(); },
  down(e, ctx) {
    if (e.button !== 0) return false;
    const idx = ctx.index();
    if (!idx) return false;
    verts = [...verts, { p: pointer(e, ctx, idx), h: null }];
    drag = { index: verts.length - 1, startPx: e.point };
    render(idx, null);
    return true; // own the drag: pulling out a tangent, not panning
  },
  move(e, ctx) {
    const idx = ctx.index();
    if (!idx) return;
    if (drag) {
      const moved = Math.hypot(e.point.x - drag.startPx.x, e.point.y - drag.startPx.y);
      const v = verts[drag.index]!;
      const h = moved > 5 ? geom.sub(metric(idx, e.lngLat), metric(idx, v.p.at)) : null;
      verts = verts.map((x, i) => (i === drag!.index ? { ...x, h } : x));
      render(idx, null);
      return;
    }
    lastCursor = pointer(e, ctx, idx);
    render(idx, verts.length ? lastCursor : null);
  },
  up() { drag = null; },
  dblclick(_e, ctx) { finish(ctx); },
  key(e, ctx) {
    const idx = ctx.index();
    if (e.key === 'Enter') { finish(ctx); return true; }
    if (e.key === 'Escape') { if (!verts.length) return false; reset(); return true; }
    if (e.key === 'Backspace') {
      verts = verts.slice(0, -1);
      if (idx) render(idx, verts.length ? lastCursor : null);
      return true;
    }
    return false;
  },
};
