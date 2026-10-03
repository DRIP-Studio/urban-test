import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { loadSession, logout, useSession } from '../state/session';
import { Button } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { TechnicalLockup } from './Brand';

function hashError(): string | null {
  const m = location.hash.match(/[?&]error=([^&]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Sign-in: DRIP ID / Keycloak (OpenID Connect) or the provisional local administrator. */
export function Login() {
  const session = useSession((s) => s.session);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="auth-screen">
      <div className="auth-aura" aria-hidden />
      <main className="auth-card">
        <TechnicalLockup size="lg" />
        <div className="auth-intro">
          <h1>Accedi</h1>
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
            <form className="auth-form" onSubmit={submit}>
              <label className="field"><span className="field-label">Utente</span>
                <input className="text-field" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!providers.length} required />
              </label>
              <label className="field"><span className="field-label">Password</span>
                <input className="text-field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <Button type="submit" variant="primary" busy={busy}>Entra</Button>
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
      <div className="auth-aura" aria-hidden />
      <main className="auth-card">
        <TechnicalLockup size="lg" />
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
