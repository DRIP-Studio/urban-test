import {SIM_STRIDE,type SimFrame,type PresentationScene} from '@drip-urban/core';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MaterialItem } from '../api/types';
import type { FeatureCollection } from '../engine/geojson';
import { materialColorExpr } from '../map/layers';
import { Segmented } from '../ui/controls';

export type CompareMode = 'slider' | 'side' | 'toggle';
export interface Camera { center: readonly [number, number]; zoom: number; bearing: number; pitch: number }

export interface StateData { surfaces: FeatureCollection; markings?: FeatureCollection; buildings?: FeatureCollection; assets?: FeatureCollection; label: string }

function style(data: StateData, materials: readonly MaterialItem[], editorial: boolean): StyleSpecification {
  return {
    version: 8,
    glyphs: `${location.origin}/glyphs/{fontstack}/{range}.pbf`,
    // Context comes from the project's own OSM buildings: no third-party basemap or key needed.
    sources: {
      s: { type: 'geojson', data: data.surfaces as never },
      m: { type: 'geojson', data: (data.markings ?? { type: 'FeatureCollection', features: [] }) as never },
      b: { type: 'geojson', data: (data.buildings ?? { type: 'FeatureCollection', features: [] }) as never },
      v: {type:'geojson',data:{type:'FeatureCollection',features:[]}},
      a: { type: 'geojson', data: (data.assets ?? { type: 'FeatureCollection', features: [] }) as never },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': editorial ? '#f5f3ef' : '#e9e6df' } },
      { id: 'b', type: 'fill', source: 'b', paint: { 'fill-color': editorial ? '#e4ddd2' : '#d6d1c7' } },
      { id: 's', type: 'fill', source: 's', paint: { 'fill-color': materialColorExpr(materials), 'fill-antialias': false } },
      { id: 'sp', type: 'line', source: 's', filter: ['==', ['get', 'state'], 'project'], paint: { 'line-color': editorial ? '#7a1f32' : '#e8772e', 'line-width': 1.6 } },
      { id: 'm', type: 'fill', source: 'm', minzoom: 15.5, paint: { 'fill-color': '#f4f3ef' } },
      {id:'afp',type:'fill',source:'a',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':materialColorExpr(materials),'fill-opacity':.8}},
      {id:'v',type:'circle',source:'v',paint:{'circle-radius':3,'circle-color':'#277496','circle-stroke-color':'#ffffff','circle-stroke-width':.5}},
      { id: 'a', type: 'circle', source: 'a',filter:['==',['geometry-type'],'Point'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 20, 6], 'circle-color': editorial ? '#7a1f32' : '#e8772e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },
    ],
  };
}

export function BeforeAfter({ before, after, materials, initial, editorial = false, camera, insetRight = 0,simulation,annotations,onCamera }: {
  onCamera?: (camera:Camera)=>void;
  simulation?:SimFrame|null;annotations?:PresentationScene['annotations'];before: StateData; after: StateData; materials: readonly MaterialItem[]; initial: [number, number, number, number]; editorial?: boolean; camera?: Camera | null; /** px covered by overlays on the right. */ insetRight?: number;
}) {
  const cameraReader=useRef(onCamera);cameraReader.current=onCamera;
  const [mode, setMode] = useState<CompareMode>('slider');
  const [pos, setPos] = useState(50);
  const [showAfter, setShowAfter] = useState(true);
  const aRef = useRef<HTMLDivElement>(null), bRef = useRef<HTMLDivElement>(null);
  const maps = useRef<{ a: MLMap; b: MLMap } | null>(null);
  useEffect(() => {
    if (!aRef.current || !bRef.current) return;
    const opts = { bounds: [[initial[0], initial[1]], [initial[2], initial[3]]] as [[number, number], [number, number]], fitBoundsOptions: { padding: { top: 60, bottom: 40, left: 40, right: 40 + insetRight } }, attributionControl: { compact: true }, maxZoom: 21 };
    const a = new maplibregl.Map({ container: aRef.current, style: style(before, materials, editorial), ...opts });
    const b = new maplibregl.Map({ container: bRef.current, style: style(after, materials, editorial), ...opts });
    let syncing = false;
    const sync = (from: MLMap, to: MLMap) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
      syncing = false;
    };
    a.on('move', sync(a, b));
    b.on('move', sync(b, a));
    const reportCamera=()=>cameraReader.current?.({center:[b.getCenter().lng,b.getCenter().lat],zoom:b.getZoom(),bearing:b.getBearing(),pitch:b.getPitch()});
    b.on('moveend',reportCamera);b.once('load',reportCamera);
    maps.current = { a, b };
    if(import.meta.env.DEV)(window as unknown as {__dripCompare?:{a:MLMap;b:MLMap}}).__dripCompare={a,b};
    const ro = new ResizeObserver(() => { a.resize(); b.resize(); });
    ro.observe(aRef.current.parentElement!);
    return () => { if(import.meta.env.DEV)delete(window as unknown as {__dripCompare?:unknown}).__dripCompare;ro.disconnect(); a.remove(); b.remove(); maps.current = null; };
  }, [materials, initial, editorial, insetRight]);
  useEffect(()=>{if(!maps.current)return;for(const [map,data] of [[maps.current.a,before],[maps.current.b,after]] as const){const update=()=>{for(const [id,value] of [['s',data.surfaces],['m',data.markings],['b',data.buildings],['a',data.assets]] as const)(map.getSource(id) as maplibregl.GeoJSONSource|undefined)?.setData((value??{type:'FeatureCollection',features:[]}) as never);};if(map.isStyleLoaded())update();else map.once('load',update);}},[before,after]);
  useEffect(() => {
    if (camera && maps.current) maps.current.b.flyTo({ ...camera,center:[...camera.center] as [number,number], duration: 1200 });
  }, [camera]);
  useEffect(()=>{const map=maps.current?.b;if(!map)return;const features:{type:'Feature';geometry:{type:'Point';coordinates:number[]};properties:Record<string,never>}[]=[];for(let i=0;i<(simulation?.data.length??0);i+=SIM_STRIDE)features.push({type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[simulation!.data[i]!,simulation!.data[i+1]!]},properties:{}});const push=()=>{(map.getSource('v') as maplibregl.GeoJSONSource|undefined)?.setData({type:'FeatureCollection',features});};if(map.isStyleLoaded())push();else map.once('load',push);},[simulation]);
  useEffect(()=>{const map=maps.current?.b;if(!map)return;const markers=(annotations??[]).map(a=>{const el=document.createElement('div');el.className=`present-annotation is-${a.kind??'label'}`;el.textContent=a.text;return new maplibregl.Marker({element:el}).setLngLat([...a.at] as [number,number]).addTo(map);});const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');Object.assign(svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});map.getCanvasContainer().appendChild(svg);const update=()=>{svg.replaceChildren();for(const a of annotations??[]){if(a.kind!=='arrow'||!a.endAt)continue;const p=map.project([a.at[0],a.at[1]]),q=map.project([a.endAt[0],a.endAt[1]]),angle=Math.atan2(q.y-p.y,q.x-p.x),path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M ${p.x} ${p.y} L ${q.x} ${q.y} l ${-10*Math.cos(angle-.5)} ${-10*Math.sin(angle-.5)} M ${q.x} ${q.y} l ${-10*Math.cos(angle+.5)} ${-10*Math.sin(angle+.5)}`);path.setAttribute('stroke','#ce6f32');path.setAttribute('stroke-width','2');path.setAttribute('fill','none');svg.appendChild(path);}};map.on('move',update);map.on('resize',update);update();return()=>{markers.forEach(m=>m.remove());map.off('move',update);map.off('resize',update);svg.remove();};},[annotations]);
  useEffect(() => { requestAnimationFrame(() => { maps.current?.a.resize(); maps.current?.b.resize(); }); }, [mode]);
  return (
    <div className={`before-after ba-${mode} ${editorial ? 'is-editorial' : ''}`}>
      <div className="ba-maps">
        <div className="ba-map ba-before" ref={aRef} style={mode === 'toggle' ? { visibility: showAfter ? 'hidden' : 'visible' } : undefined} />
        <div className="ba-map ba-after" ref={bRef}
          style={mode === 'slider' ? { clipPath: `inset(0 0 0 ${pos}%)` } : mode === 'toggle' ? { visibility: showAfter ? 'visible' : 'hidden' } : undefined} />
        {mode === 'slider' ? (
          <>
            <input className="ba-range" type="range" min={0} max={100} value={pos} aria-label="Confronto prima/dopo" onChange={(e) => setPos(Number(e.target.value))} />
            <span className="ba-line" style={{ left: `${pos}%` }} aria-hidden />
          </>
        ) : null}
        <span className="ba-tag ba-tag-before">{before.label}</span>
        <span className="ba-tag ba-tag-after">{after.label}</span>
      </div>
      <div className="ba-controls">
        <Segmented<CompareMode> label="Modalità confronto" size="sm" value={mode} onChange={setMode} options={[{ value: 'slider', label: 'Cursore' }, { value: 'side', label: 'Affiancati' }, { value: 'toggle', label: 'Alterna' }]} />
        {mode === 'toggle' ? <Segmented<'0' | '1'> label="Stato" size="sm" value={showAfter ? '1' : '0'} onChange={(v) => setShowAfter(v === '1')} options={[{ value: '0', label: before.label }, { value: '1', label: after.label }]} /> : null}
      </div>
    </div>
  );
}
