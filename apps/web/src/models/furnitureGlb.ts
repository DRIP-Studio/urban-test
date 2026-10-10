import type { FurnitureItem, MaterialItem } from '../api/types';
import { partFaces } from './parts';
import { buildGlb } from './vehicles';
import { materialCanvas, textureUrl } from './materials';
const cache = new Map<string, Promise<string>>();
/** Native catalogue parts keep their ground pivot and metre dimensions; the GLB adds real PBR. */
export function furnitureGlb(item: FurnitureItem, materials: Map<string, MaterialItem>, override?: string): Promise<string> {
  const key = JSON.stringify([item, [...materials.values()], override]);
  const hit=cache.get(key); if(hit)return hit;
  const promise=(async () => {
    const groups=new Map<string,{mat:string;color:string;pos:number[];nor:number[];uv:number[];roughness:number;metallic:number;opacity:number;emissive:number;image?:string;normalImage?:string}>();
    for(const part of item.model) {
      const id=override && (part.mat===item.material || part.mat==='foliage') ? override : part.mat;
      const m=materials.get(id), g=groups.get(id) ?? {mat:id,color:m?.texture?'#ffffff':m?.color ?? '#888888',pos:[],nor:[],uv:[],roughness:m?.roughness ?? .8,metallic:m?.metallic ?? (m?.category==='metal'?.7:0),opacity:m?.opacity ?? 1,emissive:m?.emissive ?? (/led|light|lens/.test(id)?.5:0)};
      if(m?.id.startsWith('custom.')) { const canvas=await materialCanvas(m);g.image=canvas.toDataURL();if(m.normalMap)g.normalImage=new URL(textureUrl(m.normalMap),location.origin).href; }
      groups.set(id,g);
      for(const face of partFaces(part,16)) for(let i=1;i+1<face.pts.length;i++) for(const p of [face.pts[0]!,face.pts[i]!,face.pts[i+1]!]) {
        g.pos.push(...p);g.nor.push(...face.n);
        const axis=face.n.map(Math.abs).indexOf(Math.max(...face.n.map(Math.abs))), coords=axis===2?[p[0],p[1]]:axis===1?[p[0],p[2]]:[p[1],p[2]];
        g.uv.push(coords[0]!/(m?.scaleM ?? 1),coords[1]!/(m?.scaleM ?? 1));
      }
    }
    return URL.createObjectURL(new Blob([buildGlb([...groups.values()])],{type:'model/gltf-binary'}));
  })();
  cache.set(key,promise);
  if(cache.size>64){const old=cache.keys().next().value!;cache.get(old)?.then(URL.revokeObjectURL);cache.delete(old);}
  return promise;
}
