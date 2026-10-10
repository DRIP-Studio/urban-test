import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { setDock, useApp } from '../state/store';
import { useSession } from '../state/session';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';

interface Service { readonly id: string; readonly label: string; readonly description: string; readonly url: string; readonly current?: boolean; readonly entitlement?: 'active' | 'trial' | 'unavailable' | 'unknown' }

/** Brand tones of the DRIP system for the service marks (no third-party logos, no invented artwork). */
const TONE: Record<string, string> = {
  urban: '#83b4d1', account: '#0d0d0d', site: '#f3efe8', fst: '#7a1f32', elios: '#d6a6b3', fiscoflow: '#66866f', onecontrol: '#e2bd53', mail: '#ef643c', voice: '#5587a2',
};
const INK: Record<string, string> = { site: '#0d0d0d', elios: '#0d0d0d', onecontrol: '#0d0d0d', urban: '#0d0d0d' };

/**
 * The DRIP services grid next to the account (like the apps menu of a Google account). Every tile with
 * an address opens it; services this installation does not know yet are shown as «da configurare».
 */
export function AppsLauncher() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = useSession((s) => s.session?.user?.role === 'admin');
  const inProject = useApp((s) => !!s.project);
  const load = () => api.get<Service[]>('/api/platform/services').then((s) => { setServices(s); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  return (
    <Popover align="end" width={320} trigger={(open, toggle) => (
      <button type="button" className="icon-btn apps-btn" onClick={() => { if (!services) void load(); toggle(); }} aria-expanded={open} aria-haspopup="dialog" aria-label="Servizi DRIP" data-tip="Servizi DRIP">
        <Icon name="apps" size={18} />
      </button>
    )}>
      {(close) => (
        <div className="apps-menu">
          <div className="apps-head"><strong>Servizi DRIP</strong>{isAdmin && inProject ? <button type="button" className="link" onClick={() => { close(); setDock('settings'); }}>Configura</button> : null}</div>
          {error ? <p className="muted">Elenco non disponibile: {error}</p> : null}
          {!services && !error ? <p className="muted">Caricamento…</p> : null}
          <ul className="apps-grid">
            {(services ?? []).map((s) => {
              const mark = <span className="apps-mark" style={{ background: TONE[s.id] ?? 'var(--ink-3)', color: INK[s.id] ?? '#f3efe8' }} aria-hidden="true">{s.label.replace(/^DRIP\s+/i, '').slice(0, 1)}</span>;
              return (
                <li key={s.id}>
                  {s.entitlement === 'unavailable' ? (
                    <span className="apps-tile is-off" title={`${s.description} · entitlement richiesto non attivo`}>{mark}<span>{s.label}</span><small>non incluso</small></span>
                  ) : s.url && !s.current ? (
                    <a className="apps-tile" href={s.url} target="_blank" rel="noopener noreferrer" title={s.description} onClick={close}>{mark}<span>{s.label}</span>{s.entitlement === 'active' || s.entitlement === 'trial' ? <small>{s.entitlement === 'trial' ? 'in prova' : 'attivo'}</small> : null}</a>
                  ) : s.current ? (
                    <span className="apps-tile is-current" title="Sei qui">{mark}<span>{s.label}</span></span>
                  ) : (
                    <span className="apps-tile is-off" title={`${s.description} · indirizzo non configurato su questa installazione`}>{mark}<span>{s.label}</span><small>da configurare</small></span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Popover>
  );
}
