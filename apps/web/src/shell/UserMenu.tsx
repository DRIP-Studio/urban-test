import { logout, useSession } from '../state/session';
import { setDock, useApp } from '../state/store';
import { Icon } from '../ui/Icon';
import { MenuItem, Popover } from '../ui/Popover';

const ROLE_IT: Record<string, string> = { viewer: 'Lettura', editor: 'Modifica', publisher: 'Pubblicazione civica', admin: 'Amministratore' };

export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, ' ').split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '·';
}

/** Avatar with account, subscription and sign-out. */
export function UserMenu() {
  const session = useSession((s) => s.session);
  const license = useSession((s) => s.license);
  const inProject = useApp((s) => !!s.project);
  const user = session?.user;
  if (!user) return null;
  return (
    <Popover align="end" width={280} trigger={(open, toggle) => (
      <button type="button" className="user-btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" data-tip={`${user.name} · ${ROLE_IT[user.role] ?? user.role}`}>
        <span className="avatar">{initials(user.name)}</span>
      </button>
    )}>
      {(close) => (
        <div className="user-menu">
          <div className="um-head">
            <span className="avatar">{initials(user.name)}</span>
            <div><strong>{user.name}</strong><span>{ROLE_IT[user.role] ?? user.role} · {user.provider === 'open' ? 'postazione singola' : user.providerLabel ?? (user.provider === 'local' ? 'accesso locale' : user.provider)}</span></div>
          </div>
          {license ? <div className="um-head"><span className="plan-chip">{license.planLabel}</span><span>{license.status === 'trialing' ? `${license.daysLeft ?? 0} giorni di prova` : license.validUntil ? `fino al ${new Date(license.validUntil).toLocaleDateString('it-IT')}` : ''}</span></div> : null}
          <div className="menu-sep" />
          {inProject ? <MenuItem icon={<Icon name="settings" size={15} />} label="Account, licenza e integrazioni" onClick={() => { close(); setDock('settings'); }} /> : null}
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
