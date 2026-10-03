import { PlatformSettings } from './PlatformSettings';
import { useSession } from '../state/session';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { AuditEntry, ProviderStatus, Snapshot } from '../api/types';
import { BASEMAPS, thumbUrl } from '../map/basemaps';
import { CATEGORY_LABEL, LAYERS } from '../map/layers';
import { getMap, setOpacity, toggleLayer, useMapUi } from '../map/mapStore';
import { navigate, refreshProject, refreshUser, selectScenario, setDock, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { saveSnapshot } from '../shell/commands';
import { Button, Field, IconButton, ProvBadge, Section, Select, Skeleton, Slider, TextField } from '../ui/controls';
import { confirmAction } from '../ui/confirm';
import { Icon } from '../ui/Icon';

/** Real thumbnail: a raster tile of the project centre, or the project's own road axes for data-drawn basemaps. */
function BasemapThumb({ id }: { id: string }) {
  const baseline = useApp((s) => s.baseline);
  const b = BASEMAPS.find((x) => x.id === id)!;
  const svg = useMemo(() => {
    if (b.tiles || !baseline) return null;
    const [cx, cy] = baseline.origin;
    const r = 0.004;
    const lines: string[] = [];
    for (const road of Object.values(baseline.roads)) {
      const pts = road.axis.filter((p) => Math.abs(p[0] - cx) < r * 1.6 && Math.abs(p[1] - cy) < r);
      if (pts.length >= 2) lines.push(pts.map((p) => `${(((p[0] - cx) / (r * 1.6)) * 50 + 50).toFixed(1)},${((-(p[1] - cy) / r) * 30 + 30).toFixed(1)}`).join(' '));
    }
    return lines;
  }, [b, baseline]);
  if (b.tiles && baseline) return <img src={thumbUrl(b, baseline.origin[0], baseline.origin[1])!} alt="" loading="lazy" />;
  const dark = b.theme === 'dark';
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice" style={{ background: b.background }} aria-hidden>
      {id === 'cad' ? Array.from({ length: 11 }, (_, i) => <line key={i} x1={i * 10} y1="0" x2={i * 10} y2="60" stroke="#d9d6cf" strokeWidth="0.3" />) : null}
      {svg?.map((pts, i) => <polyline key={i} points={pts} fill="none" stroke={dark ? '#5a5f66' : '#3b3e42'} strokeWidth="1.2" strokeLinecap="round" />)}
    </svg>
  );
}

export function LayersSheet() {
  const { basemap, visible, opacity } = useMapUi();
  const [q, setQ] = useState('');
  const [google, setGoogle] = useState(false);
  useEffect(() => { api.get<ProviderStatus[]>('/api/providers').then((p) => setGoogle(!!p.find((x) => x.id === 'google')?.configured)).catch(() => setGoogle(false)); }, []);
  const cats = [...new Set(LAYERS.map((l) => l.category))];
  const list = LAYERS.filter((l) => !q || l.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Section title="Base cartografica">
        <div className="basemaps" role="radiogroup" aria-label="Base cartografica">
          {BASEMAPS.filter((b) => !b.requires || (b.requires === 'google' && google)).map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={basemap === b.id} className={`basemap ${basemap === b.id ? 'is-on' : ''}`} onClick={() => useMapUi.setState({ basemap: b.id })}>
              <BasemapThumb id={b.id} /><span>{b.label}</span>
            </button>
          ))}
        </div>
        <p className="muted">Le modifiche di progetto restano visibili con ogni base. {google ? '' : 'Google Satellite compare dopo aver configurato la chiave.'}</p>
      </Section>
      <input className="text-field search" placeholder="Cerca livello" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca livello" />
      {cats.map((c) => {
        const items = list.filter((l) => l.category === c);
        if (!items.length) return null;
        return (
          <Section key={c} title={CATEGORY_LABEL[c]}>
            {items.map((l) => (
              <div key={l.id} className="layer-row">
                <IconButton icon={visible[l.id] ? 'eye' : 'eyeOff'} label={visible[l.id] ? 'Nascondi' : 'Mostra'} onClick={() => toggleLayer(l.id)} active={visible[l.id]} size={16} />
                <div className="layer-main">
                  <span className="layer-name">{l.label}</span>
                  <span className="layer-src">{l.source}</span>
                  {l.legend ? <span className="legend">{l.legend.map((g) => <span key={g.label}><i style={{ background: g.color }} />{g.label}</span>)}</span> : null}
                  {l.opacity && visible[l.id] ? <Slider label="Opacità" min={0.1} max={1} step={0.05} value={opacity[l.id] ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setOpacity(l.id, v)} /> : null}
                </div>
              </div>
            ))}
          </Section>
        );
      })}
    </>
  );
}

export function HistorySheet() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [label, setLabel] = useState('');
  const load = () => {
    if (!project) return;
    api.get<Snapshot[]>(`/api/projects/${project.id}/snapshots`).then(setSnaps);
    api.get<AuditEntry[]>(`/api/projects/${project.id}/audit?limit=100`).then(setAudit);
  };
  useEffect(load, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project) return null;
  return (
    <>
      <Section title="Salva una versione">
        <Field label="Etichetta"><TextField value={label} placeholder="es. Prima della riunione con l'Ufficio Tecnico" ariaLabel="Etichetta" onCommit={setLabel} /></Field>
        <Button icon="check" onClick={() => void saveSnapshot(label || 'Salvataggio manuale').then(load)}>Salva versione</Button>
        <p className="muted">L'autosalvataggio registra ogni modifica; le versioni sono punti di ripristino completi del progetto.</p>
      </Section>
      <Section title="Versioni" count={snaps?.length}>
        {!snaps ? <Skeleton /> : !snaps.length ? <p className="muted">Nessuna versione salvata.</p> : (
          <ul className="issue-list">{snaps.map((s) => (
            <li key={s.id}><Icon name={s.automatic ? 'refresh' : 'check'} size={14} /><span><strong>{s.label}</strong> · {new Date(s.at).toLocaleString('it-IT')} · {s.author}</span>
              <button type="button" className="link" onClick={() => void confirmAction('Ripristinare questa versione?', `Il progetto torna a «${s.label}». Lo stato attuale viene prima salvato come versione automatica.`, { confirmLabel: 'Ripristina' }).then(async (yes) => {
                if (!yes) return;
                await api.post(`/api/projects/${project.id}/snapshots/${s.id}/restore`);
                await refreshProject();
                if (scenario) await selectScenario(scenario.id);
                toast.success('Versione ripristinata', s.label);
                load();
              })}>Ripristina</button></li>
          ))}</ul>
        )}
      </Section>
      <Section title="Registro modifiche" count={audit?.length} defaultOpen={false}>
        {!audit ? <Skeleton /> : (
          <ul className="audit">{audit.map((a) => (
            <li key={a.id}><span className="mono">{new Date(a.at).toLocaleString('it-IT')}</span><span>{a.author}</span><span>{a.action}</span>
              <span className="muted">{Array.isArray(a.details.added) ? (a.details.added as string[]).join(', ') : ''}</span></li>
          ))}</ul>
        )}
      </Section>
    </>
  );
}

export function SettingsSheet() {
  const [prov, setProv] = useState<ProviderStatus[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const user = useApp((s) => s.user);
  const { gridM } = useMapUi();
  const [mig, setMig] = useState<{ available: boolean; summary: { scenarios: { name: string; counts: Record<string, number> }[] } | null; migratedProjects: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api.get<ProviderStatus[]>('/api/providers').then(setProv);
    api.get<typeof mig>('/api/migration/legacy').then(setMig).catch(() => setMig(null));
  }, []);
  const saveKey = async (id: string, value: string) => {
    setProv(await api.put<ProviderStatus[]>(`/api/providers/${id}`, { value }));
    setValues((v) => ({ ...v, [id]: '' }));
    toast.success(value ? 'Chiave salvata' : 'Chiave rimossa', 'Conservata solo su questo computer, mai nel codice.');
  };
  const test = async (id: string) => {
    setBusy(id);
    const r = await api.post<{ ok: boolean; message: string }>(`/api/providers/${id}/test`);
    setBusy(null);
    (r.ok ? toast.success : toast.error)(r.ok ? 'Connessione riuscita' : 'Test non riuscito', r.message);
    setProv(await api.get<ProviderStatus[]>('/api/providers'));
  };
  const mode = useSession((s) => s.session?.mode);
  return (
    <>
      <PlatformSettings />
      {mode === 'open' ? <Section title="Utente">
        {user ? (
          <div className="grid-2">
            <Field label="Nome"><TextField value={user.name} ariaLabel="Nome utente" onCommit={(v) => void api.put('/api/user', { name: v, role: user.role }).then(refreshUser)} /></Field>
            <Field label="Ruolo"><Select value={user.role} ariaLabel="Ruolo" options={[{ value: 'viewer', label: 'Lettura' }, { value: 'editor', label: 'Modifica' }, { value: 'publisher', label: 'Pubblicazione civica' }, { value: 'admin', label: 'Amministratore' }]} onChange={(v) => void api.put('/api/user', { name: user.name, role: v }).then(refreshUser)} /></Field>
          </div>
        ) : null}
        <p className="muted">Il nome firma modifiche, versioni e pubblicazioni. Solo «Pubblicazione civica» e «Amministratore» possono pubblicare sul portale FST.</p>
      </Section> : null}
      <Section title="Fonti dati e chiavi">
        {!prov ? <Skeleton /> : prov.map((p) => (
          <div key={p.id} className="provider">
            <div className="provider-head"><strong>{p.label}</strong>{p.configured ? <ProvBadge kind="live" title="Configurato" /> : <span className="muted">non configurato</span>}</div>
            <span className="muted">{p.use}</span>
            {p.configured ? <span className="mono muted">{p.hint}</span> : null}
            <div className="provider-row">
              <input className="text-field" type={p.kind === 'url' ? 'url' : 'password'} autoComplete="off" placeholder={p.kind === 'url' ? 'https://…' : 'Incolla la chiave'} value={values[p.id] ?? ''} onChange={(e) => setValues({ ...values, [p.id]: e.target.value })} aria-label={`Chiave ${p.label}`} />
              <Button size="sm" disabled={!values[p.id]} onClick={() => void saveKey(p.id, values[p.id]!)}>Salva</Button>
              {p.configured ? <><Button size="sm" busy={busy === p.id} onClick={() => void test(p.id)}>Prova</Button><Button size="sm" variant="ghost" onClick={() => void saveKey(p.id, '')}>Rimuovi</Button></> : null}
            </div>
            {p.lastTest ? <span className={p.lastTest.ok ? 'ok' : 'warn-line'}>{p.lastTest.message} · {new Date(p.lastTest.at).toLocaleString('it-IT')}</span> : null}
          </div>
        ))}
        <p className="muted">Senza chiavi DRIP Urban funziona: OpenStreetMap, Esri, Open-Meteo e CAMS non richiedono chiavi; il traffico è dichiarato come stima.</p>
      </Section>
      <Section title="Disegno">
        <Field label="Passo della griglia"><Select value={String(gridM)} ariaLabel="Griglia" options={['0.1', '0.25', '0.5', '1', '2', '5', '10'].map((v) => ({ value: v, label: `${v.replace('.', ',')} m` }))} onChange={(v) => useMapUi.setState({ gridM: Number(v) })} /></Field>
      </Section>
      {mig?.available ? (
        <Section title="Dati di DRIP Urban 53.0">
          <p>Trovati sul computer: {mig.summary?.scenarios.map((s) => `«${s.name}» (${Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')})`).join('; ')}</p>
          {mig.migratedProjects.length ? <p className="ok">Già migrato in {mig.migratedProjects.length} progetto/i.</p> : null}
          <Button icon="import" busy={busy === 'mig'} onClick={async () => {
            setBusy('mig');
            try {
              const r = await api.post<{ project: { id: string }; report: unknown[] }>('/api/migration/legacy');
              toast.success('Migrazione completata', `${r.report.length} note nel report di migrazione`);
              navigate({ view: 'workspace', projectId: r.project.id });
            } catch (e) { toast.error('Migrazione', e instanceof Error ? e.message : String(e)); }
            finally { setBusy(null); }
          }}>Migra in un nuovo progetto</Button>
          <p className="muted">I file originali non vengono modificati.</p>
        </Section>
      ) : null}
    </>
  );
}

export function QASheet() {
  const stats = useApp((s) => s.physStats);
  const failed = useApp((s) => s.failedOps);
  const net = useApp((s) => s.network);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    let frames = 0, raf = 0, last = performance.now();
    const loop = () => { frames++; const now = performance.now(); if (now - last >= 1000) { setFps(frames); frames = 0; last = now; } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const t0 = performance.now();
    api.get('/api/health').then(() => setLatency(Math.round(performance.now() - t0))).catch(() => setLatency(-1));
    const onErr = (e: ErrorEvent) => setErrors((x) => [...x.slice(-9), e.message]);
    window.addEventListener('error', onErr);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('error', onErr); };
  }, []);
  const map = getMap();
  const visibleFeatures = map ? map.queryRenderedFeatures().length : 0;
  return (
    <Section title="Diagnostica (sviluppatore)">
      <table className="table"><tbody>
        <tr><td>FPS</td><td className="mono">{fps}</td></tr>
        <tr><td>Latenza API</td><td className="mono">{latency === null ? '…' : latency < 0 ? 'offline' : `${latency} ms`}</td></tr>
        <tr><td>Feature renderizzate</td><td className="mono">{visibleFeatures.toLocaleString('it-IT')}</td></tr>
        <tr><td>Modello fisico</td><td className="mono">{stats ? `${stats.ms} ms · ${stats.markings} marking` : '—'}</td></tr>
        <tr><td>Rete</td><td className="mono">{net ? `${Object.keys(net.roads).length} strade · ${Object.keys(net.nodes).length} nodi · ${Object.keys(net.assets).length} asset` : '—'}</td></tr>
        <tr><td>Operazioni fallite</td><td className="mono">{failed.length}</td></tr>
        <tr><td>Errori runtime</td><td className="mono">{errors.length ? errors.join(' | ') : 'nessuno'}</td></tr>
      </tbody></table>
      <Button size="sm" variant="ghost" onClick={() => setDock(null)}>Chiudi</Button>
    </Section>
  );
}

