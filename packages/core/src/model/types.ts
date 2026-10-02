/**
 * Canonical DRIP Urban domain model.
 *
 * Only Baseline + Scenario operations are persisted. The effective network,
 * the physical model and every view are derived from them.
 *
 * Coordinate spaces are explicit:
 *  - LngLat: WGS84 degrees [lon, lat] — the only space stored on disk.
 *  - Local metres (east, north) relative to a project origin — see geo/projection.
 *  - Screen pixels — owned exclusively by the map adapters, never stored.
 */

export type LngLat = readonly [lon: number, lat: number];

export type ProvenanceKind =
  | 'existing'   // surveyed / official record of the current state
  | 'osm'        // OpenStreetMap contributors
  | 'measured'   // sensor or field measurement
  | 'derived'    // computed from other sourced values (e.g. width from lanes)
  | 'estimated'  // model estimate, explicitly not measured
  | 'project'    // authored by a designer in a scenario
  | 'simulated'  // output of a simulation run
  | 'live';      // real-time provider feed

export interface Provenance {
  readonly kind: ProvenanceKind;
  /** Human-readable source, e.g. "OpenStreetMap contributors (ODbL)". */
  readonly source: string;
  readonly acquiredAt?: string;
  readonly url?: string;
  readonly uncertaintyM?: number;
}

export type TravelMode = 'car' | 'truck' | 'bus' | 'bike' | 'walk' | 'emergency' | 'tram';

export type TurnKind = 'left' | 'through' | 'right' | 'uturn';

export type LaneDirection = 'forward' | 'backward' | 'reversible';

export interface Lane {
  readonly id: string;
  /** 0 = rightmost lane in the forward direction of the axis. */
  readonly index: number;
  readonly direction: LaneDirection;
  readonly widthM: number;
  readonly modes: readonly TravelMode[];
  readonly turns: readonly TurnKind[];
  readonly speedKmh?: number;
  readonly priority?: 'normal' | 'transit' | 'emergency';
  readonly restriction?: 'none' | 'bus_only' | 'bike_only' | 'closed';
}

export type CrossSectionElementKind =
  | 'sidewalk' | 'furniture' | 'parking' | 'cycle' | 'bus' | 'lane'
  | 'median' | 'green' | 'shoulder' | 'curb';

export interface CrossSectionElement {
  readonly id: string;
  readonly kind: CrossSectionElementKind;
  readonly widthM: number;
  /** For 'lane' elements: the lane id in Road.lanes. */
  readonly laneId?: string;
  readonly material?: string;
}

/** Ordered left → right looking along the axis direction. */
export interface CrossSection {
  readonly elements: readonly CrossSectionElement[];
}

export type Oneway = 'no' | 'forward' | 'backward';

export interface RoadNode {
  readonly id: string;
  readonly at: LngLat;
}

export interface Road {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly name: string;
  readonly roadClass: string;
  /** Axis polyline, ≥ 2 points, first = node `from`, last = node `to`. */
  readonly axis: readonly LngLat[];
  readonly oneway: Oneway;
  readonly speedKmh: number;
  readonly lanes: readonly Lane[];
  readonly section: CrossSection;
  readonly surface?: string;
  /** Provenance per attribute name; `geometry` and `width` are always present. */
  readonly provenance: Readonly<Record<string, Provenance>>;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface Building {
  readonly id: string;
  readonly footprint: readonly LngLat[];
  readonly heightM: number;
  readonly minHeightM: number;
  readonly name?: string;
  readonly provenance: Provenance;
}

export interface CityFeature {
  readonly id: string;
  readonly kind: string;
  readonly category?: string;
  readonly geometry: 'point' | 'line' | 'polygon';
  readonly coords: readonly LngLat[];
  readonly name?: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export type AssetState = 'existing' | 'project' | 'removed';

/** Anything placed in the city: sign pole, signal head, tree, bench, shelter… */
export interface Asset {
  readonly id: string;
  /** Catalogue id (packages/assets), e.g. "it.sign.II.36" or "furniture.bench.linear". */
  readonly type: string;
  readonly at: LngLat;
  readonly elevationM?: number;
  /** Degrees clockwise from north. */
  readonly rotationDeg: number;
  readonly state: AssetState;
  readonly material?: string;
  readonly attachedTo?: { readonly kind: 'road' | 'curb' | 'pole' | 'junction'; readonly id: string };
  readonly properties: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export interface CityBaseline {
  readonly id: string;
  readonly name: string;
  /** [west, south, east, north] */
  readonly bbox: readonly [number, number, number, number];
  readonly origin: LngLat;
  readonly nodes: Readonly<Record<string, RoadNode>>;
  readonly roads: Readonly<Record<string, Road>>;
  readonly buildings: Readonly<Record<string, Building>>;
  readonly features: Readonly<Record<string, CityFeature>>;
  readonly assets: Readonly<Record<string, Asset>>;
  readonly sources: readonly Provenance[];
}

/** One authored change. Scenarios are ordered lists of these. */
export interface Operation<P = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: P;
  readonly author: string;
  /** ISO timestamp. */
  readonly at: string;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Baseline scenario is the unmodified city: it never holds operations. */
  readonly isBaseline: boolean;
  readonly locked: boolean;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly operations: readonly Operation[];
}

export type ProjectKind =
  | 'municipality' | 'district' | 'neighbourhood' | 'corridor' | 'junction'
  | 'mobility_plan' | 'regeneration' | 'transit' | 'safety_study';

export type ProjectStatus = 'concept' | 'draft' | 'review' | 'final' | 'archived';

export interface ProjectMeta {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description?: string;
  readonly city: string;
  readonly kind: ProjectKind;
  readonly status: ProjectStatus;
  readonly author: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly bbox: readonly [number, number, number, number];
  readonly crs: 'EPSG:4326';
  readonly timezone: string;
  readonly baselineId: string;
  /** Incremented when the existing state is updated (e.g. imported sidewalks); 0/absent = as created. */
  readonly baselineRevision?: number;
  readonly scenarioIds: readonly string[];
  readonly activeScenarioId: string;
}

export type JunctionControl = 'uncontrolled' | 'priority' | 'stop' | 'signal' | 'roundabout';

/** Authored properties of a junction (a node with ≥ 3 road ends). Absent = defaults. */
export interface JunctionSpec {
  readonly nodeId: string;
  readonly control: JunctionControl;
  /** Kerb radius used for the corner fillets, metres. */
  readonly cornerRadiusM: number;
  /** Approaches (road ids) that must yield when control is 'priority' or 'stop'. */
  readonly minorRoadIds: readonly string[];
  /** Pedestrian crossings on these approaches (road ids). */
  readonly crossingRoadIds: readonly string[];
  /** Manual lane connection overrides: "fromLaneId>toLaneId" → allowed. */
  readonly laneConnections?: Readonly<Record<string, boolean>>;
}

export type RoundaboutType = 'mini' | 'compact' | 'standard' | 'elliptical' | 'turbo';

export interface RoundaboutArmSpec {
  readonly roadId: string;
  readonly entryRadiusM: number;
  readonly exitRadiusM: number;
  readonly splitter: boolean;
  readonly splitterLengthM: number;
  readonly splitterWidthM: number;
  readonly crossing: boolean;
}

export interface Roundabout {
  readonly id: string;
  readonly name: string;
  readonly type: RoundaboutType;
  readonly center: LngLat;
  /** Node ids of the original junction replaced by this roundabout. */
  readonly replacedNodeId?: string;
  readonly outerDiameterM: number;
  /** Elliptical only: minor/major ratio (0.5–1). */
  readonly aspect: number;
  readonly orientationDeg: number;
  readonly circulatoryWidthM: number;
  readonly lanes: 1 | 2;
  readonly apronWidthM: number;
  readonly islandMaterial: string;
  readonly control: 'yield' | 'signalized' | 'metered' | 'part_time';
  readonly speedKmh: number;
  readonly arms: readonly RoundaboutArmSpec[];
  /**
   * Set by the insertion (never authored): the network pieces the ring replaced, so removing or
   * reshaping the roundabout restores them exactly.
   */
  readonly replaced?: RoundaboutReplaced;
}

export interface RoundaboutReplaced {
  /** Original version of every road the ring cut or swallowed. */
  readonly roads: readonly Road[];
  /** Nodes that were inside the ring. */
  readonly nodes: readonly RoadNode[];
  readonly junctions: readonly JunctionSpec[];
  readonly signalPlans: readonly SignalPlan[];
  /** Roads created by the insertion (second half of a road crossing the whole ring). */
  readonly createdRoadIds: readonly string[];
}

export interface SignalPhase {
  readonly id: string;
  readonly name: string;
  /** Lane group ids that are green in this phase. */
  readonly greenGroups: readonly string[];
  readonly greenS: number;
  readonly yellowS: number;
  readonly allRedS: number;
  /** Pedestrian crossings (road ids) with walk signal in this phase. */
  readonly pedestrianRoadIds: readonly string[];
}

export interface SignalPlan {
  readonly id: string;
  readonly nodeId: string;
  readonly name: string;
  readonly mode: 'fixed_time' | 'actuated' | 'adaptive' | 'green_wave';
  readonly cycleS: number;
  readonly offsetS: number;
  readonly phases: readonly SignalPhase[];
  readonly actuation?: { readonly minGreenS: number; readonly maxGreenS: number; readonly gapOutS: number; readonly extensionS: number };
}

export type ZoneKind = 'ztl' | 'pedestrian' | 'school' | 'zone30' | 'low_emission' | 'parking' | 'work';

export interface Zone {
  readonly id: string;
  readonly kind: ZoneKind;
  readonly name: string;
  readonly polygon: readonly LngLat[];
  /** Vehicle classes allowed inside (ZTL / pedestrian). */
  readonly allowedModes: readonly TravelMode[];
  /** Weekly schedule; absent = always active. Hours are local (Europe/Rome). */
  readonly schedule?: readonly { readonly days: readonly number[]; readonly from: string; readonly to: string }[];
  readonly speedKmh?: number;
}

export type AreaKind =
  | 'plaza' | 'green' | 'tree_pit' | 'rain_garden' | 'bioswale' | 'permeable' | 'parking' | 'median_green'
  | 'crossing' | 'hatch' | 'playground' | 'building_footprint';

/** Authored surface: public space, green infrastructure, parking bay, painted crossing… */
export interface Area {
  readonly id: string;
  readonly kind: AreaKind;
  readonly name?: string;
  /** Closed ring (first point not repeated). For 'crossing': the two-point line across the road. */
  readonly polygon: readonly LngLat[];
  readonly material: string;
  readonly state: AssetState;
  /** crossing: depth of the stripes along traffic, metres. */
  readonly depthM?: number;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

/** The editable, derived state of one scenario: baseline + operations replayed. */
export interface Network {
  readonly nodes: Readonly<Record<string, RoadNode>>;
  readonly roads: Readonly<Record<string, Road>>;
  readonly assets: Readonly<Record<string, Asset>>;
  readonly junctions: Readonly<Record<string, JunctionSpec>>;
  readonly roundabouts: Readonly<Record<string, Roundabout>>;
  readonly signalPlans: Readonly<Record<string, SignalPlan>>;
  readonly zones: Readonly<Record<string, Zone>>;
  readonly areas: Readonly<Record<string, Area>>;
}
