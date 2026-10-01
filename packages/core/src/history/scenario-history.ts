import type { CityBaseline, Network, Operation, Scenario } from '../model/types';
import { NetworkReplayer, type ReplayResult } from '../ops/replay';
import { operationSpec, OperationRejected, type Issue } from '../ops/registry';

export interface CommitInput<P = unknown> {
  readonly type: string;
  readonly payload: P;
}

export interface HistoryEntry {
  readonly opId: string;
  readonly label: string;
}

export class ScenarioReadOnly extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ScenarioReadOnly';
  }
}

/**
 * Owns the operation list of one scenario. The only writer of Scenario.operations.
 * Undo removes the last operation; redo re-appends the same Operation object,
 * so the replayer reuses its memoised checkpoint.
 */
export class ScenarioHistory {
  private scenarioValue: Scenario;
  private readonly baseline: CityBaseline;
  private readonly replayer = new NetworkReplayer();
  private redoStack: Operation[] = [];
  private result: ReplayResult;

  constructor(
    baseline: CityBaseline,
    scenario: Scenario,
    private readonly author: string,
    private readonly newId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.baseline = baseline;
    this.scenarioValue = scenario;
    this.result = this.replayer.derive(baseline, scenario.operations);
  }

  get scenario(): Scenario { return this.scenarioValue; }
  get network(): Network { return this.result.net; }
  get replay(): ReplayResult { return this.result; }
  get canUndo(): boolean { return this.writable && this.scenarioValue.operations.length > 0; }
  get canRedo(): boolean { return this.writable && this.redoStack.length > 0; }

  get undoEntry(): HistoryEntry | null {
    const op = this.scenarioValue.operations.at(-1);
    return op ? { opId: op.id, label: operationSpec(op.type).label(op.payload) } : null;
  }

  get redoEntry(): HistoryEntry | null {
    const op = this.redoStack.at(-1);
    return op ? { opId: op.id, label: operationSpec(op.type).label(op.payload) } : null;
  }

  private get writable(): boolean {
    return !this.scenarioValue.isBaseline && !this.scenarioValue.locked && !this.scenarioValue.archived;
  }

  private assertWritable(): void {
    if (this.scenarioValue.isBaseline) throw new ScenarioReadOnly('Lo stato attuale (baseline) non si modifica: crea o seleziona uno scenario.');
    if (this.scenarioValue.locked) throw new ScenarioReadOnly('Scenario bloccato.');
    if (this.scenarioValue.archived) throw new ScenarioReadOnly('Scenario archiviato.');
  }

  /** Validates against the current network; throws OperationRejected without changing state. */
  commit<P>(input: CommitInput<P>): { op: Operation<P>; warnings: Issue[] } {
    this.assertWritable();
    const spec = operationSpec(input.type);
    const issues = spec.validate(this.result.net, input.payload);
    if (issues.some((i) => i.severity === 'error')) throw new OperationRejected(input.type, issues);
    const op: Operation<P> = { id: this.newId(), type: input.type, payload: input.payload, author: this.author, at: this.now() };
    this.setOperations([...this.scenarioValue.operations, op]);
    this.redoStack = [];
    return { op, warnings: issues };
  }

  undo(): HistoryEntry | null {
    if (!this.canUndo) return null;
    const entry = this.undoEntry!;
    const ops = this.scenarioValue.operations;
    this.redoStack.push(ops[ops.length - 1]!);
    this.setOperations(ops.slice(0, -1));
    return entry;
  }

  redo(): HistoryEntry | null {
    if (!this.canRedo) return null;
    const op = this.redoStack.pop()!;
    this.setOperations([...this.scenarioValue.operations, op]);
    return { opId: op.id, label: operationSpec(op.type).label(op.payload) };
  }

  private setOperations(operations: readonly Operation[]): void {
    this.scenarioValue = { ...this.scenarioValue, operations };
    this.result = this.replayer.derive(this.baseline, operations);
  }
}
