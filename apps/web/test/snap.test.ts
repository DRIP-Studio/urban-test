// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { LocalFrame, type Network } from '@drip-urban/core';
import type { Map } from 'maplibre-gl';
import { useMapUi } from '../src/map/mapStore';
import { NetworkIndex, objectSnap, snap, toggleAllSnaps } from '../src/tools/snap';

const origin = [14.27, 40.94] as const;
const frame = new LocalFrame(origin);
const at = frame.toLngLat([1.2, 0.7]);
const net: Network = { nodes: { n: { id: 'n', at: origin } }, roads: {}, assets: {}, areas: {}, junctions: {}, roundabouts: {}, signalPlans: {}, zones: {} };
const idx = new NetworkIndex(net, origin);
beforeEach(() => useMapUi.setState({ snapEnabled: true, snap: { node: true, edge: false, objects: true, angle: false, grid: true }, gridM: 5, mpp: 1 }));

it('global off preserves the exact pointer coordinate and disables object alignment', () => {
  expect(snap({} as Map, idx, at).kind).toBe('node');
  toggleAllSnaps();
  expect(snap({} as Map, idx, at, { from: origin })).toEqual({ at, kind: 'free' });
  expect(objectSnap({ alt: false })).toBe(false);
  expect(JSON.parse(localStorage.getItem('drip-urban:map')!).snapEnabled).toBe(false);
});
it('off/on restores individual snap preferences including the grid', () => {
  const settings = useMapUi.getState().snap;
  expect(toggleAllSnaps()).toBe(false);
  expect(toggleAllSnaps()).toBe(true);
  expect(useMapUi.getState().snap).toEqual(settings);
  expect(objectSnap({ alt: true })).toBe(false);
  expect(snap({} as Map, idx, at, { disable: true })).toEqual({ at, kind: 'free' });
});
