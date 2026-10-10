import type { LngLat, Marking, Network, Road, RoadFeature, RoadStructure, TurnKind } from '../model/types';
import { defineOperation, type Issue } from './registry';

const err = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'error', message, ...(targetIds ? { targetIds } : {}) });
const warn = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'warning', message, ...(targetIds ? { targetIds } : {}) });
const okLL = (p: unknown): p is LngLat => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isFinite(x)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/**
 * Speed limits compatible with a vertical deflection (DPR 495/1992 art. 179 c. 4–5: dossi only on roads
 * with limit ≤ 50 km/h, with width/height by limit: ≤ 50 → ≥ 60 cm / ≤ 3 cm, ≤ 40 → ≥ 90 cm / ≤ 5 cm,
 * ≤ 30 → ≥ 120 cm / ≤ 7 cm). Raised platforms and crossings follow the same height logic as reference.
 */
export function humpLimits(speedKmh: number): { minLengthM: number; maxHeightM: number } | null {
  if (speedKmh > 50) return null;
  if (speedKmh > 40) return { minLengthM: 0.6, maxHeightM: 0.03 };
  if (speedKmh > 30) return { minLengthM: 0.9, maxHeightM: 0.05 };
  return { minLengthM: 1.2, maxHeightM: 0.07 };
}

/** Places or updates a traffic-calming / raised element. */
export const featureSet = defineOperation<{ readonly feature: RoadFeature }>({
  type: 'feature.set',
  label: (p) => ({ speed_hump: 'Dosso artificiale', speed_table: 'Piattaforma rialzata', raised_crossing: 'Attraversamento rialzato', speed_cushion: 'Cuscino berlinese', rumble_strips: 'Bande rumorose', raised_junction: 'Incrocio rialzato' })[p.feature.kind],
  validate(net, p) {
    const f = p.feature;
    const issues: Issue[] = [];
    if (f.kind === 'raised_junction') {
      if (!f.nodeId || !net.nodes[f.nodeId]) issues.push(err('feature.node', 'Incrocio inesistente'));
    } else {
      const road = f.roadId ? net.roads[f.roadId] : undefined;
      if (!road) return [err('feature.road', 'Strada inesistente')];
      if (!(Number.isFinite(f.station) && (f.station ?? -1) >= 0)) issues.push(err('feature.station', 'Progressiva non valida'));
      if (f.kind === 'speed_hump' || f.kind === 'speed_cushion') {
        const lim = humpLimits(road.speedKmh);
        if (!lim) issues.push(err('feature.speed', `Dossi ammessi solo su strade con limite ≤ 50 km/h (art. 179 Reg. CdS): «${road.name}» ha ${road.speedKmh} km/h`, [road.id]));
        else {
          if (f.heightM > lim.maxHeightM + 1e-9) issues.push(warn('feature.height', `Altezza ${Math.round(f.heightM * 100)} cm oltre ${Math.round(lim.maxHeightM * 100)} cm per ${road.speedKmh} km/h (art. 179 Reg. CdS)`, [road.id]));
          if (f.lengthM + 2 * f.rampM < lim.minLengthM - 1e-9) issues.push(warn('feature.length', `Larghezza ${Math.round((f.lengthM + 2 * f.rampM) * 100)} cm sotto ${Math.round(lim.minLengthM * 100)} cm (art. 179 Reg. CdS)`, [road.id]));
        }
      }
      if ((f.kind === 'speed_table' || f.kind === 'raised_crossing') && road.speedKmh > 50) issues.push(warn('feature.speed', `Elemento rialzato su strada a ${road.speedKmh} km/h: valuta limite ≤ 30–50 km/h e segnaletica di preavviso`, [road.id]));
    }
    if (!(f.heightM >= 0 && f.heightM <= 0.2)) issues.push(err('feature.height', 'Altezza 0–20 cm'));
    if (!(f.lengthM >= 0 && f.lengthM <= 40) || !(f.rampM >= 0 && f.rampM <= 6)) issues.push(err('feature.size', 'Dimensioni non valide'));
    return issues;
  },
  apply: (net, p) => ({ ...net, features: { ...(net.features ?? {}), [p.feature.id]: p.feature } }),
});

export const featureRemove = defineOperation<{ readonly featureIds: readonly string[] }>({
  type: 'feature.remove',
  label: (p) => (p.featureIds.length === 1 ? 'Rimuovi elemento stradale' : `Rimuovi ${p.featureIds.length} elementi stradali`),
  validate: (net, p) => (p.featureIds.every((id) => net.features?.[id]) ? [] : [err('feature.missing', 'Elemento inesistente')]),
  apply(net, p) {
    const features = { ...(net.features ?? {}) };
    for (const id of p.featureIds) { const f = features[id]!; if (f.state === 'existing') features[id] = { ...f, state: 'removed' }; else delete features[id]; }
    return { ...net, features };
  },
});

/** Custom horizontal marking. */
export const markingSet = defineOperation<{ readonly marking: Marking }>({
  type: 'marking.set',
  label: (p) => `Segnaletica orizzontale: ${p.marking.kind}`,
  validate(net, p) {
    const m = p.marking;
    const min = m.kind === 'hatch' || m.kind === 'box_junction' ? 3 : 2;
    if (m.geometry.length < min || !m.geometry.every(okLL)) return [err('marking.geometry', `Geometria non valida (minimo ${min} punti)`)];
    if (m.kind === 'text' && !(m.text && m.text.trim().length >= 1 && m.text.length <= 12)) return [err('marking.text', 'Scritta di 1–12 caratteri')];
    if (m.widthM !== undefined && !(m.widthM > 0.05 && m.widthM <= 1)) return [err('marking.width', 'Larghezza striscia 5–100 cm')];
    const ranges = {dashM:[.1,30],gapM:[.05,30],doubleSpacingM:[.05,3],offsetM:[-50,50],scale:[.1,20],repeatM:[1,500]};
    for(const [key,[low,high]] of Object.entries(ranges)) { const v=m[key as keyof typeof ranges];if(v!==undefined&&(!Number.isFinite(v)||v<low!||v>high!))return[err('marking.parameter',`${key} fuori intervallo`)]; }
    if(m.hatch && (!Object.values(m.hatch).every(Number.isFinite) || m.hatch.stripeWidthM<.05 || m.hatch.stripeWidthM>2 || m.hatch.spacingM<m.hatch.stripeWidthM || m.hatch.spacingM>20 || m.hatch.borderM<0 || m.hatch.borderM>1))return[err('marking.hatch','Parametri zebratura non validi')];
    if(m.binding) { const r=net.roads[m.binding.roadId];if(!r || m.binding.laneId && !r.lanes.some((l)=>l.id===m.binding!.laneId) || !Number.isFinite(m.binding.fromS)||!Number.isFinite(m.binding.toS)||m.binding.fromS<0||m.binding.toS<=m.binding.fromS)return[err('marking.binding','Collegamento corsia o progressive non validi')]; }

    return [];
  },
  apply: (net, p) => ({ ...net, markings: { ...(net.markings ?? {}), [p.marking.id]: p.marking } }),
});

export const markingRemove = defineOperation<{ readonly markingIds: readonly string[] }>({
  type: 'marking.remove',
  label: () => 'Rimuovi segnaletica orizzontale',
  validate: (net, p) => (p.markingIds.every((id) => net.markings?.[id]) ? [] : [err('marking.missing', 'Segnaletica inesistente')]),
  apply(net, p) {
    const markings = { ...(net.markings ?? {}) };
    for (const id of p.markingIds) { const m = markings[id]!; if (m.state === 'existing') markings[id] = { ...m, state: 'removed' }; else delete markings[id]; }
    return { ...net, markings };
  },
});

/** Bridge / viaduct / tunnel on a road (null removes it). */
export const roadSetStructure = defineOperation<{ readonly roadIds: readonly string[]; readonly structure: RoadStructure | null }>({
  type: 'road.setStructure',
  label: (p) => (p.structure ? ({ bridge: 'Ponte', viaduct: 'Viadotto', tunnel: 'Galleria', covered: 'Sottopasso coperto' })[p.structure.type] : 'Strada a raso'),
  validate(net, p) {
    if (!p.roadIds.length || p.roadIds.some((id) => !net.roads[id])) return [err('road.missing', 'Strada inesistente')];
    const s = p.structure;
    if (s && !['bridge','viaduct','tunnel','covered'].includes(s.type))return [err('structure.type','Tipo struttura non valido')];
    if (s && !(s.heightM >= 0 && s.heightM <= 80 && Number.isInteger(s.layer) && Math.abs(s.layer) <= 5)) return [err('structure.values', 'Altezza 0–80 m, livello intero −5…5')];
    if (s && (s.type === 'bridge' || s.type === 'viaduct') && s.heightM < 5.0) return [warn('structure.clearance', `Franco ${s.heightM.toFixed(1)} m: per strade sottostanti servono di norma ≥ 5,00 m (DM 5/11/2001)`)];
    return [];
  },
  apply(net, p) {
    const roads = { ...net.roads };
    for (const id of p.roadIds) {
      const r = roads[id]!;
      const { structure: _s, ...source } = r;
      const passage=_s?.underpass;
      const rest=passage?{...source,...passage.previousTraffic,...(passage.previousVertical!==undefined?{vertical:passage.previousVertical??undefined}:{})}:source;
      roads[id] = { ...(p.structure ? { ...rest, structure: p.structure } : rest), provenance: { ...rest.provenance, structure: { kind: 'project', source: 'DRIP Urban scenario' } } } as Road;
    }
    return { ...net, roads };
  },
});

/** Turn arrows per lane (corsie di preselezione). */
export const roadSetLaneTurns = defineOperation<{ readonly roadId: string; readonly turns: Readonly<Record<string, readonly TurnKind[]>> }>({
  type: 'road.setLaneTurns',
  label: () => 'Corsie di preselezione',
  validate(net, p) {
    const road = net.roads[p.roadId];
    if (!road) return [err('road.missing', 'Strada inesistente')];
    const bad = Object.keys(p.turns).filter((id) => !road.lanes.some((l) => l.id === id));
    return bad.length ? [err('lane.missing', `Corsie inesistenti: ${bad.join(', ')}`)] : [];
  },
  apply(net, p) {
    const road = net.roads[p.roadId]!;
    const lanes = road.lanes.map((l) => (p.turns[l.id] ? { ...l, turns: [...p.turns[l.id]!] } : l));
    return { ...net, roads: { ...net.roads, [road.id]: { ...road, lanes, provenance: { ...road.provenance, lanes: { kind: 'project', source: 'DRIP Urban scenario' } } } } };
  },
});

/** Removes (or restores) baseline buildings in the scenario, e.g. to place an imported model. */
export const buildingRemove = defineOperation<{ readonly buildingIds: readonly string[]; readonly restore?: boolean }>({
  type: 'building.remove',
  label: (p) => (p.restore ? 'Ripristina edifici' : p.buildingIds.length === 1 ? 'Demolisci edificio' : `Demolisci ${p.buildingIds.length} edifici`),
  validate: (_net, p) => (p.buildingIds.length ? [] : [err('building.none', 'Nessun edificio')]),
  apply(net: Network, p) {
    const removedBuildings = { ...(net.removedBuildings ?? {}) };
    for (const id of p.buildingIds) { if (p.restore) delete removedBuildings[id]; else removedBuildings[id] = true; }
    return { ...net, removedBuildings };
  },
});
