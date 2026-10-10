import { expect, it } from 'vitest';
import type { Network } from '@drip-urban/core';
import { searchScore, searchProject } from '../src/shell/projectSearch';
const net: Network = { nodes: {}, roads: {}, assets: {}, areas: {}, junctions: {}, roundabouts: {}, signalPlans: {}, zones: {} };
it('finds effective objects by label, type and id, ignoring accents and removed objects', () => {
  const at = [14.27, 40.94] as const;
  const a = { id: 'a1', type: 'furniture.bench', at, rotationDeg: 0, state: 'project' as const, properties: { label: 'Città, panchina' }, provenance: { kind: 'project' as const, source: 'test' } };
  const network = { ...net, assets: { a1: a, a2: { ...a, id: 'a2', state: 'removed' as const } } };
  expect(searchProject(network, 'citta').map((x) => x.id)).toEqual(['a1']);
  expect(searchProject(network, 'bench')[0]!.kind).toBe('asset');
  expect(searchProject(network, 'a1')[0]!.at).toEqual(at);
  expect(searchProject(network, 'a')).toEqual([]);
  expect(searchProject(network, 'citta', null, 0)).toEqual([]);
});

it('ranks literal matches before single-edit typos and rejects unrelated words',()=>{
 expect(searchScore('Panchina comunale','panchina')).toBe(0);expect(searchScore('Panchina comunale','panchima')).toBe(2);expect(searchScore('Semaforo','semaforo')).toBe(0);expect(searchScore('Semaforo','semafro')).toBe(2);expect(searchScore('Semaforo','semaofro')).toBe(2);expect(searchScore('Semaforo','sottopasso')).toBe(Infinity);
});
it('finds intersections and routes utility results to the real editor',()=>{
 const at=[14.27,40.94] as const,n={id:'n1',name:'Camera telecom',system:'telecom' as const,kind:'chamber' as const,at,elevationM:-2,datum:'relative' as const};
 const network={...net,nodes:{n1:{id:'n1',at}},junctions:{n1:{nodeId:'n1',control:'yield' as const,minorRoadIds:[]}},utilityNodes:{n1:n}};
 expect(searchProject(network,'incrocio')[0]?.kind).toBe('node');expect(searchProject(network,'telecom')[0]).toMatchObject({id:'n1',kind:'utilityNode',at});
});
