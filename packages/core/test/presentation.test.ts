import {expect,it} from 'vitest';
import {presentationErrors} from '../src/index';
it('validates native scenes, camera paths, clocks, annotations and live settings',()=>{const c={lon:14.28,lat:40.94,height:100,heading:355,pitch:-30};expect(presentationErrors({scenes:[{id:'s',title:'Real path',text:'',camera:null,twin:c,path:[c,{...c,heading:5}],durationS:12,liveSimulation:{mode:'hybrid',dailyTrips:60000,seed:42},annotations:[{id:'a',at:[14.28,40.94],text:'Cantiere'}]}]})).toEqual([]);expect(presentationErrors({scenes:[{id:'s',title:'Invalid',text:'',camera:null,path:[c],durationS:0}]})).not.toEqual([]);});

it('rejects untraceable charts, out-of-stage graphics and missing arrow endpoints',()=>{
 const scene={id:'s',title:'Data',text:'',camera:null},chart={id:'c',kind:'chart' as const,x:4,y:4,width:30,height:30,title:'Data',fontPx:16,color:'#252726',rows:[{label:'Before',value:-2,color:'#277496'}],source:'Authored metric'};
 expect(presentationErrors({scenes:[{...scene,graphics:[chart]}]})).toEqual([]);
 expect(presentationErrors({scenes:[{...scene,graphics:[{...chart,source:''}]}]})).toContain('Grafico senza fonte dichiarata');
 expect(presentationErrors({scenes:[{...scene,graphics:[{...chart,x:90}]}]})).not.toEqual([]);
 expect(presentationErrors({scenes:[{...scene,annotations:[{id:'a',kind:'arrow',at:[14,40],text:'Direction'}]}]})).toContain('Annotazione non valida');
 expect(presentationErrors({scenes:[{...scene,graphics:[{...chart,kind:'image',textureId:'../../secret'}]}]})).toContain('Immagine scena non valida');
});
