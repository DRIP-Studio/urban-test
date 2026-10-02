import { create } from 'zustand';

/** Visibility of the keyboard shortcuts sheet (own module: commands and the sheet both use it). */
export const useShortcuts = create<{ open: boolean; toggle: () => void; close: () => void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
