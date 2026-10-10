import {ErrorBoundary} from './ui/ErrorBoundary';
import { useEffect } from 'react';
import { Hub } from './hub/Hub';
import { PublicationView } from './present/PublicationView';
import { CommandPalette, Toasts } from './shell/Chrome';
import { Workspace } from './shell/Workspace';
import { ChangePassword, Login } from './shell/Login';
import { installSessionGate, loadSession, useSession } from './state/session';
import { startRouting, useApp } from './state/store';
import { ConfirmHost } from './ui/confirm';
import { startCollab } from './state/collab';

export function App() {
  const route = useApp((s) => s.route);
  const gate = useSession((s) => s.gate);
  const ready = useSession((s) => s.session !== null);
  useEffect(() => { installSessionGate(); startCollab(); void loadSession().then(() => startRouting()); }, []);
  // Public civic pages never require an account.
  const isPublic = route.view === 'publication' || location.hash.startsWith('#/civico/');
  const body = isPublic ? <PublicationView pubId={route.view === 'publication' ? route.pubId : decodeURIComponent(location.hash.split('/')[2] ?? '')} />
    : !ready ? <div className="fullscreen-state"><span className="spinner lg" /></div>
    : gate === 'login' ? <Login />
    : gate === 'password' ? <ChangePassword />
    : route.view === 'hub' ? <Hub /> : route.view === 'workspace' ? <Workspace /> : null;
  return (
    <>
      <ErrorBoundary key={route.view} label="Applicazione">{body}</ErrorBoundary>
      <CommandPalette />
      <Toasts />
      <ConfirmHost />
    </>
  );
}
