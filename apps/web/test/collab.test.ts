import { describe, expect, it } from 'vitest';
import { avatarStack, decideRemoteSave, othersOnline, presenceLabel, type LocalView, type PresenceUser } from '../src/state/collabLogic';

const local: LocalView = { clientId: 'me-1', scenarioId: 'scenario-a', revision: 4, isBaseline: false, busy: false };
const ev = { scenarioId: 'scenario-a', revision: 5, author: 'Bruno Bianchi', username: 'bruno', clientId: 'other-9' };

describe('remote save decision', () => {
  it('pulls a newer revision of the current scenario saved by someone else', () => {
    expect(decideRemoteSave(ev, local)).toBe('pull');
  });
  it('defers to the rebase-on-save path when there are local changes', () => {
    expect(decideRemoteSave(ev, { ...local, busy: true })).toBe('defer');
  });
  it('ignores own saves, other scenarios, stale revisions and the baseline', () => {
    expect(decideRemoteSave({ ...ev, clientId: 'me-1' }, local)).toBe('ignore');
    expect(decideRemoteSave({ ...ev, scenarioId: 's-other' }, local)).toBe('ignore');
    expect(decideRemoteSave({ ...ev, revision: 4 }, local)).toBe('ignore');
    expect(decideRemoteSave({ ...ev, revision: 3 }, local)).toBe('ignore');
    expect(decideRemoteSave(ev, { ...local, isBaseline: true })).toBe('ignore');
    expect(decideRemoteSave(ev, { ...local, scenarioId: null })).toBe('ignore');
  });
  it('a missing client id (catch-up after reconnection) still pulls', () => {
    expect(decideRemoteSave({ scenarioId: 'scenario-a', revision: 9, author: 'un altro utente' }, local)).toBe('pull');
  });
});

describe('presence', () => {
  const u = (username: string, scenarioId: string | null = 'scenario-a'): PresenceUser => ({ name: username.toUpperCase(), username, scenarioId, since: '2026-10-04T10:00:00+00:00' });
  it('excludes the signed-in user and duplicates', () => {
    expect(othersOnline([u('anna'), u('bruno'), u('bruno', 's-2'), u('carla')], 'anna').map((x) => x.username)).toEqual(['bruno', 'carla']);
    expect(othersOnline([u('anna')], 'anna')).toEqual([]);
  });
  it('stacks at most three avatars plus a remainder', () => {
    expect(avatarStack([1, 2], 3)).toEqual({ shown: [1, 2], extra: 0 });
    expect(avatarStack([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], extra: 2 });
  });
  it('labels with the scenario name when known', () => {
    expect(presenceLabel(u('anna'), { 'scenario-a': 'Scenario A' })).toBe('ANNA · Scenario A');
    expect(presenceLabel(u('anna', null), {})).toBe('ANNA');
  });
});
