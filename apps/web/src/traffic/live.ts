import { create } from 'zustand';
import { VMS_CHARS, vmsPages } from '../map/ledPanels';
import type { Asset, LngLat } from '@drip-urban/core';
import { api } from '../api/client';
import { fc, type Feature } from '../engine/geojson';
import { getMap, setSource, toggleLayer } from '../map/mapStore';
import { useApp } from '../state/store';

/**
 * Live traffic shared by the map, the Traffic Studio, the variable-message panels (PMV) and Elios:
 * HERE flow + incidents for the visible area, refreshed on demand or automatically (every few
 * minutes and when the view moves). Nothing is estimated here: no key, no live data.
 */
export interface LiveState {
  status: 'idle' | 'ok' | 'not_configured' | 'error';
  provider?: string; capturedAt?: string; message?: string;
  flow: Feature[]; incidents: Feature[];
  auto: boolean; busy: boolean; intervalMin: number;
}

export const useLive = create<LiveState>(() => ({ status: 'idle', flow: [], incidents: [], auto: false, busy: false, intervalMin: 3 }));

interface LiveResult { status: 'ok' | 'not_configured' | 'error'; provider: string; capturedAt?: string; message?: string; features: Feature[]; incidents?: Feature[] }
interface TrafficDoc { captures?: { at: string; day: number; hour: number; meanRatio: number; segments: number }[] }

const ratio = (f: Feature) => Number(f.properties.speedKmh) / Math.max(1, Number(f.properties.freeFlowKmh));

function viewBbox(): number[] | null {
  const m = getMap();
  if (!m) return null;
  const b = m.getBounds();
  const bb = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  // The API refuses very large boxes: shrink around the centre (a city-wide view reads its core).
  const MAX = 0.045;
  if ((bb[2]! - bb[0]!) * (bb[3]! - bb[1]!) <= MAX) return bb;
  const c = m.getCenter(), h = Math.sqrt(MAX) / 2;
  return [c.lng - h, c.lat - h, c.lng + h, c.lat + h];
}

export function drawLive(): void {
  const s = useLive.getState();
  if (s.status !== 'ok') return;
  setSource('traffic', fc(s.flow.map((f, i) => ({ ...f, id: i, properties: { ...f.properties, ratio: ratio(f) } }))));
  const pins: Feature[] = s.incidents.map((f) => {
    const c = f.geometry.type === 'Point' ? (f.geometry.coordinates as number[]) : (f.geometry.coordinates as number[][])[0]!;
    return { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { ...f.properties, pin: 1 } };
  });
  setSource('incidents', fc([...s.incidents, ...pins]));
}

export async function refreshLive(opts: { archive?: boolean } = {}): Promise<LiveState> {
  const project = useApp.getState().project;
  const bb = viewBbox();
  if (!bb || !project || useLive.getState().busy) return useLive.getState();
  useLive.setState({ busy: true });
  try {
    const r = await api.get<LiveResult>(`/api/traffic/live?bbox=${bb.map((x) => x.toFixed(5)).join(',')}`);
    useLive.setState({ status: r.status, provider: r.provider, capturedAt: r.capturedAt, message: r.message, flow: r.features ?? [], incidents: r.incidents ?? [] });
    if (r.status === 'ok') {
      drawLive();
      toggleLayer('traffic', true); toggleLayer('incidents', true);
      if (opts.archive !== false && r.features.length) {
        // Archive an aggregate of this real capture: the history tab is built only from these.
        const ratios = r.features.map(ratio);
        const now = new Date();
        const doc = (await api.get<TrafficDoc | null>(`/api/projects/${project.id}/docs/traffic`)) ?? {};
        const captures = [...(doc.captures ?? []), { at: now.toISOString(), day: (now.getDay() + 6) % 7, hour: now.getHours(), meanRatio: ratios.reduce((s, x) => s + x, 0) / ratios.length, segments: ratios.length }].slice(-2000);
        await api.put(`/api/projects/${project.id}/docs/traffic`, { ...doc, captures });
      }
    }
  } catch (e) {
    useLive.setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally { useLive.setState({ busy: false }); }
  return useLive.getState();
}

let timer = 0;
let moveTimer = 0;
const onMove = () => { window.clearTimeout(moveTimer); moveTimer = window.setTimeout(() => void refreshLive({ archive: false }), 1500); };

/** Automatic refresh: every `intervalMin` minutes and 1.5 s after the view stops moving. */
export function setLiveAuto(on: boolean, intervalMin = useLive.getState().intervalMin): void {
  window.clearInterval(timer);
  getMap()?.off('moveend', onMove);
  useLive.setState({ auto: on, intervalMin });
  if (!on) return;
  timer = window.setInterval(() => void refreshLive(), intervalMin * 60_000);
  getMap()?.on('moveend', onMove);
  void refreshLive();
}

export function stopLive(): void {
  setLiveAuto(false);
  setSource('incidents', null);
}

// ------------------------------------------------------------------ variable-message panels (PMV)

const M_PER_DEG = 111_320;
function distM(a: readonly number[], b: readonly number[]): number {
  const k = Math.cos((a[1]! * Math.PI) / 180);
  return Math.hypot((a[0]! - b[0]!) * M_PER_DEG * k, (a[1]! - b[1]!) * M_PER_DEG);
}
function nearestM(at: LngLat, f: Feature): number {
  const g = f.geometry;
  const pts = g.type === 'Point' ? [g.coordinates as number[]] : (g.coordinates as number[][]);
  return Math.min(...pts.map((p) => distM(at, p)));
}
const round100 = (m: number) => `${Math.max(100, Math.round(m / 100) * 100)} m`;

/**
 * Message of a PMV (art. 78 Reg. CdS): manual text, or — in live mode — the most relevant
 * event within 2 km (closures and accidents first, then queues within 1 km). Max 3 lines × 16 characters.
 */
export function vmsMessage(asset: Asset, live: LiveState = useLive.getState()): string {
  const manual = String(asset.properties.vmsText ?? '').trim();
  if (asset.properties.vmsMode !== 'live') return manual || 'DRIP URBAN';
  if (live.status !== 'ok') return manual || 'INFO TRAFFICO\nNON DISPONIBILE';
  const inc = live.incidents.map((f) => ({ f, d: nearestM(asset.at, f) })).filter((x) => x.d <= 2000)
    .sort((a, b) => (Number(b.f.properties.roadClosed) - Number(a.f.properties.roadClosed)) || a.d - b.d)[0];
  if (inc) {
    const p = inc.f.properties;
    const head = p.roadClosed ? 'STRADA CHIUSA' : String(p.label ?? 'EVENTO').toUpperCase();
    return `${head}\nA ${round100(inc.d)}\n${p.roadClosed ? 'SEGUIRE DEVIAZIONE' : 'PRUDENZA'}`;
  }
  const jam = live.flow.map((f) => ({ f, d: nearestM(asset.at, f), j: Number(f.properties.jamFactor ?? 0) })).filter((x) => x.d <= 1000 && x.j >= 4)
    .sort((a, b) => b.j - a.j || a.d - b.d)[0];
  if (jam) return `${jam.j >= 8 ? 'CODA' : 'RALLENTAMENTI'}\nA ${round100(jam.d)}\n${jam.j >= 8 ? 'RIDURRE VELOCITÀ' : 'PRUDENZA'}`;
  return 'TRAFFICO\nREGOLARE';
}

/** Upper case, up to 4 pages (separated by an empty line) of 3 lines × 16 characters. */
export function sanitizeVms(text: string): string {
  return vmsPages(text.toUpperCase()).map((p) => p.split('\n').map((l) => l.slice(0, VMS_CHARS)).join('\n')).join('\n\n');
}
