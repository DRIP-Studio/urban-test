/**
 * Size of a glTF 2.0 model from its accessors (POSITION min/max of every mesh primitive, node
 * translations and scales applied along the scene tree). glTF is Y-up: w = X, h = Y, d = Z, metres.
 */
export interface ModelDims { w: number; d: number; h: number }

function parseJson(buf: ArrayBuffer): Record<string, unknown> {
  const head = new Uint8Array(buf, 0, 4);
  if (String.fromCharCode(...head) === 'glTF') {
    const dv = new DataView(buf);
    const len = dv.getUint32(12, true);
    const type = dv.getUint32(16, true);
    if (type !== 0x4e4f534a) throw new Error('GLB senza blocco JSON');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

type Mat = number[];
const ident = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
function trs(n: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }): Mat {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!, 2 * (x! * y! + z! * w!) * sx!, 2 * (x! * z! - y! * w!) * sx!, 0,
    2 * (x! * y! - z! * w!) * sy!, (1 - 2 * (x! * x! + z! * z!)) * sy!, 2 * (y! * z! + x! * w!) * sy!, 0,
    2 * (x! * z! + y! * w!) * sz!, 2 * (y! * z! - x! * w!) * sz!, (1 - 2 * (x! * x! + y! * y!)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

export function gltfDims(buf: ArrayBuffer): ModelDims {
  const j = parseJson(buf) as {
    accessors?: { min?: number[]; max?: number[] }[]; meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
    nodes?: { mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    scenes?: { nodes: number[] }[]; scene?: number;
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const add = (m: Mat, p: number[]) => {
    for (let i = 0; i < 3; i++) {
      const v = m[i]! * p[0]! + m[4 + i]! * p[1]! + m[8 + i]! * p[2]! + m[12 + i]!;
      lo[i] = Math.min(lo[i]!, v); hi[i] = Math.max(hi[i]!, v);
    }
  };
  const visit = (ni: number, parent: Mat) => {
    const n = j.nodes?.[ni];
    if (!n) return;
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) for (const p of j.meshes?.[n.mesh]?.primitives ?? []) {
      const a = p.attributes.POSITION !== undefined ? j.accessors?.[p.attributes.POSITION] : undefined;
      if (!a?.min || !a.max) continue;
      for (const x of [a.min[0]!, a.max[0]!]) for (const y of [a.min[1]!, a.max[1]!]) for (const z of [a.min[2]!, a.max[2]!]) add(m, [x, y, z]);
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const roots = j.scenes?.[j.scene ?? 0]?.nodes ?? (j.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, ident());
  if (!Number.isFinite(lo[0])) return { w: 2, d: 2, h: 2 };
  return { w: hi[0]! - lo[0]!, h: hi[1]! - lo[1]!, d: hi[2]! - lo[2]! };
}
