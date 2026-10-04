import { describe, expect, it } from 'vitest';
import catalog from '../../../packages/assets/furniture/catalog.json';
import type { FurnitureItem } from '../src/api/types';
import { partFaces, partPrints, partsBounds, rotationMatrix } from '../src/models/parts';

const items = (catalog as unknown as { items: FurnitureItem[] }).items;

describe('procedural furniture parts', () => {
  it('builds closed boxes with outward normals', () => {
    const faces = partFaces({ shape: 'box', size: [2, 1, 0.5], at: [0, 0, 0], mat: 'wood' });
    expect(faces).toHaveLength(6);
    const top = faces.find((f) => f.n[2] > 0.99)!;
    expect(top.pts.every((q) => Math.abs(q[2] - 0.5) < 1e-9)).toBe(true);
    for (const f of faces) {
      const c = f.pts.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4, s[2] + q[2] / 4], [0, 0, 0]);
      // Outward: normal points away from the box centre (0, 0, 0.25).
      expect(f.n[0] * c[0] + f.n[1] * c[1] + f.n[2] * (c[2] - 0.25)).toBeGreaterThan(0);
    }
  });

  it('rotates about the part centre (X, then Y, then Z)', () => {
    const m = rotationMatrix([0, 90, 0]);
    // Ry(90°) maps the cylinder axis z onto +x.
    expect(m[2]).toBeCloseTo(1); expect(m[8]).toBeCloseTo(0);
    const b = partsBounds([{ shape: 'cylinder', r: 0.05, h: 2, at: [0, 0, 1], rot: [0, 90, 0], mat: 'steel' }]);
    expect(b.min[0]).toBeCloseTo(-1, 2); expect(b.max[0]).toBeCloseTo(1, 2);
    expect(b.min[2]).toBeGreaterThan(0.9);
  });

  it('every catalogue item has parts within its declared dimensions and on the ground', () => {
    for (const it of items) {
      expect(it.model.length, it.id).toBeGreaterThan(0);
      const b = partsBounds(it.model);
      expect(b.max[2], it.id).toBeLessThanOrEqual(it.dims.h + 0.05);
      expect(Math.max(-b.min[0], b.max[0]) * 2, it.id).toBeLessThanOrEqual(it.dims.w + 0.05);
      expect(Math.max(-b.min[1], b.max[1]) * 2, it.id).toBeLessThanOrEqual(it.dims.d + 0.05);
      expect(b.min[2], it.id).toBeGreaterThan(-0.1);
    }
  });

  it('gives extrusion prints with base and top for the tilted map', () => {
    const pole = items.find((i) => i.id === 'furniture.light_pole')!;
    const prints = partPrints(pole.model);
    expect(prints.length).toBeGreaterThanOrEqual(pole.model.length - 1);
    const head = prints.reduce((a, b) => (b.base > a.base ? b : a));
    expect(head.base).toBeGreaterThan(7);
    expect(prints.every((p) => p.ring.length >= 3 && p.top > p.base)).toBe(true);
  });
});
