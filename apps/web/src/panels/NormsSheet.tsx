import { Fragment, useEffect, useMemo, useRef } from 'react';
import { NORMS, RULES, citeNorm, normById, searchNorms, type ComplianceFinding, type Severity } from '@drip-urban/core';
import {
  SEVERITY_LABEL, complianceReportHtml, drawFindings, findingsCsv, focusFinding, runChecks, setOverlay, useNorms, visibleFindings,
} from '../state/norms';
import { useApp } from '../state/store';
import { Button, Empty, Segmented, Toggle } from '../ui/controls';
import { NormRef } from '../ui/NormRef';
import '../ui/norms.css';

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const slug = (s: string) => s.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function download(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** «Normativa e verifiche»: compliance findings of the scenario and the normative library. */
export function NormsSheet() {
  const tab = useNorms((s) => s.tab);
  return (
    <>
      <div className="norms-tabs">
        <Segmented<'checks' | 'library'> label="Sezione" value={tab} onChange={(v) => useNorms.setState({ tab: v })}
          options={[{ value: 'checks', label: 'Verifiche' }, { value: 'library', label: 'Riferimenti' }]} />
      </div>
      {tab === 'checks' ? <ChecksTab /> : <LibraryTab />}
    </>
  );
}

function ChecksTab() {
  const netVersion = useApp((s) => s.netVersion);
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const user = useApp((s) => s.user);
  const { findings, version, ms, severities, scope, overlay } = useNorms();

  // Recompute when the scenario changes while the sheet is open (debounced).
  useEffect(() => {
    if (version === netVersion && findings) return;
    const t = setTimeout(() => runChecks(), findings ? 400 : 0);
    return () => clearTimeout(t);
  }, [netVersion, version, findings, scope]);
  useEffect(() => { drawFindings(); }, [severities, overlay]);

  const shown = useMemo(() => visibleFindings({ findings, severities }), [findings, severities]);
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const f of findings ?? []) c[f.severity]++;
    return c;
  }, [findings]);
  const groups = useMemo(() => {
    const m = new Map<string, ComplianceFinding[]>();
    for (const f of shown) (m.get(f.normId) ?? m.set(f.normId, []).get(f.normId)!).push(f);
    const order = new Map(NORMS.map((n, i) => [n.id, i]));
    return [...m].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
  }, [shown]);

  if (!findings) return <Empty icon="law" title="Verifiche in corso">Controllo della rete dello scenario rispetto ai valori di riferimento delle norme.</Empty>;
  const name = project?.name ?? 'Progetto';
  const meta = { project: name, scenario: scenario?.name ?? '', author: user?.name };
  const toggleSev = (s: Severity) => useNorms.setState((st) => ({ severities: { ...st.severities, [s]: !st.severities[s] } }));
  const LIMIT = 300;
  let left = LIMIT;

  return (
    <>
      <p className="muted">Verifiche semplificate a livello di progetto preliminare. Gli elementi esistenti sono segnalati un livello più in basso: il DM 5/11/2001 vale per le nuove costruzioni ed è riferimento per gli adeguamenti (<NormRef id="dm-2004" />).</p>
      <div className="norms-counts" role="group" aria-label="Filtra per esito">
        {SEVERITIES.map((s) => (
          <button key={s} type="button" className={`norms-count ${s} ${severities[s] ? 'is-on' : ''}`} aria-pressed={severities[s]} onClick={() => toggleSev(s)}>
            {counts[s]} · {SEVERITY_LABEL[s]}
          </button>
        ))}
      </div>
      <Segmented<'all' | 'project'> size="sm" label="Ambito" value={scope} onChange={(v) => { useNorms.setState({ scope: v }); runChecks(); }}
        options={[{ value: 'all', label: 'Tutta la rete' }, { value: 'project', label: 'Solo progetto' }]} />
      <Toggle label="Mostra gli esiti sulla mappa" checked={overlay} onChange={setOverlay} />
      <div className="norms-actions">
        <Button size="sm" icon="refresh" onClick={() => runChecks()}>Ricalcola</Button>
        <Button size="sm" icon="download" disabled={!shown.length} onClick={() => download(`verifiche-${slug(name)}.csv`, new Blob([findingsCsv(shown)], { type: 'text/csv;charset=utf-8' }))}>CSV</Button>
        <Button size="sm" icon="export" onClick={() => download(`relazione-conformita-${slug(name)}.html`, new Blob([complianceReportHtml(shown, meta)], { type: 'text/html;charset=utf-8' }))}>Relazione HTML</Button>
        <Button size="sm" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(complianceReportHtml(shown, meta)); w.document.close(); w.focus(); w.print(); } }}>Stampa</Button>
      </div>
      {!shown.length ? <Empty icon="check" title="Nessun rilievo">{findings.length ? 'Nessun esito con i filtri attivi.' : 'Nessun rilievo sulle regole verificate.'}</Empty> : null}
      {groups.map(([normId, list]) => {
        const n = normById(normId);
        const cut = list.slice(0, Math.max(0, left));
        left -= cut.length;
        return (
          <section key={normId} className="norms-group">
            <header><strong>{n?.short ?? normId}</strong><span>{n?.name}</span><span className="spacer" /><span className="muted">{list.length}</span></header>
            <ul className="norms-list">
              {cut.map((f) => (
                <li key={f.id}>
                  <button type="button" className={`norms-item ${f.severity}`} onClick={() => focusFinding(f)} title={f.message}>
                    <span className="dot" aria-label={SEVERITY_LABEL[f.severity]} />
                    <span><strong>{f.title}</strong>{f.message}<br /><span className="art">{citeNorm(f.normId, f.article)}{f.existing ? ' · esistente' : ''}</span></span>
                  </button>
                </li>
              ))}
            </ul>
            {cut.length < list.length ? <p className="muted">Altri {list.length - cut.length} esiti: usa l'esportazione CSV o restringi i filtri.</p> : null}
          </section>
        );
      })}
      <p className="muted">{findings.length} esiti in {ms} ms · {RULES.length} regole verificate.</p>
    </>
  );
}

function LibraryTab() {
  const query = useNorms((s) => s.query);
  const focus = useNorms((s) => s.focus);
  const list = useMemo(() => searchNorms(query), [query]);
  const focusRef = useRef<HTMLElement>(null);
  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [focus]);
  return (
    <>
      <input className="text-field search" placeholder="Cerca: «marciapiedi», «rotatorie», «art. 142», «ZTL»…" value={query} aria-label="Cerca nella normativa"
        onChange={(e) => useNorms.setState({ query: e.target.value, focus: null })} />
      <p className="muted">{list.length} riferimenti. Consultare sempre il testo vigente sulle fonti ufficiali.</p>
      {list.map((n) => (
        <article key={n.id} className={`norm-card ${focus === n.id ? 'is-focus' : ''}`} ref={focus === n.id ? focusRef : undefined}>
          <h4>{n.short} — {n.name}</h4>
          <p className="title">{n.title}</p>
          <p className="muted">{n.issuer} · {n.scope}</p>
          <dl>{n.articles.map((a) => <Fragment key={a.ref}><dt>{a.ref}</dt><dd>{a.summary}</dd></Fragment>)}</dl>
          {n.statusNote ? <p className="status">{n.status === 'norma_tecnica' ? 'Norma tecnica' : 'Vigente'}. {n.statusNote}</p> : null}
          {n.url ? <p><a href={n.url} target="_blank" rel="noreferrer">Testo ufficiale</a></p> : null}
        </article>
      ))}
    </>
  );
}
