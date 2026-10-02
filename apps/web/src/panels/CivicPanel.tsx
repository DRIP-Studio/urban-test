import { useEffect, useMemo, useState } from 'react';
import { NetworkReplayer } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { fc, type Feature, type FeatureCollection } from '../engine/geojson';
import { flyTo, setSource, toggleLayer } from '../map/mapStore';
import { navigate, newId, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Skeleton, TextField } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { CivicLockup } from '../shell/Brand';
import { scenarioMetrics } from './ComparePanel';

interface FstReport { id: number; title: string; body: string; category: string; status: string; workflow_label?: string; priority?: string; district?: string; location_text?: string; geometry: { type: string; coordinates: number[] }; photo_url?: string; photo_available?: boolean; created_at?: string; competent_body?: string }
interface FstProject { id: number; title: string; description: string; category: string; geometry: { type: string; coordinates: unknown }; address?: string; implementer?: string; funding?: unknown; updated_at?: string }
interface Feed<T> { status: string; source?: string; fetchedAt?: string; message?: string; items: T[] }
interface CivicTask { id: string; reportId: number; title: string; category: string; at: [number, number]; createdAt: string; scenarioId: string; note: string }
interface Publication { id: string; title: string; status: string; publishedAt: string; publishedBy: string; scenarioName?: string; withdrawnAt?: string }

const STATUS_IT: Record<string, string> = { proposta: 'Proposta', in_valutazione: 'In valutazione', approvato: 'Approvato', finanziato: 'Finanziato', in_corso: 'In corso', completato: 'Completato', sospeso: 'Sospeso' };

function useFst<T>(kind: 'reports' | 'projects') {
  const [feed, setFeed] = useState<Feed<T> | null>(null);
  useEffect(() => { api.get<Feed<T>>(`/api/civic/fst/${kind}`).then(setFeed).catch((e) => setFeed({ status: 'error', message: String(e), items: [] })); }, [kind]);
  return feed;
}

function Reports() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const feed = useFst<FstReport>('reports');
  const [tasks, setTasks] = useState<CivicTask[]>([]);
  useEffect(() => { if (project) api.get<{ tasks?: CivicTask[] } | null>(`/api/projects/${project.id}/docs/civic`).then((d) => setTasks(d?.tasks ?? [])).catch(() => setTasks([])); }, [project]);
  useEffect(() => {
    if (!feed) return;
    setSource('civic', fc(feed.items.filter((r) => r.geometry?.type === 'Point').map((r): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: r.geometry.coordinates as [number, number] }, properties: { id: `r${r.id}`, kind: 'report', title: r.title } }))));
    toggleLayer('civic', true);
  }, [feed]);
  const toTask = async (r: FstReport) => {
    if (!project || !scenario) return;
    const t: CivicTask = { id: newId('task'), reportId: r.id, title: r.title, category: r.category, at: r.geometry.coordinates as [number, number], createdAt: new Date().toISOString(), scenarioId: scenario.id, note: '' };
    const doc = (await api.get<Record<string, unknown> | null>(`/api/projects/${project.id}/docs/civic`)) ?? {};
    const next = [...tasks, t];
    await api.put(`/api/projects/${project.id}/docs/civic`, { ...doc, tasks: next });
    setTasks(next);
    toast.success('Attività di progetto creata', `Dalla segnalazione #${r.id}: lavora nello scenario «${scenario.name}» e pubblica l'esito.`);
  };
  if (!feed) return <Skeleton lines={4} />;
  if (feed.status !== 'ok') return <Empty icon="warning" title="Piattaforma FST non raggiungibile">{feed.message}</Empty>;
  return (
    <>
      <Section title="Segnalazioni dei cittadini" count={feed.items.length}>
        <p className="muted">Fonte: {feed.source}, letta il {feed.fetchedAt ? new Date(feed.fetchedAt).toLocaleString('it-IT') : '—'}. Gli stati sono quelli della piattaforma FST: DRIP Urban non li modifica.</p>
        <ul className="report-list">
          {feed.items.map((r) => {
            const task = tasks.find((t) => t.reportId === r.id);
            return (
              <li key={r.id}>
                {r.photo_available && r.photo_url ? <img src={r.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="report-noimg"><Icon name="pin" /></span>}
                <div>
                  <strong>{r.title}</strong>
                  <span className="muted">{r.category} · {r.district ?? ''}</span>
                  <span className="badge-status">{r.workflow_label ?? r.status}</span>
                  <div className="row-actions">
                    <button type="button" className="link" onClick={() => flyTo(r.geometry.coordinates as [number, number], 19)}>Mostra</button>
                    {task ? <span className="ok">Attività di progetto aperta</span> : <button type="button" className="link" onClick={() => void toTask(r)}>Trasforma in attività di progetto</button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
      {tasks.length ? (
        <Section title="Attività aperte dalle segnalazioni" count={tasks.length}>
          <ul className="issue-list">{tasks.map((t) => <li key={t.id}><Icon name="doc" size={14} /><button type="button" className="link" onClick={() => flyTo(t.at, 19)}>#{t.reportId} {t.title}</button></li>)}</ul>
        </Section>
      ) : null}
    </>
  );
}

function Projects() {
  const feed = useFst<FstProject>('projects');
  useEffect(() => {
    if (!feed) return;
    const feats: Feature[] = [];
    for (const p of feed.items) {
      const g = p.geometry as { type: string; coordinates: unknown };
      if (g.type === 'MultiPoint') (g.coordinates as number[][]).forEach((c, i) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { id: `p${p.id}-${i}`, kind: 'project', title: p.title } }));
      else feats.push({ type: 'Feature', geometry: g as never, properties: { id: `p${p.id}`, kind: 'project', title: p.title } });
    }
    setSource('civic', fc(feats));
    toggleLayer('civic', true);
  }, [feed]);
  if (!feed) return <Skeleton lines={4} />;
  if (feed.status !== 'ok') return <Empty icon="warning" title="Piattaforma FST non raggiungibile">{feed.message}</Empty>;
  const first = (p: FstProject): [number, number] | null => {
    const c = p.geometry.coordinates as unknown;
    const flat = (x: unknown): number[] | null => (Array.isArray(x) && typeof x[0] === 'number' ? (x as number[]) : Array.isArray(x) ? flat(x[0]) : null);
    const f = flat(c);
    return f ? [f[0]!, f[1]!] : null;
  };
  return (
    <Section title="Progetti FST" count={feed.items.length}>
      <p className="muted">Schede pubblicate sulla piattaforma FST (geometrie incluse). Fonte: {feed.source}.</p>
      <ul className="report-list compact">{feed.items.map((p) => (
        <li key={p.id}><div><strong>{p.title.length > 110 ? `${p.title.slice(0, 110)}…` : p.title}</strong><span className="muted">{p.category}{p.address ? ` · ${p.address}` : ''}</span>
          <div className="row-actions">{first(p) ? <button type="button" className="link" onClick={() => flyTo(first(p)!, 18)}>Mostra in mappa</button> : null}</div></div></li>
      ))}</ul>
    </Section>
  );
}

function Publish() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const baseline = useApp((s) => s.baseline);
  const net = useApp((s) => s.network);
  const user = useApp((s) => s.user);
  const catalogs = useApp((s) => s.catalogs);
  const [f, setF] = useState({ title: '', summary: '', story: '', status: 'proposta', responsibleBody: '', estimatedCostEur: 0, costSource: '' });
  const [docs, setDocs] = useState<{ title: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const permeable = useMemo(() => new Set(catalogs?.materials.items.filter((m) => m.permeable).map((m) => m.id)), [catalogs]);
  if (!project || !scenario || !baseline || !net) return null;
  if (scenario.isBaseline) return <Empty icon="civic" title="Scegli uno scenario">Si pubblica uno scenario di progetto, non lo stato attuale.</Empty>;
  const publish = async () => {
    setBusy(true);
    try {
      const before = await engine.job<{ surfaces: FeatureCollection; markings: FeatureCollection }>('physicalFor', { ops: [] });
      const after = engine.lastPhysical!;
      const changed = after.surfaces.features.filter((x) => x.properties.state === 'project');
      const roadIds = new Set(changed.map((x) => x.properties.roadId).filter(Boolean));
      const nodeIds = new Set(changed.map((x) => x.properties.nodeId).filter(Boolean));
      if (!changed.length && !Object.values(net.assets).some((a) => a.state === 'project')) { toast.warn('Niente da pubblicare', 'Lo scenario non contiene modifiche di progetto.'); return; }
      const pts = changed.flatMap((x) => (x.geometry.coordinates as number[][][])[0]!);
      const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
      const pad = 0.0015;
      const bbox = pts.length ? [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad] : project.bbox;
      const inBox = (x: Feature) => (x.geometry.coordinates as number[][][])[0]!.some((p) => p[0]! >= bbox[0]! && p[0]! <= bbox[2]! && p[1]! >= bbox[1]! && p[1]! <= bbox[3]!);
      const assets = Object.values(net.assets).filter((a) => a.state === 'project').map((a): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...a.at] }, properties: { type: a.type } }));
      const mBase = scenarioMetrics(new NetworkReplayer().derive(baseline, []).net, baseline, permeable);
      const mNow = scenarioMetrics(net, baseline, permeable);
      const metrics = [
        { label: 'Strade modificate', before: 0, after: mNow.roadsChanged, unit: '' },
        { label: 'Superfici drenanti', before: Math.round(mBase.greenM2), after: Math.round(mNow.greenM2), unit: 'm²' },
        { label: 'Alberi', before: mBase.trees, after: mNow.trees, unit: '' },
        { label: 'Sosta su strada (stima da sezione)', before: Math.round(mBase.parkingM2), after: Math.round(mNow.parkingM2), unit: 'm²' },
        { label: 'Incroci semaforizzati', before: mBase.signals, after: mNow.signals, unit: '' },
        { label: 'Rotatorie', before: mBase.roundabouts, after: mNow.roundabouts, unit: '' },
      ];
      const body = {
        ...f, estimatedCostEur: f.estimatedCostEur > 0 ? f.estimatedCostEur : null, scenarioId: scenario.id, scenarioName: scenario.name, documents: docs, metrics, bbox,
        sources: ['OpenStreetMap contributors (ODbL)', `Scenario «${scenario.name}» del progetto «${project.name}» (DRIP Urban)`],
        geometry: {
          before: { type: 'FeatureCollection', features: before.surfaces.features.filter((x) => (roadIds.has(x.properties.roadId) || nodeIds.has(x.properties.nodeId) || inBox(x))) },
          after: { type: 'FeatureCollection', features: [...after.surfaces.features.filter(inBox), ...after.markings.features.filter(inBox)] },
          assets: { type: 'FeatureCollection', features: assets },
          buildings: { type: 'FeatureCollection', features: Object.values(baseline.buildings).filter((bd) => bd.footprint.some((p) => p[0] >= bbox[0]! && p[0] <= bbox[2]! && p[1] >= bbox[1]! && p[1] <= bbox[3]!)).map((bd): Feature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...bd.footprint.map((p) => [p[0], p[1]]), [bd.footprint[0]![0], bd.footprint[0]![1]]]] }, properties: {} })) },
        },
      };
      const rec = await api.post<{ id: string }>(`/api/projects/${project.id}/publish`, body);
      toast.success('Pubblicato', 'La pagina civica è pronta.');
      navigate({ view: 'publication', pubId: rec.id });
    } catch (e) { toast.error('Pubblicazione non riuscita', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (!user?.canPublish) return <Empty icon="lock" title="Pubblicazione non consentita">Il ruolo «{user?.role}» non può pubblicare. Un amministratore può cambiarlo in Impostazioni.</Empty>;
  return (
    <Section title={`Pubblica «${scenario.name}»`}>
      <Field label="Titolo"><TextField value={f.title} ariaLabel="Titolo" onCommit={(v) => setF({ ...f, title: v })} placeholder="es. Via Roma più sicura per chi va a piedi" /></Field>
      <Field label="Sintesi"><TextField multiline value={f.summary} ariaLabel="Sintesi" onCommit={(v) => setF({ ...f, summary: v })} /></Field>
      <Field label="Racconto (facoltativo)"><TextField multiline value={f.story} ariaLabel="Racconto" onCommit={(v) => setF({ ...f, story: v })} /></Field>
      <div className="grid-2">
        <Field label="Stato"><Select value={f.status} ariaLabel="Stato" options={Object.entries(STATUS_IT).map(([value, label]) => ({ value, label }))} onChange={(v) => setF({ ...f, status: v })} /></Field>
        <Field label="Soggetto responsabile"><TextField value={f.responsibleBody} ariaLabel="Responsabile" onCommit={(v) => setF({ ...f, responsibleBody: v })} placeholder="es. Proposta FST · Comune di…" /></Field>
        <Field label="Costo stimato (facoltativo)"><NumberField value={f.estimatedCostEur} unit="€" min={0} max={1e9} decimals={0} ariaLabel="Costo" onCommit={(v) => setF({ ...f, estimatedCostEur: v })} /></Field>
        <Field label="Fonte del costo"><TextField value={f.costSource} ariaLabel="Fonte costo" onCommit={(v) => setF({ ...f, costSource: v })} /></Field>
      </div>
      <Field label="Documenti">
        <div className="doc-list">
          {docs.map((d, i) => <div key={i} className="doc-row"><TextField value={d.title} ariaLabel="Titolo documento" onCommit={(v) => setDocs(docs.map((x, j) => (j === i ? { ...x, title: v } : x)))} /><TextField value={d.url} ariaLabel="URL documento" onCommit={(v) => setDocs(docs.map((x, j) => (j === i ? { ...x, url: v } : x)))} /><Button size="sm" variant="ghost" icon="trash" onClick={() => setDocs(docs.filter((_, j) => j !== i))} /></div>)}
          <Button size="sm" icon="plus" onClick={() => setDocs([...docs, { title: '', url: 'https://' }])}>Aggiungi documento</Button>
        </div>
      </Field>
      <p className="muted">Pubblicato da {user.name}. La pagina mostra prima/dopo, metriche calcolate dal modello e le fonti; i campi vuoti non vengono riempiti con dati di esempio.</p>
      <Button variant="primary" icon="civic" busy={busy} disabled={!f.title || !f.summary || !f.responsibleBody} onClick={() => void publish()}>Pubblica sul portale civico</Button>
    </Section>
  );
}

function Publications() {
  const project = useApp((s) => s.project);
  const [list, setList] = useState<Publication[] | null>(null);
  const load = () => project && api.get<Publication[]>(`/api/civic/publications?projectId=${project.id}`).then(setList);
  useEffect(() => { void load(); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <Skeleton lines={3} />;
  if (!list.length) return <Empty icon="civic" title="Nessuna pubblicazione">Le pubblicazioni di questo progetto compariranno qui.</Empty>;
  return (
    <Section title="Pubblicazioni" count={list.length}>
      <ul className="issue-list">{list.map((p) => (
        <li key={p.id}>
          <Icon name="civic" size={14} />
          <span><strong>{p.title}</strong> · {STATUS_IT[p.status] ?? p.status} · {new Date(p.publishedAt).toLocaleDateString('it-IT')} · {p.publishedBy}{p.withdrawnAt ? ' · ritirata' : ''}</span>
          {!p.withdrawnAt ? <><button type="button" className="link" onClick={() => navigate({ view: 'publication', pubId: p.id })}>Apri</button>
            <button type="button" className="link danger" onClick={() => void api.post(`/api/civic/publications/${p.id}/withdraw`).then(load)}>Ritira</button></> : null}
        </li>
      ))}</ul>
    </Section>
  );
}

type Tab = 'reports' | 'projects' | 'publish' | 'publications';
export function CivicPanel() {
  const [tab, setTab] = useState<Tab>('reports');
  useEffect(() => () => setSource('civic', null), []);
  return (
    <div className="panel-stack civic-panel">
      <CivicLockup />
      <Segmented<Tab> label="Civico" size="sm" value={tab} onChange={setTab} options={[{ value: 'reports', label: 'Segnalazioni' }, { value: 'projects', label: 'Progetti FST' }, { value: 'publish', label: 'Pubblica' }, { value: 'publications', label: 'Pubblicate' }]} />
      {tab === 'reports' ? <Reports /> : tab === 'projects' ? <Projects /> : tab === 'publish' ? <Publish /> : <Publications />}
    </div>
  );
}
