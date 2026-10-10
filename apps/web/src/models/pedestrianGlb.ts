import type { ModelPart } from '../api/types';
import { partFaces } from './parts';
import { buildGlb } from './vehicles';

let url: string | undefined;
/** Metre-scale procedural human, shared geometry with named limb nodes for gait. */
export function pedestrianGlbUrl(): string {
  if (url) return url;
  const parts: { name: string; color: string; part: ModelPart }[] = [
    { name: 'torso', color: '#5587a2', part: { shape: 'ellipsoid', size: [.15,.24,.29], at: [0,0,1.21], mat: 'cloth' } },
    { name: 'head', color: '#c69978', part: { shape: 'ellipsoid', size: [.105,.105,.14], at: [0,0,1.63], mat: 'skin' } },
    ...[-1,1].flatMap(side => [
      { name: `arm${side}`, color: '#5587a2', part: { shape: 'ellipsoid' as const, size: [.055,.065,.28] as [number,number,number], at: [0,side*.285,1.15] as [number,number,number], mat: 'cloth' } },
      { name: `leg${side}`, color: '#353940', part: { shape: 'ellipsoid' as const, size: [.085,.085,.43] as [number,number,number], at: [0,side*.105,.5] as [number,number,number], mat: 'cloth' } },
      { name: `shoe${side}`, color: '#20252a', part: { shape: 'ellipsoid' as const, size: [.15,.085,.065] as [number,number,number], at: [.07,side*.105,.065] as [number,number,number], mat: 'shoe' } },
    ]),
  ];
  const groups = parts.map(({name,color,part}) => {
    const pos: number[] = [], nor: number[] = [];
    for (const face of partFaces(part, 10)) for (let i=1;i+1<face.pts.length;i++) for (const point of [face.pts[0]!,face.pts[i]!,face.pts[i+1]!]) { pos.push(...point); nor.push(...face.n); }
    return { mat: name, color, pos, nor, roughness: .9, metallic: 0 };
  });
  url = URL.createObjectURL(new Blob([buildGlb(groups, true)], {type:'model/gltf-binary'}));
  return url;
}
