import {useEffect,useRef,useState} from 'react';
import {gradingErrors,sampleTerrain,type Area,type gradingQuantities} from '@drip-urban/core';
import {engine} from '../engine/engine';
import {commit,useApp} from '../state/store';
import {useTerrain} from '../state/terrain';
import {Button,Field,NumberField,Section,Stat,Toggle} from '../ui/controls';
import {GeometryEditor} from './GeometryEditor';
export function GradingEditor({area}:{area:Area}) {
 const grid=useTerrain(s=>s.grid),[draft,setDraft]=useState<NonNullable<Area['grading']>>(area.grading??{elevationM:grid?sampleTerrain(grid,...area.polygon[0]!):0,eastPct:0,northPct:0,cutSlope:1,fillSlope:1.5,maxDaylightM:10,retaining:false}),[step,setStep]=useState(2),[result,setResult]=useState<ReturnType<typeof gradingQuantities>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setResult(null);if(area.grading)setDraft(area.grading);},[area,grid]);
 const candidate={...area,grading:draft},errors=gradingErrors(candidate);
 const draftRevision=useRef('');draftRevision.current=JSON.stringify({candidate,step});
 const evaluate=async()=>{const version=draftRevision.current,current=useApp.getState().network,terrain=useTerrain.getState().grid;setBusy(true);setError('');try{const result=await engine.job<ReturnType<typeof gradingQuantities>>('grading',{area:candidate,terrain,stepM:step});if(useApp.getState().network===current&&useTerrain.getState().grid===terrain&&draftRevision.current===version)setResult(result);}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <Section title="Grading piattaforma e raccordi al terreno" defaultOpen={Boolean(area.grading)}>
  <div className="grid-2">{([['elevationM','Quota piattaforma',-500,9000,'m'],['eastPct','Pendenza est',-30,30,'%'],['northPct','Pendenza nord',-30,30,'%'],['cutSlope','Scarpata piattaforma sterro H/V',.1,5,''],['fillSlope','Scarpata piattaforma riporto H/V',.1,5,''],['maxDaylightM','Estensione massima scarpate',0,200,'m']] as const).map(([key,label,min,max,unit])=><Field key={key} label={label}><NumberField ariaLabel={label} value={draft[key]} min={min} max={max} unit={unit} decimals={3} onCommit={v=>{setDraft({...draft,[key]:v});setResult(null);}}/></Field>)}</div>
  <Toggle label="Contenimento verticale al bordo" checked={draft.retaining} onChange={retaining=>{setDraft({...draft,retaining});setResult(null);}}/>
  <p className="muted">Quota al primo vertice, piano ENU est/nord. Scarpate H/V verso il DTM, contenimento verticale se selezionato. {grid?`Terreno: ${grid.source}`:'DTM assente: dichiara quota di progetto; volumi non disponibili.'}</p>
  <GeometryEditor points={area.polygon} closed onCommit={polygon=>commit('area.set',{area:{...area,polygon}})}/>
  {errors.map(e=><p key={e} className="muted" role="status">{e}</p>)}
  <Button disabled={errors.length>0} onClick={()=>commit('area.set',{area:candidate})}>Applica grading</Button>{area.grading&&<Button onClick={()=>commit('area.set',{area:{...area,grading:undefined}})}>Rimuovi grading</Button>}
  <Field label="Passo integrazione"><NumberField ariaLabel="Passo integrazione grading" value={step} min={.25} max={50} unit="m" onCommit={v=>{setStep(v);setResult(null);}}/></Field>
  <Button disabled={!grid||busy||errors.length>0} onClick={()=>void evaluate()}>{busy?'Calcolo nel worker…':'Calcola sterro e riporto piattaforma'}</Button><p role="status">{error}</p>
  {result&&<><div className="stats-row"><Stat label="Sterro piattaforma" value={result.cutM3.toFixed(2)} unit="m³"/><Stat label="Riporto piattaforma" value={result.fillM3.toFixed(2)} unit="m³"/></div><p className="muted">{result.method} Dati mancanti: {result.missingM2.toFixed(2)} m².</p><Button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'drip-grading',area:candidate,result},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='drip-grading.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Esporta quantità grading</Button></>}
 </Section>;
}
