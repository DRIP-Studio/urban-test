import { useEffect } from 'react';
import { Hub } from './hub/Hub';
import { PublicationView } from './present/PublicationView';
import { CommandPalette, Toasts } from './shell/Chrome';
import { Workspace } from './shell/Workspace';
import { startRouting, useApp } from './state/store';
import { ConfirmHost } from './ui/confirm';

export function App() {
  const route = useApp((s) => s.route);
  useEffect(() => startRouting(), []);
  return (
    <>
      {route.view === 'hub' ? <Hub /> : route.view === 'workspace' ? <Workspace /> : <PublicationView pubId={route.pubId} />}
      <CommandPalette />
      <Toasts />
      <ConfirmHost />
    </>
  );
}
