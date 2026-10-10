import { useEffect, useRef, useState } from 'react';
import { getProjectTime } from '../state/projectTime';
import { LocalFrame, SERVICE_CATEGORIES, geom, parseCrashCsv, type AccessResult, type AuditItem, type CrashRecord, type NetworkStats, type SafetyScore } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { flyTo, setSource, toggleLayer } from '../map/mapStore';
import { select, setDock, setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { usePicks } from '../tools/picks';
import { Button, Empty, Field, ProvBadge, Section, Segmented, Select, Skeleton, Stat, FieldGroup } from '../ui/controls';
import { Icon } from '../ui/Icon';

type Tab = 'safety' | 'network' | 'access' | 'environment' | 'audit';

function FileButton({ accept, label, onFile }: { accept: string; label: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <Button icon="import" onClick={() => input.current?.click()}>{label}</Button>
    </>
  );
}

function Safety() {
  const project = useApp((s) => s.project);
  const netVersion = useApp((s) => s.netVersion);
  const [crashes, setCrashes] = useState<CrashRecord[]>([]);
  const [rank, setRank] = useState<SafetyScore[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!project) return;
    api.get<{ crashes?: CrashRecord[] } | null>(`/api/projects/${project.id}/docs/safety`).then((d) => setCrashes(d?.crashes ?? [])).catch(() => setCrashes([]));
  }, [project]);
  useEffect(() => {
    setSource('crashes', fc(crashes.map((c): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...c.at] }, properties: { id: c.id, severity: c.severity } }))));
  }, [crashes]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await engine.job<SafetyScore[]>('safety', { crashes, useTraffic: true });
      setRank(r);
      setSource('heat', fc(r.map((s): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...s.at] }, properties: { id: s.nodeId, score: s.score } }))));
      toggleLayer('heat', true);
    } catch (e) { toast.error('Sicurezza', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void run(); }, [netVersion, crashes]); // eslint-disable-line react-hooks/exhaustive-deps
  const importFile = async (f: File) => {
    const text = await f.text();
    let records: CrashRecord[] = [];
    let rejected = 0;
    if (f.name.toLowerCase().endsWith('.geojson') || f.name.toLowerCase().endsWith('.json')) {
      try {
        const gj = JSON.parse(text) as { features?: { geometry?: { type: string; coordinates: number[] }; properties?: Record<string, unknown> }[] };
        (gj.features ?? []).forEach((ft, i) => {
          const c = ft.geometry?.type === 'Point' ? ft.geometry.coordinates : null;
          const pr = ft.properties ?? {};
          const date = String(pr.date ?? pr.data ?? '');
          if (!c || !date) { rejected++; return; }
          const sev = String(pr.severity ?? pr.gravita ?? '').toLowerCase();
          records.push({ id: `crash-${i + 1}`, at: [c[0]!, c[1]!], date, severity: /fatal|mort/.test(sev) ? 'fatal' : /serious|grav/.test(sev) ? 'serious' : /slight|liev/.test(sev) ? 'slight' : 'damage', source: f.name, pedestrian: Boolean(pr.pedestrian ?? pr.pedone), cyclist: Boolean(pr.cyclist ?? pr.ciclista) });
        });
      } catch { toast.error('File non valido', 'Il GeoJSON non è leggibile.'); return; }
    } else {
      const r = parseCrashCsv(text, f.name);
      records = r.records; rejected = r.rejected;
    }
    if (!records.length) { toast.warn('Nessun sinistro importato', `Servono coordinate e data per ogni riga (${rejected} righe scartate).`); return; }
    const next = [...crashes, ...records.map((r, i) => ({ ...r, id: `crash-${crashes.length + i + 1}` }))];
    await api.put(`/api/projects/${project!.id}/docs/safety`, { crashes: next, sources: [...new Set(next.map((c) => c.source))] });
    setCrashes(next);
    toast.success('Sinistri importati', `${records.length} eventi${rejected ? `, ${rejected} righe scartate` : ''}`);
  };
  const observed = rank?.some((r) => r.basis === 'observed');
  return (
    <>
      <Section title="Screening dei punti critici">
        <p className={observed ? 'ok' : 'warn-line'}><Icon name={observed ? 'check' : 'warning'} size={14} />
          {observed ? 'Classifica che include sinistri osservati importati.' : 'Screening SURROGATO: senza dati ufficiali di incidentalità la classifica usa conflitti geometrici, velocità, volumi stimati, esposizione pedonale e angoli. Non è un\'analisi ufficiale dei black point.'}</p>
        <div className="inspector-actions">
          <FileButton accept=".csv,.geojson,.json" label="Importa sinistri (CSV/GeoJSON)" onFile={(f) => void importFile(f)} />
          <Button icon="refresh" busy={busy} onClick={() => void run()}>Ricalcola</Button>
        </div>
        <p className="muted">CSV: colonne data; lat; lon; gravita (mortale/grave/lieve); pedone; ciclista. Sinistri caricati: {crashes.length}.</p>
      </Section>
      {rank ? (
        <Section title="Incroci più critici" count={rank.length}>
          <ol className="rank">
            {rank.slice(0, 15).map((r) => (
              <li key={r.nodeId}>
                <button type="button" onClick={() => { flyTo([r.at[0], r.at[1]], 18.5); select({ kind: 'node', ids: [r.nodeId] }); }}>
                  <span className={`score s${r.score >= 80 ? 3 : r.score >= 60 ? 2 : 1}`}>{r.score}</span>
                  <span className="rank-name">{r.name}</span>
                  <ProvBadge kind={r.basis === 'observed' ? 'measured' : 'estimated'} title={r.basis === 'observed' ? 'Con sinistri osservati' : 'Screening surrogato'} />
                </button>
                <span className="rank-factors">{r.factors.crossingConflicts} attraversamenti · {r.factors.arms} bracci · {r.factors.maxSpeedKmh} km/h · {r.factors.pedestrianExposure} attrattori pedonali{r.factors.volumeVph !== null ? ` · ${r.factors.volumeVph} veic/h stimati` : ''}{r.factors.crashes ? ` · ${r.factors.crashes} sinistri` : ''}</span>
              </li>
            ))}
          </ol>
          <Button size="sm" icon="junction" onClick={() => { setTool('junction'); setDock('junction'); }}>Apri il Junction Lab sull'incrocio selezionato</Button>
        </Section>
      ) : <Skeleton lines={6} />}
    </>
  );
}

function Network() {
  const net = useApp((s) => s.network);
  const [res, setRes] = useState<NetworkStats | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await engine.job<NetworkStats>('network', { ctx: getProjectTime() });
      setRes(r);
      if (net) setSource('traffic', fc(Object.entries(r.centrality).filter(([id]) => net.roads[id]).map(([id, c]): Feature => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((p) => [...p]) }, properties: { ratio: 1 - Math.min(1, c * 1.6) } }))));
      toggleLayer('traffic', true);
    } finally { setBusy(false); }
  };
  return (
    <Section title="Rete stradale">
      <Button icon="play" busy={busy} onClick={() => void run()}>Analizza connettività e centralità</Button>
      {res ? (
        <>
          <div className="stats-row"><Stat label="Componenti" value={res.components} /><Stat label="Rete principale" value={`${(res.largestShare * 100).toFixed(1).replace('.', ',')}%`} /><Stat label="Collegamenti critici" value={res.criticalRoadIds.length} /></div>
          <p className="muted">Colore = centralità (percorsi minimi che attraversano la strada): rosso = più usata. {res.isolatedRoadIds.length} strade fuori dalla rete principale in auto.</p>
          <Button size="sm" onClick={() => select({ kind: 'road', ids: res.criticalRoadIds.slice(0, 200) })}>Seleziona collegamenti critici</Button>
        </>
      ) : null}
    </Section>
  );
}

function Access() {
  const [res, setRes] = useState<AccessResult | null>(null);
  const [minutes, setMinutes] = useState('7');
  const [cat, setCat] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const net = useApp((s) => s.network);
  const { isoMinutes, isoMode } = usePicks();
  const run = async () => {
    setBusy(true);
    try { setRes(await engine.job<AccessResult>('access', { minutes: Number(minutes), mode: 'walk', ctx: getProjectTime() })); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!res || !net) return;
    setSource('iso', fc(Object.entries(res.byRoad).filter(([id]) => net.roads[id]).map(([id, v]): Feature => {
      const vals = Object.values(v);
      const m = cat === 'all' ? (vals.some((x) => x === null) ? 99 : Math.max(...(vals as number[]))) : v[cat] ?? 99;
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((p) => [...p]) }, properties: { minutes: m } };
    })));
    toggleLayer('iso', true);
  }, [res, cat, net]);
  return (
    <>
      <Section title="Città dei 7 minuti">
        <div className="grid-2">
          <FieldGroup label="Soglia"><Segmented<string> label="Soglia" size="sm" value={minutes} onChange={setMinutes} options={['5', '7', '10', '15'].map((m) => ({ value: m, label: `${m}′` }))} /></FieldGroup>
          <Field label="Servizio"><Select value={cat} ariaLabel="Servizio" options={[{ value: 'all', label: 'Tutti i servizi' }, ...Object.entries(SERVICE_CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))]} onChange={setCat} /></Field>
        </div>
        <Button icon="play" busy={busy} onClick={() => void run()}>Calcola a piedi</Button>
        {res ? (
          <>
            <div className="stats-row"><Stat label={`Tutti i servizi in ${res.minutesLimit}′`} value={`${res.coverage.toString().replace('.', ',')}%`} prov="derived" /></div>
            <table className="table"><thead><tr><th>Servizio</th><th>Punti OSM</th><th>Rete coperta</th></tr></thead><tbody>
              {Object.entries(SERVICE_CATEGORIES).map(([k, v]) => <tr key={k}><td>{v.label}</td><td className="mono">{res.serviceCounts[k]}</td><td className="mono">{res.categoryCoverage[k]?.toString().replace('.', ',')}%</td></tr>)}
            </tbody></table>
            <p className="muted">Quota di lunghezza delle strade residenziali da cui il servizio si raggiunge a piedi entro la soglia sulla rete dello scenario. Servizi da OpenStreetMap: la completezza dipende dalla mappatura.</p>
          </>
        ) : null}
      </Section>
      <Section title="Isocrona da un punto">
        <Button icon="walk" onClick={() => setTool('isochrone')}>Scegli un punto sulla mappa</Button>
        {isoMinutes ? <p className="muted">{Object.keys(isoMinutes).length} strade raggiungibili ({isoMode === 'walk' ? 'a piedi' : isoMode}) entro 15 minuti; colori a 5/7/10/15 minuti.</p> : null}
      </Section>
    </>
  );
}

interface EnvResult { status: string; message?: string; weather?: { values: Record<string, number>; units: Record<string, string>; source: string }; air?: { values: Record<string, number>; units: Record<string, string>; source: string; note: string } }

function Environment() {
  const baseline = useApp((s) => s.baseline);
  const net = useApp((s) => s.network);
  const catalogs = useApp((s) => s.catalogs);
  const [env, setEnv] = useState<EnvResult | null>(null);
  useEffect(() => {
    if (!baseline) return;
    let active = true;
    setEnv(null);
    api.get<EnvResult>(`/api/environment?lat=${baseline.origin[1]}&lon=${baseline.origin[0]}`).then(value => { if (active) setEnv(value); }).catch((e) => { if (active) setEnv({ status: 'error', message: String(e) }); });
    return () => { active = false; };
  }, [baseline]);
  const f = baseline ? new LocalFrame(baseline.origin) : null;
  const areaOf = (pts: readonly (readonly [number, number])[]) => (f ? Math.abs(geom.ringArea(pts.map((p) => f.toMetric(p) as geom.V))) : 0);
  const perm = new Set(catalogs?.materials.items.filter((m) => m.permeable).map((m) => m.id));
  const proj = net ? Object.values(net.areas).filter((a) => a.state === 'project' && a.kind !== 'crossing') : [];
  const green = proj.filter((a) => perm.has(a.material)).reduce((s, a) => s + areaOf(a.polygon), 0);
  const trees = net ? Object.values(net.assets).filter((a) => a.type.startsWith('vegetation') && a.state === 'project').length : 0;
  const v = env?.air?.values, u = env?.air?.units, w = env?.weather?.values;
  return (
    <>
      <Section title="Aria e clima (adesso)">
        {env && (v || w) ? (
          <>
            {v ? <div className="stats-row"><Stat label="PM2.5" value={v.pm2_5 ?? '—'} unit={u?.pm2_5} prov="estimated" /><Stat label="PM10" value={v.pm10 ?? '—'} unit={u?.pm10} /><Stat label="NO₂" value={v.nitrogen_dioxide ?? '—'} unit={u?.nitrogen_dioxide} /><Stat label="O₃" value={v.ozone ?? '—'} unit={u?.ozone} /></div> : null}
            {w ? <div className="stats-row"><Stat label="Temperatura" value={w.temperature_2m ?? '—'} unit="°C" /><Stat label="Umidità" value={w.relative_humidity_2m ?? '—'} unit="%" /></div> : null}
            <p className="muted"><ProvBadge kind="estimated" title="Modellato" /> {env.air ? `${env.air.source}. ${env.air.note}. ` : ''}{env.weather ? `Meteo: ${env.weather.source}. ` : ''}CO₂ non disponibile senza sensori: non viene stimata.</p>
            {env.status === 'partial' ? <p className="warn-line">Disponibilità parziale: {env.message}</p> : null}
          </>
        ) : env?.status === 'error' ? <Empty icon="warning" title="Dati ambientali non disponibili">{env.message}</Empty> : <Skeleton lines={3} />}
      </Section>
      <Section title="Verde e permeabilità del progetto">
        <div className="stats-row"><Stat label="Superfici drenanti nuove" value={Math.round(green).toLocaleString('it-IT')} unit="m²" prov="project" /><Stat label="Alberi nuovi" value={trees} /><Stat label="Superfici di progetto" value={proj.length} /></div>
        <p className="muted">Calcolato sulle superfici e gli alberi dello scenario attivo, con la permeabilità dichiarata nel catalogo materiali.</p>
      </Section>
    </>
  );
}

function Audit() {
  const netVersion = useApp((s) => s.netVersion);
  const failed = useApp((s) => s.failedOps);
  const [items, setItems] = useState<AuditItem[] | null>(null);
  useEffect(() => { engine.job<AuditItem[]>('audit').then(setItems).catch(() => setItems([])); }, [netVersion]);
  const CAT: Record<string, string> = { geometry: 'Geometria', topology: 'Topologia', signals: 'Semafori', traffic: 'Traffico', safety: 'Sicurezza', accessibility: 'Accessibilità' };
  if (!items) return <Skeleton lines={5} />;
  const all = [...failed.map((f) => ({ category: 'topology', code: f.type, severity: 'error' as const, message: `Operazione non applicabile (${f.type}): ${f.messages.join(' · ')}` })), ...items];
  if (!all.length) return <Empty icon="check" title="Nessun problema rilevato">Geometria, topologia, semafori e accessibilità delle modifiche di progetto risultano coerenti.</Empty>;
  return (
    <Section title="Verifica del progetto" count={all.length}>
      <ul className="issue-list">
        {all.map((i, k) => (
          <li key={k} className={i.severity === 'error' ? 'is-error' : 'is-warn'}>
            <Icon name="warning" size={14} />
            <button type="button" className="link" onClick={() => { const at = (i as AuditItem).at; if (at) flyTo([at[0], at[1]], 18.5); const t = (i as AuditItem).targetIds; if (t?.length) select({ kind: 'road', ids: t }); }}>
              <strong>{CAT[i.category] ?? i.category}</strong> {i.message}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function AnalyzePanel() {
  const dock = useApp((s) => s.dock);
  const [tab, setTab] = useState<Tab>(dock === 'audit' ? 'audit' : 'safety');
  useEffect(() => { if (dock === 'audit') setTab('audit'); }, [dock]);
  useEffect(() => () => { setSource('heat', null); setSource('iso', null); setSource('traffic', null); }, []);
  return (
    <div className="panel-stack">
      <Segmented<Tab> label="Analisi" size="sm" value={tab} onChange={setTab}
        options={[{ value: 'safety', label: 'Sicurezza' }, { value: 'network', label: 'Rete' }, { value: 'access', label: '7 minuti' }, { value: 'environment', label: 'Ambiente' }, { value: 'audit', label: 'Verifica' }]} />
      {tab === 'safety' ? <Safety /> : tab === 'network' ? <Network /> : tab === 'access' ? <Access /> : tab === 'environment' ? <Environment /> : <Audit />}
    </div>
  );
}
