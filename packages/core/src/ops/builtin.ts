import type { Asset, Network, Oneway, Road } from '../model/types';
import { defineOperation, type Issue } from './registry';

const err = (code: string, message: string, targetIds?: string[]): Issue => ({
  code, severity: 'error', message, ...(targetIds ? { targetIds } : {}),
});

function withRoad(net: Network, road: Road): Network {
  return { ...net, roads: { ...net.roads, [road.id]: road } };
}

function withAssets(net: Network, assets: Record<string, Asset>): Network {
  return { ...net, assets };
}

function finiteLngLat(at: unknown): boolean {
  return (
    Array.isArray(at) && at.length === 2 &&
    Number.isFinite(at[0]) && Number.isFinite(at[1]) &&
    Math.abs(at[0] as number) <= 180 && Math.abs(at[1] as number) <= 90
  );
}

const ONEWAY_LABEL: Record<Oneway, string> = {
  no: 'doppio senso',
  forward: 'senso unico (verso asse)',
  backward: 'senso unico (verso opposto)',
};

export interface RoadUpdatePayload {
  readonly roadId: string;
  readonly changes: Partial<Pick<Road, 'name' | 'speedKmh' | 'roadClass' | 'surface'>>;
}

export const roadUpdate = defineOperation<RoadUpdatePayload>({
  type: 'road.update',
  label: (p) => `Modifica strada ${p.roadId}`,
  validate(net, p) {
    const issues: Issue[] = [];
    if (!net.roads[p.roadId]) issues.push(err('road.missing', `Strada ${p.roadId} inesistente`, [p.roadId]));
    const s = p.changes.speedKmh;
    if (s !== undefined && !(s > 0 && s <= 130)) issues.push(err('road.speed', 'Velocità fuori intervallo 1–130 km/h', [p.roadId]));
    if (p.changes.name !== undefined && !p.changes.name.trim()) issues.push(err('road.name', 'Il nome non può essere vuoto', [p.roadId]));
    return issues;
  },
  apply(net, p) {
    const road = net.roads[p.roadId]!;
    const provenance = { ...road.provenance };
    for (const key of Object.keys(p.changes)) provenance[key] = { kind: 'project', source: 'DRIP Urban scenario' };
    return withRoad(net, { ...road, ...p.changes, provenance });
  },
});

export interface RoadSetOnewayPayload {
  readonly roadId: string;
  readonly oneway: Oneway;
}

export const roadSetOneway = defineOperation<RoadSetOnewayPayload>({
  type: 'road.setOneway',
  label: (p) => `Senso di marcia: ${ONEWAY_LABEL[p.oneway]}`,
  validate(net, p) {
    return net.roads[p.roadId] ? [] : [err('road.missing', `Strada ${p.roadId} inesistente`, [p.roadId])];
  },
  apply(net, p) {
    const road = net.roads[p.roadId]!;
    // Lane directions follow the road direction: one-way roads have every lane
    // in the travel direction; two-way roads split them (right-hand traffic).
    const n = road.lanes.length;
    const lanes = road.lanes.map((lane, i) => ({
      ...lane,
      direction:
        p.oneway === 'forward' ? ('forward' as const)
        : p.oneway === 'backward' ? ('backward' as const)
        : i < Math.ceil(n / 2) ? ('forward' as const) : ('backward' as const),
    }));
    return withRoad(net, {
      ...road,
      oneway: p.oneway,
      lanes,
      provenance: { ...road.provenance, oneway: { kind: 'project', source: 'DRIP Urban scenario' } },
    });
  },
});

export interface AssetAddPayload {
  readonly assets: readonly Asset[];
}

export const assetAdd = defineOperation<AssetAddPayload>({
  type: 'asset.add',
  label: (p) => (p.assets.length === 1 ? `Aggiungi ${p.assets[0]!.type}` : `Aggiungi ${p.assets.length} oggetti`),
  validate(net, p) {
    const issues: Issue[] = [];
    if (p.assets.length === 0) issues.push(err('asset.empty', 'Nessun oggetto da aggiungere'));
    const seen = new Set<string>();
    for (const a of p.assets) {
      if (net.assets[a.id] || seen.has(a.id)) issues.push(err('asset.duplicateId', `Id già in uso: ${a.id}`, [a.id]));
      if (!finiteLngLat(a.at)) issues.push(err('asset.anchor', `Ancoraggio geografico non valido per ${a.id}`, [a.id]));
      if (!Number.isFinite(a.rotationDeg)) issues.push(err('asset.rotation', `Rotazione non valida per ${a.id}`, [a.id]));
      seen.add(a.id);
    }
    return issues;
  },
  apply(net, p) {
    const assets = { ...net.assets };
    for (const a of p.assets) assets[a.id] = { ...a, rotationDeg: ((a.rotationDeg % 360) + 360) % 360 };
    return withAssets(net, assets);
  },
});

export interface AssetUpdatePayload {
  readonly assetId: string;
  readonly changes: Partial<Omit<Asset, 'id' | 'provenance'>>;
}

export const assetUpdate = defineOperation<AssetUpdatePayload>({
  type: 'asset.update',
  label: (p) => `Modifica ${p.assetId}`,
  validate(net, p) {
    const issues: Issue[] = [];
    if (!net.assets[p.assetId]) issues.push(err('asset.missing', `Oggetto ${p.assetId} inesistente`, [p.assetId]));
    if (p.changes.at !== undefined && !finiteLngLat(p.changes.at)) issues.push(err('asset.anchor', 'Ancoraggio geografico non valido', [p.assetId]));
    if (p.changes.rotationDeg !== undefined && !Number.isFinite(p.changes.rotationDeg)) issues.push(err('asset.rotation', 'Rotazione non valida', [p.assetId]));
    return issues;
  },
  apply(net, p) {
    const prev = net.assets[p.assetId]!;
    const next: Asset = {
      ...prev,
      ...p.changes,
      rotationDeg: (((p.changes.rotationDeg ?? prev.rotationDeg) % 360) + 360) % 360,
      // Editing an existing (surveyed) asset turns it into a project decision.
      provenance: prev.state === 'existing' ? { kind: 'project', source: 'DRIP Urban scenario' } : prev.provenance,
    };
    return withAssets(net, { ...net.assets, [p.assetId]: next });
  },
});

export interface AssetRemovePayload {
  readonly assetIds: readonly string[];
}

export const assetRemove = defineOperation<AssetRemovePayload>({
  type: 'asset.remove',
  label: (p) => (p.assetIds.length === 1 ? `Elimina ${p.assetIds[0]}` : `Elimina ${p.assetIds.length} oggetti`),
  validate(net, p) {
    const missing = p.assetIds.filter((id) => !net.assets[id]);
    return missing.length ? [err('asset.missing', `Oggetti inesistenti: ${missing.join(', ')}`, missing)] : [];
  },
  apply(net, p) {
    const assets = { ...net.assets };
    for (const id of p.assetIds) {
      const a = assets[id]!;
      // Existing city assets are marked removed (the scenario shows the demolition);
      // project assets simply disappear.
      if (a.state === 'existing') assets[id] = { ...a, state: 'removed' };
      else delete assets[id];
    }
    return withAssets(net, assets);
  },
});
