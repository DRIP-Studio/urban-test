import { getProjectTime, useProjectTime } from '../state/projectTime';
import { pedestrianState, signalState, type SignalHead, type SignalPlan, type TurnKind } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { useApp } from '../state/store';
import { setSource } from './mapStore';

/**
 * Sole owner of the 'plan-signals' source. Heads come from the engine build;
 * their state comes from the running simulation clock, or from a Signal Studio
 * preview, otherwise they are drawn switched off (equipment only).
 */
let heads: readonly SignalHead[] = [];

let preview: { plan: SignalPlan; t: number } | null = null;

export function liveSignalAspect(plan:SignalPlan,groupId:string,turn?:TurnKind):string|null{
 const signal=engine.lastSim?.signals.find(s=>s.planId===plan.id&&s.groupId===groupId);
 return signal?(turn?signal.turns?.[turn]??signal.state:signal.state):null;
}
function stateOf(h: SignalHead, plans: Readonly<Record<string, SignalPlan>>): string {
  const plan = preview && preview.plan.nodeId === h.nodeId ? preview.plan : plans[h.planId];
  const t = preview && preview.plan.nodeId === h.nodeId ? preview.t : getProjectTime().seconds;
  if (!plan || t === null) return 'off';
  const live=preview&&preview.plan.nodeId===h.nodeId?null:liveSignalAspect(plan,h.groupId,h.turn);if(live)return live;
  return h.groupId.startsWith('ped:') ? pedestrianState(plan, h.groupId.slice(4), t, getProjectTime()) : signalState(plan, h.groupId, t, h.turn, getProjectTime());
}

export function renderSignalHeads(): void {
  const plans = useApp.getState().network?.signalPlans ?? {};
  setSource('plan-signals', fc(heads.map((h, i): Feature => ({
    type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [...h.at] },
    properties: { id: `${h.planId}:${h.key}:${i}`, planId: h.planId, key: h.key, roadId: h.roadId, pedestrian: h.kind === 'pedestrian', icon: `sig:${h.kind}:${stateOf(h, plans)}` },
  }))));
}

export function setSignalPreview(p: { plan: SignalPlan; t: number } | null): void {
  preview = p;
  renderSignalHeads();
}

engine.onPhysical((m) => { heads = m.diff.heads; renderSignalHeads(); });
useProjectTime.subscribe((s, previous) => { if (Math.floor(s.elapsedS) !== Math.floor(previous.elapsedS)) renderSignalHeads(); });

useApp.subscribe((s, previous) => { if (s.network?.clock !== previous.network?.clock) renderSignalHeads(); });

engine.onSim(()=>renderSignalHeads());
