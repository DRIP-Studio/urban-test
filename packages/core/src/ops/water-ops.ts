import type { LngLat, Network, WaterNode, WaterPipe } from '../model/types';
import { defineOperation, type Issue } from './registry';

const err = (code: string, message: string, targetIds?: string[]): Issue => ({ code, severity: 'error', message, ...(targetIds ? { targetIds } : {}) });
const okLL = (p: unknown): p is LngLat => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isFinite(x));
const KINDS = new Set(['junction', 'reservoir', 'tank', 'hydrant', 'valve']);
const nodesOf = (n: Network) => n.waterNodes ?? {};
const pipesOf = (n: Network) => n.waterPipes ?? {};
const withWater = (net: Network, nodes: Record<string, WaterNode>, pipes: Record<string, WaterPipe>): Network => ({ ...net, waterNodes: nodes, waterPipes: pipes });

function checkNode(n: WaterNode): Issue[] {
  const out: Issue[] = [];
  if (!KINDS.has(n.kind)) out.push(err('water.kind', `Tipo di nodo non valido: ${String(n.kind)}`, [n.id]));
  if (!okLL(n.at)) out.push(err('water.at', 'Posizione non valida', [n.id]));
  if (!Number.isFinite(n.elevation)) out.push(err('water.elevation', 'Quota non valida', [n.id]));
  if ((n.kind === 'reservoir' || n.kind === 'tank') && !(Number.isFinite(n.headM) && n.headM! > n.elevation - 1e-9)) out.push(err('water.head', 'Serbatoi e fonti richiedono un carico (quota piezometrica) ≥ quota del terreno', [n.id]));
  if (n.demandLs !== undefined && !(n.demandLs >= 0 && n.demandLs < 1000)) out.push(err('water.demand', 'Domanda 0–1000 l/s', [n.id]));
  return out;
}
function checkPipe(net: Network, p: WaterPipe): Issue[] {
  const nodes = nodesOf(net);
  if (!nodes[p.from] || !nodes[p.to]) return [err('water.node', 'La condotta deve collegare due nodi esistenti', [p.id])];
  if (p.from === p.to) return [err('water.loop', 'Condotta chiusa su sé stessa', [p.id])];
  const out: Issue[] = [];
  if (!(p.diameterMm >= 20 && p.diameterMm <= 2000)) out.push(err('water.dn', 'Diametro 20–2000 mm', [p.id]));
  if (!(p.c >= 60 && p.c <= 160)) out.push(err('water.c', 'Coefficiente di Hazen–Williams 60–160', [p.id]));
  return out;
}

export const waterAddNode = defineOperation<{ readonly node: WaterNode }>({
  type: 'water.addNode',
  label: (p) => ({ junction: 'Nodo acquedotto', reservoir: 'Serbatoio / fonte', tank: 'Serbatoio', hydrant: 'Idrante', valve: 'Valvola' })[p.node.kind],
  validate: (net, p) => [...checkNode(p.node), ...(nodesOf(net)[p.node.id] ? [err('water.duplicate', `Id già in uso: ${p.node.id}`)] : [])],
  apply: (net, p) => withWater(net, { ...nodesOf(net), [p.node.id]: p.node }, { ...pipesOf(net) }),
});

export const waterAddPipe = defineOperation<{ readonly pipe: WaterPipe }>({
  type: 'water.addPipe',
  label: (p) => `Condotta acquedotto DN ${p.pipe.diameterMm}`,
  validate: (net, p) => [...checkPipe(net, p.pipe), ...(pipesOf(net)[p.pipe.id] ? [err('water.duplicate', `Id già in uso: ${p.pipe.id}`)] : [])],
  apply: (net, p) => withWater(net, { ...nodesOf(net) }, { ...pipesOf(net), [p.pipe.id]: p.pipe }),
});

export type WaterUpdatePayload =
  | { readonly kind: 'node'; readonly id: string; readonly changes: Partial<Omit<WaterNode, 'id'>> }
  | { readonly kind: 'pipe'; readonly id: string; readonly changes: Partial<Omit<WaterPipe, 'id'>> };

export const waterUpdate = defineOperation<WaterUpdatePayload>({
  type: 'water.update',
  label: (p) => (p.kind === 'node' ? 'Modifica nodo acquedotto' : 'Modifica condotta acquedotto'),
  validate(net, p) {
    if (p.kind === 'node') { const n = nodesOf(net)[p.id]; return n ? checkNode({ ...n, ...p.changes } as WaterNode) : [err('water.missing', `Nodo ${p.id} inesistente`)]; }
    const x = pipesOf(net)[p.id];
    return x ? checkPipe(net, { ...x, ...p.changes } as WaterPipe) : [err('water.missing', `Condotta ${p.id} inesistente`)];
  },
  apply(net, p) {
    if (p.kind === 'node') return withWater(net, { ...nodesOf(net), [p.id]: { ...nodesOf(net)[p.id]!, ...p.changes } as WaterNode }, { ...pipesOf(net) });
    return withWater(net, { ...nodesOf(net) }, { ...pipesOf(net), [p.id]: { ...pipesOf(net)[p.id]!, ...p.changes } as WaterPipe });
  },
});

export const waterRemove = defineOperation<{ readonly nodeIds?: readonly string[]; readonly pipeIds?: readonly string[] }>({
  type: 'water.remove',
  label: (p) => `Elimina ${(p.nodeIds?.length ?? 0) + (p.pipeIds?.length ?? 0)} elementi dell'acquedotto`,
  validate: (_net, p) => ((p.nodeIds?.length ?? 0) + (p.pipeIds?.length ?? 0) ? [] : [err('water.empty', 'Niente da eliminare')]),
  apply(net, p) {
    const nodes = { ...nodesOf(net) }, pipes = { ...pipesOf(net) };
    const gone = new Set(p.nodeIds ?? []);
    for (const id of gone) delete nodes[id];
    for (const id of p.pipeIds ?? []) delete pipes[id];
    for (const x of Object.values(pipes)) if (gone.has(x.from) || gone.has(x.to)) delete pipes[x.id];
    return withWater(net, nodes, pipes);
  },
});
