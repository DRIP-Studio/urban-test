import { zoneGates, type Lane, type Route } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { usePicks } from '../tools/picks';
import { commit, newId, setMode, useApp } from '../state/store';
import { matchRoads, registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'STRING', description, ...extra });
const N = (description: string) => ({ type: 'NUMBER', description });
const WINDOWS = { type: 'ARRAY', description: 'Fasce orarie (giorni 0 = lunedì … 6 = domenica)', items: OBJ({ days: { type: 'ARRAY', items: { type: 'NUMBER' }, description: 'Giorni' }, from: S('HH:MM'), to: S('HH:MM') }) };

function roadsByName(name: unknown, ids: unknown): string[] {
  const net = useApp.getState().network!;
  if (Array.isArray(ids) && ids.length) return (ids as string[]).filter((id) => net.roads[id]);
  const sel = useApp.getState().selection;
  if (!name && sel?.kind === 'road') return [...sel.ids];
  const out = matchRoads(net, String(name ?? '')).map((r) => r.id);
  if (!out.length) throw new Error(`Nessuna strada trovata per «${String(name ?? '')}»`);
  return out;
}

registerEliosTools([
  {
    name: 'set_road_restrictions', kind: 'write', label: 'Limitazioni di transito',
    description: 'Divieti e limiti di transito su strade (art. 6 CdS): mezzi pesanti (hgv: no | destination | delivery), tutti i veicoli a motore, massa, altezza, larghezza, lunghezza, ADR, con fasce orarie. Il navigatore li rispetta.',
    parameters: OBJ({
      roadName: S('Nome strada'), roadIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Id strade' },
      hgv: S('Mezzi pesanti oltre 3,5 t', { enum: ['no', 'destination', 'delivery', 'none'] }), motorVehicle: S('Veicoli a motore', { enum: ['no', 'destination', 'none'] }),
      maxWeightT: N('Massa massima t'), maxHeightM: N('Altezza massima m'), maxWidthM: N('Larghezza massima m'), maxLengthM: N('Lunghezza massima m'),
      hazmat: { type: 'BOOLEAN', description: 'Vieta merci pericolose' }, schedule: WINDOWS, note: S('Deroghe'),
      clear: { type: 'BOOLEAN', description: 'Rimuove le limitazioni di progetto' },
    }),
    run(a) {
      const roadIds = roadsByName(a.roadName, a.roadIds);
      if (a.clear) { commit('road.setRestrictions', { roadIds, restrictions: null }); return { cleared: roadIds.length }; }
      const r = Object.fromEntries(Object.entries({
        hgv: a.hgv === 'none' ? undefined : a.hgv, motorVehicle: a.motorVehicle === 'none' ? undefined : a.motorVehicle,
        maxWeightT: a.maxWeightT, maxHeightM: a.maxHeightM, maxWidthM: a.maxWidthM, maxLengthM: a.maxLengthM, hazmat: a.hazmat || undefined,
        schedule: Array.isArray(a.schedule) && a.schedule.length ? a.schedule : undefined, note: a.note,
      }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const res = commit('road.setRestrictions', { roadIds, restrictions: r });
      if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(' · '));
      return { changed: roadIds.length, restrictions: r };
    },
  },
  {
    name: 'set_preferential_lane', kind: 'write', label: 'Corsia preferenziale',
    description: 'Trasforma la corsia più a destra (per ogni senso, o nel senso indicato) in corsia preferenziale bus, bus+taxi o ciclabile, con orari opzionali.',
    parameters: OBJ({
      roadName: S('Nome strada'), roadIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Id strade' },
      kind: S('Tipo', { enum: ['bus', 'bus_taxi', 'bike', 'general'] }), direction: S('Senso', { enum: ['both', 'forward', 'backward'] }), schedule: WINDOWS,
    }, ['kind']),
    run(a) {
      const net = useApp.getState().network!;
      const ids = roadsByName(a.roadName, a.roadIds);
      const ops: { type: string; payload: unknown }[] = [];
      let skipped = 0;
      for (const id of ids) {
        const road = net.roads[id]!;
        const dirs = (a.direction === 'forward' ? ['forward'] : a.direction === 'backward' ? ['backward'] : ['forward', 'backward']) as Lane['direction'][];
        const targets = dirs.map((d) => road.lanes.filter((l) => l.direction === d).sort((x, y) => x.index - y.index)[0]).filter((l): l is Lane => !!l);
        // A single lane per direction cannot become reserved without closing the road to cars.
        const usable = targets.filter((l) => a.kind === 'general' || road.lanes.filter((x) => x.direction === l.direction).length > 1);
        skipped += targets.length - usable.length;
        if (!usable.length) continue;
        const sch = Array.isArray(a.schedule) && a.schedule.length ? a.schedule as Lane['restrictionSchedule'] : undefined;
        const lanes = road.lanes.map((l) => {
          if (!usable.includes(l)) return l;
          const { taxiAllowed: _t, restrictionSchedule: _s, ...rest } = l;
          if (a.kind === 'general') return { ...rest, restriction: 'none' as const, modes: ['car', 'bus', 'truck', 'bike', 'emergency'] as Lane['modes'] };
          if (a.kind === 'bike') return { ...rest, restriction: 'bike_only' as const, modes: ['bike'] as Lane['modes'], ...(sch ? { restrictionSchedule: sch } : {}) };
          return { ...rest, restriction: 'bus_only' as const, modes: ['bus', 'emergency'] as Lane['modes'], priority: 'transit' as const, ...(a.kind === 'bus_taxi' ? { taxiAllowed: true } : {}), ...(sch ? { restrictionSchedule: sch } : {}) };
        });
        const byId = new Map(lanes.map((l) => [l.id, l]));
        const section = { elements: road.section.elements.map((e) => (e.laneId ? { ...e, kind: byId.get(e.laneId)!.restriction === 'bus_only' ? 'bus' as const : e.kind === 'bus' ? 'lane' as const : e.kind } : e)) };
        ops.push({ type: 'road.setSection', payload: { roadId: id, lanes, section } });
      }
      if (!ops.length) throw new Error('Nessuna strada con almeno due corsie nello stesso senso: allarga prima la sezione');
      const res = commit('batch', { label: 'Elios · corsie preferenziali', ops });
      if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(' · '));
      return { changed: ops.length, skippedSingleLane: skipped };
    },
  },
  {
    name: 'add_ztl_gates', kind: 'write', label: 'Varchi ZTL con pannelli LED',
    description: 'Genera i varchi elettronici (telecamera + pannello LED «ZTL attiva/non attiva» + segnale) a ogni ingresso di una zona.',
    parameters: OBJ({ zoneId: S('Id zona (predefinito: zona selezionata)') }),
    run(a) {
      const { network: net, baseline, selection } = useApp.getState();
      const zid = String(a.zoneId ?? (selection?.kind === 'zone' ? selection.ids[0] : '') ?? '');
      const zone = net?.zones[zid];
      if (!zone || !baseline) throw new Error('Seleziona una zona o indica zoneId');
      const gates = zoneGates(net!, baseline.origin, zone).filter((g) => g.entry);
      const assets = gates.flatMap((g) => {
        const pole = newId('pole');
        return [
          { id: newId('a'), type: 'ztl.gate', at: g.at, rotationDeg: g.bearingDeg, state: 'project' as const, properties: { zoneId: zone.id, roadId: g.roadId, label: `Varco ${g.roadName}`.trim() }, provenance: { kind: 'project' as const, source: 'Elios · DRIP Urban scenario' } },
          { id: newId('a'), type: 'it.sign.zona_traffico_limitato', at: g.at, rotationDeg: g.bearingDeg, state: 'project' as const, properties: { zoneId: zone.id, poleId: pole, stackOrder: 0 }, provenance: { kind: 'project' as const, source: 'Elios · DRIP Urban scenario' } },
        ];
      });
      if (!assets.length) throw new Error('Nessuna strada entra nella zona');
      const res = commit('asset.add', { assets });
      if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(' · '));
      return { gates: gates.length };
    },
  },
  {
    name: 'plan_route', kind: 'view', label: 'Percorso calcolato',
    description: 'Calcola un percorso sullo scenario (oggi e progetto) con tappe intermedie, mezzo e orario; per i camion usa massa e dimensioni.',
    parameters: OBJ({
      points: { type: 'ARRAY', description: 'Punti [lon, lat] in ordine: origine, tappe, destinazione', items: { type: 'ARRAY', items: { type: 'NUMBER' }, description: '[lon, lat]' } },
      mode: S('Mezzo', { enum: ['car', 'motorcycle', 'truck', 'bus', 'bike', 'walk', 'emergency'] }), day: N('Giorno 0 = lunedì'), hour: N('Ora di partenza'), weightT: N('Massa camion t'), heightM: N('Altezza camion m'),
    }, ['points']),
    async run(a) {
      const pts = (a.points as [number, number][]).map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
      if (pts.length < 2) throw new Error('Servono almeno origine e destinazione');
      const st = usePicks.getState();
      usePicks.setState({
        mode: (a.mode as typeof st.mode) ?? st.mode, from: pts[0]!, to: pts[pts.length - 1]!, via: pts.slice(1, -1),
        departure: { day: Number.isFinite(a.day) ? Number(a.day) : st.departure.day, minutes: Number.isFinite(a.hour) ? Math.round(Number(a.hour) * 60) : st.departure.minutes },
        vehicle: { ...st.vehicle, ...(a.weightT ? { weightT: Number(a.weightT) } : {}), ...(a.heightM ? { heightM: Number(a.heightM) } : {}) },
      });
      setMode('traffic');
      await usePicks.getState().runRoute();
      const r = usePicks.getState().result as { today: Route; project: Route } | null;
      if (!r) throw new Error('Percorso non calcolato');
      return { found: r.project.found, distanceM: Math.round(r.project.distanceM), minutes: Math.round(r.project.durationS / 6) / 10, todayMinutes: r.today.found ? Math.round(r.today.durationS / 6) / 10 : null, warnings: r.project.warnings, steps: r.project.steps.slice(0, 12).map((s) => s.instruction) };
    },
  },
  {
    name: 'estimated_sidewalks', kind: 'write', label: 'Marciapiedi stimati',
    description: 'Attiva o disattiva i marciapiedi stimati (dove mancano dati e percorsi pedonali): per tutto il progetto o per le strade indicate. Non modifica le strade.',
    parameters: OBJ({ on: { type: 'BOOLEAN', description: 'true = attiva' }, roadName: S('Solo questa strada'), roadIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Solo queste strade' } }, ['on']),
    async run(a) {
      const sw = await import('../state/sidewalks');
      if (!a.roadName && !(Array.isArray(a.roadIds) && a.roadIds.length)) { sw.setAllSides(Boolean(a.on)); return { all: true, on: Boolean(a.on) }; }
      const ids = new Set(roadsByName(a.roadName, a.roadIds));
      const keys = [...sw.useSidewalks.getState().bySide.values()].filter((x) => ids.has(x.roadId) && x.status === 'estimated').map((x) => x.key);
      for (const k of keys) sw.setSideEnabled(k, Boolean(a.on));
      if (a.on) sw.setSidewalksEnabled(true);
      return { sides: keys.length, on: Boolean(a.on) };
    },
  },
]);
void engine;
