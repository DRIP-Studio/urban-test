import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Job, ProjectSummary, Template } from '../api/types';
import { TechnicalLockup } from '../shell/Brand';
import { navigate } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, IconButton, Segmented, Skeleton, TextField } from '../ui/controls';
import { toggleTheme, useTheme } from '../ui/theme';
import { PlatformBanner, UserMenu } from '../shell/UserMenu';
import { confirmAction } from '../ui/confirm';
import { Icon } from '../ui/Icon';

const KIND_IT: Record<string, string> = {
  municipality: 'Comune', district: 'Zona', neighbourhood: 'Quartiere', corridor: 'Corridoio', junction: 'Incrocio',
  mobility_plan: 'Piano mobilità', regeneration: 'Rigenerazione', transit: 'TPL', safety_study: 'Studio sicurezza',
};
const STATUS_IT: Record<string, string> = { concept: 'Concept', draft: 'In lavorazione', review: 'In revisione', final: 'Definitivo', archived: 'Archiviato' };

function pendingRecoveries(): { pid: string; sid: string; at: string }[] {
  const out: { pid: string; sid: string; at: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (!k.startsWith('drip-urban:pending:')) continue;
    const [, , pid, sid] = k.split(':');
    try { out.push({ pid: pid!, sid: sid!, at: (JSON.parse(localStorage.getItem(k)!) as { at: string }).at }); } catch { /* corrupt entry ignored */ }
  }
  return out;
}

/** Import size: single download up to 20 km², tiles of ~16 km² above (big cities), refused above 2 000 km². */
function areaHint(km2: number, osm: boolean): string {
  const a = `${km2 < 10 ? km2.toFixed(2).replace('.', ',') : Math.round(km2).toLocaleString('it-IT')} km²`;
  if (!osm || km2 <= 20) return a;
  if (km2 > 2000) return `${a} · oltre 2.000 km²: scegli un municipio o un quartiere`;
  const tiles = Math.ceil(km2 / 16);
  return `${a} · città grande: import a ${tiles} tasselli, circa ${Math.max(2, Math.round(tiles * 0.6))}–${Math.round(tiles * 1.5)} min (download OpenStreetMap)`;
}

function NewProject({ templates, onClose }: { templates: Template[]; onClose: () => void }) {
  const [tpl, setTpl] = useState(templates[0]?.id ?? 'frattamaggiore');
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [found, setFound] = useState<{ name: string; bbox: [number, number, number, number] }[]>([]);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const t = templates.find((x) => x.id === tpl)!;
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const h = setInterval(async () => {
      const j = await api.get<Job>(`/api/jobs/${job.id}`);
      setJob(j);
      if (j.status === 'done' && j.result) { clearInterval(h); navigate({ view: 'workspace', projectId: j.result.id }); }
      if (j.status === 'error') clearInterval(h);
    }, 800);
    return () => clearInterval(h);
  }, [job]);
  const search = async () => {
    if (place.trim().length < 3) return;
    try { setFound((await api.get<{ name: string; bbox: [number, number, number, number] }[]>(`/api/geocode?q=${encodeURIComponent(place)}`)).slice(0, 6)); }
    catch (e) { toast.error('Ricerca luogo', e instanceof Error ? e.message : String(e)); }
  };
  const create = async () => {
    setBusy(true);
    try {
      const body = { template: tpl, name: name || t.label, ...(bbox ? { bbox, city: place } : {}) };
      const r = await api.post<ProjectSummary | { job: Job }>('/api/projects', body);
      if ('job' in r) setJob(r.job);
      else { navigate({ view: 'workspace', projectId: r.id }); onClose(); }
    } catch (e) { toast.error('Progetto non creato', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const area = bbox ? ((bbox[2] - bbox[0]) * 111 * Math.cos((bbox[1] * Math.PI) / 180)) * ((bbox[3] - bbox[1]) * 111) : 0;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Nuovo progetto" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Nuovo progetto</h2>
        <div className="tpl-grid" role="radiogroup" aria-label="Template">
          {templates.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={tpl === x.id} className={`tpl ${tpl === x.id ? 'is-on' : ''}`} onClick={() => { setTpl(x.id); setBbox(null); }}>
              <strong>{x.label}</strong><span>{x.description}</span>
            </button>
          ))}
        </div>
        <Field label="Nome del progetto"><TextField value={name} placeholder={t.label} ariaLabel="Nome progetto" onCommit={setName} /></Field>
        {t.baseline !== 'seed' ? (
          <Field label="Area" hint={bbox ? areaHint(area, t.baseline === 'osm') : 'Cerca un comune, un quartiere o una via (anche città grandi: Roma, Milano, Londra, New York)'}>
            <div className="provider-row"><input className="text-field" value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} placeholder="es. Grumo Nevano" aria-label="Luogo" /><Button size="sm" icon="search" onClick={() => void search()}>Cerca</Button></div>
            {found.length ? <ul className="found">{found.map((f) => <li key={f.name}><button type="button" className={bbox === f.bbox ? 'is-on' : ''} onClick={() => setBbox(f.bbox)}>{f.name}</button></li>)}</ul> : null}
          </Field>
        ) : null}
        {job ? (
          <div className="job">
            <span>{job.status === 'error' ? `Errore: ${job.error}` : job.message}</span>
            <span className="progress"><span style={{ width: `${Math.round(job.progress * 100)}%` }} /></span>
          </div>
        ) : null}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button variant="primary" icon="check" busy={busy || job?.status === 'running'} disabled={t.baseline !== 'seed' && !bbox} onClick={() => void create()}>{t.baseline === 'osm' ? 'Importa e crea' : 'Crea progetto'}</Button>
        </div>
        <p className="muted">Fonte dati: OpenStreetMap contributors (ODbL). L'importazione scarica strade, edifici e contesto reali dell'area scelta.</p>
      </div>
    </div>
  );
}

export function Hub() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const [legacy, setLegacy] = useState<{ available: boolean; migratedProjects: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const theme = useTheme((s) => s.theme);
  const load = () => {
    setError(null);
    api.get<ProjectSummary[]>('/api/projects').then(setProjects).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api.get<Template[]>('/api/templates').then(setTemplates).catch(() => undefined);
    api.get<{ available: boolean; migratedProjects: string[] }>('/api/migration/legacy').then(setLegacy).catch(() => setLegacy(null));
  };
  useEffect(load, []);
  const recoveries = pendingRecoveries();
  const list = projects?.filter((p) => (filter === 'archived' ? p.status === 'archived' : p.status !== 'archived')) ?? [];
  const importPkg = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    try { const p = await api.post<ProjectSummary>('/api/projects/import', fd); toast.success('Progetto importato', p.name); load(); }
    catch (e) { toast.error('Importazione non riuscita', e instanceof Error ? e.message : String(e)); }
  };
  const migrate = async () => {
    try {
      const r = await api.post<{ project: { id: string } }>('/api/migration/legacy');
      navigate({ view: 'workspace', projectId: r.project.id });
    } catch (e) { toast.error('Migrazione', e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="hub">
      <header className="hub-head">
        <TechnicalLockup />
        <div className="hub-actions">
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'} onClick={toggleTheme} />
          <input ref={file} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importPkg(f); e.target.value = ''; }} />
          <Button icon="import" onClick={() => file.current?.click()}>Importa progetto</Button>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nuovo progetto</Button>
          <UserMenu />
        </div>
      </header>
      <main className="hub-main">
        <PlatformBanner />
        <div className="hub-title">
          <h1>Progetti</h1>
          <Segmented<'active' | 'archived'> label="Filtro" size="sm" value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Attivi' }, { value: 'archived', label: 'Archivio' }]} />
        </div>
        {legacy?.available && !legacy.migratedProjects.length ? (
          <div className="banner">
            <Icon name="info" />
            <div><strong>Trovato il lavoro di DRIP Urban 53.0 su questo computer.</strong><span>Migralo in un nuovo progetto: i file originali non vengono toccati e un report elenca tutto ciò che non è convertibile.</span></div>
            <Button icon="import" onClick={() => void migrate()}>Migra</Button>
          </div>
        ) : null}
        {recoveries.length ? (
          <div className="banner banner-warn">
            <Icon name="warning" />
            <div><strong>Modifiche non salvate trovate</strong><span>{recoveries.map((r) => `${projects?.find((p) => p.id === r.pid)?.name ?? r.pid} (${new Date(r.at).toLocaleString('it-IT')})`).join(' · ')}. Si recuperano aprendo il progetto.</span></div>
          </div>
        ) : null}
        {error ? <Empty icon="warning" title="Server DRIP Urban non raggiungibile" action={<Button icon="refresh" onClick={load}>Riprova</Button>}>{error}</Empty>
          : !projects ? <div className="cards"><Skeleton lines={4} /><Skeleton lines={4} /><Skeleton lines={4} /></div>
          : !list.length ? <Empty icon="folder" title={filter === 'archived' ? 'Archivio vuoto' : 'Nessun progetto'} action={filter === 'active' ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Crea il primo progetto</Button> : undefined}>{filter === 'active' ? 'Parti da Frattamaggiore (dati OSM inclusi) o importa un\'altra area.' : null}</Empty>
          : (
            <div className="cards">
              {list.map((p) => (
                <article key={p.id} className="card">
                  <button type="button" className="card-open" onClick={() => navigate({ view: 'workspace', projectId: p.id })} aria-label={`Apri ${p.name}`}>
                    <div className="card-thumb">{p.hasThumbnail ? <img src={`/api/projects/${p.id}/thumbnail?t=${encodeURIComponent(p.updatedAt)}`} alt="" /> : <span className="card-nothumb"><Icon name="map" size={28} /><span>La miniatura si genera alla prima apertura</span></span>}</div>
                    <div className="card-body">
                      <span className="card-kind">{KIND_IT[p.kind] ?? p.kind} · {p.city}</span>
                      <h2>{p.name}</h2>
                      <span className="card-meta">{p.scenarioCount} {p.scenarioCount === 1 ? 'scenario' : 'scenari'} · {p.opCount} {p.opCount === 1 ? 'modifica' : 'modifiche'} · {STATUS_IT[p.status] ?? p.status}</span>
                      <span className="card-meta">{p.author} · {new Date(p.updatedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                  </button>
                  <div className="card-actions">
                    <button type="button" className="link" onClick={() => void api.post(`/api/projects/${p.id}/duplicate`).then(() => { toast.success('Progetto duplicato'); load(); })}>Duplica</button>
                    <a className="link" href={`/api/projects/${p.id}/package`}>Pacchetto</a>
                    {p.status !== 'archived' ? (
                      <button type="button" className="link" onClick={() => void confirmAction('Archiviare il progetto?', `«${p.name}» passa in Archivio. Non viene cancellato.`, { confirmLabel: 'Archivia' }).then((y) => { if (y) void api.post(`/api/projects/${p.id}/archive`).then(load); })}>Archivia</button>
                    ) : (
                      <button type="button" className="link" onClick={() => void api.patch(`/api/projects/${p.id}`, { status: 'draft' }).then(load)}>Ripristina</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
      </main>
      {creating ? <NewProject templates={templates} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
