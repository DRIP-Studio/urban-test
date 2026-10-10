import type {CorridorAssembly} from '../model/types';
export function corridorCrossfall(corridor:CorridorAssembly|undefined,station:number,offset:number):number{
 const rows=corridor?.crossfall;if(!rows?.length)return 0;
 const value=(p:typeof rows[number])=>offset>=0?p.leftPct:p.rightPct;
 let pct=value(rows[0]!);for(let i=1;i<rows.length;i++){const a=rows[i-1]!,b=rows[i]!;if(station<=b.station){const k=Math.max(0,Math.min(1,(station-a.station)/Math.max(.001,b.station-a.station)));pct=value(a)+(value(b)-value(a))*k;break;}pct=value(b);}
 return Math.abs(offset)*pct/100;
}
