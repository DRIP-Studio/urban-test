import type { FunctionalClass, Road } from '../model/types';
import { FUNCTIONAL_CLASSES, FUNCTIONAL_LABEL } from '../analysis/trafficplan';
import { defineOperation, type Issue } from './registry';

const err = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'error', message, ...(targetIds ? { targetIds } : {}) });

export interface RoadSetFunctionalClassPayload {
  /** roadId → class; null removes the authored class. */
  readonly classes: Readonly<Record<string, FunctionalClass | null>>;
  /** 'auto' = accepted DRIP proposal, 'manual' = designer's choice (provenance). */
  readonly source?: 'auto' | 'manual';
}

/** PGTU functional classification of one or many roads (one undo step). */
export const roadSetFunctionalClass = defineOperation<RoadSetFunctionalClassPayload>({
  type: 'road.setFunctionalClass',
  label(p) {
    const vals = Object.values(p.classes);
    if (vals.length === 1) return vals[0] ? `Classe funzionale: ${FUNCTIONAL_LABEL[vals[0]].toLowerCase()}` : 'Rimuovi classe funzionale';
    return p.source === 'auto' ? `Classificazione funzionale automatica (${vals.length} strade)` : `Classe funzionale di ${vals.length} strade`;
  },
  validate(net, p) {
    const issues: Issue[] = [];
    const ids = Object.keys(p.classes);
    if (!ids.length) issues.push(err('fc.none', 'Nessuna strada'));
    const missing = ids.filter((id) => !net.roads[id]);
    if (missing.length) issues.push(err('road.missing', `Strade inesistenti: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`, missing));
    const bad = Object.entries(p.classes).filter(([, c]) => c !== null && !FUNCTIONAL_CLASSES.includes(c));
    if (bad.length) issues.push(err('fc.class', `Classe funzionale non valida: ${String(bad[0]![1])}`, bad.map(([id]) => id)));
    return issues;
  },
  apply(net, p) {
    const roads = { ...net.roads };
    const source = p.source === 'auto' ? 'Proposta automatica DRIP (Direttive PGTU 1995) accettata' : 'DRIP Urban scenario';
    for (const [id, c] of Object.entries(p.classes)) {
      const road = roads[id]!;
      const { functionalClass: _old, ...rest } = road;
      const next: Road = { ...(c ? { ...rest, functionalClass: c } : rest), provenance: { ...road.provenance, functionalClass: { kind: 'project', source } } };
      roads[id] = next;
    }
    return { ...net, roads };
  },
});
