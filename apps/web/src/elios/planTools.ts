import {
  FUNCTIONAL_LABEL, STANDARD_LABEL, effectiveFunctionalClasses, environmentalIslands, horizontalAlignment, islandZone, proposeFunctionalClasses, pumsIndicators, sizeDrainage, urbanStandards,
} from '@drip-urban/core';
import { runDrainage, useDrainage } from '../state/drainage';
import { loadPlan, usePlans } from '../state/plans';
import { commit, newId, setDock, useApp } from '../state/store';
import { matchRoads, registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });

registerEliosTools([
  {
    name: 'urban_standards', kind: 'read', label: 'Standard urbanistici verificati',
    description: 'Verifica degli standard del DM 1444/1968 (istruzione, interesse comune, verde, parcheggi: 18 m²/abitante) sull\'intero comune: abitanti stimati, dotazioni, saldo. Usa il piano urbanistico importato se presente.',
    parameters: OBJ({ includePlanned: { type: 'BOOLEAN', description: 'Conta anche le aree riservate dal piano' } }),
    async run(a) {
      const { baseline, network } = useApp.getState();
      const doc = usePlans.getState().loaded ? usePlans.getState().doc : await loadPlan();
      const r = urbanStandards(baseline!, network, doc, { includePlanned: !!a.includePlanned });
      return { residents: Math.round(r.town.residents), rows: r.town.rows.map((x) => ({ standard: STANDARD_LABEL[x.kind], requiredM2: Math.round(x.requiredM2), availableM2: Math.round(x.computedM2), balanceM2: Math.round(x.balanceM2), perResident: Math.round(x.perResidentM2 * 10) / 10, norm: x.standardPerResident })), planZones: doc.zones.length, method: r.method };
    },
  },
  {
    name: 'classify_network', kind: 'write', label: 'Classificazione funzionale (PGTU)',
    description: 'Propone e applica la classificazione funzionale della rete secondo le Direttive PGTU 12/4/1995 (scorrimento, interquartiere, quartiere, interzonale, locale). Restituisce i km per classe.',
    parameters: OBJ({ apply: { type: 'BOOLEAN', description: 'Applica la proposta (predefinito true)' } }),
    run(a) {
      const { network, baseline } = useApp.getState();
      const p = proposeFunctionalClasses(network!, baseline!, null);
      const counts: Record<string, number> = {};
      for (const x of p.proposals) counts[FUNCTIONAL_LABEL[x.cls]] = (counts[FUNCTIONAL_LABEL[x.cls]] ?? 0) + 1;
      if (a.apply !== false) commit('road.setFunctionalClass', { classes: Object.fromEntries(p.proposals.map((x) => [x.roadId, x.cls])), source: 'auto' });
      setDock('plans');
      return { roads: p.proposals.length, byClass: counts, principalKm: Math.round(p.principalKm * 10) / 10, principalComponents: p.principalComponents, applied: a.apply !== false };
    },
  },
  {
    name: 'environmental_islands', kind: 'write', label: 'Isole ambientali',
    description: 'Individua le isole ambientali (maglie della rete principale) e, se richiesto, le crea come Zone 30, ZTL o aree pedonali secondo la proposta.',
    parameters: OBJ({ create: { type: 'BOOLEAN', description: 'Crea le zone proposte' } }),
    run(a) {
      const { network, baseline } = useApp.getState();
      const list = environmentalIslands(network!, baseline!, effectiveFunctionalClasses(network!), { plan: usePlans.getState().doc });
      usePlans.setState({ islands: list });
      if (a.create) {
        const ops = list.filter((i) => !i.existingZoneId).map((i) => ({ type: 'zone.set', payload: { zone: islandZone(i, newId('z')) } }));
        if (ops.length) commit('batch', { label: `Elios · isole ambientali (${ops.length})`, ops });
      }
      return { islands: list.map((i) => ({ proposal: i.proposal, areaHa: Math.round(i.areaHa * 10) / 10, residents: Math.round(i.residents), boundary: i.boundaryRoads.slice(0, 3), reason: i.reason })), created: !!a.create };
    },
  },
  {
    name: 'pums_indicators', kind: 'read', label: 'Indicatori PUMS',
    description: 'Indicatori del PUMS (DM 397/2017, DM 396/2019) calcolabili dal modello: rete, zone 30, ZTL, ciclabili, sosta, TPL.',
    parameters: OBJ({}),
    run() {
      const { network, baseline } = useApp.getState();
      return { indicators: pumsIndicators({ net: network!, baseline: baseline! }).map((x) => ({ macro: x.macro, label: x.label, value: x.value, unit: x.unit })) };
    },
  },
  {
    name: 'check_drainage', kind: 'read', label: 'Verifica del drenaggio',
    description: 'Verifica la rete di drenaggio urbano con il metodo razionale (portate, riempimento h/D, velocità) e propone i diametri commerciali adeguati.',
    parameters: OBJ({ autoSize: { type: 'BOOLEAN', description: 'Applica il dimensionamento automatico dei DN' } }),
    run(a) {
      const net = useApp.getState().network!;
      if (!Object.keys(net.drainageNodes ?? {}).length) return { message: 'Nessuna rete di drenaggio nel progetto: disegnala con lo strumento Drenaggio (C).' };
      if (a.autoSize) {
        const sizes = sizeDrainage(net, { idf: useDrainage.getState().idf });
        const ops = Object.entries(sizes).map(([id, dn]) => ({ type: 'drainage.update', payload: { kind: 'pipe', id, changes: { diameterMm: dn } } }));
        if (ops.length) commit('batch', { label: `Elios · dimensiona ${ops.length} condotte`, ops });
      }
      const r = runDrainage()!;
      setDock('drainage');
      return { pipes: Object.entries(r.pipes).map(([id, p]) => ({ id, dn: p.diameterMm, slopePct: Math.round(p.slope * 1000) / 10, qLs: Math.round(p.q * 1000), fillPct: Math.round(p.fill * 100), velocity: Math.round(p.velocity * 100) / 100, ok: p.ok })), issues: r.issues.map((i) => i.message) };
    },
  },
  {
    name: 'alignment_report', kind: 'read', label: 'Andamento planimetrico',
    description: 'Rettifili e curve di una strada con raggi, deviazioni e verifiche DM 5/11/2001 § 5.2 (raggio minimo, sviluppo, rettifili, visibilità in curva).',
    parameters: OBJ({ roadName: { type: 'STRING', description: 'Nome della strada (vuoto = selezionata)' } }, []),
    run(a) {
      const { network, baseline, selection } = useApp.getState();
      const road = a.roadName ? matchRoads(network!, String(a.roadName))[0] : selection?.kind === 'road' ? network!.roads[selection.ids[0]!] : undefined;
      if (!road) throw new Error('Indica una strada o selezionala sulla mappa');
      const al = horizontalAlignment(road, baseline!.origin);
      return { road: road.name, lengthM: Math.round(al.lengthM), designSpeedKmh: al.designSpeedKmh, rMinM: Math.round(al.rMinM), curves: al.elements.filter((e) => e.kind === 'curve').map((e) => ({ from: Math.round(e.s0), to: Math.round(e.s1), radiusM: Math.round(e.radiusM!), deflectionDeg: Math.round(e.deflectionDeg!), direction: e.direction })), issues: al.issues.map((i) => i.message) };
    },
  },
]);
