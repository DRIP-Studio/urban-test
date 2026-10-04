import { LocalFrame, type Network, type PhysicalModel, type TerrainGrid } from '@drip-urban/core';

/** Tiny synthetic project shared by the IFC and LandXML tests. */
export const origin: [number, number] = [14.27, 40.94];
const f = new LocalFrame(origin);

export const network = {
  nodes: { a: { id: 'a', at: f.toLngLat([0, 0]) }, b: { id: 'b', at: f.toLngLat([100, 0]) } },
  junctions: {}, roundabouts: {}, signalPlans: {}, areas: {}, zones: {},
  roads: {
    r1: {
      id: 'r1', from: 'a', to: 'b', name: "Via dell'Unità & <Italia>", roadClass: 'residential',
      axis: [f.toLngLat([0, 0]), f.toLngLat([50, 10]), f.toLngLat([100, 0])], oneway: 'no', speedKmh: 30, lanes: [], section: { elements: [] }, provenance: {},
      vertical: { pvis: [{ station: 0, elevation: 20 }, { station: 50, elevation: 22.5, curveLength: 30 }, { station: 102, elevation: 21 }] },
    },
  },
  assets: {
    a1: { id: 'a1', type: 'furniture.bench.linear', at: f.toLngLat([5, 5]), rotationDeg: 90, state: 'project', properties: {}, provenance: { kind: 'project', source: 't' } },
    a2: { id: 'a2', type: 'it.sign.zona_30_kmh', at: f.toLngLat([8, 5]), rotationDeg: 0, state: 'existing', properties: {}, provenance: { kind: 'osm', source: 't' } },
    a3: { id: 'a3', type: 'furniture.bin', at: f.toLngLat([9, 5]), rotationDeg: 0, state: 'removed', properties: {}, provenance: { kind: 'osm', source: 't' } },
  },
} as unknown as Network;

export const physical = {
  surfaces: [{ id: 's1', kind: 'sidewalk', roadId: 'r1', ring: [f.toLngLat([0, 0]), f.toLngLat([10, 0]), f.toLngLat([10, 10]), f.toLngLat([0, 10]), f.toLngLat([0, 0])], state: 'existing', material: 'concrete_pavers', z: 1, heightM: 0.15 }],
  markings: [], lines: [], stats: { roads: 1, junctions: 0, roundabouts: 0, markings: 0, ms: 0 },
} as unknown as PhysicalModel;

const sw = f.toLngLat([-20, -20]), ne = f.toLngLat([120, 30]);
export const terrain: TerrainGrid = { west: sw[0], south: sw[1], east: ne[0], north: ne[1], nx: 3, ny: 3, z: [10, 11, 12, 13, 14, 15, 16, 17, 18], source: 'test', resolutionM: 50 };

export const furniture = [{ id: 'furniture.bench.linear', label: 'Panchina lineare', dims: { w: 1.8, d: 0.6, h: 0.8 } }];
