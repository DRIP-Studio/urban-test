import { expect, it } from 'vitest';
import type { LabResult } from '@drip-urban/core';
import { compareEvaluations } from '../src/elios/evaluationState';

function result(queue: number, completed = 50, waitingDemand = 0): LabResult {
  return { peakQueuedVehicles: queue, walkingCoverage: .8, cyclingCoverage: .7, pedestrianGreenFraction: .3, crossingConflicts: 2, failedOperations: [], metrics: { completed, waitingDemand, avgDelayS: 10, transit: [] } } as unknown as LabResult;
}
it('rejects apparent improvements caused by suppressed throughput or waiting demand', () => {
  const comparison = compareEvaluations([
    { id: 'base', label: 'Baseline', result: result(100) },
    { id: 'starved', label: 'Less traffic admitted', result: result(10, 20, 100) },
    { id: 'better', label: 'Same demand served', result: result(70) },
  ], 25);
  expect(comparison.recommendation).toBe('better');
  expect(comparison.targetMet).toBe(true);
  expect(comparison.rows[1]!.eligible).toBe(false);
});
it('rejects lower queues obtained by worsening pedestrian, cycling or delay constraints', () => {
  const base = result(100), candidate = { ...result(60), pedestrianGreenFraction: .1, cyclingCoverage: .5 };
  Object.assign(candidate.metrics, { avgDelayS: 20 });
  const comparison = compareEvaluations([{ id: 'base', label: 'Base', result: base }, { id: 'bad', label: 'Bad', result: candidate }], 25);
  expect(comparison.recommendation).toBeNull();
  expect(comparison.rows[1]!.reasons).toEqual(expect.arrayContaining(['Ritardo medio maggiore', 'Accessibilità ciclabile ridotta', 'Quota di verde pedonale ridotta']));
});
it('does not claim a percentage improvement when the baseline has no queues', () => {
  const comparison = compareEvaluations([{ id: 'base', label: 'Baseline', result: result(0) }, { id: 'other', label: 'Other', result: result(0) }], 25);
  expect(comparison.recommendation).toBeNull();
  expect(comparison.rows[1]!.queueReductionPct).toBeNull();
  expect(comparison.targetMet).toBe(false);
});
it('rejects a candidate that reduces queues at the expense of transit passengers', () => {
  const base = result(100), candidate = result(60);
  const line = { lineId: 'bus', name: 'Bus 1', completed: 4, missed: 0, waiting: 0 };
  Object.assign(base.metrics, { transit: [line] });
  Object.assign(candidate.metrics, { transit: [{ ...line, waiting: 20 }] });
  const comparison = compareEvaluations([{ id: 'base', label: 'Base', result: base }, { id: 'bad', label: 'Bad', result: candidate }], 25);
  expect(comparison.recommendation).toBeNull();
  expect(comparison.rows[1]!.reasons.join()).toContain('TPL');
});
