import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ApiKeyInfo, IdentityProviderCfg, Job, LicenseInfo, LocalUser, PlatformConfig, Role, UpdateInfo, WebhookInfo } from '../api/types';
import { loadPlatformStatus, logout, useSession } from '../state/session';
import { toast } from '../state/toasts';
import { Button, Field, IconButton, NumberField, Section, Segmented, Select, Skeleton, TextField, Toggle } from '../ui/controls';
import { confirmAction } from '../ui/confirm';

const ROLE_OPTS: { value: Role; label: string }[] = [
  { value: 'viewer', label: 'Lettura' }, { value: 'editor', label: 'Modifica' }, { value: 'publisher', label: 'Pubblicazione civica' }, { value: 'admin', label: 'Amministratore' },
];
const ROLE_IT: Record<string, string> = Object.fromEntries(ROLE_OPTS.map((r) => [r.value, r.label]));
const STATUS_IT: Record<string, string> = {
  active: 'Attiva', trialing: 'Prova', offline_grace: 'Attiva (offline)', expired: 'Scaduta', offline_expired: 'Da verificare online', unlicensed: 'Non attivata',
};
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const err = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

export function isAdmin(): boolean {
  return useSession.getState().session?.user?.role === 'admin';
}

/** Polls a background job until it ends. */
async function waitJob(id: string, onProgress?: (j: Job) => void): Promise<Job> {
  for (;;) {
    const j = await api.get<Job>(`/api/jobs/${id}`);
    onProgress?.(j);
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 700));
  }
}

function AccountSection() {
  const user = useSession((s) => s.session?.user);
  const mode = useSession((s) => s.session?.mode);
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  if (!user) return null;
  return (
    <Section title="Account">
      <dl className="kv">
        <dt>Nome</dt><dd>{user.name}</dd>
        <dt>Ruolo</dt><dd>{ROLE_IT[user.role] ?? user.role}</dd>
        <dt>Accesso</dt><dd>{user.provider === 'open' ? 'Postazione singola (senza login)' : user.provider === 'local' ? `Locale${user.provisional ? ' · provvisorio' : ''}` : user.providerLabel ?? user.provider}</dd>
        {user.expiresAt ? <><dt>Scadenza credenziali</dt><dd>{fmtDate(user.expiresAt)}</dd></> : null}
      </dl>
      {user.provider === 'local' ? (
        <div className="grid-2">
          <Field label="Password attuale"><input className="text-field" type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="Nuova password"><input className="text-field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        </div>
      ) : null}
      <div className="row">
        {user.provider === 'local' ? <Button size="sm" disabled={!old || !pw} onClick={async () => {
          try { await api.post('/api/auth/password', { old, new: pw }); setOld(''); setPw(''); toast.success('Password aggiornata'); } catch (e) { toast.error('Password', err(e)); }
        }}>Cambia password</Button> : null}
        {mode === 'protected' ? <Button size="sm" variant="ghost" icon="logout" onClick={() => void logout()}>Esci</Button> : null}
      </div>
    </Section>
  );
}

function LicenseSection() {
  const license = useSession((s) => s.license);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const admin = isAdmin();
  if (!license) return <Section title="Licenza e abbonamento DRIP"><Skeleton /></Section>;
  const run = async (what: string, fn: () => Promise<LicenseInfo>, ok: string) => {
    setBusy(what);
    try { const l = await fn(); useSession.setState({ license: l }); toast.success(ok, `${l.planLabel} · ${STATUS_IT[l.status] ?? l.status}`); }
    catch (e) { toast.error('Licenza', err(e)); }
    finally { setBusy(null); }
  };
  return (
    <Section title="Licenza e abbonamento DRIP">
      <div className="row"><span className="plan-chip">{license.planLabel}</span><strong>{STATUS_IT[license.status] ?? license.status}</strong></div>
      <dl className="kv">
        {license.customer ? <><dt>Intestatario</dt><dd>{license.customer}</dd></> : null}
        <dt>Valida fino al</dt><dd>{fmtDate(license.validUntil)}{license.daysLeft !== undefined ? ` · ${license.daysLeft} giorni` : ''}</dd>
        <dt>Origine</dt><dd>{license.source === 'key' ? `Chiave ${license.keyHint ?? ''}` : license.source === 'drip-id' ? 'Abbonamento collegato al DRIP ID' : 'Periodo di prova'}</dd>
        {license.seats ? <><dt>Postazioni</dt><dd>{license.seats}</dd></> : null}
        <dt>Piattaforma</dt><dd className="mono">{license.platformUrl}</dd>
        <dt>Postazione</dt><dd className="mono">{license.deviceId}</dd>
      </dl>
      <div className="feature-list">{Object.entries(license.catalog).map(([id, label]) => <span key={id} className={license.features.includes(id) ? 'is-on' : ''} title={label}>{label}</span>)}</div>
      {license.error ? <p className="warn-line">{license.error}</p> : null}
      {admin ? (
        <div className="provider-row">
          <input className="text-field" placeholder="Chiave di licenza DRIP (XXXX-XXXX-…)" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Chiave di licenza" />
          <Button size="sm" variant="primary" disabled={key.length < 8} busy={busy === 'act'} onClick={() => void run('act', () => api.post('/api/license/activate', { key }), 'Licenza attivata')}>Attiva</Button>
        </div>
      ) : null}
      <div className="row">
        <Button size="sm" icon="refresh" busy={busy === 'ref'} onClick={() => void run('ref', () => api.post('/api/license/refresh'), 'Licenza verificata')}>Verifica ora</Button>
        {admin && license.source === 'key' ? <Button size="sm" variant="ghost" onClick={() => void confirmAction('Disattivare la licenza su questa postazione?', 'La postazione libera il posto sull\'abbonamento DRIP.', { confirmLabel: 'Disattiva', danger: true }).then((y) => { if (y) void run('deact', () => api.post('/api/license/deactivate'), 'Licenza disattivata'); })}>Disattiva</Button> : null}
      </div>
      <p className="muted">L'abbonamento si gestisce sulla piattaforma DRIP; con DRIP ID il piano si collega da solo all'accesso. Offline la licenza resta valida 14 giorni dall'ultima verifica.</p>
    </Section>
  );
}

function UpdatesSection() {
  const update = useSession((s) => s.update);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const admin = isAdmin();
  const check = async () => {
    setBusy('check');
    try { const u = await api.post<UpdateInfo>('/api/update/check'); useSession.setState({ update: u }); if (!u.error) toast.info(u.available ? `Disponibile la versione ${u.latest?.version}` : 'DRIP Urban è aggiornato'); else toast.warn('Aggiornamenti', u.error); }
    finally { setBusy(null); }
  };
  const download = async () => {
    setBusy('dl');
    try {
      const { job } = await api.post<{ job: Job }>('/api/update/download');
      const done = await waitJob(job.id, (j) => setProgress(j.message));
      if (done.status === 'error') throw new Error(done.error);
      const r = await api.post<{ message: string }>('/api/update/apply');
      toast.success('Aggiornamento pronto', r.message);
      await loadPlatformStatus();
    } catch (e) { toast.error('Aggiornamento', err(e)); }
    finally { setBusy(null); setProgress(null); }
  };
  return (
    <Section title="Aggiornamenti">
      <dl className="kv">
        <dt>Versione installata</dt><dd className="mono">{update?.current ?? '…'}</dd>
        <dt>Ultima verifica</dt><dd>{update?.checkedAt ? new Date(update.checkedAt).toLocaleString('it-IT') : 'mai'}</dd>
        {update?.latest ? <><dt>Ultima pubblicata</dt><dd className="mono">{update.latest.version}</dd></> : null}
        {update?.pending ? <><dt>In attesa</dt><dd>{update.pending.version}: si installa al prossimo avvio</dd></> : null}
      </dl>
      {update?.latest?.notes && update.available ? <p className="muted">{update.latest.notes}</p> : null}
      {update?.error ? <p className="warn-line">{update.error}</p> : null}
      <div className="row">
        <Button size="sm" icon="refresh" busy={busy === 'check'} onClick={() => void check()}>Cerca aggiornamenti</Button>
        {admin && update?.available ? <Button size="sm" variant="primary" icon="download" busy={busy === 'dl'} onClick={() => void download()}>Scarica e prepara</Button> : null}
      </div>
      {progress ? <p className="muted">{progress}</p> : null}
      <p className="muted">Il pacchetto viene scaricato dalla piattaforma DRIP, verificato con SHA-256 e installato dal programma di avvio: progetti e impostazioni non vengono toccati.</p>
    </Section>
  );
}

function ProviderEditor({ p, onChange }: { p: IdentityProviderCfg & { clientSecret?: string }; onChange: (p: IdentityProviderCfg & { clientSecret?: string }) => void }) {
  return (
    <div className="provider">
      <div className="provider-head"><strong>{p.label}</strong><Toggle compact checked={p.enabled} label={`Abilita ${p.label}`} onChange={(v) => onChange({ ...p, enabled: v })} /></div>
      <Field label="Issuer (realm Keycloak)" hint="Es. https://id.studiodrip.it/realms/drip"><TextField value={p.issuer} ariaLabel="Issuer" onCommit={(v) => onChange({ ...p, issuer: v.trim() })} /></Field>
      <div className="grid-2">
        <Field label="Client ID"><TextField value={p.clientId} ariaLabel="Client ID" onCommit={(v) => onChange({ ...p, clientId: v.trim() })} /></Field>
        <Field label="Client secret" hint={p.hasClientSecret ? 'Salvato (non mostrato)' : 'Solo per client confidenziali'}>
          <input className="text-field" type="password" autoComplete="off" placeholder={p.hasClientSecret ? '••••••••' : ''} onBlur={(e) => { if (e.target.value) onChange({ ...p, clientSecret: e.target.value }); }} aria-label="Client secret" />
        </Field>
      </div>
      <Field label="Etichetta del pulsante"><TextField value={p.label} ariaLabel="Etichetta" onCommit={(v) => onChange({ ...p, label: v })} /></Field>
    </div>
  );
}

function AccessSection() {
  const [cfg, setCfg] = useState<PlatformConfig | null>(null);
  useEffect(() => { api.get<PlatformConfig>('/api/platform/config').then(setCfg).catch(() => setCfg(null)); }, []);
  if (!cfg) return null;
  const save = async (patch: Partial<PlatformConfig> & Record<string, unknown>) => {
    try { setCfg(await api.put<PlatformConfig>('/api/platform/config', patch)); toast.success('Impostazioni salvate'); }
    catch (e) { toast.error('Impostazioni', err(e)); }
  };
  const setProvider = (np: IdentityProviderCfg & { clientSecret?: string }) => void save({ identityProviders: cfg.identityProviders.map((x) => (x.id === np.id ? { ...np, clientSecret: np.clientSecret ?? '' } : { ...x, clientSecret: '' })) as never });
  return (
    <Section title="Accesso e identità (DRIP ID, Keycloak)">
      <Field label="Modalità">
        <Segmented<'protected' | 'open'> label="Modalità di accesso" value={cfg.authMode} onChange={(v) => void confirmAction(v === 'open' ? 'Disattivare il login?' : 'Attivare il login?', v === 'open' ? 'Chiunque usi questo computer potrà aprire e modificare i progetti senza credenziali.' : 'Servirà accedere con DRIP ID, Keycloak o un utente locale.', { confirmLabel: 'Conferma', danger: v === 'open' }).then((y) => { if (y) void save({ authMode: v }); })}
          options={[{ value: 'protected', label: 'Con login' }, { value: 'open', label: 'Postazione singola' }]} />
      </Field>
      <div className="grid-2">
        <Field label="Durata sessione"><NumberField value={cfg.sessionHours} unit="ore" min={1} max={168} decimals={0} ariaLabel="Durata sessione" onCommit={(v) => void save({ sessionHours: v })} /></Field>
        <Field label="Ruolo predefinito"><Select value={cfg.defaultRole} ariaLabel="Ruolo predefinito" options={ROLE_OPTS} onChange={(v) => void save({ defaultRole: v })} /></Field>
      </div>
      <Toggle checked={cfg.localLogin} label="Consenti l'accesso con utenti locali" onChange={(v) => void save({ localLogin: v })} />
      {cfg.identityProviders.map((p) => <ProviderEditor key={p.id} p={p} onChange={setProvider} />)}
      <p className="muted">Ruoli Keycloak riconosciuti: drip-urban-admin, drip-urban-publisher, drip-urban-editor, drip-urban-viewer (realm o client). Indirizzo di ritorno da registrare sul client: <span className="mono">{location.origin}/api/auth/oidc/callback</span></p>
      <Field label="Piattaforma DRIP (licenze, aggiornamenti)"><TextField value={cfg.platformUrl} ariaLabel="URL piattaforma" onCommit={(v) => void save({ platformUrl: v.trim() })} /></Field>
      <div className="grid-2">
        <Field label="Canale aggiornamenti"><Select value={cfg.updates.channel} ariaLabel="Canale" options={[{ value: 'stable', label: 'Stabile' }, { value: 'beta', label: 'Beta' }]} onChange={(v) => void save({ updates: { ...cfg.updates, channel: v } })} /></Field>
        <Field label="Applicazione licenza"><Select value={cfg.licenseEnforcement} ariaLabel="Applicazione licenza" options={[{ value: 'soft', label: 'Solo avvisi' }, { value: 'strict', label: 'Blocca funzioni fuori piano' }]} onChange={(v) => void save({ licenseEnforcement: v })} /></Field>
      </div>
      <Toggle checked={cfg.updates.autoCheck} label="Cerca aggiornamenti all'avvio" onChange={(v) => void save({ updates: { ...cfg.updates, autoCheck: v } })} />
    </Section>
  );
}

function UsersSection() {
  const [users, setUsers] = useState<LocalUser[] | null>(null);
  const [draft, setDraft] = useState({ username: '', name: '', role: 'editor' as Role, password: '' });
  const load = () => api.get<LocalUser[]>('/api/auth/users').then(setUsers).catch(() => setUsers(null));
  useEffect(() => { void load(); }, []);
  if (!users) return null;
  const upsert = async (body: Record<string, unknown>, ok: string) => {
    try { await api.put('/api/auth/users', body); await load(); toast.success(ok); } catch (e) { toast.error('Utenti', err(e)); }
  };
  return (
    <Section title="Utenti locali" count={users.length} defaultOpen={false}>
      <ul className="row-list">
        {users.map((u) => (
          <li key={u.username}>
            <span className="avatar">{(u.name || u.username).slice(0, 2).toUpperCase()}</span>
            <span className="grow"><strong>{u.username}</strong> · {ROLE_IT[u.role]}{u.provisional ? ` · provvisorio fino al ${fmtDate(u.expiresAt)}` : ''}{u.disabled ? ' · disattivato' : ''}</span>
            {u.provisional ? <IconButton icon="refresh" size={14} label="Rinnova 30 giorni" onClick={() => void upsert({ ...u, renew: true }, 'Credenziali rinnovate')} /> : null}
            <IconButton icon={u.disabled ? 'unlock' : 'lock'} size={14} label={u.disabled ? 'Riattiva' : 'Disattiva'} onClick={() => void upsert({ ...u, disabled: !u.disabled }, u.disabled ? 'Utente riattivato' : 'Utente disattivato')} />
            <IconButton icon="trash" size={14} tone="danger" label="Elimina" onClick={() => void confirmAction(`Eliminare ${u.username}?`, 'L\'utente non potrà più accedere.', { confirmLabel: 'Elimina', danger: true }).then(async (y) => { if (y) { try { await api.del(`/api/auth/users/${encodeURIComponent(u.username)}`); await load(); } catch (e) { toast.error('Utenti', err(e)); } } })} />
          </li>
        ))}
      </ul>
      <div className="grid-2">
        <Field label="Utente"><input className="text-field" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></Field>
        <Field label="Nome"><input className="text-field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Ruolo"><Select value={draft.role} ariaLabel="Ruolo" options={ROLE_OPTS} onChange={(v) => setDraft({ ...draft, role: v })} /></Field>
        <Field label="Password iniziale"><input className="text-field" type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></Field>
      </div>
      <Button size="sm" icon="plus" disabled={!draft.username || draft.password.length < 10} onClick={() => void upsert(draft, 'Utente creato').then(() => setDraft({ username: '', name: '', role: 'editor', password: '' }))}>Aggiungi utente</Button>
      <p className="muted">Al primo accesso ogni nuovo utente deve cambiare la password.</p>
    </Section>
  );
}

function ApiSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [hooks, setHooks] = useState<{ hooks: WebhookInfo[]; events: string[] } | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; role: Role }>({ name: '', role: 'editor' });
  const [shown, setShown] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState('');
  const load = () => {
    void api.get<ApiKeyInfo[]>('/api/platform/keys').then(setKeys).catch(() => setKeys(null));
    void api.get<{ hooks: WebhookInfo[]; events: string[] }>('/api/platform/webhooks').then(setHooks).catch(() => setHooks(null));
  };
  useEffect(load, []);
  if (!keys || !hooks) return null;
  return (
    <Section title="API e integrazioni DRIP" defaultOpen={false}>
      <p className="muted">API REST documentata su <a href="/docs" target="_blank" rel="noreferrer">/docs</a>. Contratto stabile per la piattaforma DRIP: <span className="mono">/api/v1/…</span>. Autenticazione: <span className="mono">Authorization: Bearer drip_…</span> oppure token DRIP ID.</p>
      <strong>Chiavi API</strong>
      <ul className="row-list">
        {keys.map((k) => (
          <li key={k.id}><span className="grow"><strong>{k.name}</strong> · {ROLE_IT[k.role]} · <span className="mono">{k.prefix}</span>{k.lastUsedAt ? ` · usata ${new Date(k.lastUsedAt).toLocaleString('it-IT')}` : ''}</span>
            <IconButton icon="trash" size={14} tone="danger" label="Revoca" onClick={() => void api.del(`/api/platform/keys/${k.id}`).then(load)} /></li>
        ))}
      </ul>
      {shown ? <p className="secret-once">Copia ora la chiave, non verrà più mostrata: <span className="mono">{shown}</span></p> : null}
      <div className="provider-row">
        <input className="text-field" placeholder="Nome (es. Piattaforma DRIP)" value={newKey.name} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} aria-label="Nome chiave" />
        <Select value={newKey.role} ariaLabel="Ruolo chiave" options={ROLE_OPTS} onChange={(v) => setNewKey({ ...newKey, role: v })} />
        <Button size="sm" disabled={newKey.name.length < 2} onClick={async () => { try { const k = await api.post<ApiKeyInfo>('/api/platform/keys', newKey); setShown(k.key ?? null); setNewKey({ name: '', role: 'editor' }); load(); } catch (e) { toast.error('Chiave API', err(e)); } }}>Crea</Button>
      </div>
      <strong>Webhook</strong>
      <ul className="row-list">
        {hooks.hooks.map((h) => (
          <li key={h.id}><span className="grow"><span className="mono">{h.url}</span> · {h.events.length} eventi{h.lastDelivery ? ` · ultimo invio ${h.lastDelivery.ok ? 'riuscito' : 'non riuscito'} (${h.lastDelivery.status ?? h.lastDelivery.error ?? '—'})` : ''}</span>
            <IconButton icon="send" size={14} label="Invia evento di prova" onClick={() => void api.post<{ message: string }>(`/api/platform/webhooks/${h.id}/test`).then((r) => { toast.info('Webhook', r.message); setTimeout(load, 4000); })} />
            <IconButton icon="trash" size={14} tone="danger" label="Elimina" onClick={() => void api.del(`/api/platform/webhooks/${h.id}`).then(load)} /></li>
        ))}
      </ul>
      <div className="provider-row">
        <input className="text-field" type="url" placeholder="https://piattaforma.studiodrip.it/hooks/urban" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} aria-label="URL webhook" />
        <Button size="sm" disabled={!hookUrl} onClick={async () => { try { const h = await api.post<WebhookInfo>('/api/platform/webhooks', { url: hookUrl, events: hooks.events }); setShown(h.secret ? `segreto di firma ${h.secret}` : null); setHookUrl(''); load(); } catch (e) { toast.error('Webhook', err(e)); } }}>Aggiungi</Button>
      </div>
      <p className="muted">Eventi: {hooks.events.join(', ')}. Ogni invio è firmato con HMAC-SHA256 nell'intestazione X-Drip-Signature.</p>
    </Section>
  );
}

/** Account, subscription, updates and (for administrators) identity, users and API integrations. */
export function PlatformSettings() {
  const role = useSession((s) => s.session?.user?.role);
  useEffect(() => { void loadPlatformStatus(); }, []);
  return (
    <>
      <AccountSection />
      <LicenseSection />
      <UpdatesSection />
      {role === 'admin' ? <><AccessSection /><UsersSection /><ApiSection /></> : null}
    </>
  );
}
