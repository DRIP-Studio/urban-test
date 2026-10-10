import {captureEliosScope} from './scope';
import { LocalFrame, rescalePlan, type CoordinationResult, type DetectedCorridor, type PlantDesign } from '@drip-urban/core';
import { engine } from '../engine/engine';
import type { JunctionResult } from '../panels/JunctionLab';
import { planPayload } from '../panels/SignalStudio';
import { newId, openDock, select, useApp } from '../state/store';
import { matchRoads, registerEliosTools } from './tools';
import { optimizeAllSignals } from '../traffic/signals';
import { liveFreshness, refreshLive } from '../traffic/live';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });

function nodeArg(a: Record<string, unknown>): string {
  const s = useApp.getState();
  const id = (a.nodeId as string) || (s.selection?.kind === 'node' ? s.selection.ids[0] : undefined);
  if (!id || !s.network?.nodes[id]) throw new Error('Seleziona un incrocio sulla mappa o indica nodeId');
  return id;
}

registerEliosTools([
  {
    name: 'live_traffic', kind: 'read', label: 'Letto il traffico live',
    description: "Traffico in tempo reale (HERE) dell'area visibile: tratti congestionati, incidenti, cantieri e chiusure. Aggiorna i dati prima di rispondere.",
    async run() {
      const s = await refreshLive({ archive: false });
      if (s.status !== 'ok') return { status: s.status, message: s.message ?? 'Chiave HERE non configurata (Impostazioni → Fornitori)' };
      if (liveFreshness() !== 'fresh') return { status: 'unavailable', capturedAt: s.capturedAt, reason: 'Orario mancante o rilevazione scaduta; esclusa dai calcoli' };
      const jams = s.flow.filter((f) => Number(f.properties.jamFactor ?? 0) >= 6).length;
      return { status: 'ok', capturedAt: s.capturedAt, segments: s.flow.length, congestedSegments: jams,
        incidents: s.incidents.slice(0, 25).map((f) => ({ kind: f.properties.label, roadClosed: f.properties.roadClosed, description: f.properties.description, end: f.properties.end })) };
    },
  },
  {
    name: 'optimize_all_signals', kind: 'write', label: 'Semafori della rete ottimizzati',
    description: 'Ricalcola con Webster tutti i piani semaforici dello scenario sui flussi stimati, in un\'unica operazione annullabile; i corridoi coordinati mantengono offset e ciclo comune.',
    async run() {
      const guard=captureEliosScope();
      const r = await optimizeAllSignals(true,guard.assert);
      if (!r.plans) throw new Error('Nessun incrocio semaforizzato nello scenario');
      return r;
    },
  },
  {
    name: 'list_signals', kind: 'read', label: 'Letti i semafori',
    description: 'Elenca gli incroci semaforizzati dello scenario: piano, ciclo, fasi, offset, coordinamento.',
    run() {
      const net = useApp.getState().network!;
      return Object.values(net.signalPlans).map((p) => ({ planId: p.id, nodeId: p.nodeId, name: p.name, cycleS: p.cycleS, offsetS: p.offsetS, phases: p.phases.length, mode: p.mode, coordination: p.coordination?.name ?? null, removedHeads: p.disabledHeads?.length ?? 0,
        roads: [...new Set(Object.values(net.roads).filter((r) => r.from === p.nodeId || r.to === p.nodeId).map((r) => r.name))] }));
    },
  },
  {
    name: 'design_signal_plan', kind: 'write', label: 'Piano semaforico progettato (Webster)',
    description: 'Progetta e applica il piano semaforico di un incrocio con il metodo di Webster (fasi senza conflitti, ciclo ottimo, verdi proporzionali ai flussi, verde pedonale a 1 m/s).',
    parameters: OBJ({ nodeId: { type: 'STRING', description: 'Id del nodo (predefinito: incrocio selezionato)' }, permissiveLeft: { type: 'BOOLEAN', description: 'Svolte a sinistra permesse (meno fasi)' } }),
    async run(a) {
      const guard=captureEliosScope();
      const nodeId = nodeArg(a);
      const r = await engine.job<JunctionResult | null>('junction', { nodeId, permissiveLeft: !!a.permissiveLeft });
      if (!r) throw new Error('Il nodo non è un incrocio veicolare con almeno 3 bracci');
      const { design, ...proposed } = r.suggested;
      // Keep what the user already decided on this junction: removed heads and corridor coordination.
      const existing = useApp.getState().network?.signalPlans[proposed.id];
      const plan = existing?.coordination
        ? { ...rescalePlan(proposed, existing.cycleS), offsetS: existing.offsetS, coordination: existing.coordination, mode: existing.mode, disabledHeads: existing.disabledHeads }
        : { ...proposed, disabledHeads: existing?.disabledHeads };
      const ok = guard.commit('signal.setPlan', planPayload(plan, r.analysis));
      if (!ok.ok) throw new Error(ok.issues.map((i) => i.message).join(' · '));
      select({ kind: 'node', ids: [nodeId] });
      openDock('signals');
      return { planId: plan.id, phases: plan.phases.length, cycleS: plan.cycleS, criticalRatio: design.criticalRatio, method: design.method };
    },
  },
  {
    name: 'coordinate_signals', kind: 'write', label: 'Semafori collegati in onda verde',
    description: 'Collega in onda verde i semafori lungo una strada (o i piani indicati): ciclo comune, offset sul tempo di percorrenza.',
    parameters: OBJ({
      roadName: { type: 'STRING', description: 'Strada del corridoio' }, planIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Piani da collegare' },
      speedKmh: { type: 'NUMBER', description: 'Velocità di progetto (predefinita 40)' }, cycleS: { type: 'NUMBER', description: 'Ciclo comune (predefinito: il maggiore)' },
      direction: { type: 'STRING', enum: ['oneway', 'twoway'], description: 'Banda in un senso o in entrambi' },
    }),
    async run(a) {
      const guard=captureEliosScope();
      const { network: net, baseline } = useApp.getState();
      if (!net || !baseline) throw new Error('Nessun progetto aperto');
      let plans = ((a.planIds as string[] | undefined) ?? []).map((id) => net.signalPlans[id]!).filter(Boolean);
      if (!plans.length && a.roadName) {
        const nodes = new Set(matchRoads(net, String(a.roadName)).flatMap((r) => [r.from, r.to]));
        plans = Object.values(net.signalPlans).filter((p) => nodes.has(p.nodeId));
      }
      if (plans.length < 2) throw new Error('Servono almeno due incroci semaforizzati sul corridoio');
      // Order along the corridor's main direction (first principal axis of the junctions).
      const f = new LocalFrame(baseline.origin);
      const pts = plans.map((p) => f.toMetric(net.nodes[p.nodeId]!.at));
      const [ax, ay] = pts.reduce(([sx, sy], q) => [sx + q[0], sy + q[1]], [0, 0]).map((v) => v / pts.length) as [number, number];
      const far = pts.reduce((best, q) => (Math.hypot(q[0] - ax, q[1] - ay) > Math.hypot(best[0] - ax, best[1] - ay) ? q : best), pts[0]!);
      const ux = far[0] - ax, uy = far[1] - ay;
      plans = plans.map((p, i) => ({ p, s: (pts[i]![0] - ax) * ux + (pts[i]![1] - ay) * uy })).sort((x, y) => x.s - y.s).map((x) => x.p);
      const cycleS = Number(a.cycleS) || Math.max(...plans.map((p) => p.cycleS));
      const speedKmh = Number(a.speedKmh) || 40;
      const direction = (a.direction as 'oneway' | 'twoway') || 'oneway';
      const r = await engine.job<CoordinationResult>('coordinate', { planIds: plans.map((p) => p.id), speedKmh, cycleS: Number(a.cycleS) || null, direction, allowHalfCycle: true });
      const ok = guard.commit('signal.coordinate', { coordination: { id: newId('coord'), name: `Onda verde ${String(a.roadName ?? '')}`.trim(), speedKmh, direction }, cycleS: r.cycleS, plans: r.offsets.map((o) => ({ planId: o.planId, offsetS: o.offsetS, halfCycle: o.halfCycle })) });
      if (!ok.ok) throw new Error(ok.issues.map((i) => i.message).join(' · '));
      return { junctions: plans.length, cycleS: r.cycleS, bandwidthS: r.bandwidthS, bandwidthBackS: r.bandwidthBackS, efficiency: r.efficiency, naiveBandwidthS: r.naiveBandwidthS, warnings: r.warnings, offsets: r.offsets };
    },
  },
  {
    name: 'coordinate_network', kind: 'write', label: 'Rete semaforica coordinata',
    description: "Trova automaticamente i corridoi semaforizzati (stessa via o prosecuzione rettilinea, incroci entro 800 m) e applica a ciascuno l'onda verde ottimizzata (banda massima nei due sensi, doppio ciclo per gli incroci minori).",
    parameters: OBJ({ speedKmh: { type: 'NUMBER', description: 'Velocità di progressione (predefinita 40)' }, direction: { type: 'STRING', enum: ['oneway', 'twoway'], description: 'Banda in un senso o in entrambi (predefinito twoway)' } }),
    async run(a) {
      const guard=captureEliosScope();
      const cs = await engine.job<DetectedCorridor[]>('detectCorridors', {});
      const taken = new Set<string>();
      const out = [];
      for (const c of cs) {
        if (c.planIds.some((id) => taken.has(id))) continue;
        const r = await engine.job<CoordinationResult>('coordinate', { planIds: c.planIds, speedKmh: Number(a.speedKmh) || 40, cycleS: null, direction: (a.direction as string) || 'twoway', allowHalfCycle: true });
        const ok = guard.commit('signal.coordinate', { coordination: { id: newId('coord'), name: `Onda verde ${c.name}`, speedKmh: r.speedKmh, direction: r.direction }, cycleS: r.cycleS, plans: r.offsets.map((o) => ({ planId: o.planId, offsetS: o.offsetS, halfCycle: o.halfCycle })) });
        if (ok.ok) { c.planIds.forEach((id) => taken.add(id)); out.push({ corridor: c.name, junctions: c.planIds.length, bandwidthS: r.bandwidthS, bandwidthBackS: r.bandwidthBackS }); }
      }
      if (!out.length) throw new Error('Nessun corridoio coordinabile: servono almeno due incroci semaforizzati sulla stessa via');
      return out;
    },
  },
  {
    name: 'merge_signal_plants', kind: 'write', label: 'Incroci uniti in un impianto unico',
    description: "Unisce incroci semaforizzati vicini (indicati per piano o per strada) in un unico impianto: un solo regolatore, ciclo comune, sfasamenti legati al tempo di percorrenza interno e verifica dell'accumulo delle code.",
    parameters: OBJ({ planIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Piani da unire (in ordine)' }, roadName: { type: 'STRING', description: 'In alternativa: strada su cui stanno gli incroci' } }),
    async run(a) {
      const guard=captureEliosScope();
      const net = useApp.getState().network!;
      let ids = ((a.planIds as string[] | undefined) ?? []).filter((id) => net.signalPlans[id]);
      if (!ids.length && a.roadName) { const nodes = new Set(matchRoads(net, String(a.roadName)).flatMap((r) => [r.from, r.to])); ids = Object.values(net.signalPlans).filter((p) => nodes.has(p.nodeId)).map((p) => p.id); }
      if (ids.length < 2) throw new Error('Servono almeno due incroci semaforizzati');
      const d = await engine.job<PlantDesign>('designPlant', { planIds: ids, speedKmh: 30 });
      const ok = guard.commit('signal.mergePlant', { plant: { id: newId('plant'), name: `Impianto ${String(a.roadName ?? '')}`.trim(), speedKmh: 30 }, cycleS: d.cycleS, plans: d.plans });
      if (!ok.ok) throw new Error(ok.issues.map((i) => i.message).join(' · '));
      return { cycleS: d.cycleS, plans: d.plans, links: d.links, warnings: d.warnings };
    },
  },
]);
