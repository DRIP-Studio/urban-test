import { create } from 'zustand';

export type ToastKind = 'success' | 'info' | 'warn' | 'error' | 'progress';
export interface Toast { id: number; kind: ToastKind; title: string; body?: string; progress?: number; action?: { label: string; run: () => void } }

export const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let seq = 0;
const timers = new Map<number, { handle: ReturnType<typeof setTimeout> | null; remaining: number; started: number; pauses: Set<string> }>();
function schedule(id: number, duration: number) {
  const previous = timers.get(id);
  if (previous?.handle) clearTimeout(previous.handle);
  if (!useToasts.getState().items.some(item => item.id === id)) return;
  const timer = { handle: null as ReturnType<typeof setTimeout> | null, remaining: duration, started: Date.now(), pauses: previous?.pauses ?? new Set<string>() };
  timers.set(id, timer);
  if (!timer.pauses.size) timer.handle = setTimeout(() => dismiss(id), duration);
}
export function pauseToast(id: number, reason: string, paused: boolean): void {
  const timer = timers.get(id);
  if (!timer) return;
  if (paused) {
    if (!timer.pauses.size && timer.handle) { clearTimeout(timer.handle); timer.handle = null; timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started)); }
    timer.pauses.add(reason);
  } else {
    timer.pauses.delete(reason);
    if (!timer.pauses.size && !timer.handle) schedule(id, timer.remaining);
  }
}

function push(kind: ToastKind, title: string, body?: string, extra: Partial<Toast> = {}): number {
  const id = ++seq;
  for (const removed of useToasts.getState().items.slice(0, -4)) dismiss(removed.id);
  useToasts.setState((s) => ({ items: [...s.items.slice(-4), { id, kind, title, body, ...extra }] }));
  if (kind !== 'progress' && !extra.action) schedule(id, kind === 'error' ? 9000 : 4200);
  return id;
}

export function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}

export const toast = {
  success: (t: string, b?: string) => push('success', t, b),
  info: (t: string, b?: string) => push('info', t, b),
  warn: (t: string, b?: string) => push('warn', t, b),
  error: (t: string, b?: string, action?: Toast['action']) => push('error', t, b, action ? { action } : {}),
  progress: (t: string, b?: string) => push('progress', t, b, { progress: 0 }),
  update: (id: number, patch: Partial<Toast>) => useToasts.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  done: (id: number, title: string, body?: string) => {
    useToasts.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, kind: 'success', title, body, progress: undefined } : x)) }));
    schedule(id, 3500);
  },
  fail: (id: number, title: string, body?: string) => {
    useToasts.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, kind: 'error', title, body, progress: undefined } : x)) }));
    schedule(id, 9000);
  },
};
