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
  /** Preferential lane (corsia preferenziale, art. 7 CdS): also open to taxis and authorised vehicles. */
  readonly taxiAllowed?: boolean;
  /** When the restriction applies (e.g. bus lane 7:00–20:00); outside it the lane is general traffic. Absent = always. */
  readonly restrictionSchedule?: readonly TimeWindow[];
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
  /** For 'parking' elements: bay colour (white free, blue paid, yellow reserved, pink) and layout. */
  readonly parking?: { readonly color: 'white' | 'blue' | 'yellow' | 'pink'; readonly layout: 'parallel' | 'perpendicular' | 'angled' };
  /** For 'median' elements: raised (kerbed island) or painted (zebratura). */
  readonly raised?: boolean;
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

/** Weekly time window, local time. days: 0 = Monday … 6 = Sunday (as Zone.schedule and RoutingContext). */
export interface TimeWindow { readonly days: readonly number[]; readonly from: string; readonly to: string }

/**
 * Traffic restrictions on a road (art. 6–7 CdS): heavy-goods-vehicle bans, mass/size limits, closures.
 * Absent fields = no restriction. OSM tags (hgv, maxweight, maxheight, motor_vehicle…) are read when
 * the road has no authored restrictions.
 */
export interface RoadRestrictions {
  /** Heavy goods vehicles (> 3,5 t): no = ban, destination = only to reach a destination on the road, delivery = loading only. */
  readonly hgv?: 'no' | 'destination' | 'delivery';
  /** All motor vehicles (divieto di transito generale). */
  readonly motorVehicle?: 'no' | 'destination';
  readonly maxWeightT?: number;
  readonly maxAxleLoadT?: number;
  readonly maxHeightM?: number;
  readonly maxWidthM?: number;
  readonly maxLengthM?: number;
  /** Dangerous goods (ADR) banned. */
  readonly hazmat?: boolean;
  /** When the hgv / motorVehicle ban applies; absent = always. */
  readonly schedule?: readonly TimeWindow[];
  /** Free text: exceptions (residenti, carico/scarico 6–10, mezzi d'opera…). */
  readonly note?: string;
}

/** Functional road classes of the Direttive PGTU (G.U. 24/6/1995, § 3.1.2). */
export type FunctionalClass =
  | 'autostrada' | 'scorrimento_veloce' | 'interquartiere' | 'scorrimento' | 'quartiere' | 'interzonale' | 'locale';

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
  /** Authored restrictions (project); when absent, OSM tags apply. */
  readonly restrictions?: RoadRestrictions;
  /** Vertical alignment (profilo longitudinale); when absent the road follows the terrain. */
  readonly vertical?: VerticalProfile;
  /** Bridge / viaduct / tunnel. */
  readonly structure?: RoadStructure;
  /** Functional class in the traffic plan (PGTU, Direttive 12/4/1995); absent = not classified. */
  readonly functionalClass?: FunctionalClass;
  /** Provenance per attribute name; `geometry` and `width` are always present. */
  readonly provenance: Readonly<Record<string, Provenance>>;
  readonly tags?: Readonly<Record<string, string>>;
}

/** Vertical point of intersection: chainage from node `from` (m), elevation a.s.l. (m), parabolic curve length (m). */
export interface VerticalPVI {
  readonly station: number;
  readonly elevation: number;
  readonly curveLength?: number;
}

export interface VerticalProfile {
  /** ≥ 2 PVIs, strictly increasing stations, first at 0 and last at the road length. */
  readonly pvis: readonly VerticalPVI[];
}

/**
 * Digital terrain model on a regular lon/lat grid (project doc `terrain`):
 * z[j * nx + i], i west→east, j south→north, metres a.s.l.; NaN-free (missing cells interpolated).
 */
export interface TerrainGrid {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly nx: number;
  readonly ny: number;
  readonly z: readonly number[];
  readonly source: string;
  readonly resolutionM: number;
  readonly fetchedAt?: string;
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
  /** Large projects: full extent of the city when this baseline is a work area. */
  readonly fullBbox?: readonly [number, number, number, number];
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
  /** Whole city (large area): the workstation loads only `workArea` from the tiled baseline. */
  readonly large?: boolean;
  readonly workArea?: readonly [number, number, number, number];
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
  /**
   * Directional control (lanterne a frecce): for a green group, only these turns are green in this
   * phase. Absent for a group = every movement of the group is green.
   */
  readonly greenMovements?: Readonly<Record<string, readonly TurnKind[]>>;
}

/**
 * Coordination shared by several plans: a corridor (green wave, `SignalPlan.coordination`) or a plant
 * (several close junctions run as one controller, `SignalPlan.plant`).
 */
export interface SignalCoordination {
  readonly id: string;
  readonly name: string;
  /** Position of this junction along the corridor, 0 = reference (upstream). */
  readonly order: number;
  readonly speedKmh: number;
  readonly direction: 'oneway' | 'twoway';
  /** Absent = 'corridor'. */
  readonly mode?: 'corridor' | 'plant';
  /** Plant: the junctions are merged into one controller (impianto unico): same cycle, linked offsets. */
  readonly merged?: boolean;
  /** Corridor: this (minor) junction runs half the common cycle (doppio ciclo). */
  readonly halfCycle?: boolean;
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
  /** Left turns may proceed on green yielding to opposing traffic (svolta permessa, art. 41 CdS). */
  readonly permissiveLeft?: boolean;
  /** Heads not installed: lane group id, `ped:<roadId>` (both sides) or `ped:<roadId>:<0|1>`. */
  readonly disabledHeads?: readonly string[];
  readonly coordination?: SignalCoordination;
  /** Merged plant (impianto unico) this junction belongs to; mode 'plant'. */
  readonly plant?: SignalCoordination;
}

export type ZoneKind = 'ztl' | 'pedestrian' | 'school' | 'zone30' | 'low_emission' | 'parking' | 'work';

export interface Zone {
  readonly id: string;
  readonly kind: ZoneKind;
  readonly name: string;
  readonly polygon: readonly LngLat[];
  /** Vehicle classes allowed inside (ZTL / pedestrian). */
  readonly allowedModes: readonly TravelMode[];
  /** Weekly schedule; absent = always active. Hours are local (Europe/Rome), days 0 = Monday. */
  readonly schedule?: readonly TimeWindow[];
  readonly speedKmh?: number;
  /** Permit categories admitted while active (residenti, disabili, taxi, NCC, elettrici, car sharing…). */
  readonly permits?: readonly string[];
  /** Loading/unloading windows: goods vehicles admitted while the zone is active. */
  readonly deliveryWindows?: readonly TimeWindow[];
  /** Short text for the LED panels at the gates when active / not active. */
  readonly ledText?: { readonly on: string; readonly off: string };
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

/**
 * Traffic calming and raised elements placed along a road (DPR 495/1992 art. 179; DM 5/11/2001):
 * dossi, piattaforme rialzate, attraversamenti pedonali rialzati, cuscini berlinesi, bande rumorose.
 */
export type RoadFeatureKind = 'speed_hump' | 'speed_table' | 'raised_crossing' | 'speed_cushion' | 'rumble_strips' | 'raised_junction';

export interface RoadFeature {
  readonly id: string;
  readonly kind: RoadFeatureKind;
  /** Road it sits on (not for raised_junction, which uses nodeId). */
  readonly roadId?: string;
  readonly nodeId?: string;
  /** Chainage of the centre from the road start (m). */
  readonly station?: number;
  /** Plateau length along the road (m) and ramp length each side (m). */
  readonly lengthM: number;
  readonly rampM: number;
  readonly heightM: number;
  readonly state: AssetState;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

/** Custom horizontal marking (segnaletica orizzontale, artt. 137–155 Reg.). */
export type MarkingKind =
  | 'line_solid' | 'line_dashed' | 'line_double' | 'line_mixed' | 'line_yellow' | 'zigzag'
  | 'stop_line' | 'give_way_line' | 'give_way_triangle'
  | 'arrow' | 'text' | 'symbol' | 'hatch' | 'chevrons' | 'parking_bays' | 'box_junction'
  | 'zebra' | 'bike_crossing' | 'shark_teeth' | 'island' | 'bus_lane' | 'bike_lane' | 'speed_number';
/** Reserved bays (art. 149 Reg., art. 188 CdS, L. 120/2010 «stalli rosa», DL 76/2020 ricarica). */
export type BayPurpose = 'free' | 'paid' | 'disabled' | 'loading' | 'taxi' | 'pink' | 'electric' | 'residents' | 'motorcycle';
export type MarkingColor = 'white' | 'yellow' | 'blue' | 'red' | 'pink' | 'green';

export interface Marking {
  readonly id: string;
  readonly kind: MarkingKind;
  /** Line kinds: polyline; hatch/chevrons/box_junction/parking_bays: polygon or polyline (bays along it); text/symbol/arrow/triangle: [anchor, direction point]. */
  readonly geometry: readonly LngLat[];
  readonly color: MarkingColor;
  readonly widthM?: number;
  readonly text?: string;
  /** symbol: 'bike' | 'wheelchair' | 'bus' | 'pedestrian' | 'school' | 'speed30'; arrow: TurnKind list joined by '+'. */
  readonly symbol?: string;
  /** parking_bays: layout and bay size. */
  readonly bays?: { readonly layout: 'parallel' | 'perpendicular' | 'angled'; readonly lengthM: number; readonly widthM: number; readonly side: 'left' | 'right'; readonly purpose?: BayPurpose };
  readonly state: AssetState;
  readonly provenance: Provenance;
}

/** Bridge, viaduct, tunnel: the road runs above/below the ground (OSM bridge/tunnel/layer). */
export interface RoadStructure {
  readonly type: 'bridge' | 'viaduct' | 'tunnel' | 'covered';
  /** Deck height above ground at mid-span (m) for bridges/viaducts; depth for tunnels. */
  readonly heightM: number;
  /** Ordering with crossing roads (OSM layer). */
  readonly layer: number;
  readonly piersEveryM?: number;
}

export type DrainageNodeKind = 'inlet' | 'manhole' | 'outfall';

/** Node of the storm sewer network (rete di drenaggio): caditoia, pozzetto or scarico. */
export interface DrainageNode {
  readonly id: string;
  readonly kind: DrainageNodeKind;
  readonly at: LngLat;
  readonly name?: string;
  /** Rim / ground elevation (quota chiusino), m a.s.l. or relative datum when there is no DTM. */
  readonly rimElevation?: number;
  readonly rimSource?: 'dtm' | 'manual';
  /** Invert elevation (quota di scorrimento), m. */
  readonly invertElevation: number;
}

/** Circular pipe between two drainage nodes; slope from the node inverts, length from the positions. */
export interface DrainagePipe {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly diameterMm: number;
  /** Material label (PVC, PEAD, cls…). */
  readonly material: string;
  /** Gauckler–Strickler coefficient, m^(1/3)/s. */
  readonly ks: number;
  readonly name?: string;
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
  /** Traffic calming and raised elements (absent in older scenarios). */
  readonly features?: Readonly<Record<string, RoadFeature>>;
  /** Custom horizontal markings (absent in older scenarios). */
  readonly markings?: Readonly<Record<string, Marking>>;
  /** Baseline buildings removed in the scenario (e.g. replaced by an imported model). */
  readonly removedBuildings?: Readonly<Record<string, true>>;
  /** Storm sewer network; absent in networks from before 2.0 (treated as empty). */
  readonly drainageNodes?: Readonly<Record<string, DrainageNode>>;
  readonly drainagePipes?: Readonly<Record<string, DrainagePipe>>;
}
