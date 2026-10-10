import {solidMesh,type UrbanSolid} from '@drip-urban/core';
import type {MaterialItem} from '../api/types';
import {buildGlb} from './vehicles';
import {materialCanvas,textureUrl} from './materials';
const cache=new Map<string,Promise<string>>();
export function solidGlb(solid:UrbanSolid,material:string|undefined,materials:Map<string,MaterialItem>):Promise<string>{
 const m=materials.get(material??'concrete'),key=JSON.stringify([solid,m]);const hit=cache.get(key);if(hit)return hit;
 const pending=(async()=>{const mesh=solidMesh(solid),uv:number[]=[];
 for(let i=0;i<mesh.positions.length;i+=3){const p=mesh.positions.slice(i,i+3),n=mesh.normals.slice(i,i+3),axis=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));const q=axis===2?[p[0]!,p[1]!]:axis===1?[p[0]!,p[2]!]:[p[1]!,p[2]!];uv.push(q[0]!/(m?.scaleM??1),q[1]!/(m?.scaleM??1));}
 const image=m?.id.startsWith('custom.')?(await materialCanvas(m)).toDataURL():undefined;
 return URL.createObjectURL(new Blob([buildGlb([{mat:m?.id??'concrete',color:image?'#ffffff':m?.color??'#a2a29e',pos:mesh.positions,nor:mesh.normals,uv,roughness:m?.roughness??.8,metallic:m?.metallic??0,opacity:m?.opacity??1,emissive:m?.emissive??0,image,normalImage:m?.normalMap?new URL(textureUrl(m.normalMap),location.origin).href:undefined}])],{type:'model/gltf-binary'}));})();
 cache.set(key,pending);pending.catch(()=>cache.delete(key));if(cache.size>64){const old=cache.keys().next().value!;cache.get(old)?.then(URL.revokeObjectURL);cache.delete(old);}return pending;
}
