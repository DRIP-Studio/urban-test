import {commit,useApp} from '../state/store';
let signal:AbortSignal|null=null;
export function setEliosSignal(value:AbortSignal|null){signal=value;}
/** Captures the task scope before awaiting data. Own commits advance the revision; foreign edits invalidate it. */
export function captureEliosScope(){
 const initial=useApp.getState(),project=initial.project?.id,scenario=initial.scenario?.id,cancellation=signal;
 let revision=JSON.stringify(initial.scenario?.operations);
 const assert=()=>{const s=useApp.getState();if(cancellation?.aborted)throw Error('Richiesta annullata');if(s.project?.id!==project||s.scenario?.id!==scenario||JSON.stringify(s.scenario?.operations)!==revision)throw Error('Scenario modificato durante il calcolo: ripetere sullo stato corrente');};
 return {assert,commit:<P>(type:string,payload:P)=>{assert();const result=commit(type,payload);revision=JSON.stringify(useApp.getState().scenario?.operations);return result;}};
}
