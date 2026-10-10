import type {Network,WorksPhase} from '../model/types';
import {projectLocalTime} from './clock';
import {ringSelfIntersects,type V} from '../geo/polyline';
const validDate=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const constructionDate=(phase:WorksPhase)=>new Date(Date.parse(phase.endDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);
export function worksErrors(phases:readonly WorksPhase[],net:Network):string[]{
 const errors:string[]=[],ids=new Set<string>();for(const p of phases){if(!p.id||ids.has(p.id))errors.push('ID fase mancante o duplicato');ids.add(p.id);if(!p.name.trim()||!validDate(p.startDate)||!validDate(p.endDate)||p.endDate<p.startDate||!Number.isFinite(p.budget)||p.budget<0||!['planned','active','complete','paused'].includes(p.status))errors.push('Nome, date, stato o budget non validi');if(p.affectedArea&&(p.affectedArea.length<3||p.affectedArea.some(q=>q.length!==2||q.some(v=>!Number.isFinite(v))||Math.abs(q[0])>180||Math.abs(q[1])>90)||ringSelfIntersects(p.affectedArea as readonly V[])))errors.push('Area di cantiere non valida');
 for(const t of p.targets){if(!['construct','demolish','close'].includes(t.action)||!['asset','road','building'].includes(t.kind)||!t.id||t.kind==='asset'&&!net.assets[t.id]||t.kind==='road'&&!net.roads[t.id]||t.action==='close'&&t.kind!=='road')errors.push('Oggetto o azione della fase non validi');}}
 const graph=new Map(phases.map(p=>[p.id,p])),visited=new Set<string>(),visiting=new Set<string>();const visit=(id:string)=>{if(visiting.has(id)){errors.push('Dipendenze cicliche');return;}if(visited.has(id))return;visiting.add(id);const p=graph.get(id)!;for(const dep of p.dependencies){const other=graph.get(dep);if(!other||dep===id)errors.push('Dipendenza inesistente o autoreferente');else{if(other.endDate>=p.startDate)errors.push('La fase inizia prima della fine della dipendenza');visit(dep);}}visiting.delete(id);visited.add(id);};for(const p of phases)visit(p.id);
 const lifecycles=new Map<string,{action:string;date:string}[]>();
 for(const phase of phases){const targets=new Set<string>();for(const target of phase.targets){const key=`${target.kind}:${target.id}`;if(targets.has(key))errors.push('Oggetto ripetuto nella stessa fase');targets.add(key);if(target.action==='close'||!validDate(phase.endDate)||!validDate(phase.startDate))continue;const events=lifecycles.get(key)??[];events.push({action:target.action,date:target.action==='construct'?constructionDate(phase):phase.startDate});lifecycles.set(key,events);}}
 for(const events of lifecycles.values()){events.sort((a,b)=>a.date.localeCompare(b.date));for(let i=1;i<events.length;i++)if(events[i]!.date===events[i-1]!.date||events[i]!.action===events[i-1]!.action)errors.push('Costruzione e demolizione dello stesso oggetto devono alternarsi in date distinte');}
 return[...new Set(errors)];
}
export function worksStage(phase:WorksPhase,date:string):'existing'|'construction'|'completed'{return date<phase.startDate?'existing':date>phase.endDate?'completed':'construction';}
/** Derived view only: authored objects and history remain the sole editable source. */
export function networkAtWorksDate(net:Network,date=net.clock?projectLocalTime(net.clock).date:''):Network{
 if(!net.works?.length||!date)return net;
 const roads={...net.roads},assets={...net.assets},removedBuildings={...net.removedBuildings};let changed=false;
 const events=new Map<string,{kind:'road'|'asset'|'building';id:string;action:'construct'|'demolish';date:string}[]>();
 for(const phase of net.works)for(const target of phase.targets){if(target.action==='close')continue;const key=`${target.kind}:${target.id}`,list=events.get(key)??[];list.push({...target,action:target.action,date:target.action==='construct'?constructionDate(phase):phase.startDate});events.set(key,list);}
 for(const list of events.values()){
  list.sort((a,b)=>a.date.localeCompare(b.date));let visible=list[0]!.action==='demolish';for(const event of list)if(event.date<=date)visible=event.action==='construct';
  const target=list[0]!;if(visible)continue;
  if(target.kind==='road'&&roads[target.id]){delete roads[target.id];changed=true;}
  else if(target.kind==='asset'&&assets[target.id]){assets[target.id]={...assets[target.id]!,state:'removed'};changed=true;}
  else if(target.kind==='building'){removedBuildings[target.id]=true;changed=true;}
 }
 for(const phase of net.works)if(worksStage(phase,date)==='construction')for(const target of phase.targets)if(target.action==='close'&&target.kind==='road'){
  const road=roads[target.id];if(!road)continue;roads[target.id]={...road,lanes:road.lanes.map(l=>({...l,restriction:'closed',restrictionSchedule:undefined})),restrictions:{...road.restrictions,motorVehicle:'no',schedule:undefined,note:`Cantiere: ${phase.name}`}};changed=true;
 }
 return changed?{...net,roads,assets,removedBuildings}:net;
}

export function worksSummary(phases:readonly WorksPhase[],date:string){return {budget:phases.reduce((s,p)=>s+p.budget,0),active:phases.filter(p=>worksStage(p,date)==='construction'),completed:phases.filter(p=>worksStage(p,date)==='completed'),planned:phases.filter(p=>worksStage(p,date)==='existing')};}
