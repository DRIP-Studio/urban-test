import { describe, expect, it } from 'vitest';
import { gltfDims } from '../src/models/gltf';

function glb(json: object): ArrayBuffer {
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) { const p = new Uint8Array(js.length + pad).fill(0x20); p.set(js); js = p; }
  const buf = new ArrayBuffer(12 + 8 + js.length);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, buf.byteLength, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf, 20).set(js);
  return buf;
}

describe('glTF size', () => {
  it('reads the bounding box from accessors, applying node scale (Y-up → h)', () => {
    const d = gltfDims(glb({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, scale: [2, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ min: [-1, 0, -0.5], max: [1, 3, 0.5] }],
    }));
    expect(d.w).toBeCloseTo(4); expect(d.h).toBeCloseTo(3); expect(d.d).toBeCloseTo(1);
  });

  it('falls back to 2 m when the model has no positions', () => {
    expect(gltfDims(glb({ asset: { version: '2.0' } }))).toEqual({ w: 2, d: 2, h: 2 });
  });
});
