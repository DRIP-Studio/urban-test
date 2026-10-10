import type { TransitLine } from '../model/types';
export interface TransitMetrics {
 readonly lineId:string; readonly name:string; readonly mode:string; readonly scheduled:number; readonly departed:number; readonly completed:number; readonly active:number;
 readonly boarded:number; readonly waiting:number; readonly passengerWaitS:number; readonly meanDepartureDelayS:number; readonly meanTravelS:number; readonly missed:number; readonly issue?:string;
}
export interface TransitService {
 line:TransitLine; scheduled:number; departed:number; completed:number; boarded:number; travelS:number; delayS:number; waitS:number; nextLocalS:number;countedNextLocalS:number;
 queues:Map<string,{people:number; personSeconds:number}>; issue?:string;
}
const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
export function transitHeadway(line:TransitLine,day:number,localMinutes:number,holiday=false):number {
 const hour=localMinutes/60;
 return line.headways[holiday||day>=5?'weekend':hour>=7&&hour<9||hour>=17&&hour<19?'peak':hour>=20||hour<6?'evening':'offpeak'];
}
/** Departure slots are measured from the real service-day start, including services crossing midnight. */
export function nextTransitDeparture(line:TransitLine,day:number,localS:number,holiday=false):number {
 const first=minutes(line.firstDeparture)*60,last=minutes(line.lastDeparture)*60;
 for(let offset=last<first?-1:0;offset<=1;offset++){
  let candidate=first+offset*86400,end=last+offset*86400+(last<first?86400:0);
  while(candidate<=end){
   const mod=((candidate%86400)+86400)%86400;
   const h=transitHeadway(line,(day+offset+7)%7,mod/60,holiday);
   if(h>0 && candidate>=localS-1e-6)return candidate;
   candidate+=h>0?h*60:60;

  }
 }
 return Infinity;
}
export function newTransitService(line:TransitLine,day:number,localS:number,holiday:boolean):TransitService {
 return{line,scheduled:0,departed:0,completed:0,boarded:0,travelS:0,delayS:0,waitS:0,nextLocalS:nextTransitDeparture(line,day,localS,holiday),countedNextLocalS:nextTransitDeparture(line,day,localS,holiday),queues:new Map(line.stops.map(st=>[st.id,{people:0,personSeconds:0}]))};
}
export function accruePassengers(service:TransitService,dt:number){
 for(const stop of service.line.stops){const q=service.queues.get(stop.id)!;q.people+=(stop.arrivalsPerHour??0)*dt/3600;q.personSeconds+=q.people*dt;}
}
export function serveTransitStop(service:TransitService,stopId:string,aboard:number,onAlight?:(people:number)=>void):number {
 const stop=service.line.stops.find(st=>st.id===stopId),q=service.queues.get(stopId);if(!q||!stop)return aboard;
 const alighted=Math.floor(aboard*(stop.alightFraction??0));onAlight?.(alighted);aboard=Math.max(0,aboard-alighted);
 const boarding=Math.min(Math.floor(q.people),Math.max(0,service.line.capacity-aboard));
 const meanWait=q.people?q.personSeconds/q.people:0;
 service.waitS+=boarding*meanWait;service.boarded+=boarding;q.people-=boarding;q.personSeconds=Math.max(0,q.personSeconds-boarding*meanWait);
 return aboard+boarding;
}
