import { LocalFrame, layoutSection, localDayMinutes, restrictionsOf, zoneActiveAt, type Asset, type CityBaseline, type LngLat, type Network, type SimFrame, VEHICLE_SPECS } from '@drip-urban/core';
import type { FurnitureItem } from '../api/types';
import { vmsMessage } from '../traffic/live';
import { partPrints } from '../models/parts';
import { PX_PER_M } from './furnitureSprite';
import { fc, type Feature, type LineString, type Point, type Polygon } from '../engine/geojson';

/** Sign stacks: plan view in icon pixels (96 px plates), 3D in metres (lower edge 2.20 m, art. 81 Reg. CdS). */
export const POLE_STEM_PX = 40, PLATE_STEP_PX = 50;
export const SIGN_BOTTOM_M = 2.2, SIGN_STEP_M = 0.66, SIGN_PLATE_M = 0.6;

/** Smallest icon-size that keeps the object at least MIN_PX on screen (sprites are PX_PER_M px/m at ratio 2). */
const MIN_PX = 30;
function minSpriteScale(item: FurnitureItem): number {
  return MIN_PX / (Math.max(0.2, item.dims.w, item.dims.d) * (PX_PER_M / 2));
}

const close = (r: readonly LngLat[]) => [...r.map((p) => [p[0], p[1]]), [r[0]![0], r[0]![1]]];

export function buildingsFC(b: CityBaseline) {
  return fc(Object.values(b.buildings).map((x): Feature<Polygon> => ({
    type: 'Feature', id: x.id, geometry: { type: 'Polygon', coordinates: [close(x.footprint)] }, properties: { id: x.id, h: x.heightM, minH: x.minHeightM, name: x.name ?? null },
  })));
}

const CONTEXT_KIND: Record<string, string> = { green: 'green', natural: 'green', leisure: 'leisure', parking: 'parking', square: 'square' };
export function contextFC(b: CityBaseline) {
  return fc(Object.values(b.features).filter((f) => f.geometry === 'polygon' && f.coords.length >= 3).map((f): Feature<Polygon> => ({
    type: 'Feature', id: f.id, geometry: { type: 'Polygon', coordinates: [close(f.coords)] },
    properties: { id: f.id, kind: f.properties.natural === 'water' || f.properties.water ? 'water' : CONTEXT_KIND[f.kind] ?? 'other', name: f.name ?? null },
  })));
}

export function labelsFC(net: Network) {
  return fc(Object.values(net.roads).filter((r) => r.name && !r.tags?.roundabout).map((r): Feature<LineString> => ({
    type: 'Feature', id: r.id, geometry: { type: 'LineString', coordinates: r.axis.map((p) => [p[0], p[1]]) }, properties: { id: r.id, name: r.name },
  })));
}

/** Road axes as lines for traffic colouring and hit-testing. */
export function axesFC(net: Network, props: (roadId: string) => Record<string, unknown> | null) {
  const out: Feature<LineString>[] = [];
  for (const r of Object.values(net.roads)) {
    const p = props(r.id);
    if (p) out.push({ type: 'Feature', id: r.id, geometry: { type: 'LineString', coordinates: r.axis.map((q) => [q[0], q[1]]) }, properties: { id: r.id, ...p } });
  }
  return fc(out);
}

export const ZONE_COLOR: Record<string, string> = { ztl: '#8b0209', pedestrian: '#2f7d5b', school: '#d9a441', zone30: '#5587a2', low_emission: '#6fae86', parking: '#7e8fa3', work: '#e8772e' };
export function zonesFC(net: Network) {
  return fc(Object.values(net.zones).map((z): Feature<Polygon> => ({
    type: 'Feature', id: z.id, geometry: { type: 'Polygon', coordinates: [close(z.polygon)] }, properties: { id: z.id, kind: z.kind, name: z.name, color: ZONE_COLOR[z.kind] ?? '#83b4d1' },
  })));
}

function rect(frame: LocalFrame, at: LngLat, w: number, d: number, rotDeg: number): number[][] {
  const c = frame.toMetric(at);
  const a = (-rotDeg * Math.PI) / 180;
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => {
    const rx = x! * Math.cos(a) - y! * Math.sin(a), ry = x! * Math.sin(a) + y! * Math.cos(a);
    const ll = frame.toLngLat([c[0] + rx, c[1] + ry]);
    return [ll[0], ll[1]];
  });
  return [...pts, pts[0]!];
}

function disc(frame: LocalFrame, at: LngLat, r: number, n = 20): number[][] {
  const c = frame.toMetric(at);
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const ll = frame.toLngLat([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    return [ll[0], ll[1]];
  });
  return [...pts, pts[0]!];
}

/** Furniture footprints at real size + point symbols for signs; signal heads separately. */
export function assetsFC(net: Network, origin: LngLat, furniture: ReadonlyMap<string, FurnitureItem>, signalStates?: ReadonlyMap<string, string>) {
  const frame = new LocalFrame(origin);
  const fp: Feature<Polygon>[] = [];
  const pt: Feature<Point>[] = [];
  const sig: Feature<Point>[] = [];
  const parts: Feature<Polygon>[] = [];
  // Signs on the same pole stack upwards in screen space; anchor stays the pole position.
  const poles = new Map<string, Asset[]>();
  for (const a of Object.values(net.assets)) {
    if (!a.type.startsWith('it.sign.')) continue;
    const pole = (a.properties.poleId as string | undefined) ?? a.id;
    (poles.get(pole) ?? poles.set(pole, []).get(pole)!).push(a);
  }
  // level 0 = lowest plate; stackOrder 0 = top plate (art. 81 Reg. CdS: the main sign on top).
  const levelOf = new Map<string, { level: number; n: number }>();
  const poleFeatures: Feature<Point>[] = [];
  const signs3d: Feature<Point>[] = [];
  for (const [poleId, list] of poles) {
    list.sort((x, y) => ((x.properties.stackOrder as number) ?? 0) - ((y.properties.stackOrder as number) ?? 0));
    const n = list.length;
    list.forEach((a, k) => levelOf.set(a.id, { level: n - 1 - k, n }));
    const live = list.filter((a) => a.state !== 'removed');
    const foot = live[0] ?? list[0]!;
    poleFeatures.push({ type: 'Feature', id: `pole:${poleId}`, geometry: { type: 'Point', coordinates: [foot.at[0], foot.at[1]] }, properties: { id: `pole:${poleId}`, icon: `pole:${n}`, state: foot.state } });
    if (live.length) {
      // Real pole for the tilted map: Ø 60 mm up to the top plate.
      const top = SIGN_BOTTOM_M + n * SIGN_STEP_M - 0.05;
      const c = frame.toMetric(foot.at);
      const ring = Array.from({ length: 10 }, (_, j) => { const t = (j / 10) * Math.PI * 2; const ll = frame.toLngLat([c[0] + 0.03 * Math.cos(t), c[1] + 0.03 * Math.sin(t)]); return [ll[0], ll[1]]; });
      parts.push({ type: 'Feature', id: `pole:${poleId}`, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] }, properties: { id: `pole:${poleId}`, state: foot.state, material: 'steel', b: 0, h: top } });
    }
  }
  for (const a of Object.values(net.assets)) {
    const base = { id: a.id, type: a.type, state: a.state, rot: a.rotationDeg };
    if (a.type.startsWith('it.sign.')) {
      const { level, n } = levelOf.get(a.id) ?? { level: 0, n: 1 };
      pt.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: { ...base, stack: n - level, off: [0, -(POLE_STEM_PX + level * PLATE_STEP_PX)] } });
      if (a.state !== 'removed') signs3d.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: { id: a.id, type: a.type, state: a.state, hm: SIGN_BOTTOM_M + level * SIGN_STEP_M } });
      continue;
    }
    const item = furniture.get(a.type);
    if (item?.led?.kind === 'vms') {
      // PMV: manual text or the live-traffic message (art. 78 Reg. CdS).
      sig.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: { ...base, icon: `vms:${encodeURIComponent(vmsMessage(a))}` } });
      continue;
    }
    if (item?.led) {
      // Variable-message panel of a ZTL gate: shows the zone state now (art. 7 CdS, varchi elettronici).
      const zone = net.zones[String(a.properties.zoneId ?? '')];
      const now = localDayMinutes(new Date());
      const on = zone ? zoneActiveAt(zone, now.day, now.minutes) : false;
      sig.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: { ...base, icon: `led:${on ? 'on' : 'off'}` } });
      if (a.type === 'ztl.led_panel') continue;
    }
    if (a.type.startsWith('signal.')) {
      const heads = item?.signal?.heads ?? 'vehicle';
      const state = signalStates?.get(a.id) ?? 'off';
      sig.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: { ...base, icon: `sig:${heads}:${state}` } });
      continue;
    }
    if (!item) {
      pt.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: base });
      continue;
    }
    const round = item.category === 'vegetation' || item.id === 'furniture.fountain' || item.id === 'furniture.bin' || item.id === 'furniture.bollard' || item.id === 'furniture.hydrant';
    const ring = round ? disc(frame, a.at, Math.max(0.12, item.dims.w / 2)) : rect(frame, a.at, Math.max(0.15, item.dims.w), Math.max(0.15, item.dims.d), a.rotationDeg);
    fp.push({ type: 'Feature', id: a.id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: { ...base, material: a.material ?? item.material, category: item.category, h: item.dims.h, sprite: true } });
    if (a.state !== 'removed') {
      // One extrusion per part (pole, arm, lamp head…) for the tilted map: real base and top heights.
      const c = frame.toMetric(a.at), ang = (-a.rotationDeg * Math.PI) / 180, cs = Math.cos(ang), sn = Math.sin(ang);
      partPrints(item.model).forEach((pp, k) => {
        const pts = pp.ring.map(([x, y]) => { const ll = frame.toLngLat([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]); return [ll[0], ll[1]]; });
        const mat = pp.mat === 'foliage' && a.material ? a.material : pp.mat;
        parts.push({ type: 'Feature', id: `${a.id}:${k}`, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]!]] }, properties: { id: `${a.id}:${k}`, assetId: a.id, state: a.state, material: mat, b: pp.base + (a.elevationM ?? 0), h: pp.top + (a.elevationM ?? 0) } });
      });
    }
    pt.push({ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.at[0], a.at[1]] }, properties: { ...base, type: '', sprite: `furn:${item.id}${a.material && a.material !== item.material ? `:${a.material}` : ''}`, minK: minSpriteScale(item) } });
  }
  return { fp: fc(fp), pt: fc(pt), signals: fc(sig), parts: fc(parts), poles: fc(poleFeatures), signs3d: fc(signs3d) };
}

const CLS = ['car', 'van', 'truck', 'bus', 'emergency'] as const;
export function vehiclesFC(frame: SimFrame, origin: LngLat) {
  const f = new LocalFrame(origin);
  const out: Feature<Polygon>[] = [];
  const d = frame.data;
  for (let i = 0; i < d.length; i += 5) {
    const cls = CLS[d[i + 3]!] ?? 'car';
    const spec = VEHICLE_SPECS[cls];
    out.push({ type: 'Feature', id: i / 5, geometry: { type: 'Polygon', coordinates: [rect(f, [d[i]!, d[i + 1]!], spec.width, spec.length, d[i + 2]!)] }, properties: { cls: d[i + 3]!, v: d[i + 4]! } });
  }
  return fc(out);
}

/** Roads with traffic restrictions (authored or from OSM tags), for the "Divieti e limiti" layer. */
export function restrictionsFC(net: Network) {
  const out: Feature<LineString>[] = [];
  for (const r of Object.values(net.roads)) {
    const eff = restrictionsOf(r);
    if (!eff) continue;
    const x = eff.restrictions;
    const ban = x.hgv === 'no' || x.motorVehicle === 'no';
    const partial = x.hgv === 'destination' || x.hgv === 'delivery' || x.motorVehicle === 'destination';
    const parts = [x.motorVehicle === 'no' ? 'DIVIETO' : '', x.hgv === 'no' ? 'NO CAMION' : x.hgv ? `CAMION ${x.hgv === 'delivery' ? 'CARICO/SCARICO' : 'DESTINAZIONE'}` : '',
      x.maxWeightT ? `${x.maxWeightT} t` : '', x.maxHeightM ? `h ${x.maxHeightM} m` : '', x.maxWidthM ? `l ${x.maxWidthM} m` : '', x.hazmat ? 'NO ADR' : '', x.schedule?.length ? '⏱' : ''].filter(Boolean);
    out.push({ type: 'Feature', id: r.id, geometry: { type: 'LineString', coordinates: r.axis.map((p) => [p[0], p[1]]) }, properties: { id: r.id, level: ban ? 'ban' : partial ? 'partial' : 'limit', source: eff.source, label: parts.join(' · ') } });
  }
  return fc(out);
}

/** Reserved lanes drawn over the carriageway, offset to the lane centre (metres, scaled to pixels by zoom in the layer). */
export function preferentialLanesFC(net: Network) {
  const out: Feature<LineString>[] = [];
  for (const r of Object.values(net.roads)) {
    const lay = layoutSection(r);
    for (const e of lay.elements) {
      const lane = e.el.laneId ? r.lanes.find((l) => l.id === e.el.laneId) : undefined;
      if (!lane || !lane.restriction || lane.restriction === 'none' || lane.restriction === 'closed') continue;
      const centre = (e.left + e.right) / 2;
      out.push({ type: 'Feature', id: lane.id, geometry: { type: 'LineString', coordinates: r.axis.map((p) => [p[0], p[1]]) },
        properties: { id: lane.id, kind: lane.restriction === 'bike_only' ? 'bike' : 'bus', offM: -centre, widthM: Math.abs(e.left - e.right) * 0.8 } });
    }
  }
  return fc(out);
}
