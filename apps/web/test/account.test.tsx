// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LicenseInfo } from '../src/api/types';
import { useSession } from '../src/state/session';
vi.mock('../src/state/store', () => ({ setDock: vi.fn(), useApp: (fn: (s: unknown) => unknown) => fn({ project: null }) }));
vi.mock('../src/api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '../src/api/client';
import { Avatar } from '../src/shell/UserMenu';
import { AppsLauncher } from '../src/shell/AppsLauncher';
afterEach(() => { cleanup(); useSession.setState({ license: null, session: null }); vi.clearAllMocks(); });
const license = (status: string, features = ['design'], source = 'key') => ({ status, plan: 'pro', source, features } as LicenseInfo);

it.each(['active', 'offline_grace'])('shows a DRIP ring for a real qualifying %s entitlement', (status) => {
  useSession.setState({ license: license(status) });
  const ui = render(<Avatar name="Ada Rossi" />);
  expect(ui.container.querySelector('.is-subscribed')?.textContent).toBe('AR');
});
it.each(['expired', 'revoked', 'suspended', 'unlicensed'])('does not show a subscription ring for %s', (status) => {
  useSession.setState({ license: license(status) });
  const ui = render(<Avatar name="Ada Rossi" />);
  expect(ui.container.querySelector('.is-subscribed')).toBeNull();
});
it('does not treat an empty entitlement or a trial as a paid subscription', () => {
  useSession.setState({ license: license('active', []) });
  const ui = render(<Avatar name="Ada Rossi" />);
  expect(ui.container.querySelector('.is-subscribed')).toBeNull();
});
it('falls back to initials when an account photo fails to load', () => {
  const ui = render(<Avatar name="Ada Rossi" picture="https://example.test/a.png" />);
  fireEvent.error(ui.container.querySelector('img')!);
  expect(ui.container.querySelector('img')).toBeNull();
  expect(ui.container.textContent).toBe('AR');
});
it('launcher opens configured services and explains unavailable entitlements and missing URLs', async () => {
  vi.mocked(api.get).mockResolvedValue([
    { id: 'one', label: 'Servizio attivo', url: 'https://example.test', description: 'A', entitlement: 'active' },
    { id: 'two', label: 'Servizio escluso', url: 'https://example.test/no', description: 'B', entitlement: 'unavailable' },
    { id: 'three', label: 'Servizio da configurare', url: '', description: 'C', entitlement: 'unknown' },
  ]);
  const ui = render(<AppsLauncher />);
  fireEvent.click(ui.getByRole('button', { name: 'Servizi DRIP' }));
  await waitFor(() => expect(ui.getByRole('link', { name: /Servizio attivo/ }).getAttribute('href')).toBe('https://example.test'));
  expect(ui.queryByRole('link', { name: /Servizio escluso/ })).toBeNull();
  expect(ui.getByText('non incluso')).toBeTruthy();
  expect(ui.getByText('da configurare')).toBeTruthy();
});
