import { create } from 'zustand';
import { useApp } from './store';

/**
 * Live update: every analysis that is on screen (norm checks, drainage, traffic estimate, PGTU
 * classes, sidewalks…) registers a refresher; after each edit they all run again (debounced), so
 * maps and tables always describe the current scenario. Can be paused from the status bar.
 */
export const useLive = create<{ enabled: boolean; running: number; last: number }>(() => ({ enabled: true, running: 0, last: 0 }));
const refreshers = new Map<string, () => unknown>();

export function registerLive(key: string, fn: () => unknown): () => void {
  refreshers.set(key, fn);
  return () => { if (refreshers.get(key) === fn) refreshers.delete(key); };
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function refreshAll(): void {
  for (const [key, fn] of refreshers) {
    useLive.setState((s) => ({ running: s.running + 1 }));
    Promise.resolve().then(fn).catch((e: unknown) => console.warn('[live]', key, e)).finally(() => useLive.setState((s) => ({ running: s.running - 1, last: Date.now() })));
  }
}

useApp.subscribe((st, prev) => {
  if (st.netVersion === prev.netVersion || !st.project || !useLive.getState().enabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(refreshAll, 900);
});

export const setLive = (enabled: boolean) => { useLive.setState({ enabled }); if (enabled) refreshAll(); };
