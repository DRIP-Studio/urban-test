import {captureEliosScope} from './scope';
import {engine} from '../engine/engine';
import {getProjectTime} from '../state/projectTime';
import type {Route} from '@drip-urban/core';
import { LocalFrame, geom } from '@drip-urban/core';
import { usePicks } from '../tools/picks';
import { defaultLine, MODES, lineMetrics, proposeBikeStations, type TransitMode } from '../transit/model';
import { newId, setMode, useApp } from '../state/store';
import { registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
const sid = () => useApp.getState().scenario?.id ?? 'baseline';

registerEliosTools([
  {
    name: 'create_transit_line', kind: 'write', label: 'Linea TPL creata',
    description: 'Crea una linea di trasporto pubblico (bus, brt, trolleybus, tram, metro, train, funicular, ferry, on_demand) passante per i punti indicati; bus/BRT/tram seguono le strade. Opzionale: frequenza di punta e fermate automatiche.',
    parameters: OBJ({
      mode: { type: 'STRING', enum: Object.keys(MODES), description: 'Modo' }, name: { type: 'STRING', description: 'Nome linea' },
      points: { type: 'ARRAY', description: 'Punti [lon, lat] del percorso, in ordine', items: { type: 'ARRAY', items: { type: 'NUMBER' }, description: '[lon, lat]' } },
      peakHeadwayMin: { type: 'NUMBER', description: 'Minuti tra le corse in punta' }, autoStops: { type: 'BOOLEAN', description: 'Fermate automatiche alla distanza tipica del modo' },
    }, ['mode', 'points']),
    async run(a) {
      const guard=captureEliosScope(),initial=useApp.getState(),mode=a.mode as TransitMode;
      if(!initial.baseline||!initial.network||!MODES[mode])throw Error('Progetto o modo non disponibile');
      if(!Array.isArray(a.points)||a.points.length<2||a.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(p[0])>180||Math.abs(p[1])>90))throw Error('Servono almeno due punti WGS84 validi');
      let pts=(a.points as [number,number][]).map(p=>[...p] as [number,number]);
      if(MODES[mode].onRoad){const departure=getProjectTime();const result=await engine.job<{project:Route}>('compareRoute',{from:pts[0],to:pts.at(-1),via:pts.slice(1,-1),ctx:{mode:mode==='tram'?'tram':'bus',...departure}});guard.assert();if(!result.project.found||result.project.line.length<2)throw Error('Percorso TPL stradale non connesso: modifica gli estremi o la rete');pts=result.project.line.map(p=>[...p]);}
      const b=initial.baseline,f=new LocalFrame(b.origin),list=initial.network.transit??[];
      let next=defaultLine(newId('tl'),mode,pts,list.filter(r=>r.mode===mode).length);
      if(a.name)next={...next,name:String(a.name)};
      if(a.peakHeadwayMin!==undefined)next={...next,headways:{...next.headways,peak:Number(a.peakHeadwayMin)}};
      if(a.autoStops){const axis=next.line.map(p=>f.toMetric(p) as geom.V),length=geom.lengthOf(axis),count=Math.max(1,Math.round(length/MODES[mode].stopSpacingM));next={...next,stops:Array.from({length:count+1},(_,i)=>({id:newId('st'),name:`Fermata ${i+1}`,at:f.toLngLat(geom.sampleAt(axis,length*i/count).p)}))};}
      const result=guard.commit('transit.set',{lines:[...list,next]});if(!result.ok)throw Error(result.issues.map(i=>i.message).join(' · '));
      usePicks.setState({selectedRouteId:next.id});setMode('transit');const metrics=lineMetrics(next,b);
      return{lineId:next.id,lengthKm:metrics.lengthKm,stops:next.stops.length,fleet:metrics.fleet,boardingsDayEstimate:metrics.boardingsDay,costYearEur:metrics.costYear,method:'Linea su grafo accessibile o sede propria; domanda stimata di pianificazione, non passeggeri misurati. Operazione unica annullabile.'};
    },
  },
  {
    name: 'propose_bike_sharing', kind: 'write', label: 'Stazioni bike sharing proposte',
    description: 'Propone stazioni di bike sharing (circa ogni 400 m) dove i residenti stimati sono più densi.',
    parameters: OBJ({ spacingM: { type: 'NUMBER', description: 'Passo della griglia (predefinito 400 m)' }, max: { type: 'NUMBER', description: 'Numero massimo di stazioni' } }),
    async run(a) {
      const b = useApp.getState().baseline!;
      const found = proposeBikeStations(b, b.bbox, Number(a.spacingM) || 400, Number(a.max) || 40);
      const st = usePicks.getState();
      const bs = st.transit.bikeshare?.[sid()] ?? { system: 'Bike sharing', stations: [], dockless: false };
      await st.saveTransit({ ...st.transit, bikeshare: { ...(st.transit.bikeshare ?? {}), [sid()]: { ...bs, stations: [...bs.stations, ...found.map((x, i) => ({ id: newId('bs'), name: `Stazione ${bs.stations.length + i + 1}`, at: x.at, docks: x.docks, ebikeShare: 0.4 }))] } } });
      setMode('transit');
      return { stations: found.length, docks: found.reduce((t, x) => t + x.docks, 0) };
    },
  },
]);
