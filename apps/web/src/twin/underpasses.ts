import * as Cesium from 'cesium';
import {sampleTerrain,gradingElevation,LocalFrame,designElevation,geom,type Network} from '@drip-urban/core';
import type {HeightModel} from './heights';
/** Structures derive from the authored road/profile; no parallel saved geometry. */
export function underpassEntities(viewer:Cesium.Viewer,net:Network,hm:HeightModel|null) {
 const entities:Cesium.Entity[]=[];
 for(const road of Object.values(net.roads)) {
  const passage=road.structure?.underpass,profile=road.vertical;
  if(!passage||!profile)continue;
  const frame=new LocalFrame(road.axis[0]!),axis=road.axis.map(p=>frame.toMetric(p)),length=geom.lengthOf(axis),half=Math.max(.75,road.section.elements.reduce((sum,e)=>sum+e.widthM,0)/2);
  const count=Math.ceil(length/Math.max(2,length/300));
  const stations=[0,passage.rampLengthM,length-passage.rampLengthM,length,...Array.from({length:count},(_,i)=>length*i/count)].sort((a,b)=>a-b).filter((s,i,a)=>i===0||Math.abs(s-a[i-1]!)>1e-6);
  const ellipsoid=(z:number)=>hm?hm.toEllipsoid(z):z;
  const floorEdge=(side:number)=>stations.map(s=>{const {p,t}=geom.sampleAt(axis,s),at=frame.toLngLat([p[0]-t[1]*half*side,p[1]+t[0]*half*side]);return Cesium.Cartesian3.fromDegrees(at[0],at[1],ellipsoid(designElevation(profile,s))+.01);});
  entities.push(viewer.entities.add({id:`underpass-floor:${road.id}`,name:`${road.name} · piano e rampe`,polygon:{hierarchy:new Cesium.PolygonHierarchy([...floorEdge(1),...floorEdge(-1).reverse()]),perPositionHeight:true,material:Cesium.Color.fromCssColorString(passage.usage==='pedestrian'?'#c3bba9':'#545b61')},properties:{roadId:road.id}}));
  for(const side of [-1,1]) {
   const coordinates=stations.map(s=>{const {p,t}=geom.sampleAt(axis,s);return frame.toLngLat([p[0]-t[1]*half*side,p[1]+t[0]*half*side]);});
   const floor=stations.map(s=>designElevation(profile,s));
   const start=profile.pvis[0]!.elevation,end=profile.pvis.at(-1)!.elevation;
   const top=stations.map((s,i)=>Math.max(floor[i]!+.15,start+(end-start)*s/length));
   entities.push(viewer.entities.add({id:`underpass-wall:${road.id}:${side}`,name:`${road.name} · parete`,wall:{positions:coordinates.map(p=>Cesium.Cartesian3.fromDegrees(p[0],p[1])),minimumHeights:floor.map(ellipsoid),maximumHeights:top.map(ellipsoid),material:Cesium.Color.fromCssColorString('#a7a39a')},properties:{roadId:road.id}}));
  }
  const covered=stations.filter(s=>s>=passage.rampLengthM-1e-6&&s<=length-passage.rampLengthM+1e-6);
  const edges=(side:number)=>covered.map(s=>{const {p,t}=geom.sampleAt(axis,s);return frame.toLngLat([p[0]-t[1]*(half+.2)*side,p[1]+t[0]*(half+.2)*side]);});
  const ring=[...edges(1),...edges(-1).reverse()],roof=ellipsoid(designElevation(profile,passage.rampLengthM)+passage.clearanceM);
  entities.push(viewer.entities.add({id:`underpass-roof:${road.id}`,name:`${road.name} · soletta`,polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(ring.flatMap(p=>[p[0],p[1]])),height:roof,extrudedHeight:roof+passage.slabM,material:Cesium.Color.fromCssColorString('#8a8985')},properties:{roadId:road.id}}));
 }
 return entities;
}

/** Visible retaining faces follow the original DTM and the authored platform plane. */
export function gradingRetainingEntities(viewer:Cesium.Viewer,net:Network,hm:HeightModel|null){
 const entities:Cesium.Entity[]=[];if(!hm)return entities;
 for(const area of Object.values(net.areas)){
  if(!area.grading?.retaining||area.state==='removed')continue;
  const frame=new LocalFrame(area.polygon[0]!);
  for(let i=0;i<area.polygon.length;i++){
   const a=frame.toMetric(area.polygon[i]!),b=frame.toMetric(area.polygon[(i+1)%area.polygon.length]!),length=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.max(1,Math.ceil(length/Math.max(2,length/200)));
   const points=Array.from({length:count+1},(_,k)=>frame.toLngLat([a[0]+(b[0]-a[0])*k/count,a[1]+(b[1]-a[1])*k/count])),ground=points.map(p=>sampleTerrain(hm.grid,p[0],p[1])),design=points.map(p=>gradingElevation(area,p));
   if(ground.some(z=>!Number.isFinite(z)))continue;
   entities.push(viewer.entities.add({id:`grading-wall:${area.id}:${i}`,name:`${area.name||area.id} · contenimento`,wall:{positions:points.map(p=>Cesium.Cartesian3.fromDegrees(p[0],p[1])),minimumHeights:ground.map((z,k)=>hm.toEllipsoid(Math.min(z,design[k]!))),maximumHeights:ground.map((z,k)=>hm.toEllipsoid(Math.max(z,design[k]!)+.03)),material:Cesium.Color.fromCssColorString('#97948c')},properties:{areaId:area.id}}));
  }
 }
 return entities;
}
