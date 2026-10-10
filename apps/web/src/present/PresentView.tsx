import {presentationHtml,presentationImageSources} from './interactiveExport';
import {SceneGraphics,SceneGraphicsEditor,type GraphicDataset} from './SceneGraphics';
import {useProjectClock,getProjectClock,getProjectTime,configureProjectClock} from '../state/projectTime';
import {useTwinUi} from '../twin/viewState';
import {NumberField,Field,Select} from '../ui/controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { networkAtWorksDate,type Network,NetworkReplayer,type PresentationScene,type PresentationDocument,type SimFrame } from '@drip-urban/core';
import type {StoredScenario} from '../api/types';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import type { FeatureCollection } from '../engine/geojson';
import { assetsFC,buildingsFC } from '../map/sources';
import { commit,newId, setMode, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { scenarioMetrics } from '../panels/ComparePanel';
import { CivicLockup, TechnicalLockup } from '../shell/Brand';
import { Button, Empty, Skeleton, TextField, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { BeforeAfter, type Camera } from './BeforeAfter';
import { setPendingCameraPath,setPendingTwinCamera } from '../twin/pending';

type Scene=PresentationScene;type PresentationDoc=PresentationDocument;

export function PresentView() {
  const project = useApp((s) => s.project);
  const {time:calendar}=useProjectClock();
  const baseline = useApp((s) => s.baseline);
  const scenario = useApp((s) => s.scenario);
  const net = useApp((s) => s.network);
  const catalogs = useApp((s) => s.catalogs);
  const [live,setLive]=useState<SimFrame|null>(engine.lastSim),[compareId,setCompareId]=useState('baseline');
  useEffect(()=>engine.onSim(frame=>setLive(frame)),[]);
  const [beforeNetwork,setBeforeNetwork]=useState<Network|null>(null);
  const [before, setBefore] = useState<{ surfaces: FeatureCollection; markings: FeatureCollection } | null>(null);
  const [doc, setDoc] = useState<PresentationDoc>({});
  const [active, setActive] = useState<number>(-1);
  const [htmlBusy,setHtmlBusy]=useState(false);
  const [htmlError,setHtmlError]=useState('');
  const [htmlDownload,setHtmlDownload]=useState<string|null>(null);
  const htmlUrl=useRef<string|null>(null);
  useEffect(()=>()=>{if(htmlUrl.current)URL.revokeObjectURL(htmlUrl.current);},[]);
  const [cameraReady,setCameraReady]=useState(false);
  const camera = useRef<Camera | null>(null);
  const [goto, setGoto] = useState<Camera | null>(null);
  useEffect(() => {let alive=true;const load=async()=>{setBefore(null);setBeforeNetwork(null);const date=calendar.date;const sc=compareId==='baseline'?null:await api.get<StoredScenario>(`/api/projects/${encodeURIComponent(project!.id)}/scenarios/${encodeURIComponent(compareId)}`);const result=await engine.job<{ surfaces: FeatureCollection; markings: FeatureCollection }>('physicalFor',{ops:sc?.operations??[],date});if(alive){setBefore(result);setBeforeNetwork(networkAtWorksDate(new NetworkReplayer().derive(baseline!,sc?.operations??[]).net,date));};};if(project)void load().catch(e=>toast.error('Confronto scenari',String(e)));return()=>{alive=false;};},[project?.id,compareId,baseline,calendar.date]);
  useEffect(() => {
    if (!project) return;
    const pid=project.id,sid=scenario?.id;api.get<PresentationDoc | null>(`/api/projects/${project.id}/docs/presentation`).then(d=>{const state=useApp.getState();if(state.project?.id!==pid||state.scenario?.id!==sid)return;const authored=state.network?.presentation;setDoc(authored??d??{});if(!authored&&d?.scenes?.length&&!state.scenario?.isBaseline)commit('presentation.set',{document:d});}).catch(()=>setDoc(useApp.getState().network?.presentation??{}));
  }, [project?.id,scenario?.id]);
  useEffect(()=>{setDoc(net?.presentation??{});},[net?.presentation]);
  const buildings = useMemo(() => (baseline ? buildingsFC(baseline,beforeNetwork?.removedBuildings,beforeNetwork?.buildingStyles) : null), [baseline,beforeNetwork]);
  const after = engine.lastPhysical;
  const permeable = useMemo(() => new Set(catalogs?.materials.items.filter((m) => m.permeable).map((m) => m.id)), [catalogs]);
  const metrics = useMemo(() => {
    if (!baseline || !net) return null;
    return { a: scenarioMetrics(beforeNetwork??new NetworkReplayer().derive(baseline, []).net, baseline, permeable), b: scenarioMetrics(net, baseline, permeable) };
  }, [baseline, net, permeable,beforeNetwork]);
  const assetShapes=useMemo(()=>net&&baseline&&catalogs?assetsFC(net,baseline.origin,new Map(catalogs.furniture.items.map(i=>[i.id,i]))).fp:null,[net,baseline,catalogs]);
  const afterBuildings=useMemo(()=>baseline?buildingsFC(baseline,net?.removedBuildings,net?.buildingStyles):null,[baseline,net?.removedBuildings,net?.buildingStyles]);
  const beforeAssets=useMemo(()=>beforeNetwork&&baseline&&catalogs?assetsFC(beforeNetwork,baseline.origin,new Map(catalogs.furniture.items.map(i=>[i.id,i]))).fp:undefined,[beforeNetwork,baseline,catalogs]);
  const beforeData=useMemo(()=>before&&buildings?{surfaces:before.surfaces,markings:before.markings,buildings,assets:beforeAssets,label:project?.scenarios.find(s=>s.id===compareId)?.name??'Oggi'}:null,[before,buildings,beforeAssets,project?.scenarios,compareId]);
  const afterData=useMemo(()=>after&&afterBuildings?{surfaces:after.surfaces,markings:after.markings,buildings:afterBuildings,assets:assetShapes??undefined,label:scenario?.isBaseline?'Oggi':'Progetto'}:null,[after,afterBuildings,assetShapes,scenario?.isBaseline]);
  // Open on the area that the scenario changes (falls back to the whole project).
  const initial = useMemo((): [number, number, number, number] | undefined => {
    const changed = engine.lastPhysical?.surfaces.features.filter((f) => f.properties.state === 'project') ?? [];
    const pts = changed.flatMap((f) => f.geometry.coordinates[0] ?? []);
    if (!pts.length) return project?.bbox as [number, number, number, number] | undefined;
    const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
    const pad = 0.0008;
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  }, [project]);
  if (!project || !baseline || !catalogs || !initial) return null;
  const save = async (d: PresentationDoc) => {
    setDoc(d);
    const result=commit('presentation.set',{document:d});if(!result.ok)setDoc(useApp.getState().network?.presentation??{});
  };
  const scenes = doc.scenes ?? [];
  const civic = !!doc.civic;
  const go = (i: number) => {
    const s = scenes[i];
    if (!s) return;
    setActive(i);
    if(s.clock)configureProjectClock(s.clock);
    if(s.liveSimulation){const time=getProjectTime();engine.simStart({...s.liveSimulation,day:time.day,hour:time.hour,clock:getProjectClock(),scale:1,scopeName:'Scena live · comune'});}
    if (s.twin) { setPendingTwinCamera(s.twin);if(s.path){setPendingCameraPath({points:s.path,durationS:s.durationS??12,caption:s.text,annotations:s.annotations??[],graphics:s.graphics});useTwinUi.setState({cameraMode:'cinematic',following:false});}setMode('twin'); return; }
    if (s.camera) setGoto({ ...s.camera });
  };
  const m = metrics;
  const datasets:GraphicDataset[]=m?[
    {id:'green',name:'Superfici drenanti',rows:[{label:'Prima',value:m.a.greenM2,color:'#898b7c'},{label:'Progetto',value:m.b.greenM2,color:'#528470'}],source:'Superfici del modello · scenarioMetrics',unit:'m²'},
    {id:'trees',name:'Alberi nel progetto',rows:[{label:'Prima',value:m.a.trees,color:'#898b7c'},{label:'Progetto',value:m.b.trees,color:'#528470'}],source:'Arredi presenti nel modello · scenarioMetrics',unit:'alberi'},
    ...(live?[{id:'flow',name:'Agenti del solver',rows:[{label:'Attivi',value:live.metrics.vehicles,color:'#277496'},{label:'Fermi',value:live.metrics.stopped,color:'#ce6f32'}],source:`Solver ${engine.lastSimOptions?.mode??''} · t ${live.metrics.t.toFixed(1)} s`,unit:'agenti'}]:[])]:[];
  const materialIds=new Set(afterData?.surfaces.features.map(f=>f.properties.material));
  const legend=catalogs.materials.items.filter(item=>materialIds.has(item.id)).map(item=>({label:item.label,value:1,color:item.color}));
  const exportHtml=async()=>{if(!beforeData||!afterData)return;setHtmlBusy(true);setHtmlError('');try{const images=await presentationImageSources(project.id,doc);if(useApp.getState().project?.id!==project.id)throw Error('Progetto cambiato durante esportazione');const html=presentationHtml(project.name,doc,beforeData,afterData,baseline.origin,catalogs.materials.items,live,images),url=URL.createObjectURL(new Blob([html],{type:'text/html'})),a=document.createElement('a');if(htmlUrl.current)URL.revokeObjectURL(htmlUrl.current);htmlUrl.current=url;setHtmlDownload(url);a.href=url;a.download='drip-racconto-interattivo.html';a.hidden=true;document.body.append(a);a.click();a.remove();}catch(error){setHtmlError(String(error));toast.error('Esportazione racconto',String(error));}finally{setHtmlBusy(false);}};
  return (
    <div className={`present ${civic ? 'is-civic' : ''}`}>
      <aside className="present-rail">
        <div className="present-brand">{civic ? <CivicLockup /> : <TechnicalLockup />}</div>
        <h1 className={civic ? 'editorial' : ''}>{project.name}</h1>
        <p className="muted">{scenario?.isBaseline ? 'Stato attuale' : `Scenario: ${scenario?.name}`}</p>
        <Toggle label="Versione civica (identità FST)" checked={civic} onChange={(v) => void save({ ...doc, civic: v })} />
        <Select ariaLabel="Scenario prima" value={compareId} onChange={setCompareId} options={(project.scenarios??[]).map(s=>({value:s.id,label:s.isBaseline?'Stato attuale':s.name}))}/>
        <ol className="scenes">
          {scenes.map((s, i) => (
            <li key={s.id} className={i === active ? 'is-on' : ''}>
              <button type="button" className="scene-pick" onClick={() => go(i)}><span className="scene-n">{String(i + 1).padStart(2, '0')}</span><span>{s.title}</span>{s.twin ? <Icon name="cube" size={14} /> : null}</button>
              <Button size="sm" variant="ghost" onClick={()=>setActive(i)}>Modifica scena {i+1}</Button>
              {i === active ? (
                <div className="scene-edit">
                  <TextField value={s.title} ariaLabel="Titolo scena" onCommit={(v) => void save({ ...doc, scenes: scenes.map((x) => (x.id === s.id ? { ...x, title: v } : x)) })} />
                  <TextField multiline value={s.text} ariaLabel="Testo scena" placeholder="Cosa deve vedere chi guarda" onCommit={(v) => void save({ ...doc, scenes: scenes.map((x) => (x.id === s.id ? { ...x, text: v } : x)) })} />
                  <Field label="Durata scena"><NumberField ariaLabel="Durata scena" value={s.durationS??12} min={1} max={3600} unit="s" onCommit={durationS=>void save({...doc,scenes:scenes.map(x=>x.id===s.id?{...x,durationS}:x)})}/></Field>
                  <Button size="sm" onClick={()=>void save({...doc,scenes:scenes.map(x=>x.id===s.id?{...x,clock:getProjectClock()}:x)})}>Associa tempo progetto</Button>
                  <Toggle label="Simulazione live nella scena" checked={Boolean(s.liveSimulation)} onChange={enabled=>void save({...doc,scenes:scenes.map(x=>x.id===s.id?{...x,liveSimulation:enabled?{mode:engine.lastSimOptions?.mode??'hybrid',dailyTrips:engine.lastSimOptions?.dailyTrips??60000,seed:engine.lastSimOptions?.seed??42}:undefined}:x)})}/>
                  {s.liveSimulation&&<Field label="Domanda dichiarata veicoli/giorno"><NumberField ariaLabel="Domanda scena live" value={s.liveSimulation.dailyTrips} min={0} max={10000000} decimals={0} onCommit={dailyTrips=>void save({...doc,scenes:scenes.map(x=>x.id===s.id?{...x,liveSimulation:{...s.liveSimulation!,dailyTrips}}:x)})}/></Field>}
                  <SceneGraphicsEditor scene={s} center={camera.current?.center??baseline.origin} datasets={datasets} legend={legend} onChange={updated=>void save({...doc,scenes:scenes.map(x=>x.id===s.id?updated:x)})}/>
                  <div className="row-actions">
                    <button type="button" className="link" onClick={() => camera.current && void save({ ...doc, scenes: scenes.map((x) => (x.id === s.id ? { ...x, camera: camera.current } : x)) })}>Aggiorna inquadratura</button>
                    <button type="button" className="link danger" onClick={() => { setActive(-1); void save({ ...doc, scenes: scenes.filter((x) => x.id !== s.id) }); }}>Elimina</button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {!scenes.length ? <p className="muted">Inquadra la mappa e aggiungi una scena; dal Twin salvi anche viste 3D.</p> : null}
        <Button icon="plus" disabled={!cameraReady} onClick={() => { if(!camera.current)return;const s: Scene = { id: newId('sc'), title: `Scena ${scenes.length + 1}`, text: '', camera: camera.current,clock:getProjectClock(),durationS:12 }; void save({ ...doc, scenes: [...scenes, s] }); setActive(scenes.length); }}>Aggiungi scena dall'inquadratura</Button>
        {scenes.length ? (
          <div className="present-nav">
            <Button icon="chevronLeft" disabled={active <= 0} onClick={() => go(active - 1)}>Precedente</Button>
            <Button icon="chevronRight" disabled={active >= scenes.length - 1} onClick={() => go(active + 1)}>Successiva</Button>
          </div>
        ) : null}
        <Button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'drip-presentation',version:2,projectId:project.id,scenarioId:scenario?.id,document:doc,metrics:m,clock:getProjectClock(),simulation:engine.lastSim?{options:engine.lastSimOptions,metrics:engine.lastSim.metrics}:null},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='drip-racconto.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Esporta racconto e dati</Button>
        <Button disabled={!beforeData||!afterData} busy={htmlBusy} onClick={()=>void exportHtml()}>Esporta presentazione interattiva HTML</Button>
        {htmlDownload?<a className="link" href={htmlDownload} download="drip-racconto-interattivo.html">Scarica HTML pronto</a>:null}
        {htmlError?<p role="alert">{htmlError}</p>:null}
        <Button onClick={()=>window.print()}>Stampa / PDF del racconto</Button>
      </aside>
      <section className="present-stage">
        <SceneGraphics graphics={active>=0?scenes[active]?.graphics:undefined} projectId={project.id}/>
        {beforeData && afterData ? (
          <BeforeAfter editorial={civic} materials={catalogs.materials.items} initial={initial} camera={goto} insetRight={250}
            onCamera={c=>{camera.current=c;setCameraReady(true);}}
            simulation={live} annotations={active>=0?scenes[active]?.annotations:undefined}
            before={beforeData} after={afterData} />
        ) : <Skeleton lines={6} />}
        {active >= 0 && scenes[active]?.text ? <div className={`scene-caption ${civic ? 'editorial' : ''}`}>{scenes[active]!.text}</div> : null}
        {live&&<div className="present-live" role="status">Solver live · {live.metrics.vehicles} agenti · t {live.metrics.t.toFixed(1)} s · attesa {live.metrics.stopped} · velocità {live.metrics.avgSpeedKmh.toFixed(1)} km/h</div>}
        {m && !scenes[active]?.graphics?.length ? (
          <div className="present-metrics">
            {[
              { l: 'Strade modificate', a: 0, b: m.b.roadsChanged, u: '' },
              { l: 'Superfici drenanti', a: Math.round(m.a.greenM2), b: Math.round(m.b.greenM2), u: ' m²' },
              { l: 'Alberi', a: m.a.trees, b: m.b.trees, u: '' },
              { l: 'Sosta su strada', a: Math.round(m.a.parkingM2), b: Math.round(m.b.parkingM2), u: ' m²' },
              { l: 'Incroci semaforizzati', a: m.a.signals, b: m.b.signals, u: '' },
            ].map((x) => <div key={x.l} className="pm"><span>{x.l}</span><strong>{x.b.toLocaleString('it-IT')}{x.u}</strong><small>oggi {x.a.toLocaleString('it-IT')}{x.u}</small></div>)}
          </div>
        ) : null}
        {!after ? <Empty icon="present" title="Modello in calcolo" /> : null}
      </section>
    </div>
  );
}
