import type { CityBaseline, Network, Operation } from '../model/types';
import { applyOperation, type Issue } from './registry';

export function baselineNetwork(baseline: CityBaseline): Network {
  return { nodes: baseline.nodes, roads: baseline.roads, assets: baseline.assets, junctions: {}, roundabouts: {}, signalPlans: {}, zones: {} };
}

export interface ReplayResult {
  readonly net: Network;
  /** Operations that no longer apply (e.g. baseline re-imported); kept, never silently dropped. */
  readonly failed: readonly { readonly op: Operation; readonly issues: readonly Issue[] }[];
  readonly warnings: readonly { readonly opId: string; readonly issue: Issue }[];
}

/**
 * Derives the effective network of a scenario.
 *
 * Results are memoised per operation prefix, so undo/redo and appending an
 * operation cost one `apply`, not a full replay.
 */
export class NetworkReplayer {
  private baseline: CityBaseline | null = null;
  private start: Network | null = null;
  /** checkpoints[i] = network after operations[0..i]. */
  private ops: Operation[] = [];
  private checkpoints: Network[] = [];
  private failed: { op: Operation; issues: readonly Issue[] }[] = [];
  private warnings: { opId: string; issue: Issue }[] = [];

  derive(baseline: CityBaseline, operations: readonly Operation[]): ReplayResult {
    if (baseline !== this.baseline) {
      this.baseline = baseline;
      this.start = baselineNetwork(baseline);
      this.truncate(0);
    }
    let shared = 0;
    while (shared < this.ops.length && shared < operations.length && this.ops[shared] === operations[shared]) shared++;
    this.truncate(shared);

    let net = shared === 0 ? this.start! : this.checkpoints[shared - 1]!;
    for (let i = shared; i < operations.length; i++) {
      const op = operations[i]!;
      try {
        const out = applyOperation(net, op);
        net = out.net;
        for (const issue of out.issues) this.warnings.push({ opId: op.id, issue });
      } catch (err) {
        const issues: Issue[] =
          err && typeof err === 'object' && 'issues' in err
            ? [...(err as { issues: Issue[] }).issues]
            : [{ code: 'op.exception', severity: 'error', message: String(err) }];
        this.failed.push({ op, issues });
      }
      this.ops.push(op);
      this.checkpoints.push(net);
    }
    return { net, failed: [...this.failed], warnings: [...this.warnings] };
  }

  private truncate(n: number): void {
    const dropped = new Set(this.ops.slice(n).map((o) => o.id));
    this.ops.length = n;
    this.checkpoints.length = n;
    this.failed = this.failed.filter((f) => !dropped.has(f.op.id));
    this.warnings = this.warnings.filter((w) => !dropped.has(w.opId));
  }
}
