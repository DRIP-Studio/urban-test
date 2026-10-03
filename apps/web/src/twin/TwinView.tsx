import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { VEHICLE_SPECS, pedestrianState, signalState, type Asset, type SignalHead, type SimFrame } from '@drip-urban/core';
import type { FurnitureItem, MaterialItem } from '../api/types';
import { engine } from '../engine/engine';
import type { PhysicalPayload } from '../engine/protocol';
import { useApp } from '../state/store';
import { toast } from '../state/toasts';
import { saveTwinKeyframe, takePendingTwinCamera } from './pending';
import { Button, Segmented, Toggle } from '../ui/controls';

type Preset = 'top' | 'perspective' | 'street' | 'junction' | 'district';

const colorOf = (materials: Map<string, MaterialItem>, id: string, fallback = '#888888') => {
  const m = materials.get(id);
  return Cesium.Color.fromCssColorString(m?.color ?? fallback).withAlpha(m?.opacity ?? 1);
};

function enuMatrix(lon: number, lat: number, h: number, headingDeg: number): Cesium.Matrix4 {
  const pos = Cesium.Cartesian3.fromDegrees(lon, lat, h);
  return Cesium.Transforms.headingPitchRollToFixedFrame(pos, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0));
}

/** Surfaces and markings: one batched primitive each, heights from the physical model (same data as the 2D map). */
function physicalPrimitives(p: PhysicalPayload, materials: Map<string, MaterialItem>): Cesium.Primitive[] {
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
    geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray((f.geometry.coordinates[0] as number[][]).slice(0, -1).flat())), height: 0.045, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#f2f1ec')) },
  }));
  const app = () => new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false });
  return [
    new Cesium.Primitive({ geometryInstances: surf, appearance: app(), asynchronous: true, releaseGeometryInstances: true }),
    ...(marks.length ? [new Cesium.Primitive({ geometryInstances: marks, appearance: app(), asynchronous: true, releaseGeometryInstances: true })] : []),
  ];
}

function buildingsPrimitive(buildings: { footprint: readonly (readonly [number, number])[]; heightM: number; minHeightM: number }[], translucent: boolean): Cesium.Primitive {
  return new Cesium.Primitive({
    geometryInstances: buildings.map((b) => new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(b.footprint.flatMap((p) => [p[0], p[1]]))), height: b.minHeightM, extrudedHeight: b.heightM, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#d9d4ca').withAlpha(translucent ? 0.55 : 1)) },
    })),
    appearance: new Cesium.PerInstanceColorAppearance({ translucent }), asynchronous: true, releaseGeometryInstances: true,
  });
}

/** Furniture from the catalogue's procedural parts — the same item ids the 2D map draws at real size. */
function furniturePrimitive(assets: Asset[], items: Map<string, FurnitureItem>, materials: Map<string, MaterialItem>): { prim: Cesium.Primitive | null; ids: Set<string> } {
  const inst: Cesium.GeometryInstance[] = [];
  const ids = new Set<string>();
  for (const a of assets) {
    const item = items.get(a.type);
    if (!item || a.type.startsWith('signal.') || a.state === 'removed' || item.gltf) continue;
    ids.add(a.id);
    const base = enuMatrix(a.at[0], a.at[1], a.elevationM ?? 0, a.rotationDeg);
    for (const part of item.model) {
      let geometry: Cesium.Geometry | Cesium.GeometryFactory;
      let lift = 0;
      if (part.shape === 'box') { geometry = Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(...part.size!), vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }); lift = part.size![2] / 2; }
      else if (part.shape === 'cylinder') { geometry = new Cesium.CylinderGeometry({ length: part.h!, topRadius: part.r!, bottomRadius: part.r!, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }); lift = part.h! / 2; }
      else if (part.shape === 'cone') { geometry = new Cesium.CylinderGeometry({ length: part.h!, topRadius: 0, bottomRadius: part.r!, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }); lift = part.h! / 2; }
      else { geometry = new Cesium.EllipsoidGeometry({ radii: new Cesium.Cartesian3(part.r!, part.r!, part.r! * 0.9), vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }); }
      const local = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(part.at[0], part.at[1], part.at[2] + lift));
      inst.push(new Cesium.GeometryInstance({ id: a.id, geometry, modelMatrix: Cesium.Matrix4.multiply(base, local, new Cesium.Matrix4()), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorOf(materials, part.mat === 'foliage' && a.material ? a.material : part.mat)) } }));
    }
  }
  return { prim: inst.length ? new Cesium.Primitive({ geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ translucent: false }), asynchronous: true }) : null, ids };
}

export function TwinView() {
  const el = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const baseline = useApp((s) => s.baseline);
  const network = useApp((s) => s.network);
  const catalogs = useApp((s) => s.catalogs);
  const selection = useApp((s) => s.selection);
  const [ready, setReady] = useState(false);
  const [buildingsTranslucent, setBT] = useState(false);
  const [parity, setParity] = useState<{ twin: number; map: number } | null>(null);
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
      const [w, s, e, n] = baseline.bbox;
      const pend = takePendingTwinCamera();
      if (pend) viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(pend.lon, pend.lat, pend.height), orientation: { heading: Cesium.Math.toRadians(pend.heading), pitch: Cesium.Math.toRadians(pend.pitch), roll: 0 } });
      else viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees((w + e) / 2, s - 0.012, 1400), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 } });
      setStatus('Terreno ellissoidico · immagini Esri');
      setReady(true);
    })().catch((err) => toast.error('Twin 3D', err instanceof Error ? err.message : String(err)));
    return () => { destroyed = true; viewerRef.current?.destroy(); viewerRef.current = null; };
  }, [baseline]);

  // Physical model (same payload as the 2D map)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !catalogs) return;
    const materials = new Map(catalogs.materials.items.map((m) => [m.id, m]));
    const apply = (p: PhysicalPayload) => {
      for (const prim of layers.current.phys) viewer.scene.primitives.remove(prim);
      layers.current.phys = physicalPrimitives(p, materials).map((prim) => viewer.scene.primitives.add(prim) as Cesium.Primitive);
      heads.current = p.heads;
    };
    if (engine.lastPhysical) apply(engine.lastPhysical);
    const off = engine.onPhysical(() => apply(engine.lastPhysical!));
    return off;
  }, [ready, catalogs]);

  // Buildings
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !baseline) return;
    if (layers.current.bld) viewer.scene.primitives.remove(layers.current.bld);
    layers.current.bld = viewer.scene.primitives.add(buildingsPrimitive(Object.values(baseline.buildings), buildingsTranslucent)) as Cesium.Primitive;
  }, [ready, baseline, buildingsTranslucent]);

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
    layers.current.furn = furn.prim ? viewer.scene.primitives.add(furn.prim) as Cesium.Primitive : null;
    const rendered = new Set(furn.ids);
    // Imported glTF models (SketchUp, Blender, Revit…): real geometry, Y-up glTF on the ENU frame of the anchor.
    for (const m of layers.current.models) viewer.scene.primitives.remove(m);
    layers.current.models = [];
    let alive = true;
    for (const a of assets) {
      const item = items.get(a.type);
      if (!item?.gltf || a.state === 'removed') continue;
      rendered.add(a.id);
      const matrix = enuMatrix(a.at[0], a.at[1], a.elevationM ?? 0, a.rotationDeg);
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
      layers.current.ents.push(viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(base.at[0], base.at[1], top / 2), cylinder: { length: top, topRadius: 0.03, bottomRadius: 0.03, material: Cesium.Color.fromCssColorString('#8d9196') } }));
      list.forEach((a, i) => {
        const sign = signs.get(a.type);
        if (!sign) return;
        rendered.add(a.id);
        const heading = Cesium.Math.toRadians(a.rotationDeg + 180);
        const pos = Cesium.Cartesian3.fromDegrees(a.at[0], a.at[1], top - 0.45 - i * 0.95);
        layers.current.ents.push(viewer.entities.add({
          id: `sign:${a.id}`, position: pos,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(heading, 0, 0)),
          plane: { plane: new Cesium.Plane(Cesium.Cartesian3.UNIT_Y, 0), dimensions: new Cesium.Cartesian2(0.9, 0.9), material: new Cesium.ImageMaterialProperty({ image: `/signs/${encodeURIComponent(sign.file)}`, transparent: true }) },
        }));
      });
    }
    // Signal assets (existing OSM signals and placed ones) and signal-plan heads with live state.
    const lampColors: Record<string, Cesium.Color> = { red: Cesium.Color.fromCssColorString('#e5483a'), yellow: Cesium.Color.fromCssColorString('#f3b52f'), green: Cesium.Color.fromCssColorString('#3fc06a'), off: Cesium.Color.fromCssColorString('#2c2e31') };
    const addHead = (at: readonly [number, number], heading: number, stateOf: () => string, ped: boolean) => {
      const h = ped ? 2.4 : 3.0;
      layers.current.ents.push(viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(at[0], at[1], h / 2), cylinder: { length: h, topRadius: 0.05, bottomRadius: 0.05, material: Cesium.Color.fromCssColorString('#3a3d40') } }));
      // Housing faces the approaching traffic (heading = direction of travel towards the stop line).
      const hp = Cesium.Cartesian3.fromDegrees(at[0], at[1], h + 0.15);
      layers.current.ents.push(viewer.entities.add({ position: hp, orientation: Cesium.Transforms.headingPitchRollQuaternion(hp, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
        box: { dimensions: new Cesium.Cartesian3(0.34, 0.22, 1.0), material: Cesium.Color.fromCssColorString('#1c1d1f') } }));
      ['red', 'yellow', 'green'].forEach((c, i) => {
        layers.current.ents.push(viewer.entities.add({
          // Lamps sit on the face of the housing that looks at the drivers (local −y of the travel heading).
          position: Cesium.Matrix4.multiplyByPoint(enuMatrix(at[0], at[1], 0, heading), new Cesium.Cartesian3(0, -0.13, h + 0.45 - i * 0.3), new Cesium.Cartesian3()), ellipsoid: { radii: new Cesium.Cartesian3(0.11, 0.11, 0.11),
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
  }, [ready, network, catalogs]);

  // Simulated vehicles: pooled entities updated from the simulation frames.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    const pool: Cesium.Entity[] = [];
    const classes = ['car', 'van', 'truck', 'bus', 'emergency'] as const;
    const colors = ['#f4f3ef', '#d9d4c8', '#e8772e', '#5587a2', '#d0614f'].map((c) => Cesium.Color.fromCssColorString(c));
    const off = engine.onSim((f) => {
      sim.current = f;
      const n = f ? f.data.length / 5 : 0;
      while (pool.length < n) pool.push(viewer.entities.add({ box: { dimensions: new Cesium.Cartesian3(1.8, 4.5, 1.5), material: colors[0]! } }));
      pool.forEach((e, i) => {
        e.show = i < n;
        if (i >= n || !f) return;
        const d = f.data;
        const cls = classes[d[i * 5 + 3]!] ?? 'car';
        const spec = VEHICLE_SPECS[cls];
        const pos = Cesium.Cartesian3.fromDegrees(d[i * 5]!, d[i * 5 + 1]!, cls === 'bus' || cls === 'truck' ? 1.6 : 0.8);
        e.position = new Cesium.ConstantPositionProperty(pos);
        e.orientation = new Cesium.ConstantProperty(Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(d[i * 5 + 2]! - 90), 0, 0)));
        e.box!.dimensions = new Cesium.ConstantProperty(new Cesium.Cartesian3(spec.length, spec.width, cls === 'bus' || cls === 'truck' ? 3.2 : 1.5));
        e.box!.material = new Cesium.ColorMaterialProperty(colors[d[i * 5 + 3]!] ?? colors[0]!);
      });
    });
    return () => { off(); for (const e of pool) viewer.entities.remove(e); };
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
        {parity ? <span className={parity.twin === parity.map ? 'ok' : 'warn-line'}>Parità 2D/3D: {parity.twin}/{parity.map} oggetti</span> : null}
      </div>
    </div>
  );
}

export default TwinView;
