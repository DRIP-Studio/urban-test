import { create } from 'zustand';

/** Interface theme: dark (default DRIP shell), light, or follow the operating system. */
export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

const KEY = 'drip-urban:theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch { /* storage blocked */ }
  return 'dark';
}

const resolve = (p: ThemePref): Theme => (p === 'system' ? (media?.matches ? 'light' : 'dark') : p);

interface ThemeState { pref: ThemePref; theme: Theme }

export const useTheme = create<ThemeState>(() => {
  const pref = readPref();
  return { pref, theme: resolve(pref) };
});

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setThemePref(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref); } catch { /* storage blocked */ }
  const theme = resolve(pref);
  useTheme.setState({ pref, theme });
  apply(theme);
}

export function toggleTheme(): void {
  setThemePref(useTheme.getState().theme === 'dark' ? 'light' : 'dark');
}

/** Applies the stored theme before the first paint and follows the OS when the preference is "system". */
export function installTheme(): void {
  apply(useTheme.getState().theme);
  media?.addEventListener('change', () => {
    const { pref } = useTheme.getState();
    if (pref === 'system') { const theme = resolve(pref); useTheme.setState({ theme }); apply(theme); }
  });
}

/** Interface scale, same as --px in tokens.css: icon and other sizes set from code follow it. */
export const UI_SCALE = 0.85;
