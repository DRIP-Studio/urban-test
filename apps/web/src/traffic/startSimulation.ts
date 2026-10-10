import type { CityBaseline, SimOptions } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { useApp } from '../state/store';
import { getProjectClock, getProjectTime, isProjectLive, setProjectTimeMode } from '../state/projectTime';
import { refreshTrafficState } from './live';

/** One preparation path for UI and agent: actual network, frozen clock, selected traffic source. */
export async function startProjectSimulation(options: Pick<SimOptions,'mode'|'dailyTrips'|'seed'|'pedestrianDemandPerHour'|'initialVehicles'|'focus'|'focusPolygon'|'focusCorridor'|'scopeName'|'microBounds'>, speed=1) {
  if (!Number.isFinite(options.dailyTrips) || options.dailyTrips < 0 || options.dailyTrips > 10000000) throw Error('Domanda veicolare dichiarata non valida');
  if (!Number.isInteger(options.seed)) throw Error('Seed intero richiesto');
  if (isProjectLive()) { const result=setProjectTimeMode('study'); if(!result.ok)throw Error('Impossibile fissare l’istante della simulazione'); }
  const state=useApp.getState();
  if(!state.project||!state.scenario||!state.baseline)throw Error('Progetto e scenario richiesti');
  const [baseline,trafficState]=await Promise.all([
    state.project.large?api.get<CityBaseline>(`/api/projects/${state.project.id}/simulation-network`):Promise.resolve(state.baseline),
    refreshTrafficState(options.dailyTrips),
  ]);
  const current=useApp.getState();
  if(current.project?.id!==state.project.id||current.scenario?.id!==state.scenario.id||current.scenario.operations!==state.scenario.operations)throw Error('Scenario cambiato durante la preparazione: ripeti l’avvio');
  if(!trafficState)throw Error('Stato traffico non disponibile');
  if((trafficState.mode==='live'||trafficState.mode==='historical')&&!trafficState.coverage.observedDirections)throw Error('Nessuna osservazione valida per la fonte scelta. Aggiorna i dati o scegli esplicitamente Simulato / Ibrido.');
  const time=getProjectTime();
  engine.simulationBaseline(baseline,state.scenario.operations);
  engine.simStart({...options,trafficState,day:time.day,hour:time.minutes/60,clock:getProjectClock(),scale:1});
  engine.simSpeed(speed);
  return {mode:options.mode,source:trafficState.mode,coverage:trafficState.coverage,clock:getProjectClock(),dailyTrips:options.dailyTrips,pedestrianDemandPerHour:options.pedestrianDemandPerHour??0,seed:options.seed};
}
