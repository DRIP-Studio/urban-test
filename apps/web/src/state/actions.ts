import { LocalFrame, type Area, type Asset, type LngLat } from '@drip-urban/core';
import { commit, newId, select, useApp } from './store';
import { toast } from './toasts';

const PROJECT = { kind: 'project' as const, source: 'DRIP Urban scenario' };

/** One delete for every entity kind. Existing city objects are marked removed (visible as demolition). */
export function deleteSelection(): void {
  const { selection, network } = useApp.getState();
  if (!selection || !network) return;
  const ids = selection.ids;
  let res = { ok: false };
  switch (selection.kind) {
    case 'asset': res = commit('asset.remove', { assetIds: ids.filter((id) => network.assets[id]) }); break;
    case 'area': res = commit('area.remove', { areaIds: ids.filter((id) => network.areas[id]) }); break;
    case 'road': res = commit('road.remove', { roadIds: ids.filter((id) => network.roads[id]) }); break;
    case 'roundabout': res = commit('roundabout.remove', { roundaboutId: ids[0] }); break;
    case 'zone': res = commit('batch', { label: 'Elimina zone', ops: ids.map((id) => ({ type: 'zone.remove', payload: { zoneId: id } })) }); break;
    case 'node': toast.info('Nodo', 'Un nodo si elimina eliminando le strade collegate.'); return;
  }
  if (res.ok) select(null);
}

let clipboard: { assets: Asset[]; areas: Area[]; anchor: LngLat } | null = null;

function offsetLL(frame: LocalFrame, p: LngLat, dx: number, dy: number): LngLat {
  const m = frame.toMetric(p);
  return frame.toLngLat([m[0] + dx, m[1] + dy]);
}

export function duplicateSelection(offsetM = 2): void {
  const { selection, network, baseline } = useApp.getState();
  if (!selection || !network || !baseline) return;
  const f = new LocalFrame(baseline.origin);
  if (selection.kind === 'asset') {
    const assets = selection.ids.map((id) => network.assets[id]).filter((a): a is Asset => !!a).map((a) => ({
      ...a, id: newId('a'), at: offsetLL(f, a.at, offsetM, -offsetM), state: 'project' as const, provenance: PROJECT,
      properties: { ...a.properties, ...(a.properties.poleId ? { poleId: `${a.properties.poleId}-c` } : {}) },
    }));
    if (commit('asset.add', { assets }).ok) select({ kind: 'asset', ids: assets.map((a) => a.id) });
  } else if (selection.kind === 'area') {
    const areas = selection.ids.map((id) => network.areas[id]).filter((a): a is Area => !!a).map((a) => ({
      ...a, id: newId('ar'), polygon: a.polygon.map((p) => offsetLL(f, p, offsetM, -offsetM)), state: 'project' as const, provenance: PROJECT,
    }));
    if (commit('batch', { label: 'Duplica superfici', ops: areas.map((area) => ({ type: 'area.set', payload: { area } })) }).ok) select({ kind: 'area', ids: areas.map((a) => a.id) });
  } else {
    toast.info('Duplica', 'Si duplicano oggetti e superfici. Per le strade usa lo strumento Strada.');
  }
}

export function copySelection(): void {
  const { selection, network } = useApp.getState();
  if (!selection || !network) return;
  const assets = selection.kind === 'asset' ? selection.ids.map((id) => network.assets[id]).filter((a): a is Asset => !!a) : [];
  const areas = selection.kind === 'area' ? selection.ids.map((id) => network.areas[id]).filter((a): a is Area => !!a) : [];
  if (!assets.length && !areas.length) return;
  clipboard = { assets, areas, anchor: assets[0]?.at ?? areas[0]!.polygon[0]! };
  toast.info('Copiato', `${assets.length + areas.length} elementi negli appunti`);
}

export function pasteAt(at: LngLat): void {
  const { baseline } = useApp.getState();
  if (!clipboard || !baseline) return;
  const f = new LocalFrame(baseline.origin);
  const a0 = f.toMetric(clipboard.anchor), t = f.toMetric(at);
  const dx = t[0] - a0[0], dy = t[1] - a0[1];
  const assets = clipboard.assets.map((a) => ({ ...a, id: newId('a'), at: offsetLL(f, a.at, dx, dy), state: 'project' as const, provenance: PROJECT }));
  const areas = clipboard.areas.map((a) => ({ ...a, id: newId('ar'), polygon: a.polygon.map((p) => offsetLL(f, p, dx, dy)), state: 'project' as const, provenance: PROJECT }));
  const ops = [...(assets.length ? [{ type: 'asset.add', payload: { assets } }] : []), ...areas.map((area) => ({ type: 'area.set', payload: { area } }))];
  if (ops.length && commit('batch', { label: 'Incolla', ops }).ok) select(assets.length ? { kind: 'asset', ids: assets.map((a) => a.id) } : { kind: 'area', ids: areas.map((a) => a.id) });
}

export function moveAssets(ids: readonly string[], dx: number, dy: number): void {
  const { network, baseline } = useApp.getState();
  if (!network || !baseline || !ids.length) return;
  const f = new LocalFrame(baseline.origin);
  const ops = ids.filter((id) => network.assets[id]).map((id) => ({ type: 'asset.update', payload: { assetId: id, changes: { at: offsetLL(f, network.assets[id]!.at, dx, dy) } } }));
  if (ops.length) commit('batch', { label: ops.length === 1 ? 'Sposta oggetto' : `Sposta ${ops.length} oggetti`, ops });
}

export function rotateAssets(ids: readonly string[], deg: number): void {
  const { network } = useApp.getState();
  if (!network) return;
  const ops = ids.filter((id) => network.assets[id]).map((id) => ({ type: 'asset.update', payload: { assetId: id, changes: { rotationDeg: network.assets[id]!.rotationDeg + deg } } }));
  if (ops.length) commit('batch', { label: 'Ruota', ops });
}

/**
 * Operations that add a sign plate under the existing plates of a pole (CdS: max 3 signals per pole,
 * the most important on top). `baseId` is any sign already on the pole.
 */
export function plateOnPoleOps(baseId: string, type: string): { ops: { type: string; payload: unknown }[]; asset: Asset } | null {
  const { network } = useApp.getState();
  const base = network?.assets[baseId];
  if (!network || !base) return null;
  const pole = (base.properties.poleId as string | undefined) ?? `pole-${base.id}`;
  const plates = Object.values(network.assets).filter((a) => a.state !== 'removed' && (a.properties.poleId === pole || a.id === base.id));
  const ops: { type: string; payload: unknown }[] = [];
  if (!base.properties.poleId) ops.push({ type: 'asset.update', payload: { assetId: base.id, changes: { properties: { ...base.properties, poleId: pole, stackOrder: 0 } } } });
  const asset: Asset = {
    id: newId('a'), type, at: base.at, rotationDeg: base.rotationDeg, state: 'project',
    properties: { poleId: pole, stackOrder: plates.length }, provenance: PROJECT,
  };
  ops.push({ type: 'asset.add', payload: { assets: [asset] } });
  return { ops, asset };
}

/** Plates on the same pole, top first. */
export function polePlates(assetId: string): Asset[] {
  const { network } = useApp.getState();
  const a = network?.assets[assetId];
  if (!network || !a) return [];
  const pole = a.properties.poleId as string | undefined;
  if (!pole) return [a];
  return Object.values(network.assets).filter((x) => x.properties.poleId === pole && x.state !== 'removed')
    .sort((x, y) => ((x.properties.stackOrder as number) ?? 0) - ((y.properties.stackOrder as number) ?? 0));
}

/** Moves a plate up (-1) or down (+1) on its pole by swapping stack order with the neighbour. */
export function movePlate(assetId: string, dir: -1 | 1): void {
  const plates = polePlates(assetId);
  const i = plates.findIndex((p) => p.id === assetId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= plates.length) return;
  const reorder = [...plates];
  [reorder[i], reorder[j]] = [reorder[j]!, reorder[i]!];
  commit('batch', { label: 'Ordine dei pannelli sul palo', ops: reorder.map((p, k) => ({ type: 'asset.update', payload: { assetId: p.id, changes: { properties: { ...p.properties, stackOrder: k } } } })) });
}
