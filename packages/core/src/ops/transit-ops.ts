import type { TransitLine,BikeShare } from '../model/types';
import { defineOperation } from './registry';
export const setTransit = defineOperation<{lines: readonly TransitLine[];bikeShare?:BikeShare}>({
 type:'transit.set',label:()=> 'Rete TPL di progetto',
 validate:(_net,p)=>{
  const bike=p.bikeShare;if(bike&&(!bike.system.trim()||typeof bike.dockless!=='boolean'||bike.stations.some(st=>!st.id||!st.name.trim()||st.at.length!==2||!st.at.every(Number.isFinite)||Math.abs(st.at[0])>180||Math.abs(st.at[1])>90||!Number.isInteger(st.docks)||st.docks<0||st.docks>10000||!Number.isFinite(st.ebikeShare)||st.ebikeShare<0||st.ebikeShare>1)||new Set(bike.stations.map(st=>st.id)).size!==bike.stations.length))return[{code:'transit.bike',severity:'error',message:'Stazioni bike sharing non valide'}];
  const ids=new Set<string>();
  for(const l of p.lines){
   if(!l.id || ids.has(l.id) || !['bus','brt','trolleybus','tram','metro','train','funicular','ferry','on_demand'].includes(l.mode) || l.line.length<2 || !l.line.every(q=>q.length===2 && q.every(Number.isFinite) && Math.abs(q[0])<=180 && Math.abs(q[1])<=90) || !Number.isFinite(l.speedKmh)||l.speedKmh<=0||l.speedKmh>300||!Number.isInteger(l.capacity)||l.capacity<1||l.capacity>3000 || !Object.values(l.headways).every(h=>Number.isFinite(h)&&h>=0&&h<=240) || ![l.firstDeparture,l.lastDeparture].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || l.dwellS!==undefined && (!Number.isFinite(l.dwellS)||l.dwellS<0||l.dwellS>600) || l.stops.some(st=>!st.at.every(Number.isFinite)||st.arrivalsPerHour!==undefined && (!Number.isFinite(st.arrivalsPerHour)||st.arrivalsPerHour<0||st.arrivalsPerHour>10000)||st.alightFraction!==undefined&&(!Number.isFinite(st.alightFraction)||st.alightFraction<0||st.alightFraction>1)))return[{code:'transit.invalid',severity:'error',message:'Linea, orari o domanda alle fermate non validi'}];
   for(const stop of l.stops)if(stop.transferTo){const tr=stop.transferTo,destination=p.lines.find(line=>line.id===tr.lineId);if(!destination?.stops.some(st=>st.id===tr.stopId)||!Number.isFinite(tr.fraction)||tr.fraction<0||tr.fraction>1||!Number.isFinite(tr.walkS)||tr.walkS<0||tr.walkS>7200)return[{code:'transit.transfer',severity:'error',message:'Interscambio non valido'}];}
   ids.add(l.id);
  }return[];
 },apply:(net,p)=>({...net,transit:p.lines,...(p.bikeShare?{bikeShare:p.bikeShare}:{})})
});
