import { create } from 'zustand';
import { api, CLIENT_ID } from '../api/client';
import type { ProjectDetail } from '../api/types';
import { decideRemoteSave, othersOnline, type PresenceUser, type SavedEvent } from './collabLogic';
import { useSession } from './session';
import { pullRemote, setRemoteHint, useApp } from './store';

/**
 * Live collaboration on the open project: one EventSource on /api/projects/<id>/events (session
 * cookie authenticates it), presence of colleagues and automatic pull of their saves.
 */
interface CollabState {
  /** Other users with the project open (the signed-in user excluded). */
  online: PresenceUser[];
  connected: boolean;
  /** A colleague's save waiting for our unsaved changes to be saved (then rebased). */
  pending: { scenarioId: string; revision: number; author: string } | null;
}

export const useCollab = create<CollabState>(() => ({ online: [], connected: false, pending: null }));

let es: EventSource | null = null;
let esProject: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let openedOnce = false;

const me = (): string | null => {
  const u = useSession.getState().session?.user;
  return u ? u.username ?? u.sub : null;
};

function disconnect(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  es?.close();
  es = null;
  esProject = null;
  openedOnce = false;
  attempts = 0;
  useCollab.setState({ online: [], connected: false, pending: null });
}

function connect(pid: string | null): void {
  disconnect();
  if (!pid || typeof EventSource === 'undefined') return;
  esProject = pid;
  const sid = useApp.getState().scenario?.id;
  const src = new EventSource(`/api/projects/${encodeURIComponent(pid)}/events?client=${encodeURIComponent(CLIENT_ID)}${sid ? `&scenario=${encodeURIComponent(sid)}` : ''}`);
  es = src;
  src.onopen = () => {
    attempts = 0;
    useCollab.setState({ connected: true });
    if (openedOnce) void catchUp(pid);
    openedOnce = true;
    announce();
  };
  src.addEventListener('presence', (e) => {
    try {
      const { users } = JSON.parse((e as MessageEvent<string>).data) as { users: PresenceUser[] };
      useCollab.setState({ online: othersOnline(users, me()) });
    } catch { /* malformed event */ }
  });
  src.addEventListener('scenario.saved', (e) => {
    try { onSaved(JSON.parse((e as MessageEvent<string>).data) as SavedEvent); } catch { /* malformed event */ }
  });
  src.onerror = () => {
    useCollab.setState({ connected: false });
    // The browser retries transient errors itself; a closed stream (401, server restarted) is reopened with backoff.
    if (src.readyState === EventSource.CLOSED && es === src) {
      attempts += 1;
      retryTimer = setTimeout(() => { if (esProject === pid && es === src) reopen(pid); }, Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5)));
    }
  };
}

function reopen(pid: string): void {
  const n = attempts;
  connect(pid);
  attempts = n;
  openedOnce = true; // a reconnection: catch up on saves missed while offline
}

/** After a reconnection: saves that happened while the stream was down. */
async function catchUp(pid: string): Promise<void> {
  try {
    const p = await api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(pid)}`);
    const sc = useApp.getState().scenario;
    const remote = sc ? p.scenarios.find((s) => s.id === sc.id) : undefined;
    if (remote && sc) onSaved({ scenarioId: sc.id, revision: remote.revision, author: 'un altro utente' });
  } catch { /* offline again: the next reconnection retries */ }
}

function announce(): void {
  const { project, scenario } = useApp.getState();
  if (!project || project.id !== esProject) return;
  void api.post(`/api/projects/${encodeURIComponent(project.id)}/presence`, { scenarioId: scenario?.id ?? null, clientId: CLIENT_ID }).catch(() => undefined);
}

function onSaved(ev: SavedEvent): void {
  const { scenario, saveStatus } = useApp.getState();
  const decision = decideRemoteSave(ev, {
    clientId: CLIENT_ID, scenarioId: scenario?.id ?? null, revision: scenario?.revision ?? 0, isBaseline: !!scenario?.isBaseline,
    busy: saveStatus !== 'saved',
  });
  if (decision === 'ignore') return;
  if (decision === 'defer') { defer(ev); return; }
  void pull(ev);
}

function defer(ev: SavedEvent): void {
  useCollab.setState({ pending: { scenarioId: ev.scenarioId, revision: ev.revision, author: ev.author } });
  setRemoteHint(ev.author);
}

async function pull(ev: { scenarioId: string; revision: number; author: string }): Promise<void> {
  const r = await pullRemote(ev.scenarioId, ev.revision, ev.author);
  if (r === 'pending') defer(ev);
  else useCollab.setState({ pending: null });
}

let started = false;
/** Follows the open project and scenario; idempotent. */
export function startCollab(): void {
  if (started) return;
  started = true;
  useApp.subscribe((s, prev) => {
    const pid = s.project?.id ?? null;
    if (pid !== esProject) connect(pid);
    else if (pid && s.scenario?.id !== prev.scenario?.id) announce();
    // A deferred remote save: done once our own save went through (or a 409 rebase already merged it).
    const p = useCollab.getState().pending;
    if (!p) return;
    if (!s.scenario || s.scenario.id !== p.scenarioId || s.scenario.revision >= p.revision) {
      useCollab.setState({ pending: null });
      setRemoteHint(null);
    } else if (s.saveStatus === 'saved' && prev.saveStatus !== 'saved') {
      void pull(p);
    }
  });
}
