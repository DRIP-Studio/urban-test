import { create } from 'zustand';

export type ToastKind = 'success' | 'info' | 'warn' | 'error' | 'progress';
export interface Toast { id: number; kind: ToastKind; title: string; body?: string; progress?: number; action?: { label: string; run: () => void } }

export const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let seq = 0;

function push(kind: ToastKind, title: string, body?: string, extra: Partial<Toast> = {}): number {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items.slice(-4), { id, kind, title, body, ...extra }] }));
  if (kind !== 'progress') setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4200);
  return id;
}

export function dismiss(id: number): void {
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
    setTimeout(() => dismiss(id), 3500);
  },
  fail: (id: number, title: string, body?: string) => {
    useToasts.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, kind: 'error', title, body, progress: undefined } : x)) }));
    setTimeout(() => dismiss(id), 9000);
  },
};
