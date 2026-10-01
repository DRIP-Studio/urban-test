import { api } from '../api/client';

export interface TwinCamera { lon: number; lat: number; height: number; heading: number; pitch: number }

/** Camera requested by a Present scene before the Twin view mounts; consumed once by TwinView. */
let pending: TwinCamera | null = null;
export const setPendingTwinCamera = (c: TwinCamera | null) => { pending = c; };
export const takePendingTwinCamera = (): TwinCamera | null => { const c = pending; pending = null; return c; };

/** Saves a 3D keyframe as a Present scene in the project's presentation document. */
export async function saveTwinKeyframe(projectId: string, cam: TwinCamera): Promise<void> {
  const doc = (await api.get<{ scenes?: unknown[] } | null>(`/api/projects/${encodeURIComponent(projectId)}/docs/presentation`)) ?? {};
  const scenes = [...(doc.scenes ?? []), { id: `sc-${crypto.randomUUID().slice(0, 8)}`, title: 'Vista 3D', text: '', camera: null, twin: cam }];
  await api.put(`/api/projects/${encodeURIComponent(projectId)}/docs/presentation`, { ...doc, scenes });
}
