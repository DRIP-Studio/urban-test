import { useMemo } from 'react';
import { create } from 'zustand';
import { projectInstant, projectLocalTime, type ProjectClock } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { setWorksDateResolver, refreshWorksDate, commit, useApp } from './store';
import { toast } from './toasts';

/** Only elapsed playback is transient; the calendar anchor/configuration is an undoable scenario operation. */
export const useProjectTime = create<{ elapsedS: number; playing: boolean; speed: number }>(() => ({ elapsedS: 0, playing: false, speed: 1 }));

export function getProjectClock(): ProjectClock {
  const { network, project } = useApp.getState();
  if (network?.clock) return network.clock;
  const timeZone = project?.timezone ?? 'Europe/Rome';
  const date = project?.createdAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  return { anchor: projectInstant(date, 480, timeZone), timeZone, durationS: 3600, speed: 1, holiday: false };
}
export const isProjectLive = () => useApp.getState().network?.environment?.mode === 'live';
export const getProjectTime = () => {
  const clock = getProjectClock();
  return projectLocalTime(clock, isProjectLive() ? (Date.now() - Date.parse(clock.anchor)) / 1000 : useProjectTime.getState().elapsedS);
};

/** Switching to study freezes the current instant; both settings remain one undoable edit. */
export function setProjectTimeMode(mode: 'live' | 'study') {
  const clock = getProjectClock(), anchor = getProjectTime().instant;
  const result = commit('batch', { label: mode === 'live' ? 'Ambiente in tempo reale' : 'Studio all’istante corrente', ops: [
    { type: 'clock.set', payload: { clock: { ...clock, anchor: mode === 'live' ? new Date().toISOString() : anchor, speed: 1 } } },
    { type: 'environment.set', payload: { mode } },
  ] });
  if (result.ok) { engine.simStop(); useProjectTime.setState({ elapsedS: 0, playing: false, speed: 1 }); }
  return result;
}

export function configureProjectClock(changes: Partial<ProjectClock>) {
  const before = getProjectClock(), live = isProjectLive(), clock = { ...before, ...(live ? { anchor: getProjectTime().instant } : {}), ...changes };
  const result = isProjectLive() ? commit('batch', { label: 'Imposta tempo di studio', ops: [
    { type: 'environment.set', payload: { mode: 'study' } }, { type: 'clock.set', payload: { clock } },
  ] }) : commit('clock.set', { clock });
  if (result.ok) {
    useProjectTime.setState({ ...(clock.anchor !== before.anchor || clock.timeZone !== before.timeZone || clock.holiday !== before.holiday ? { elapsedS: 0 } : {}), speed: clock.speed });
    engine.simSpeed(clock.speed);
  }
  return result;
}

export function setProjectWallTime(date: string, minutes: number, fold: 'earlier' | 'later' = 'earlier') {
  try { return configureProjectClock({ anchor: projectInstant(date, minutes, getProjectClock().timeZone, fold) }); }
  catch (e) { toast.error('Tempo del progetto', e instanceof Error ? e.message : String(e)); return { ok: false }; }
}

export function playProjectTime(playing: boolean) {
  if (engine.lastSim) engine.simPause(!playing);
  useProjectTime.setState({ playing });
}
export function seekProjectTime(elapsedS: number) {
  playProjectTime(false);
  if (engine.lastSim) engine.simSeek(elapsedS);
  else useProjectTime.setState({ elapsedS });
}
export function rewindProjectTime() { engine.simStop(); useProjectTime.setState({ elapsedS: 0, playing: false }); }

export function useProjectClock() {
  const configured = useApp((s) => s.network?.clock);
  const project = useApp((s) => s.project);
  const elapsedS = useProjectTime((s) => s.elapsedS);
  const live = useApp(s => s.network?.environment?.mode === 'live');
  const clock = useMemo(() => configured ?? getProjectClock(), [configured, project]);
  const time = useMemo(() => projectLocalTime(clock, live ? (Date.now() - Date.parse(clock.anchor)) / 1000 : elapsedS), [clock, elapsedS, live]);
  return { clock, time, elapsedS };
}

// One owner for playback in every workspace. Flow supplies elapsed time while it is active.
engine.onSim((frame) => {
  if (frame) useProjectTime.setState({ elapsedS: frame.metrics.t, playing: !engine.simPaused, speed: engine.playbackSpeed });
  else useProjectTime.setState({ playing: false });
});
useApp.subscribe((state, previous) => {
  const a = state.network?.clock, b = previous.network?.clock;
  if (state.project?.id !== previous.project?.id || state.scenario?.id !== previous.scenario?.id || a?.anchor !== b?.anchor || a?.timeZone !== b?.timeZone || a?.holiday !== b?.holiday) {
    useProjectTime.setState({ elapsedS: 0, playing: false, speed: state.network?.clock?.speed ?? 1 });
  } else if (a?.speed !== b?.speed) useProjectTime.setState({ speed: a?.speed ?? 1 });
});

export function installProjectTimePlayback(): () => void {
  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    const state = useProjectTime.getState();
    if (isProjectLive() && !engine.lastSim) {
      const elapsedS = Math.floor((Date.now() - Date.parse(getProjectClock().anchor)) / 1000);
      if (elapsedS !== Math.floor(state.elapsedS)) useProjectTime.setState({ elapsedS, playing: false });
      return;
    }
    if (!state.playing || engine.lastSim || !useApp.getState().project) return;
    const duration = getProjectClock().durationS;
    const elapsedS = Math.min(duration, state.elapsedS + dt * state.speed);
    useProjectTime.setState({ elapsedS, playing: elapsedS < duration });
  }, 100);
  return () => clearInterval(timer);
}

setWorksDateResolver(()=>getProjectTime().date);
let worksDate='';useProjectTime.subscribe(()=>{const state=useApp.getState();if(!state.network?.works?.length)return;const date=getProjectTime().date;const key=`${state.project?.id}/${state.scenario?.id}/${date}`;if(key!==worksDate){worksDate=key;refreshWorksDate(date);}});
