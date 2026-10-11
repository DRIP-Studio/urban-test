import type {Map as MLMap,GeoJSONSource} from 'maplibre-gl';
import type {SimFrame} from '@drip-urban/core';
import {engine} from '../engine/engine';
import {fc,type Feature} from '../engine/geojson';
import {useApp} from '../state/store';
import {drawLive,trafficSourceMode} from '../traffic/live';
import {setSource,toggleLayer} from './mapStore';
import {vehiclesFC} from './sources';

/** The map owns agent rendering, independently of the currently opened inspector. */
export function installMapSimulation(map:MLMap):()=>void {
 const draw=(frame:SimFrame|null)=>{
  if(!map.isStyleLoaded())return;
  if(!frame){setSource('vehicles',null);setSource('pedestrians',null);drawLive();return;}
  const state=useApp.getState();
  if(state.mode==='twin'||state.mode==='present'||!state.baseline)return;
  const people=frame.pedestrians?.data??new Float32Array();
  setSource('pedestrians',fc(Array.from({length:people.length/5},(_,i):Feature=>({type:'Feature',geometry:{type:'Point',coordinates:[people[i*5]!,people[i*5+1]!]},properties:{id:people[i*5+3],waiting:people[i*5+4]}}))));
  if(trafficSourceMode()==='simulated')setSource('traffic',frame.aggregates?.length?fc(frame.aggregates.flatMap((a):Feature[]=>{
   const road=state.network?.roads[a.roadId];
   return road?[{type:'Feature',geometry:{type:'LineString',coordinates:road.axis.map(p=>[...p])},properties:{id:a.roadId,ratio:a.speedKmh/Math.max(1,road.speedKmh),vol:a.vehicles,source:'hybrid_simulation'}}]:[];
  })):null);
  return (map.getSource('vehicles') as GeoJSONSource|undefined)?.setData(vehiclesFC(frame,state.baseline.origin,map.getZoom()>=18?32:0) as never);
 };
 const off=engine.onSim(draw);
 const updateView=()=>{
  if(['twin','present'].includes(useApp.getState().mode))return;
  const b=map.getBounds(),bounds=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()] as const;
  engine.simView({budget:engine.simRenderBudget,bounds});
  if(engine.lastSimOptions?.mode==='hybrid')engine.simFocus(bounds);
 };
 const refresh=()=>{updateView();if(engine.lastSim){toggleLayer('vehicles',true);draw(engine.lastSim);}};
 const offApp=useApp.subscribe((state,previous)=>{if(state.mode!==previous.mode)refresh();});
 map.on('load',refresh);map.on('moveend',updateView);
 return()=>{off();offApp();map.off('load',refresh);map.off('moveend',updateView);};
}
