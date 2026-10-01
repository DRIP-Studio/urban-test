import { geom, type Asset, type LngLat } from '@drip-urban/core';
import { fc } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, select, useApp } from '../state/store';
import type { NetworkIndex } from './snap';
import { useTool } from './toolState';
import type { ToolContext, ToolEvent, ToolHandler } from './types';

/** Snap to the nearest road edge within 6 m: anchor stays where the user points, rotation follows the road. */
function alignToRoad(idx: NetworkIndex, at: LngLat): { at: LngLat; bearing: number | null } {
  const p = idx.frame.toMetric(at) as geom.V;
  const r = idx.nearestRoad(p, 12);
  if (!r) return { at, bearing: null };
  const s = geom.sampleAt(idx.axis(r.id), r.along);
  return { at, bearing: (Math.atan2(s.t[0], s.t[1]) * 180) / Math.PI };
}

function ghost(idx: NetworkIndex, at: LngLat, w: number, d: number, rot: number) {
  const c = idx.frame.toMetric(at);
  const a = (-rot * Math.PI) / 180;
  const ring = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, y]) => {
    const ll = idx.frame.toLngLat([c[0] + x! * Math.cos(a) - y! * Math.sin(a), c[1] + x! * Math.sin(a) + y! * Math.cos(a)]);
    return [ll[0], ll[1]];
  });
  setSource('draft', fc([
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [...at] }, properties: { snap: true, label: `${Math.round(((rot % 360) + 360) % 360)}°` } },
  ]));
}

function makePlaceTool(kind: 'furniture' | 'sign'): ToolHandler {
  let autoBearing: number | null = null;
  const dims = () => {
    if (kind === 'sign') return { w: 0.9, d: 0.15 };
    const item = useApp.getState().catalogs?.furniture.items.find((i) => i.id === useTool.getState().furnitureId);
    return item ? { w: item.dims.w, d: item.dims.d } : { w: 1, d: 1 };
  };
  const rotation = () => useTool.getState().rotationDeg + (autoBearing ?? 0);
  const preview = (e: ToolEvent, ctx: ToolContext) => {
    const idx = ctx.index();
    if (!idx) return;
    const al = e.alt ? { at: e.lngLat, bearing: null } : alignToRoad(idx, e.lngLat);
    autoBearing = al.bearing === null ? null : Math.round(al.bearing) + 90;
    const { w, d } = dims();
    ghost(idx, al.at, w, d, rotation());
  };
  return {
    activate() { autoBearing = null; },
    deactivate() { setSource('draft', null); },
    move: preview,
    click(e, ctx) {
      const { network } = useApp.getState();
      if (!network) return;
      const t = useTool.getState();
      const type = kind === 'sign' ? t.signId : t.furnitureId;
      const props: Record<string, unknown> = {};
      const extraOps: { type: string; payload: unknown }[] = [];
      let at = e.lngLat;
      if (kind === 'sign') {
        // Alt-click on an existing sign: add a plate to the same pole (pole composer).
        const hit = ctx.map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['asset-pt-sign'].filter((l) => ctx.map.getLayer(l)) })[0];
        if (e.alt && hit) {
          const base = network.assets[String(hit.properties.id)];
          if (base) {
            const pole = (base.properties.poleId as string | undefined) ?? `pole-${base.id}`;
            const stack = Object.values(network.assets).filter((a) => a.properties.poleId === pole || a.id === base.id).length;
            at = base.at;
            props.poleId = pole;
            props.stackOrder = stack;
            if (!base.properties.poleId) extraOps.push({ type: 'asset.update', payload: { assetId: base.id, changes: { properties: { ...base.properties, poleId: pole, stackOrder: 0 } } } });
          }
        }
        useTool.setState((s) => ({ recentSigns: [type, ...s.recentSigns.filter((x) => x !== type)].slice(0, 12) }));
      }
      const asset: Asset = {
        id: newId('a'), type, at, rotationDeg: rotation(), state: 'project', properties: props,
        provenance: { kind: 'project', source: 'DRIP Urban scenario' },
      };
      const ok = extraOps.length
        ? commit('batch', { label: 'Aggiungi pannello al palo', ops: [...extraOps, { type: 'asset.add', payload: { assets: [asset] } }] }).ok
        : commit('asset.add', { assets: [asset] }).ok;
      if (ok) select({ kind: 'asset', ids: [asset.id] });
    },
    key(e) {
      if (e.key === 'q' || e.key === 'Q') { useTool.setState((s) => ({ rotationDeg: s.rotationDeg - 15 })); return true; }
      if (e.key === 'e' || e.key === 'E') { useTool.setState((s) => ({ rotationDeg: s.rotationDeg + 15 })); return true; }
      if (e.key === 'Escape') { setSource('draft', null); return false; }
    },
    wheel(e) {
      if (!e.shiftKey) return false;
      useTool.setState((s) => ({ rotationDeg: s.rotationDeg + (e.deltaY > 0 ? 5 : -5) }));
      return true;
    },
  };
}

export const furnitureTool = makePlaceTool('furniture');
export const signTool = makePlaceTool('sign');
