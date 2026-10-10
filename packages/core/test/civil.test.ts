import {expect,it} from 'vitest';
import {verticalExtrema,LocalFrame,designAlignment,alignmentDesignErrors,corridorCrossfall,corridorErrors,roadWithAxis,horizontalAlignment,sliceVerticalProfile,designElevation,type Road} from '../src/index';
it('integrates a circular quadrant with millimetre precision and preserves chainage',()=>{
 const origin=[14.28,40.94] as const,f=new LocalFrame(origin),result=designAlignment(origin,{bearingDeg:0,elements:[{id:'a',kind:'arc',lengthM:Math.PI*50,radiusM:100,turn:'left'}]});
 const end=f.toMetric(result.axis.at(-1)!);expect(end[0]).toBeCloseTo(-100,3);expect(end[1]).toBeCloseTo(100,3);expect(result.lengthM).toBe(Math.PI*50);expect(result.endBearingDeg).toBeCloseTo(-90,6);
});
it('integrates a clothoid with linear curvature and rejects broken curvature continuity',()=>{
 const design={bearingDeg:0,elements:[{id:'c',kind:'clothoid' as const,lengthM:50,startCurvature:0,endCurvature:.01}]};
 const result=designAlignment([14.28,40.94],design);expect(result.samples.at(-1)?.curvature).toBe(.01);expect(result.endBearingDeg).toBeCloseTo(.25*180/Math.PI,6);
 expect(alignmentDesignErrors({...design,elements:[{...design.elements[0]!,startCurvature:.01}]})).toContain('La clotoide non raccorda la curvatura precedente');
});
it('interpolates superelevation in metres by chainage and validates assemblies',()=>{
 const c={layers:[{id:'a',name:'Pavement',material:'asphalt',thicknessM:.3}],crossfall:[{station:0,leftPct:-2,rightPct:-2},{station:100,leftPct:6,rightPct:-6}],cutSlope:1,fillSlope:1.5};
 expect(corridorCrossfall(c,50,5)).toBeCloseTo(.1,6);expect(corridorCrossfall(c,50,-5)).toBeCloseTo(-.2,6);expect(corridorErrors(c)).toEqual([]);expect(corridorErrors({...c,crossfall:[c.crossfall[1]!,c.crossfall[0]!]})).not.toEqual([]);
});

it('reparameterises profile and crossfall stations when the road axis changes',()=>{
 const origin=[14.28,40.94] as const,f=new LocalFrame(origin);
 const road:Road={id:'r',from:'a',to:'b',name:'Profile test',roadClass:'residential',oneway:'no',speedKmh:30,lanes:[],section:{elements:[]},axis:[origin,f.toLngLat([0,100])],vertical:{pvis:[{station:0,elevation:10},{station:50,elevation:12,curveLength:20},{station:100,elevation:11}]},corridor:{layers:[],crossfall:[{station:0,leftPct:-2,rightPct:-2},{station:100,leftPct:4,rightPct:-4}],cutSlope:1,fillSlope:1.5},provenance:{}};
 const changed=roadWithAxis(road,[origin,f.toLngLat([0,200])]);
 expect(changed.vertical?.pvis[1]?.station).toBeCloseTo(100,5);expect(changed.vertical?.pvis[1]?.curveLength).toBeCloseTo(40,5);expect(changed.vertical?.pvis.at(-1)?.elevation).toBe(11);expect(changed.corridor?.crossfall.at(-1)?.station).toBeCloseTo(200,5);expect(road.vertical?.pvis.at(-1)?.station).toBe(100);
});

it('uses exact authored arc and clothoid curvature for design speed checks',()=>{
 const origin=[14.28,40.94] as const,alignment={bearingDeg:0,elements:[{id:'c',kind:'clothoid' as const,lengthM:30,startCurvature:0,endCurvature:.1},{id:'a',kind:'arc' as const,lengthM:15,radiusM:10,turn:'right' as const}]},axis=designAlignment(origin,alignment).axis;
 const road:Road={id:'r',from:'a',to:'b',name:'',roadClass:'residential',oneway:'no',speedKmh:50,lanes:[],section:{elements:[]},axis,alignment,provenance:{}};
 const result=horizontalAlignment(road,origin);expect(result.elements.map(e=>e.kind)).toEqual(['clothoid','curve']);expect(result.elements[1]!.radiusM).toBe(10);expect(Math.max(...result.curvature.map(p=>Math.abs(p.k)))).toBe(.1);expect(result.issues.some(i=>i.message.includes('sotto il minimo'))).toBe(true);expect(result.method).toContain('analitico');
});

it('preserves every elevation when clipping within a parabolic vertical curve',()=>{
 const v={pvis:[{station:0,elevation:10},{station:50,elevation:15,curveLength:40},{station:100,elevation:10}]};
 for(const [start,end] of [[0,44],[44,100],[35,63],[20,80]]){const clipped=sliceVerticalProfile(v,start!,end!);expect(clipped.pvis[0]!.station).toBe(0);expect(clipped.pvis.at(-1)!.station).toBe(end!-start!);for(let s=0;s<end!-start!;s+=.7)expect(designElevation(clipped,s)).toBeCloseTo(designElevation(v,start!+s),8);}
 expect(v.pvis).toHaveLength(3);
});

it('locates exact extrema of asymmetric parabolic curves and sharp grade reversals',()=>{
 const v={pvis:[{station:0,elevation:0},{station:100,elevation:10,curveLength:60},{station:200,elevation:5}]};
 const [peak]=verticalExtrema(v);expect(peak!.kind).toBe('high');expect(peak!.station).toBeCloseTo(110,8);expect(peak!.elevation).toBeCloseTo(designElevation(v,110),8);expect(designElevation(v,109.9)).toBeLessThan(peak!.elevation);expect(designElevation(v,110.1)).toBeLessThan(peak!.elevation);
 expect(verticalExtrema({pvis:[{station:0,elevation:10},{station:50,elevation:0},{station:100,elevation:10}]})).toEqual([{station:50,elevation:0,kind:'low'}]);
 expect(verticalExtrema({pvis:[{station:0,elevation:0},{station:50,elevation:5},{station:100,elevation:10}]})).toEqual([]);
});
