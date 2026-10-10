/// <reference lib="webworker" />
import { evaluateScenario, type CityBaseline, type Operation, type LabSettings } from '@drip-urban/core';
declare const self: DedicatedWorkerGlobalScope;
let generation = 0;
self.onmessage = async (event: MessageEvent<{ type: 'run' | 'cancel'; baseline: CityBaseline; candidates: { id: string; operations: Operation[] }[]; settings: LabSettings }>) => {
  const request = event.data, own = ++generation;
  if (request.type === 'cancel') return;
  try {
    for (const candidate of request.candidates) {
      const result = await evaluateScenario(request.baseline, candidate.operations, request.settings,
        (elapsedS) => { if (own === generation) self.postMessage({ type: 'progress', id: candidate.id, elapsedS }); }, () => own !== generation);
      if (own !== generation) return;
      self.postMessage({ type: 'result', id: candidate.id, result });
    }
    if (own === generation) self.postMessage({ type: 'complete' });
  } catch (error) { if (own === generation) self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
