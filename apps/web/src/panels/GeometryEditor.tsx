import { useEffect, useRef, useState } from 'react';
import { LocalFrame, type LngLat } from '@drip-urban/core';
import { useApp } from '../state/store';
import {useMapUi} from '../map/mapStore';
import { Button, Field, NumberField } from '../ui/controls';

/** Shared metric vertex editor. A pointer gesture commits once through the caller's operation. */
export function GeometryEditor({ points, closed, onCommit }: { points: readonly LngLat[]; closed: boolean; onCommit: (points: readonly LngLat[]) => void }) {
  const origin=useApp((s)=>s.baseline!.origin), frame=new LocalFrame(origin);
  const [draft,setDraft]=useState(points), [selected,setSelected]=useState(0), drag=useRef<number|null>(null), svg=useRef<SVGSVGElement>(null);
  const live=useRef(draft);live.current=draft;
  useEffect(()=>{if(drag.current===null)setDraft(points);},[points]);
  const metric=draft.map((p)=>frame.toMetric(p)), xs=metric.map((p)=>p[0]), ys=metric.map((p)=>-p[1]);
  const minX=Math.min(...xs)-3,minY=Math.min(...ys)-3,width=Math.max(6,Math.max(...xs)-minX+3),height=Math.max(6,Math.max(...ys)-minY+3);
  const fixedView=useRef({minX,minY,width,height});if(drag.current===null)fixedView.current={minX,minY,width,height};
  const view=fixedView.current, index=Math.min(selected,draft.length-1), point=metric[index]!;
  const setPoint=(i:number,p:LngLat)=>{const next=[...live.current];next[i]=p;setDraft(next);live.current=next;};
  const apply=(next:readonly LngLat[])=>{onCommit(next);drag.current=null;setDraft(points);live.current=points;};
  return <div className="geometry-editor">
    <svg ref={svg} viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`} style={{width:'100%',height:200,background:'var(--bg-2)',touchAction:'none'}} aria-label="Editor vertici geometria"
      onPointerMove={(e)=>{if(drag.current===null||!svg.current)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current.getScreenCTM()!.inverse());const ui=useMapUi.getState(),step=ui.snapEnabled&&ui.snap.grid&&!e.altKey?ui.gridM:0;setPoint(drag.current,frame.toLngLat(step?[Math.round(p.x/step)*step,Math.round(-p.y/step)*step]:[p.x,-p.y]));}}
      onPointerUp={()=>{if(drag.current!==null){drag.current=null;apply(live.current);}}}
      onPointerCancel={()=>{drag.current=null;setDraft(points);}}>
      {closed?<polygon points={metric.map((p)=>`${p[0]},${-p[1]}`).join(' ')} fill="rgba(134,180,200,.18)" stroke="#88b4c8" strokeWidth={.1}/>:<polyline points={metric.map((p)=>`${p[0]},${-p[1]}`).join(' ')} fill="none" stroke="#88b4c8" strokeWidth={.1}/>}
      {metric.map((p,i)=><circle key={i} cx={p[0]} cy={-p[1]} r={Math.max(.18,Math.min(view.width,view.height)*.025)} fill={i===index?'#e9a259':'#88b4c8'} role="button" tabIndex={0} aria-label={`Vertice ${i+1}`} onPointerDown={(e)=>{e.preventDefault();setSelected(i);drag.current=i;svg.current?.setPointerCapture(e.pointerId);}} onKeyDown={(e)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const step=e.shiftKey?1:.1;const next=frame.toLngLat([p[0]+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),p[1]+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0)]);setPoint(i,next);apply(live.current);}} />)}
    </svg>
    <p className="muted">Vertice {index+1}/{points.length} · trascina con snap griglia comune (Alt libero) o usa le frecce (0,10 m; Maiusc 1 m).</p>
    <div className="grid-2"><Field label="X est · m"><NumberField value={point[0]} decimals={3} ariaLabel="Vertice X" onCommit={(x)=>{setPoint(index,frame.toLngLat([x,point[1]]));apply(live.current);}}/></Field><Field label="Y nord · m"><NumberField value={point[1]} decimals={3} ariaLabel="Vertice Y" onCommit={(y)=>{setPoint(index,frame.toLngLat([point[0],y]));apply(live.current);}}/></Field></div>
    <div className="row"><Button size="sm" onClick={()=>{const next=[...points],a=metric[index]!,b=metric[(index+1)%metric.length]!;next.splice(index+1,0,frame.toLngLat([(a[0]+b[0])/2,(a[1]+b[1])/2]));apply(next);setSelected(index+1);}}>Inserisci vertice</Button><Button size="sm" disabled={points.length<=(closed?3:2)} onClick={()=>{apply(points.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1));}}>Rimuovi vertice</Button></div>
  </div>;
}
