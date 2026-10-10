import {utilityRuns,UTILITY_COLORS,type Network,type UtilitySystem} from '@drip-urban/core';
import {fc,type Feature} from '../engine/geojson';
import {setSource} from './mapStore';
export function drawUtilities(net:Network){
 const runs=utilityRuns(net);const features:Feature[]=runs.map(run=>({type:'Feature',id:run.id,geometry:{type:'LineString',coordinates:run.points.map(p=>[p.at[0],p.at[1]])},properties:{id:run.id,color:UTILITY_COLORS[run.system as UtilitySystem]??'#aaaaaa',name:run.name,diameterMm:run.diameterM*1000}}));
 for(const node of Object.values(net.utilityNodes??{}))features.push({type:'Feature',id:node.id,geometry:{type:'Point',coordinates:[node.at[0],node.at[1]]},properties:{id:node.id,color:UTILITY_COLORS[node.system],name:node.name}});setSource('utilities',fc(features));
}
