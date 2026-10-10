import { create } from 'zustand';
import { api } from '../api/client';
import type { FurnitureItem } from '../api/types';
import { useApp } from '../state/store';

export interface ProjectModel { id: string; name: string; file: string; format: string; sizeBytes: number; dims: { w: number; d: number; h: number }; scale: number; pivot?: [number,number,number]; audit?: { triangles: number; materialCount: number; nodeCount: number; warnings: string[]; method: string } }

export const useModels = create<{ list: ProjectModel[] }>(() => ({ list: [] }));

/** Catalogue entry for a project model: asset type `model:<id>`, footprint and box symbol from its size. */
export function modelItem(m: ProjectModel, projectId: string): FurnitureItem & { gltf: string; scale: number } {
  const w = m.dims.w * m.scale, d = m.dims.d * m.scale, h = m.dims.h * m.scale;
  return {
    id: `model:${m.id}`, label: `${m.name} (3D)`, category: 'models', dims: { w, d, h }, material: 'concrete',
    model: [{ shape: 'box', size: [w, d, h], at: [0, 0, 0], mat: 'concrete' }],
    gltf: `/api/projects/${encodeURIComponent(projectId)}/models/${m.id}`, scale: m.scale, modelOffset: m.pivot,
  };
}

/** Loads the project's models and exposes them in the furniture catalogue (2D symbol, Twin glTF). */
export async function loadModels(): Promise<void> {
  const { project, catalogs } = useApp.getState();
  if (!project || !catalogs) return;
  const list = await api.get<ProjectModel[]>(`/api/projects/${encodeURIComponent(project.id)}/models`).catch(() => []);
  const current = useApp.getState();
  if (current.project?.id !== project.id || !current.catalogs) return;
  const latest = current.catalogs;
  useModels.setState({ list });
  const items = latest.furniture.items.filter((i) => !i.id.startsWith('model:'));
  useApp.setState({ catalogs: { ...latest, furniture: { categories: { ...latest.furniture.categories, models: 'Modelli 3D del progetto' }, items: [...items, ...list.map((m) => modelItem(m, project.id))] } } });
}
