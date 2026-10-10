import { createPedestrianRenderer } from './pedestrians';
import {physicalTiles} from './physicalTiles';
import {buildingTiles,buildingLod} from './buildingLod';
import { registerTwinCameraReader } from './cameraContext';
import {CinematicPanel} from './CinematicPanel';
import {underpassEntities,gradingRetainingEntities} from './underpasses';
import {worksStage} from '@drip-urban/core';
import { solidGlb } from '../models/solidGlb';
import { liveSignalAspect } from '../map/signalsLive';
import { rainStage } from './weather';
import { furnitureGlb } from '../models/furnitureGlb';
import { materialAppearance, prepareMaterials, texturedPolygon } from './materials3d';
import { TwinCameraRig } from './cameraRig';
import { TwinVehiclePanel } from './TwinVehiclePanel';
import { useMapUi } from '../map/mapStore';
import { TwinGizmo } from './gizmo';
import { TwinInspector } from './TwinInspector';
import { useTwinUi, pickTwinVehicle, type CameraMode } from './viewState';
import { SIGN_BOTTOM_M, SIGN_STEP_M } from '../map/sources';
import { getProjectTime, useProjectClock, useProjectTime, setProjectWallTime, playProjectTime } from '../state/projectTime';
import { useEffect, useMemo, useRef, useState } from 'react';
import { partCenter, rotationMatrix } from '../models/parts';
import { VEHICLE_CLASSES, paintIndex, vehicleGlbUrl } from '../models/vehicles';
import { buildingLook } from '../models/buildings';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { utilityRuns, UTILITY_COLORS, type UtilitySystem, SIM_STRIDE, pedestrianState, signalState, zoneActiveAt, type WeatherPreset, type Asset, type LngLat, type SignalHead, type SimFrame } from '@drip-urban/core';
import { HeightModel, MARKING_LIFT_M, corridorSlopes, densifyRing, footprintBase, geoidUndulation, heightmapTile, ringHeights } from './heights';
import { loadTerrain, useTerrain } from '../state/terrain';
import type { FurnitureItem, MaterialItem } from '../api/types';
import { engine } from '../engine/engine';
import type { PhysicalPayload } from '../engine/protocol';
import { commit, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { saveTwinKeyframe, takePendingTwinCamera } from './pending';
import { Button, Segmented, Select, Toggle } from '../ui/controls';
import { solarDayPresets, Daylight, type Lamp } from './daylight';
import { VMS_PAGE_MS, ledCanvas, vmsCanvas, vmsPages, type VmsPictogram } from '../map/ledPanels';
import { vmsMessage } from '../traffic/live';
import { buildingAppearance, buildingGeometry, type TwinBuilding } from './buildingMesh';
import { SIGN_SIZE, signRaster } from './signs3d';

type Preset = 'top' | 'perspective' | 'street' | 'junction' | 'district';

const colorOf = (materials: Map<string, MaterialItem>, id: string, fallback = '#888888') => {
  const m = materials.get(id);
  return Cesium.Color.fromCssColorString(m?.color ?? fallback).withAlpha(m?.opacity ?? 1);
};

/** Ellipsoidal ground height under a point (0 without DTM); set by the Twin when the height model changes. */
let groundAt: (lon: number, lat: number) => number = () => 0;

function enuMatrix(lon: number, lat: number, h: number, headingDeg: number): Cesium.Matrix4 {
  const pos = Cesium.Cartesian3.fromDegrees(lon, lat, h);
  return Cesium.Transforms.headingPitchRollToFixedFrame(pos, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0));
}

/** With the DTM: surfaces on the terrain or on the road design profile, kerbs as raised skins, earthwork slopes. */
function draped(p: PhysicalPayload, materials: Map<string, MaterialItem>, hm: HeightModel, includeSlopes = true): Cesium.Primitive[] {
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
  for (const r of includeSlopes ? hm.profiledRoads : []) {
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

/** One spatial tile of surfaces and markings from the same physical payload used in 2D. */
function physicalTilePrimitives(p: PhysicalPayload, materials: Map<string, MaterialItem>, hm: HeightModel | null): Cesium.Primitive[] {
  const custom = p.surfaces.features.filter((f) => String(f.properties.material).startsWith('custom.'));
  if (custom.length) {
    const groups = new Map<string, Cesium.GeometryInstance[]>();
    const origin = useApp.getState().baseline!.origin;
    for (const feature of custom) {
      const m = materials.get(String(feature.properties.material)); if (!m) continue;
      const ring = (feature.geometry.coordinates[0] as number[][]).map((at) => [at[0]!, at[1]!] as LngLat);
      const props = feature.properties as { roadId?: string; nodeId?: string; h?: number; z?: number };
      const lift = Number(props.h ?? 0) + Number(props.z ?? 4) * .004;
      const positions = hm ? Cesium.Cartesian3.fromDegreesArrayHeights(ringHeights(hm, densifyRing(ring, hm.frame, 6), props, lift).flat) : Cesium.Cartesian3.fromDegreesArrayHeights(ring.flatMap((at) => [at[0], at[1], lift]));
      const geometry = texturedPolygon(new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(positions), perPositionHeight: true, vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }), m, origin);
      if (!geometry) continue;
      const instances = groups.get(m.id) ?? []; instances.push(new Cesium.GeometryInstance({ id: feature.properties.id, geometry })); groups.set(m.id, instances);
    }
    const textures = [...groups].flatMap(([id, geometryInstances]) => {
      const appearance = materialAppearance(materials.get(id)!);
      return appearance ? [new Cesium.Primitive({ geometryInstances, appearance, asynchronous: false, compressVertices: false, shadows: Cesium.ShadowMode.RECEIVE_ONLY })] : [];
    });
    const remaining = { ...p, surfaces: { ...p.surfaces, features: p.surfaces.features.filter((f) => !custom.includes(f)) } };
    // Keep a colour fallback until the project's image is decoded.
    return textures.length ? [...physicalTilePrimitives(remaining, materials, hm), ...textures] : hm ? draped(p, materials, hm, false) : physicalTilePrimitives({ ...p, surfaces: { ...p.surfaces, features: p.surfaces.features.map((f) => custom.includes(f) ? { ...f, properties: { ...f.properties, material: 'asphalt' } } : f) } }, materials, hm);
  }
  if (hm) return draped(p, materials, hm, false);
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
  return [surf,marks].filter(inst=>inst.length).map(geometryInstances=>new Cesium.Primitive({geometryInstances,appearance:app(),asynchronous:true,releaseGeometryInstances:true,shadows:Cesium.ShadowMode.RECEIVE_ONLY}));
}

/** Spatial batches let Cesium cull offscreen streets without changing physical geometry. */
function physicalPrimitives(p:PhysicalPayload,materials:Map<string,MaterialItem>,hm:HeightModel|null):Cesium.Primitive[]{
 const origin=useApp.getState().baseline!.origin;
 const primitives=physicalTiles(p,origin,400).flatMap(tile=>physicalTilePrimitives(tile,materials,hm));
 if(hm)primitives.push(...draped({...p,surfaces:{...p.surfaces,features:[]},markings:{...p.markings,features:[]}},materials,hm));
 return primitives;
}

function buildingTilePrimitive(buildings: TwinBuilding[], translucent: boolean, hm: HeightModel | null, materials: Map<string, MaterialItem>, detailed = true): Cesium.PrimitiveCollection | null {
  const collection = new Cesium.PrimitiveCollection();
  const baseOf = (b: TwinBuilding) => hm ? hm.toEllipsoid(footprintBase(hm, b.footprint)) - (b.minHeightM ? 0 : 1) : 0;
  let count = 0;
  for (const surface of ['facade', 'roof'] as const) {
    const key = surface === 'facade' ? 'facadeMaterial' : 'roofMaterial';
    const ordinary = buildings.filter((b) => !b[key] || !materialAppearance(materials.get(b[key]!)!));
    const geometry = buildingGeometry(ordinary, baseOf, translucent, surface,detailed);
    if (geometry) { collection.add(new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry }), appearance: buildingAppearance(translucent), asynchronous: false, compressVertices: false, shadows: translucent ? Cesium.ShadowMode.DISABLED : Cesium.ShadowMode.ENABLED })); count++; }
    const groups = new Map<string, TwinBuilding[]>();
    for (const b of buildings) if (b[key] && materials.has(b[key]!)) { const list = groups.get(b[key]!) ?? []; list.push(b); groups.set(b[key]!,list); }
    for (const [id, list] of groups) {
      const m = materials.get(id)!, appearance = materialAppearance(m); if (!appearance) continue;
      const geometry = buildingGeometry(list, baseOf, translucent, surface,detailed); if (!geometry) continue;
      const st = geometry.attributes.st!.values; for (let i=0; i<st.length; i++) st[i] = st[i]! / m.scaleM;
      collection.add(new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry }), appearance, asynchronous: false, compressVertices: false, shadows: Cesium.ShadowMode.ENABLED })); count++;
    }
  }
  return count ? collection : null;
}

interface BuildingLodStats {near:number;medium:number;far:number;hidden:number;tiles:number}
function buildingsPrimitive(buildings:TwinBuilding[],translucent:boolean,hm:HeightModel|null,materials:Map<string,MaterialItem>,origin:LngLat) {
 const collection=new Cesium.PrimitiveCollection(),tiles=buildingTiles(buildings,origin),entries:{low:Cesium.PrimitiveCollection;high:Cesium.PrimitiveCollection|null;sphere:Cesium.BoundingSphere;count:number}[]=[];
 for(const list of tiles.values()) {
  const low=buildingTilePrimitive(list,translucent,hm,materials,false);if(!low)continue;collection.add(low);
  const high=list.some(b=>b.balconies)?buildingTilePrimitive(list,translucent,hm,materials,true):null;if(high)collection.add(high);
  const points=list.flatMap(b=>b.footprint.map(p=>Cesium.Cartesian3.fromDegrees(p[0],p[1],(hm?hm.toEllipsoid(footprintBase(hm,b.footprint)):0)+b.heightM/2)));
  entries.push({low,high,sphere:Cesium.BoundingSphere.fromPoints(points),count:list.length});
 }
 return {collection,update(camera:Cesium.Cartesian3,quality:string,adaptive:boolean):BuildingLodStats {
  const stats:BuildingLodStats={near:0,medium:0,far:0,hidden:0,tiles:entries.length};
  for(const entry of entries){const distance=Math.max(0,Cesium.Cartesian3.distance(camera,entry.sphere.center)-entry.sphere.radius),lod=buildingLod(distance,quality,adaptive);stats[lod]+=entry.count;if(entry.high)entry.high.show=lod==='near';entry.low.show=lod!=='hidden'&&(!entry.high||lod!=='near');}
  return stats;
 }};
}

/** Furniture from the catalogue's procedural parts — the same item ids the 2D map draws at real size. */
function furniturePrimitive(assets: Asset[], items: Map<string, FurnitureItem>, materials: Map<string, MaterialItem>, asynchronous = true, detailedIds = new Set<string>()): { prim: Cesium.PrimitiveCollection | null; ids: Set<string> } {
  const opaque: Cesium.GeometryInstance[] = [], transparent: Cesium.GeometryInstance[] = [];
  const ids = new Set<string>();
  for (const a of assets) {
    const item = items.get(a.type);
    if (detailedIds.has(a.id)) { ids.add(a.id); continue; }
    if (!item || a.type.startsWith('signal.') || a.state === 'removed') continue;
    ids.add(a.id);
    const base = enuMatrix(a.at[0], a.at[1], (a.elevationM ?? 0) + groundAt(a.at[0], a.at[1]), a.rotationDeg);
    Cesium.Matrix4.multiplyByUniformScale(base, a.scale ?? 1, base);
    for (const [partIndex, part] of item.model.entries()) {
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
      const mat = a.material && (part.mat === item.material || part.mat === 'foliage') ? a.material : part.mat;
      const col = colorOf(materials, mat);
      const color = mat === 'glass' || mat === 'water' ? col.withAlpha(Math.min(col.alpha,0.5)) : col;
      (color.alpha < 1 ? transparent : opaque).push(new Cesium.GeometryInstance({ id: `${a.id}::part:${partIndex}`, geometry, modelMatrix: Cesium.Matrix4.multiply(base, local, new Cesium.Matrix4()), attributes: { show: new Cesium.ShowGeometryInstanceAttribute(true), color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) } }));
    }
  }
  const collection=new Cesium.PrimitiveCollection();
  for(const [instances,translucent] of [[opaque,false],[transparent,true]] as const)if(instances.length)collection.add(new Cesium.Primitive({geometryInstances:instances,appearance:new Cesium.PerInstanceColorAppearance({translucent,closed:true}),asynchronous,shadows:Cesium.ShadowMode.ENABLED}));
  return {prim:collection.length?collection:null,ids};
}

export function TwinView() {
  const [fatal,setFatal] = useState<Error|null>(null);
  const el = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const baseline = useApp((s) => s.baseline);
  const network = useApp((s) => s.network);
  const removedBuildings = network?.removedBuildings;
  const catalogs = useApp((s) => s.catalogs);
  const selection = useApp((s) => s.selection);
  const [ready, setReady] = useState(false);
  const [materialRevision, setMaterialRevision] = useState(0);
  const [detailedFurniture, setDetailedFurniture] = useState(new Set<string>());
  const modelSignatures = useRef(new WeakMap<Cesium.Model,string>());
  useEffect(() => { if (!catalogs) return; let active = true; prepareMaterials(catalogs.materials.items).then(() => { if (active) setMaterialRevision((v) => v + 1); }).catch((error) => toast.error('Materiali Twin', String(error))); return () => { active = false; }; }, [catalogs]);
  const [presetName, setPresetName] = useState<Preset>('perspective');
  const cameraMode = useTwinUi((s) => s.cameraMode);
  const editing = useTwinUi((s) => s.editing);
  const [busId, setBusId] = useState<number | null>(null);
  const [underground,setUnderground]=useState(false);
  const undergroundRef=useRef(underground);undergroundRef.current=underground;
  const [buildingsTranslucent, setBT] = useState(false);
  const [quality, setQuality] = useState('balanced');
  const [adaptive, setAdaptive] = useState(false);
  const renderProfile=useRef({quality,adaptive});renderProfile.current={quality,adaptive};
  const [buildingStats,setBuildingStats]=useState<BuildingLodStats|null>(null);
  const [flowStats, setFlowStats] = useState<{ vehicles: number; drawn: number; t: number; fps: number } | null>(null);
  const grid = useTerrain((s) => s.grid);
  const [useDtm, setUseDtm] = useState(true);
  useEffect(() => { if (!useTerrain.getState().loaded) void loadTerrain(); }, []);
  // InfraWorks-like ground: project DTM (orthometric) on the WGS84 ellipsoid through the geoid undulation.
  const hm = useMemo(() => {
    if(!baseline||!network)return null;
    const authored=Object.values(network.roads).some(r=>r.vertical)||Object.values(network.areas).some(a=>a.grading);
    if((!grid||!useDtm)&&!authored)return null;
    const reference=grid&&useDtm?grid:{west:baseline.bbox[0],south:baseline.bbox[1],east:baseline.bbox[2],north:baseline.bbox[3],nx:2,ny:2,z:[0,0,0,0],resolutionM:0,source:'Piano di riferimento 0 m — nessun rilievo'};
    return new HeightModel(reference,network,baseline.origin,{geoidM:grid&&useDtm?geoidUndulation(baseline.origin[0],baseline.origin[1]):0});
  }, [grid,useDtm,baseline,network?.roads,network?.nodes,network?.areas]);
  groundAt = useMemo(()=>hm ? (lon:number, lat:number) => hm.toEllipsoid(hm.groundZ(lon, lat)) : () => 0,[hm]);
  const [parity, setParity] = useState<{ twin: number; map: number } | null>(null);
  const daylight = useRef<Daylight | null>(null);
  const { time: projectTime, clock: projectClock } = useProjectClock();
  const dayPresets = useMemo(() => solarDayPresets(baseline?.origin ?? [0,0], projectTime.date, projectClock.timeZone), [baseline?.origin, projectTime.date, projectClock.timeZone]);
  const day = { date: projectTime.date, hour: projectTime.hour };
  const playing = useProjectTime((s) => s.playing);
  const setPlaying = playProjectTime;
  const setDay = (change: (before: { date: string; hour: number }) => { date: string; hour: number }) => {
    const next = change(day); setProjectWallTime(next.date, next.hour * 60);
  };
  const [sunElev, setSunElev] = useState<number | null>(null);
  const [status, setStatus] = useState('Avvio del Twin');
  const layers = useRef<{ phys: Cesium.Primitive[]; bld: Cesium.PrimitiveCollection | null; furn: Cesium.PrimitiveCollection | null; ents: Cesium.Entity[]; models: Cesium.Model[] }>({ phys: [], bld: null, furn: null, ents: [], models: [] });
  const sim = useRef<SimFrame | null>(null);
  const heads = useRef<readonly SignalHead[]>(engine.lastPhysical?.heads ?? []);

  // Viewer lifecycle
  useEffect(() => {
    if (!el.current || !baseline) return;
    let destroyed = false;
    let removeCameraReader: (() => void) | undefined;
    let removeRendererHandlers: (() => void) | undefined;
    (async () => {
      const viewer = new Cesium.Viewer(el.current!, {
        baseLayer: new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, Maxar, Earthstar Geographics', maximumLevel: 19 })),
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false, baseLayerPicker: false, navigationHelpButton: false,
        fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
      });
      if (destroyed) { viewer.destroy(); return; }
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
      viewer.scene.postProcessStages.fxaa.enabled = true;
      viewerRef.current = viewer;
      viewer.scene.rethrowRenderErrors = false;
      const onLost = (event:Event) => {event.preventDefault();setFatal(new Error('Contesto grafico 3D perso'));};
      viewer.canvas.addEventListener('webglcontextlost',onLost);
      const offRender = viewer.scene.renderError.addEventListener((_scene:unknown,error:unknown)=>setFatal(error instanceof Error?error:new Error(String(error))));
      removeRendererHandlers=()=>{viewer.canvas.removeEventListener('webglcontextlost',onLost);offRender();};
      removeCameraReader = registerTwinCameraReader(() => {
        if (viewer.isDestroyed()) return null;
        const position = viewer.camera.positionCartographic, rectangle = viewer.camera.computeViewRectangle();
        return { position: { longitude: Cesium.Math.toDegrees(position.longitude), latitude: Cesium.Math.toDegrees(position.latitude), heightM: position.height }, headingDeg: Cesium.Math.toDegrees(viewer.camera.heading), pitchDeg: Cesium.Math.toDegrees(viewer.camera.pitch), viewport: rectangle ? [Cesium.Math.toDegrees(rectangle.west), Cesium.Math.toDegrees(rectangle.south), Cesium.Math.toDegrees(rectangle.east), Cesium.Math.toDegrees(rectangle.north)] : null, source: 'live-twin-camera' };
      });
      if (import.meta.env.DEV) (window as unknown as { __dripTwin?: { viewer: Cesium.Viewer; Cesium: typeof Cesium } }).__dripTwin = { viewer, Cesium };
      daylight.current = new Daylight(viewer, baseline.origin);
      viewer.resolutionScale = 0.8;
      viewer.scene.shadowMap.size = 1024;
      viewer.scene.shadowMap.softShadows = false;
      const [w, s, e, n] = baseline.bbox;
      const pend = takePendingTwinCamera();
      if (pend) viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(pend.lon, pend.lat, pend.height), orientation: { heading: Cesium.Math.toRadians(pend.heading), pitch: Cesium.Math.toRadians(pend.pitch), roll: 0 } });
      else {
        const { center, mpp } = useMapUi.getState();
        const inside = center[0] >= w && center[0] <= e && center[1] >= s && center[1] <= n;
        const focus = inside ? center : baseline.origin;
        const range = Math.max(80, Math.min(2200, mpp * viewer.canvas.clientHeight));
        viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(focus[0], focus[1], groundAt(focus[0], focus[1])), new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range));
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      }
      setStatus('Terreno ellissoidico · immagini Esri');
      setReady(true);
    })().catch((err) => {if(!destroyed)setFatal(err instanceof Error?err:new Error(String(err)));});
    return () => { destroyed = true; removeRendererHandlers?.(); removeCameraReader?.(); if (import.meta.env.DEV) delete (window as unknown as { __dripTwin?: unknown }).__dripTwin; daylight.current?.destroy(); daylight.current = null; viewerRef.current?.destroy(); viewerRef.current = null; };
  }, [baseline]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    const profiles: Record<string, { scale: number; shadows: number }> = { performance: { scale: 0.6, shadows: 0 }, balanced: { scale: 0.8, shadows: 1024 }, high: { scale: 1, shadows: 2048 }, ultra: { scale: 1, shadows: 4096 } };
    const profile = profiles[quality]!;
    const gl = viewer.canvas.getContext('webgl2') ?? viewer.canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? String(gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    const software = /swiftshader|llvmpipe|software|warp/i.test(renderer);
    viewer.resolutionScale = software ? Math.min(profile.scale, 0.4) : profile.scale;
    // Keep disabled shadow resources stable on software renderers. Switching quality must
    // not resize/recompile a shadow map which that renderer never displays.
    const shadows = !software && profile.shadows > 0;
    if (shadows) viewer.scene.shadowMap.size = profile.shadows;
    viewer.scene.shadowMap.enabled = shadows;
    viewer.shadows = shadows;
    if (software) {
      viewer.shadows = false; viewer.scene.shadowMap.enabled = false;
      viewer.scene.postProcessStages.fxaa.enabled = false;
    } else viewer.scene.postProcessStages.fxaa.enabled = true;
    setAdaptive(software);
    let lastFrame = performance.now(), slow = 0;
    const off = viewer.scene.postRender.addEventListener(() => {
      const now = performance.now(), gap = now - lastFrame; lastFrame = now;
      // A 10 Hz simulation requests frames; avoid mistaking an idle request-render viewer for overload.
      if (sim.current && gap > 300) slow++; else slow = Math.max(0, slow - 1);
      if (slow >= 3 && viewer.resolutionScale > 0.35) {
        viewer.resolutionScale = Math.max(0.35, viewer.resolutionScale * 0.75); viewer.shadows = false; viewer.scene.shadowMap.enabled = false;
        viewer.scene.postProcessStages.fxaa.enabled = false; setAdaptive(true); slow = 0;
      }
    });
    viewer.scene.requestRender();
    return off;
  }, [ready, quality]);

  // Lighting uses the same real project instant as traffic and restrictions.
  const lightingMinute = projectTime.instant.slice(0, 16);
  useEffect(() => {
    if (!ready || !daylight.current) return;
    setSunElev(daylight.current.apply(new Date(projectTime.instant), network?.environment?.weather, network?.environment?.intensity));
    const viewer = viewerRef.current;
    if (viewer && (quality === 'performance' || adaptive)) { viewer.shadows = false; viewer.scene.shadowMap.enabled = false; }
    viewer?.scene.requestRender();
  }, [ready, lightingMinute, quality, adaptive, network?.environment]);
  useEffect(() => { viewerRef.current?.scene.requestRender(); }, [projectTime.seconds]);

  useEffect(() => {
    const viewer=viewerRef.current;if(!ready||!viewer||network?.environment?.weather!=='rain')return;
    const stage=viewer.scene.postProcessStages.add(rainStage(network?.environment?.intensity ?? 1));viewer.scene.requestRender();
    const timer = window.setInterval(() => { if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && (useApp.getState().network?.environment?.mode === 'live' || useProjectTime.getState().playing)) viewer.scene.requestRender(); }, 50);
    return ()=>{clearInterval(timer);if(!viewer.isDestroyed())viewer.scene.postProcessStages.remove(stage);};
  },[ready,network?.environment?.weather,network?.environment?.intensity]);

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
          return heightmapTile(g, { west: Cesium.Math.toDegrees(r.west), south: Cesium.Math.toDegrees(r.south), east: Cesium.Math.toDegrees(r.east), north: Cesium.Math.toDegrees(r.north) }, 33, 33, geoid, (lon,lat)=>hm.terrain(lon,lat));
        },
      });
      setStatus(`${grid&&useDtm?'Terreno DTM':'Quote progetto'} (${g.source}) · geoide ${hm.opts.geoidM.toFixed(0)} m${hm.hasProfiles ? ` · ${hm.profiledRoads.length} strade su livelletta` : ''}`);
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
    const off = engine.onPhysical((m) => { heads.current = m.diff.heads; if (['surfaces', 'markings', 'lines'].some((layer) => { const d = m.diff[layer as 'surfaces']; return d.full || d.add.length || d.remove.length; })) apply(engine.lastPhysical!); });
    return off;
  }, [ready, catalogs, hm, materialRevision]);

  useEffect(() => {
    const viewer=viewerRef.current;if(!ready||!viewer)return;
    let alive=true;const loaded: Cesium.Cesium3DTileset[]=[];
    for(const model of Object.values(network?.cityModels??{})) if(model.enabled) {
      void Cesium.Cesium3DTileset.fromUrl(model.url,{maximumScreenSpaceError:quality==='performance'?32:16}).then((tiles)=>{
        if(!alive||viewer.isDestroyed()){tiles.destroy();return;}viewer.scene.primitives.add(tiles);loaded.push(tiles);viewer.scene.requestRender();
      }).catch((error)=>{if(alive)toast.error(`3D Tiles · ${model.name}`,String(error));});
    }
    return ()=>{alive=false;if(!viewer.isDestroyed())for(const tiles of loaded)viewer.scene.primitives.remove(tiles);};
  },[ready,network?.cityModels,quality]);

  // Buildings
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !baseline) return;
    if (layers.current.bld) viewer.scene.primitives.remove(layers.current.bld);
    const bp = buildingsPrimitive(Object.values(baseline.buildings).filter((b) => !removedBuildings?.[b.id]).map((b) => ({ ...b, ...network?.buildingStyles?.[b.id] })), buildingsTranslucent, hm, new Map(catalogs?.materials.items.map((m) => [m.id,m]) ?? []),baseline.origin);
    layers.current.bld = viewer.scene.primitives.add(bp.collection) as Cesium.PrimitiveCollection;
    const update=()=>{const profile=renderProfile.current,stats=bp.update(viewer.camera.positionWC,profile.quality,profile.adaptive);setBuildingStats(old=>old&&Object.keys(stats).every(k=>old[k as keyof BuildingLodStats]===stats[k as keyof BuildingLodStats])?old:stats);};
    update();const off=viewer.scene.preRender.addEventListener(update);viewer.scene.requestRender();return off;
  }, [ready, baseline, buildingsTranslucent, removedBuildings, hm, network?.buildingStyles, catalogs, materialRevision]);

  useEffect(() => {
    const viewer=viewerRef.current;if(!ready||!viewer)return;
    const update=()=>{
      const net=useApp.getState().network, catalog=useApp.getState().catalogs;if(!net||!catalog)return;
      const items=new Map(catalog.furniture.items.map((m)=>[m.id,m]));
      const profile=renderProfile.current,budget=profile.adaptive?32:profile.quality==='performance'?64:profile.quality==='ultra'?512:profile.quality==='high'?256:128;
      const ids=Object.values(net.assets).filter((a)=>a.state!=='removed' && items.has(a.type) && !a.type.startsWith('signal.') && !items.get(a.type)?.led).map(a=>({id:a.id,distance:Cesium.Cartesian3.distance(viewer.camera.positionWC,Cesium.Cartesian3.fromDegrees(a.at[0],a.at[1],groundAt(a.at[0],a.at[1])))})).filter(a=>a.distance<500).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id)).slice(0,budget).map(a=>a.id).sort();
      setDetailedFurniture((old)=>[...old].sort().join('|')===ids.join('|')?old:new Set(ids));
    };update();return viewer.camera.moveEnd.addEventListener(update);
  },[ready,network?.assets,catalogs,quality,adaptive]);

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
    const furn = furniturePrimitive(assets, items, materials, true, detailedFurniture);
    // Street lamps light up at night: the lamp head at the luminaire height of the catalogue item.
    const lamps: Lamp[] = assets.filter((a) => a.state !== 'removed' && a.type.startsWith('furniture.light')).map((a) => {
      const h = (items.get(a.type)?.dims.h ?? 6) * (a.scale ?? 1) * 0.95 + (a.elevationM ?? 0);
      return { lon: a.at[0], lat: a.at[1], h: groundAt(a.at[0], a.at[1]) + h };
    });
    daylight.current?.setLamps(lamps);
    layers.current.furn = furn.prim ? viewer.scene.primitives.add(furn.prim) as Cesium.PrimitiveCollection : null;
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
        let text = '', pages = [vmsCanvas('', pic, 4)];
        image = new Cesium.CallbackProperty(() => {
          const next = vmsMessage(a);
          if (next !== text) { text = next; pages = vmsPages(text).map(t => vmsCanvas(t, pic, 4)); }
          return pages[Math.floor(getProjectTime().seconds * 1000 / VMS_PAGE_MS) % pages.length]!;
        }, false);
      } else {
        const zone = network.zones[String(a.properties.zoneId ?? '')];
        const on = ledCanvas(true, 4), off = ledCanvas(false, 4);
        image = new Cesium.CallbackProperty(() => {
          const at = getProjectTime();
          return zone && zoneActiveAt(zone, at.holiday ? 6 : at.day, at.minutes) ? on : off;
        }, false);
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
          id: `led:${a.id}:${item.model.indexOf(part)}`, properties: { assetId: a.id }, position, orientation: rotation,
          plane: { plane: new Cesium.Plane(facing, 0), dimensions: new Cesium.Cartesian2(thinY ? sx : sy, sz), material: new Cesium.ImageMaterialProperty({ image }) },
        }));
      }
    }
    // Imported glTF models (SketchUp, Blender, Revit…): real geometry, Y-up glTF on the ENU frame of the anchor.
    const previousModels = new Map(layers.current.models.map(m=>[String(m.id),m]));
    const keptModels = new Set<Cesium.Model>();
    layers.current.models = [];
    let alive = true;
    for (const a of assets) {
      const item = items.get(a.type);
      if ((!a.solid && (!item || !detailedFurniture.has(a.id))) || a.state === 'removed') continue;
      rendered.add(a.id);
      const signature=JSON.stringify([a.at,a.rotationDeg,a.elevationM,a.scale,a.material,a.solid,item?.gltf,item?.scale,item?.modelOffset,item?.model,groundAt(a.at[0],a.at[1]),materialRevision]);
      const previous=previousModels.get(a.id);
      if(previous&&!previous.isDestroyed()&&modelSignatures.current.get(previous)===signature){keptModels.add(previous);previous.show=!undergroundRef.current;layers.current.models.push(previous);continue;}
      const matrix = enuMatrix(a.at[0], a.at[1], (a.elevationM ?? 0) + groundAt(a.at[0], a.at[1]), a.rotationDeg);
      Cesium.Matrix4.multiplyByUniformScale(matrix, (item?.scale ?? 1) * (a.scale ?? 1), matrix);
      if (item?.modelOffset) Cesium.Matrix4.multiplyByTranslation(matrix,new Cesium.Cartesian3(...item.modelOffset),matrix);
      void (a.solid ? solidGlb(a.solid,a.material,materials) : item!.gltf ? Promise.resolve(item!.gltf!) : furnitureGlb(item!, materials, a.material)).then((url) => Cesium.Model.fromGltfAsync({ url, modelMatrix: matrix, id: a.id, upAxis: item?.gltf ? Cesium.Axis.Y : Cesium.Axis.Z, forwardAxis: Cesium.Axis.X } as never))
        .then((model) => { if (alive && !viewer.isDestroyed()) {modelSignatures.current.set(model,signature);model.show=!undergroundRef.current;layers.current.models.push(viewer.scene.primitives.add(model) as Cesium.Model);} else model.destroy(); })
        .catch((e: unknown) => toast.error('Modello 3D non caricato', e instanceof Error ? e.message : String(e)));
    }
    for(const model of previousModels.values())if(!keptModels.has(model))viewer.scene.primitives.remove(model);
    // Signs: one pole per poleId, plates stacked from the top.
    const poles = new Map<string, Asset[]>();
    for (const a of assets) if (a.type.startsWith('it.sign.') && a.state !== 'removed') { const k = (a.properties.poleId as string) ?? a.id; (poles.get(k) ?? poles.set(k, []).get(k)!).push(a); }
    for (const list of poles.values()) {
      list.sort((x, y) => ((x.properties.stackOrder as number) ?? 0) - ((y.properties.stackOrder as number) ?? 0));
      const base = list[0]!;
      const top = SIGN_BOTTOM_M + list.length * SIGN_STEP_M - 0.05;
      layers.current.ents.push(viewer.entities.add({ properties: { assetId: base.id }, position: Cesium.Cartesian3.fromDegrees(base.at[0], base.at[1], groundAt(base.at[0], base.at[1]) + (base.elevationM ?? 0) + top / 2), cylinder: { length: top, topRadius: 0.03, bottomRadius: 0.03, material: Cesium.Color.fromCssColorString('#8d9196') } }));
      list.forEach((a, i) => {
        const sign = signs.get(a.type);
        if (!sign) return;
        rendered.add(a.id);
        const heading = Cesium.Math.toRadians(a.rotationDeg + 180);
        const pos = Cesium.Cartesian3.fromDegrees(a.at[0], a.at[1], groundAt(a.at[0], a.at[1]) + (a.elevationM ?? 0) + SIGN_BOTTOM_M + (list.length - 1 - i) * SIGN_STEP_M + (SIGN_SIZE[sign.family] ?? 0.6) / 2);
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
            id: `sign:${a.id}`, properties: { assetId: a.id }, position: pos, orientation,
            plane: { distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,1200),plane: new Cesium.Plane(Cesium.Cartesian3.UNIT_Y, 0), dimensions: dims, material: new Cesium.ImageMaterialProperty({ image: r.canvas, transparent: true }) },
          }));
          // Back of the plate: grey aluminium with the same outline, 1 cm behind.
          ents.push(viewer.entities.add({
            properties: { assetId: a.id }, position: back, orientation,
            plane: { distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,1200),plane: new Cesium.Plane(Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()), 0), dimensions: dims, material: new Cesium.ImageMaterialProperty({ image: r.canvas, transparent: true, color: Cesium.Color.fromCssColorString('#8e9398') }) },
          }));
        });
      });
    }
    // Signal assets (existing OSM signals and placed ones) and signal-plan heads with live state.
    const lampColors: Record<string, Cesium.Color> = { red: Cesium.Color.fromCssColorString('#e5483a'), yellow: Cesium.Color.fromCssColorString('#f3b52f'), green: Cesium.Color.fromCssColorString('#3fc06a'), off: Cesium.Color.fromCssColorString('#2c2e31') };
    const addHead = (at: readonly [number, number], heading: number, stateOf: () => string, ped: boolean, asset?: Asset) => {
      const properties = asset ? { assetId: asset.id } : undefined;
      const h = ped ? 2.4 : 3.0, g = groundAt(at[0], at[1]) + (asset?.elevationM ?? 0);
      layers.current.ents.push(viewer.entities.add({ properties, position: Cesium.Cartesian3.fromDegrees(at[0], at[1], g + h / 2), cylinder: { length: h, topRadius: 0.05, bottomRadius: 0.05, material: Cesium.Color.fromCssColorString('#3a3d40') } }));
      // Housing faces the approaching traffic (heading = direction of travel towards the stop line).
      const hp = Cesium.Cartesian3.fromDegrees(at[0], at[1], g + h + 0.15);
      layers.current.ents.push(viewer.entities.add({ properties, position: hp, orientation: Cesium.Transforms.headingPitchRollQuaternion(hp, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
        box: { dimensions: new Cesium.Cartesian3(0.34, 0.22, 1.0), material: Cesium.Color.fromCssColorString('#1c1d1f') } }));
      ['red', 'yellow', 'green'].forEach((c, i) => {
        layers.current.ents.push(viewer.entities.add({
          // Lamps sit on the face of the housing that looks at the drivers (local −y of the travel heading).
          properties, position: Cesium.Matrix4.multiplyByPoint(enuMatrix(at[0], at[1], g, heading), new Cesium.Cartesian3(0, -0.13, h + 0.45 - i * 0.3), new Cesium.Cartesian3()), ellipsoid: { radii: new Cesium.Cartesian3(0.11, 0.11, 0.11),
            material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => (stateOf() === c ? lampColors[c] : lampColors.off), false)) },
        }));
      });
    };
    for (const a of assets) if (a.type.startsWith('signal.') && a.state !== 'removed') { rendered.add(a.id); addHead(a.at, a.rotationDeg, () => 'off', a.type === 'signal.pedestrian', a); }
    const plans = network.signalPlans;
    for (const h of heads.current) {
      addHead(h.at, h.bearingDeg, () => {
        const plan = plans[h.planId];
        const t = getProjectTime().seconds;
        if (!plan) return 'off';
        return liveSignalAspect(plan,h.groupId,h.turn) ?? (h.groupId.startsWith('ped:') ? pedestrianState(plan, h.groupId.slice(4), t, getProjectTime()) : signalState(plan, h.groupId, t, h.turn, getProjectTime()));
      }, h.kind === 'pedestrian');
    }
    const expected = assets.filter((a) => a.state !== 'removed' && (a.solid || items.has(a.type) || signs.has(a.type))).length;
    setParity({ twin: rendered.size, map: expected });
    return () => { alive = false; };
  }, [ready, network?.assets, network?.zones, network?.signalPlans, catalogs, hm, detailedFurniture, materialRevision]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !baseline) return;
    const rig = new TwinCameraRig(viewer, baseline.origin, (lon, lat) => groundAt(lon, lat));
    return () => rig.destroy();
  }, [ready, baseline, hm]);

  useEffect(()=>{
    const viewer=viewerRef.current;if(!ready||!viewer||!network)return;
    const entities:Cesium.Entity[]=[];
    entities.push(...underpassEntities(viewer,network,hm),...gradingRetainingEntities(viewer,network,hm));
    for(const run of utilityRuns(network)){
      const positions=run.points.map(p=>Cesium.Cartesian3.fromDegrees(p.at[0],p.at[1],run.datum==='relative'?groundAt(p.at[0],p.at[1])+p.elevationM:hm?hm.toEllipsoid(p.elevationM):p.elevationM));
      const shape=Array.from({length:12},(_,i)=>new Cesium.Cartesian2(Math.cos(i*Math.PI/6)*run.diameterM/2,Math.sin(i*Math.PI/6)*run.diameterM/2));
      entities.push(viewer.entities.add({id:`utility:${run.id}`,name:run.name,polylineVolume:{positions,shape,material:Cesium.Color.fromCssColorString(UTILITY_COLORS[run.system as UtilitySystem]??'#aaaaaa'),cornerType:Cesium.CornerType.ROUNDED},properties:{utilityId:run.id}}));
    }
    for(const node of Object.values(network.utilityNodes??{})){
      const z=node.datum==='relative'?groundAt(node.at[0],node.at[1])+node.elevationM:hm?hm.toEllipsoid(node.elevationM):node.elevationM;
      entities.push(viewer.entities.add({id:`utility-node:${node.id}`,name:node.name,position:Cesium.Cartesian3.fromDegrees(node.at[0],node.at[1],z+.5),cylinder:{length:1,topRadius:(node.chamberDiameterM??.5)/2,bottomRadius:(node.chamberDiameterM??.5)/2,material:Cesium.Color.fromCssColorString(UTILITY_COLORS[node.system]).withAlpha(.6)},properties:{utilityNodeId:node.id}}));
    }
    viewer.scene.requestRender();return()=>{if(!viewer.isDestroyed())for(const entity of entities)viewer.entities.remove(entity);};
  },[ready,network?.roads,network?.utilityNodes,network?.utilityLinks,network?.drainageNodes,network?.drainagePipes,network?.waterNodes,network?.waterPipes,hm]);
  useEffect(()=>{
    const viewer=viewerRef.current;if(!ready||!viewer)return;
    viewer.scene.globe.show=!underground;
    if(viewer.scene.skyAtmosphere)viewer.scene.skyAtmosphere.show=!underground;
    if(viewer.scene.skyBox)viewer.scene.skyBox.show=!underground;
    viewer.scene.fog.enabled=!underground;
    viewer.scene.backgroundColor=Cesium.Color.fromCssColorString('#171c22');
    for(const p of layers.current.phys)p.show=!underground;
    if(layers.current.bld)layers.current.bld.show=!underground;
    if(layers.current.furn)layers.current.furn.show=!underground;
    for(const entity of layers.current.ents)entity.show=!underground;
    for(const model of layers.current.models)model.show=!underground;
    viewer.scene.requestRender();
  },[ready,underground,network,materialRevision,detailedFurniture]);

  useEffect(()=>{
    const viewer=viewerRef.current;if(!ready||!viewer)return;const entities:Cesium.Entity[]=[];
    for(const phase of network?.works??[])if(phase.affectedArea&&worksStage(phase,projectTime.date)==='construction'){
      const positions=phase.affectedArea.map(p=>Cesium.Cartesian3.fromDegrees(p[0],p[1],groundAt(p[0],p[1])+.08));
      entities.push(viewer.entities.add({id:`works:${phase.id}`,name:phase.name,polygon:{hierarchy:new Cesium.PolygonHierarchy(positions),perPositionHeight:true,material:Cesium.Color.fromCssColorString('#e8772e').withAlpha(.22),outline:true,outlineColor:Cesium.Color.fromCssColorString('#e8772e')}}));
    }
    viewer.scene.requestRender();return()=>{if(!viewer.isDestroyed())for(const e of entities)viewer.entities.remove(e);};
  },[ready,network?.works,projectTime.date,hm]);

  // Drag previews are transient render transforms. Only pointer release commits to the project history.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !baseline || !catalogs) return;
    const items = new Map(catalogs.furniture.items.map((item) => [item.id, item]));
    const materials = new Map(catalogs.materials.items.map((item) => [item.id, item]));
    let previewPrimitive: Cesium.PrimitiveCollection | null = null;
    const originals = new Map<string, Asset>();
    const entities = new Map<Cesium.Entity, { position: Cesium.PositionProperty | undefined; orientation: Cesium.Property | undefined }>();
    const models = new Map<Cesium.Model, Cesium.Matrix4>();
    const hidden: { primitive: Cesium.Primitive; id: string }[] = [];
    const preview = (assets: Asset[] | null) => {
      if (viewer.isDestroyed()) return;
      if (previewPrimitive) { viewer.scene.primitives.remove(previewPrimitive); previewPrimitive = null; }
      if (!assets) {
        for (const [entity, original] of entities) { entity.position = original.position; entity.orientation = original.orientation; }
        for (const [model, matrix] of models) if (!model.isDestroyed()) model.modelMatrix = matrix;
        for (const { primitive, id } of hidden) if (!primitive.isDestroyed() && primitive.ready) primitive.getGeometryInstanceAttributes(id).show = Cesium.ShowGeometryInstanceAttribute.toValue(true);
        originals.clear(); entities.clear(); models.clear(); hidden.length = 0;
        viewer.scene.requestRender(); return;
      }
      if (!originals.size) for (const asset of assets) {
        const original = useApp.getState().network?.assets[asset.id];
        if (!original) continue;
        originals.set(asset.id, original);
        const collection = layers.current.furn, item = items.get(asset.type);
        if (collection && item && !asset.type.startsWith('signal.')) for(let i=0;i<collection.length;i++){const primitive=collection.get(i) as Cesium.Primitive;if(!primitive.ready)continue;item.model.forEach((_, index) => {
          const id = `${asset.id}::part:${index}`, attributes = primitive.getGeometryInstanceAttributes(id);
          if (attributes?.show) { attributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(false); hidden.push({ primitive, id }); }
        });}
      }
      const rendered = furniturePrimitive(assets, items, materials, false, new Set(layers.current.models.map((m) => String(m.id))));
      if (rendered.prim) previewPrimitive = viewer.scene.primitives.add(rendered.prim) as Cesium.PrimitiveCollection;
      for (const asset of assets) {
        const original = originals.get(asset.id);
        if (!original) continue;
        const oldBase = enuMatrix(original.at[0], original.at[1], groundAt(original.at[0], original.at[1]) + (original.elevationM ?? 0), original.rotationDeg);
        const newBase = enuMatrix(asset.at[0], asset.at[1], groundAt(asset.at[0], asset.at[1]) + (asset.elevationM ?? 0), asset.rotationDeg);
        const delta = Cesium.Matrix4.multiply(newBase, Cesium.Matrix4.inverseTransformation(oldBase, new Cesium.Matrix4()), new Cesium.Matrix4());
        for (const entity of layers.current.ents) {
          if (entity.properties?.assetId?.getValue() !== asset.id || !entity.position) continue;
          if (!entities.has(entity)) entities.set(entity, { position: entity.position, orientation: entity.orientation });
          const saved = entities.get(entity)!, position = saved.position?.getValue(viewer.clock.currentTime);
          if (position) entity.position = new Cesium.ConstantPositionProperty(Cesium.Matrix4.multiplyByPoint(delta, position, new Cesium.Cartesian3()));
          const rotation = saved.orientation?.getValue(viewer.clock.currentTime) as Cesium.Quaternion | undefined;
          if (rotation) entity.orientation = new Cesium.ConstantProperty(Cesium.Quaternion.multiply(Cesium.Quaternion.fromRotationMatrix(Cesium.Matrix4.getMatrix3(delta, new Cesium.Matrix3())), rotation, new Cesium.Quaternion()));
        }
        for (const model of layers.current.models) if (model.id === asset.id) {
          if (!models.has(model)) models.set(model, Cesium.Matrix4.clone(model.modelMatrix));
          model.modelMatrix = Cesium.Matrix4.multiply(delta, models.get(model)!, new Cesium.Matrix4());
        }
      }
      viewer.scene.requestRender();
    };
    const gizmo = new TwinGizmo(viewer, baseline.origin, (lon, lat) => groundAt(lon, lat), preview);
    return () => { gizmo.destroy(); preview(null); };
  }, [ready, baseline, catalogs, hm]);

  // Bounded near-field models and pooled GPU points; simulation scale is independent.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    const live = new Map<number, { model: Cesium.Model | null; seen: number; from: Cesium.Matrix4; to: Cesium.Matrix4; at: number }>();
    const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection;
    let tick = 0, alive = true;
    let statsAt = 0, renderAt = performance.now(), renderFrames = 0, renderFps = 0;
    const removeRenderMeter = viewer.scene.postRender.addEventListener(() => {
      renderFrames++;
      const now = performance.now();
      if (now - renderAt >= 1000) { renderFps = renderFrames * 1000 / (now - renderAt); renderFrames = 0; renderAt = now; }
    });
    let interpolateRaf = 0;
    const interpolate = (now: number) => {
      if (!alive || viewer.isDestroyed()) return;
      let changed = false;
      for (const entry of live.values()) {
        if (!entry.model || entry.model.isDestroyed()) continue;
        const k = Math.min(1, (now - entry.at) / 100);
        if (k >= 1) { if (!Cesium.Matrix4.equals(entry.model.modelMatrix, entry.to)) { entry.model.modelMatrix = entry.to; changed = true; } continue; }
        const from = Cesium.Matrix4.getTranslation(entry.from, new Cesium.Cartesian3()), to = Cesium.Matrix4.getTranslation(entry.to, new Cesium.Cartesian3());
        const qa = Cesium.Quaternion.fromRotationMatrix(Cesium.Matrix4.getMatrix3(entry.from, new Cesium.Matrix3())), qb = Cesium.Quaternion.fromRotationMatrix(Cesium.Matrix4.getMatrix3(entry.to, new Cesium.Matrix3()));
        entry.model.modelMatrix = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromQuaternion(Cesium.Quaternion.slerp(qa, qb, k, new Cesium.Quaternion())), Cesium.Cartesian3.lerp(from, to, k, new Cesium.Cartesian3())); changed = true;
      }
      if (changed) viewer.scene.requestRender();
      interpolateRaf = requestAnimationFrame(interpolate);
    };
    interpolateRaf = requestAnimationFrame(interpolate);
    const pedestrians = createPedestrianRenderer(viewer, groundAt);
    const pool: Cesium.PointPrimitive[] = [];
    let routeKey = '';
    const routeEntity = viewer.entities.add({ show: false, polyline: { positions: [], width: 4, material: Cesium.Color.CORNFLOWERBLUE, clampToGround: false } });
    const offRoute = useTwinUi.subscribe((state) => { routeEntity.show = state.showRoute && Boolean(state.telemetry); viewer.scene.requestRender(); });
    const off = engine.onSim((f) => {
      if (!alive || viewer.isDestroyed()) return;
      sim.current = f; tick++;
      pedestrians.update(f?.pedestrians, f?.metrics.t ?? 0);
      useTwinUi.setState((state) => ({ telemetry: f?.tracked ?? null, following: state.telemetry && !f?.tracked ? false : state.following }));
      let pointCount = 0, detailed = 0;
      const d = f?.data ?? new Float32Array();
      let availableBus: number | null = null;
      for (let i = 0; i < d.length; i += SIM_STRIDE) if (d[i + 3] === 3 || d[i + 3] === 5) { availableBus = d[i + 5]!; break; }
      setBusId((old) => old === availableBus ? old : availableBus);
      const route = f?.tracked?.route;
      const nextKey = route?.length ? `${f!.tracked!.id}:${route.length}:${route[0]!.join(',')}` : '';
      if (nextKey !== routeKey) {
        routeKey = nextKey;
        if (routeEntity.polyline) routeEntity.polyline.positions = new Cesium.ConstantProperty(route?.map((at) => Cesium.Cartesian3.fromDegrees(at[0], at[1], groundAt(at[0], at[1]) + .15)) ?? []);
      }
      routeEntity.show = Boolean(route?.length) && useTwinUi.getState().showRoute;
      for (let i = 0; i < d.length; i += SIM_STRIDE) {
        const id = d[i + 5]!, cls = VEHICLE_CLASSES[d[i + 3]!] ?? 'car';
        const lon = d[i]!, lat = d[i + 1]!;
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, groundAt(lon, lat) + 0.8);
        const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, position);
        if (distance > 8000) continue;
        if (distance < 300 && detailed < (renderProfile.current.adaptive ? 24 : 96)) {
          detailed++;
          const matrix = enuMatrix(lon, lat, groundAt(lon, lat) + 0.02, d[i + 2]!);
          const cur = live.get(id);
          if (cur) { cur.seen = tick; cur.from = Cesium.Matrix4.clone(cur.model?.modelMatrix ?? cur.to); cur.to = matrix; cur.at = performance.now(); continue; }
          const entry = { model: null as Cesium.Model | null, seen: tick, from: matrix, to: matrix, at: performance.now() }; live.set(id, entry);
          void Cesium.Model.fromGltfAsync({ url: vehicleGlbUrl(cls, paintIndex(cls, id)), id: { vehicleId: id }, modelMatrix: matrix, upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X } as never).then((model) => {
            if (!alive || viewer.isDestroyed() || live.get(id) !== entry) { model.destroy(); return; }
            entry.model = viewer.scene.primitives.add(model) as Cesium.Model;
          }).catch(() => { if (live.get(id) === entry) live.delete(id); });
        } else if (pointCount < 4000) {
          const point = pool[pointCount] ?? points.add({ pixelSize: 5, color: Cesium.Color.CORNFLOWERBLUE });
          if (!pool[pointCount]) pool.push(point);
          point.position = position; point.show = true; point.id = { vehicleId: id };
          pointCount++;
        }
      }
      for (let i = pointCount; i < pool.length; i++) pool[i]!.show = false;
      for (const [id, v] of live) if (v.seen !== tick) { if (v.model) viewer.scene.primitives.remove(v.model); live.delete(id); }
      const now = performance.now();
      if (!f || now - statsAt >= 500) {
        setFlowStats(f ? { vehicles: f.metrics.vehicles, drawn: pointCount + [...live.values()].filter((v) => v.model !== null).length, t: f.metrics.t, fps: renderFps } : null);
        statsAt = now;
      }
      viewer.scene.requestRender();
    });
    const view = () => {
      if (!alive || viewer.isDestroyed()) return;
      const r = viewer.camera.computeViewRectangle();
      engine.simView({ budget: 4096, ...(r ? { bounds: [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)] as [number, number, number, number] } : {}) });
      if (r && engine.lastSimOptions?.mode === 'hybrid') engine.simFocus([Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)]);
    };
    view(); const removeCamera = viewer.camera.moveEnd.addEventListener(view);
    return () => {
      alive = false; cancelAnimationFrame(interpolateRaf); off(); removeCamera(); removeRenderMeter(); offRoute();
      if (!viewer.isDestroyed()) viewer.entities.remove(routeEntity);
      if (!viewer.isDestroyed()) { for (const v of live.values()) if (v.model) viewer.scene.primitives.remove(v.model); viewer.scene.primitives.remove(points); }
      pedestrians.destroy();
      live.clear();
    };
  }, [ready]);

  const preset = (p: Preset) => {
    const viewer = viewerRef.current;
    if (!viewer || !baseline || !network) return;
    const node = selection?.kind === 'node' ? network.nodes[selection.ids[0]!]?.at
      : selection?.kind === 'roundabout' ? network.roundabouts[selection.ids[0]!]?.center
      : selection?.kind === 'asset' ? network.assets[selection.ids[0]!]?.at : null;
    const c = node ?? baseline.origin;
    const profiles: Record<Preset, { range: number; pitch: number }> = {
      top: { range: 500, pitch: -90 }, perspective: { range: 160, pitch: -35 }, street: { range: 14, pitch: -6 },
      junction: { range: 95, pitch: -45 }, district: { range: 1400, pitch: -45 },
    };
    const view = profiles[p];
    setPresetName(p); useTwinUi.setState({ cameraMode: 'orbit', following: false });
    const target = Cesium.Cartesian3.fromDegrees(c[0], c[1], groundAt(c[0], c[1]) + (p === 'street' ? 1.2 : 0));
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(view.pitch), view.range));
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); viewer.scene.requestRender();
  };

  if(fatal)throw fatal;
  return (
    <div className="twin">
      <div className="twin-canvas" ref={el} />
      <TwinInspector />
      <TwinVehiclePanel />
      <div className="twin-toolbar">
        <Segmented<string> label="Modalità camera" size="sm" value={cameraMode} onChange={(v) => useTwinUi.setState({ cameraMode: v as CameraMode, following: false })} options={[{ value: 'orbit', label: 'Orbita' }, { value: 'fly', label: 'Volo libero' }, { value: 'walk', label: 'Cammina' }, { value: 'cinematic', label: 'Cinematica' }]} />
        {busId !== null ? <Button size="sm" icon="camera" onClick={() => { pickTwinVehicle(busId); useTwinUi.setState({ following: true }); }}>Segui mezzo TPL</Button> : null}
        <Toggle label="Modifica oggetti 3D" checked={editing} onChange={(v) => useTwinUi.setState({ editing: v })} />
        {cameraMode === 'fly' || cameraMode === 'walk' ? <span className="muted">WASD / frecce · tasto destro per guardare{cameraMode === 'fly' ? ' · Q/E quota' : ' · quota occhio 1,70 m'}</span> : null}
        <Segmented<Preset> label="Inquadratura" size="sm" value={presetName} onChange={preset}
          options={[{ value: 'top', label: 'Dall\'alto' }, { value: 'perspective', label: 'Prospettiva' }, { value: 'street', label: 'Strada' }, { value: 'junction', label: 'Incrocio' }, { value: 'district', label: 'Quartiere' }]} />
        <Toggle label="Isola sottoservizi" checked={underground} onChange={setUnderground}/><Toggle label="Edifici trasparenti" checked={buildingsTranslucent} onChange={setBT} />
        <Segmented<string> label="Qualità Twin" size="sm" value={quality} onChange={setQuality} options={[{ value: 'performance', label: 'Performance' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Cinematic' }]} />
        <div className="twin-day" role="group" aria-label="Ora del giorno">
          <Segmented<string> label="Momento della giornata" size="sm" value={dayPresets.find((p) => Math.abs(p.hour - day.hour) < 0.01)?.value ?? ''}
            options={dayPresets} onChange={(v) => { setPlaying(false); setDay((d) => ({ ...d, hour: dayPresets.find((p) => p.value === v)!.hour })); }} />
          <output className="mono">{fmtHour(day.hour)} · clock globale</output>
        </div>
        <Select value={network?.environment?.weather ?? 'clear'} ariaLabel="Meteo simulato" options={[{value:'clear',label:'Sereno · simulato'},{value:'cloudy',label:'Nuvoloso · simulato'},{value:'overcast',label:'Coperto · simulato'},{value:'rain',label:'Pioggia · simulata'},{value:'fog',label:'Nebbia · simulata'}]} onChange={(weather)=>commit('environment.set',{weather:weather as WeatherPreset,intensity:1,weatherSource:'simulated'})} />
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
      {ready&&viewerRef.current?<CinematicPanel viewer={viewerRef.current} ground={groundAt}/>:null}
      {flowStats ? <div className="twin-flow" aria-label="Diagnostica simulazione Twin">
        <strong>DRIP Flow · {engine.lastSimOptions?.mode === 'hybrid' ? 'ibrido' : 'microscopico'}</strong>
        <span>Simulati <b>{flowStats.vehicles.toLocaleString('it-IT')}</b> · disegnati <b>{flowStats.drawn.toLocaleString('it-IT')}</b></span>
        <span>{engine.simPaused ? 'In pausa' : `${Math.round(flowStats.fps)} FPS scena`} · {engine.simPerformance.solverHz.toFixed(1)} Hz fisica · {Math.round(engine.simPerformance.tickMs)} ms worker</span>
        <span>Tempo {flowStats.t} s · {engine.lastSimOptions?.scopeName ?? 'Intero comune'}</span>
      </div> : null}
      <div className="twin-status">
        <span>{status}</span>
        <span>Arredi: {detailedFurniture.size} dettagli vicini · altri in batch; modelli importati lontani = ingombro</span>
        {buildingStats&&<span>LOD edifici: {buildingStats.near} vicini · {buildingStats.medium} medi · {buildingStats.far} lontani · {buildingStats.hidden} fuori distanza</span>}
        {adaptive ? <span>Carico grafico ridotto automaticamente · simulazione invariata</span> : null}
        {sunElev !== null ? <span>{sunElev < -4 ? 'Notte · luce lunare, lampioni accesi' : sunElev < 6 ? `Sole basso (${Math.round(sunElev)}°)` : `Sole a ${Math.round(sunElev)}°${quality !== 'performance' && !adaptive ? ' · ombre' : ''}`}</span> : null}
        {parity ? <span className={parity.twin === parity.map ? 'ok' : 'warn-line'}>Parità 2D/3D: {parity.twin}/{parity.map} oggetti</span> : null}
      </div>
    </div>
  );
}

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

export default TwinView;
