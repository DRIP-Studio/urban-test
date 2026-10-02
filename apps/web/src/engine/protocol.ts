import type { CityBaseline, Operation, SignalHead, SimFrame, SimOptions } from '@drip-urban/core';
import type { Feature, FeatureCollection, Geometry, Polygon, LineString } from './geojson';

/** Changes of one physical layer since the previous build. `full`: `add` holds the whole layer. */
export interface LayerDiff<G extends Geometry> {
  readonly full: boolean;
  readonly add: Feature<G>[];
  readonly remove: string[];
}
export interface PhysicalDiff {
  readonly surfaces: LayerDiff<Polygon>;
  readonly markings: LayerDiff<Polygon>;
  readonly lines: LayerDiff<LineString>;
  readonly heads: readonly SignalHead[];
}

export interface PhysicalPayload {
  readonly surfaces: FeatureCollection<Polygon>;
  readonly markings: FeatureCollection<Polygon>;
  readonly lines: FeatureCollection<LineString>;
  readonly heads: readonly SignalHead[];
}

export type EngineRequest =
  | { type: 'init'; baseline: CityBaseline }
  | { type: 'build'; rev: number; ops: readonly Operation[]; full?: boolean }
  | { type: 'job'; id: number; kind: string; args: Record<string, unknown> }
  | { type: 'sim'; cmd: 'start' | 'stop' | 'pause' | 'resume' | 'speed'; options?: SimOptions; speed?: number };

export type EngineResponse =
  | { type: 'ready' }
  | { type: 'physical'; rev: number; diff: PhysicalDiff; stats: { roads: number; junctions: number; roundabouts: number; markings: number; ms: number }; failed: { opId: string; type: string; messages: string[] }[] }
  | { type: 'job'; id: number; ok: boolean; result?: unknown; error?: string }
  | { type: 'simFrame'; frame: SimFrame }
  | { type: 'simStopped' }
  | { type: 'error'; message: string };
