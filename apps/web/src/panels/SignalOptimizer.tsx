import { useEffect,useRef,useState } from 'react';
import { activeSignalPlan,analyzeSignalJunction,rescalePlan,DEFAULT_TRAFFIC,planIssues,windowActive,type CityBaseline,type JunctionAnalysis,type LabResult,type Operation,type SignalPlan } from '@drip-urban/core';
import { api } from '../api/client';
import { getProjectClock,getProjectTime } from '../state/projectTime';
import { useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button,Field,NumberField,Section,Select } from '../ui/controls';
interface Candidate {id:string;label:string;plan:SignalPlan;plans?:SignalPlan[];result?:LabResult;}
export function SignalOptimizer({plan,analysis,onChoose}:{plan:SignalPlan;analysis:JunctionAnalysis;onChoose:(plans:SignalPlan[])=>void}){
 const [duration,setDuration]=useState(180),[daily,setDaily]=useState(60000),[objective,setObjective]=useState('queues'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[candidates,setCandidates]=useState<Candidate[]>([]);
 const [scope,setScope]=useState('junction');
 const worker=useRef<Worker|null>(null),generation=useRef(0);
 useEffect(()=>()=>{generation.current++;worker.current?.terminate();},[]);
 const cancel=()=>{generation.current++;worker.current?.terminate();worker.current=null;setBusy(false);setProgress('Valutazione annullata');};
 const start=async()=>{
  const own=++generation.current;setBusy(true);setCandidates([]);
  try{
   const state=useApp.getState();if(!state.baseline||!state.scenario||!state.project)throw Error('Progetto non disponibile');
   const at=getProjectTime(),effective=activeSignalPlan(plan,at),programme=plan.programmes?.findIndex(p=>windowActive(p.schedule,at.holiday?6:at.day,at.minutes))??-1;
   const withTiming=(timing:SignalPlan):SignalPlan=>programme<0?{...timing,programmes:plan.programmes}:{...plan,programmes:plan.programmes!.map((p,i)=>i===programme?{...p,cycleS:timing.cycleS,offsetS:timing.offsetS,phases:timing.phases}:p)};
   const options:Candidate[]=[{id:'base',label:'Piano corrente',plan}];
   for(const ratio of [.8,1.2]){
    const phases=effective.phases.map(ph=>({...ph,greenS:Math.max(10,Math.round(ph.greenS*ratio))})),cycleS=phases.reduce((sum,ph)=>sum+ph.greenS+ph.yellowS+ph.allRedS,0);
    if(cycleS<=240)options.push({id:`cycle${ratio}`,label:`Ciclo ${cycleS} s`,plan:withTiming({...effective,cycleS,offsetS:effective.offsetS%cycleS,phases})});
   }
   for(const fraction of [.25,.5,.75])options.push({id:`offset${fraction}`,label:`Offset ${Math.round(effective.cycleS*fraction)} s`,plan:withTiming({...effective,offsetS:Math.round(effective.cycleS*fraction)})});
   for(const mode of ['actuated','adaptive'] as const)options.push({id:mode,label:mode==='actuated'?'Attuato con detector':'Adattivo con priorità TPL',plan:{...plan,mode,actuation:plan.actuation??{minGreenS:10,maxGreenS:45,gapOutS:3,extensionS:2.5}}});
   for(const priority of ['tpl','emergency','pedestrian','balanced'] as const)options.push({id:priority,label:`Priorità ${priority}`,plan:{...plan,mode:'adaptive',priority,actuation:plan.actuation??{minGreenS:10,maxGreenS:45,gapOutS:3,extensionS:2.5}}});
   for(let k=1;k<effective.phases.length;k++){
    const phases=[...effective.phases.slice(k),...effective.phases.slice(0,k)];options.push({id:`sequence${k}`,label:`Sequenza fase ${k+1}`,plan:withTiming({...effective,phases})});
    const phasesSplit=effective.phases.map((ph,i)=>({...ph,greenS:Math.max(ph.pedestrianRoadIds.length?10:5,Math.round(ph.greenS*(i===k?1.25:.9)))}));
    options.push({id:`split${k}`,label:`Più verde fase ${k+1}`,plan:withTiming({...effective,phases:phasesSplit,cycleS:phasesSplit.reduce((sum,ph)=>sum+ph.greenS+ph.yellowS+ph.allRedS,0)})});
   }
   const targets=Object.values(state.network!.signalPlans).filter(p=>p.id!==plan.id&&(scope==='network'||scope==='corridor'&&p.coordination?.id&&p.coordination.id===plan.coordination?.id));
   const analyses=new Map([[plan.id,analysis],...targets.flatMap(p=>{const a=analyzeSignalJunction(state.network!,baselineOrigin(state.baseline!),p);return a?[[p.id,a] as const]:[];})]);
   for(const candidate of options){candidate.plans=[candidate.plan,...targets.map((target,i)=>{
     if(candidate.id.startsWith('offset'))return {...target,offsetS:Math.round(target.cycleS*Number(candidate.id.slice(6))*(i+1))%target.cycleS};
     if(candidate.id.startsWith('cycle'))return rescalePlan(target,Math.max(20,Math.min(240,Math.round(target.cycleS*Number(candidate.id.slice(5))))));
     if(candidate.plan.mode==='adaptive'||candidate.plan.mode==='actuated')return {...target,mode:candidate.plan.mode,priority:candidate.plan.priority,actuation:candidate.plan.actuation};
     return target;
   })];}
   const valid=options.filter(c=>c.plans!.every(p=>{const a=analyses.get(p.id);return a&&planIssues(p,a).length===0;}));setCandidates(valid);setProgress('Caricamento rete…');
   const baseline=state.project.large?await api.get<CityBaseline>(`/api/projects/${state.project.id}/baseline`):state.baseline;
   if(own!==generation.current)return;
   const w=new Worker(new URL('../engine/scenarioLab.worker.ts',import.meta.url),{type:'module'});worker.current=w;
   w.onmessage=(event)=>{if(worker.current!==w)return;const m=event.data;if(m.type==='progress')setProgress(`${m.id} · ${Math.round(m.elapsedS)} / ${duration} s`);if(m.type==='result')setCandidates(list=>list.map(c=>c.id===m.id?{...c,result:m.result}:c));if(m.type==='complete'||m.type==='error'){w.terminate();worker.current=null;setBusy(false);setProgress(m.type==='complete'?'Valutazione completata':'Errore');if(m.type==='error')toast.error('Ottimizzazione',m.message);}};
   w.onerror=e=>{cancel();toast.error('Ottimizzazione',e.message);};
   w.postMessage({type:'run',baseline,candidates:valid.map(c=>({id:c.id,operations:[...state.scenario!.operations,...c.plans!.map((p,i)=>{const a=analyses.get(p.id)!;return {id:`opt-${c.id}-${i}`,type:'signal.setPlan',at:new Date().toISOString(),author:'Signal optimizer',payload:{plan:p,conflicts:a.incompatible,movementConflicts:a.movementConflicts,permissivePairs:a.permissivePairs,groupTurns:Object.fromEntries(a.groups.map(g=>[g.id,g.turns]))}} as Operation;})]})),settings:{clock:{...getProjectClock(),durationS:duration},traffic:{...DEFAULT_TRAFFIC,dailyTrips:daily},seed:42,mode:'microscopic',co2GPerKm:160,idleCo2GPerSecond:1}});
  }catch(e){setBusy(false);toast.error('Ottimizzazione',String(e));}
 };
 const score=(r:LabResult)=>objective==='throughput'?-r.metrics.completed+(r.metrics.waitingDemand??0):objective==='pedestrian'?-r.pedestrianGreenFraction*100+r.peakQueuedVehicles*.1:objective==='emergency'?(r.metrics.classes?.find(c=>c.cls==='emergency')?.avgDelayS??0)+r.peakQueuedVehicles*.1:objective==='balanced'?r.metrics.avgDelayS+r.peakQueuedVehicles+(r.metrics.waitingDemand??0)-r.pedestrianGreenFraction*10:objective==='tpl'?((r.metrics.transit??[]).reduce((sum,t)=>sum+t.meanDepartureDelayS+t.passengerWaitS+t.waiting,0)+r.metrics.avgDelayS):objective==='delay'?r.metrics.avgDelayS+r.peakStopped+r.metrics.waitingDemand!:r.peakQueuedVehicles+r.peakStopped+r.metrics.waitingDemand!;
 const ranked=candidates.filter(c=>c.result).sort((a,b)=>score(a.result!)-score(b.result!));
 return <Section title="Ottimizzazione verificata nel solver" defaultOpen={false}>
  <Select ariaLabel="Ambito ottimizzazione" value={scope} options={[{value:'junction',label:'Incrocio selezionato'},...(plan.coordination?.id?[{value:'corridor',label:'Corridoio coordinato'}]:[]),{value:'network',label:'Tutti i piani della rete'}]} onChange={setScope}/>
  <div className="grid-2"><Field label="Durata prova"><NumberField ariaLabel="Durata ottimizzazione" value={duration} unit="s" min={30} max={3600} onCommit={setDuration}/></Field><Field label="Domanda giornaliera"><NumberField ariaLabel="Domanda ottimizzazione" value={daily} min={0} max={1000000} onCommit={setDaily}/></Field></div>
  <Select ariaLabel="Obiettivo ottimizzazione" value={objective} options={[{value:'queues',label:'Code e domanda in attesa'},{value:'delay',label:'Ritardi e arresti'},{value:'tpl',label:'Regolarità TPL'},{value:'throughput',label:'Arrivi e throughput'},{value:'pedestrian',label:'Disponibilità verde pedonale'},{value:'emergency',label:'Ritardi emergenze'},{value:'balanced',label:'Multimodale bilanciato'}]} onChange={setObjective}/>
  <Button icon="sparkle" disabled={busy} onClick={()=>void start()}>Confronta cicli, offset e controller</Button>{busy&&<Button onClick={cancel}>Annulla</Button>}<p aria-live="polite" className="muted">{progress}</p>
  {ranked.length>0&&<div className="lab-table-scroll"><table className="lab-table"><thead><tr><th>Piano</th><th>Coda max</th><th>Ritardo arrivi · s</th><th>Arrivati</th><th>Domanda in attesa</th><th/></tr></thead><tbody>{ranked.map(c=><tr key={c.id}><th>{c.label}</th><td>{c.result!.peakQueuedVehicles}</td><td>{c.result!.metrics.avgDelayS}</td><td>{c.result!.metrics.completed}</td><td>{c.result!.metrics.waitingDemand}</td><td><Button size="sm" disabled={busy} onClick={()=>onChoose(c.plans!)}>Usa candidato</Button></td></tr>)}</tbody></table></div>}
  <p className="muted">Stessa rete, clock, domanda e seed per ogni candidato. Nessuna modifica finché scegli un risultato e applichi il piano. La graduatoria riguarda la finestra provata: controlla arrivi, code e domanda residua; non è certificazione della rete né optimum globale.</p>
 </Section>;
}

function baselineOrigin(b:CityBaseline){return b.origin;}
