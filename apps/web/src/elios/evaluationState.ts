import { create } from 'zustand';
import type { LabResult } from '@drip-urban/core';

export interface EvaluationRow { id: string; label: string; result: LabResult; queueReductionPct: number | null; eligible: boolean; reasons: string[]; }
export const useEvaluation = create<{
  busy: boolean; stage: string; progress: number; rows: EvaluationRow[]; recommendation: string | null; targetPct: number; error: string | null;
}>(() => ({ busy: false, stage: '', progress: 0, rows: [], recommendation: null, targetPct: 25, error: null }));

/** Conservative comparison: no percentage claim from a zero baseline or a censored run. */
export function compareEvaluations(candidates: { id: string; label: string; result?: LabResult }[], targetPct: number) {
  const baseline = candidates[0]?.result;
  if (!baseline) throw Error('Risultato di riferimento mancante');
  const rows: EvaluationRow[] = candidates.map(candidate => {
    const result = candidate.result;
    if (!result) throw Error('Prova incompleta');
    const reasons: string[] = [];
    if (result.failedOperations.length) reasons.push('Operazioni non applicabili');
    if (result.metrics.completed < baseline.metrics.completed) reasons.push('Meno veicoli arrivati nella stessa finestra');
    if ((result.metrics.waitingDemand ?? 0) > (baseline.metrics.waitingDemand ?? 0)) reasons.push('Più domanda in attesa fuori dalla rete');
    if (result.metrics.avgDelayS > baseline.metrics.avgDelayS) reasons.push('Ritardo medio maggiore');
    if (result.cyclingCoverage < baseline.cyclingCoverage - 1e-6) reasons.push('Accessibilità ciclabile ridotta');
    if (result.pedestrianGreenFraction < baseline.pedestrianGreenFraction - 1e-6) reasons.push('Quota di verde pedonale ridotta');
    if (result.crossingConflicts > baseline.crossingConflicts) reasons.push('Più conflitti di attraversamento');
    if (result.walkingCoverage < baseline.walkingCoverage - 1e-6) reasons.push('Accessibilità pedonale ridotta');
    for (const line of baseline.metrics.transit ?? []) {
      const after = result.metrics.transit?.find(item => item.lineId === line.lineId);
      if (!after || after.missed > line.missed || after.waiting > line.waiting + 1 || after.completed < line.completed || after.issue && !line.issue) reasons.push(`Servizio TPL peggiorato: ${line.name}`);
    }
    const queueReductionPct = baseline.peakQueuedVehicles > 0 ? 100 * (baseline.peakQueuedVehicles - result.peakQueuedVehicles) / baseline.peakQueuedVehicles : null;
    if (queueReductionPct === null) reasons.push('Nessuna coda nel riferimento: riduzione percentuale non valutabile');
    return { ...candidate, result, queueReductionPct, eligible: !reasons.length, reasons };
  });
  const best = rows.slice(1).filter(row => row.eligible && (row.queueReductionPct ?? 0) > 0)
    .sort((a, b) => (b.queueReductionPct ?? 0) - (a.queueReductionPct ?? 0) || a.result.metrics.avgDelayS - b.result.metrics.avgDelayS)[0];
  return { rows, recommendation: best?.id ?? null, targetMet: !!best && (best.queueReductionPct ?? 0) >= targetPct };
}
