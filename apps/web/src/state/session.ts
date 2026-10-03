import { create } from 'zustand';
import { api } from '../api/client';
import type { LicenseInfo, SessionInfo, UpdateInfo } from '../api/types';

/** Who is signed in, which subscription is active, and whether an update is waiting. */
interface SessionState {
  session: SessionInfo | null;
  license: LicenseInfo | null;
  update: UpdateInfo | null;
  /** Set when the server answered 401 / password-change-required to any call. */
  gate: 'none' | 'login' | 'password';
}

export const useSession = create<SessionState>(() => ({ session: null, license: null, update: null, gate: 'none' }));

export async function loadSession(): Promise<SessionInfo | null> {
  try {
    const session = await api.get<SessionInfo>('/api/auth/session');
    const needLogin = session.mode === 'protected' && !session.authenticated;
    useSession.setState({ session, gate: needLogin ? 'login' : session.user?.mustChangePassword ? 'password' : 'none' });
    if (!needLogin && !session.user?.mustChangePassword) void loadPlatformStatus();
    return session;
  } catch {
    // Server offline: let the hub show its own "server not reachable" state.
    useSession.setState({ session: { mode: 'open', authenticated: false, user: null, localLogin: true, providers: [], provisionalHint: null }, gate: 'none' });
    return null;
  }
}

export async function loadPlatformStatus(): Promise<void> {
  const [license, update] = await Promise.all([
    api.get<LicenseInfo>('/api/license').catch(() => null),
    api.get<UpdateInfo>('/api/update').catch(() => null),
  ]);
  useSession.setState({ license, update });
}

export function hasFeature(feature: string): boolean {
  const l = useSession.getState().license;
  return !l || l.enforcement !== 'strict' || l.features.includes(feature);
}

export async function logout(): Promise<void> {
  const r = await api.post<{ redirect: string | null }>('/api/auth/logout').catch(() => ({ redirect: null }));
  if (r.redirect) { location.href = r.redirect; return; }
  await loadSession();
  location.hash = '#/';
}

let installed = false;
export function installSessionGate(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('drip:auth', (e) => {
    const kind = (e as CustomEvent<string>).detail;
    useSession.setState({ gate: kind === 'password' ? 'password' : 'login' });
  });
}
