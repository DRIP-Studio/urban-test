import * as Cesium from 'cesium';
import { LocalFrame, type Asset, type LngLat } from '@drip-urban/core';
import { select, useApp } from '../state/store';
import { applyTwinTransform, selectedTwinAssets, transformedAssets, type TransformAxis } from './editing';
import { pickTwinVehicle, useTwinUi } from './viewState';

interface Drag { axis: TransformAxis; start: Cesium.Cartesian2; center: Cesium.Cartesian2; direction: Cesium.Cartesian2; pixelsPerM: number; assets: Asset[]; next: Asset[] }
export class TwinGizmo {
  private handler: Cesium.ScreenSpaceEventHandler;
  private entities: Cesium.Entity[] = [];
  private drag: Drag | null = null;
  private off: (() => void)[] = [];
  private alt = false;
  private raf = 0;
  private ignoreClickUntil = 0;
  constructor(private viewer: Cesium.Viewer, private origin: LngLat, private ground: (lon: number, lat: number) => number, private preview: (assets: Asset[] | null) => void) {
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    this.handler.setInputAction((event: { position: Cesium.Cartesian2 }) => this.pick(event.position, false), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    for (const modifier of [Cesium.KeyboardEventModifier.CTRL, Cesium.KeyboardEventModifier.SHIFT]) this.handler.setInputAction((event: { position: Cesium.Cartesian2 }) => this.pick(event.position, true), Cesium.ScreenSpaceEventType.LEFT_CLICK, modifier);
    this.handler.setInputAction((event: { position: Cesium.Cartesian2 }) => this.down(event.position), Cesium.ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => this.move(event.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => this.finish(true), Cesium.ScreenSpaceEventType.LEFT_UP);
    for (const modifier of [Cesium.KeyboardEventModifier.ALT, Cesium.KeyboardEventModifier.CTRL, Cesium.KeyboardEventModifier.SHIFT]) {
      this.handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => this.move(event.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE, modifier);
      this.handler.setInputAction(() => this.finish(true), Cesium.ScreenSpaceEventType.LEFT_UP, modifier);
    }
    this.handler.setInputAction((event: { position: Cesium.Cartesian2 }) => this.down(event.position), Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.KeyboardEventModifier.ALT);
    const key = (event: KeyboardEvent) => { this.alt = event.altKey; if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.finish(false); } };
    const release = () => this.finish(true);
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('mouseup', release);
    this.off.push(() => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('mouseup', release); });
    this.off.push(useApp.subscribe((state, before) => {
      if (state.selection !== before.selection || state.network?.assets !== before.network?.assets) { this.finish(false); this.draw(); }
    }));
    this.off.push(useTwinUi.subscribe((state, before) => { if (state.editing !== before.editing) { this.finish(false); this.draw(); } }));
    this.off.push(viewer.camera.moveEnd.addEventListener(() => this.draw()));
    this.draw();
  }
  private pick(position: Cesium.Cartesian2, additive: boolean) {
    if (performance.now() < this.ignoreClickUntil) return;
    const picked = this.viewer.scene.pick(position) as { id?: unknown; primitive?: { id?: unknown } } | undefined;
    const raw = picked?.id ?? picked?.primitive?.id;
    if (raw instanceof Cesium.Entity && raw.properties?.gizmoAxis) return;
    if (raw && typeof raw === 'object' && 'vehicleId' in raw) { pickTwinVehicle(Number(raw.vehicleId)); return; }
    const id = raw instanceof Cesium.Entity ? String(raw.properties?.assetId?.getValue() ?? raw.id.replace(/^sign:|^asset:/, '')) : typeof raw === 'string' ? raw.split('::part:')[0]! : '';
    const asset = useApp.getState().network?.assets[id];
    if (!asset || asset.state === 'removed') { if (!additive && useTwinUi.getState().editing) select(null); return; }
    if (!useTwinUi.getState().editing) return;
    pickTwinVehicle(null);
    const current = useApp.getState().selection;
    const ids = additive && current?.kind === 'asset' ? current.ids.includes(id) ? current.ids.filter((v) => v !== id) : [...current.ids, id] : [id];
    select(ids.length ? { kind: 'asset', ids } : null);
  }
  private clear() { for (const entity of this.entities) this.viewer.entities.remove(entity); this.entities = []; }
  private draw(assets = selectedTwinAssets()) {
    if (this.viewer.isDestroyed()) return;
    this.clear();
    if (!useTwinUi.getState().editing || !assets.length) return;
    const first = assets[0]!, z = this.ground(first.at[0], first.at[1]) + (first.elevationM ?? 0);
    const at = Cesium.Cartesian3.fromDegrees(first.at[0], first.at[1], z);
    const length = Math.max(2, Math.min(25, Cesium.Cartesian3.distance(this.viewer.camera.positionWC, at) * .035));
    const base = Cesium.Transforms.eastNorthUpToFixedFrame(at);
    const world = (x: number, y: number, h: number) => Cesium.Matrix4.multiplyByPoint(base, new Cesium.Cartesian3(x, y, h), new Cesium.Cartesian3());
    for (const [axis, direction, color] of [['x', [length, 0, 0], Cesium.Color.TOMATO], ['y', [0, length, 0], Cesium.Color.LIMEGREEN], ['z', [0, 0, length], Cesium.Color.DEEPSKYBLUE]] as const) {
      const end = world(direction[0], direction[1], direction[2]);
      const id = { gizmoAxis: axis };
      const entity = this.viewer.entities.add({ position: end, properties: id,
        point: { pixelSize: 13, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Infinity },
        label: { text: axis.toUpperCase(), font: 'bold 14px sans-serif', fillColor: color, pixelOffset: new Cesium.Cartesian2(11, -10), disableDepthTestDistance: Infinity },
        polyline: { positions: [at, end], width: 3, material: color, depthFailMaterial: color } });
      // Cesium Entity ids are strings; custom properties keep semantic handle ids.
      this.entities.push(entity);
    }
    const ring = Array.from({ length: 49 }, (_, i) => world(Math.cos(i / 48 * Math.PI * 2) * length * .7, Math.sin(i / 48 * Math.PI * 2) * length * .7, .15));
    this.entities.push(this.viewer.entities.add({ properties: { gizmoAxis: 'rotation' }, polyline: { positions: ring, width: 3, material: Cesium.Color.GOLD, depthFailMaterial: Cesium.Color.GOLD } }));
    this.viewer.scene.requestRender();
  }
  private down(position: Cesium.Cartesian2) {
    const entity = (this.viewer.scene.pick(position) as { id?: unknown } | undefined)?.id;
    if (!(entity instanceof Cesium.Entity)) return;
    const axis = entity.properties?.gizmoAxis?.getValue() as TransformAxis | undefined;
    const assets = selectedTwinAssets();
    if (!axis || !assets.length) return;
    const first = assets[0]!, at = Cesium.Cartesian3.fromDegrees(first.at[0], first.at[1], this.ground(first.at[0], first.at[1]) + (first.elevationM ?? 0));
    const base = Cesium.Transforms.eastNorthUpToFixedFrame(at), unit = new Cesium.Cartesian3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const center = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, at);
    const end = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, Cesium.Matrix4.multiplyByPoint(base, unit, new Cesium.Cartesian3()));
    if (!center || !end) return;
    let direction = Cesium.Cartesian2.subtract(end, center, new Cesium.Cartesian2()), pixelsPerM = Cesium.Cartesian2.magnitude(direction);
    if (pixelsPerM < .1) { direction = new Cesium.Cartesian2(0, -1); pixelsPerM = 1; }
    else Cesium.Cartesian2.normalize(direction, direction);
    this.drag = { axis, start: Cesium.Cartesian2.clone(position), center, direction, pixelsPerM, assets, next: assets };
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
  }
  private move(position: Cesium.Cartesian2) {
    const drag = this.drag;
    if (!drag) return;
    const delta = drag.axis === 'rotation' ? (Math.atan2(position.x - drag.center.x, -(position.y - drag.center.y)) - Math.atan2(drag.start.x - drag.center.x, -(drag.start.y - drag.center.y))) * 180 / Math.PI : Cesium.Cartesian2.dot(Cesium.Cartesian2.subtract(position, drag.start, new Cesium.Cartesian2()), drag.direction) / drag.pixelsPerM;
    drag.next = transformedAssets(drag.assets, this.origin, drag.axis, delta, this.alt);
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.drag === drag) { this.preview(drag.next); this.draw(drag.next); } });
  }
  private finish(apply: boolean) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null; cancelAnimationFrame(this.raf); this.raf = 0;
    this.ignoreClickUntil = performance.now() + 150;
    if (this.viewer.isDestroyed()) return;
    this.preview(null); this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    if (apply && drag.next !== drag.assets) applyTwinTransform(drag.next);
    this.draw();
  }
  destroy() { this.finish(false); this.handler.destroy(); this.off.forEach((off) => off()); if (!this.viewer.isDestroyed()) this.clear(); }
}
