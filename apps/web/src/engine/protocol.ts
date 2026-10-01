import type { CityBaseline, Operation, SignalHead, SimFrame, SimOptions } from '@drip-urban/core';
import type { FeatureCollection, Polygon, LineString } from './geojson';

export interface PhysicalPayload {
  readonly surfaces: FeatureCollection<Polygon>;
  readonly markings: FeatureCollection<Polygon>;
  readonly lines: FeatureCollection<LineString>;
  readonly heads: readonly SignalHead[];
}

export type EngineRequest =
  | { type: 'init'; baseline: CityBaseline }
  | { type: 'build'; rev: number; ops: readonly Operation[] }
  | { type: 'job'; id: number; kind: string; args: Record<string, unknown> }
  | { type: 'sim'; cmd: 'start' | 'stop' | 'pause' | 'resume' | 'speed'; options?: SimOptions; speed?: number };

export type EngineResponse =
  | { type: 'ready' }
  | { type: 'physical'; rev: number; payload: PhysicalPayload; stats: { roads: number; junctions: number; roundabouts: number; markings: number; ms: number }; failed: { opId: string; type: string; messages: string[] }[] }
  | { type: 'job'; id: number; ok: boolean; result?: unknown; error?: string }
  | { type: 'simFrame'; frame: SimFrame }
  | { type: 'simStopped' }
  | { type: 'error'; message: string };
