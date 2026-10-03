import type { SignalOptimization } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { planPayload } from '../panels/SignalStudio';
import { commit, useApp } from '../state/store';

export interface OptimizeSummary { plans: number; corridors: number; before: number; after: number; saturated: string[]; applied: boolean }

/**
 * "Ottimizza tutti i semafori": Webster on every plan of the scenario with the DRIP traffic estimate,
 * applied as one undoable batch. Corridors keep their offsets on a common cycle.
 */
export async function optimizeAllSignals(apply = true): Promise<OptimizeSummary> {
  const res = await engine.job<SignalOptimization[]>('optimizeSignals', {});
  const net = useApp.getState().network;
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  const summary: OptimizeSummary = {
    plans: res.length, corridors: new Set(res.map((r) => r.plan.coordination?.id).filter(Boolean)).size,
    before: mean(res.map((r) => r.beforeCycleS)), after: mean(res.map((r) => r.plan.cycleS)),
    saturated: res.filter((r) => r.design.criticalRatio > 0.85).map((r) => r.plan.name || net?.signalPlans[r.plan.id]?.name || r.plan.nodeId),
    applied: false,
  };
  if (apply && res.length) {
    const r = commit('batch', { label: `Ottimizza ${res.length} semafori (Webster)`, ops: res.map((o) => ({ type: 'signal.setPlan', payload: planPayload(o.plan, o.analysis) })) });
    summary.applied = r.ok;
  }
  return summary;
}
