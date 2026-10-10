import {PedestrianSimulation,type PedestrianSnapshot} from './pedestrians';
import {trafficKey,type TrafficState} from './traffic-state';
import {networkAtWorksDate} from './works';
import { SignalController } from './signal-controller';
import { accruePassengers, newTransitService, nextTransitDeparture, serveTransitStop, type TransitService, type TransitMetrics } from './transit';
import { LocalFrame } from '../geo/projection';
import { add, leftNormal, lengthOf, mul, pointInRing, project, sampleAt, type V } from '../geo/polyline';
import type { CityBaseline, LngLat, Network, ProjectClock, TransitLine, TurnKind, SignalPlan } from '../model/types';
import { armKey, buildJunction } from '../physical/junction';
import { layoutSection } from '../physical/section';
import { MetricCache, vehicularArms } from '../physical/topology';
import { buildGraph, dijkstra, type GraphEdge, type RoadGraph } from './graph';
import { activeSignalPlan, analyzeJunction, pedestrianState, signalState, type JunctionAnalysis } from './junction';
import { hourlyDemandShare } from './traffic';
import { clockErrors, projectLocalTime } from './clock';

export type VehicleClass = 'car' | 'van' | 'truck' | 'bus' | 'emergency' | 'tram' | 'train' | 'ferry';
export const VEHICLE_SPECS: Record<VehicleClass, { length: number; width: number; accel: number; decel: number; share: number; label: string }> = {
  car: { length: 4.5, width: 1.8, accel: 2.0, decel: 3.0, share: 0.82, label: 'Auto' },
  van: { length: 5.8, width: 2.0, accel: 1.6, decel: 2.8, share: 0.1, label: 'Furgone' },
  truck: { length: 10.0, width: 2.5, accel: 1.0, decel: 2.5, share: 0.04, label: 'Camion' },
  bus: { length: 12.0, width: 2.55, accel: 1.1, decel: 2.5, share: 0.03, label: 'Autobus 12 m' },
  tram: { length: 32, width: 2.4, accel: .8, decel: 1.5, share: 0, label: 'Tram' },
  train: { length: 60, width: 2.8, accel: .7, decel: 1.1, share: 0, label: 'Treno' },
  ferry: { length: 16, width: 5, accel: .3, decel: .5, share: 0, label: 'Battello' },
  emergency: { length: 6.0, width: 2.1, accel: 2.4, decel: 3.5, share: 0.01, label: 'Emergenza' },
};
const CLASSES: VehicleClass[] = ['car','van','truck','bus','emergency','tram','train','ferry'];
/** Floats per vehicle in SimFrame.data: lon, lat, heading°, class index, km/h, vehicle id. */
export const SIM_STRIDE = 6;

interface Vehicle {
  id: number;
  cls: VehicleClass;
  path: number[]; // graph edge ids
  k: number; // index in path
  s: number; // metres along current edge (travel direction) or along movement when inJunction
  v: number;
  lane: number;
  inJunction: { pts: V[]; length: number } | null;
  born: number;
  freeTime: number;
  rerouteMinute?: number;
  transit?: TransitTrip;
}

interface TransitTrip { service:TransitService; nextStop:number; aboard:number; dwellUntil:number; stops:{id:string;k:number;s:number}[]; endS:number; scheduledS:number; }
interface RailTrip {id:number;cls:VehicleClass;service:TransitService;axis:V[];s:number;v:number;born:number;nextStop:number;aboard:number;dwellUntil:number;stops:{id:string;s:number}[];}
interface TransitPath {path:number[];startS:number;endS:number;stops:TransitTrip['stops'];}
export interface SimMetrics {
  readonly transit?: readonly TransitMetrics[];
  readonly classes?: readonly {cls:VehicleClass;active:number;completed:number;avgDelayS:number}[];
  readonly t: number;
  readonly finished?: boolean;
  readonly vehicles: number;
  readonly avgSpeedKmh: number;
  readonly stopped: number;
  readonly completed: number;
  readonly throughputVph: number;
  readonly avgTravelS: number;
  readonly avgDelayS: number;
  /** All queued agents before the top-12 display truncation. */
  readonly queuedVehicles?: number;
  readonly queues: readonly { nodeId: string; roadId: string; vehicles: number }[];
  readonly microscopic?: number;
  readonly aggregated?: number;
  readonly waitingDemand?: number;
}

export interface SimFrame {
  readonly pedestrians?: PedestrianSnapshot;
  readonly tracked?: VehicleTelemetry | null;
  /** lon, lat, bearing°, class index, speed km/h, vehicle id — SIM_STRIDE floats per vehicle. */
  readonly data: Float32Array;
  readonly signals: readonly { at: LngLat; state: 'green' | 'yellow' | 'red'; bearing: number; planId?:string; groupId?:string; turns?:Partial<Record<TurnKind,'green'|'yellow'|'red'>> }[];
  readonly metrics: SimMetrics;
  readonly aggregates?: readonly { roadId: string; vehicles: number; speedKmh: number }[];
}
export interface VehicleTelemetry {
  readonly id: number;
  readonly cls: VehicleClass;
  readonly at: LngLat;
  readonly heading: number;
  readonly speedKmh: number;
  readonly roadId: string;
  readonly laneId: string | null;
  readonly destination: LngLat;
  readonly route: readonly LngLat[];
  readonly nextManoeuvre: string | null;
  readonly travelS: number;
  readonly delayS: number;
  readonly transit?: {lineId:string;lineName:string;aboard:number;capacity:number;nextStop:string|null;dwellRemainingS:number;};
  readonly nextSignal: 'green' | 'yellow' | 'red' | null;
}

/** Presentation budget only. Never changes demand, agents, routes or metrics. */
export interface SimView {
  readonly trackedId?: number;
  readonly budget: number;
  readonly bounds?: readonly [number, number, number, number];
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  readonly pedestrianDemandPerHour?: number;
  /** Frozen normalized initial traffic conditions; visual agents remain simulated. */
  readonly trafficState?: TrafficState;
  readonly clock?: ProjectClock;
  readonly mode?: 'microscopic' | 'hybrid';
  /** Explicit initial population, uniformly distributed on valid routes; useful for synthetic warm starts/stress. */
  readonly initialVehicles?: number;
  /** Detail zone of the hybrid solver, independent of spawn scope and rendering budget. */
  readonly microBounds?: readonly [number, number, number, number];
  readonly day: number;
  readonly hour: number;
  readonly dailyTrips: number;
  /** Fraction of the demand simulated (performance): 1 = full. */
  readonly scale: number;
  readonly seed: number;
  /** Restrict spawning to this bbox (focus area); vehicles still route on the whole network. */
  readonly focus?: readonly [number, number, number, number];
  readonly focusPolygon?: readonly LngLat[];
  readonly focusCorridor?: { readonly roadIds: readonly string[]; readonly widthM: number };
  readonly scopeName?: string;
}

export class FlowSimulation {
  readonly frame: LocalFrame;
  private readonly metric: MetricCache;
  private readonly g: RoadGraph;
  private readonly net: Network;
  private readonly rand: () => number;
  private pedestrians: PedestrianSimulation;
  private vehicles: Vehicle[] = [];
  private nextId = 1;
  private t = 0;
  private spawnAcc = 0;
  private completed: { cls:VehicleClass; travel: number; delay: number; at: number }[] = [];
  private completedCount = 0;
  private occupiedStarts = new Set<string>();
  private durationS = Infinity;
  private signalTime = 0;
  private currentDemand = 0;
  private calendarSecond = -1;
  private calendarMinute = -1;
  private temporalContext: {day:number;minutes:number;holiday:boolean;date?:string} = { day: 1, minutes: 480, holiday: false };
  private worksNet:Network|null=null;
  private temporalGraphs = new Map<VehicleClass, { graph: RoadGraph; stable: Map<number, number>; available: Map<number, GraphEdge> }>();
  private edgeIds = new Map<string, number>();
  private readonly entries: number[];
  private readonly exits: number[];
  private readonly treeCache = new Map<string, Int32Array>();
  private readonly setback = new Map<string, number>();
  private readonly junctions = new Map<string, JunctionAnalysis | null>();
  private readonly lengths = new Map<string, number>();
  private incoming = new Map<number, Vehicle[]>();
  private readonly plansByNode: Map<string, Network['signalPlans'][string]>;
  private readonly adjacency = new Map<string, Network['roads'][string][]>();
  private readonly edgeGeometry = new Map<number, { axis: readonly V[]; offsets: number[] }>();
  private readonly microRoads = new Set<string>();
  private hybridCounts = { microscopic: 0, aggregated: 0 };
  private controllers=new Map<string,SignalController>();
  private transfers:{at:number;lineId:string;stopId:string;people:number;walkS:number}[]=[];
  private services: TransitService[] = [];
  private transitPaths = new Map<string,TransitPath>();
  private railTrips: RailTrip[] = [];
  private localDayOffset = 0;
  private lastLocalSecond = 0;
  private aggregates: NonNullable<SimFrame['aggregates']> = [];

  constructor(net: Network, baseline: CityBaseline, private readonly opts: SimOptions) {
    const validBounds = (b: readonly number[] | undefined) => !b || (b.length === 4 && b.every(Number.isFinite) && b[0]! < b[2]! && b[1]! < b[3]!);
    if ((opts.mode && !['microscopic', 'hybrid'].includes(opts.mode)) || !validBounds(opts.focus) || !validBounds(opts.microBounds) || (opts.initialVehicles !== undefined && (!Number.isSafeInteger(opts.initialVehicles) || opts.initialVehicles < 0))) throw new Error('Modalità, ambito o popolazione non validi');
    if (opts.focusPolygon && (opts.focusPolygon.length < 3 || opts.focusPolygon.some((p) => p.length !== 2 || !p.every(Number.isFinite)))) throw new Error('Poligono di simulazione non valido');
    if (opts.focusCorridor && (!Number.isFinite(opts.focusCorridor.widthM) || opts.focusCorridor.widthM <= 0 || !opts.focusCorridor.roadIds.length || opts.focusCorridor.roadIds.some((id) => !net.roads[id]))) throw new Error('Corridoio di simulazione non valido');
    this.net = net;
    this.plansByNode = new Map(Object.values(net.signalPlans).map((p) => [p.nodeId, p]));
    for (const road of Object.values(net.roads)) for (const id of [road.from, road.to]) {
      const roads = this.adjacency.get(id) ?? [];
      roads.push(road); this.adjacency.set(id, roads);
    }
    this.frame = new LocalFrame(baseline.origin);
    this.metric = new MetricCache(this.frame);
    this.g = buildGraph(net, this.frame, { mode: 'emergency', day: opts.day, minutes: opts.hour * 60 }, true);
    for (const edge of this.g.edges) this.edgeIds.set(`${edge.roadId}:${edge.forward}`, edge.id);
    this.rand = mulberry32(opts.seed);
    this.pedestrians = new PedestrianSimulation(net, baseline.origin, opts.pedestrianDemandPerHour ?? 0, mulberry32(opts.seed ^ 0x504544));
    if (!Number.isInteger(opts.day) || opts.day < 0 || opts.day > 6 || !Number.isFinite(opts.hour) || opts.hour < 0 || opts.hour >= 24 || !Number.isFinite(opts.dailyTrips) || opts.dailyTrips < 0 || !Number.isFinite(opts.scale) || opts.scale < 0 || opts.scale > 1) throw new Error('Parametri della simulazione non validi');
    if (opts.clock && clockErrors(opts.clock).length) throw new Error(clockErrors(opts.clock).join('; '));
    this.durationS = opts.clock?.durationS ?? Infinity;
    this.updateCalendar();
    const corridors = opts.focusCorridor?.roadIds.map((id) => this.metric.axis(net.roads[id]!));
    const inFocus = (id: string) => {
      const p = net.nodes[id]?.at;
      const f = opts.focus;
      return !!p && (!f || (p[0] >= f[0] && p[0] <= f[2] && p[1] >= f[1] && p[1] <= f[3])) && (!opts.focusPolygon || pointInRing(p as V, opts.focusPolygon as readonly V[])) && (!corridors || corridors.some((axis) => project(axis, this.frame.toMetric(p) as V).d <= opts.focusCorridor!.widthM));
    };
    const nodes = [...this.g.nodeIds.keys()].filter((i) => this.g.out[i]!.length && inFocus(this.g.nodeIds[i]!));
    this.entries = nodes;
    this.exits = nodes;
    if ((opts.focus || opts.focusPolygon) && nodes.length < 2) throw new Error('L’ambito contiene meno di due nodi stradali utilizzabili. Amplia l’area.');
    for (const road of Object.values(net.roads)) this.lengths.set(road.id, lengthOf(this.metric.axis(road)));
    for (const e of this.g.edges) {
      const road = net.roads[e.roadId]!, layout = layoutSection(road);
      const lanes = road.lanes.filter((l) => e.forward ? l.direction !== 'backward' : l.direction !== 'forward');
      const axis = this.metric.axis(road);
      this.edgeGeometry.set(e.id, { axis: e.forward ? axis : [...axis].reverse(), offsets: lanes.map((lane) => {
        const el = layout.elements.find((x) => x.el.laneId === lane.id);
        return el ? (el.left + el.right) / 2 * (e.forward ? 1 : -1) : 0;
      }) });
    }
    this.lastLocalSecond = this.temporalContext.minutes*60;
    for(const line of net.transit ?? []){
      const service=newTransitService(line,this.temporalContext.day,this.lastLocalSecond,this.temporalContext.holiday);this.services.push(service);
      if(['bus','brt','trolleybus','tram','on_demand'].includes(line.mode)){
        const path=this.compileTransitPath(line);
        if(path)this.transitPaths.set(line.id,path);else service.issue='Percorso non connesso o oltre 50 m dalla rete stradale accessibile';
      }
    }
    this.setMicroFocus(opts.microBounds);
    if (opts.initialVehicles) this.seedPopulation(opts.initialVehicles);
  }

  get elapsedS(): number { return this.t; }
  get finished(): boolean { return this.t >= this.durationS; }
  setDuration(durationS: number): void {
    if (!Number.isFinite(durationS) || durationS <= 0) throw new Error('Durata non valida');
    this.durationS = durationS;
  }
  private updateCalendar(): void {
    // Calendar conversion is shared by all agents and cached per simulated second.
    if (Math.floor(this.t) === this.calendarSecond) return;
    this.calendarSecond = Math.floor(this.t);
    const at = this.opts.clock ? projectLocalTime(this.opts.clock, this.t) : { day: (this.opts.day + Math.floor((this.opts.hour * 3600 + this.t) / 86400)) % 7, hour: (this.opts.hour + this.t / 3600) % 24, holiday: false, seconds: (this.opts.hour * 3600 + this.t) % 86400 };
    this.signalTime = at.seconds;
    const minute = this.opts.clock ? Math.floor((Date.parse(this.opts.clock.anchor) + this.t * 1000) / 60000) : Math.floor((this.opts.hour * 3600 + this.t) / 60);
    if (minute !== this.calendarMinute) {
      this.calendarMinute = minute;
      this.temporalContext = { day: at.day, minutes: at.hour * 60, holiday: at.holiday,...('date' in at?{date:at.date as string}:{}) };
      this.worksNet=networkAtWorksDate(this.net,this.temporalContext.date);
      this.temporalGraphs.clear(); this.treeCache.clear();
    }
    this.currentDemand = this.opts.dailyTrips * this.opts.scale * hourlyDemandShare(at.day, at.hour, at.holiday) / 100 / 3600;
  }

  setMicroFocus(bounds?: readonly [number, number, number, number]): void {
    this.microRoads.clear();
    if (!bounds) return;
    // A 200 m buffer prevents boundary flicker and includes approaches to visible junctions.
    for (const road of Object.values(this.net.roads)) if (road.axis.some(([lon, lat], i) => {
      const previous = road.axis[Math.max(0, i - 1)]!;
      return Math.max(lon, previous[0]) >= bounds[0] - 0.0025 && Math.min(lon, previous[0]) <= bounds[2] + 0.0025 && Math.max(lat, previous[1]) >= bounds[1] - 0.0018 && Math.min(lat, previous[1]) <= bounds[3] + 0.0018;
    })) this.microRoads.add(road.id);
  }

  private seedPopulation(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Popolazione iniziale non valida');
    if (this.entries.length < 2 && count) throw new Error('Rete senza percorsi utilizzabili');
    // Reuse a deterministic bank of real routes: avoids a routing tree per stress agent.
    const routes: number[][] = [];
    for (let i = 0; i < 512; i++) {
      const o = this.entries[Math.floor(this.rand() * this.entries.length)]!;
      const d = this.exits[Math.floor(this.rand() * this.exits.length)]!;
      const path = this.routeFrom(o, d);
      if (path && path.length >= 2) routes.push(path);
    }
    if (!routes.length && count) throw new Error('Nessun percorso raggiungibile per la popolazione iniziale');
    for (let i = 0; i < count; i++) {
      const path = routes[Math.floor(this.rand() * routes.length)]!;
      const k = Math.floor(this.rand() * path.length), edge = this.g.edges[path[k]!]!;
      const start = this.roadSetback(edge.roadId, edge.forward) + 1;
      const end = this.edgeLen(edge) - this.roadSetback(edge.roadId, !edge.forward) - 1;
      this.vehicles.push({ id: this.nextId++, cls: 'car', path, k, s: start + this.rand() * Math.max(0, end - start), v: (this.opts.trafficState?.segments[trafficKey(edge.roadId,edge.forward)]?.speedKmh??edge.speedKmh*.6) / 3.6, lane: Math.floor(this.rand() * this.lanesOf(edge)), inJunction: null, born: 0, freeTime: path.slice(k).reduce((s, id) => s + (this.temporalGraph('car').available.get(id)?.costS ?? this.g.edges[id]!.costS), 0) });
    }
  }

  private roadSetback(roadId: string, atStart: boolean): number {
    const key = `${roadId}|${atStart ? 's' : 'e'}`;
    if (!this.setback.has(key)) {
      const road = this.net.roads[roadId]!;
      const nodeId = atStart ? road.from : road.to;
      const arms = vehicularArms(this.net, nodeId, this.metric);
      if (arms.length >= 3 && !road.tags?.roundabout) {
        const geo = buildJunction(nodeId, this.frame.toMetric(this.net.nodes[nodeId]!.at) as V, arms, this.net.junctions[nodeId]?.cornerRadiusM ?? 4);
        for (const a of arms) this.setback.set(armKey(a), geo?.setbacks.get(armKey(a)) ?? 0);
      }
      if (!this.setback.has(key)) this.setback.set(key, 0);
    }
    return this.setback.get(key)!;
  }

  private analysis(nodeId: string): JunctionAnalysis | null {
    if (!this.junctions.has(nodeId)) {
      const ends = this.adjacency.get(nodeId) ?? [];
      this.junctions.set(nodeId, ends.length >= 3 && !ends.some((r) => r.tags?.roundabout) ? analyzeJunction(this.net, this.frame.origin, nodeId) : null);
    }
    return this.junctions.get(nodeId)!;
  }

  private edgeLen(e: GraphEdge): number { return this.lengths.get(e.roadId)!; }
  private lanesOf(e: GraphEdge): number {
    return Math.max(1, this.net.roads[e.roadId]!.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward')).length);
  }

  private temporalGraph(cls: VehicleClass) {
    let cached = this.temporalGraphs.get(cls);
    if (!cached) {
      const graph = buildGraph(this.worksNet??this.net, this.frame, { ...this.temporalContext,trafficState:this.opts.trafficState, mode: cls === 'van' ? 'car' : ['tram','train','ferry'].includes(cls) ? 'bus' : cls as 'car'|'truck'|'bus'|'emergency' });
      const stable = new Map<number, number>(), available = new Map<number, GraphEdge>();
      for (const edge of graph.edges) {
        const id = this.edgeIds.get(`${edge.roadId}:${edge.forward}`);
        if (id !== undefined) { stable.set(edge.id, id); available.set(id, edge); }
      }
      cached = { graph, stable, available }; this.temporalGraphs.set(cls, cached);
    }
    return cached;
  }
  private routeFrom(o: number, d: number, cls: VehicleClass = 'car'): number[] | null {
    const { graph, stable } = this.temporalGraph(cls);
    const start = graph.index.get(this.g.nodeIds[o]!), destination = graph.index.get(this.g.nodeIds[d]!);
    if (start === undefined || destination === undefined) return null;
    const key = `${cls}:${start}`;
    let prev = this.treeCache.get(key);
    if (!prev) {
      prev = dijkstra(graph, [{ node: start, cost: 0 }]).prev;
      if (this.treeCache.size >= 128) this.treeCache.delete(this.treeCache.keys().next().value!);
      this.treeCache.set(key, prev);
    }
    const path: number[] = [];
    let n = destination;
    while (prev[n]! >= 0 && path.length < 2000) {
      const edge = graph.edges[prev[n]!]!, id = stable.get(edge.id);
      if (id === undefined) return null;
      path.push(id); n = edge.from;
    }
    return n === start && path.length ? path.reverse() : null;
  }

  private signalAspect(plan:SignalPlan,groupId:string,turn?:TurnKind):'green'|'yellow'|'red'{
    const controller=this.controllers.get(plan.id);
    if(controller)return controller.aspect(groupId,turn);
    return groupId.startsWith('ped:')?pedestrianState(plan,groupId.slice(4),this.signalTime,this.temporalContext):signalState(plan,groupId,this.signalTime,turn,this.temporalContext);
  }
  private updateControllers(dt:number){
    for(const authored of Object.values(this.net.signalPlans)){
      const plan=activeSignalPlan(authored,this.temporalContext);if(plan.mode!=='actuated'&&plan.mode!=='adaptive'){this.controllers.delete(plan.id);continue;}
      const a=this.analysis(plan.nodeId),demand=new Map<string,number>();
      for(const vehicle of this.incoming.get(this.g.index.get(plan.nodeId)!)??[]){
        const e=this.g.edges[vehicle.path[vehicle.k]!]!;if(this.edgeLen(e)-vehicle.s>100)continue;
        const road=this.net.roads[e.roadId]!,lanes=road.lanes.filter(l=>e.forward?l.direction!=='backward':l.direction!=='forward'),lane=lanes[Math.min(vehicle.lane,lanes.length-1)];
        const group=a?.groups.find(g=>lane&&g.laneIds.includes(lane.id));if(group)demand.set(group.id,(demand.get(group.id)??0)+1+(vehicle.transit&&['tpl','balanced'].includes(plan.priority??'balanced')?2:0)+(vehicle.cls==='emergency'&&['emergency','balanced'].includes(plan.priority??'balanced')?5:0));
      }
      let controller=this.controllers.get(plan.id);if(!controller){controller=new SignalController(plan);this.controllers.set(plan.id,controller);}controller.update(plan,dt,demand);
    }
  }
  private compileTransitPath(line:TransitLine):TransitPath|null {
    const axis=line.line.map(q=>this.frame.toMetric(q) as V),length=lengthOf(axis),edges=[...this.temporalGraph('bus').available.keys()].map(id=>this.g.edges[id]!);
    const matched:number[]=[];let startS=0,endS=0;
    for(let d=0;d<=length+.01;d=Math.min(length,d+60)){
      const sample=sampleAt(axis,d);let best:GraphEdge|undefined,bestS=0,score=Infinity;
      for(const e of edges){const pts=this.edgeGeometry.get(e.id)!.axis,pr=project(pts,sample.p);const tangent=sampleAt(pts,pr.along).t,dot=tangent[0]*sample.t[0]+tangent[1]*sample.t[1];const v=pr.d+(1-dot)*30;if(pr.d<=50 && v<score){best=e;bestS=pr.along;score=v;}}
      if(!best)return null;
      if(!matched.length)startS=bestS;
      if(matched.at(-1)!==best.id){
        const previous=matched.length?this.g.edges[matched.at(-1)!]:undefined;
        if(previous && previous.to!==best.from){const bridge=this.routeFrom(previous.to,best.from,'bus');if(!bridge)return null;matched.push(...bridge);}
        matched.push(best.id);
      }
      endS=bestS;if(d===length)break;
    }
    const stops:TransitTrip['stops']=[];let minimumK=0;
    for(const st of line.stops){let best={k:minimumK,s:0,d:Infinity};const point=this.frame.toMetric(st.at) as V;
      for(let k=minimumK;k<matched.length;k++){const pr=project(this.edgeGeometry.get(matched[k]!)!.axis,point);if(pr.d<best.d)best={k,s:pr.along,d:pr.d};}
      if(best.d>50)return null;
      minimumK=best.k;stops.push({id:st.id,k:best.k,s:Math.max(best.k===0?startS:0,Math.min(best.s,best.k===matched.length-1?endS:this.edgeLen(this.g.edges[matched[best.k]!]!)-this.roadSetback(this.g.edges[matched[best.k]!]!.roadId,!this.g.edges[matched[best.k]!]!.forward)-2))});
    }
    return {path:matched,startS,endS,stops};
  }
  private boardStop(service:TransitService,stopId:string,aboard:number):number{
    return serveTransitStop(service,stopId,aboard,people=>{
      const transfer=service.line.stops.find(st=>st.id===stopId)?.transferTo;if(!transfer)return;
      const count=Math.floor(people*transfer.fraction);if(count)this.transfers.push({at:this.t+transfer.walkS,lineId:transfer.lineId,stopId:transfer.stopId,people:count,walkS:transfer.walkS});
    });
  }
  private advanceTransit(dt:number){
    this.transfers=this.transfers.filter(event=>{if(event.at>this.t)return true;const queue=this.services.find(s=>s.line.id===event.lineId)?.queues.get(event.stopId);if(queue){queue.people+=event.people;queue.personSeconds+=event.people*event.walkS;}return false;});
    const local=this.temporalContext.minutes*60;
    if(local<this.lastLocalSecond-43200)this.localDayOffset+=86400;
    this.lastLocalSecond=local;const localS=local+this.localDayOffset;
    for(const service of this.services){
      accruePassengers(service,dt);
      while(localS+1e-6>=service.countedNextLocalS){
        service.scheduled++;
        const previous=service.countedNextLocalS,due=previous-this.localDayOffset;
        service.countedNextLocalS=nextTransitDeparture(service.line,this.temporalContext.day,due+.01,this.temporalContext.holiday)+this.localDayOffset;
        if(service.countedNextLocalS<=previous)throw Error('Calendario partenze TPL non crescente');
      }
      if(service.issue)continue;
      // The pending slot remains due when congestion prevents entry; demand is never discarded.
      if(localS+1e-6<service.nextLocalS)continue;
      const line=service.line,path=this.transitPaths.get(line.id),scheduledS=this.t-(localS-service.nextLocalS);
      if(path){
        const edge=this.g.edges[path.path[0]!]!;
        if(!this.temporalGraph('bus').available.has(edge.id)||this.occupiedStarts.has(`${edge.id}:0`))continue;
        const vehicle:Vehicle={id:this.nextId++,cls:line.mode==='tram'?'tram':'bus',path:[...path.path],k:0,s:path.startS,v:0,lane:0,inJunction:null,born:this.t,freeTime:path.path.reduce((v,id)=>v+this.g.edges[id]!.costS,0),transit:{service,nextStop:0,aboard:0,dwellUntil:0,stops:path.stops,endS:path.endS,scheduledS}};
        this.vehicles.push(vehicle);this.occupiedStarts.add(`${edge.id}:0`);
      }else{
        const axis=line.line.map(p=>this.frame.toMetric(p) as V);
        this.railTrips.push({id:this.nextId++,cls:line.mode==='ferry'?'ferry':'train',service,axis,s:0,v:0,born:this.t,nextStop:0,aboard:0,dwellUntil:0,stops:line.stops.map(st=>({id:st.id,s:project(axis,this.frame.toMetric(st.at) as V).along})).sort((a,b)=>a.s-b.s)});
      }
      service.departed++;service.delayS+=Math.max(0,this.t-scheduledS);
      const due=service.nextLocalS-this.localDayOffset;
      const next=nextTransitDeparture(line,this.temporalContext.day,due+.01,this.temporalContext.holiday);
      service.nextLocalS=next+this.localDayOffset;
    }
    for(const trip of this.railTrips){
      if(this.t<trip.dwellUntil){trip.v=0;continue;}
      const spec=VEHICLE_SPECS[trip.cls],stop=trip.stops[trip.nextStop],remaining=stop?Math.max(0,stop.s-trip.s):Infinity;
      trip.v=Math.min(trip.v+spec.accel*dt,trip.service.line.speedKmh/3.6,Math.sqrt(2*spec.decel*remaining));trip.s+=trip.v*dt;
      if(stop && remaining<.5){trip.s=stop.s;trip.v=0;trip.aboard=this.boardStop(trip.service,stop.id,trip.aboard);trip.nextStop++;trip.dwellUntil=this.t+(trip.service.line.dwellS??25);}
    }
    this.railTrips=this.railTrips.filter(trip=>{if(trip.s<lengthOf(trip.axis)-.1 || trip.nextStop<trip.stops.length || this.t<trip.dwellUntil)return true;this.completedCount++;trip.service.completed++;trip.service.travelS+=this.t-trip.born;return false;});
  }

  private spawn(): boolean {
    for (let tries = 0; tries < 6; tries++) {
      const o = this.entries[Math.floor(this.rand() * this.entries.length)]!;
      const d = this.exits[Math.floor(this.rand() * this.exits.length)]!;
      if (o === d) continue;
      let r = this.rand(), cls: VehicleClass = 'car';
      for (const c of CLASSES) { r -= VEHICLE_SPECS[c].share; if (r <= 0) { cls = c; break; } }
      const path = this.routeFrom(o, d, cls);
      if (!path || path.length < 2) continue;
      const first = this.g.edges[path[0]!]!;
      const lane = Math.floor(this.rand() * this.lanesOf(first));
      const startS = this.roadSetback(first.roadId, first.forward) + 1;
      // Do not spawn into an occupied lane start.
      const startKey = `${first.id}:${lane}`;
      if (this.occupiedStarts.has(startKey)) continue;
      const free = path.reduce((s, id) => s + (this.temporalGraph(cls).available.get(id)?.costS ?? this.g.edges[id]!.costS), 0);
      this.vehicles.push({ id: this.nextId++, cls, path, k: 0, s: startS, v: Math.min(8, first.speedKmh / 3.6), lane, inJunction: null, born: this.t, freeTime: free });
      this.occupiedStarts.add(startKey);
      return true;
    }
    return false;
  }

  /** Stop requirement at the end of the current edge: distance to stop line or Infinity. */
  private stopAhead(veh: Vehicle, e: GraphEdge, L: number): number {
    let next = veh.path[veh.k + 1];
    if (next !== undefined && !this.temporalGraph(veh.cls).available.has(next)) {
      if (veh.rerouteMinute !== this.calendarMinute) {
        veh.rerouteMinute = this.calendarMinute;
        const destination = this.g.edges[veh.path.at(-1)!]!.to;
        const replacement = this.routeFrom(e.to, destination, veh.cls);
        if (replacement) { veh.path = [...veh.path.slice(0, veh.k + 1), ...replacement]; next = veh.path[veh.k + 1]; }
      }
      if (next !== undefined && !this.temporalGraph(veh.cls).available.has(next)) return L - this.roadSetback(e.roadId, !e.forward) - 1;
    }
    if (next === undefined) return Infinity;
    const nodeId = this.g.nodeIds[e.to]!;
    const stopS = L - this.roadSetback(e.roadId, !e.forward) - 1;
    if (this.pedestrians.crossingOccupied(e.roadId, nodeId)) return stopS;
    const plan = this.plansByNode.get(nodeId);
    // Approach left out of the signal plan: free flow, or yield/STOP to the signalised approaches.
    const own = plan?.unsignalized?.[e.roadId];
    if (own === 'free') return Infinity;
    if (own) {
      const busy = (this.incoming.get(e.to) ?? []).some((o) => {
        if (o === veh || o.inJunction) return false;
        const oe = this.g.edges[o.path[o.k]!]!;
        if (oe.roadId === e.roadId || oe.to !== e.to || plan!.unsignalized?.[oe.roadId]) return false;
        return this.edgeLen(oe) - o.s < 25 && o.v > 0.5;
      });
      return busy || (own === 'stop' && veh.v > 0.3) ? stopS : Infinity;
    }
    if (plan) {
      const a = this.analysis(nodeId);
      const road = this.net.roads[e.roadId]!;
      const lanes = road.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward'));
      const laneId = lanes[Math.min(veh.lane, lanes.length - 1)]?.id;
      const group = a?.groups.find((gr) => laneId && gr.laneIds.includes(laneId))?.id;
      if (group) {
        const nextRoad = this.g.edges[next]!.roadId;
        const turn = a?.movements.find((m) => m.fromLaneId === laneId && m.toRoadId === nextRoad)?.turn;
        const st = this.signalAspect(plan, group, turn);
        const dist = stopS - veh.s;
        const canStop = veh.v * veh.v / (2 * VEHICLE_SPECS[veh.cls].decel) < dist;
        if (st === 'red' || (st === 'yellow' && canStop)) return stopS;
      }
      return Infinity;
    }
    // Yield: roundabout entries and minor approaches look for conflicting vehicles near the node.
    const nextEdge = this.g.edges[next]!;
    const entering = this.net.roads[nextEdge.roadId]?.tags?.roundabout && !this.net.roads[e.roadId]?.tags?.roundabout;
    const spec = this.net.junctions[nodeId];
    const minor = spec && (spec.control === 'priority' || spec.control === 'stop') && spec.minorRoadIds.includes(e.roadId);
    if (entering || minor) {
      const busy = (this.incoming.get(e.to) ?? []).some((o) => {
        if (o === veh || o.inJunction) return false;
        const oe = this.g.edges[o.path[o.k]!]!;
        if (oe.roadId === e.roadId) return false;
        const conflictRoad = entering ? this.net.roads[oe.roadId]?.tags?.roundabout : !spec!.minorRoadIds.includes(oe.roadId);
        if (!conflictRoad || oe.to !== e.to) return false;
        const oL = this.edgeLen(oe);
        return oL - o.s < 18 && o.v > 0.5;
      });
      if (busy || (spec?.control === 'stop' && veh.v > 0.3)) return stopS;
    }
    return Infinity;
  }

  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Passo di simulazione non valido');
    dt = Math.min(dt, this.durationS - this.t);
    if (dt <= 0) return;
    this.updateCalendar();
    this.occupiedStarts.clear();
    for (const v of this.vehicles) {
      if (v.inJunction) continue;
      const edge = this.g.edges[v.path[v.k]!]!;
      if (v.s < this.roadSetback(edge.roadId, edge.forward) + 13) this.occupiedStarts.add(`${edge.id}:${v.lane}`);
    }
    this.advanceTransit(dt);
    this.spawnAcc += this.currentDemand * dt;
    while (this.spawnAcc >= 1) { if (!this.spawn()) break; this.spawnAcc -= 1; }
    // Leaders per edge-lane.
    const byLane = new Map<string, Vehicle[]>();
    this.incoming = new Map();
    for (const v of this.vehicles) {
      if (v.inJunction) continue;
      const key = `${v.path[v.k]}:${v.lane}`;
      (byLane.get(key) ?? byLane.set(key, []).get(key)!).push(v);
      const to = this.g.edges[v.path[v.k]!]!.to;
      const incoming = this.incoming.get(to) ?? [];
      incoming.push(v); this.incoming.set(to, incoming);
    }
    this.updateControllers(dt);
    this.pedestrians.step(dt, this.temporalContext, (planId, roadId) => this.signalAspect(this.net.signalPlans[planId]!, `ped:${roadId}`) === 'green');
    const leaders = new Map<Vehicle, Vehicle>();
    const macroSpeed = new Map<string, number>();
    for (const list of byLane.values()) {
      list.sort((a, b) => b.s - a.s);
      for (let i = 1; i < list.length; i++) leaders.set(list[i]!, list[i - 1]!);
      if (this.opts.mode === 'hybrid') {
        const edge = this.g.edges[list[0]!.path[list[0]!.k]!]!;
        const occupied = list.reduce((s, v) => s + VEHICLE_SPECS[v.cls].length + 2, 0);
        const density = Math.min(1, occupied / Math.max(1, this.edgeLen(edge)));
        macroSpeed.set(`${edge.id}:${list[0]!.lane}`, edge.speedKmh / 3.6 * Math.max(0, 1 - density));
      }
    }
    this.hybridCounts = { microscopic: 0, aggregated: 0 };
    const aggregateRoads = new Map<string, { roadId: string; vehicles: number; speedKmh: number }>();
    const done: Vehicle[] = [];
    for (const veh of this.vehicles) {
      const spec = VEHICLE_SPECS[veh.cls];
      const service=veh.transit;
      if(service && this.t<service.dwellUntil){veh.v=0;this.hybridCounts.microscopic++;continue;}
      const serviceStop=service?.stops[service.nextStop];
      if(service && !veh.inJunction && serviceStop && serviceStop.k===veh.k && veh.s>=serviceStop.s-.5){
        veh.s=Math.max(veh.s,serviceStop.s);veh.v=0;service.aboard=this.boardStop(service.service,serviceStop.id,service.aboard);service.nextStop++;service.dwellUntil=this.t+(service.service.line.dwellS??25);this.hybridCounts.microscopic++;continue;
      }
      if (veh.inJunction) {
        this.hybridCounts.microscopic++;
        veh.v = Math.min(veh.v + spec.accel * dt, 8);
        veh.s += veh.v * dt;
        if (veh.s >= veh.inJunction.length) {
          veh.k++;
          const e = this.g.edges[veh.path[veh.k]!]!;
          veh.s = this.roadSetback(e.roadId, e.forward) + (veh.s - veh.inJunction.length);
          veh.lane = Math.min(veh.lane, this.lanesOf(e) - 1);
          veh.inJunction = null;
        }
        continue;
      }
      const e = this.g.edges[veh.path[veh.k]!]!;
      const L = this.edgeLen(e);
      let v0 = (this.temporalGraph(veh.cls).available.get(e.id)?.speedKmh ?? Math.min(e.speedKmh, 30)) / 3.6;
      if(service){v0=Math.min(v0,service.service.line.speedKmh/3.6);if(serviceStop?.k===veh.k)v0=Math.min(v0,Math.sqrt(2*spec.decel*Math.max(0,serviceStop.s-veh.s)));}
      const micro = !!service || this.opts.mode !== 'hybrid' || this.microRoads.has(e.roadId) || L - veh.s < Math.max(50, veh.v * 5);
      if (micro) this.hybridCounts.microscopic++; else this.hybridCounts.aggregated++;
      let gap = Infinity, dv = 0;
      const lead = leaders.get(veh);
      if (lead) { gap = lead.s - veh.s - VEHICLE_SPECS[lead.cls].length; dv = veh.v - lead.v; }
      const stop = micro ? this.stopAhead(veh, e, L) : Infinity;
      if (stop - veh.s < gap) { gap = Math.max(0.1, stop - veh.s); dv = veh.v; }
      const s0 = 2, T = 1.3;
      const sStar = s0 + Math.max(0, veh.v * T + (veh.v * dv) / (2 * Math.sqrt(spec.accel * spec.decel)));
      const acc = spec.accel * (1 - (veh.v / Math.max(1, v0)) ** 4 - (Number.isFinite(gap) ? (sStar / Math.max(0.1, gap)) ** 2 : 0));
      veh.v = micro ? Math.max(0, veh.v + Math.max(-9, acc) * dt) : Math.max(0, Math.min(macroSpeed.get(`${e.id}:${veh.lane}`) ?? v0, Number.isFinite(gap) ? Math.max(0, gap - 2) / dt : v0));
      veh.s += veh.v * dt;
      if (!micro) {
        const aggregate = aggregateRoads.get(e.roadId) ?? { roadId: e.roadId, vehicles: 0, speedKmh: 0 };
        aggregate.vehicles++; aggregate.speedKmh += veh.v * 3.6;
        aggregateRoads.set(e.roadId, aggregate);
      }
      const endS = service && veh.k===veh.path.length-1 ? service.endS : L - this.roadSetback(e.roadId, !e.forward);
      if (veh.s >= endS) {
        if (veh.k >= veh.path.length - 1) { done.push(veh); continue; }
        const next = this.g.edges[veh.path[veh.k + 1]!]!;
        const nodeId = this.g.nodeIds[e.to]!;
        const a = this.analysis(nodeId);
        const road = this.net.roads[e.roadId]!;
        const lanes = road.lanes.filter((l) => (e.forward ? l.direction !== 'backward' : l.direction !== 'forward'));
        const laneId = lanes[Math.min(veh.lane, lanes.length - 1)]?.id;
        const mv = a?.movements.find((m) => m.fromLaneId === laneId && m.toRoadId === next.roadId) ?? a?.movements.find((m) => m.fromRoadId === e.roadId && m.toRoadId === next.roadId);
        if (mv) {
          const pts = mv.path.map((q) => this.frame.toMetric(q) as V);
          veh.inJunction = { pts, length: lengthOf(pts) };
          veh.s = veh.s - endS;
        } else {
          veh.k++;
          veh.s = this.roadSetback(next.roadId, next.forward) + (veh.s - endS);
          veh.lane = Math.min(veh.lane, this.lanesOf(next) - 1);
        }
      }
    }
    if (done.length) {
      const set = new Set(done);
      this.hybridCounts.microscopic -= done.length;
      this.completedCount += done.length;
      for(const v of done)if(v.transit){v.transit.service.completed++;v.transit.service.travelS+=this.t-v.born;}
      for (const v of done) this.completed.push({ cls:v.cls, travel: this.t - v.born, delay: Math.max(0, this.t - v.born - v.freeTime), at: this.t });
      this.vehicles = this.vehicles.filter((v) => !set.has(v));
    }
    // Gridlocked agents remain in the network. Never silently delete traffic to make a run cheaper.
    this.completed = this.completed.filter((c) => this.t - c.at < 900);
    this.aggregates = [...aggregateRoads.values()].map((a) => ({ ...a, speedKmh: a.speedKmh / a.vehicles }));
    this.t += dt;
    this.updateCalendar();
  }

  frameData(view?: SimView): SimFrame {
    const trackedVehicle = view?.trackedId === undefined ? undefined : this.vehicles.find((v) => v.id === view.trackedId);
    let tracked: VehicleTelemetry | null = null;
    if (trackedVehicle) {
      const v = trackedVehicle, edge = this.g.edges[v.path[v.k]!]!, road = this.net.roads[edge.roadId]!;
      const sample = v.inJunction ? sampleAt(v.inJunction.pts, v.s) : sampleAt(this.edgeGeometry.get(edge.id)!.axis, v.s);
      const lanes = road.lanes.filter((lane) => edge.forward ? lane.direction !== 'backward' : lane.direction !== 'forward');
      const laneId = lanes[Math.min(v.lane, lanes.length - 1)]?.id ?? null, next = this.g.edges[v.path[v.k + 1]!];
      const nodeId = this.g.nodeIds[edge.to]!, analysis = this.analysis(nodeId), plan = this.plansByNode.get(nodeId);
      const group = analysis?.groups.find((g) => laneId && g.laneIds.includes(laneId));
      const movement = next && analysis?.movements.find((m) => m.fromLaneId === laneId && m.toRoadId === next.roadId);
      const expected = v.path.slice(0, v.k).reduce((s, id) => s + (this.temporalGraph(v.cls).available.get(id)?.costS ?? this.g.edges[id]!.costS), 0) + Math.min(edge.lengthM, v.s) / Math.max(1, edge.speedKmh / 3.6);
      const offset = v.inJunction ? 0 : this.edgeGeometry.get(edge.id)!.offsets[Math.min(v.lane, lanes.length - 1)] ?? 0;
      const position = add(sample.p, mul(leftNormal(sample.t), offset));
      const route = v.path.slice(v.k).flatMap((id) => { const e = this.g.edges[id]!, axis = this.net.roads[e.roadId]!.axis; return e.forward ? [...axis] : [...axis].reverse(); });
      tracked = { id: v.id, cls: v.cls, at: this.frame.toLngLat(position), heading: (Math.atan2(sample.t[0], sample.t[1]) * 180 / Math.PI + 360) % 360,
        speedKmh: v.v * 3.6, roadId: road.id, laneId, destination: this.net.nodes[this.g.nodeIds[this.g.edges[v.path.at(-1)!]!.to]!]!.at,
        route, nextManoeuvre: movement?.turn ?? null, travelS: this.t - v.born, delayS: Math.max(0, this.t - v.born - expected),
        ...(v.transit ? {transit:{lineId:v.transit.service.line.id,lineName:v.transit.service.line.name,aboard:v.transit.aboard,capacity:v.transit.service.line.capacity,nextStop:v.transit.service.line.stops.find(st=>st.id===v.transit!.stops[v.transit!.nextStop]?.id)?.name??null,dwellRemainingS:Math.max(0,v.transit.dwellUntil-this.t)}}:{}),
        nextSignal: plan && group ? this.signalAspect(plan, group.id, movement?.turn) : null };
    }
    const budget = view ? Math.max(0, Math.floor(view.budget)) : this.vehicles.length+this.railTrips.length;
    const data = new Float32Array(Math.min(this.vehicles.length+this.railTrips.length, budget) * SIM_STRIDE);
    let count = 0;
    const trackedRail=this.railTrips.find(trip=>trip.id===view?.trackedId);
    for(const trip of [...(trackedRail?[trackedRail]:[]),...this.railTrips.filter(trip=>trip!==trackedRail)]){
      const sample=sampleAt(trip.axis,trip.s),at=this.frame.toLngLat(sample.p),heading=Math.atan2(sample.t[0],sample.t[1])*180/Math.PI;
      if(trip===trackedRail)tracked={id:trip.id,cls:trip.cls,at,heading,speedKmh:trip.v*3.6,roadId:trip.service.line.name,laneId:null,destination:trip.service.line.line.at(-1)!,route:trip.service.line.line,nextManoeuvre:null,travelS:this.t-trip.born,delayS:Math.max(0,this.t-trip.born-trip.s/(trip.service.line.speedKmh/3.6)),nextSignal:null,transit:{lineId:trip.service.line.id,lineName:trip.service.line.name,aboard:trip.aboard,capacity:trip.service.line.capacity,nextStop:trip.service.line.stops.find(st=>st.id===trip.stops[trip.nextStop]?.id)?.name??null,dwellRemainingS:Math.max(0,trip.dwellUntil-this.t)}};
      const b=view?.bounds;if(trip!==trackedRail&&b&&(at[0]<b[0]||at[0]>b[2]||at[1]<b[1]||at[1]>b[3]))continue;
      if(count>=budget)break;const o=count++*SIM_STRIDE;data.set([at[0],at[1],heading,CLASSES.indexOf(trip.cls),trip.v*3.6,trip.id],o);
    }
    for (let index = -1; index < this.vehicles.length; index++) {
      const veh = index < 0 ? trackedVehicle : this.vehicles[index];
      if (!veh || (index >= 0 && veh === trackedVehicle)) continue;
      if (count >= budget) break;
      let p: V, t: V;
      if (veh.inJunction) {
        const s = sampleAt(veh.inJunction.pts, veh.s);
        p = s.p; t = s.t;
      } else {
        const e = this.g.edges[veh.path[veh.k]!]!;
        const geo = this.edgeGeometry.get(e.id)!;
        const s = sampleAt(geo.axis, veh.s);
        const off = geo.offsets[Math.min(veh.lane, geo.offsets.length - 1)] ?? 0;
        p = add(s.p, mul(leftNormal(s.t), off));
        t = s.t;
      }
      const ll = this.frame.toLngLat(p);
      const b = view?.bounds;
      if (veh !== trackedVehicle && b && (ll[0] < b[0] || ll[0] > b[2] || ll[1] < b[1] || ll[1] > b[3])) continue;
      const o = count++ * SIM_STRIDE;
      data[o] = ll[0]; data[o + 1] = ll[1];
      data[o + 2] = (Math.atan2(t[0], t[1]) * 180) / Math.PI;
      data[o + 3] = CLASSES.indexOf(veh.cls);
      data[o + 4] = veh.v * 3.6;
      data[o + 5] = veh.id;
    }
    const signals: SimFrame['signals'][number][] = [];
    for (const plan of Object.values(this.net.signalPlans)) {
      const a = this.analysis(plan.nodeId);
      for (const g of a?.groups ?? []) signals.push({ at: g.stopAt, state: this.signalAspect(plan,g.id), bearing: g.bearingDeg,planId:plan.id,groupId:g.id,turns:Object.fromEntries(g.turns.map(turn=>[turn,this.signalAspect(plan,g.id,turn)])) });
      for(const roadId of new Set(activeSignalPlan(plan,this.temporalContext).phases.flatMap(ph=>ph.pedestrianRoadIds)))signals.push({at:this.net.nodes[plan.nodeId]!.at,state:this.signalAspect(plan,`ped:${roadId}`),bearing:0,planId:plan.id,groupId:`ped:${roadId}`});
    }
    const recent = this.completed.filter((c) => this.t - c.at < 900);
    const queues = new Map<string, { nodeId: string; roadId: string; vehicles: number }>();
    for (const v of this.vehicles) {
      if (v.inJunction || v.v > 1) continue;
      const e = this.g.edges[v.path[v.k]!]!;
      const k = `${e.roadId}|${e.to}`;
      const q = queues.get(k) ?? { nodeId: this.g.nodeIds[e.to]!, roadId: e.roadId, vehicles: 0 };
      q.vehicles++;
      queues.set(k, q);
    }
    const classStats=new Map(CLASSES.map(cls=>[cls,{cls,active:0,completed:0,avgDelayS:0}]));
    for(const vehicle of this.vehicles)classStats.get(vehicle.cls)!.active++;
    for(const vehicle of this.railTrips)classStats.get(vehicle.cls)!.active++;
    for(const done of recent){const stat=classStats.get(done.cls)!;stat.completed++;stat.avgDelayS+=done.delay;}
    for(const stat of classStats.values())if(stat.completed)stat.avgDelayS/=stat.completed;
    const n = this.vehicles.length + this.railTrips.length;
    return {
      data: count === data.length / SIM_STRIDE ? data : data.slice(0, count * SIM_STRIDE), signals, aggregates: this.aggregates, tracked,
      pedestrians: this.pedestrians.snapshot(Math.min(500, view?.budget ?? 500), view?.bounds),
      metrics: {
        classes:[...classStats.values()],
        transit:this.services.map(service=>({lineId:service.line.id,name:service.line.name,mode:service.line.mode,scheduled:service.scheduled,departed:service.departed,completed:service.completed,active:service.departed-service.completed,boarded:service.boarded,waiting:Math.floor([...service.queues.values()].reduce((sum,q)=>sum+q.people,0)),passengerWaitS:service.boarded?service.waitS/service.boarded:0,meanDepartureDelayS:service.departed?service.delayS/service.departed:0,meanTravelS:service.completed?service.travelS/service.completed:0,missed:Math.max(0,service.scheduled-service.departed),issue:service.issue})),
        t: this.t, finished: this.finished, vehicles: n,
        microscopic: this.hybridCounts.microscopic+this.railTrips.length, aggregated: this.hybridCounts.aggregated, waitingDemand: Math.floor(this.spawnAcc),
        avgSpeedKmh: n ? Math.round(((this.vehicles.reduce((s, v) => s + v.v, 0)+this.railTrips.reduce((s,v)=>s+v.v,0)) / n) * 3.6) : 0,
        stopped: this.vehicles.filter((v) => v.v < 0.5).length,
        completed: this.completedCount,
        throughputVph: recent.length ? Math.round((recent.length / Math.min(900, Math.max(60, this.t))) * 3600) : 0,
        avgTravelS: recent.length ? Math.round(recent.reduce((s, c) => s + c.travel, 0) / recent.length) : 0,
        avgDelayS: recent.length ? Math.round(recent.reduce((s, c) => s + c.delay, 0) / recent.length) : 0,
        queuedVehicles: [...queues.values()].reduce((sum, queue) => sum + queue.vehicles, 0),
        queues: [...queues.values()].filter((q) => q.vehicles >= 3).sort((a, b) => b.vehicles - a.vehicles).slice(0, 12),
      },
    };
  }
}
