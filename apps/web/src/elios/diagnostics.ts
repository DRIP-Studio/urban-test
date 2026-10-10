import { useEffect } from 'react';
import { create } from 'zustand';
import type { AuditItem } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { useApp } from '../state/store';

export const useDiagnostics = create<{items:AuditItem[];busy:boolean;error:string|null}>(()=>({items:[],busy:false,error:null}));
/** Debounced, local checks. These are evidence for the agent, not language-model claims. */
export function useProjectDiagnostics() {
  const revision=useApp(s=>s.netVersion), project=useApp(s=>s.project?.id), scenario=useApp(s=>s.scenario?.id);
  useEffect(()=>{
    let active=true;
    useDiagnostics.setState({items:[],busy:!!project,error:null});
    if(!project)return;
    const timer=setTimeout(()=>{
      void engine.job<AuditItem[]>('audit').then(items=>{
        if(active)useDiagnostics.setState({items:items.sort((a,b)=>Number(b.severity==='error')-Number(a.severity==='error')),busy:false});
      }).catch(error=>{if(active)useDiagnostics.setState({busy:false,error:error instanceof Error?error.message:String(error)});});
    },700);
    return()=>{active=false;clearTimeout(timer);};
  },[revision,project,scenario]);
}
