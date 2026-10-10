/** Read the live viewer without importing Cesium into the initial application bundle. */
export interface TwinCameraContext {
  position: { longitude: number; latitude: number; heightM: number };
  headingDeg: number;
  pitchDeg: number;
  viewport: [number, number, number, number] | null;
  source: 'live-twin-camera';
}
let reader: (() => TwinCameraContext | null) | null = null;
export function registerTwinCameraReader(next: () => TwinCameraContext | null): () => void {
  reader = next;
  return () => { if (reader === next) reader = null; };
}
export function getTwinCameraContext(): TwinCameraContext | null { return reader?.() ?? null; }
