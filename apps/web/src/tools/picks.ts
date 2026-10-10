import {refreshTrafficState,trafficSourceMode} from '../traffic/live';
import { create } from 'zustand';
import { LocalFrame, geom, type LngLat, type Route, type TravelMode } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { getProjectTime, useProjectTime } from '../state/projectTime';
import { MODES, defaultLine, upgradeLine, type BikeShare, type LineStop, type TransitLine, type TransitMode } from '../transit/model';

export type TransitStop = LineStop;
export type TransitRouteDesign = TransitLine;
export interface GtfsFeed { source: string; importedAt: string; agencies: { name: string }[]; routes: { id: string; shortName: string; longName: string; mode: string; color: string; line: LngLat[]; stopIds: string[]; tripsPerDay: number; amPeakHeadwayMin: number | null }[]; stops: { id: string; name: string; at: LngLat }[] }
interface TransitDoc { gtfs?: GtfsFeed; design?: Record<string, TransitRouteDesign[]>; bikeshare?: Record<string, BikeShare> }

interface PicksState {
  strategy: 'road' | 'transit' | 'multimodal';
  accessM: number;
  transferM: number;
  mode: TravelMode;
  departure: { day: number; minutes: number };
  from: LngLat | null;
  to: LngLat | null;
  /** Intermediate stops, in order. */
  via: LngLat[];
  /** Next click adds a stop instead of restarting. */
  addingVia: boolean;
  /** Truck profile used when mode = truck (or any vehicle limits). */
  vehicle: { weightT: number; heightM: number; widthM: number; lengthM: number; axleLoadT: number; hazmat: boolean };
  permits: string[];
  result: { today: Route; project: Route; alternatives: Route[] } | null;
  /** Index of the alternative shown as «project» route. */
  altIndex: number;
  /** Times with the DRIP traffic estimate (congestion) instead of free flow. */
  traffic: boolean;
  selectAlternative(i: number): void;
  swapEnds(): void;
  routing: boolean;
  isoAt: LngLat | null;
  isoMode: TravelMode;
  isoMinutes: Record<string, number> | null;
  transit: TransitDoc;
  selectedRouteId: string | null;
  /** Mode of the next line drawn with the Linea TPL tool. */
  newLineMode: TransitMode;
  pickRoutePoint(ll: LngLat): void;
  runRoute(): Promise<void>;
  pickIsochrone(ll: LngLat): void;
  runIsochrone(): Promise<void>;
  loadTransit(): Promise<void>;
  saveTransit(doc: TransitDoc): Promise<void>;
  addTransitRoute(points: LngLat[]): void;
  addTransitStop(ll: LngLat): void;
  addBikeStation(ll: LngLat): void;
}

const scenarioId = () => useApp.getState().scenario?.id ?? 'baseline';
/** Bumped on every local save: a slower load must not overwrite newer local data. */
let transitVersion = 0;
let routeRequest = 0;

export const usePicks = create<PicksState>((set, get) => ({
  strategy: 'road', accessM: 1200, transferM: 500, mode: 'car', departure: { day: 1, minutes: 8 * 60 }, from: null, to: null, via: [], addingVia: false, result: null, routing: false, altIndex: 0, traffic: false,
  vehicle: { weightT: 18, heightM: 3.8, widthM: 2.55, lengthM: 10, axleLoadT: 8, hazmat: false },
  permits: [],
  isoAt: null, isoMode: 'walk', isoMinutes: null, transit: {}, selectedRouteId: null, newLineMode: 'bus',

  pickRoutePoint(ll) {
    const { from, to, addingVia, via } = get();
    if (addingVia && from && to) { set({ via: [...via, ll], addingVia: false }); void get().runRoute(); }
    else if (!from || (from && to)) set({ from: ll, to: null, via: [], result: null });
    else { set({ to: ll }); void get().runRoute(); }
    drawRoutePins();
  },
  async runRoute() {
    const { from, to, via, mode, vehicle, traffic, permits, strategy, accessM, transferM } = get();
    const initial = useApp.getState(), scope = { pid: initial.project?.id, sid: initial.scenario?.id, revision: JSON.stringify(initial.scenario?.operations) };
    const departure = getProjectTime(), request = ++routeRequest;
    if (!from || !to) return;
    set({ routing: true });
    try {
      const veh = mode === 'truck' ? vehicle : undefined;
      const trafficState=traffic?await refreshTrafficState():null;
      if(traffic&&trafficSourceMode()!=='simulated'&&(!trafficState||!Object.keys(trafficState.segments).length))throw Error('Nessun dato utilizzabile per la fonte traffico scelta. Aggiorna la fonte o scegli Simulato.');
      const r = await engine.job<{ today: Route; project: Route; alternatives: Route[] }>('compareRoute', { from, to, via, traffic, strategy, accessM, transferM, ctx: { ...(trafficState?{trafficState}:{}),mode, day: departure.day, minutes: departure.minutes, date: departure.date, holiday: departure.holiday, permits, ...(veh ? { vehicle: veh } : {}) } });
      const current = useApp.getState();
      if (request !== routeRequest || current.project?.id !== scope.pid || current.scenario?.id !== scope.sid || JSON.stringify(current.scenario?.operations) !== scope.revision) return;
      set({ result: r, altIndex: 0 });
      drawRoutes();
      setSource('compare', r.today.found ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.today.line.map((p) => [...p]) }, properties: {} }]) : null);
      if (!r.project.found) toast.warn('Percorso non trovato', r.project.warnings.join(' · '));
    } catch (e) {
      if (request === routeRequest) toast.error('Navigatore', e instanceof Error ? e.message : String(e));
    } finally { if (request === routeRequest) set({ routing: false }); }
  },
  selectAlternative(i) {
    const r = get().result;
    if (!r?.alternatives[i]) return;
    set({ altIndex: i, result: { ...r, project: r.alternatives[i]! } });
    drawRoutes();
  },
  swapEnds() {
    const { from, to, via } = get();
    if (!from || !to) return;
    set({ from: to, to: from, via: [...via].reverse() });
    drawRoutePins();
    void get().runRoute();
  },
  pickIsochrone(ll) { set({ isoAt: ll }); void get().runIsochrone(); },
  async runIsochrone() {
    const { isoAt, isoMode } = get();
    const net = useApp.getState().network;
    if (!isoAt || !net) return;
    const minutes = await engine.job<Record<string, number>>('isochrone', { at: isoAt, mode: isoMode, minutes: 15, ctx: getProjectTime() });
    set({ isoMinutes: minutes });
    const feats: Feature[] = Object.entries(minutes).filter(([id]) => net.roads[id]).map(([id, m]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((p) => [...p]) }, properties: { minutes: m } }));
    setSource('iso', fc(feats));
  },
  async loadTransit() {
    const p = useApp.getState().project;
    if (!p) return;
    const started = transitVersion, startedScenario=scenarioId();
    const doc = (await api.get<TransitDoc | null>(`/api/projects/${encodeURIComponent(p.id)}/docs/transit`)) ?? {};
    // A local change saved while the request was in flight is newer than what the server sent back.
    if (started !== transitVersion || useApp.getState().project?.id !== p.id || scenarioId()!==startedScenario) return;
    // 1.0 lines (single headway, bus/brt/tram) become multimodal lines with service bands.
    const design = Object.fromEntries(Object.entries(doc.design ?? {}).map(([sid, list]) => [sid, list.map((r) => upgradeLine(r))]));
    const sid = scenarioId(), network = useApp.getState().network;
    if(network&&!useApp.getState().scenario?.isBaseline&&(network.transit===undefined&&design[sid]?.length||network.bikeShare===undefined&&doc.bikeshare?.[sid]))commit('transit.set',{lines:network.transit??design[sid]??[],bikeShare:network.bikeShare??doc.bikeshare?.[sid]});
    set({ transit: { ...doc, design: {...design, [sid]: [...(useApp.getState().network?.transit ?? [])]},bikeshare:{...doc.bikeshare,...(useApp.getState().network?.bikeShare?{[sid]:useApp.getState().network!.bikeShare!}:{})} } });
    drawTransit();
  },
  async saveTransit(doc) {
    const p = useApp.getState().project;
    if (!p) return;
    const result = commit('transit.set', {lines: doc.design?.[scenarioId()] ?? [],bikeShare:doc.bikeshare?.[scenarioId()]});
    if (!result.ok) return;
    transitVersion++;
    set({ transit: doc });
    drawTransit();
    try { await api.put(`/api/projects/${encodeURIComponent(p.id)}/docs/transit`, {gtfs:doc.gtfs,bikeshare:Object.fromEntries(Object.entries(doc.bikeshare??{}).filter(([sid])=>sid!==scenarioId())),design:Object.fromEntries(Object.entries(doc.design ?? {}).filter(([sid])=>sid!==scenarioId()))}); }
    catch (e) { toast.error('Linee TPL non salvate', e instanceof Error ? e.message : String(e)); }
  },
  addTransitRoute(points) {
    const initial=useApp.getState(),b=initial.baseline,pid=initial.project?.id,sid=initial.scenario?.id,revision=JSON.stringify(initial.scenario?.operations);
    if(!b||!pid||!sid||points.length<2)return;
    const current=()=>{const state=useApp.getState();return state.project?.id===pid&&state.scenario?.id===sid&&JSON.stringify(state.scenario?.operations)===revision;};
    const mode = get().newLineMode;
    const finish = (line: LngLat[], followed: boolean) => {
      if(!current()){toast.warn('Linea TPL','Scenario cambiato durante calcolo: ripeti il tracciamento');return;}
      const f = new LocalFrame(b.origin);
      const len = geom.lengthOf(line.map((p) => f.toMetric(p) as geom.V));
      const doc = get().transit;
      const list = [...(doc.design?.[scenarioId()] ?? [])];
      const r = defaultLine(newId('tl'), mode, line, list.filter((x) => x.mode === mode).length);
      list.push(r);
      void get().saveTransit({ ...doc, design: { ...(doc.design ?? {}), [scenarioId()]: list } });
      set({ selectedRouteId: r.id });
      toast.success(`${MODES[mode].label}: linea creata`, `${(len / 1000).toFixed(2).replace('.', ',')} km${followed ? ' lungo le strade' : ''} · aggiungi le fermate con lo strumento Fermata (B) o «Fermate automatiche»`);
    };
    // Road modes follow the street network between the clicked points (as a bus would drive).
    if (MODES[mode].onRoad && points.length >= 2) {
      const departure = getProjectTime();
      void engine.job<{ project: Route }>('compareRoute', { from: points[0], to: points[points.length - 1], via: points.slice(1, -1), ctx: { mode: mode==='tram'?'tram':'bus', ...departure } })
        .then(r=>{if(!current())return;if(!r.project.found||r.project.line.length<2){toast.warn('Linea TPL non creata','Nessun percorso accessibile connesso tra i punti selezionati');return;}finish([...r.project.line],true);})
        .catch(error=>{if(current())toast.error('Calcolo linea TPL',String(error));});
    } else finish([...points], false);
  },
  addBikeStation(ll) {
    const { transit } = get();
    const sid = scenarioId();
    const bs: BikeShare = transit.bikeshare?.[sid] ?? { system: 'Bike sharing', stations: [], dockless: false };
    const st = { id: newId('bs'), name: `Stazione ${bs.stations.length + 1}`, at: ll, docks: 15, ebikeShare: 0.4 };
    void get().saveTransit({ ...transit, bikeshare: { ...(transit.bikeshare ?? {}), [sid]: { ...bs, stations: [...bs.stations, st] } } });
  },
  addTransitStop(ll) {
    const { selectedRouteId, transit } = get();
    const list = [...(transit.design?.[scenarioId()] ?? [])];
    const r = list.find((x) => x.id === selectedRouteId);
    if (!r) { toast.info('Fermata', 'Seleziona prima una linea nel pannello TPL.'); return; }
    const b = useApp.getState().baseline!;
    const f = new LocalFrame(b.origin);
    const m = r.line.map((p) => f.toMetric(p) as geom.V);
    const pr = geom.project(m, f.toMetric(ll) as geom.V);
    if (pr.d > 40) { toast.info('Fermata', 'Clicca vicino al percorso della linea (entro 40 m).'); return; }
    const stop: TransitStop = { id: newId('st'), name: `Fermata ${r.stops.length + 1}`, at: f.toLngLat(pr.at) };
    const stops = [...r.stops, stop].sort((a, c) => geom.project(m, f.toMetric(a.at) as geom.V).along - geom.project(m, f.toMetric(c.at) as geom.V).along);
    const next = list.map((x) => (x.id === r.id ? { ...x, stops } : x));
    void get().saveTransit({ ...transit, design: { ...(transit.design ?? {}), [scenarioId()]: next } });
  },
}));

export function drawRoutePins(): void {
  const { from, to, via } = usePicks.getState();
  const pts = [from && { at: from, label: 'A' }, ...via.map((v, i) => ({ at: v, label: String(i + 1) })), to && { at: to, label: 'B' }].filter(Boolean) as { at: LngLat; label: string }[];
  setSource('draft', fc(pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...p.at] }, properties: { snap: true, label: p.label } }))));
}

export function drawTransit(): void {
  const { transit } = usePicks.getState();
  const lines: Feature[] = [];
  const stops: Feature[] = [];
  const gtfsMode = (m: string) => (['tram', 'metro', 'train', 'ferry', 'funicular'].includes(m) ? m : m === 'trolleybus' ? 'trolleybus' : 'bus');
  for (const r of transit.gtfs?.routes ?? []) if (r.line.length >= 2) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.line.map((p) => [...p]) }, properties: { color: r.color, name: r.shortName, mode: gtfsMode(r.mode), source: 'gtfs' } });
  for (const s of transit.gtfs?.stops ?? []) stops.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...s.at] }, properties: { name: s.name, color: '#5587a2', mode: 'bus' } });
  for (const r of transit.design?.[scenarioId()] ?? []) {
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.line.map((p) => [...p]) }, properties: { color: r.color, name: r.name, mode: r.mode, source: 'project' } });
    for (const s of r.stops) stops.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...s.at] }, properties: { name: s.name, color: r.color, mode: r.mode } });
  }
  setSource('transit-lines', fc(lines));
  setSource('transit-stops', fc(stops));
  const bs = transit.bikeshare?.[scenarioId()];
  setSource('bike-stations', fc((bs?.stations ?? []).map((st): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...st.at] }, properties: { id: st.id, name: st.name, docks: st.docks } }))));
}

/** Selected route on top (DRIP blue), the other alternatives underneath in a quieter tone. */
function drawRoutes(): void {
  const { result, altIndex } = usePicks.getState();
  if (!result?.project.found) { setSource('route', null); return; }
  const feats: Feature[] = result.alternatives.map((r, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.line.map((p) => [...p]) }, properties: { alt: i !== altIndex, rank: i === altIndex ? 1 : 0 } }));
  setSource('route', fc(feats));
}

// Routing snapshots update at calendar-minute boundaries, rather than on every animation tick.
let routeTimeKey = '';
function syncDeparture() {
  if (!useApp.getState().project) return;
  const time = getProjectTime(), key = `${time.date}:${Math.floor(time.minutes)}:${time.holiday}`;
  if (key === routeTimeKey) return;
  routeTimeKey = key;
  usePicks.setState({ departure: { day: time.day, minutes: time.minutes } });
  if (usePicks.getState().from && usePicks.getState().to) void usePicks.getState().runRoute();
}
useProjectTime.subscribe(syncDeparture);
useApp.subscribe((s, previous) => { if (s.network?.clock !== previous.network?.clock || s.project?.id !== previous.project?.id) syncDeparture(); });

useApp.subscribe((s,previous)=>{
 if(s.network?.transit!==previous.network?.transit||s.network?.bikeShare!==previous.network?.bikeShare||s.scenario?.id!==previous.scenario?.id){
  const state=usePicks.getState();usePicks.setState({transit:{...state.transit,design:{...state.transit.design,[s.scenario?.id??'baseline']:[...(s.network?.transit??[])]},bikeshare:{...state.transit.bikeshare,[s.scenario?.id??'baseline']:s.network?.bikeShare??{system:'Bike sharing',stations:[],dockless:false}}}});drawTransit();
 }
});
