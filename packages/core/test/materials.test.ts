import { describe, expect, it } from 'vitest';
import { applyOperation, baselineNetwork, type CityBaseline, type ProjectMaterial } from '../src';
const net = () => baselineNetwork({ nodes: {}, roads: {}, assets: {}, buildings: {} } as unknown as CityBaseline);
const material: ProjectMaterial = { id: 'custom.test', label: 'Pietra', category: 'stone', color: '#baa998', pattern: 'noise', scaleM: 2, roughness: .8, metallic: .1, permeable: false, crop: [0, 0, 1, 1] };
describe('scenario materials', () => {
  it('preserves immutable network and rejects invalid physical ranges and texture references', () => {
    const before = net(), op = { id: 'test', type: 'material.set', payload: { material } } as any;
    const after = applyOperation(before, op).net;
    expect(before.materials).toBeUndefined(); expect(after.materials?.[material.id]).toEqual(material);
    for (const changes of [{ scaleM: 0 }, { metallic: 2 }, { texture: '../secret' }, { crop: [.8, 0, .5, 1] }, { color: 'red' }]) expect(() => applyOperation(before, { ...op, payload: { material: { ...material, ...changes } } })).toThrow();
  });
});
