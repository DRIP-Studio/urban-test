import type { ModelPart } from '../api/types';
import { partFaces, partPrints, type PartPrint } from './parts';

/**
 * Procedural vehicles (auto, furgone, camion, autobus 12 m, ambulanza) with the same part
 * conventions as the furniture catalogue: metres, x right, y forward (direction of travel), z up.
 * The 2D map draws their top view part by part (extruded when tilted); the Twin loads them as
 * glTF built in memory, one model per class and paint.
 */
import type { VehicleClass } from '@drip-urban/core';
export type { VehicleClass } from '@drip-urban/core';
export const VEHICLE_CLASSES: readonly VehicleClass[] = ['car', 'van', 'truck', 'bus', 'emergency','tram','train','ferry'];

export const VEHICLE_COLORS: Record<string, string> = {
  glass: '#26323c', tyre: '#1a1a1b', rim: '#9da2a8', trim: '#2b2d31', chrome: '#b9bec4', headlight: '#f3f1e4', taillight: '#b3261e', indicator: '#f0a020',
  plate: '#f1f1ee', cargo: '#e8e6e1', cargo_dark: '#c9c6bf', bus_body: '#e9ecef', bus_stripe: '#e8772e', bus_skirt: '#3a3d42', led_amber: '#ffb02e',
  amb_body: '#f6f6f2', amb_stripe: '#d12b2b', amb_yellow: '#f1d23a', lens_blue: '#2d6cdf', interior: '#3c3b39', grille: '#202124',
};
/** Car paints in realistic proportions (white, black, greys, blue, red, beige, green). */
export const CAR_PAINTS = ['#f2f2f0', '#f2f2f0', '#1c1d20', '#9aa0a6', '#9aa0a6', '#5b6168', '#23324a', '#9e2a2b', '#e4ddcb', '#2f5d50'];
export const VAN_PAINTS = ['#f2f2f0', '#f2f2f0', '#c9ccd0', '#2c4f7c'];
export const TRUCK_PAINTS = ['#f2f2f0', '#1f4e8c', '#b8262b', '#3f4247'];

type P = ModelPart;
const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: string, rot?: [number, number, number]): P =>
  ({ shape: 'box', size: [sx, sy, sz], at: rot ? [x, y, z + sz / 2] : [x, y, z], mat, ...(rot ? { rot } : {}) });
/** Wheel: axis across the vehicle, tyre plus rim. */
const wheel = (x: number, y: number, r: number, w: number): P[] => [
  { shape: 'cylinder', r, h: w, at: [x, y, r], rot: [0, 90, 0], mat: 'tyre' },
  { shape: 'cylinder', r: r * 0.58, h: w + 0.02, at: [x, y, r], rot: [0, 90, 0], mat: 'rim' },
];
const pair = (x: number, f: (sx: number) => P[]) => [...f(-x), ...f(x)];

function car(): P[] {
  const L = 4.5, W = 1.8;
  return [
    box(0, 0, 0.22, W - 0.02, L - 0.2, 0.56, 'paint'),
    box(0, 1.5, 0.78, W - 0.08, 1.1, 0.08, 'paint'), // bonnet
    box(0, -1.75, 0.78, W - 0.1, 0.65, 0.1, 'paint'), // boot lid
    box(0, -0.2, 0.78, W - 0.16, 2.0, 0.52, 'glass'), // greenhouse
    box(0, -0.25, 1.3, W - 0.26, 1.7, 0.08, 'paint'), // roof
    box(0, 0.92, 0.79, W - 0.2, 0.06, 0.62, 'glass', [-58, 0, 0]), // windscreen
    box(0, -1.32, 0.79, W - 0.24, 0.06, 0.55, 'glass', [52, 0, 0]), // rear window
    ...pair(0.86, (x) => [box(x, -0.2, 0.8, 0.04, 1.95, 0.08, 'trim')]), // window sills
    box(0, L / 2 - 0.04, 0.2, W, 0.14, 0.34, 'trim'), box(0, -L / 2 + 0.04, 0.2, W, 0.14, 0.34, 'trim'), // bumpers
    box(0, L / 2 - 0.05, 0.42, 0.7, 0.04, 0.16, 'grille'),
    ...pair(0.62, (x) => [box(x, L / 2 - 0.08, 0.6, 0.36, 0.06, 0.12, 'headlight'), box(x, -L / 2 + 0.08, 0.62, 0.32, 0.06, 0.14, 'taillight')]),
    box(0, L / 2 + 0.01, 0.26, 0.52, 0.02, 0.11, 'plate'), box(0, -L / 2 - 0.01, 0.42, 0.52, 0.02, 0.11, 'plate'),
    ...pair(0.97, (x) => [box(x, 0.62, 0.92, 0.14, 0.1, 0.1, 'paint')]), // mirrors
    ...pair(0.8, (x) => [...wheel(x, 1.35, 0.32, 0.22), ...wheel(x, -1.35, 0.32, 0.22)]),
  ];
}

function van(): P[] {
  const L = 5.8, W = 2.0;
  return [
    box(0, -0.45, 0.32, W, 4.8, 1.98, 'paint'),
    box(0, 2.3, 0.32, W - 0.04, 1.0, 0.82, 'paint'), // nose
    box(0, 1.92, 1.14, W - 0.1, 0.06, 1.05, 'glass', [-35, 0, 0]),
    ...pair(1.0, (x) => [box(x, 1.4, 1.22, 0.03, 0.9, 0.62, 'glass')]), // cab side windows
    box(0, L / 2 - 0.04, 0.26, W, 0.14, 0.32, 'trim'), box(0, -L / 2 + 0.05, 0.26, W, 0.12, 0.3, 'trim'),
    box(0, L / 2 - 0.06, 0.66, 1.0, 0.04, 0.24, 'grille'),
    ...pair(0.72, (x) => [box(x, L / 2 - 0.08, 0.8, 0.34, 0.06, 0.16, 'headlight'), box(x * 1.3, -L / 2 + 0.06, 0.6, 0.12, 0.06, 0.4, 'taillight')]),
    box(0, L / 2 + 0.01, 0.34, 0.52, 0.02, 0.11, 'plate'),
    ...pair(1.07, (x) => [box(x, 1.75, 1.32, 0.14, 0.08, 0.22, 'trim')]),
    ...pair(0.86, (x) => [...wheel(x, 1.8, 0.35, 0.24), ...wheel(x, -1.75, 0.35, 0.24)]),
  ];
}

function truck(): P[] {
  const W = 2.5;
  return [
    box(0, 4.05, 0.55, W - 0.05, 1.9, 2.35, 'paint'), // cab
    box(0, 4.98, 1.55, W - 0.25, 0.05, 1.0, 'glass'), // windscreen
    ...pair(1.22, (x) => [box(x, 4.4, 1.6, 0.03, 0.9, 0.8, 'glass')]),
    box(0, 5.01, 0.75, 1.9, 0.04, 0.7, 'grille'),
    box(0, 4.95, 0.35, W, 0.12, 0.35, 'trim'),
    ...pair(0.95, (x) => [box(x, 5.02, 0.7, 0.32, 0.05, 0.18, 'headlight')]),
    box(0, 4.05, 2.9, W - 0.3, 1.6, 0.35, 'paint'), // roof spoiler
    box(0, -0.85, 0.55, 1.1, 9.0, 0.32, 'trim'), // chassis
    box(0, -1.05, 1.0, W, 7.4, 2.75, 'cargo'),
    ...[-4.2, -2.4, -0.6, 1.2].map((y) => box(0, y, 3.73, W + 0.01, 0.06, 0.04, 'cargo_dark')),
    { shape: 'cylinder', r: 0.28, h: 0.9, at: [-1.0, 2.2, 0.6], rot: [90, 0, 0], mat: 'chrome' },
    ...pair(1.18, (x) => [box(x, -4.8, 0.9, 0.12, 0.06, 0.25, 'taillight')]),
    ...pair(1.05, (x) => [...wheel(x, 3.7, 0.52, 0.32), ...wheel(x, -2.6, 0.52, 0.32), ...wheel(x, -3.9, 0.52, 0.32)]),
  ];
}

function bus(): P[] {
  const L = 12, W = 2.55;
  return [
    box(0, 0, 0.32, W, L, 0.65, 'bus_skirt'),
    box(0, 0, 0.97, W, L, 2.0, 'bus_body'),
    ...pair(W / 2 + 0.005, (x) => [box(x, -0.4, 1.3, 0.02, 10.4, 1.25, 'glass'), box(x, 0, 0.82, 0.02, L - 0.4, 0.14, 'bus_stripe')]),
    box(0, L / 2 + 0.005, 0.95, W - 0.2, 0.02, 1.95, 'glass'), // windscreen
    box(0, -L / 2 - 0.005, 1.6, W - 0.5, 0.02, 0.9, 'glass'),
    box(0, L / 2 + 0.012, 2.55, 1.9, 0.02, 0.3, 'led_amber'), // destination display
    box(W / 2 + 0.012, 4.85, 0.38, 0.02, 1.2, 2.45, 'glass'), box(W / 2 + 0.012, 0.6, 0.38, 0.02, 1.2, 2.45, 'glass'), box(W / 2 + 0.012, -3.6, 0.38, 0.02, 1.2, 2.45, 'glass'), // doors (right side)
    box(0, 0.8, 2.97, 1.8, 3.2, 0.32, 'cargo_dark'), // roof A/C
    box(0, -4.6, 2.97, 1.6, 1.6, 0.25, 'cargo_dark'),
    ...pair(1.0, (x) => [box(x, L / 2 + 0.01, 0.55, 0.36, 0.04, 0.14, 'headlight'), box(x, -L / 2 - 0.01, 0.6, 0.2, 0.04, 0.35, 'taillight')]),
    ...pair(1.33, (x) => [box(x, 5.7, 2.3, 0.1, 0.2, 0.35, 'trim')]),
    ...pair(1.1, (x) => [...wheel(x, 3.4, 0.5, 0.3), ...wheel(x, -2.6, 0.5, 0.3)]),
  ];
}

function ambulance(): P[] {
  const L = 6.0, W = 2.1;
  return [
    box(0, -0.55, 0.36, W, 4.8, 2.15, 'amb_body'),
    box(0, 2.35, 0.36, W - 0.04, 1.2, 0.9, 'amb_body'),
    box(0, 1.85, 1.22, W - 0.12, 0.06, 1.05, 'glass', [-35, 0, 0]),
    ...pair(W / 2 + 0.005, (x) => [box(x, -0.55, 1.05, 0.02, 4.8, 0.22, 'amb_stripe'), box(x, -0.55, 0.78, 0.02, 4.8, 0.22, 'amb_yellow'), box(x, 1.3, 1.3, 0.03, 0.85, 0.6, 'glass')]),
    box(0, 1.4, 2.51, 1.5, 0.35, 0.14, 'lens_blue'), // light bar
    ...pair(0.6, (x) => [box(x, -2.9, 2.45, 0.25, 0.15, 0.12, 'lens_blue')]),
    box(0, L / 2 - 0.04, 0.3, W, 0.14, 0.32, 'trim'),
    box(0, L / 2 - 0.02, 0.86, W - 0.1, 0.02, 0.06, 'amb_stripe'),
    ...pair(0.75, (x) => [box(x, L / 2 - 0.06, 0.82, 0.32, 0.06, 0.16, 'headlight'), box(x * 1.3, -L / 2 + 0.06, 0.7, 0.12, 0.06, 0.4, 'taillight')]),
    ...pair(0.9, (x) => [...wheel(x, 1.95, 0.36, 0.25), ...wheel(x, -1.9, 0.36, 0.25)]),
  ];
}

function railVehicle(length:number,width:number):P[]{
 const parts:P[]=[];const n=Math.ceil(length/15),module=length/n;
 for(let k=0;k<n;k++){const y=-length/2+module*(k+.5);parts.push(box(0,y,.35,width,module-.35,2.7,'bus_body'),box(0,y,1.4,width+.02,module-1,1,'glass'),box(0,y,2.5,width+.03,module-.7,.25,'bus_body'),box(0,y,.8,width+.04,module-.6,.2,'bus_stripe'));for(const x of [-width/2,width/2]){for(let j=0;j<3;j++)parts.push(box(x,y-module/2+1+j*(module-2)/3,.7,.04,.85,1.9,'bus_body'));}parts.push(...pair(width/2-.25,x=>[...wheel(x,y-module/3,.35,.2),...wheel(x,y+module/3,.35,.2)]));}
 return parts;
}
function ferry():P[]{return[box(0,0,0,5,16,1.1,'bus_skirt'),box(0,0,1.1,4.2,12,1.8,'bus_body'),box(0,3,1.5,4.25,3,1,'glass'),box(0,0,2.9,4.8,13,.2,'bus_body'),box(0,-3,3.1,1,1,1.5,'trim')];}
export const VEHICLE_PARTS: Record<VehicleClass, P[]> = { car: car(), van: van(), truck: truck(), bus: bus(), emergency: ambulance(),tram:railVehicle(32,2.4),train:railVehicle(60,2.8),ferry:ferry() };

export function paintsOf(cls: VehicleClass): readonly string[] {
  return cls === 'car' ? CAR_PAINTS : cls === 'van' ? VAN_PAINTS : cls === 'truck' ? TRUCK_PAINTS : ['#ffffff'];
}
/** Stable paint for a simulated vehicle (by its id). */
export function paintIndex(cls: VehicleClass, id: number): number {
  return Math.abs((id * 2654435761) | 0) % paintsOf(cls).length;
}
export function colorOfPart(mat: string, paint: string): string {
  return mat === 'paint' ? paint : VEHICLE_COLORS[mat] ?? '#888888';
}

/** Top view rings (vehicle-local metres) sorted bottom-up, for the 2D map. */
const printCache = new Map<VehicleClass, PartPrint[]>();
export function vehiclePrints(cls: VehicleClass): PartPrint[] {
  let prints = printCache.get(cls);
  if (!prints) { prints = [...partPrints(VEHICLE_PARTS[cls])].sort((a, b) => a.top - b.top); printCache.set(cls, prints); }
  return prints;
}

// ------------------------------------------------------------------ glTF (Twin)

const glbCache = new Map<string, string>();

/** In-memory GLB (object URL), Z-up / X-forward-free: positions are written in the vehicle's local ENU frame. */
export function vehicleGlbUrl(cls: VehicleClass, paintIdx: number): string {
  const key = `${cls}:${paintIdx}`;
  const hit = glbCache.get(key);
  if (hit) return hit;
  const paint = paintsOf(cls)[paintIdx] ?? '#ffffff';
  const groups = new Map<string, { pos: number[]; nor: number[] }>();
  for (const part of VEHICLE_PARTS[cls]) {
    const col = colorOfPart(part.mat, paint);
    const g = groups.get(`${part.mat}|${col}`) ?? groups.set(`${part.mat}|${col}`, { pos: [], nor: [] }).get(`${part.mat}|${col}`)!;
    for (const f of partFaces(part, 16)) {
      for (let i = 1; i + 1 < f.pts.length; i++) {
        for (const q of [f.pts[0]!, f.pts[i]!, f.pts[i + 1]!]) { g.pos.push(q[0], q[1], q[2]); g.nor.push(f.n[0], f.n[1], f.n[2]); }
      }
    }
  }
  const url = URL.createObjectURL(new Blob([buildGlb([...groups.entries()].map(([k, v]) => ({ mat: k.split('|')[0]!, color: k.split('|')[1]!, ...v })))], { type: 'model/gltf-binary' }));
  glbCache.set(key, url);
  return url;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  // sRGB → linear for glTF baseColorFactor.
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
}

export function buildGlb(groups: { mat: string; color: string; pos: number[]; nor: number[]; uv?: number[]; roughness?: number; metallic?: number; opacity?: number; emissive?: number; image?: string; normalImage?: string }[], namedNodes = false): ArrayBuffer {
  const chunks: Float32Array[] = [];
  const images: object[] = [], textures: object[] = [];
  const accessors: object[] = [], bufferViews: object[] = [], materials: object[] = [], primitives: object[] = [];
  let offset = 0;
  for (const g of groups) {
    if (!g.pos.length) continue;
    const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, pos[i + k]!); max[k] = Math.max(max[k]!, pos[i + k]!); }
    for (const arr of [pos, nor]) {
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: arr.byteLength, target: 34962 });
      chunks.push(arr);
      offset += arr.byteLength;
    }
    const count = pos.length / 3;
    accessors.push({ bufferView: bufferViews.length - 2, componentType: 5126, count, type: 'VEC3', min, max });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count, type: 'VEC3' });
    let uvAccessor: number | undefined;
    if (g.uv) { const uv=new Float32Array(g.uv);bufferViews.push({buffer:0,byteOffset:offset,byteLength:uv.byteLength,target:34962});chunks.push(uv);offset+=uv.byteLength;uvAccessor=accessors.length;accessors.push({bufferView:bufferViews.length-1,componentType:5126,count,type:'VEC2'}); }
    const texture = (url: string) => { images.push({uri:url});textures.push({source:images.length-1,sampler:0});return {index:textures.length-1}; };
    const glass = g.mat === 'glass', lamp = /light|led|lens|indicator/.test(g.mat), metal = g.mat === 'paint' || g.mat === 'chrome' || g.mat === 'rim';
    materials.push({
      pbrMetallicRoughness: { baseColorFactor: [...hexRgb(g.color), g.opacity ?? (glass ? 0.82 : 1)], metallicFactor: g.metallic ?? (metal ? 0.45 : 0.05), roughnessFactor: g.roughness ?? (glass ? 0.08 : g.mat === 'tyre' ? 0.9 : metal ? 0.32 : 0.6), ...(g.image ? {baseColorTexture:texture(g.image)} : {}) },
      ...(lamp ? { emissiveFactor: hexRgb(g.color).map((c) => c * 0.6) } : {}),
      ...(g.normalImage ? {normalTexture:texture(g.normalImage)} : {}),
      ...(g.emissive ? {emissiveFactor:hexRgb(g.color).map((c)=>c*g.emissive!)} : {}),
      ...(glass || (g.opacity ?? 1) < 1 ? { alphaMode: 'BLEND' } : {}),
      doubleSided: true,
    });
    primitives.push({ attributes: { POSITION: accessors.length - (g.uv ? 3 : 2), NORMAL: accessors.length - (g.uv ? 2 : 1), ...(uvAccessor !== undefined ? {TEXCOORD_0:uvAccessor} : {}) }, material: materials.length - 1, mode: 4 });
  }
  const json = { asset: { version: '2.0', generator: 'DRIP Urban vehicles' }, scene: 0, scenes: [{ nodes: namedNodes ? primitives.map((_, i) => i) : [0] }], nodes: namedNodes ? groups.filter(g => g.pos.length).map((g, i) => ({ mesh: i, name: g.mat })) : [{ mesh: 0 }], meshes: namedNodes ? primitives.map(primitive => ({ primitives: [primitive] })) : [{ primitives }], materials, images, textures, samplers: [{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}], accessors, bufferViews, buffers: [{ byteLength: offset }] };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4;
  const binLen = Math.ceil(offset / 4) * 4;
  const out = new ArrayBuffer(12 + 8 + jsonLen + 8 + binLen);
  const dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(enc, 20); for (let i = enc.length; i < jsonLen; i++) u8[20 + i] = 0x20;
  const b0 = 20 + jsonLen;
  dv.setUint32(b0, binLen, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  let o = b0 + 8;
  for (const c of chunks) { u8.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o); o += c.byteLength; }
  return out;
}
