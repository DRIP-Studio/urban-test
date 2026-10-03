import { pedestrianState, signalState, type SignalHead, type SignalPlan } from '@drip-urban/core';
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
let simT: number | null = null;
let preview: { plan: SignalPlan; t: number } | null = null;

function stateOf(h: SignalHead, plans: Readonly<Record<string, SignalPlan>>): string {
  const plan = preview && preview.plan.nodeId === h.nodeId ? preview.plan : plans[h.planId];
  const t = preview && preview.plan.nodeId === h.nodeId ? preview.t : simT;
  if (!plan || t === null) return 'off';
  return h.groupId.startsWith('ped:') ? pedestrianState(plan, h.groupId.slice(4), t) : signalState(plan, h.groupId, t, h.turn);
}

export function renderSignalHeads(): void {
  const plans = useApp.getState().network?.signalPlans ?? {};
  setSource('plan-signals', fc(heads.map((h, i): Feature => ({
    type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [...h.at] },
    properties: { id: `${h.planId}:${h.key}:${i}`, planId: h.planId, key: h.key, icon: `sig:${h.kind}:${stateOf(h, plans)}` },
  }))));
}

export function setSignalPreview(p: { plan: SignalPlan; t: number } | null): void {
  preview = p;
  renderSignalHeads();
}

engine.onPhysical((m) => { heads = m.diff.heads; renderSignalHeads(); });
engine.onSim((f) => { simT = f ? f.metrics.t : null; renderSignalHeads(); });
