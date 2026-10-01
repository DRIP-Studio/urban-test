import { LocalFrame, geom, type LngLat } from '@drip-urban/core';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { useApp } from '../state/store';
import { toast } from '../state/toasts';
import { spline } from './roadOps';
import { snap, type NetworkIndex, type SnapResult } from './snap';
import { resetDraft, useTool } from './toolState';
import type { ToolContext, ToolHandler } from './types';

export interface DrawSpec {
  readonly shape: 'line' | 'polygon';
  readonly minPoints: number;
  readonly maxPoints?: number;
  readonly curve?: boolean;
  readonly snapEnabled?: boolean;
  /** Preview stroke width in px (road tools show the real width instead when provided). */
  readonly previewWidth?: (idx: NetworkIndex) => number;
  finish(points: SnapResult[], idx: NetworkIndex, ctx: ToolContext): boolean;
}

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${m.toFixed(1).replace('.', ',')} m`);
const fmtArea = (m2: number) => (m2 >= 10000 ? `${(m2 / 10000).toFixed(2).replace('.', ',')} ha` : `${Math.round(m2).toLocaleString('it-IT')} m²`);

function render(spec: DrawSpec, idx: NetworkIndex, pts: SnapResult[], cursor: SnapResult | null): void {
  const all = cursor ? [...pts, cursor] : pts;
  const lls: LngLat[] = all.map((p) => p.at);
  const line = spec.curve && lls.length >= 3 ? spline(idx, lls) : lls;
  const f = idx.frame;
  const lenM = geom.lengthOf(line.map((p) => f.toMetric(p) as geom.V));
  let areaM2: number | null = null;
  const feats: Feature[] = [];
  if (line.length >= 2) {
    if (spec.shape === 'polygon' && line.length >= 3) {
      areaM2 = Math.abs(geom.ringArea(line.map((p) => f.toMetric(p) as geom.V)));
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...line.map((p) => [...p]), [...line[0]!]]] }, properties: {} });
    }
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line.map((p) => [...p]) }, properties: { width: spec.previewWidth ? spec.previewWidth(idx) : 2 } });
  }
  all.forEach((p, i) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...p.at] }, properties: {
    snap: p.kind === 'node' || p.kind === 'edge' || p.kind === 'midpoint',
    ...(i === all.length - 1 && all.length >= 2 ? { label: areaM2 !== null ? `${fmtLen(lenM)} · ${fmtArea(areaM2)}` : fmtLen(lenM) } : {}),
  } }));
  setSource('draft', fc(feats));
  useTool.setState({ measure: { total: lenM, area: areaM2 } });
}

export function makeDrawTool(spec: DrawSpec): ToolHandler {
  const finish = (ctx: ToolContext) => {
    const idx = ctx.index();
    if (!idx) return;
    // A double-click also produced two clicks: drop points closer than 30 cm to the previous one.
    const draft = useTool.getState().draft.filter((p, i, arr) => i === 0 || geom.dist(idx.frame.toMetric(p.at) as geom.V, idx.frame.toMetric(arr[i - 1]!.at) as geom.V) > 0.3);
    if (draft.length < spec.minPoints) { toast.info('Disegno incompleto', `Servono almeno ${spec.minPoints} punti`); return; }
    if (spec.finish(draft, idx, ctx)) { resetDraft(); setSource('draft', null); }
  };
  return {
    activate() { resetDraft(); },
    deactivate() { resetDraft(); setSource('draft', null); },
    move(e, ctx) {
      const idx = ctx.index();
      if (!idx) return;
      const { draft } = useTool.getState();
      const cursor = snap(ctx.map, idx, e.lngLat, { from: draft[draft.length - 1]?.at, disable: spec.snapEnabled === false || e.alt });
      useTool.setState({ cursor });
      render(spec, idx, draft, cursor);
    },
    click(e, ctx) {
      const idx = ctx.index();
      if (!idx) return;
      const { draft } = useTool.getState();
      const p = snap(ctx.map, idx, e.lngLat, { from: draft[draft.length - 1]?.at, disable: spec.snapEnabled === false || e.alt });
      const next = [...draft, p];
      useTool.setState({ draft: next });
      render(spec, idx, next, null);
      if (spec.maxPoints && next.length >= spec.maxPoints) finish(ctx);
    },
    dblclick(_e, ctx) { finish(ctx); },
    key(e, ctx) {
      if (e.key === 'Enter') { finish(ctx); return true; }
      if (e.key === 'Escape') { resetDraft(); setSource('draft', null); return true; }
      if (e.key === 'Backspace') {
        const idx = ctx.index();
        const d = useTool.getState().draft.slice(0, -1);
        useTool.setState({ draft: d });
        if (idx) render(spec, idx, d, useTool.getState().cursor);
        return true;
      }
    },
  };
}

/** Points every `spacing` metres along a drawn polyline (array / distribute). */
export function distribute(idx: NetworkIndex, line: readonly LngLat[], spacing: number): { at: LngLat; bearing: number }[] {
  const m = line.map((p) => idx.frame.toMetric(p) as geom.V);
  const L = geom.lengthOf(m);
  const n = Math.floor(L / spacing);
  const out: { at: LngLat; bearing: number }[] = [];
  const start = (L - n * spacing) / 2;
  for (let i = 0; i <= n; i++) {
    const s = geom.sampleAt(m, start + i * spacing);
    out.push({ at: idx.frame.toLngLat(s.p), bearing: (Math.atan2(s.t[0], s.t[1]) * 180) / Math.PI });
  }
  return out;
}

export function metricFrame(): LocalFrame | null {
  const b = useApp.getState().baseline;
  return b ? new LocalFrame(b.origin) : null;
}
