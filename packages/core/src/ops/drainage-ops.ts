import type { DrainageNode, DrainagePipe, LngLat, Network } from '../model/types';
import { MIN_SLOPE, drainageNodesOf, drainageOrder, drainagePipesOf, pipeLength, pipeSlope } from '../analysis/drainage';
import { defineOperation, type Issue } from './registry';

const err = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'error', message, ...(targetIds ? { targetIds } : {}) });
const warn = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'warning', message, ...(targetIds ? { targetIds } : {}) });
const okLL = (p: unknown): p is LngLat => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isFinite(x)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const KINDS = new Set(['inlet', 'manhole', 'outfall']);
const pct = (v: number) => (v * 100).toFixed(2).replace('.', ',');

function withDrainage(net: Network, nodes: Record<string, DrainageNode>, pipes: Record<string, DrainagePipe>): Network {
  return { ...net, drainageNodes: nodes, drainagePipes: pipes };
}

function checkNode(n: DrainageNode): Issue[] {
  const issues: Issue[] = [];
  if (!n.id) issues.push(err('drainage.id', 'Id del nodo mancante'));
  if (!KINDS.has(n.kind)) issues.push(err('drainage.kind', `Tipo di nodo non valido: ${String(n.kind)}`, [n.id]));
  if (!okLL(n.at)) issues.push(err('drainage.at', 'Posizione non valida', [n.id]));
  if (!Number.isFinite(n.invertElevation) || Math.abs(n.invertElevation) > 9000) issues.push(err('drainage.invert', 'Quota di scorrimento non valida', [n.id]));
  if (n.rimElevation !== undefined) {
    if (!Number.isFinite(n.rimElevation)) issues.push(err('drainage.rim', 'Quota del chiusino non valida', [n.id]));
    else if (n.rimElevation < n.invertElevation) issues.push(err('drainage.depth', 'La quota di scorrimento è sopra il chiusino', [n.id]));
    else if (n.rimElevation - n.invertElevation > 8) issues.push(warn('drainage.deep', `Pozzetto profondo ${(n.rimElevation - n.invertElevation).toFixed(1)} m`, [n.id]));
  }
  return issues;
}

/** Pipe checks against the network that will contain it (`net` must already hold its nodes). */
function checkPipe(net: Network, p: DrainagePipe, replacing = false): Issue[] {
  const nodes = drainageNodesOf(net);
  const issues: Issue[] = [];
  const a = nodes[p.from], b = nodes[p.to];
  if (!a || !b) return [err('drainage.node', 'La condotta deve collegare due nodi esistenti', [p.id])];
  if (p.from === p.to) return [err('drainage.loop', 'Una condotta non può tornare nello stesso nodo', [p.id])];
  if (!(p.diameterMm >= 100 && p.diameterMm <= 3000)) issues.push(err('drainage.dn', 'Diametro fuori intervallo 100–3000 mm', [p.id]));
  if (!(p.ks >= 20 && p.ks <= 130)) issues.push(err('drainage.ks', 'Coefficiente di Gauckler–Strickler fuori intervallo 20–130', [p.id]));
  if (a.kind === 'outfall') issues.push(err('drainage.outfall', 'Lo scarico è il recapito finale: nessuna condotta può partire da lì', [p.id]));
  const L = pipeLength(a, b);
  if (!(L > 0.5)) issues.push(err('drainage.length', 'Condotta più corta di 0,5 m', [p.id]));
  const i = pipeSlope(a, b);
  if (i < 0) issues.push(err('drainage.adverse', `Contropendenza ${pct(i)}%: abbassa la quota di scorrimento a valle`, [p.id]));
  else if (i < MIN_SLOPE) issues.push(warn('drainage.slope', `Pendenza ${pct(i)}% sotto lo 0,2%`, [p.id]));
  const others = Object.values(drainagePipesOf(net)).filter((x) => !(replacing && x.id === p.id));
  if (others.some((x) => x.from === p.from && x.to === p.to)) issues.push(warn('drainage.parallel', 'Esiste già una condotta tra questi due nodi', [p.id]));
  const { cycles } = drainageOrder(nodes, [...others, p]);
  if (cycles.length) issues.push(err('drainage.cycle', 'La condotta chiude un anello: la rete deve scorrere verso lo scarico', [p.id]));
  return issues;
}

export const drainageAddNode = defineOperation<{ readonly node: DrainageNode }>({
  type: 'drainage.addNode',
  label: (p) => `${p.node.kind === 'inlet' ? 'Caditoia' : p.node.kind === 'outfall' ? 'Scarico' : 'Pozzetto'} ${p.node.name ?? ''}`.trim(),
  validate(net, p) {
    const issues = checkNode(p.node);
    if (drainageNodesOf(net)[p.node.id]) issues.push(err('drainage.duplicateId', `Id già in uso: ${p.node.id}`, [p.node.id]));
    return issues;
  },
  apply: (net, p) => withDrainage(net, { ...drainageNodesOf(net), [p.node.id]: p.node }, { ...drainagePipesOf(net) }),
});

export const drainageAddPipe = defineOperation<{ readonly pipe: DrainagePipe }>({
  type: 'drainage.addPipe',
  label: (p) => `Condotta DN ${p.pipe.diameterMm}`,
  validate(net, p) {
    const issues = checkPipe(net, p.pipe);
    if (drainagePipesOf(net)[p.pipe.id]) issues.push(err('drainage.duplicateId', `Id già in uso: ${p.pipe.id}`, [p.pipe.id]));
    return issues;
  },
  apply: (net, p) => withDrainage(net, { ...drainageNodesOf(net) }, { ...drainagePipesOf(net), [p.pipe.id]: p.pipe }),
});

export type DrainageUpdatePayload =
  | { readonly kind: 'node'; readonly id: string; readonly changes: Partial<Omit<DrainageNode, 'id'>> }
  | { readonly kind: 'pipe'; readonly id: string; readonly changes: Partial<Omit<DrainagePipe, 'id'>> };

function updated(net: Network, p: DrainageUpdatePayload): Network {
  if (p.kind === 'node') {
    const nodes = drainageNodesOf(net);
    return withDrainage(net, { ...nodes, [p.id]: { ...nodes[p.id]!, ...p.changes } as DrainageNode }, { ...drainagePipesOf(net) });
  }
  const pipes = drainagePipesOf(net);
  return withDrainage(net, { ...drainageNodesOf(net) }, { ...pipes, [p.id]: { ...pipes[p.id]!, ...p.changes } as DrainagePipe });
}

export const drainageUpdate = defineOperation<DrainageUpdatePayload>({
  type: 'drainage.update',
  label: (p) => (p.kind === 'node' ? 'Modifica nodo di drenaggio' : 'Modifica condotta'),
  validate(net, p) {
    if (p.kind === 'node' ? !drainageNodesOf(net)[p.id] : !drainagePipesOf(net)[p.id]) return [err('drainage.missing', `Elemento ${p.id} inesistente`, [p.id])];
    if ('id' in p.changes) return [err('drainage.id', 'L\'id non si modifica')];
    const next = updated(net, p);
    if (p.kind === 'node') {
      const issues = checkNode(drainageNodesOf(next)[p.id]!);
      // Moving a node or its invert changes the pipes that touch it.
      for (const x of Object.values(drainagePipesOf(next))) if (x.from === p.id || x.to === p.id) issues.push(...checkPipe(next, x, true).filter((i) => i.code !== 'drainage.parallel'));
      if (p.changes.kind === 'outfall' && Object.values(drainagePipesOf(next)).some((x) => x.from === p.id)) issues.push(err('drainage.outfall', 'Un nodo con condotte in uscita non può essere uno scarico'));
      return issues;
    }
    return checkPipe(next, drainagePipesOf(next)[p.id]!, true);
  },
  apply: updated,
});

export const drainageRemove = defineOperation<{ readonly nodeIds?: readonly string[]; readonly pipeIds?: readonly string[] }>({
  type: 'drainage.remove',
  label: (p) => `Elimina ${(p.nodeIds?.length ?? 0) + (p.pipeIds?.length ?? 0)} elementi di drenaggio`,
  validate(net, p) {
    const nodes = drainageNodesOf(net), pipes = drainagePipesOf(net);
    if (!(p.nodeIds?.length || p.pipeIds?.length)) return [err('drainage.empty', 'Niente da eliminare')];
    const missing = [...(p.nodeIds ?? []).filter((id) => !nodes[id]), ...(p.pipeIds ?? []).filter((id) => !pipes[id])];
    return missing.length ? [err('drainage.missing', `Elementi inesistenti: ${missing.join(', ')}`, missing)] : [];
  },
  apply(net, p) {
    const nodes = { ...drainageNodesOf(net) }, pipes = { ...drainagePipesOf(net) };
    const gone = new Set(p.nodeIds ?? []);
    for (const id of gone) delete nodes[id];
    for (const id of p.pipeIds ?? []) delete pipes[id];
    // Pipes of a removed node go with it.
    for (const x of Object.values(pipes)) if (gone.has(x.from) || gone.has(x.to)) delete pipes[x.id];
    return withDrainage(net, nodes, pipes);
  },
});
