import { toast } from '../state/toasts';
import { zoneForPoint } from '../ztl/link';
import { geom, type Asset, type LngLat, type Network } from '@drip-urban/core';
import { fc } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { plateOnPoleOps } from '../state/actions';
import { commit, newId, select, useApp } from '../state/store';
import { objectSnap, type NetworkIndex } from './snap';
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
    const al = objectSnap(e) ? alignToRoad(idx, e.lngLat) : { at: e.lngLat, bearing: null };
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
      const at = e.lngLat;
      if (kind === 'sign') {
        // Click on an existing sign (Alt inverts the setting): the new plate goes under it, on the same pole.
        // A plate or the pole itself (its foot is the sign coordinate; plates are drawn above it).
        const hit = ctx.map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['asset-pt-sign', 'signs-3d', 'sign-poles-icon'].filter((l) => ctx.map.getLayer(l)) })[0];
        const baseId = hit ? signOnPole(network, String(hit.properties.id)) : null;
        if (baseId && (t.signStack !== e.alt)) {
          const r = plateOnPoleOps(baseId, type);
          if (r) {
            useTool.setState((s) => ({ recentSigns: [type, ...s.recentSigns.filter((x) => x !== type)].slice(0, 12) }));
            if (commit('batch', { label: 'Aggiungi pannello al palo', ops: r.ops }).ok) select({ kind: 'asset', ids: [r.asset.id] });
            return;
          }
        }
        useTool.setState((s) => ({ recentSigns: [type, ...s.recentSigns.filter((x) => x !== type)].slice(0, 12) }));
      }
      // Electronic ZTL gates and panels are linked to the ZTL they serve (state and timetable come from it).
      const item = kind === 'furniture' ? useApp.getState().catalogs?.furniture.items.find((i) => i.id === type) : undefined;
      if (item?.led?.kind === 'ztl' || type === 'it.sign.zona_traffico_limitato') {
        const z = zoneForPoint(network, at);
        if (z) props.zoneId = z.id;
        else if (item) toast.warn('Nessuna ZTL vicina', 'Il pannello resta «non collegato»: disegna la ZTL (strumento Zone) e collegalo dall\'Inspector.');
      }
      const asset: Asset = {
        id: newId('a'), type, at, rotationDeg: rotation(), state: 'project', properties: props,
        provenance: { kind: 'project', source: 'DRIP Urban scenario' },
      };
      if (type.startsWith('model:') && t.modelClear) {
        const { w, d } = dims();
        const idx = ctx.index();
        const clear = idx ? clearUnder(idx, at, w, d, rotation()) : null;
        if (clear?.buildings.length) extraOps.push({ type: 'building.remove', payload: { buildingIds: clear.buildings } });
        if (clear?.assets.length) extraOps.push({ type: 'asset.remove', payload: { assetIds: clear.assets } });
        if (clear && (clear.buildings.length || clear.assets.length)) {
          const ok = commit('batch', { label: 'Posa modello 3D e libera l\'area', ops: [...extraOps, { type: 'asset.add', payload: { assets: [{ id: newId('a'), type, at, rotationDeg: rotation(), state: 'project', properties: props, provenance: { kind: 'project', source: 'DRIP Urban scenario' } }] } }] }).ok;
          if (ok) toast.success('Modello posato', `${clear.buildings.length} edifici demoliti e ${clear.assets.length} elementi rimossi sotto il modello (ripristinabili dall'Inspector)`);
          return;
        }
      }
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

/** Sign id to stack under: a plate id as is, or the lowest plate of a pole feature (`pole:<poleId>`). */
function signOnPole(net: Network, id: string): string | null {
  if (!id.startsWith('pole:')) return net.assets[id] ? id : null;
  const pole = id.slice(5);
  const plates = Object.values(net.assets).filter((a) => a.type.startsWith('it.sign.') && a.state !== 'removed' && ((a.properties.poleId as string | undefined) ?? a.id) === pole);
  plates.sort((a, b) => Number(b.properties.stackOrder ?? 0) - Number(a.properties.stackOrder ?? 0));
  return plates[0]?.id ?? null;
}

/** Baseline buildings (overlap ≥ 25 %) and network assets inside the footprint of a model being placed. */
function clearUnder(idx: NetworkIndex, at: LngLat, w: number, d: number, rot: number): { buildings: string[]; assets: string[] } {
  const { baseline, network } = useApp.getState();
  if (!baseline || !network) return { buildings: [], assets: [] };
  const c = idx.frame.toMetric(at) as geom.V;
  const a = (-rot * Math.PI) / 180;
  const rect: geom.V[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [c[0] + x! * Math.cos(a) - y! * Math.sin(a), c[1] + x! * Math.sin(a) + y! * Math.cos(a)]);
  const reach = Math.hypot(w, d) / 2;
  const buildings: string[] = [];
  for (const b of Object.values(baseline.buildings)) {
    if (network.removedBuildings?.[b.id]) continue;
    const ring = b.footprint.map((p) => idx.frame.toMetric(p) as geom.V);
    if (ring.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) > reach + 60)) continue;
    const ab = Math.abs(geom.ringArea(ring));
    const inter = geom.polygonIntersectionArea(ring, rect);
    if (inter > 0.25 * Math.min(ab, w * d)) buildings.push(b.id);
  }
  const assets = Object.values(network.assets)
    .filter((x) => x.state !== 'removed' && !x.type.startsWith('model:') && geom.pointInRing(idx.frame.toMetric(x.at) as geom.V, rect))
    .map((x) => x.id);
  return { buildings, assets };
}
