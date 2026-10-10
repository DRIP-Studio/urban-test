import {windowActive,type TimeWindow,type TrafficState,type TrafficObservation,type TrafficSourceMode,type Asset,type LngLat} from '@drip-urban/core';
import {getProjectTime} from '../state/projectTime';
import {engine} from '../engine/engine';
import {create} from 'zustand';
import {VMS_CHARS,vmsPages} from '../map/ledPanels';
import {api} from '../api/client';
import {fc,type Feature} from '../engine/geojson';
import {getMap,setSource,toggleLayer} from '../map/mapStore';
import {commit,useApp} from '../state/store';

export interface LiveState {
 status:'idle'|'ok'|'not_configured'|'error';provider?:string;capturedAt?:string|null;retrievedAt?:string;message?:string;
 flow:Feature[];incidents:Feature[];auto:boolean;busy:boolean;intervalMin:number;
 traffic:TrafficState|null;computing:boolean;history:TrafficObservation[];historyAt:string|null;lastSuccess?:string;
}
export const useLive=create<LiveState>(()=>({status:'idle',flow:[],incidents:[],auto:false,busy:false,intervalMin:3,traffic:null,computing:false,history:[],historyAt:null}));
interface LiveResult {status:'ok'|'not_configured'|'error';provider:string;capturedAt?:string|null;retrievedAt?:string;message?:string;features:Feature[];incidents?:Feature[];incidentsStatus?:string;incidentsMessage?:string;}
interface TrafficDoc {captures?:{at:string;day:number;hour:number;meanRatio:number;segments:number}[];observations?:TrafficObservation[];}
let generation=0,calculation=0,timer=0,moveTimer=0,rebuildTimer=0;
const ratio=(f:Feature)=>Number(f.properties.speedKmh)/Math.max(1,Number(f.properties.freeFlowKmh));
export const trafficSourceMode=():TrafficSourceMode=>useApp.getState().network?.environment?.trafficSource??'simulated';
export function liveFreshness(now=Date.now(), s:LiveState=useLive.getState()):'fresh'|'stale'|'unknown'{const capture=Date.parse(s.capturedAt??''),retrieved=Date.parse(s.retrievedAt??'');return !Number.isFinite(capture)||!Number.isFinite(retrieved)?'unknown':now-capture>300000||now-retrieved>300000||capture>now+30000?'stale':'fresh';}
function viewBbox():number[]|null{
 const m=getMap(),b=m?.getBounds(),bb=b?[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]:useApp.getState().project?.bbox;
 if(!bb)return null;const max=.045;if((bb[2]!-bb[0]!)*(bb[3]!-bb[1]!)<=max)return [...bb];
 const x=(bb[0]!+bb[2]!)/2,y=(bb[1]!+bb[3]!)/2,h=Math.sqrt(max)/2;return[x-h,y-h,x+h,y+h];
}
function observations(s:LiveState):TrafficObservation[]{
 const convert=(f:Feature,i:number,incident=false):TrafficObservation=>{const p=f.properties,points=f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates;
  return{id:String(p.id??`flow-${i}`),geometry:points as LngLat[],source:'live',provider:s.provider??'Provider',capturedAt:(p.capturedAt??s.capturedAt??null) as string|null,retrievedAt:String(p.retrievedAt??s.retrievedAt??''),speedKmh:incident?null:typeof p.speedKmh==='number'?p.speedKmh:null,freeFlowKmh:typeof p.freeFlowKmh==='number'?p.freeFlowKmh:undefined,flowVph:typeof p.flowVph==='number'?p.flowVph:null,densityVehKm:typeof p.densityVehKm==='number'?p.densityVehKm:null,confidence:typeof p.confidence==='number'?p.confidence:incident ? .7 : 0,closed:!!p.roadClosed||p.traversability==='closed',expiresAt:p.end?String(p.end):undefined};};
 return [...s.flow.map((f,i)=>convert(f,i)),...s.incidents.filter(f=>f.properties.roadClosed&&(!f.properties.start||Date.parse(String(f.properties.start))<=Date.now())).map((f,i)=>convert(f,i,true))];
}
export function drawLive():void{
 const s=useLive.getState(),net=useApp.getState().network,traffic=s.traffic;
 if(!net||!traffic){setSource('traffic',null);setSource('incidents',null);return;}
 setSource('traffic',fc(Object.values(traffic.segments).flatMap((segment):Feature[]=>{const road=net.roads[segment.roadId];return road?[{type:'Feature',geometry:{type:'LineString',coordinates:(segment.forward?road.axis:[...road.axis].reverse()).map(p=>[...p])},properties:{...segment,id:`${road.id}:${segment.forward}`,ratio:segment.closed?0:segment.speedKmh===null?1:segment.speedKmh/Math.max(1,road.speedKmh),vol:segment.flowVph}}]:[];})));
 const incidents=liveFreshness()==='fresh'&&s.status==='ok'&&(traffic.mode==='live'||traffic.mode==='hybrid')?s.incidents:[];
 const pins:Feature[]=incidents.map(f=>({type:'Feature',geometry:{type:'Point',coordinates:f.geometry.type==='Point'?f.geometry.coordinates as number[]:(f.geometry.coordinates as number[][])[0]!},properties:{...f.properties,pin:1}}));setSource('incidents',fc([...incidents,...pins]));
}
export async function refreshTrafficState(dailyTrips?:number):Promise<TrafficState|null>{
 clearTimeout(rebuildTimer);
 const state=useApp.getState(),pid=state.project?.id,sid=state.scenario?.id,revision=state.scenario?.operations,request=++calculation;
 if(!state.network||!state.baseline)return null;const mode=trafficSourceMode(),s=useLive.getState(),time=getProjectTime();useLive.setState({computing:true});
 try{const result=await engine.job<TrafficState>('trafficState',{mode,observations:mode==='historical'?s.history:s.status==='ok'?observations(s):[],now:Date.now(),params:{day:time.day,hour:time.minutes/60,date:time.date,holiday:time.holiday,...(dailyTrips===undefined?{}:{dailyTrips})}});
  const current=useApp.getState();if(current.project?.id!==pid||current.scenario?.id!==sid||current.scenario?.operations!==revision)return null;
  if(request===calculation){useLive.setState({traffic:result,computing:false});drawLive();}return result;
 }catch(error){if(request===calculation)useLive.setState({computing:false,message:`Analisi traffico: ${error instanceof Error?error.message:String(error)}`});return null;}
 finally{if(request===calculation)useLive.setState({computing:false});}
}
export function setTrafficSource(mode:TrafficSourceMode){const result=commit('environment.set',{trafficSource:mode});if(!result.ok)throw Error(result.issues.map(i=>i.message).join(' · '));if(mode==='live'||mode==='hybrid')void refreshLive({archive:false});else void refreshTrafficState();return result;}
export async function refreshLive(opts:{archive?:boolean}={}):Promise<LiveState>{
 const project=useApp.getState().project,bb=viewBbox();if(!bb||!project||useLive.getState().busy)return useLive.getState();const request=++generation;useLive.setState({busy:true});
 try{const r=await api.get<LiveResult>(`/api/traffic/live?bbox=${bb.map(x=>x.toFixed(5)).join(',')}`);if(request!==generation||useApp.getState().project?.id!==project.id)return useLive.getState();
  useLive.setState({status:r.status,provider:r.provider,capturedAt:r.capturedAt,retrievedAt:r.retrievedAt,message:r.message??(r.incidentsStatus==='error'?`Incidenti non disponibili: ${r.incidentsMessage??'riprovare'}`:undefined),flow:r.features??[],incidents:r.incidents??[],...(r.status==='ok'?{lastSuccess:r.retrievedAt}:{})});
  await refreshTrafficState();toggleLayer('traffic',true);toggleLayer('incidents',true);
  if(opts.archive!==false&&r.status==='ok'&&liveFreshness()==='fresh'&&r.features.length){
   const valid=r.features.map(ratio).filter(Number.isFinite),doc=await api.get<TrafficDoc|null>(`/api/projects/${project.id}/docs/traffic`)??{};if(request!==generation||useApp.getState().project?.id!==project.id)return useLive.getState();
   const at=r.capturedAt!,date=new Date(at),saved=observations(useLive.getState()).filter(o=>o.speedKmh!==null).map(o=>({...o,source:'historical' as const}));
   const old=(doc.observations??[]).filter(o=>o.capturedAt!==at),captures=[...(doc.captures??[]).filter(c=>c.at!==at),{at,day:(date.getDay()+6)%7,hour:date.getHours(),meanRatio:valid.reduce((a,b)=>a+b,0)/Math.max(1,valid.length),segments:valid.length}].slice(-2000);
   await api.put(`/api/projects/${project.id}/docs/traffic`,{...doc,captures,observations:[...old,...saved].slice(-20000)});
  }
 }catch(error){if(request===generation){useLive.setState({status:'error',message:error instanceof Error?error.message:String(error),flow:[],incidents:[]});await refreshTrafficState();}}
 finally{if(request===generation)useLive.setState({busy:false});}return useLive.getState();
}
export async function loadTrafficHistory(at?:string){const pid=useApp.getState().project?.id;if(!pid)return[];const doc=await api.get<TrafficDoc|null>(`/api/projects/${pid}/docs/traffic`);if(useApp.getState().project?.id!==pid)return[];const all=doc?.observations??[],times=[...new Set(all.map(o=>o.capturedAt).filter((t):t is string=>!!t))].sort(),selected=at??times.at(-1)??null;useLive.setState({history:all.filter(o=>o.capturedAt===selected),historyAt:selected});await refreshTrafficState();return times;}
const onMove=()=>{clearTimeout(moveTimer);moveTimer=window.setTimeout(()=>void refreshLive({archive:false}),1500);};
export function setLiveAuto(on:boolean,intervalMin=useLive.getState().intervalMin){clearInterval(timer);getMap()?.off('moveend',onMove);useLive.setState({auto:on,intervalMin:Math.max(1,Math.min(30,intervalMin))});if(!on)return;timer=window.setInterval(()=>{if(!document.hidden)void refreshLive();},intervalMin*60000);getMap()?.on('moveend',onMove);void refreshLive();}
export function stopLive(){setLiveAuto(false);clearTimeout(moveTimer);setSource('incidents',null);}
useApp.subscribe((state,previous)=>{
 if(state.project?.id!==previous.project?.id){generation++;calculation++;stopLive();useLive.setState({status:'idle',flow:[],incidents:[],traffic:null,history:[],historyAt:null,busy:false,computing:false,capturedAt:null,retrievedAt:undefined,lastSuccess:undefined,message:undefined});}
 if(state.network!==previous.network&&state.project){clearTimeout(rebuildTimer);rebuildTimer=window.setTimeout(()=>void refreshTrafficState(),600);}
});
/** Called by the workspace lifecycle; data expires even when automatic network refresh is off. */
export function installTrafficFreshness(){const id=window.setInterval(()=>{const mode=trafficSourceMode();if((mode==='live'||mode==='hybrid')&&liveFreshness()!=='fresh'&&Object.values(useLive.getState().traffic?.segments??{}).some(s=>s.source==='live'))void refreshTrafficState();},15000);return()=>{clearInterval(id);stopLive();};}

// ------------------------------------------------------------------ variable-message panels (PMV)

const M_PER_DEG = 111_320;
function distM(a: readonly number[], b: readonly number[]): number {
  const k = Math.cos((a[1]! * Math.PI) / 180);
  return Math.hypot((a[0]! - b[0]!) * M_PER_DEG * k, (a[1]! - b[1]!) * M_PER_DEG);
}
function nearestM(at: LngLat, f: Feature): number {
  const g = f.geometry;
  const pts = g.type === 'Point' ? [g.coordinates as number[]] : (g.coordinates as number[][]);
  return Math.min(...pts.map((p) => distM(at, p)));
}
const round100 = (m: number) => `${Math.max(100, Math.round(m / 100) * 100)} m`;

/**
 * Message of a PMV (art. 78 Reg. CdS): manual text, or — in live mode — the most relevant
 * event within 2 km (closures and accidents first, then queues within 1 km). Max 3 lines × 16 characters.
 */
export function vmsMessage(asset: Asset, live: LiveState = useLive.getState()): string {
  const manual = String(asset.properties.vmsText ?? '').trim();
  const mode = asset.properties.vmsMode;
  if (mode === 'scheduled') {
    const now = getProjectTime();
    const schedule = asset.properties.vmsSchedule as TimeWindow[] | undefined;
    return schedule?.length && windowActive(schedule, now.holiday ? 6 : now.day, now.minutes) ? manual || 'DRIP URBAN' : String(asset.properties.vmsOutsideText ?? '').trim();
  }
  if (mode === 'simulation') {
    const frame = engine.lastSim;
    if (!frame) return manual || 'SIMULAZIONE\nNON AVVIATA';
    const network = useApp.getState().network;
    const roadId = String(asset.properties.vmsRoadId ?? asset.properties.roadId ?? '');
    const road = network?.roads[roadId];
    if (!road) return manual || 'TRATTA\nNON COLLEGATA';
    const queue = frame.metrics.queues.filter(q => q.roadId === roadId).reduce((sum,q) => sum + q.vehicles, 0);
    const aggregate = frame.aggregates?.find(a => a.roadId === roadId);
    if (queue) return `CODA SIMULATA\n${queue} VEICOLI\nPRUDENZA`;
    if (aggregate?.vehicles) return `VELOCITÀ SIM.\n${Math.round(aggregate.speedKmh)} KM/H`;
    return 'TRATTA SIMULATA\nNESSUN VEICOLO';
  }
  if (mode !== 'live') return manual || 'DRIP URBAN';
  if (live.status !== 'ok' || liveFreshness(Date.now(), live) !== 'fresh') return manual || 'INFO TRAFFICO\nNON DISPONIBILE';
  const inc = live.incidents.map((f) => ({ f, d: nearestM(asset.at, f) })).filter((x) => x.d <= 2000)
    .sort((a, b) => (Number(b.f.properties.roadClosed) - Number(a.f.properties.roadClosed)) || a.d - b.d)[0];
  if (inc) {
    const p = inc.f.properties;
    const head = p.roadClosed ? 'STRADA CHIUSA' : String(p.label ?? 'EVENTO').toUpperCase();
    return `${head}\nA ${round100(inc.d)}\n${p.roadClosed ? 'SEGUIRE DEVIAZIONE' : 'PRUDENZA'}`;
  }
  const jam = live.flow.map((f) => ({ f, d: nearestM(asset.at, f), j: Number(f.properties.jamFactor ?? 0) })).filter((x) => x.d <= 1000 && x.j >= 4)
    .sort((a, b) => b.j - a.j || a.d - b.d)[0];
  if (jam) return `${jam.j >= 8 ? 'CODA' : 'RALLENTAMENTI'}\nA ${round100(jam.d)}\n${jam.j >= 8 ? 'RIDURRE VELOCITÀ' : 'PRUDENZA'}`;
  return 'TRAFFICO\nREGOLARE';
}

/** Upper case, up to 4 pages (separated by an empty line) of 3 lines × 16 characters. */
export function sanitizeVms(text: string): string {
  return vmsPages(text.toUpperCase()).map((p) => p.split('\n').map((l) => l.slice(0, VMS_CHARS)).join('\n')).join('\n\n');
}
