import type {LngLat,Road} from '../model/types';
import {LocalFrame} from '../geo/projection';
import {lengthOf} from '../geo/polyline';
import {underpassDesign} from './underpass';
/** Reparameterises station-based design when the authored horizontal axis changes. */
export function roadWithAxis(road:Road,axis:readonly LngLat[]):Road {
 const frame=new LocalFrame(road.axis[0]!),oldLength=lengthOf(road.axis.map(p=>frame.toMetric(p))),length=lengthOf(axis.map(p=>frame.toMetric(p)));
 if(length<.01)throw Error('Asse stradale di lunghezza nulla');
 const ratio=oldLength>.01?length/oldLength:1;
 let vertical=road.vertical;
 const passage=road.structure?.underpass;
 if(passage&&vertical){
  const result=underpassDesign({...road,axis},{...passage,depthM:road.structure!.heightM,entryElevationM:vertical.pvis[0]!.elevation,exitElevationM:vertical.pvis.at(-1)!.elevation});
  if(result.errors.length)throw Error(result.errors.join(' · '));
  vertical=result.vertical;
 }else if(vertical)vertical={...vertical,pvis:vertical.pvis.map(p=>({...p,station:p.station*ratio,...(p.curveLength!==undefined?{curveLength:p.curveLength*ratio}:{})}))};
 return {...road,axis,alignment:undefined,vertical,corridor:road.corridor?{...road.corridor,crossfall:road.corridor.crossfall.map(p=>({...p,station:p.station*ratio}))}:undefined,provenance:{...road.provenance,geometry:{kind:'project',source:'Asse modificato DRIP Urban'},...(vertical?{vertical:{kind:'project' as const,source:'Progressive ricalcolate sul nuovo asse'}}:{})}};
}
