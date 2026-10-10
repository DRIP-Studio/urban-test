import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { loadSession, logout, useSession } from '../state/session';
import { Button } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { TechnicalLockup } from './Brand';

function hashError(): string | null {
  const m = location.hash.match(/[?&]error=([^&]+)/);
  try{return m ? decodeURIComponent(m[1]!) : null;}catch{return 'Risposta di accesso non valida';}
}

/** Sign-in: DRIP ID / Keycloak (OpenID Connect) or the provisional local administrator. */
export function Login() {
  const session = useSession((s) => s.session);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword,setShowPassword]=useState(false),[caps,setCaps]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(hashError());
  const next = location.hash && !location.hash.startsWith('#/login') ? `/${location.hash}` : '/';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { username, password });
      if (location.hash.startsWith('#/login')) location.hash = '#/';
      location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  const providers = session?.providers ?? [];
  return (
    <div className="auth-screen auth-entry">
      <section className="auth-territory" aria-label="DRIP Urban"><TechnicalLockup/><div className="auth-statement"><span className="auth-eyebrow">DRIP URBAN · WORKSTATION</span><h2>La città,<br/><em>in progetto.</em></h2><p>Dal territorio alle decisioni.<br/>Progetta, simula e racconta ogni trasformazione.</p></div><svg className="auth-city-lines" viewBox="0 0 600 350" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1"><path d="M-40 60H650M-40 150H650M-40 245H650M90 -40V390M220 -40V390M410 -40V390M540 -40V390"/><path d="M35 0L120 100L300 155L480 350M0 290L185 205L360 55L600 20"/><path d="M115 75H195V125H115ZM245 75H365V125H245ZM245 170H365V218H245ZM435 170H515V218H435ZM115 270H195V320H115Z"/></g><path d="M-15 150H220V245H410V350" stroke="var(--drip-accent)" strokeWidth="3"/><g fill="var(--drip-accent)"><circle cx="220" cy="150" r="5"/><circle cx="220" cy="245" r="5"/><circle cx="410" cy="245" r="5"/></g></svg><div className="auth-disciplines"><span>01 · Progetto</span><span>02 · Simulazione</span><span>03 · Digital Twin</span></div></section>
      <main className="auth-card">
        <TechnicalLockup />
        <div className="auth-intro">
          <span className="auth-eyebrow">ACCESSO ALLA POSTAZIONE</span><h1>Benvenuto in Urban</h1>
          <p>Pianificazione urbana, progettazione stradale, traffico e digital twin.</p>
        </div>
        {providers.map((p) => (
          <a key={p.id} className={`auth-provider ${p.id === 'drip' ? 'is-drip' : ''}`} href={`/api/auth/oidc/${encodeURIComponent(p.id)}/login?next=${encodeURIComponent(next)}`}>
            {p.id === 'drip' ? <img src="/brand/drip-mark-reverse.svg" alt="" /> : <Icon name="shield" size={18} />}
            <span>Accedi con {p.label}</span>
            <Icon name="chevronRight" size={16} />
          </a>
        ))}
        {session?.localLogin !== false ? (
          <>
            {providers.length ? <div className="auth-sep"><span>oppure accesso locale</span></div> : null}
            <form className="auth-form" onSubmit={submit} aria-busy={busy}>
              <label className="field"><span className="field-label">Utente</span>
                <input className="text-field" disabled={busy} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!providers.length} required />
              </label>
              <label className="field"><span className="field-label">Password</span>
                <div className="auth-password"><input className="text-field" aria-label="Password" disabled={busy} type={showPassword?'text':'password'} autoComplete="current-password" onKeyDown={e=>setCaps(e.getModifierState('CapsLock'))} value={password} onChange={(e) => setPassword(e.target.value)} required /><button type="button" className="auth-password-toggle" aria-label={showPassword?'Nascondi password':'Mostra password'} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?'Nascondi':'Mostra'}</button></div>
              </label>
              {caps&&<p role="status" className="auth-hint">Blocco maiuscole attivo.</p>}<Button type="submit" variant="primary" busy={busy} disabled={busy}>{busy?'Verifica accesso…':'Entra nella postazione'}</Button>
            </form>
            {session?.provisionalHint ? <p className="auth-hint"><Icon name="key" size={14} />{session.provisionalHint}</p> : null}
          </>
        ) : null}
        {error ? <p className="auth-error" role="alert"><Icon name="warning" size={14} />{error}</p> : null}
        <footer className="auth-foot">DRIP Studio · i dati restano su questo computer, l'accesso è verificato da DRIP ID o dalle credenziali locali.</footer>
      </main>
    </div>
  );
}

/** Forced change of a provisional password (first login of the local administrator). */
export function ChangePassword() {
  const user = useSession((s) => s.session?.user);
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setError('Le due password non coincidono'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password', { old, new: pw });
      await loadSession();
      location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <div className="auth-screen">
      <main className="auth-card">
        <TechnicalLockup />
        <div className="auth-intro">
          <h1>Nuova password</h1>
          <p>{user?.provisional ? 'Stai usando le credenziali provvisorie. Scegli una password personale per continuare.' : 'Per continuare devi cambiare la password.'}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field"><span className="field-label">Password attuale</span><input className="text-field" type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} required autoFocus /></label>
          <label className="field"><span className="field-label">Nuova password</span><input className="text-field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} /></label>
          <label className="field"><span className="field-label">Ripeti la nuova password</span><input className="text-field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={10} /></label>
          <p className="field-hint">Almeno 10 caratteri, una maiuscola e un numero.</p>
          <Button type="submit" variant="primary" busy={busy}>Salva e continua</Button>
        </form>
        {error ? <p className="auth-error" role="alert"><Icon name="warning" size={14} />{error}</p> : null}
        <button type="button" className="auth-link" onClick={() => void logout()}>Esci</button>
      </main>
    </div>
  );
}
