/** Minimal GeoJSON types (structural, MapLibre-compatible). */
export type Position = readonly number[];
export interface Polygon { type: 'Polygon'; coordinates: readonly (readonly Position[])[] }
export interface LineString { type: 'LineString'; coordinates: readonly Position[] }
export interface Point { type: 'Point'; coordinates: Position }
export type Geometry = Polygon | LineString | Point;
export interface Feature<G extends Geometry = Geometry> { type: 'Feature'; id?: string | number; geometry: G; properties: Record<string, unknown> }
export interface FeatureCollection<G extends Geometry = Geometry> { type: 'FeatureCollection'; features: Feature<G>[] }

export const fc = <G extends Geometry>(features: Feature<G>[] = []): FeatureCollection<G> => ({ type: 'FeatureCollection', features });
