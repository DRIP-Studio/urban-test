import type { CityBaseline, Network, Operation, Road, RoadStructure } from '../model/types';
import { applyOperation, type Issue } from './registry';

export function baselineNetwork(baseline: CityBaseline): Network {
  return { nodes: baseline.nodes, roads: withOsmStructures(baseline.roads), assets: baseline.assets, junctions: {}, roundabouts: {}, signalPlans: {}, zones: {}, areas: {} };
}

/** OSM bridge / tunnel / layer tags → Road.structure (only where the road has none). */
export function osmStructure(tags: Readonly<Record<string, string>> | undefined): RoadStructure | undefined {
  if (!tags) return undefined;
  const layer = Math.max(-5, Math.min(5, Math.round(Number(tags.layer ?? 0)) || 0));
  if (tags.bridge && tags.bridge !== 'no') return { type: tags.bridge === 'viaduct' ? 'viaduct' : 'bridge', heightM: Math.max(5.5, 5.5 * Math.max(1, layer)), layer: Math.max(1, layer), piersEveryM: tags.bridge === 'viaduct' ? 30 : 40 };
  if (tags.tunnel && tags.tunnel !== 'no') return { type: tags.tunnel === 'building_passage' ? 'covered' : 'tunnel', heightM: 8, layer: Math.min(-1, layer) };
  if (tags.covered === 'yes') return { type: 'covered', heightM: 0, layer: 0 };
  return undefined;
}

function withOsmStructures(roads: Network['roads']): Network['roads'] {
  let out: Record<string, Road> | null = null;
  for (const r of Object.values(roads)) {
    if (r.structure) continue;
    const st = osmStructure(r.tags);
    if (st) (out ??= { ...roads })[r.id] = { ...r, structure: st };
  }
  return out ?? roads;
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
  private opKeys: string[] = [];
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
    // postMessage recreates object identities; immutable operation content still shares checkpoints.
    const keys = operations.map((op, i) => this.ops[i] === op ? this.opKeys[i]! : JSON.stringify(op));
    while (shared < this.ops.length && shared < operations.length && this.opKeys[shared] === keys[shared]) shared++;
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
      this.opKeys.push(keys[i]!);
      this.checkpoints.push(net);
    }
    return { net, failed: [...this.failed], warnings: [...this.warnings] };
  }

  private truncate(n: number): void {
    const dropped = new Set(this.ops.slice(n).map((o) => o.id));
    this.ops.length = n;
    this.opKeys.length = n;
    this.checkpoints.length = n;
    this.failed = this.failed.filter((f) => !dropped.has(f.op.id));
    this.warnings = this.warnings.filter((w) => !dropped.has(w.opId));
  }
}
