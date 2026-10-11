import * as C from 'cesium';
import type { PedestrianSnapshot } from '@drip-urban/core';
import { pedestrianGlbUrl } from '../models/pedestrianGlb';

/** Small procedural walking silhouettes: one shared sprite per gait phase, no per-agent model allocation. */
function sprite(phase: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#dab28b'; ctx.beginPath(); ctx.arc(16, 8, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5587a2'; ctx.lineWidth = 10; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(16, 20); ctx.lineTo(16, 37); ctx.stroke();
  const swing = [0, 6, 0, -6][phase]!;
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(13, 22); ctx.lineTo(7, 34 + swing); ctx.moveTo(19, 22); ctx.lineTo(25, 34 - swing); ctx.stroke();
  ctx.strokeStyle = '#353940'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(13, 38); ctx.lineTo(11 + swing, 59); ctx.moveTo(19, 38); ctx.lineTo(21 - swing, 59); ctx.stroke();
  return canvas;
}
export function createPedestrianRenderer(viewer: C.Viewer, ground: (lon: number, lat: number) => number) {
  const sprites = [0, 1, 2, 3].map(phase => sprite(phase).toDataURL());
  let collection: C.BillboardCollection | undefined;
  const pool: C.Billboard[] = [];
  const models: { model?: C.Model; pending?: boolean; matrix: C.Matrix4; id: number; visible: boolean; angle: number }[] = [];
  let alive = true;
  let lastSnapshot: PedestrianSnapshot | undefined, lastSeconds = 0;
  const pivot = (z: number, angle: number) => {
    const rotation = C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationY(angle));
    return C.Matrix4.multiply(C.Matrix4.fromTranslation(new C.Cartesian3(0,0,z)), C.Matrix4.multiply(rotation, C.Matrix4.fromTranslation(new C.Cartesian3(0,0,-z)), new C.Matrix4()), new C.Matrix4());
  };
  function updateModel(slot: typeof models[number]) {
    if (!slot.model) return;
    slot.model.show = slot.visible;
    slot.model.id = {kind:'pedestrian', id:slot.id};
    slot.model.modelMatrix = slot.matrix;
    if (slot.model.ready) for (const side of [-1,1]) {
      slot.model.getNode(`arm${side}`).matrix = pivot(1.4, side * slot.angle);
      slot.model.getNode(`leg${side}`).matrix = pivot(.9, -side * slot.angle);
      slot.model.getNode(`shoe${side}`).matrix = pivot(.9, -side * slot.angle);
    }
  }
  const renderer = {
    update(snapshot: PedestrianSnapshot | undefined, seconds: number) {
      lastSnapshot = snapshot; lastSeconds = seconds;
      const data = snapshot?.data, count = Math.min(500, (data?.length ?? 0) / 5);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let detailed = 0;
      for (let i = 0; i < count; i++) {
        const lon = data![i * 5]!, lat = data![i * 5 + 1]!, id = data![i * 5 + 3]!;
        const phase = data![i * 5 + 4] || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.floor(seconds * 5 + id) % 4;
        let billboard = pool[i];
        if (!billboard) { collection ??= viewer.scene.primitives.add(new C.BillboardCollection()) as C.BillboardCollection; billboard = collection.add({ position: C.Cartesian3.fromDegrees(lon, lat, ground(lon, lat) + 1.1), width: .85, height: 1.7, sizeInMeters: true, verticalOrigin: C.VerticalOrigin.CENTER, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 1400) }); pool.push(billboard); }
        billboard.id = {kind:'pedestrian',id};
        billboard.position = C.Cartesian3.fromDegrees(lon, lat, ground(lon, lat) + 1.1); billboard.image = sprites[phase]!; billboard.show = true;
        if (detailed < 32 && C.Cartesian3.distance(viewer.camera.positionWC, billboard.position) < 160) {
          const position = C.Cartesian3.fromDegrees(lon,lat,ground(lon,lat)+.04);
          const matrix = C.Matrix4.multiply(C.Transforms.eastNorthUpToFixedFrame(position), C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationZ(C.Math.toRadians(90-data![i*5+2]!))), new C.Matrix4());
          const slot = models[detailed] ?? { matrix, id, visible:true, angle:0 };
          models[detailed++] = slot;
          Object.assign(slot, {matrix,id,visible:true,angle: data![i*5+4] || reduce ? 0 : Math.sin(seconds*7+id)*.28});
          if (!slot.model && !slot.pending) {
            slot.pending = true;
            void C.Model.fromGltfAsync({url:pedestrianGlbUrl(),modelMatrix:matrix,upAxis:C.Axis.Z,forwardAxis:C.Axis.X} as never).then(model => {
              if (!alive || viewer.isDestroyed()) { model.destroy(); return; }
              slot.model = viewer.scene.primitives.add(model); updateModel(slot);
              if (!model.ready) { const offReady = model.readyEvent.addEventListener(() => { offReady(); if (alive) renderer.update(lastSnapshot,lastSeconds); }); }
              viewer.scene.requestRender();
            }).catch(() => { /* Preserve the visible silhouette when a graphics driver cannot load the model. */ });
          }
          updateModel(slot);
          if (slot.model?.ready) billboard.show = false;
        }
      }
      for (let i=detailed;i<models.length;i++) { models[i]!.visible=false; updateModel(models[i]!); }
      for (let i = count; i < pool.length; i++) pool[i]!.show = false;
      if (count) viewer.scene.requestRender();
    },
    destroy() { alive=false; offCamera(); if (!viewer.isDestroyed()) { if (collection) viewer.scene.primitives.remove(collection); for(const slot of models) if(slot.model) viewer.scene.primitives.remove(slot.model); } },
  };
  const offCamera = viewer.camera.changed.addEventListener(() => renderer.update(lastSnapshot, lastSeconds));
  return renderer;
}
