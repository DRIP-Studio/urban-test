import {useEffect,useState} from 'react';
import {sampleTerrain,underpassDesign,type Road,type UnderpassDesign} from '@drip-urban/core';
import {commit} from '../state/store';
import {useTerrain} from '../state/terrain';
import {Button,Field,NumberField,Section,Select} from '../ui/controls';
export function UnderpassEditor({road}:{road:Road}) {
 const grid=useTerrain(s=>s.grid),existing=road.structure?.underpass;
 const initial=(end:boolean)=>{const p=road.axis[end?road.axis.length-1:0]!;return road.vertical?.pvis[end?road.vertical.pvis.length-1:0]?.elevation??(grid?sampleTerrain(grid,p[0],p[1]):0);};
 const readDesign=():UnderpassDesign=>({usage:existing?.usage??'road',depthM:road.structure?.heightM??6,clearanceM:existing?.clearanceM??4.5,slabM:existing?.slabM??.5,rampLengthM:existing?.rampLengthM??80,maxGradePct:existing?.maxGradePct??8,entryElevationM:initial(false),exitElevationM:initial(true)});
 const [design,setDesign]=useState<UnderpassDesign>(readDesign);
 useEffect(()=>setDesign(readDesign()),[road.id,road.structure,road.vertical]);
 const result=underpassDesign(road,design),set=(change:Partial<UnderpassDesign>)=>setDesign(d=>({...d,...change}));
 return <Section title="Sottopasso stradale / pedonale" defaultOpen={!!existing}>
  <Select ariaLabel="Uso sottopasso" value={design.usage} options={[{value:'road',label:'Stradale'},{value:'pedestrian',label:'Pedonale'}]} onChange={usage=>set({usage:usage as UnderpassDesign['usage'],...(usage==='pedestrian'?{clearanceM:2.5,depthM:3,maxGradePct:5}: {})})}/>
  <div className="grid-2">{([
   ['entryElevationM','Quota ingresso',-500,9000],['exitElevationM','Quota uscita',-500,9000],['depthM','Profondità sottopasso',.1,40],['clearanceM','Luce libera',2,12],['slabM','Spessore soletta',.15,3],['rampLengthM','Lunghezza di ogni rampa',1,10000],['maxGradePct','Pendenza limite progetto',.1,design.usage==='pedestrian'?8:12]
  ] as const).map(([key,label,min,max])=><Field key={key} label={label}><NumberField ariaLabel={label} value={design[key]} min={min} max={max} unit={key==='maxGradePct'?'%':'m'} decimals={2} onCommit={v=>set({[key]:v})}/></Field>)}</div>
  <p className="muted">Quote assolute del profilo {grid?'inizializzate dal DTM o dal profilo esistente':'da dichiarare: nessun DTM disponibile'}. Il valore 0 senza rilievo è un riferimento di progetto, non la quota misurata.</p>
  <p className="mono">Coperto {result.coveredLengthM.toFixed(1)} m · rampe {result.entryGradePct.toFixed(2)} / {result.exitGradePct.toFixed(2)}% · fondo {result.floorM.toFixed(2)} m</p>
  {result.errors.map(message=><p className="muted" key={message} role="status">{message}</p>)}
  <Button disabled={result.errors.length>0} onClick={()=>commit('road.setUnderpass',{roadId:road.id,design})}>Applica sottopasso e profilo</Button>{existing&&<Button onClick={()=>commit('road.setStructure',{roadIds:[road.id],structure:null})}>Ripristina strada a raso</Button>}
  <p className="muted">Mantiene ingressi e uscite collegati. L’uso pedonale esclude veicoli dal grafo. Il Twin mostra pareti e soletta; per vedere sotto la superficie usa la vista sottosuolo. Verifica separatamente drenaggio, raccordi verticali e compatibilità con i rilievi.</p>
 </Section>;
}
