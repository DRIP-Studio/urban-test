import { create } from 'zustand';
import type { AreaKind, LngLat, MarkingColor, BayPurpose, MarkingKind, RoadFeatureKind, RoundaboutType, ZoneKind } from '@drip-urban/core';
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
  /** Sign tool: a click on an existing sign adds the new plate under it on the same pole (Alt inverts). */
  signStack: boolean;
  recentSigns: string[];
  favoriteSigns: string[];
  arraySpacingM: number;
  /** Material applied by the paving tool. */
  pavingMaterial: string;
  arrayItem: string;
  /** Pending roundabout preview. */
  rb: { center: LngLat; nodeId: string | null; placed: boolean; type: RoundaboutType; outerDiameterM: number; circulatoryWidthM: number; lanes: 1 | 2; apronWidthM: number; aspect: number; orientationDeg: number; islandMaterial: string; splitters: boolean; crossings: boolean } | null;
  measure: { total: number; area: number | null } | null;
  routePick: { from: LngLat | null; to: LngLat | null; target: 'from' | 'to' };
  /** Horizontal marking tool. */
  markingKind: MarkingKind | 'bollards';
  bayPurpose: BayPurpose;
  markingColor: MarkingColor;
  markingText: string;
  markingSymbol: string;
  markingArrow: string;
  bayLayout: 'parallel' | 'perpendicular' | 'angled';
  /** Traffic calming tool. */
  calmingKind: RoadFeatureKind;
  calmingHeightCm: number;
  /** Placing an imported model demolishes the buildings and removes the furniture under it. */
  modelClear: boolean;
  /** Live advice of the road pen (curves, crossings): shown, never applied. */
  roadHints: { level: 'ok' | 'warn' | 'info'; text: string }[];
  drainKind: 'inlet' | 'manhole' | 'outfall';
  waterKind: 'junction' | 'reservoir' | 'tank' | 'hydrant' | 'valve';
  waterDn: number;
  waterMaterial: string;
  waterDemandLs: number;
  waterHeadM: number;
  drainDepthM: number;
  drainDn: number;
  drainMaterial: string;
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('drip-urban:tools') ?? '{}') as Partial<ToolState>; } catch { return {}; } })();

export const useTool = create<ToolState>(() => ({
  draft: [], cursor: null,
  roadTemplate: 'local', roadName: '', areaKind: 'plaza', areaMaterial: 'stone', zoneKind: 'ztl',
  furnitureId: 'vegetation.tree', signId: 'it.sign.dare_precedenza', rotationDeg: 0, poleId: null, signStack: true,
  recentSigns: saved.recentSigns ?? [], favoriteSigns: saved.favoriteSigns ?? [],
  arraySpacingM: 8, pavingMaterial: saved.pavingMaterial ?? 'porphyry', arrayItem: 'vegetation.tree', rb: null, measure: null,
  routePick: { from: null, to: null, target: 'from' },
  markingKind: 'line_solid', markingColor: 'white', markingText: 'STOP', markingSymbol: 'bike', markingArrow: 'through', bayLayout: 'parallel', bayPurpose: 'free',
  calmingKind: 'raised_crossing', calmingHeightCm: 10, modelClear: true, roadHints: [], drainKind: 'inlet', waterKind: 'reservoir', waterDn: 110, waterMaterial: 'pead', waterDemandLs: 0.5, waterHeadM: 40, drainDepthM: 1.5, drainDn: 315, drainMaterial: 'pvc',
}));

useTool.subscribe((s) => {
  try { localStorage.setItem('drip-urban:tools', JSON.stringify({ recentSigns: s.recentSigns, favoriteSigns: s.favoriteSigns, pavingMaterial: s.pavingMaterial })); } catch { /* ignore */ }
});

export const resetDraft = () => useTool.setState({ draft: [], cursor: null, measure: null });
