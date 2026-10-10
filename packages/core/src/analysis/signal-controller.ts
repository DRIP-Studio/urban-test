import type { SignalPlan, TurnKind } from '../model/types';
/** Detector-driven controller. Safety intervals and the validated conflict-free phase groups remain fixed. */
export class SignalController {
 private phase=0;private elapsed=0;private state:'green'|'yellow'|'red'='green';private gap=0;private ages:number[]=[];
 constructor(private plan:SignalPlan){this.ages=plan.phases.map(()=>0);}
 update(plan:SignalPlan,dt:number,demand:ReadonlyMap<string,number>){
  if(this.plan.phases!==plan.phases){this.phase=0;this.elapsed=0;this.state='red';this.gap=0;this.ages=plan.phases.map(()=>0);}
  this.plan=plan;this.elapsed+=dt;this.ages=this.ages.map((age,i)=>i===this.phase?0:age+dt);
  const ph=plan.phases[this.phase];if(!ph)return;
  const cfg=plan.actuation??{minGreenS:8,maxGreenS:45,gapOutS:3,extensionS:2.5};
  const volume=ph.greenGroups.reduce((sum,id)=>sum+(demand.get(id)??0),0);
  this.gap=volume>0?0:this.gap+dt;
  if(this.state==='green'){
   const minimum=Math.max(cfg.minGreenS,ph.pedestrianRoadIds.length?15:0);
   const maximum=Math.max(minimum,cfg.maxGreenS);
   if(this.elapsed>=maximum||this.elapsed>=minimum&&this.gap>=cfg.gapOutS+cfg.extensionS){this.state='yellow';this.elapsed=0;}
  }else if(this.state==='yellow'&&this.elapsed>=ph.yellowS){this.state='red';this.elapsed=0;}
  else if(this.state==='red'&&this.elapsed>=ph.allRedS){
   let next=(this.phase+1)%plan.phases.length;
   if(plan.mode==='adaptive'){
    let score=-Infinity;for(let i=0;i<plan.phases.length;i++){if(i===this.phase&&plan.phases.length>1)continue;const pedestrianBonus=plan.priority==='pedestrian'&&plan.phases[i]!.pedestrianRoadIds.length?5:0;const value=pedestrianBonus+plan.phases[i]!.greenGroups.reduce((sum,id)=>sum+(demand.get(id)??0),0)+this.ages[i]!/10;if(value>score){score=value;next=i;}}
   }
   this.phase=next;this.state='green';this.elapsed=0;this.gap=0;
  }
 }
 aspect(groupId:string,turn?:TurnKind):'green'|'yellow'|'red'{
  const ph=this.plan.phases[this.phase];if(!ph)return'red';
  if(groupId.startsWith('ped:'))return ph.pedestrianRoadIds.includes(groupId.slice(4))&&this.state==='green'?this.elapsed<Math.max(15,this.plan.actuation?.minGreenS??8)-5?'green':'yellow':'red';
  return ph.greenGroups.includes(groupId)&&(!turn||!ph.greenMovements?.[groupId]||ph.greenMovements[groupId]!.includes(turn))?this.state:'red';
 }
}
