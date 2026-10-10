import {underpassDesign, type UnderpassDesign} from '../analysis/underpass';
import {defineOperation} from './registry';
export const setUnderpass = defineOperation<{roadId:string; design:UnderpassDesign}>({
  type:'road.setUnderpass', label:p=>p.design.usage==='pedestrian'?'Sottopasso pedonale con rampe':'Sottopasso stradale con rampe',
  validate:(net,p)=> !net.roads[p.roadId] ? [{code:'underpass.road', severity:'error', message:'Strada inesistente'}] : underpassDesign(net.roads[p.roadId]!,p.design).errors.map(message=>({code:'underpass.design',severity:'error',message})),
  apply(net,p){
    const road=net.roads[p.roadId]!, design=p.design, result=underpassDesign(road,design);
    const {usage,clearanceM,slabM,rampLengthM,maxGradePct}=design;
    const oldPassage=road.structure?.underpass;
    const previousVertical=oldPassage?oldPassage.previousVertical:road.vertical??null;
    const saved=oldPassage?.previousTraffic;
    const previousTraffic=usage==='pedestrian'?(saved??{roadClass:road.roadClass,speedKmh:road.speedKmh,oneway:road.oneway,lanes:road.lanes,section:road.section,restrictions:road.restrictions,tags:road.tags,provenance:road.provenance}):undefined;
    const traffic=usage==='road'&&saved?{...road,...saved}:road;
    return {...net,roads:{...net.roads,[road.id]:{...traffic,
      vertical:result.vertical,
      structure:{type:'covered' as const,heightM:design.depthM,layer:-1,underpass:{usage,clearanceM,slabM,rampLengthM,maxGradePct,previousTraffic,previousVertical}},
      ...(usage==='pedestrian'?{roadClass:'footway',speedKmh:5,oneway:'no' as const,lanes:(road.lanes.length?road.lanes:[{id:`${road.id}:walk`,index:0,widthM:3,turns:[]}]).map(l=>({...l,direction:'reversible' as const,modes:['walk','bike'] as const,restriction:'none' as const,restrictionSchedule:undefined})),section:{elements:road.section.elements.map(e=>({...e,kind:e.kind==='lane'||e.kind==='bus'?'sidewalk' as const:e.kind}))},restrictions:{...road.restrictions,motorVehicle:'no' as const},tags:{...road.tags,highway:'footway',foot:'yes',motor_vehicle:'no'}}:{}),
      provenance:{...traffic.provenance,structure:{kind:'project' as const,source:'Sottopasso DRIP Urban'},vertical:{kind:'project' as const,source:'Quote dichiarate sottopasso'},...(usage==='pedestrian'?{roadClass:{kind:'project' as const,source:'Passaggio pedonale'}}:{})}
    }}};
  }
});
