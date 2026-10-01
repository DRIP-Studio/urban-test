import { create } from 'zustand';
import type { LngLat } from '@drip-urban/core';

export interface MenuRequest { x: number; y: number; lngLat: LngLat; point: { x: number; y: number } }

export const useContextMenu = create<{ req: MenuRequest | null; open: (r: MenuRequest) => void; close: () => void }>((set) => ({
  req: null,
  open: (req) => set({ req }),
  close: () => set({ req: null }),
}));
