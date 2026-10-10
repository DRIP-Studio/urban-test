import * as Cesium from 'cesium';
import { VEHICLE_SPECS,LocalFrame,geom, type LngLat } from '@drip-urban/core';
import { useApp } from '../state/store';
import { getProjectTime } from '../state/projectTime';
import { useTwinUi } from './viewState';

export class TwinCameraRig {
  private keys = new Set<string>();
  private frame = 0;
  private last = performance.now();
  private looking: Cesium.Cartesian2 | null = null;
  private handler: Cesium.ScreenSpaceEventHandler;
  private off: (() => void)[] = [];
  private smooth: { lon: number; lat: number; heading: number } | null = null;
  constructor(private viewer: Cesium.Viewer, private fallback: LngLat, private ground: (lon: number, lat: number) => number) {
    const keyDown = (event: KeyboardEvent) => {
      const mode = useTwinUi.getState().cameraMode;
      if (!['fly', 'walk'].includes(mode) || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true], [role=dialog]'))) return;
      if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase())) { this.keys.add(event.key.toLowerCase()); event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const keyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
    this.off.push(() => { window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); });
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    this.handler.setInputAction((e: { position: Cesium.Cartesian2 }) => { if (['fly', 'walk'].includes(useTwinUi.getState().cameraMode)) this.looking = Cesium.Cartesian2.clone(e.position); }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    this.handler.setInputAction(() => { this.looking = null; }, Cesium.ScreenSpaceEventType.RIGHT_UP);
    this.handler.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
      if (!this.looking || !viewer.scene.screenSpaceCameraController.enableInputs) return;
      const dx = e.endPosition.x - this.looking.x, dy = e.endPosition.y - this.looking.y;
      viewer.camera.lookLeft(dx * .003); viewer.camera.lookUp(dy * .003); this.looking = Cesium.Cartesian2.clone(e.endPosition); viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    const configure = () => {
      const state = useTwinUi.getState(), controller = viewer.scene.screenSpaceCameraController;
      controller.enableRotate = controller.enableTranslate = controller.enableTilt = state.cameraMode === 'orbit' && !state.following;
      controller.enableZoom = !state.following && state.cameraMode !== 'walk';
      if (state.cameraMode === 'walk' && !state.following) this.clampWalkingHeight();
    };
    configure();
    this.off.push(useTwinUi.subscribe((state, previous) => {
      if (state.cameraMode !== previous.cameraMode || state.following !== previous.following) {
        this.keys.clear(); this.smooth = null; viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        configure();
      }
    }));
    this.frame = requestAnimationFrame(this.tick);
  }
  private target(): LngLat {
    const { selection, network } = useApp.getState();
    const id = selection?.ids[0];
    if (id && network) {
      if (selection?.kind === 'asset') return network.assets[id]?.at ?? this.fallback;
      if(selection?.kind==='road'){const road=network.roads[id];if(road){const f=new LocalFrame(road.axis[0]!),axis=road.axis.map(p=>f.toMetric(p) as geom.V);return f.toLngLat(geom.sampleAt(axis,geom.lengthOf(axis)/2).p);}}
      if (selection?.kind === 'node') return network.nodes[id]?.at ?? this.fallback;
      if (selection?.kind === 'roundabout') return network.roundabouts[id]?.center ?? this.fallback;
    }
    return this.fallback;
  }
  private clampWalkingHeight() {
    const cartographic = Cesium.Cartographic.fromCartesian(this.viewer.camera.positionWC);
    const lon = Cesium.Math.toDegrees(cartographic.longitude), lat = Cesium.Math.toDegrees(cartographic.latitude);
    this.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, this.ground(lon, lat) + 1.7), orientation: { heading: this.viewer.camera.heading, pitch: Math.max(-1.2, Math.min(1.2, this.viewer.camera.pitch)), roll: 0 } });
  }
  private tick = (now: number) => {
    if (this.viewer.isDestroyed()) return;
    const dt = Math.min(.1, Math.max(0, (now - this.last) / 1000)); this.last = now;
    const state = useTwinUi.getState(), camera = this.viewer.camera;
    if (state.following && state.telemetry) {
      const telemetry = state.telemetry;
      this.smooth ??= { lon: telemetry.at[0], lat: telemetry.at[1], heading: telemetry.heading };
      const k = 1 - Math.exp(-dt * 8), delta = ((telemetry.heading - this.smooth.heading + 540) % 360) - 180;
      this.smooth.lon += (telemetry.at[0] - this.smooth.lon) * k; this.smooth.lat += (telemetry.at[1] - this.smooth.lat) * k; this.smooth.heading += delta * k;
      const t = getProjectTime().seconds;
      const profiles = { chase: [-20, 22, 0], rear: [-8, 12, 0], front: [-8, 14, 180], top: [-89, 80, 0], side: [-12, 22, 90], cinematic: [-25, 30, Math.sin(t * .06) * 30], drone: [-55, 65, t * 5 % 360] };
      const [pitch, range, offset] = profiles[state.followCamera]!;
      const target = Cesium.Cartesian3.fromDegrees(this.smooth.lon, this.smooth.lat, this.ground(this.smooth.lon, this.smooth.lat) + (telemetry.cls==='tram'||telemetry.cls==='train'?2:1.2));
      camera.lookAt(target, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(this.smooth.heading + offset!), Cesium.Math.toRadians(pitch!), Math.max(range!,VEHICLE_SPECS[telemetry.cls].length*1.8)));
      this.viewer.scene.requestRender();
    } else if (state.cameraMode === 'cinematic' && !state.cinematicPathActive) {
      const [lon, lat] = this.target(), seconds = getProjectTime().seconds;
      camera.lookAt(Cesium.Cartesian3.fromDegrees(lon, lat, this.ground(lon, lat)), new Cesium.HeadingPitchRange(seconds * .025, -.6, 250));
      this.viewer.scene.requestRender();
    } else if (this.keys.size && ['fly', 'walk'].includes(state.cameraMode) && this.viewer.scene.screenSpaceCameraController.enableInputs) {
      const distance = dt * (this.keys.has('shift') ? 15 : 4);
      if (this.keys.has('w') || this.keys.has('arrowup')) camera.moveForward(distance);
      if (this.keys.has('s') || this.keys.has('arrowdown')) camera.moveBackward(distance);
      if (this.keys.has('a') || this.keys.has('arrowleft')) camera.moveLeft(distance);
      if (this.keys.has('d') || this.keys.has('arrowright')) camera.moveRight(distance);
      if (state.cameraMode === 'fly') { if (this.keys.has('q')) camera.moveDown(distance); if (this.keys.has('e')) camera.moveUp(distance); }
      else this.clampWalkingHeight();
      this.viewer.scene.requestRender();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  destroy() { cancelAnimationFrame(this.frame); this.handler.destroy(); this.off.forEach((off) => off()); }
}
