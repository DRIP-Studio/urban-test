/**
 * Elios tools: what the assistant can read and do in the workstation.
 *
 * Every tool that changes the project goes through `commit()` — validated by the core registry,
 * undoable, autosaved — exactly like a click in the interface. Tools are declared with the OpenAPI
 * subset Gemini understands (type names in upper case).
 */
import { LocalFrame, type LngLat, type Road, type Zone } from '@drip-urban/core';
import { api } from '../api/client';
import { fitBounds, flyTo, getMap } from '../map/mapStore';
import { plateOnPoleOps } from '../state/actions';
import { commit, newId, openDock, select, setMode, undo, useApp, type Mode } from '../state/store';

export type ToolKind = 'read' | 'view' | 'write';
export interface EliosTool {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  /** Italian label shown in the chat when the tool runs. */
  readonly label?: string;
  readonly parameters?: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown> | unknown;
}

const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'STRING', description, ...extra });
const N = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'NUMBER', description, ...extra });
const ARR = (items: Record<string, unknown>, description: string) => ({ type: 'ARRAY', items, description });
const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });

const PROJECT = { kind: 'project' as const, source: 'Elios · DRIP Urban scenario' };

function state() {
  const s = useApp.getState();
  if (!s.network || !s.baseline || !s.project) throw new Error('Nessun progetto aperto');
  return { ...s, network: s.network, baseline: s.baseline, project: s.project };
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(via|viale|corso|piazza|vico|vicolo|largo|strada|traversa)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

function roadLengthM(f: LocalFrame, r: Road): number {
  let L = 0;
  for (let i = 1; i < r.axis.length; i++) {
    const a = f.toMetric(r.axis[i - 1]!), b = f.toMetric(r.axis[i]!);
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

export function roadSummary(f: LocalFrame, r: Road) {
  return {
    id: r.id, name: r.name || '(senza nome)', class: r.roadClass, lengthM: Math.round(roadLengthM(f, r)), speedKmh: r.speedKmh, oneway: r.oneway,
    lanes: r.lanes.length, widthM: Math.round(r.section.elements.reduce((s, e) => s + e.widthM, 0) * 10) / 10,
    sidewalks: r.section.elements.filter((e) => e.kind === 'sidewalk').map((e) => e.widthM),
    restrictions: (r as Road & { restrictions?: unknown }).restrictions ?? null,
  };
}

/** Roads whose name matches (accent- and prefix-insensitive), or the selected roads. */
function resolveRoads(args: Record<string, unknown>): Road[] {
  const { network, selection } = state();
  const ids = (args.roadIds as string[] | undefined)?.filter((id) => network.roads[id]);
  if (ids?.length) return ids.map((id) => network.roads[id]!);
  const name = String(args.roadName ?? '').trim();
  if (name) {
    const q = norm(name);
    const hits = Object.values(network.roads).filter((r) => r.name && (norm(r.name) === q || norm(r.name).includes(q)));
    if (hits.length) return hits;
    throw new Error(`Nessuna strada chiamata «${name}»`);
  }
  if (selection?.kind === 'road') return selection.ids.map((id) => network.roads[id]!).filter(Boolean);
  throw new Error('Indica la strada (nome o id) oppure selezionala sulla mappa');
}

function viewportBbox(): [number, number, number, number] | null {
  const m = getMap();
  if (!m) return null;
  const b = m.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Polygon around roads: convex hull of the axes buffered by `bufferM` (8 directions per vertex). */
export function polygonAroundRoads(f: LocalFrame, roads: Road[], bufferM: number): LngLat[] {
  const pts: [number, number][] = [];
  for (const r of roads) for (const q of r.axis) {
    const m = f.toMetric(q);
    for (let k = 0; k < 8; k++) pts.push([m[0] + bufferM * Math.cos((k * Math.PI) / 4), m[1] + bufferM * Math.sin((k * Math.PI) / 4)]);
  }
  return hull(pts).map((m) => f.toLngLat(m));
}

function bboxOf(points: readonly LngLat[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function must(ok: { ok: boolean; issues: { message: string; severity: string }[] }) {
  if (!ok.ok) throw new Error(ok.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' · ') || 'Operazione rifiutata');
}

const ZONE_NAMES: Record<string, string> = { ztl: 'ZTL', pedestrian: 'Area pedonale', school: 'Strada scolastica', zone30: 'Zona 30', low_emission: 'Zona a basse emissioni', parking: 'Zona sosta', work: 'Cantiere' };

const REGISTRY: EliosTool[] = [
  {
    name: 'get_context', kind: 'read',
    description: 'Stato della postazione: progetto, scenario, modalità, selezione corrente con dettagli, area visibile, conteggi.',
    run() {
      const { project, scenario, mode, selection, network, baseline } = state();
      const f = new LocalFrame(baseline.origin);
      const sel = selection ? {
        kind: selection.kind,
        items: selection.ids.slice(0, 20).map((id) => selection.kind === 'road' && network.roads[id] ? roadSummary(f, network.roads[id]!)
          : selection.kind === 'asset' ? network.assets[id] : selection.kind === 'zone' ? network.zones[id] : selection.kind === 'node' ? { id, at: network.nodes[id]?.at, signal: Object.values(network.signalPlans).some((p) => p.nodeId === id) } : { id }),
      } : null;
      return {
        project: project.name, city: baseline.name, scenario: scenario?.name, scenarioIsBaseline: scenario?.isBaseline, mode, selection: sel, viewport: viewportBbox(),
        counts: { roads: Object.keys(network.roads).length, assets: Object.keys(network.assets).length, zones: Object.keys(network.zones).length, signals: Object.keys(network.signalPlans).length, roundabouts: Object.keys(network.roundabouts).length },
      };
    },
  },
  {
    name: 'find_roads', kind: 'read',
    description: 'Cerca strade per nome (anche parziale, senza «via/corso»). Restituisce id, classe, lunghezza, velocità, sensi, corsie, larghezza, marciapiedi.',
    parameters: OBJ({ roadName: S('Nome della strada, es. «Corso Durante»') }, ['roadName']),
    run(a) {
      const { baseline } = state();
      const f = new LocalFrame(baseline.origin);
      const roads = resolveRoads(a);
      return { count: roads.length, roads: roads.slice(0, 30).map((r) => roadSummary(f, r)), totalLengthM: Math.round(roads.reduce((s, r) => s + roadLengthM(f, r), 0)) };
    },
  },
  {
    name: 'find_place', kind: 'read',
    description: 'Cerca un luogo, indirizzo o punto di interesse (geocodifica OpenStreetMap) vicino al progetto.',
    parameters: OBJ({ query: S('Testo da cercare') }, ['query']),
    async run(a) {
      const { baseline } = state();
      const r = await api.get<{ name: string; at: [number, number] }[]>(`/api/geocode?q=${encodeURIComponent(String(a.query))}&bbox=${baseline.bbox.join(',')}`);
      return r.slice(0, 5);
    },
  },
  {
    name: 'search_catalog', kind: 'read',
    description: 'Cerca nei cataloghi: segnali stradali italiani (CdS), arredo urbano e verde, materiali. Restituisce gli id da usare per posare gli oggetti.',
    parameters: OBJ({ catalog: S('signs | furniture | materials', { enum: ['signs', 'furniture', 'materials'] }), query: S('Parole da cercare, es. «divieto di transito», «panchina», «porfido»') }, ['catalog', 'query']),
    run(a) {
      const c = useApp.getState().catalogs;
      if (!c) throw new Error('Cataloghi non caricati');
      const q = norm(String(a.query));
      const words = q.split(' ').filter(Boolean);
      const items: { id: string; label: string }[] = a.catalog === 'signs' ? c.signs.items.map((i) => ({ id: i.id, label: i.label })) : a.catalog === 'furniture' ? c.furniture.items.map((i) => ({ id: i.id, label: i.label })) : c.materials.items.map((i) => ({ id: i.id, label: i.label }));
      return items.filter((i) => words.every((w) => norm(`${i.label} ${i.id}`).includes(w))).slice(0, 15);
    },
  },
  {
    name: 'fly_to', kind: 'view',
    description: 'Sposta la mappa: su coordinate, su una strada (nome o id) o su un luogo trovato.',
    parameters: OBJ({ lon: N('Longitudine'), lat: N('Latitudine'), zoom: N('Zoom 13–20'), roadName: S('Nome strada'), roadIds: ARR(S('id'), 'Id strade') }),
    run(a) {
      if (a.roadName || a.roadIds) {
        const roads = resolveRoads(a);
        fitBounds(bboxOf(roads.flatMap((r) => r.axis)), 90);
        select({ kind: 'road', ids: roads.map((r) => r.id) });
        return { ok: true, roads: roads.length };
      }
      if (Number.isFinite(a.lon) && Number.isFinite(a.lat)) { flyTo([Number(a.lon), Number(a.lat)], Number(a.zoom) || 17.5); return { ok: true }; }
      throw new Error('Indica coordinate o strada');
    },
  },
  {
    name: 'select_roads', kind: 'view',
    description: 'Seleziona strade sulla mappa (per mostrarle all\'utente o lavorarci dopo).',
    parameters: OBJ({ roadName: S('Nome strada'), roadIds: ARR(S('id'), 'Id strade') }),
    run(a) { const roads = resolveRoads(a); select({ kind: 'road', ids: roads.map((r) => r.id) }); return { selected: roads.length }; },
  },
  {
    name: 'set_mode', kind: 'view',
    description: 'Cambia modalità della postazione.',
    parameters: OBJ({ mode: S('Modalità', { enum: ['design', 'analyze', 'traffic', 'transit', 'twin', 'present', 'civic'] }) }, ['mode']),
    run(a) { setMode(a.mode as Mode); return { ok: true }; },
  },
  {
    name: 'open_panel', kind: 'view',
    description: 'Apre un pannello: section (sezione stradale), junction (Junction Lab), signals (Signal Studio), layers, history, export, settings, compare.',
    parameters: OBJ({ panel: S('Pannello', { enum: ['section', 'junction', 'signals', 'layers', 'history', 'export', 'settings', 'compare'] }) }, ['panel']),
    run(a) { openDock(String(a.panel)); return { ok: true }; },
  },
  {
    name: 'set_speed_limit', kind: 'write',
    description: 'Imposta il limite di velocità (km/h) sulle strade indicate. Zona 30: 30 km/h; urbano: 50 km/h.',
    parameters: OBJ({ roadName: S('Nome strada'), roadIds: ARR(S('id'), 'Id strade'), speedKmh: N('Velocità km/h', { minimum: 5, maximum: 130 }) }, ['speedKmh']),
    run(a) {
      const roads = resolveRoads(a);
      must(commit('batch', { label: `Elios · limite ${a.speedKmh} km/h`, ops: roads.map((r) => ({ type: 'road.update', payload: { roadId: r.id, changes: { speedKmh: Number(a.speedKmh) } } })) }));
      return { changed: roads.length };
    },
  },
  {
    name: 'set_oneway', kind: 'write',
    description: 'Cambia il senso di marcia: no = doppio senso, forward = senso unico nel verso dell\'asse, backward = verso opposto.',
    parameters: OBJ({ roadName: S('Nome strada'), roadIds: ARR(S('id'), 'Id strade'), oneway: S('Senso', { enum: ['no', 'forward', 'backward'] }) }, ['oneway']),
    run(a) {
      const roads = resolveRoads(a);
      must(commit('batch', { label: 'Elios · senso di marcia', ops: roads.map((r) => ({ type: 'road.setOneway', payload: { roadId: r.id, oneway: a.oneway } })) }));
      return { changed: roads.length };
    },
  },
  {
    name: 'rename_road', kind: 'write',
    description: 'Rinomina una strada.',
    parameters: OBJ({ roadIds: ARR(S('id'), 'Id strade'), roadName: S('Nome attuale'), newName: S('Nuovo nome') }, ['newName']),
    run(a) {
      const roads = resolveRoads(a);
      must(commit('batch', { label: 'Elios · rinomina', ops: roads.map((r) => ({ type: 'road.update', payload: { roadId: r.id, changes: { name: String(a.newName) } } })) }));
      return { changed: roads.length };
    },
  },
  {
    name: 'create_zone', kind: 'write',
    description: 'Crea una zona regolamentata (ZTL, area pedonale, zona 30, strada scolastica, basse emissioni, sosta, cantiere) attorno a strade, sull\'area visibile o su un poligono. Per ZTL e scolastiche indica gli orari.',
    parameters: OBJ({
      kind: S('Tipo', { enum: ['ztl', 'pedestrian', 'school', 'zone30', 'low_emission', 'parking', 'work'] }),
      name: S('Nome'), roadName: S('Strade da includere (nome)'), roadIds: ARR(S('id'), 'Id strade'), bufferM: N('Margine attorno alle strade in metri (predefinito 25)'),
      useViewport: { type: 'BOOLEAN', description: 'Usa l\'area visibile della mappa' },
      polygon: ARR(ARR(N('coord'), '[lon, lat]'), 'Vertici [lon, lat]'),
      schedule: ARR(OBJ({ days: ARR(N('0=domenica … 6=sabato'), 'Giorni'), from: S('HH:MM'), to: S('HH:MM') }), 'Fasce orarie di attivazione'),
      allowedModes: ARR(S('car|truck|bus|bike|walk|emergency|tram'), 'Mezzi ammessi'),
      speedKmh: N('Limite interno'),
    }, ['kind']),
    run(a) {
      const { baseline } = state();
      const f = new LocalFrame(baseline.origin);
      let polygon: LngLat[];
      if (Array.isArray(a.polygon) && (a.polygon as unknown[]).length >= 3) polygon = (a.polygon as [number, number][]).map((p) => [Number(p[0]), Number(p[1])] as const);
      else if (a.roadName || a.roadIds || (!a.useViewport && useApp.getState().selection?.kind === 'road')) polygon = polygonAroundRoads(f, resolveRoads(a), Number(a.bufferM) || 25);
      else {
        const b = viewportBbox();
        if (!b) throw new Error('Mappa non pronta');
        const pad = (b[2] - b[0]) * 0.15, padY = (b[3] - b[1]) * 0.15;
        polygon = [[b[0] + pad, b[1] + padY], [b[2] - pad, b[1] + padY], [b[2] - pad, b[3] - padY], [b[0] + pad, b[3] - padY]];
      }
      const kind = String(a.kind) as Zone['kind'];
      const defaults: Record<string, string[]> = { ztl: ['bus', 'emergency', 'bike', 'walk'], pedestrian: ['walk', 'bike', 'emergency'], school: ['walk', 'bike', 'emergency'], work: ['walk', 'emergency'] };
      const zone: Zone = {
        id: newId('z'), kind, name: String(a.name || ZONE_NAMES[kind] || 'Zona'), polygon,
        allowedModes: (a.allowedModes as Zone['allowedModes']) ?? (defaults[kind] as Zone['allowedModes']) ?? ['car', 'bus', 'truck', 'bike', 'walk', 'emergency'],
        ...(Array.isArray(a.schedule) && a.schedule.length ? { schedule: a.schedule as Zone['schedule'] } : kind === 'ztl' ? { schedule: [{ days: [1, 2, 3, 4, 5, 6], from: '08:00', to: '20:00' }] } : {}),
        ...(a.speedKmh ? { speedKmh: Number(a.speedKmh) } : kind === 'zone30' || kind === 'school' ? { speedKmh: 30 } : {}),
      };
      must(commit('zone.set', { zone }));
      select({ kind: 'zone', ids: [zone.id] });
      return { zoneId: zone.id, vertices: polygon.length };
    },
  },
  {
    name: 'place_sign', kind: 'write',
    description: 'Posa un segnale stradale del catalogo (id da search_catalog) in un punto. Con poleOf aggiunge il pannello allo stesso palo di un cartello esistente (sotto).',
    parameters: OBJ({ signId: S('Id del segnale, es. it.sign.II.46'), lon: N('Longitudine'), lat: N('Latitudine'), rotationDeg: N('Orientamento in gradi da nord'), poleOf: S('Id di un cartello esistente: stesso palo') }, ['signId']),
    run(a) {
      if (a.poleOf) {
        const r = plateOnPoleOps(String(a.poleOf), String(a.signId));
        if (!r) throw new Error('Cartello di riferimento inesistente');
        must(commit('batch', { label: 'Elios · pannello sul palo', ops: r.ops }));
        return { assetId: r.asset.id, poleId: r.asset.properties.poleId, stackOrder: r.asset.properties.stackOrder };
      }
      if (!Number.isFinite(a.lon) || !Number.isFinite(a.lat)) throw new Error('Indica il punto (lon, lat) o il palo');
      const asset = { id: newId('a'), type: String(a.signId), at: [Number(a.lon), Number(a.lat)] as LngLat, rotationDeg: Number(a.rotationDeg ?? 0), state: 'project' as const, properties: {}, provenance: PROJECT };
      must(commit('asset.add', { assets: [asset] }));
      return { assetId: asset.id };
    },
  },
  {
    name: 'place_along_road', kind: 'write',
    description: 'Distribuisce elementi di arredo o verde (id da search_catalog furniture, es. alberi, lampioni, panchine, dissuasori) lungo una strada, a un passo in metri, sul lato indicato.',
    parameters: OBJ({ itemId: S('Id dell\'elemento'), roadName: S('Nome strada'), roadIds: ARR(S('id'), 'Id strade'), spacingM: N('Passo in metri'), side: S('left | right | both', { enum: ['left', 'right', 'both'] }), offsetM: N('Distanza dall\'asse (predefinito: bordo carreggiata + 0,8 m)') }, ['itemId', 'spacingM']),
    run(a) {
      const { baseline } = state();
      const f = new LocalFrame(baseline.origin);
      const roads = resolveRoads(a);
      const step = Math.max(2, Number(a.spacingM));
      const sides = a.side === 'left' ? [1] : a.side === 'right' ? [-1] : [1, -1];
      const assets = [];
      for (const r of roads) {
        const half = r.section.elements.reduce((s, e) => s + e.widthM, 0) / 2;
        const off = Number(a.offsetM) || Math.max(2, half - (r.section.elements.find((e) => e.kind === 'sidewalk')?.widthM ?? 0) + 0.8);
        const pts = r.axis.map((q) => f.toMetric(q));
        let carry = step / 2;
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1]!, p1 = pts[i]!;
          const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          if (L < 1e-6) continue;
          const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
          for (let d = carry; d < L; d += step) {
            for (const s of sides) {
              const m: [number, number] = [p0[0] + ux * d - uy * off * s, p0[1] + uy * d + ux * off * s];
              assets.push({ id: newId('a'), type: String(a.itemId), at: f.toLngLat(m), rotationDeg: (Math.atan2(ux, uy) * 180) / Math.PI, state: 'project' as const, properties: {}, provenance: PROJECT });
            }
          }
          carry = ((carry - L) % step + step) % step;
        }
      }
      if (!assets.length) throw new Error('Strade troppo corte per il passo richiesto');
      if (assets.length > 600) throw new Error(`Troppi elementi (${assets.length}): aumenta il passo`);
      must(commit('asset.add', { assets }));
      return { placed: assets.length };
    },
  },
  {
    name: 'undo', kind: 'write',
    description: 'Annulla l\'ultima modifica dello scenario.',
    run() { undo(); return { ok: true }; },
  },
  {
    name: 'apply_operations', kind: 'write',
    description: 'Avanzato: applica operazioni di scenario DRIP Urban grezze in un unico passo annullabile (tipi: road.update, road.setOneway, road.setSection, zone.set, area.set, asset.add, asset.update, asset.remove, junction.set, signal.setPlan, roundabout.add …). Usalo solo se nessun altro strumento basta.',
    parameters: OBJ({ label: S('Descrizione breve'), ops: ARR(OBJ({ type: S('Tipo operazione'), payload: { type: 'OBJECT', description: 'Payload dell\'operazione' } }, ['type', 'payload']), 'Operazioni') }, ['ops']),
    run(a) {
      const ops = a.ops as { type: string; payload: unknown }[];
      must(commit('batch', { label: `Elios · ${String(a.label || 'modifiche')}`, ops }));
      return { applied: ops.length };
    },
  },
];

const extra: EliosTool[] = [];
/** Feature modules add their own tools (signals, restrictions, transit…). */
export function registerEliosTools(tools: EliosTool[]): void {
  for (const t of tools) if (!extra.some((x) => x.name === t.name)) extra.push(t);
}

export const eliosTools = (): EliosTool[] => [...REGISTRY, ...extra];
export const toolByName = (name: string) => eliosTools().find((t) => t.name === name);
export const declarations = () => eliosTools().map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) }));
