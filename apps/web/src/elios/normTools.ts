import { citeNorm, searchNorms, summarizeFindings, type Severity } from '@drip-urban/core';
import { drawFindings, runChecks, setOverlay, useNorms } from '../state/norms';
import { openDock } from '../state/store';
import { registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });

registerEliosTools([
  {
    name: 'check_compliance', kind: 'read', label: 'Verificata la conformità normativa',
    description: 'Verifica di conformità dello scenario rispetto alla normativa (CdS e Regolamento, DM 5/11/2001, DM 19/4/2006, DM 557/1999, DM 236/1989, DPR 503/1996, ZTL, sosta riservata…): conteggi per esito e per norma e i rilievi principali, con riferimento ad articolo. Apre il pannello «Normativa e verifiche» e mostra gli esiti sulla mappa.',
    parameters: OBJ({
      scope: { type: 'STRING', enum: ['all', 'project'], description: 'all = tutta la rete (predefinito), project = solo elementi di progetto' },
      severity: { type: 'STRING', enum: ['error', 'warning', 'info'], description: 'Esito minimo da elencare (predefinito warning)' },
      limit: { type: 'NUMBER', description: 'Numero massimo di rilievi elencati (predefinito 15)' },
    }),
    run(a) {
      if (a.scope === 'all' || a.scope === 'project') useNorms.setState({ scope: a.scope });
      const findings = runChecks();
      const min: Severity = a.severity === 'error' || a.severity === 'info' ? a.severity : 'warning';
      const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
      useNorms.setState({ tab: 'checks', severities: { error: true, warning: rank[min] >= 1, info: rank[min] >= 2 } });
      setOverlay(true);
      drawFindings();
      openDock('norms');
      const s = summarizeFindings(findings);
      const top = findings.filter((f) => rank[f.severity] <= rank[min]).slice(0, Math.min(50, Number(a.limit) || 15));
      return {
        total: s.total, counts: s.counts, byNorm: s.byNorm.map((x) => ({ norm: x.cite, ...x.counts })),
        findings: top.map((f) => ({ severity: f.severity, title: f.title, message: f.message, reference: citeNorm(f.normId, f.article), existing: !!f.existing, value: f.value, limit: f.limit, unit: f.unit })),
        note: 'Verifiche semplificate; gli elementi esistenti sono segnalati un livello più in basso (DM 5/11/2001 vale per le nuove costruzioni, DM 22/4/2004).',
      };
    },
  },
  {
    name: 'explain_norm', kind: 'read', label: 'Consultata la normativa',
    description: 'Cerca nella libreria normativa (leggi, decreti, regolamenti, norme UNI, CAM) per parola chiave, sigla o articolo (es. «marciapiedi», «rotatorie», «DM 557», «art. 142», «ZTL») e restituisce titolo, stato, articoli chiave e fonte ufficiale.',
    parameters: OBJ({ query: { type: 'STRING', description: 'Parole chiave' }, open: { type: 'BOOLEAN', description: 'Apri il risultato nel pannello Riferimenti' } }, ['query']),
    run(a) {
      const q = String(a.query ?? '');
      const found = searchNorms(q).slice(0, 5);
      if (!found.length) return { found: 0, message: `Nessun riferimento per «${q}» nella libreria` };
      if (a.open) { useNorms.setState({ tab: 'library', query: q, focus: found[0]!.id }); openDock('norms'); }
      return {
        found: found.length,
        norms: found.map((n) => ({
          id: n.id, citation: n.short, name: n.name, title: n.title, issuer: n.issuer, date: n.date, scope: n.scope,
          status: n.status, statusNote: n.statusNote, articles: n.articles, url: n.url ?? null,
        })),
        note: 'Sintesi di riferimento: consultare sempre il testo vigente sulla fonte ufficiale.',
      };
    },
  },
]);
