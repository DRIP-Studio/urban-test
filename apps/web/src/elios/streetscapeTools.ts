import { geom, humpLimits, LocalFrame, type RoadFeature, type RoadFeatureKind, type RoadStructure, type TurnKind } from '@drip-urban/core';
import { commit, newId, useApp } from '../state/store';
import { CALMING } from '../tools/streetscape';
import { matchRoads, registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
const PROJECT = { kind: 'project', source: 'Elios' } as const;

function roadIds(name: unknown): string[] {
  const { network: net, selection: sel } = useApp.getState();
  if (!name && sel?.kind === 'road') return [...sel.ids];
  const out = matchRoads(net!, String(name ?? '')).map((r) => r.id);
  if (!out.length) throw new Error(`Nessuna strada trovata per «${String(name ?? '')}»`);
  return out;
}

registerEliosTools([
  {
    name: 'add_traffic_calming', kind: 'write', label: 'Moderazione del traffico',
    description: 'Inserisce elementi di moderazione su una strada: dossi (art. 179 Reg. CdS, solo con limite ≤ 50 km/h, altezza limitata automaticamente), piattaforme rialzate, attraversamenti pedonali rialzati, cuscini berlinesi, bande rumorose. Distribuiti con passo regolare lungo la strada.',
    parameters: OBJ({
      roadName: { type: 'STRING', description: 'Nome strada (vuoto = strada selezionata)' },
      kind: { type: 'STRING', enum: Object.keys(CALMING).filter((k) => k !== 'raised_junction'), description: 'Tipo di elemento' },
      spacingM: { type: 'NUMBER', description: 'Interasse in metri (predefinito 80)' },
      heightCm: { type: 'NUMBER', description: 'Altezza in cm (predefinita dal tipo)' },
    }, ['kind']),
    run(a) {
      const { network: net, baseline } = useApp.getState();
      const kind = String(a.kind) as RoadFeatureKind;
      const spec = CALMING[kind];
      if (!spec || kind === 'raised_junction') throw new Error(`Tipo non valido: ${String(a.kind)}`);
      const f = new LocalFrame(baseline!.origin);
      const spacing = Math.max(20, Number(a.spacingM) || 80);
      const features: RoadFeature[] = [], skipped: string[] = [];
      for (const id of roadIds(a.roadName)) {
        const road = net!.roads[id]!;
        let h = (Number(a.heightCm) || spec.heightCm) / 100;
        if (kind === 'speed_hump' || kind === 'speed_cushion') {
          const lim = humpLimits(road.speedKmh);
          if (!lim) { skipped.push(`${road.name || id} (${road.speedKmh} km/h > 50)`); continue; }
          h = Math.min(h, lim.maxHeightM);
        }
        const len = geom.lengthOf(road.axis.map((p) => f.toMetric(p) as geom.V));
        // Keep 20 m clear of junctions; at least one element in the middle.
        const n = Math.max(1, Math.floor((len - 40) / spacing) + 1);
        for (let i = 0; i < n; i++) {
          const station = n === 1 ? len / 2 : 20 + ((len - 40) * i) / (n - 1);
          features.push({ id: newId('f'), kind, roadId: id, station: Math.round(station * 10) / 10, lengthM: spec.lengthM, rampM: spec.rampM, heightM: h, state: 'project', properties: {}, provenance: PROJECT });
        }
      }
      if (!features.length) return { added: 0, skipped, note: 'Dossi ammessi solo su strade con limite ≤ 50 km/h (art. 179 Reg. CdS).' };
      const res = commit('batch', { label: `Elios · ${spec.label}`, ops: features.map((feature) => ({ type: 'feature.set', payload: { feature } })) });
      return { added: res.ok ? features.length : 0, skipped, heightCm: Math.round(features[0]!.heightM * 100), reference: spec.hint };
    },
  },
  {
    name: 'set_road_structure', kind: 'write', label: 'Struttura stradale',
    description: 'Rende una strada ponte, viadotto (strada sopraelevata) o galleria, oppure la riporta a raso. Verifica il franco verticale ≥ 5 m (DM 5/11/2001).',
    parameters: OBJ({
      roadName: { type: 'STRING', description: 'Nome strada (vuoto = selezionata)' },
      type: { type: 'STRING', enum: ['none', 'bridge', 'viaduct', 'tunnel'], description: 'Struttura' },
      heightM: { type: 'NUMBER', description: 'Altezza impalcato o profondità galleria (m)' },
      piersEveryM: { type: 'NUMBER', description: 'Interasse pile (m)' },
    }, ['type']),
    run(a) {
      const ids = roadIds(a.roadName);
      const t = String(a.type);
      const structure: RoadStructure | undefined = t === 'none' ? undefined : {
        type: t as RoadStructure['type'], heightM: Number(a.heightM) || (t === 'tunnel' ? 8 : 7), layer: t === 'tunnel' ? -1 : 1,
        ...(t !== 'tunnel' ? { piersEveryM: Number(a.piersEveryM) || 30 } : {}),
      };
      const res = commit('road.setStructure', { roadIds: ids, structure });
      return { roads: ids.length, ok: res.ok, structure: structure ?? 'a raso' };
    },
  },
  {
    name: 'set_lane_turns', kind: 'write', label: 'Corsie di preselezione',
    description: 'Imposta le frecce di preselezione per corsia (dalla corsia più a sinistra a quella più a destra nel senso indicato). Le frecce e le linee continue negli ultimi 30 m vengono disegnate in automatico (art. 147 Reg. CdS).',
    parameters: OBJ({
      roadName: { type: 'STRING', description: 'Nome strada (vuoto = selezionata)' },
      direction: { type: 'STRING', enum: ['forward', 'backward'], description: 'Senso: forward = verso la fine della strada' },
      lanes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Per corsia, da sinistra: combinazioni di left, through, right, uturn separate da «+» (es. ["left", "through", "through+right"])' },
    }, ['lanes']),
    run(a) {
      const net = useApp.getState().network!;
      const id = roadIds(a.roadName)[0]!;
      const road = net.roads[id]!;
      const dir = a.direction === 'backward' ? 'backward' : 'forward';
      const lanes = road.lanes.filter((l) => l.direction === dir).sort((x, y) => y.index - x.index);
      const spec = (a.lanes as string[] | undefined) ?? [];
      if (spec.length !== lanes.length) throw new Error(`La strada ha ${lanes.length} corsie in quel senso, ricevute ${spec.length}`);
      const ok = new Set<TurnKind>(['left', 'through', 'right', 'uturn']);
      const turns = Object.fromEntries(lanes.map((l, i) => [l.id, spec[i]!.split('+').map((s) => s.trim()).filter((s): s is TurnKind => ok.has(s as TurnKind))]));
      const res = commit('road.setLaneTurns', { roadId: id, turns });
      return { ok: res.ok, road: road.name, lanes: spec };
    },
  },
]);
