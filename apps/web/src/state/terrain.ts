import { create } from 'zustand';
import type { TerrainGrid } from '@drip-urban/core';
import { api } from '../api/client';
import { useApp } from './store';

/** Project DTM (document `terrain`), shared by the profile studio, exports and Elios. */
interface TerrainState { grid: TerrainGrid | null; loaded: boolean; busy: string | null }
export const useTerrain = create<TerrainState>(() => ({ grid: null, loaded: false, busy: null }));

interface Job { id: string; status: string; progress: number; message: string; error?: string | null }

export async function loadTerrain(): Promise<TerrainGrid | null> {
  const p = useApp.getState().project;
  if (!p) return null;
  const doc = await api.get<{ grid?: TerrainGrid } | null>(`/api/projects/${p.id}/docs/terrain`).catch(() => null);
  if(useApp.getState().project?.id!==p.id)return null;
  useTerrain.setState({ grid: doc?.grid ?? null, loaded: true });
  return doc?.grid ?? null;
}

/** Copernicus GLO-90 over the project area (server job), then reload. */
export async function fetchTerrain(spacingM = 60): Promise<TerrainGrid | null> {
  const p = useApp.getState().project;
  if (!p) return null;
  const { job } = await api.post<{ job: Job }>(`/api/projects/${p.id}/terrain/fetch`, { spacingM });
  for (;;) {
    if(useApp.getState().project?.id!==p.id)return null;
    await new Promise((r) => setTimeout(r, 800));
    const j = await api.get<Job>(`/api/jobs/${job.id}`);
    if(useApp.getState().project?.id!==p.id)return null;
    useTerrain.setState({ busy: `${j.message} · ${Math.round(j.progress * 100)}%` });
    if (j.status === 'done') break;
    if (j.status === 'error') { useTerrain.setState({ busy: null }); throw new Error(j.error ?? 'Download del terreno non riuscito'); }
  }
  useTerrain.setState({ busy: null });
  return useApp.getState().project?.id===p.id?loadTerrain():null;
}

/** ESRI ASCII Grid (.asc) with its EPSG code. */
export async function uploadTerrain(file: File, epsg: number, spacingM = 2): Promise<TerrainGrid | null> {
  const p = useApp.getState().project;
  if (!p) return null;
  const fd = new FormData();
  fd.append('file', file);
  useTerrain.setState({ busy: `Lettura di ${file.name}` });
  try { await api.post(`/api/projects/${p.id}/terrain/upload?epsg=${epsg}&spacing=${spacingM}`, fd); }
  finally { if(useApp.getState().project?.id===p.id)useTerrain.setState({ busy: null }); }
  return useApp.getState().project?.id===p.id?loadTerrain():null;
}

useApp.subscribe((state,previous)=>{if(state.project?.id!==previous.project?.id)useTerrain.setState({grid:null,loaded:false,busy:null});});
