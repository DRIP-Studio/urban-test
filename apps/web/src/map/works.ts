import {worksStage,type Network} from '@drip-urban/core';
import {getProjectTime} from '../state/projectTime';
import {fc,type Feature} from '../engine/geojson';
import {setSource} from './mapStore';
export function drawWorks(net:Network){const date=getProjectTime().date;const features:Feature[]=[];for(const p of net.works??[])if(p.affectedArea&&worksStage(p,date)==='construction')features.push({type:'Feature',id:p.id,geometry:{type:'Polygon',coordinates:[[...p.affectedArea.map(q=>[q[0],q[1]]),[p.affectedArea[0]![0],p.affectedArea[0]![1]]]]},properties:{id:p.id,name:p.name}});setSource('works',fc(features));}
