// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ commit: vi.fn(), success: vi.fn(), warn: vi.fn() }));
vi.mock('../src/state/store', () => ({ commit: mocks.commit, newId: () => 'test', onCommit: vi.fn(), openDock: vi.fn(), select: vi.fn(), useApp: { getState: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../src/state/toasts', () => ({ toast: { success: mocks.success, warn: mocks.warn } }));
import { applySuggestion, useSuggest, type Suggestion } from '../src/state/suggestions';
const card: Suggestion = { key: 'test', title: 'Test', detail: '', icon: 'road', actions: [], valid: () => true };
beforeEach(() => { vi.clearAllMocks(); useSuggest.setState({ items: [card], dismissed: new Set() }); });
it('a rejected commit retains the card and never claims success', () => {
  mocks.commit.mockReturnValue({ ok: false, issues: [{ message: 'Scenario bloccato' }] });
  expect(applySuggestion('test', 'Marciapiedi', [{ type: 'road.setSection', payload: {} }])).toBe(false);
  expect(useSuggest.getState().items).toEqual([card]);
  expect(useSuggest.getState().dismissed.has('test')).toBe(false);
  expect(mocks.success).not.toHaveBeenCalled();
});
it('a successful action commits one undoable batch and then confirms and dismisses', () => {
  mocks.commit.mockReturnValue({ ok: true, issues: [] });
  const ops = [{ type: 'road.update', payload: { roadId: 'r', changes: { speedKmh: 30 } } }];
  expect(applySuggestion('test', 'Zona 30', ops)).toBe(true);
  expect(mocks.commit).toHaveBeenCalledExactlyOnceWith('batch', { label: 'Zona 30', ops });
  expect(useSuggest.getState().items).toEqual([]);
  expect(mocks.success).toHaveBeenCalledOnce();
});
it('an empty action explains the missing requirement and retains the card', () => {
  expect(applySuggestion('test', 'Segnali', [])).toBe(false);
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledOnce();
  expect(useSuggest.getState().items).toEqual([card]);
});
