import { create } from 'zustand';
import type { VehicleTelemetry } from '@drip-urban/core';
import { select } from '../state/store';
import { engine } from '../engine/engine';
export type CameraMode = 'orbit' | 'fly' | 'walk' | 'cinematic';
export type FollowCamera = 'chase' | 'rear' | 'front' | 'top' | 'side' | 'cinematic' | 'drone';
export const useTwinUi = create<{ cameraMode: CameraMode; cinematicPathActive:boolean; editing: boolean; vehicleId: number | null; following: boolean; followCamera: FollowCamera; telemetry: VehicleTelemetry | null; showRoute: boolean }>(() => ({ cameraMode: 'orbit',cinematicPathActive:false, editing: true, vehicleId: null, following: false, followCamera: 'chase', telemetry: null, showRoute: true }));
export function pickTwinVehicle(id: number | null) {
  if (id !== null) select(null);
  useTwinUi.setState({ vehicleId: id, following: false, telemetry: null }); engine.simTrack(id ?? undefined);
}
