import type { Network, Operation } from '../model/types';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly targetIds?: readonly string[];
}

export interface OperationSpec<P> {
  readonly type: string;
  /** Short Italian label for history, audit log and undo menu. */
  label(payload: P): string;
  /** Errors block the operation; warnings are reported but allowed. */
  validate(net: Network, payload: P): Issue[];
  /** Pure: must not mutate `net`. */
  apply(net: Network, payload: P): Network;
}

const specs = new Map<string, OperationSpec<unknown>>();

export function defineOperation<P>(spec: OperationSpec<P>): OperationSpec<P> {
  if (specs.has(spec.type)) throw new Error(`Operation type already registered: ${spec.type}`);
  specs.set(spec.type, spec as OperationSpec<unknown>);
  return spec;
}

export function operationSpec(type: string): OperationSpec<unknown> {
  const spec = specs.get(type);
  if (!spec) throw new Error(`Unknown operation type: ${type}`);
  return spec;
}

export function registeredOperationTypes(): string[] {
  return [...specs.keys()].sort();
}

export class OperationRejected extends Error {
  readonly issues: readonly Issue[];
  constructor(type: string, issues: readonly Issue[]) {
    super(`${type}: ${issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
    this.name = 'OperationRejected';
    this.issues = issues;
  }
}

/** Validate then apply one operation. Throws OperationRejected on error issues. */
export function applyOperation(net: Network, op: Operation): { net: Network; issues: Issue[] } {
  const spec = operationSpec(op.type);
  const issues = spec.validate(net, op.payload);
  if (issues.some((i) => i.severity === 'error')) throw new OperationRejected(op.type, issues);
  return { net: spec.apply(net, op.payload), issues };
}
