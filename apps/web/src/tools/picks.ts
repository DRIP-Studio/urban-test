import { create } from 'zustand';
import { LocalFrame, geom, type LngLat, type Route, type TravelMode } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { newId, useApp } from '../state/store';
import { toast } from '../state/toasts';

export interface TransitStop { readonly id: string; readonly name: string; readonly at: LngLat }
export interface TransitRouteDesign {
  readonly id: string; name: string; mode: 'bus' | 'brt' | 'tram'; color: string; line: LngLat[]; stops: TransitStop[];
  headwayMin: number; firstDeparture: string; lastDeparture: string; vehicle: string; capacity: number; speedKmh: number;
}
export interface GtfsFeed { source: string; importedAt: string; agencies: { name: string }[]; routes: { id: string; shortName: string; longName: string; mode: string; color: string; line: LngLat[]; stopIds: string[]; tripsPerDay: number; amPeakHeadwayMin: number | null }[]; stops: { id: string; name: string; at: LngLat }[] }
interface TransitDoc { gtfs?: GtfsFeed; design?: Record<string, TransitRouteDesign[]> }

interface PicksState {
  mode: TravelMode;
  departure: { day: number; minutes: number };
  from: LngLat | null;
  to: LngLat | null;
  result: { today: Route; project: Route } | null;
  routing: boolean;
  isoAt: LngLat | null;
  isoMode: TravelMode;
  isoMinutes: Record<string, number> | null;
  transit: TransitDoc;
  selectedRouteId: string | null;
  pickRoutePoint(ll: LngLat): void;
  runRoute(): Promise<void>;
  pickIsochrone(ll: LngLat): void;
  runIsochrone(): Promise<void>;
  loadTransit(): Promise<void>;
  saveTransit(doc: TransitDoc): Promise<void>;
  addTransitRoute(line: LngLat[]): void;
  addTransitStop(ll: LngLat): void;
}

const scenarioId = () => useApp.getState().scenario?.id ?? 'baseline';

export const usePicks = create<PicksState>((set, get) => ({
  mode: 'car', departure: { day: 1, minutes: 8 * 60 }, from: null, to: null, result: null, routing: false,
  isoAt: null, isoMode: 'walk', isoMinutes: null, transit: {}, selectedRouteId: null,

  pickRoutePoint(ll) {
    const { from, to } = get();
    if (!from || (from && to)) set({ from: ll, to: null, result: null });
    else { set({ to: ll }); void get().runRoute(); }
    drawRoutePins();
  },
  async runRoute() {
    const { from, to, mode, departure } = get();
    if (!from || !to) return;
    set({ routing: true });
    try {
      const r = await engine.job<{ today: Route; project: Route }>('compareRoute', { from, to, ctx: { mode, day: departure.day, minutes: departure.minutes } });
      set({ result: r });
      setSource('route', r.project.found ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.project.line.map((p) => [...p]) }, properties: {} }]) : null);
      setSource('compare', r.today.found ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.today.line.map((p) => [...p]) }, properties: {} }]) : null);
      if (!r.project.found) toast.warn('Percorso non trovato', r.project.warnings.join(' · '));
    } catch (e) {
      toast.error('Navigatore', e instanceof Error ? e.message : String(e));
    } finally { set({ routing: false }); }
  },
  pickIsochrone(ll) { set({ isoAt: ll }); void get().runIsochrone(); },
  async runIsochrone() {
    const { isoAt, isoMode } = get();
    const net = useApp.getState().network;
    if (!isoAt || !net) return;
    const minutes = await engine.job<Record<string, number>>('isochrone', { at: isoAt, mode: isoMode, minutes: 15 });
    set({ isoMinutes: minutes });
    const feats: Feature[] = Object.entries(minutes).filter(([id]) => net.roads[id]).map(([id, m]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((p) => [...p]) }, properties: { minutes: m } }));
    setSource('iso', fc(feats));
  },
  async loadTransit() {
    const p = useApp.getState().project;
    if (!p) return;
    const doc = (await api.get<TransitDoc | null>(`/api/projects/${encodeURIComponent(p.id)}/docs/transit`)) ?? {};
    set({ transit: doc });
    drawTransit();
  },
  async saveTransit(doc) {
    const p = useApp.getState().project;
    if (!p) return;
    set({ transit: doc });
    drawTransit();
    try { await api.put(`/api/projects/${encodeURIComponent(p.id)}/docs/transit`, doc); }
    catch (e) { toast.error('Linee TPL non salvate', e instanceof Error ? e.message : String(e)); }
  },
  addTransitRoute(line) {
    const b = useApp.getState().baseline;
    if (!b) return;
    const f = new LocalFrame(b.origin);
    const len = geom.lengthOf(line.map((p) => f.toMetric(p) as geom.V));
    const doc = get().transit;
    const list = [...(doc.design?.[scenarioId()] ?? [])];
    const r: TransitRouteDesign = {
      id: newId('tl'), name: `Linea ${list.length + 1}`, mode: 'bus', color: ['#8b0209', '#5587a2', '#e8772e', '#2f7d5b'][list.length % 4]!, line, stops: [],
      headwayMin: 15, firstDeparture: '06:00', lastDeparture: '21:00', vehicle: 'Autobus 12 m', capacity: 85, speedKmh: 18,
    };
    list.push(r);
    void get().saveTransit({ ...doc, design: { ...(doc.design ?? {}), [scenarioId()]: list } });
    set({ selectedRouteId: r.id });
    toast.success('Linea creata', `${(len / 1000).toFixed(2).replace('.', ',')} km · aggiungi le fermate con lo strumento Fermata`);
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

function drawRoutePins(): void {
  const { from, to } = usePicks.getState();
  const pts = [from && { at: from, label: 'A' }, to && { at: to, label: 'B' }].filter(Boolean) as { at: LngLat; label: string }[];
  setSource('draft', fc(pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...p.at] }, properties: { snap: true, label: p.label } }))));
}

export function drawTransit(): void {
  const { transit } = usePicks.getState();
  const lines: Feature[] = [];
  const stops: Feature[] = [];
  for (const r of transit.gtfs?.routes ?? []) if (r.line.length >= 2) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.line.map((p) => [...p]) }, properties: { color: r.color, name: r.shortName } });
  for (const s of transit.gtfs?.stops ?? []) stops.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...s.at] }, properties: { name: s.name, color: '#5587a2' } });
  for (const r of transit.design?.[scenarioId()] ?? []) {
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.line.map((p) => [...p]) }, properties: { color: r.color, name: r.name } });
    for (const s of r.stops) stops.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...s.at] }, properties: { name: s.name, color: r.color } });
  }
  setSource('transit-lines', fc(lines));
  setSource('transit-stops', fc(stops));
}
