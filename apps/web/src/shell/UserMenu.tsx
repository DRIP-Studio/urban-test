import { useRef, useState } from 'react';
import { api } from '../api/client';
import { loadSession, logout, useSession } from '../state/session';
import { toast } from '../state/toasts';
import { setDock, useApp } from '../state/store';
import { Icon } from '../ui/Icon';
import { MenuItem, Popover } from '../ui/Popover';
import { toggleTheme, useTheme } from '../ui/theme';

const ROLE_IT: Record<string, string> = { viewer: 'Lettura', editor: 'Modifica', publisher: 'Pubblicazione civica', admin: 'Amministratore' };

export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, ' ').split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '·';
}

const SUBSCRIBED = new Set(['active', 'offline_grace']);

/**
 * Account picture: photo when there is one (initials otherwise, also when the photo fails to load);
 * a DRIP-blue ring when the DRIP subscription is active, dashed during the trial.
 */
export function Avatar({ name, picture, size = 'md' }: { name: string; picture?: string | null; size?: 'md' | 'lg' }) {
  const license = useSession((s) => s.license);
  const [broken, setBroken] = useState<string | null>(null);
  const ring = license && license.source !== 'trial' && license.plan !== 'trial' && license.features.length > 0 && SUBSCRIBED.has(license.status) ? 'is-subscribed' : license?.status === 'trialing' ? 'is-trial' : '';
  return (
    <span className={`avatar avatar-${size} ${ring}`}>
      {picture && broken !== picture ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(picture)} /> : initials(name)}
    </span>
  );
}

/** Avatar with account, subscription and sign-out. */
export function UserMenu() {
  const session = useSession((s) => s.session);
  const license = useSession((s) => s.license);
  const inProject = useApp((s) => !!s.project);
  const theme = useTheme((s) => s.theme);
  const user = session?.user;
  if (!user) return null;
  return (
    <Popover align="end" width={280} trigger={(open, toggle) => (
      <button type="button" className="user-btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" data-tip={`${user.name} · ${ROLE_IT[user.role] ?? user.role}${license && SUBSCRIBED.has(license.status) ? ` · abbonato DRIP ${license.planLabel}` : ''}`} aria-label={`Account di ${user.name}`}>
        <Avatar name={user.name} picture={user.picture} />
      </button>
    )}>
      {(close) => (
        <div className="user-menu">
          <div className="um-head">
            <Avatar name={user.name} picture={user.picture} size="lg" />
            <div><strong>{user.name}</strong><span>{ROLE_IT[user.role] ?? user.role} · {user.provider === 'open' ? 'postazione singola' : user.providerLabel ?? (user.provider === 'local' ? 'accesso locale' : user.provider)}</span></div>
          </div>
          {user.email ? <p className="um-note">{user.email}</p> : null}
          {license ? <div className="um-head"><span className="plan-chip">{license.planLabel}</span><span>{license.status === 'trialing' ? `${license.daysLeft ?? 0} giorni di prova` : license.validUntil ? `fino al ${new Date(license.validUntil).toLocaleDateString('it-IT')}` : ''}</span></div> : null}
          {user.provider === 'local' ? <PhotoControls hasPhoto={!!user.picture} /> : user.provider !== 'open' ? <p className="um-note">La foto si cambia dal profilo DRIP ID.</p> : null}
          <div className="menu-sep" />
          {inProject ? <MenuItem icon={<Icon name="settings" size={15} />} label="Account, licenza e integrazioni" onClick={() => { close(); setDock('settings'); }} /> : null}
          <MenuItem icon={<Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />} label={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'} onClick={() => { close(); toggleTheme(); }} />
          {session?.mode === 'protected' ? <MenuItem icon={<Icon name="logout" size={15} />} label="Esci" onClick={() => { close(); void logout(); }} /> : null}
        </div>
      )}
    </Popover>
  );
}

/** Banner for trials near the end, expired subscriptions and updates ready to install. */
export function PlatformBanner() {
  const license = useSession((s) => s.license);
  const update = useSession((s) => s.update);
  const items: { icon: string; text: string }[] = [];
  if (license) {
    if (license.status === 'trialing' && (license.daysLeft ?? 99) <= 7) items.push({ icon: 'credit', text: `Periodo di prova: ${license.daysLeft} giorni rimasti. Attiva l'abbonamento DRIP da Impostazioni.` });
    if (['expired', 'unlicensed', 'offline_expired'].includes(license.status)) items.push({ icon: 'warning', text: license.status === 'offline_expired' ? 'Licenza non verificata da oltre 14 giorni: collegati a Internet o accedi con DRIP ID.' : 'Abbonamento DRIP non attivo: alcune funzioni potrebbero essere limitate.' });
  }
  if (update?.available && !update.pending) items.push({ icon: 'download', text: `Disponibile DRIP Urban ${update.latest?.version}: scaricalo da Impostazioni → Aggiornamenti.` });
  if (update?.pending) items.push({ icon: 'refresh', text: `Aggiornamento ${update.pending.version} pronto: verrà installato al prossimo avvio.` });
  if (!items.length) return null;
  return <>{items.map((it) => <div key={it.text} className="license-banner"><Icon name={it.icon} size={16} /><span>{it.text}</span></div>)}</>;
}

/** Local accounts: upload or remove the profile photo (PNG, JPEG or WebP up to 256 KB). */
function PhotoControls({ hasPhoto }: { hasPhoto: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (file: File | null) => {
    setBusy(true);
    try {
      if (file) {
        if (file.size > 256 * 1024) throw new Error('La foto deve pesare al massimo 256 KB');
        const fd = new FormData(); fd.append('file', file);
        await api.put('/api/auth/me/avatar', fd);
      } else await api.del('/api/auth/me/avatar');
      await loadSession();
    } catch (e) { toast.error('Foto non aggiornata', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="um-photo">
      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => input.current?.click()}>{hasPhoto ? 'Cambia foto' : 'Aggiungi foto'}</button>
      {hasPhoto ? <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void send(null)}>Rimuovi</button> : null}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) void send(f); }} />
    </div>
  );
}
