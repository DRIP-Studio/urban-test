import { registerEliosTools } from './tools';
import { commit, newId, useApp } from '../state/store';
import { getProjectClock, setProjectWallTime } from '../state/projectTime';
import { startProjectSimulation } from '../traffic/startSimulation';
import { engine } from '../engine/engine';
import { getMap } from '../map/mapStore';
import { getTwinCameraContext } from '../twin/cameraContext';
import type { WeatherPreset } from '@drip-urban/core';

const S=(description:string)=>({type:'STRING',description});
const N=(description:string)=>({type:'NUMBER',description});
const O=(properties:Record<string,unknown>,required:string[]=[])=>({type:'OBJECT',properties,required});
registerEliosTools([
  {name:'set_project_time',kind:'write',label:'Tempo del progetto',description:'Imposta data e ora locali del progetto con operazione nativa annullabile; aggiorna luce, restrizioni, ZTL e TPL. Passa a Studio. Non cambia il fuso orario.',parameters:O({date:S('Data YYYY-MM-DD'),minutes:N('Minuti dalla mezzanotte, 0–1439')},['date','minutes']),run(args){
    const date=String(args.date),minutes=Number(args.minutes);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!Number.isInteger(minutes)||minutes<0||minutes>=1440)throw Error('Data e ora locali non valide');
    const result=setProjectWallTime(date,minutes);if(!result.ok)throw Error('Impossibile impostare il tempo del progetto');return getProjectClock();
  }},
  {name:'set_twin_environment',kind:'write',label:'Meteo dello scenario',description:'Imposta il meteo di studio condiviso fra mappa e Twin, con undo. Non è meteo osservato né previsione del provider.',parameters:O({weather:{...S('Fenomeno rappresentato'),enum:['clear','cloudy','overcast','rain','fog']},intensity:N('Intensità 0–1')},['weather','intensity']),run(args){
    const payload={weather:String(args.weather) as WeatherPreset,intensity:Number(args.intensity),weatherSource:'simulated' as const};
    const result=commit('environment.set',payload);if(!result.ok)throw Error(result.issues.map(i=>i.message).join(' · '));return payload;
  }},
  {name:'start_municipal_simulation',kind:'write',label:'Simulazione comunale',description:'Avvia il solver effettivo sull’intero comune e sulla fonte traffico selezionata. Richiede domanda esplicita; la popolazione non è un conteggio Live. Congela il clock se era Live. Stato runtime arrestabile, configurazione tempo nativa annullabile.',parameters:O({mode:{...S('Modello'),enum:['microscopic','hybrid']},dailyTrips:N('Domanda giornaliera dichiarata'),pedestrianDemandPerHour:N('Domanda pedonale sintetica esplicita per ora'),seed:N('Seed intero riproducibile')},['mode','dailyTrips','pedestrianDemandPerHour','seed']),async run(args){
    if(!['microscopic','hybrid'].includes(String(args.mode)))throw Error('Modello simulazione non valido');
    const pedestrians=Number(args.pedestrianDemandPerHour);if(!Number.isFinite(pedestrians)||pedestrians<0||pedestrians>100000)throw Error('Domanda pedonale non valida');
    return startProjectSimulation({mode:args.mode as 'microscopic'|'hybrid',dailyTrips:Number(args.dailyTrips),pedestrianDemandPerHour:pedestrians,seed:Number(args.seed),scopeName:'Intero comune'});
  }},
  {name:'control_simulation',kind:'view',label:'Controllo simulazione',description:'Legge metriche reali o mette in pausa, riprende o ferma il solver corrente. Nessun risultato viene inventato quando manca un run.',parameters:O({action:{...S('Azione runtime'),enum:['inspect','pause','resume','stop']}},['action']),run(args){
    if(!['inspect','pause','resume','stop'].includes(String(args.action)))throw Error('Azione non valida');
    if(args.action==='stop')engine.simStop();else if(args.action!=='inspect')engine.simPause(args.action==='pause');
    return {active:!!engine.lastSim,paused:engine.simPaused,metrics:engine.lastSim?.metrics??null,pedestrians:engine.lastSim?.pedestrians?.metrics??null};
  }},
  {name:'create_presentation_scene',kind:'write',label:'Scena di presentazione',description:'Salva una scena nativa dalla camera attuale e dal clock del progetto con titolo e testo forniti. Conserva le altre scene e supporta undo. Non inventa KPI o immagini.',parameters:O({title:S('Titolo'),text:S('Testo della scena'),durationS:N('Durata 1–600 secondi')},['title','text','durationS']),run(args){
    const state=useApp.getState(),map=getMap(),twin=state.mode==='twin'?getTwinCameraContext():null;
    if(!state.network||(!map&&!twin))throw Error('Apri una vista del progetto');
    const scene={id:newId('scene'),title:String(args.title),text:String(args.text),durationS:Number(args.durationS),clock:getProjectClock(),camera:map?{center:map.getCenter().toArray() as [number,number],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}:null,...(twin?{twin:{lon:twin.position.longitude,lat:twin.position.latitude,height:twin.position.heightM,heading:twin.headingDeg,pitch:twin.pitchDeg}}:{})};
    const result=commit('presentation.set',{document:{...state.network.presentation,scenes:[...(state.network.presentation?.scenes??[]),scene]}});if(!result.ok)throw Error(result.issues.map(i=>i.message).join(' · '));return {sceneId:scene.id,title:scene.title,source:twin?'Twin':'Map'};
  }},
]);
