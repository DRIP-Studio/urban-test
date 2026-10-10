import {LocalFrame,geom,type CityBaseline,type LngLat,type Network} from '@drip-urban/core';
import type {Catalogs} from '../api/types';
import type {SelectionKind} from '../state/store';
export interface ProjectSearchResult {id:string;label:string;group:string;kind:SelectionKind|'transit'|'utilityNode'|'utilityLink';at:LngLat;parentId?:string;}
const normalize=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('it');
/** Exact/prefix matches lead; long tokens tolerate a single insertion, deletion, replacement or transposition. */
export function searchScore(label:string,query:string):number {
 const text=normalize(label),q=normalize(query.trim());if(!q)return 0;if(text.includes(q))return text.startsWith(q)?0:1;
 const oneEdit=(a:string,b:string)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length===b.length){if(a[i]===b[j+1]&&a[i+1]===b[j]){i+=2;j+=2;}else{i++;j++;}}else if(a.length>b.length)i++;else j++;}return edits+(a.length-i)+(b.length-j)<=1;};
 const words=text.split(/[^\p{L}\p{N}]+/u),tokens=q.split(/\s+/);
 return tokens.every(token=>words.some(word=>word.startsWith(token)||token.length>=4&&oneEdit(token,word)))?2:Infinity;
}
export function searchProject(net:Network,query:string,catalogs?:Catalogs|null,limit=20,baseline?:CityBaseline|null):ProjectSearchResult[]{
 if(query.trim().length<2||limit<=0)return[];
 const out:(ProjectSearchResult&{score:number})[]=[],labels=new Map([...(catalogs?.signs.items??[]),...(catalogs?.furniture.items??[])].map(x=>[x.id,x.label]));
 const add=(id:string,label:string,group:string,kind:ProjectSearchResult['kind'],at:LngLat|undefined,aliases='',parentId?:string)=>{const score=searchScore(`${label} ${id} ${aliases}`,query);if(at&&Number.isFinite(score))out.push({id,label,group,kind,at,parentId,score});};
 const signalNodes=new Set(Object.values(net.signalPlans).map(p=>p.nodeId));
 const intersections=new Map<string,string[]>();for(const r of Object.values(net.roads)){for(const n of [r.from,r.to]){const names=intersections.get(n)??[];names.push(r.name||r.id);intersections.set(n,names);}if(!r.tags?.roundabout)add(r.id,r.name||r.id,'Strade del progetto','road',r.axis[Math.floor(r.axis.length/2)]);}
 for(const n of Object.values(net.nodes)){const names=[...new Set(intersections.get(n.id)??[])];if((intersections.get(n.id)?.length??0)>2||net.junctions[n.id]||signalNodes.has(n.id))add(n.id,`Incrocio ${names.join(' / ')||n.id}`,'Incroci','node',n.at);}
 for(const r of Object.values(net.roundabouts))add(r.id,r.name,'Rotatorie','roundabout',r.center);
 for(const a of Object.values(net.assets))if(a.state!=='removed')add(a.id,String(a.properties.label||a.properties.name||labels.get(a.type)||a.type),a.type.startsWith('it.sign.')?'Segnali':'Oggetti','asset',a.at,a.type);
 for(const a of Object.values(net.areas))if(a.state!=='removed')add(a.id,a.name||a.kind,'Superfici','area',a.polygon[0],a.kind);
 for(const z of Object.values(net.zones))add(z.id,z.name,'Zone','zone',z.polygon[0],z.kind);
 for(const m of Object.values(net.markings??{}))if(m.state!=='removed')add(m.id,m.text||m.kind,'Segnaletica orizzontale','marking',m.geometry[0]);
 for(const a of Object.values(net.features??{}))if(a.state!=='removed'){const road=a.roadId?net.roads[a.roadId]:undefined,frame=road?new LocalFrame(road.axis[0]!):null;const at=road&&frame?frame.toLngLat(geom.sampleAt(road.axis.map(p=>frame.toMetric(p)),a.station??0).p):a.nodeId?net.nodes[a.nodeId]?.at:undefined;add(a.id,String(a.properties.name||a.kind),'Interventi stradali','feature',at,road?.name);}
 for(const b of Object.values(baseline?.buildings??{}))if(!net.removedBuildings?.[b.id])add(b.id,b.name||`Edificio ${b.id}`,'Edifici','building',b.footprint[0]);
 for(const line of net.transit??[]){add(line.id,line.name,'Linee TPL','transit',line.line[0],line.mode,line.id);for(const stop of line.stops)add(stop.id,stop.name,'Fermate TPL','transit',stop.at,line.name,line.id);}
 for(const n of Object.values(net.utilityNodes??{}))add(n.id,n.name,'Nodi sottoservizi','utilityNode',n.at,n.system);
 for(const l of Object.values(net.utilityLinks??{}))add(l.id,l.name,'Condotte sottoservizi','utilityLink',net.utilityNodes?.[l.from]?.at,l.material);
 return out.sort((a,b)=>a.score-b.score).slice(0,limit).map(({score,...r})=>r);
}
