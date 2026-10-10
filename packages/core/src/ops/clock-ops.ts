import type { ProjectClock } from '../model/types';
import { clockErrors } from '../analysis/clock';
import { defineOperation } from './registry';

export const setProjectClock = defineOperation<{ clock: ProjectClock }>({
  type: 'clock.set',
  label: () => 'Tempo del progetto',
  validate: (_net, p) => clockErrors(p.clock).map((message) => ({ code: 'clock.invalid', severity: 'error' as const, message })),
  apply: (net, p) => ({ ...net, clock: { ...p.clock } }),
});
