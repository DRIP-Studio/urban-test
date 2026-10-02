import { create } from 'zustand';
import type { AreaKind, LngLat, RoundaboutType, ZoneKind } from '@drip-urban/core';
import type { SnapResult } from './snap';

export interface ToolState {
  /** Points of the shape being drawn (with their snap info). */
  draft: SnapResult[];
  cursor: SnapResult | null;
  roadTemplate: string;
  roadName: string;
  areaKind: AreaKind;
  areaMaterial: string;
  zoneKind: ZoneKind;
  furnitureId: string;
  signId: string;
  rotationDeg: number;
  /** Place on the same pole as this sign (pole composer). */
  poleId: string | null;
  recentSigns: string[];
  favoriteSigns: string[];
  arraySpacingM: number;
  arrayItem: string;
  /** Pending roundabout preview. */
  rb: { center: LngLat; nodeId: string | null; placed: boolean; type: RoundaboutType; outerDiameterM: number; circulatoryWidthM: number; lanes: 1 | 2; apronWidthM: number; aspect: number; orientationDeg: number; islandMaterial: string; splitters: boolean; crossings: boolean } | null;
  measure: { total: number; area: number | null } | null;
  routePick: { from: LngLat | null; to: LngLat | null; target: 'from' | 'to' };
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('drip-urban:tools') ?? '{}') as Partial<ToolState>; } catch { return {}; } })();

export const useTool = create<ToolState>(() => ({
  draft: [], cursor: null,
  roadTemplate: 'local', roadName: '', areaKind: 'plaza', areaMaterial: 'stone', zoneKind: 'ztl',
  furnitureId: 'vegetation.tree', signId: 'it.sign.dare_precedenza', rotationDeg: 0, poleId: null,
  recentSigns: saved.recentSigns ?? [], favoriteSigns: saved.favoriteSigns ?? [],
  arraySpacingM: 8, arrayItem: 'vegetation.tree', rb: null, measure: null,
  routePick: { from: null, to: null, target: 'from' },
}));

useTool.subscribe((s) => {
  try { localStorage.setItem('drip-urban:tools', JSON.stringify({ recentSigns: s.recentSigns, favoriteSigns: s.favoriteSigns })); } catch { /* ignore */ }
});

export const resetDraft = () => useTool.setState({ draft: [], cursor: null, measure: null });
