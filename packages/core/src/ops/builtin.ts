import type { Asset, Network, Oneway, Road, RoadRestrictions, VerticalProfile } from '../model/types';
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

export interface RoadSetRestrictionsPayload {
  readonly roadIds: readonly string[];
  /** null removes the authored restrictions (OSM tags apply again); {} = explicitly unrestricted. */
  readonly restrictions: RoadRestrictions | null;
}

export const roadSetRestrictions = defineOperation<RoadSetRestrictionsPayload>({
  type: 'road.setRestrictions',
  label: (p) => (p.restrictions?.hgv === 'no' ? 'Divieto di transito mezzi pesanti' : p.restrictions?.motorVehicle === 'no' ? 'Divieto di transito' : p.restrictions ? 'Limitazioni di transito' : 'Rimuovi limitazioni'),
  validate(net, p) {
    const issues: Issue[] = [];
    const missing = p.roadIds.filter((id) => !net.roads[id]);
    if (!p.roadIds.length) issues.push(err('road.none', 'Nessuna strada'));
    if (missing.length) issues.push(err('road.missing', `Strade inesistenti: ${missing.join(', ')}`, missing));
    const r = p.restrictions;
    if (r) {
      const range = (v: number | undefined, lo: number, hi: number, what: string) => { if (v !== undefined && !(v >= lo && v <= hi)) issues.push(err('restriction.range', `${what} fuori intervallo ${lo}–${hi}`)); };
      range(r.maxWeightT, 1, 100, 'Massa massima (t)');
      range(r.maxAxleLoadT, 1, 20, 'Massa per asse (t)');
      range(r.maxHeightM, 1.5, 6, 'Altezza massima (m)');
      range(r.maxWidthM, 1, 5, 'Larghezza massima (m)');
      range(r.maxLengthM, 3, 30, 'Lunghezza massima (m)');
      for (const w of r.schedule ?? []) {
        if (!w.days.length || w.days.some((d) => !(d >= 0 && d <= 6))) issues.push(err('restriction.days', 'Giorni non validi (0 = lunedì … 6 = domenica)'));
        if (!/^\d{2}:\d{2}$/.test(w.from) || !/^\d{2}:\d{2}$/.test(w.to)) issues.push(err('restriction.time', 'Orari nel formato HH:MM'));
      }
    }
    return issues;
  },
  apply(net, p) {
    const roads = { ...net.roads };
    for (const id of p.roadIds) {
      const road = roads[id]!;
      const { restrictions: _old, ...rest } = road;
      roads[id] = {
        ...(p.restrictions ? { ...rest, restrictions: p.restrictions } : rest),
        provenance: { ...road.provenance, restrictions: { kind: 'project', source: 'DRIP Urban scenario' } },
      };
    }
    return { ...net, roads };
  },
});

export interface RoadSetVerticalPayload {
  readonly roadId: string;
  /** null removes the vertical alignment (the road follows the terrain again). */
  readonly vertical: VerticalProfile | null;
}

export const roadSetVertical = defineOperation<RoadSetVerticalPayload>({
  type: 'road.setVertical',
  label: (p) => (p.vertical ? 'Profilo longitudinale' : 'Rimuovi profilo longitudinale'),
  validate(net, p) {
    const issues: Issue[] = [];
    if (!net.roads[p.roadId]) return [err('road.missing', `Strada ${p.roadId} inesistente`, [p.roadId])];
    const v = p.vertical;
    if (v) {
      if (v.pvis.length < 2) issues.push(err('vertical.pvis', 'Servono almeno due vertici altimetrici'));
      v.pvis.forEach((q, i) => {
        if (!Number.isFinite(q.station) || !Number.isFinite(q.elevation) || q.elevation < -500 || q.elevation > 9000) issues.push(err('vertical.value', `Vertice ${i + 1}: progressiva o quota non valida`));
        if (i > 0 && !(q.station > v.pvis[i - 1]!.station)) issues.push(err('vertical.order', 'Le progressive devono essere crescenti'));
        if (q.curveLength !== undefined && !(q.curveLength >= 0 && q.curveLength <= 2000)) issues.push(err('vertical.curve', `Vertice ${i + 1}: raccordo non valido`));
      });
    }
    return issues;
  },
  apply(net, p) {
    const road = net.roads[p.roadId]!;
    const { vertical: _old, ...rest } = road;
    const next: Road = { ...(p.vertical ? { ...rest, vertical: p.vertical } : rest), provenance: { ...road.provenance, vertical: { kind: 'project', source: 'DRIP Urban scenario' } } };
    return { ...net, roads: { ...net.roads, [p.roadId]: next } };
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
