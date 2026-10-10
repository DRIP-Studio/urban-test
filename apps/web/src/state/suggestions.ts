import { create } from 'zustand';
import {
  LocalFrame, geom, humpLimits, layoutSection, zoneGates,
  type Asset, type LngLat, type Network, type Road, type Zone,
} from '@drip-urban/core';
import { commit, newId, onCommit, openDock, select, useApp } from './store';
import { toast } from './toasts';
import { describeSchedule } from '../ui/ScheduleEditor';

/**
 * Action suggestions after an edit: the next steps a designer would take, each with its norm and a
 * one-click action. Suggestions are computed from the network diff of the edit (not on undo/redo) and
 * disappear when no longer relevant (e.g. the sidewalk was added by hand).
 */
export interface Suggestion {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly ref?: string;
  readonly icon: string;
  readonly at?: LngLat;
  readonly actions: readonly { readonly label: string; readonly run: () => void; readonly primary?: boolean }[];
  /** Still relevant on this network? */
  readonly valid: (net: Network) => boolean;
}

interface SuggestState { items: Suggestion[]; enabled: boolean; dismissed: Set<string>; folded: boolean }
export const useSuggest = create<SuggestState>(() => ({ items: [], enabled: true, dismissed: new Set(), folded: false }));
export const toggleSuggestionsFolded = () => useSuggest.setState((s) => ({ folded: !s.folded }));

const PROJECT = { kind: 'project' as const, source: 'DRIP Urban scenario' };
const MAX = 4;
const VEHICULAR = (r: Road) => r.lanes.some((l) => l.modes.includes('car'));
const URBAN_FAST = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

export function dismissSuggestion(key: string): void {
  useSuggest.setState((s) => ({ items: s.items.filter((x) => x.key !== key), dismissed: new Set(s.dismissed).add(key) }));
}
/** All suggested project changes use the same validated, undoable commit boundary. */
export function applySuggestion(key: string | null, label: string, ops: readonly { type: string; payload: unknown }[]): boolean {
  if (!ops.length) { toast.warn('Azione non applicabile', 'Non ci sono elementi validi da modificare.'); return false; }
  const result = commit('batch', { label, ops });
  if (!result.ok) return false;
  if (key) dismissSuggestion(key);
  toast.success(label, 'Modifica applicata allo scenario · Ctrl+Z per annullare.');
  return true;
}
export function clearSuggestions(): void { useSuggest.setState({ items: [] }); }
export function setSuggestionsEnabled(enabled: boolean): void { useSuggest.setState({ enabled, ...(enabled ? {} : { items: [] }) }); }

const done = (key: string) => () => dismissSuggestion(key);
const frame = () => new LocalFrame(useApp.getState().baseline!.origin);
const bearing = (v: geom.V) => (Math.atan2(v[0], v[1]) * 180) / Math.PI;

function sign(type: string, at: LngLat, faceDeg: number, extra: Record<string, unknown> = {}): Asset {
  return { id: newId('a'), type, at, rotationDeg: faceDeg, state: 'project', properties: { poleId: newId('pole'), stackOrder: 0, ...extra }, provenance: PROJECT };
}

/** Signs on the right kerb of each travel direction, `distM` before the station (art. 77–81 Reg.). */
function approachSigns(net: Network, road: Road, station: number, distM: number, type: string, extra: Record<string, unknown> = {}): Asset[] {
  const f = frame();
  const axis = road.axis.map((p) => f.toMetric(p) as geom.V);
  const len = geom.lengthOf(axis);
  const lay = layoutSection(road);
  const out: Asset[] = [];
  const dirs: (1 | -1)[] = road.oneway === 'forward' ? [1] : road.oneway === 'backward' ? [-1] : [1, -1];
  for (const d of dirs) {
    const s = Math.max(0.5, Math.min(len - 0.5, station - d * distM));
    const { p, t } = geom.sampleAt(axis, s);
    const n: geom.V = [-t[1], t[0]];
    const off = d === 1 ? lay.cwRight - 0.6 : lay.cwLeft + 0.6;
    const at: geom.V = [p[0] + n[0] * off, p[1] + n[1] * off];
    out.push(sign(type, f.toLngLat(at), bearing([-t[0] * d, -t[1] * d]), extra));
  }
  void net;
  return out;
}

function sidewalkOp(road: Road, widthM: number): { type: string; payload: unknown } {
  const els = road.section.elements;
  const has = (side: 0 | 1) => (side === 0 ? els[0] : els[els.length - 1])?.kind === 'sidewalk';
  const sw = (s: string) => ({ id: `${road.id}:sw${s}-${newId('e')}`, kind: 'sidewalk' as const, widthM });
  const elements = [...(has(0) ? [] : [sw('l')]), ...els, ...(has(1) ? [] : [sw('r')])];
  return { type: 'road.setSection', payload: { roadId: road.id, lanes: road.lanes, section: { elements } } };
}

/** ZTL / pedestrian / school zones: electronic gate with LED panel and the zone sign at each entry. */
export function generateZoneGates(zone: Zone): number {
  const { network: net, baseline } = useApp.getState();
  const found = zoneGates(net!, baseline!.origin, zone).filter((g) => g.entry);
  if (!found.length) { toast.warn('Nessun ingresso', 'Nessuna strada veicolare entra nella zona.'); return 0; }
  const old = Object.values(net!.assets).filter((a) => a.properties.zoneId === zone.id && a.state !== 'removed');
  const assets: Asset[] = [];
  const signType = zone.kind === 'zone30' ? 'it.sign.zona_30_kmh' : zone.kind === 'pedestrian' ? 'it.sign.area_pedonale' : 'it.sign.zona_traffico_limitato';
  for (const g of found) {
    const pole = newId('pole');
    if (zone.kind !== 'zone30') assets.push({ id: newId('a'), type: 'ztl.gate', at: g.at, rotationDeg: g.bearingDeg, state: 'project', properties: { zoneId: zone.id, roadId: g.roadId, label: `Varco ${g.roadName || ''}`.trim() }, provenance: PROJECT });
    assets.push({ id: newId('a'), type: signType, at: g.at, rotationDeg: g.bearingDeg, state: 'project', properties: { zoneId: zone.id, poleId: pole, stackOrder: 0, note: describeSchedule(zone.schedule) }, provenance: PROJECT });
  }
  const ops: { type: string; payload: unknown }[] = [];
  if (old.length) ops.push({ type: 'asset.remove', payload: { assetIds: old.map((a) => a.id) } });
  ops.push({ type: 'asset.add', payload: { assets } });
  if (!applySuggestion(null, `Varchi ${zone.name}`, ops)) return 0;
  toast.success(zone.kind === 'zone30' ? 'Segnali Zona 30 posizionati' : 'Varchi generati', `${found.length} ingressi`);
  return found.length;
}

// ------------------------------------------------------------------ rules

/** Names of the other roads meeting at a node, for titles like «Incrocio con Via Roma». */
function otherNames(net: Network, nodeId: string, roadId: string): string {
  const names = [...new Set(Object.values(net.roads).filter((r) => r.id !== roadId && (r.from === nodeId || r.to === nodeId) && r.name).map((r) => r.name))];
  return names.length ? names.slice(0, 2).join(' e ') : '';
}

/**
 * A drawn road arrives as several pieces (it is split where it crosses other roads): sidewalk and speed
 * advice is one card for all of them, and its action applies to every piece.
 */
function forNewRoads(roads: readonly Road[]): Suggestion[] {
  const out: Suggestion[] = [];
  if (!roads.length) return out;
  const f = frame();
  const longest = roads.reduce((a, b) => (geom.lengthOf(b.axis.map((p) => f.toMetric(p) as geom.V)) > geom.lengthOf(a.axis.map((p) => f.toMetric(p) as geom.V)) ? b : a));
  const axis = longest.axis.map((p) => f.toMetric(p) as geom.V);
  const at = f.toLngLat(geom.sampleAt(axis, geom.lengthOf(axis) / 2).p);
  const ids = roads.map((r) => r.id);
  const label = longest.name || 'La nuova strada';
  const noWalk = roads.filter((r) => VEHICULAR(r) && !r.section.elements.some((e) => e.kind === 'sidewalk') && !URBAN_FAST.has(r.roadClass));
  if (noWalk.length) {
    const key = `sw:${ids.join(',')}`;
    out.push({
      key, icon: 'section', at, title: 'Aggiungi i marciapiedi', ref: 'DM 5/11/2001 · DM 236/1989',
      detail: `${longest.name ? `«${longest.name}»` : label} non ha marciapiedi: in ambito urbano servono su entrambi i lati, larghezza ≥ 1,50 m (percorso accessibile).`,
      actions: [{ label: 'Aggiungi 1,50 m per lato', primary: true, run: () => {
        const net = useApp.getState().network!;
        const ops = noWalk.map((r) => net.roads[r.id]).filter((r): r is Road => !!r).map((r) => sidewalkOp(r, 1.5));
        if (!ops.length) { toast.warn('Strade non disponibili', 'La nuova strada è stata rimossa o sostituita.'); return; }
        applySuggestion(key, 'Marciapiedi sulla nuova strada', ops);
      } }, { label: 'Ignora', run: done(key) }],
      valid: (n) => noWalk.some((r) => n.roads[r.id] && !n.roads[r.id]!.section.elements.some((e) => e.kind === 'sidewalk')),
    });
  }
  const fast = roads.filter((r) => VEHICULAR(r) && r.speedKmh > 50 && !URBAN_FAST.has(r.roadClass));
  if (fast.length) {
    const key = `v50:${ids.join(',')}`;
    out.push({
      key, icon: 'warning', at, title: `Limite ${fast[0]!.speedKmh} km/h in ambito urbano`, ref: 'art. 142 CdS',
      detail: 'Nei centri abitati il limite generale è 50 km/h; limiti superiori (fino a 70) solo su strade con caratteristiche adeguate.',
      actions: [{ label: 'Porta a 50 km/h', primary: true, run: () => {
        const n = useApp.getState().network!;
        const ops = fast.filter((r) => (n.roads[r.id]?.speedKmh ?? 0) > 50).map((r) => ({ type: 'road.update', payload: { roadId: r.id, changes: { speedKmh: 50 } } }));
        if (!ops.length) { dismissSuggestion(key); return; }
        applySuggestion(key, 'Limite 50 km/h', ops);
      } }, { label: 'Ignora', run: done(key) }],
      valid: (n) => fast.some((r) => (n.roads[r.id]?.speedKmh ?? 0) > 50),
    });
  }
  return out;
}

/** Junctions created by a new road. */
function forRoad(net: Network, road: Road): Suggestion[] {
  const out: Suggestion[] = [];
  for (const nodeId of [road.from, road.to]) {
    const arms = Object.values(net.roads).filter((r) => r.from === nodeId || r.to === nodeId).length;
    if (arms < 3 || net.junctions[nodeId]) continue;
    const key = `jn:${nodeId}`;
    const withName = otherNames(net, nodeId, road.id);
    out.push({
      key, icon: 'junction', at: net.nodes[nodeId]?.at, title: withName ? `Regola l'incrocio con ${withName}` : 'Regola il nuovo incrocio', ref: 'artt. 145, 37 CdS',
      detail: `Incrocio a ${arms} rami senza regolazione: precedenza a destra. Imposta dare precedenza o STOP sulla strada nuova, una rotatoria o un impianto semaforico.`,
      actions: [
        { label: 'Dare precedenza sulla nuova', primary: true, run: () => {
          // Every new tract reaching the node yields (a road drawn across arrives as two pieces).
          const n = useApp.getState().network!;
          const minor = Object.values(n.roads).filter((r) => (r.from === nodeId || r.to === nodeId) && r.provenance.geometry?.kind === 'project' && !r.tags?.roundabout).map((r) => r.id);
          const prev = n.junctions[nodeId];
          applySuggestion(key, 'Dare precedenza sulla nuova strada', [{ type: 'junction.set', payload: { spec: { nodeId, control: 'priority', cornerRadiusM: prev?.cornerRadiusM ?? 6, minorRoadIds: minor.length ? minor : [road.id], crossingRoadIds: prev?.crossingRoadIds ?? [], ...(prev?.laneConnections ? { laneConnections: prev.laneConnections } : {}) } } }]);
        } },
        { label: 'Apri incrocio', run: () => { select({ kind: 'node', ids: [nodeId] }); dismissSuggestion(key); } },
      ],
      valid: (n) => !n.junctions[nodeId],
    });
  }
  return out;
}

/** A crossing drawn as an area or as a horizontal marking (zebra, bike crossing): same advice. */
interface CrossingSource { readonly id: string; readonly polygon: readonly LngLat[]; readonly exists: (n: Network) => boolean }

function forCrossing(net: Network, a: CrossingSource): Suggestion[] {
  if (a.polygon.length < 2) return [];
  const f = frame();
  const c: geom.V = (() => { const p = f.toMetric(a.polygon[0]!), q = f.toMetric(a.polygon[1]!); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; })();
  let best: { road: Road; along: number; d: number } | null = null;
  for (const r of Object.values(net.roads)) {
    if (!VEHICULAR(r)) continue;
    const pr = geom.project(r.axis.map((p) => f.toMetric(p) as geom.V), c);
    if (pr.d < 8 && (!best || pr.d < best.d)) best = { road: r, along: pr.along, d: pr.d };
  }
  if (!best) return [];
  const { road, along } = best;
  const out: Suggestion[] = [];
  const kSign = `xs:${a.id}`;
  out.push({
    key: kSign, icon: 'sign', at: f.toLngLat(c), title: 'Segnala l\'attraversamento', ref: 'art. 135 Reg. fig. II.303 · art. 88 fig. II.14',
    detail: 'Segnale di indicazione «attraversamento pedonale» su entrambi i lati; su strade veloci o poco visibili anche il pericolo (fig. II.14) a 150 m fuori dai centri, 50 m in città.',
    actions: [{ label: 'Posiziona i segnali', primary: true, run: () => {
      const n = useApp.getState().network!, cur = n.roads[road.id] ?? road;
      applySuggestion(kSign, 'Segnali attraversamento', [{ type: 'asset.add', payload: { assets: approachSigns(n, cur, along, 1, 'it.sign.attraversamento_pedonale', { crossingId: a.id }) } }]);
    } }, { label: 'Ignora', run: done(kSign) }],
    valid: (n) => a.exists(n) && !Object.values(n.assets).some((x) => x.properties.crossingId === a.id),
  });
  if (road.speedKmh <= 50 && !Object.values(net.features ?? {}).some((x) => x.roadId === road.id && Math.abs((x.station ?? 0) - along) < 6)) {
    const key = `xr:${a.id}`;
    out.push({
      key, icon: 'calming', at: f.toLngLat(c), title: 'Rialza l\'attraversamento', ref: 'art. 179 Reg. · DM 236/1989',
      detail: 'Su strade urbane fino a 50 km/h l\'attraversamento rialzato abbassa le velocità e dà continuità al percorso pedonale senza rampe.',
      actions: [{ label: 'Rialza (10 cm, rampe 1,20 m)', primary: true, run: () => {
        if (!useApp.getState().network!.roads[road.id]) { toast.warn('Strada modificata', "La strada dell'attraversamento è stata cambiata: rialzalo con lo strumento Moderazione (D)."); dismissSuggestion(key); return; }
        applySuggestion(key, 'Attraversamento rialzato', [{ type: 'feature.set', payload: { feature: { id: newId('f'), kind: 'raised_crossing', roadId: road.id, station: Math.round(along * 10) / 10, lengthM: 4, rampM: 1.2, heightM: 0.1, state: 'project', properties: {}, provenance: PROJECT } } }]);
      } }, { label: 'Ignora', run: done(key) }],
      valid: (n) => a.exists(n),
    });
  }
  return out;
}

function forZone(zone: Zone): Suggestion[] {
  if (zone.kind === 'parking') return [];
  const key = `zg:${zone.id}`;
  const gated = zone.kind === 'ztl' || zone.kind === 'pedestrian' || zone.kind === 'school' || zone.kind === 'low_emission';
  const out: Suggestion[] = [{
    key, icon: gated ? 'led' : 'sign', at: zone.polygon[0], title: gated ? 'Varchi elettronici agli ingressi' : 'Segnali Zona 30 agli ingressi', ref: gated ? 'art. 7 c. 9 e 133-bis CdS · DPR 250/1999' : 'art. 135 Reg. fig. II.323/a',
    detail: gated ? 'Ogni ingresso veicolare della zona richiede un varco con pannello «varco attivo/non attivo» e il segnale di inizio zona con gli orari.' : 'Segnale di inizio Zona 30 a ogni ingresso; valuta interventi di moderazione sulle strade interne.',
    actions: [{ label: gated ? 'Genera i varchi' : 'Posiziona i segnali', primary: true, run: () => { const z = useApp.getState().network!.zones[zone.id]; if (z && generateZoneGates(z)) dismissSuggestion(key); } }, { label: 'Ignora', run: done(key) }],
    valid: (n) => !!n.zones[zone.id] && !Object.values(n.assets).some((a) => a.properties.zoneId === zone.id && a.state !== 'removed'),
  }];
  if (zone.kind === 'zone30' || zone.kind === 'school') {
    const k2 = `zc:${zone.id}`;
    out.push({
      key: k2, icon: 'calming', at: zone.polygon[0], title: 'Moderazione nelle strade interne', ref: 'art. 179 Reg. CdS',
      detail: 'Porta a 30 km/h le strade interne alla zona e aggiungi piattaforme rialzate ogni 80–100 m.',
      actions: [{ label: 'Limite 30 km/h all\'interno', primary: true, run: () => {
        const n = useApp.getState().network!;
        const f = frame();
        const poly = zone.polygon.map((p) => f.toMetric(p) as geom.V);
        const ops = Object.values(n.roads).filter((r) => VEHICULAR(r) && r.speedKmh > 30 && geom.pointInRing(geom.sampleAt(r.axis.map((p) => f.toMetric(p) as geom.V), geom.lengthOf(r.axis.map((p) => f.toMetric(p) as geom.V)) / 2).p, poly))
          .map((r) => ({ type: 'road.update', payload: { roadId: r.id, changes: { speedKmh: 30 } } }));
        if (!ops.length) { toast.info('Nessuna strada da modificare', 'Non ci sono strade veicolari oltre 30 km/h all’interno della zona.'); dismissSuggestion(k2); return; }
        applySuggestion(k2, `Zona 30 · ${zone.name}`, ops);
      } }, { label: 'Ignora', run: done(k2) }],
      valid: (n) => !!n.zones[zone.id],
    });
  }
  return out;
}

function forFeature(net: Network, id: string): Suggestion[] {
  const ft = net.features![id]!;
  const road = ft.roadId ? net.roads[ft.roadId] : undefined;
  if (!road || ft.kind === 'raised_crossing' || ft.kind === 'rumble_strips') return [];
  const key = `fs:${id}`;
  const out: Suggestion[] = [{
    key, icon: 'sign', title: 'Segnale di preavviso «dosso»', ref: 'art. 85 Reg. fig. II.2 · art. 179 c. 7',
    detail: 'I rallentatori vanno presegnalati con il segnale di pericolo «dosso» prima dell\'elemento, in entrambi i sensi di marcia.',
    actions: [{ label: 'Posiziona a 30 m', primary: true, run: () => {
      const n = useApp.getState().network!, f = n.features?.[id], cur = f?.roadId ? n.roads[f.roadId] : undefined;
      if (!f || !cur) { toast.warn('Elemento non disponibile', 'Il dosso o la strada sono stati rimossi.'); return; }
      applySuggestion(key, 'Preavviso dosso', [{ type: 'asset.add', payload: { assets: approachSigns(n, cur, f.station ?? 0, 30, 'it.sign.dosso', { featureId: id }) } }]);
    } }, { label: 'Ignora', run: done(key) }],
    valid: (n) => !!n.features?.[id] && !Object.values(n.assets).some((a) => a.properties.featureId === id),
  }];
  if ((ft.kind === 'speed_hump' || ft.kind === 'speed_cushion') && road.speedKmh > 30 && humpLimits(30)) {
    const k2 = `fv:${id}`;
    out.push({
      key: k2, icon: 'warning', title: 'Abbassa il limite a 30 km/h', ref: 'art. 179 c. 6 Reg.',
      detail: `Con ${road.speedKmh} km/h il dosso è limitato a ${Math.round((humpLimits(road.speedKmh)?.maxHeightM ?? 0) * 100)} cm; a 30 km/h può arrivare a 7 cm ed è più efficace.`,
      actions: [{ label: 'Imposta 30 km/h', primary: true, run: () => { applySuggestion(k2, 'Limite 30 km/h', [{ type: 'road.update', payload: { roadId: road.id, changes: { speedKmh: 30 } } }]); } }, { label: 'Ignora', run: done(k2) }],
      valid: (n) => (n.roads[road.id]?.speedKmh ?? 0) > 30 && !!n.features?.[id],
    });
  }
  return out;
}

function forSignals(net: Network, nodeId: string): Suggestion[] {
  const f = frame();
  const here = net.nodes[nodeId]?.at;
  if (!here) return [];
  const near = Object.keys(net.signalPlans).filter((id) => id !== nodeId && net.nodes[id] && geom.dist(f.toMetric(net.nodes[id]!.at) as geom.V, f.toMetric(here) as geom.V) < 400);
  if (!near.length) return [];
  const key = `sc:${nodeId}`;
  return [{
    key, icon: 'signal', at: here, title: 'Coordina con gli impianti vicini', ref: 'Direttiva LL.PP. 12/4/1995 (PUT)',
    detail: `${near.length} impianti semaforici entro 400 m: un'onda verde sull'asse riduce arresti e code.`,
    actions: [{ label: 'Apri coordinamento', primary: true, run: () => { select({ kind: 'node', ids: [nodeId] }); openDock('signals'); dismissSuggestion(key); } }, { label: 'Ignora', run: done(key) }],
    valid: (n) => !!n.signalPlans[nodeId],
  }];
}

const added = <T>(a: Readonly<Record<string, T>> | undefined, b: Readonly<Record<string, T>> | undefined) => Object.keys(b ?? {}).filter((k) => !a?.[k]);

/**
 * A piece of an existing road cut by the edit (a new road crossing it): same name and section as a road
 * that disappeared, every vertex on that road's axis. It is not a new road: no "new road" advice for it.
 */
function isSplitPiece(before: Network, after: Network, r: Road): boolean {
  const f = frame();
  for (const id of Object.keys(before.roads)) {
    if (after.roads[id]) continue;
    const old = before.roads[id]!;
    if (old.name !== r.name || old.roadClass !== r.roadClass) continue;
    const axis = old.axis.map((p) => f.toMetric(p) as geom.V);
    if (r.axis.every((p) => geom.project(axis, f.toMetric(p) as geom.V).d < 0.5)) return true;
  }
  return false;
}

export function suggestFor(before: Network, after: Network): Suggestion[] {
  const out: Suggestion[] = [];
  const fresh = added(before.roads, after.roads).map((id) => after.roads[id]!)
    .filter((r) => !r.tags?.roundabout && r.provenance.geometry?.kind === 'project' && !isSplitPiece(before, after, r));
  out.push(...forNewRoads(fresh));
  for (const r of fresh) out.push(...forRoad(after, r));
  for (const id of added(before.areas, after.areas)) if (after.areas[id]!.kind === 'crossing') out.push(...forCrossing(after, { id, polygon: after.areas[id]!.polygon, exists: (n) => !!n.areas[id] }));
  for (const id of added(before.markings, after.markings)) {
    const mk = after.markings![id]!;
    if (mk.kind === 'zebra' || mk.kind === 'bike_crossing') out.push(...forCrossing(after, { id, polygon: mk.geometry, exists: (n) => !!n.markings?.[id] }));
  }
  for (const id of Object.keys(after.zones)) if (!before.zones[id] || before.zones[id]!.kind !== after.zones[id]!.kind) out.push(...forZone(after.zones[id]!));
  for (const id of added(before.features, after.features)) out.push(...forFeature(after, id));
  for (const id of added(before.signalPlans, after.signalPlans)) out.push(...forSignals(after, id));
  // Two pieces of the new road meet at the same junction: one card per junction.
  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.key) && !!seen.add(x.key));
}

let installed = false;
/** Hooks the engine to the edit stream; idempotent. */
export function installSuggestions(): void {
  if (installed) return;
  installed = true;
  onCommit((before, after) => {
    const st = useSuggest.getState();
    const fresh = st.enabled ? suggestFor(before, after).filter((s) => !st.dismissed.has(s.key)) : [];
    const keep = st.items.filter((s) => s.valid(after) && !fresh.some((x) => x.key === s.key));
    useSuggest.setState({ items: [...fresh, ...keep].slice(0, MAX) });
  });
  // Undo/redo or scenario switch: drop what no longer applies.
  useApp.subscribe((s, p) => {
    if (s.network === p.network || !s.network) return;
    const items = useSuggest.getState().items;
    const next = items.filter((x) => x.valid(s.network!));
    if (next.length !== items.length) useSuggest.setState({ items: next });
  });
}
