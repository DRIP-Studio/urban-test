import { useEffect, useMemo, useRef, useState } from 'react';
import { partCenter, rotationMatrix } from '../models/parts';
import { VEHICLE_CLASSES, paintIndex, vehicleGlbUrl } from '../models/vehicles';
import { buildingLook } from '../models/buildings';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { SIM_STRIDE, localDayMinutes, pedestrianState, signalState, zoneActiveAt, type Asset, type LngLat, type SignalHead, type SimFrame } from '@drip-urban/core';
import { HeightModel, MARKING_LIFT_M, corridorSlopes, densifyRing, footprintBase, geoidUndulation, heightmapTile, ringHeights } from './heights';
import { loadTerrain, useTerrain } from '../state/terrain';
import type { FurnitureItem, MaterialItem } from '../api/types';
import { engine } from '../engine/engine';
import type { PhysicalPayload } from '../engine/protocol';
import { useApp } from '../state/store';
import { toast } from '../state/toasts';
import { saveTwinKeyframe, takePendingTwinCamera } from './pending';
import { Button, Segmented, Toggle } from '../ui/controls';
import { DAY_PRESETS, Daylight, zonedInstant, type Lamp } from './daylight';
import { VMS_PAGE_MS, ledCanvas, vmsCanvas, vmsPages, type VmsPictogram } from '../map/ledPanels';
import { vmsMessage } from '../traffic/live';
import { buildingAppearance, buildingGeometry, type TwinBuilding } from './buildingMesh';

type Preset = 'top' | 'perspective' | 'street' | 'junction' | 'district';

const colorOf = (materials: Map<string, MaterialItem>, id: string, fallback = '#888888') => {
  const m = materials.get(id);
  return Cesium.Color.fromCssColorString(m?.color ?? fallback).withAlpha(m?.opacity ?? 1);
};

const SIGN_SIZE: Record<string, number> = { warning: 0.9, priority: 0.9, temporary: 0.9, prohibition: 0.6, mandatory: 0.6, parking: 0.6, information: 0.6, ztl: 0.6, direction: 0.9 };
const signRasters = new Map<string, Promise<{ canvas: HTMLCanvasElement; aspect: number } | null>>();
/**
 * Sign SVGs rasterised once (WebGL cannot upload an SVG without intrinsic size): 512 px on the long
 * side, with the drawing's own proportions so rectangular plates are not squeezed into a square.
 */
function signRaster(url: string): Promise<{ canvas: HTMLCanvasElement; aspect: number } | null> {
  let p = signRasters.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        const canvas = document.createElement('canvas');
        canvas.width = aspect >= 1 ? 512 : Math.round(512 * aspect);
        canvas.height = aspect >= 1 ? Math.round(512 / aspect) : 512;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ canvas, aspect });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    signRasters.set(url, p);
  }
  return p;
}

/** Ellipsoidal ground height under a point (0 without DTM); set by the Twin when the height model changes. */
let groundAt: (lon: number, lat: number) => number = () => 0;

function enuMatrix(lon: number, lat: number, h: number, headingDeg: number): Cesium.Matrix4 {
  const pos = Cesium.Cartesian3.fromDegrees(lon, lat, h);
  return Cesium.Transforms.headingPitchRollToFixedFrame(pos, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0));
}

/** With the DTM: surfaces on the terrain or on the road design profile, kerbs as raised skins, earthwork slopes. */
function draped(p: PhysicalPayload, materials: Map<string, MaterialItem>, hm: HeightModel): Cesium.Primitive[] {
  const vf = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
  const poly = (ring: readonly LngLat[], props: { roadId?: string | null; nodeId?: string | null }, lift: number, depth: number) => {
    const { flat, min } = ringHeights(hm, densifyRing(ring, hm.frame, 6), props, lift);
    return new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(flat)), perPositionHeight: true, extrudedHeight: min - depth, vertexFormat: vf });
  };
  const surf: Cesium.GeometryInstance[] = [];
  for (const f of p.surfaces.features) {
    const outer = (f.geometry.coordinates[0] as number[][]).slice(0, -1).map((q) => [q[0]!, q[1]!] as LngLat);
    if (outer.length < 3) continue;
    const pr = f.properties as { id?: string; roadId?: string | null; nodeId?: string | null; h?: number; z?: number; material?: string };
    try {
      surf.push(new Cesium.GeometryInstance({ id: pr.id, geometry: poly(outer, pr, Number(pr.h ?? 0) + Number(pr.z ?? 4) * 0.004, 0.25), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorOf(materials, String(pr.material))) } }));
    } catch { /* degenerate ring */ }
  }
  const marks: Cesium.GeometryInstance[] = [];
  for (const f of p.markings.features) {
    const outer = (f.geometry.coordinates[0] as number[][]).slice(0, -1).map((q) => [q[0]!, q[1]!] as LngLat);
    const pr = f.properties as { roadId?: string | null; nodeId?: string | null; h?: number; material?: string };
    try { marks.push(new Cesium.GeometryInstance({ geometry: poly(outer, pr, MARKING_LIFT_M + 0.03 + Number(pr.h ?? 0), 0.01), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorOf(materials, String(pr.material ?? 'road_marking_white'))) } })); } catch { /* skip */ }
  }
  const slopes: Cesium.GeometryInstance[] = [];
  for (const r of hm.profiledRoads) {
    for (const q of corridorSlopes(r, hm.grid, hm.origin).quads) {
      try {
        slopes.push(new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(q.ring.flatMap((c) => [c[0], c[1], hm.toEllipsoid(c[2])]))), perPositionHeight: true, vertexFormat: vf }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(q.cut ? '#b39a7c' : '#8fa26a')) },
        }));
      } catch { /* skip */ }
    }
  }
  const app = () => new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false });
  return [surf, marks, slopes].filter((x) => x.length).map((inst) => new Cesium.Primitive({ geometryInstances: inst, appearance: app(), asynchronous: true, releaseGeometryInstances: true, shadows: Cesium.ShadowMode.RECEIVE_ONLY }));
}

/** Surfaces and markings: one batched primitive each, heights from the physical model (same data as the 2D map). */
function physicalPrimitives(p: PhysicalPayload, materials: Map<string, MaterialItem>, hm: HeightModel | null): Cesium.Primitive[] {
  if (hm) return draped(p, materials, hm);
  const surf: Cesium.GeometryInstance[] = [];
  for (const f of p.surfaces.features) {
    const rings = f.geometry.coordinates as number[][][];
    const outer = rings[0]!.slice(0, -1);
    if (outer.length < 3) continue;
    const z = Number(f.properties.z ?? 4) * 0.004;
    const h = Number(f.properties.h ?? 0);
    try {
      surf.push(new Cesium.GeometryInstance({
        id: f.properties.id,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(outer.flat()), rings.slice(1).map((r) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(r.slice(0, -1).flat())))),
          height: z, extrudedHeight: h > 0 ? h + z : z + 0.02, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorOf(materials, String(f.properties.material))) },
      }));
    } catch { /* degenerate ring: skipped in 3D exactly as MapLibre drops it */ }
  }
  const marks: Cesium.GeometryInstance[] = p.markings.features.map((f) => new Cesium.GeometryInstance({
    geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray((f.geometry.coordinates[0] as number[][]).slice(0, -1).flat())), height: 0.045 + Number(f.properties.h ?? 0), vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorOf(materials, String(f.properties.material ?? 'road_marking_white'))) },
  }));
  const app = () => new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false });
  return [
    new Cesium.Primitive({ geometryInstances: surf, appearance: app(), asynchronous: true, releaseGeometryInstances: true, shadows: Cesium.ShadowMode.RECEIVE_ONLY }),
    ...(marks.length ? [new Cesium.Primitive({ geometryInstances: marks, appearance: app(), asynchronous: true, releaseGeometryInstances: true, shadows: Cesium.ShadowMode.RECEIVE_ONLY })] : []),
  ];
}

function buildingsPrimitive(buildings: TwinBuilding[], translucent: boolean, hm: HeightModel | null): Cesium.Primitive | null {
  // Real-scale facades (floors, windows, shutters) and coppi roofs; plaster/tile tones shared with the 2D map.
  // On the DTM a building stands on the lowest ground under its footprint (no floating corners).
  const geometry = buildingGeometry(buildings, (b) => (hm ? hm.toEllipsoid(footprintBase(hm, b.footprint)) - (b.minHeightM ? 0 : 1) : 0), translucent);
  if (!geometry) return null;
  return new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry }), appearance: buildingAppearance(translucent), asynchronous: false, compressVertices: false, shadows: translucent ? Cesium.ShadowMode.DISABLED : Cesium.ShadowMode.ENABLED });
}

/** Furniture from the catalogue's procedural parts — the same item ids the 2D map draws at real size. */
function furniturePrimitive(assets: Asset[], items: Map<string, FurnitureItem>, materials: Map<string, MaterialItem>): { prim: Cesium.Primitive | null; ids: Set<string> } {
  const inst: Cesium.GeometryInstance[] = [];
  const ids = new Set<string>();
  for (const a of assets) {
    const item = items.get(a.type);
    if (!item || a.type.startsWith('signal.') || a.state === 'removed' || item.gltf) continue;
    ids.add(a.id);
    const base = enuMatrix(a.at[0], a.at[1], (a.elevationM ?? 0) + groundAt(a.at[0], a.at[1]), a.rotationDeg);
    for (const part of item.model) {
      const vf = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
      let geometry: Cesium.Geometry | Cesium.GeometryFactory;
      if (part.shape === 'box') geometry = Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(...(part.size ?? [0.5, 0.5, 0.5])), vertexFormat: vf });
      else if (part.shape === 'cylinder' || part.shape === 'cone' || part.shape === 'frustum') {
        const r = part.r ?? 0.2;
        geometry = new Cesium.CylinderGeometry({ length: part.h ?? 1, bottomRadius: r, topRadius: part.shape === 'cone' ? 0 : part.r2 ?? r, slices: 24, vertexFormat: vf });
      } else {
        const radii = part.shape === 'sphere' ? [part.r ?? 0.5, part.r ?? 0.5, (part.r ?? 0.5) * 0.9] : part.size ?? [0.5, 0.5, 0.5];
        geometry = new Cesium.EllipsoidGeometry({ radii: new Cesium.Cartesian3(radii[0], radii[1], radii[2]), vertexFormat: vf });
      }
      // Same conventions as the 2D symbol (models/parts.ts): centre, then rotation about it.
      const rm = rotationMatrix(part.rot);
      const local = Cesium.Matrix4.fromRotationTranslation(new Cesium.Matrix3(rm[0], rm[1], rm[2], rm[3], rm[4], rm[5], rm[6], rm[7], rm[8]), new Cesium.Cartesian3(...partCenter(part)));
      const mat = part.mat === 'foliage' && a.material ? a.material : part.mat;
      const col = colorOf(materials, mat);
      inst.push(new Cesium.GeometryInstance({ id: a.id, geometry, modelMatrix: Cesium.Matrix4.multiply(base, local, new Cesium.Matrix4()), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(mat === 'glass' || mat === 'water' ? col.withAlpha(0.5) : col) } }));
    }
  }
  return { prim: inst.length ? new Cesium.Primitive({ geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: true }), asynchronous: true, shadows: Cesium.ShadowMode.ENABLED }) : null, ids };
}

export function TwinView() {
  const el = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const baseline = useApp((s) => s.baseline);
  const network = useApp((s) => s.network);
  const removedBuildings = network?.removedBuildings;
  const catalogs = useApp((s) => s.catalogs);
  const selection = useApp((s) => s.selection);
  const [ready, setReady] = useState(false);
  const [buildingsTranslucent, setBT] = useState(false);
  const grid = useTerrain((s) => s.grid);
  const [useDtm, setUseDtm] = useState(true);
  useEffect(() => { if (!useTerrain.getState().loaded) void loadTerrain(); }, []);
  // InfraWorks-like ground: project DTM (orthometric) on the WGS84 ellipsoid through the geoid undulation.
  const hm = useMemo(() => {
    if (!grid || !useDtm || !baseline || !network) return null;
    return new HeightModel(grid, network, baseline.origin, { geoidM: geoidUndulation(baseline.origin[0], baseline.origin[1]) });
  }, [grid, useDtm, baseline, network]);
  groundAt = hm ? (lon, lat) => hm.toEllipsoid(hm.terrain(lon, lat)) : () => 0;
  const [parity, setParity] = useState<{ twin: number; map: number } | null>(null);
  const daylight = useRef<Daylight | null>(null);
  const [day, setDay] = useState<{ date: string; hour: number }>(() => {
    try { const v = JSON.parse(localStorage.getItem('drip-urban:twin-day') ?? 'null'); if (v?.date && typeof v.hour === 'number') return v; } catch { /* storage unavailable */ }
    const now = new Date();
    return { date: now.toISOString().slice(0, 10), hour: 11 };
  });
  const [playing, setPlaying] = useState(false);
  const [sunElev, setSunElev] = useState<number | null>(null);
  const [status, setStatus] = useState('Avvio del Twin');
  const layers = useRef<{ phys: Cesium.Primitive[]; bld: Cesium.Primitive | null; furn: Cesium.Primitive | null; ents: Cesium.Entity[]; models: Cesium.Model[] }>({ phys: [], bld: null, furn: null, ents: [], models: [] });
  const sim = useRef<SimFrame | null>(null);
  const heads = useRef<readonly SignalHead[]>(engine.lastPhysical?.heads ?? []);

  // Viewer lifecycle
  useEffect(() => {
    if (!el.current || !baseline) return;
    let destroyed = false;
    (async () => {
      const viewer = new Cesium.Viewer(el.current!, {
        baseLayer: new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, Maxar, Earthstar Geographics', maximumLevel: 19 })),
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false, baseLayerPicker: false, navigationHelpButton: false,
        fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: false,
      });
      if (destroyed) { viewer.destroy(); return; }
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
      viewer.scene.postProcessStages.fxaa.enabled = true;
      viewerRef.current = viewer;
      daylight.current = new Daylight(viewer, baseline.origin);
      const [w, s, e, n] = baseline.bbox;
      const pend = takePendingTwinCamera();
      if (pend) viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(pend.lon, pend.lat, pend.height), orientation: { heading: Cesium.Math.toRadians(pend.heading), pitch: Cesium.Math.toRadians(pend.pitch), roll: 0 } });
      else viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees((w + e) / 2, s - 0.012, 1400), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 } });
      setStatus('Terreno ellissoidico · immagini Esri');
      setReady(true);
    })().catch((err) => toast.error('Twin 3D', err instanceof Error ? err.message : String(err)));
    return () => { destroyed = true; daylight.current?.destroy(); daylight.current = null; viewerRef.current?.destroy(); viewerRef.current = null; };
  }, [baseline]);

  // Time of day: applied on every change, remembered for this viewer; «play» runs a day in ~40 s.
  const tz = useApp((s) => s.project?.timezone) ?? 'Europe/Rome';
  useEffect(() => {
    if (!ready || !daylight.current) return;
    setSunElev(daylight.current.apply(zonedInstant(day.date, day.hour, tz)));
    try { localStorage.setItem('drip-urban:twin-day', JSON.stringify(day)); } catch { /* storage unavailable */ }
  }, [ready, day, tz]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setDay((d) => ({ ...d, hour: (d.hour + 0.05) % 24 })), 80);
    return () => clearInterval(id);
  }, [playing]);

  // Terrain provider: DTM heightmap tiles when available, otherwise the ellipsoid.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    if (hm) {
      const g = hm.grid, geoid = hm.opts.geoidM;
      const scheme = new Cesium.GeographicTilingScheme();
      viewer.terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
        width: 33, height: 33, tilingScheme: scheme,
        callback: (x, y, level) => {
          const r = scheme.tileXYToRectangle(x, y, level);
          return heightmapTile(g, { west: Cesium.Math.toDegrees(r.west), south: Cesium.Math.toDegrees(r.south), east: Cesium.Math.toDegrees(r.east), north: Cesium.Math.toDegrees(r.north) }, 33, 33, geoid);
        },
      });
      setStatus(`Terreno DTM (${g.source}) · geoide ${hm.opts.geoidM.toFixed(0)} m${hm.hasProfiles ? ` · ${hm.profiledRoads.length} strade su livelletta` : ''}`);
    } else {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      setStatus(grid ? 'Terreno piano (DTM disattivato)' : 'Terreno piano · carica il DTM in Profilo per il rilievo');
    }
  }, [ready, hm, grid]);

  // Physical model (same payload as the 2D map)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !catalogs) return;
    const materials = new Map(catalogs.materials.items.map((m) => [m.id, m]));
    const apply = (p: PhysicalPayload) => {
      for (const prim of layers.current.phys) viewer.scene.primitives.remove(prim);
      layers.current.phys = physicalPrimitives(p, materials, hm).map((prim) => viewer.scene.primitives.add(prim) as Cesium.Primitive);
      heads.current = p.heads;
    };
    if (engine.lastPhysical) apply(engine.lastPhysical);
    const off = engine.onPhysical(() => apply(engine.lastPhysical!));
    return off;
  }, [ready, catalogs, hm]);

  // Buildings
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !baseline) return;
    if (layers.current.bld) viewer.scene.primitives.remove(layers.current.bld);
    const bp = buildingsPrimitive(Object.values(baseline.buildings).filter((b) => !removedBuildings?.[b.id]), buildingsTranslucent, hm);
    layers.current.bld = bp ? viewer.scene.primitives.add(bp) as Cesium.Primitive : null;
  }, [ready, baseline, buildingsTranslucent, removedBuildings, hm]);

  // Assets: furniture primitives, sign plates on poles, signal heads
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !network || !catalogs) return;
    const items = new Map(catalogs.furniture.items.map((i) => [i.id, i]));
    const materials = new Map(catalogs.materials.items.map((m) => [m.id, m]));
    const signs = new Map(catalogs.signs.items.map((s) => [s.id, s]));
    if (layers.current.furn) viewer.scene.primitives.remove(layers.current.furn);
    for (const e of layers.current.ents) viewer.entities.remove(e);
    layers.current.ents = [];
    const assets = Object.values(network.assets);
    const furn = furniturePrimitive(assets, items, materials);
    // Street lamps light up at night: the lamp head at the luminaire height of the catalogue item.
    const lamps: Lamp[] = assets.filter((a) => a.state !== 'removed' && a.type.startsWith('furniture.light')).map((a) => {
      const h = (items.get(a.type)?.dims.h ?? 6) * 0.95;
      return { lon: a.at[0], lat: a.at[1], h: groundAt(a.at[0], a.at[1]) + h };
    });
    daylight.current?.setLamps(lamps);
    layers.current.furn = furn.prim ? viewer.scene.primitives.add(furn.prim) as Cesium.Primitive : null;
    const rendered = new Set(furn.ids);
    // LED faces of PMV and ZTL panels: the same texture as the 2D map, pages changing in turn.
    for (const a of assets) {
      const item = items.get(a.type);
      if (!item?.led || a.state === 'removed') continue;
      const base = enuMatrix(a.at[0], a.at[1], (a.elevationM ?? 0) + groundAt(a.at[0], a.at[1]), a.rotationDeg);
      const rotation = Cesium.Quaternion.fromRotationMatrix(Cesium.Matrix4.getMatrix3(base, new Cesium.Matrix3()));
      let image: Cesium.CallbackProperty;
      if (item.led.kind === 'vms') {
        const pic = (a.properties.vmsPictogram as VmsPictogram) ?? 'none';
        const pages = vmsPages(vmsMessage(a)).map((t) => vmsCanvas(t, pic, 4));
        image = new Cesium.CallbackProperty(() => pages[Math.floor(Date.now() / VMS_PAGE_MS) % pages.length]!, false);
      } else {
        const zone = network.zones[String(a.properties.zoneId ?? '')];
        const now = localDayMinutes(new Date());
        const canvas = ledCanvas(zone ? zoneActiveAt(zone, now.day, now.minutes) : false, 4);
        image = new Cesium.CallbackProperty(() => canvas, true);
      }
      for (const part of item.model.filter((x) => x.mat === 'display' && x.size)) {
        const [sx, sy, sz] = part.size!;
        const thinY = sy <= sx;
        const c = partCenter(part);
        // Just in front of the display box, on its outer side.
        const local = thinY ? new Cesium.Cartesian3(c[0], c[1] + Math.sign(part.at[1] || 1) * (sy / 2 + 0.004), c[2]) : new Cesium.Cartesian3(c[0] + Math.sign(part.at[0] || 1) * (sx / 2 + 0.004), c[1], c[2]);
        const position = Cesium.Matrix4.multiplyByPoint(base, local, new Cesium.Cartesian3());
        const facing = thinY ? (part.at[1] >= 0 ? Cesium.Cartesian3.UNIT_Y : Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3())) : (part.at[0] >= 0 ? Cesium.Cartesian3.UNIT_X : Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()));
        layers.current.ents.push(viewer.entities.add({
          id: `led:${a.id}:${item.model.indexOf(part)}`, position, orientation: rotation,
          plane: { plane: new Cesium.Plane(facing, 0), dimensions: new Cesium.Cartesian2(thinY ? sx : sy, sz), material: new Cesium.ImageMaterialProperty({ image }) },
        }));
      }
    }
    // Imported glTF models (SketchUp, Blender, Revit…): real geometry, Y-up glTF on the ENU frame of the anchor.
    for (const m of layers.current.models) viewer.scene.primitives.remove(m);
    layers.current.models = [];
    let alive = true;
    for (const a of assets) {
      const item = items.get(a.type);
      if (!item?.gltf || a.state === 'removed') continue;
      rendered.add(a.id);
      const matrix = enuMatrix(a.at[0], a.at[1], (a.elevationM ?? 0) + groundAt(a.at[0], a.at[1]), a.rotationDeg);
      Cesium.Matrix4.multiplyByUniformScale(matrix, item.scale ?? 1, matrix);
      void Cesium.Model.fromGltfAsync({ url: item.gltf, modelMatrix: matrix, id: a.id, upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.Z } as never)
        .then((model) => { if (alive && !viewer.isDestroyed()) layers.current.models.push(viewer.scene.primitives.add(model) as Cesium.Model); else model.destroy(); })
        .catch((e: unknown) => toast.error('Modello 3D non caricato', e instanceof Error ? e.message : String(e)));
    }
    // Signs: one pole per poleId, plates stacked from the top.
    const poles = new Map<string, Asset[]>();
    for (const a of assets) if (a.type.startsWith('it.sign.') && a.state !== 'removed') { const k = (a.properties.poleId as string) ?? a.id; (poles.get(k) ?? poles.set(k, []).get(k)!).push(a); }
    for (const list of poles.values()) {
      list.sort((x, y) => ((x.properties.stackOrder as number) ?? 0) - ((y.properties.stackOrder as number) ?? 0));
      const base = list[0]!;
      const top = 2.2 + list.length * 0.95;
      layers.current.ents.push(viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(base.at[0], base.at[1], groundAt(base.at[0], base.at[1]) + top / 2), cylinder: { length: top, topRadius: 0.03, bottomRadius: 0.03, material: Cesium.Color.fromCssColorString('#8d9196') } }));
      list.forEach((a, i) => {
        const sign = signs.get(a.type);
        if (!sign) return;
        rendered.add(a.id);
        const heading = Cesium.Math.toRadians(a.rotationDeg + 180);
        const pos = Cesium.Cartesian3.fromDegrees(a.at[0], a.at[1], groundAt(a.at[0], a.at[1]) + top - 0.45 - i * 0.95);
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(heading, 0, 0));
        // Formato normale (art. 80 Reg. CdS): triangles 90 cm, discs and squares 60 cm; plates keep their proportions.
        const size = SIGN_SIZE[sign.family] ?? 0.6;
        const url = `/signs/${encodeURIComponent(sign.file)}`;
        const back = Cesium.Cartesian3.add(pos, Cesium.Matrix3.multiplyByVector(Cesium.Matrix3.fromQuaternion(orientation), new Cesium.Cartesian3(0, -0.01, 0), new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const ents = layers.current.ents;
        void signRaster(url).then((r) => {
          if (!r || viewer.isDestroyed() || layers.current.ents !== ents) return;
          const dims = r.aspect >= 1 ? new Cesium.Cartesian2(size, size / r.aspect) : new Cesium.Cartesian2(size * r.aspect, size);
          ents.push(viewer.entities.add({
            id: `sign:${a.id}`, position: pos, orientation,
            plane: { plane: new Cesium.Plane(Cesium.Cartesian3.UNIT_Y, 0), dimensions: dims, material: new Cesium.ImageMaterialProperty({ image: r.canvas, transparent: true }) },
          }));
          // Back of the plate: grey aluminium with the same outline, 1 cm behind.
          ents.push(viewer.entities.add({
            position: back, orientation,
            plane: { plane: new Cesium.Plane(Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()), 0), dimensions: dims, material: new Cesium.ImageMaterialProperty({ image: r.canvas, transparent: true, color: Cesium.Color.fromCssColorString('#8e9398') }) },
          }));
        });
      });
    }
    // Signal assets (existing OSM signals and placed ones) and signal-plan heads with live state.
    const lampColors: Record<string, Cesium.Color> = { red: Cesium.Color.fromCssColorString('#e5483a'), yellow: Cesium.Color.fromCssColorString('#f3b52f'), green: Cesium.Color.fromCssColorString('#3fc06a'), off: Cesium.Color.fromCssColorString('#2c2e31') };
    const addHead = (at: readonly [number, number], heading: number, stateOf: () => string, ped: boolean) => {
      const h = ped ? 2.4 : 3.0, g = groundAt(at[0], at[1]);
      layers.current.ents.push(viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(at[0], at[1], g + h / 2), cylinder: { length: h, topRadius: 0.05, bottomRadius: 0.05, material: Cesium.Color.fromCssColorString('#3a3d40') } }));
      // Housing faces the approaching traffic (heading = direction of travel towards the stop line).
      const hp = Cesium.Cartesian3.fromDegrees(at[0], at[1], g + h + 0.15);
      layers.current.ents.push(viewer.entities.add({ position: hp, orientation: Cesium.Transforms.headingPitchRollQuaternion(hp, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
        box: { dimensions: new Cesium.Cartesian3(0.34, 0.22, 1.0), material: Cesium.Color.fromCssColorString('#1c1d1f') } }));
      ['red', 'yellow', 'green'].forEach((c, i) => {
        layers.current.ents.push(viewer.entities.add({
          // Lamps sit on the face of the housing that looks at the drivers (local −y of the travel heading).
          position: Cesium.Matrix4.multiplyByPoint(enuMatrix(at[0], at[1], g, heading), new Cesium.Cartesian3(0, -0.13, h + 0.45 - i * 0.3), new Cesium.Cartesian3()), ellipsoid: { radii: new Cesium.Cartesian3(0.11, 0.11, 0.11),
            material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => (stateOf() === c ? lampColors[c] : lampColors.off), false)) },
        }));
      });
    };
    for (const a of assets) if (a.type.startsWith('signal.') && a.state !== 'removed') { rendered.add(a.id); addHead(a.at, a.rotationDeg, () => 'off', a.type === 'signal.pedestrian'); }
    const plans = network.signalPlans;
    for (const h of heads.current) {
      addHead(h.at, h.bearingDeg, () => {
        const plan = plans[h.planId];
        const t = sim.current?.metrics.t;
        if (!plan || t === undefined) return 'off';
        return h.groupId.startsWith('ped:') ? pedestrianState(plan, h.groupId.slice(4), t) : signalState(plan, h.groupId, t, h.turn);
      }, h.kind === 'pedestrian');
    }
    const expected = assets.filter((a) => a.state !== 'removed' && (items.has(a.type) || signs.has(a.type))).length;
    setParity({ twin: rendered.size, map: expected });
    return () => { alive = false; };
  }, [ready, network, catalogs, hm]);

  // Simulated vehicles: detailed glTF models (built in memory per class and paint), one per vehicle id.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    const live = new Map<number, { model: Cesium.Model | null; seen: number }>();
    let tick = 0;
    const place = (lon: number, lat: number, heading: number) => enuMatrix(lon, lat, groundAt(lon, lat) + 0.02, heading);
    const off = engine.onSim((f) => {
      sim.current = f;
      tick++;
      if (!f) { for (const v of live.values()) if (v.model) viewer.scene.primitives.remove(v.model); live.clear(); return; }
      const d = f.data;
      for (let i = 0; i < d.length; i += SIM_STRIDE) {
        const id = d[i + 5]!, cls = VEHICLE_CLASSES[d[i + 3]!] ?? 'car';
        const m = place(d[i]!, d[i + 1]!, d[i + 2]!);
        const cur = live.get(id);
        if (cur) { cur.seen = tick; if (cur.model) cur.model.modelMatrix = m; continue; }
        const entry: { model: Cesium.Model | null; seen: number } = { model: null, seen: tick };
        live.set(id, entry);
        void Cesium.Model.fromGltfAsync({ url: vehicleGlbUrl(cls, paintIndex(cls, id)), modelMatrix: m, upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X } as never).then((model) => {
          if (viewer.isDestroyed() || live.get(id) !== entry) { model.destroy(); return; }
          entry.model = viewer.scene.primitives.add(model) as Cesium.Model;
        }).catch(() => undefined);
      }
      for (const [id, v] of live) if (v.seen !== tick) { if (v.model) viewer.scene.primitives.remove(v.model); live.delete(id); }
    });
    return () => { off(); if (!viewer.isDestroyed()) for (const v of live.values()) if (v.model) viewer.scene.primitives.remove(v.model); live.clear(); };
  }, [ready]);

  const preset = (p: Preset) => {
    const viewer = viewerRef.current;
    if (!viewer || !baseline || !network) return;
    const node = selection?.kind === 'node' ? network.nodes[selection.ids[0]!]?.at
      : selection?.kind === 'roundabout' ? network.roundabouts[selection.ids[0]!]?.center
      : selection?.kind === 'asset' ? network.assets[selection.ids[0]!]?.at : null;
    const c = node ?? baseline.origin;
    const views: Record<Preset, { h: number; pitch: number; back: number }> = {
      top: { h: 900, pitch: -90, back: 0 }, perspective: { h: 420, pitch: -35, back: 0.006 }, street: { h: 2.2, pitch: -4, back: 0.0004 },
      junction: { h: 70, pitch: -45, back: 0.0007 }, district: { h: 1500, pitch: -45, back: 0.014 },
    };
    const v = views[p];
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(c[0], c[1] - v.back, v.h), orientation: { heading: 0, pitch: Cesium.Math.toRadians(v.pitch), roll: 0 }, duration: 1.2 });
  };

  return (
    <div className="twin">
      <div className="twin-canvas" ref={el} />
      <div className="twin-toolbar">
        <Segmented<Preset> label="Inquadratura" size="sm" value="perspective" onChange={preset}
          options={[{ value: 'top', label: 'Dall\'alto' }, { value: 'perspective', label: 'Prospettiva' }, { value: 'street', label: 'Strada' }, { value: 'junction', label: 'Incrocio' }, { value: 'district', label: 'Quartiere' }]} />
        <Toggle label="Edifici trasparenti" checked={buildingsTranslucent} onChange={setBT} />
        <div className="twin-day" role="group" aria-label="Ora del giorno">
          <Segmented<string> label="Momento della giornata" size="sm" value={DAY_PRESETS.find((p) => Math.abs(p.hour - day.hour) < 0.01)?.value ?? ''}
            options={DAY_PRESETS} onChange={(v) => { setPlaying(false); setDay((d) => ({ ...d, hour: DAY_PRESETS.find((p) => p.value === v)!.hour })); }} />
          <input type="range" min={0} max={23.99} step={0.25} value={day.hour} aria-label="Ora" aria-valuetext={fmtHour(day.hour)}
            onChange={(e) => { setPlaying(false); setDay((d) => ({ ...d, hour: Number(e.target.value) })); }} />
          <output className="mono">{fmtHour(day.hour)}</output>
          <input type="date" value={day.date} aria-label="Data" onChange={(e) => e.target.value && setDay((d) => ({ ...d, date: e.target.value }))} />
          <Button size="sm" variant="ghost" icon={playing ? 'pause' : 'play'} onClick={() => setPlaying((p) => !p)}>{playing ? 'Ferma' : 'Scorri la giornata'}</Button>
        </div>
        {grid ? <Toggle label="Terreno DTM" checked={useDtm} onChange={setUseDtm} /> : null}
        <Button size="sm" icon="camera" onClick={() => {
          const v = viewerRef.current;
          if (!v) return;
          const c = Cesium.Cartographic.fromCartesian(v.camera.position);
          const pid = useApp.getState().project?.id;
          if (!pid) return;
          void saveTwinKeyframe(pid, { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height, heading: Cesium.Math.toDegrees(v.camera.heading), pitch: Cesium.Math.toDegrees(v.camera.pitch) })
            .then(() => toast.success('Inquadratura salvata', 'Disponibile in Presenta come scena 3D'))
            .catch((err) => toast.error('Inquadratura non salvata', err instanceof Error ? err.message : String(err)));
        }}>Salva inquadratura</Button>
      </div>
      <div className="twin-status">
        <span>{status}</span>
        {sunElev !== null ? <span>{sunElev < -4 ? 'Notte · luce lunare, lampioni accesi' : sunElev < 6 ? `Sole basso (${Math.round(sunElev)}°)` : `Sole a ${Math.round(sunElev)}° · ombre reali`}</span> : null}
        {parity ? <span className={parity.twin === parity.map ? 'ok' : 'warn-line'}>Parità 2D/3D: {parity.twin}/{parity.map} oggetti</span> : null}
      </div>
    </div>
  );
}

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

export default TwinView;
