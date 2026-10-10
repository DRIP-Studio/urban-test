import { afterEach, expect, it, vi } from 'vitest';
import { dismiss, pauseToast, toast, useToasts } from '../src/state/toasts';
afterEach(() => { for (const item of useToasts.getState().items) dismiss(item.id); vi.useRealTimers(); });
it('preserves remaining reading time until both hover and focus leave', () => {
  vi.useFakeTimers();
  const id = toast.info('Read me');
  vi.advanceTimersByTime(3000);
  pauseToast(id, 'hover', true);
  pauseToast(id, 'focus', true);
  vi.advanceTimersByTime(10000);
  pauseToast(id, 'hover', false);
  vi.advanceTimersByTime(10000);
  expect(useToasts.getState().items).toHaveLength(1);
  pauseToast(id, 'focus', false);
  vi.advanceTimersByTime(1199);
  expect(useToasts.getState().items).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(useToasts.getState().items).toHaveLength(0);
});
it('keeps recovery actions available until explicit dismissal', () => {
  vi.useFakeTimers();
  toast.error('Unavailable', 'Retry later', { label: 'Retry', run: () => undefined });
  vi.advanceTimersByTime(60000);
  expect(useToasts.getState().items).toHaveLength(1);
});
