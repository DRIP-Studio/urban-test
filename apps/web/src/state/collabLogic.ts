/** Pure rules of live collaboration (no browser APIs: unit-tested). */

export interface PresenceUser {
  readonly name: string;
  readonly username: string;
  readonly scenarioId: string | null;
  readonly since: string;
}

export interface SavedEvent {
  readonly scenarioId: string;
  readonly revision: number;
  readonly author: string;
  readonly username?: string;
  readonly clientId?: string;
}

export interface LocalView {
  /** This window's id (X-Drip-Client). */
  readonly clientId: string;
  readonly scenarioId: string | null;
  readonly revision: number;
  readonly isBaseline: boolean;
  /** Unsaved or in-flight local changes. */
  readonly busy: boolean;
}

export type RemoteSaveDecision = 'ignore' | 'pull' | 'defer';

/**
 * What to do with a `scenario.saved` event: ignore our own saves, other scenarios and revisions we
 * already have; pull when there is nothing local to lose; otherwise defer to the rebase-on-save path.
 */
export function decideRemoteSave(ev: SavedEvent, local: LocalView): RemoteSaveDecision {
  if (!local.scenarioId || ev.scenarioId !== local.scenarioId || local.isBaseline) return 'ignore';
  if (ev.clientId && ev.clientId === local.clientId) return 'ignore';
  if (!(ev.revision > local.revision)) return 'ignore';
  return local.busy ? 'defer' : 'pull';
}

/** Everyone in the project except the signed-in user (one row per username). */
export function othersOnline(users: readonly PresenceUser[], me: string | null): PresenceUser[] {
  const seen = new Set<string>();
  const out: PresenceUser[] = [];
  for (const u of users) {
    if ((me && u.username === me) || seen.has(u.username)) continue;
    seen.add(u.username);
    out.push(u);
  }
  return out;
}

/** Avatars shown in the top bar (at most `max`) and the «+N» remainder. */
export function avatarStack<T>(users: readonly T[], max = 3): { shown: T[]; extra: number } {
  return { shown: users.slice(0, max), extra: Math.max(0, users.length - max) };
}

/** Tooltip line: «Anna Rossi · Scenario A» (scenario name when known). */
export function presenceLabel(u: PresenceUser, scenarioNames: Readonly<Record<string, string>>): string {
  const sc = u.scenarioId ? scenarioNames[u.scenarioId] ?? u.scenarioId : null;
  return sc ? `${u.name} · ${sc}` : u.name;
}
