import { LocalFrame, type Asset, type LngLat } from '@drip-urban/core';
import { commit, newId, select, useApp } from '../state/store';
import { useMapUi } from '../map/mapStore';

export type TransformAxis = 'x' | 'y' | 'z' | 'rotation';
export function selectedTwinAssets(): Asset[] {
  const { selection, network } = useApp.getState();
  if (selection?.kind !== 'asset' || !network) return [];
  const chosen = selection.ids.flatMap(id => network.assets[id]?.state !== 'removed' && network.assets[id] ? [network.assets[id]!] : []);
  const groups=new Set(chosen.map(a=>a.properties.groupId).filter(Boolean));
  const poles = new Set(chosen.filter(a => a.type.startsWith('it.sign.')).map(a => a.properties.poleId).filter(Boolean));
  return Object.values(network.assets).filter(a => a.state !== 'removed' && (selection.ids.includes(a.id) || groups.has(a.properties.groupId) || (a.type.startsWith('it.sign.') && poles.has(a.properties.poleId))));
}
export function transformedAssets(assets: readonly Asset[], origin: LngLat, axis: TransformAxis, delta: number, precise = false): Asset[] {
  const frame = new LocalFrame(origin), settings = useMapUi.getState();
  if (settings.snapEnabled && !precise) {
    const increment = axis === 'rotation' ? settings.snap.angle ? 15 : 0 : settings.snap.grid ? settings.gridM : 0;
    if (increment > 0) delta = Math.round(delta / increment) * increment;
  }
  return assets.map((asset) => {
    if (axis === 'rotation') {
      const centre=assets.reduce((v,a)=>{const q=frame.toMetric(a.at);return[v[0]!+q[0]/assets.length,v[1]!+q[1]/assets.length];},[0,0]);
      const q=frame.toMetric(asset.at),x=q[0]-centre[0]!,y=q[1]-centre[1]!,t=-delta*Math.PI/180;
      return {...asset,at:frame.toLngLat([centre[0]!+x*Math.cos(t)-y*Math.sin(t),centre[1]!+x*Math.sin(t)+y*Math.cos(t)]),rotationDeg:((asset.rotationDeg+delta)%360+360)%360};
    }
    if (axis === 'z') return { ...asset, elevationM: (asset.elevationM ?? 0) + delta };
    const p = frame.toMetric(asset.at);
    return { ...asset, at: frame.toLngLat([p[0] + (axis === 'x' ? delta : 0), p[1] + (axis === 'y' ? delta : 0)]) };
  });
}
export function applyTwinTransform(assets: readonly Asset[], label = 'Trasforma oggetti nel Twin') {
  return commit('batch', { label, ops: assets.map((asset) => ({ type: 'asset.update', payload: { assetId: asset.id, changes: { at: asset.at, rotationDeg: asset.rotationDeg, elevationM: asset.elevationM, scale: asset.scale } } })) });
}
export function duplicateTwinSelection() {
  const state = useApp.getState(), assets = selectedTwinAssets();
  if (!state.baseline || !assets.length) return;
  const moved = transformedAssets(assets, state.baseline.origin, 'x', 3, true);
  const poles = new Map<string, string>(),groups=new Map<string,string>();
  const copies = moved.map((asset) => {
    const group=asset.properties.groupId;if(typeof group==='string'&&!groups.has(group))groups.set(group,newId('group'));
    const pole = asset.properties.poleId;
    if (typeof pole === 'string' && !poles.has(pole)) poles.set(pole, newId('pole'));
    return { ...asset, id: newId('asset'), state: 'project' as const, provenance: { kind: 'project' as const, source: 'DRIP Urban Twin' }, properties: { ...asset.properties, ...(typeof group==='string'?{groupId:groups.get(group)}:{}), ...(typeof pole === 'string' ? { poleId: poles.get(pole) } : {}) } };
  });
  if (commit('asset.add', { assets: copies }).ok) select({ kind: 'asset', ids: copies.map((a) => a.id) });
}
