import type { LngLat } from '@drip-urban/core';
import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import type { Mode } from '../state/store';
import type { NetworkIndex } from './snap';

export interface ToolEvent {
  readonly lngLat: LngLat;
  readonly point: { x: number; y: number };
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly button: number;
  readonly features: MapGeoJSONFeature[];
}

export interface ToolContext {
  readonly map: MLMap;
  readonly index: () => NetworkIndex | null;
}

export interface ToolHandler {
  activate?(ctx: ToolContext): void;
  deactivate?(ctx: ToolContext): void;
  click?(e: ToolEvent, ctx: ToolContext): void;
  dblclick?(e: ToolEvent, ctx: ToolContext): void;
  down?(e: ToolEvent, ctx: ToolContext): boolean | void;
  move?(e: ToolEvent, ctx: ToolContext): void;
  up?(e: ToolEvent, ctx: ToolContext): void;
  key?(e: KeyboardEvent, ctx: ToolContext): boolean | void;
  wheel?(e: WheelEvent, ctx: ToolContext): boolean | void;
}

export interface ToolDef {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly shortcut?: string;
  readonly group: 'draw' | 'civil' | 'street' | 'space' | 'analysis' | 'traffic' | 'transit';
  readonly modes: readonly Mode[];
  readonly hint: string;
  readonly cursor?: string;
  readonly handler: ToolHandler;
}
