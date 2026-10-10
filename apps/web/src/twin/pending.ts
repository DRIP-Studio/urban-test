import type {PresentationScene,PresentationGraphic} from '@drip-urban/core';
import {commit,useApp,newId} from '../state/store';
import {getProjectClock} from '../state/projectTime';
import { api } from '../api/client';

export interface TwinCamera { lon: number; lat: number; height: number; heading: number; pitch: number }

/** Camera requested by a Present scene before the Twin view mounts; consumed once by TwinView. */
let pending: TwinCamera | null = null;
export const setPendingTwinCamera = (c: TwinCamera | null) => { pending = c; };
export const takePendingTwinCamera = (): TwinCamera | null => { const c = pending; pending = null; return c; };

/** Saves a 3D keyframe as a Present scene in the project's presentation document. */
export async function saveTwinKeyframe(projectId: string, cam: TwinCamera): Promise<void> {
  const state=useApp.getState();if(state.project?.id!==projectId)throw Error('Progetto cambiato');
  const doc=state.network?.presentation??(await api.get<{scenes?:unknown[]}|null>(`/api/projects/${encodeURIComponent(projectId)}/docs/presentation`))??{};
  if(useApp.getState().project?.id!==projectId)throw Error('Progetto cambiato');
  const result=commit('presentation.set',{document:{...doc,scenes:[...(doc.scenes??[]),{id:newId('scene'),title:'Vista 3D',text:'',camera:null,twin:cam,clock:getProjectClock(),durationS:12}]}});if(!result.ok)throw Error(result.issues.map(i=>i.message).join(' · '));
}
let pendingPath:{points:readonly TwinCamera[];durationS:number;caption:string;annotations:NonNullable<PresentationScene['annotations']>;graphics?:readonly PresentationGraphic[]}|null=null;
export const setPendingCameraPath=(path:NonNullable<typeof pendingPath>)=>{pendingPath=path;};
export const takePendingCameraPath=()=>{const path=pendingPath;pendingPath=null;return path;};
