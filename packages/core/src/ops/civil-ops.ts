import {roadWithAxis} from '../analysis/road-axis';
import type {HorizontalDesign,CorridorAssembly,Road} from '../model/types';
import {designAlignment,alignmentDesignErrors,corridorErrors} from '../analysis/civil';
import {defineOperation} from './registry';
export const setHorizontalDesign=defineOperation<{roadId:string;design:HorizontalDesign}>({
 type:'road.setAlignment',label:()=> 'Tracciato analitico: rettifili, archi e clotoidi',
 validate:(net,p)=>{
  if(!net.roads[p.roadId]||net.roads[p.roadId]!.from===net.roads[p.roadId]!.to||net.roads[p.roadId]!.tags?.roundabout)return[{code:'alignment.road',severity:'error',message:'Strada inesistente o asse non modificabile'}];
  const errors=alignmentDesignErrors(p.design);if(errors.length)return errors.map(message=>({code:'alignment.invalid',severity:'error' as const,message}));
  try{setHorizontalDesign.apply(net,p);return[];}catch(e){return[{code:'alignment.profile',severity:'error',message:String(e)}];}
 },
 apply:(net,p)=>{const road=net.roads[p.roadId]!,designed=designAlignment(net.nodes[road.from]!.at,p.design),end=designed.axis.at(-1)!,roads:Record<string,Road>={...net.roads};
  for(const connected of Object.values(roads))if(connected.id!==road.id&&(connected.from===road.to||connected.to===road.to)){const axis=[...connected.axis];if(connected.from===road.to)axis[0]=end;if(connected.to===road.to)axis[axis.length-1]=end;roads[connected.id]=roadWithAxis(connected,axis);}
  roads[road.id]={...roadWithAxis(road,designed.axis),alignment:p.design,provenance:{...road.provenance,geometry:{kind:'project',source:'Tracciato analitico DRIP Urban'}}};
  return{...net,roads,nodes:{...net.nodes,[road.to]:{...net.nodes[road.to]!,at:end}}};
 }
});
export const setCorridor=defineOperation<{roadId:string;corridor:CorridorAssembly|null}>({type:'road.setCorridor',label:()=> 'Assembly e pendenze del corridoio',validate:(net,p)=>!net.roads[p.roadId]?[{code:'corridor.road',severity:'error',message:'Strada inesistente'}]:p.corridor?corridorErrors(p.corridor).map(message=>({code:'corridor.invalid',severity:'error',message})):[],apply:(net,p)=>({...net,roads:{...net.roads,[p.roadId]:{...net.roads[p.roadId]!,corridor:p.corridor??undefined}}})});
