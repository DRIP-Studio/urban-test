import {expect,test} from '@playwright/test';
import {createProject,openWorkspace} from './helpers';
import {resolve} from 'node:path';
test('exact profile extrema are visible and readable by Elios from native authored geometry',async({page,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openWorkspace(page,await createProject(request,'Profile extrema QA'));
 const expected=await page.evaluate(async(c)=>{const p='/src/state/store.ts',t='/src/state/terrain.ts';const s=await import(p),state=s.useApp.getState(),[x,y]=state.baseline.origin;
 (await import(t)).useTerrain.setState({loaded:true,grid:{west:x-.1,south:y-.1,east:x+.1,north:y+.1,nx:2,ny:2,z:[20,20,20,20],resolutionM:10000,source:'Explicit synthetic flat DTM — QA fixture'}});
 const road=Object.values(state.network.roads).find((r:any)=>r.from!==r.to&&r.axis.length===2&&Math.hypot((r.axis[1][0]-r.axis[0][0])*84000,(r.axis[1][1]-r.axis[0][1])*111000)>200) as any;
 const core=await import(c),f=new core.LocalFrame(state.baseline.origin),length=core.geom.lengthOf(road.axis.map((q:any)=>f.toMetric(q))),vertical={pvis:[{station:0,elevation:20},{station:length/2,elevation:22,curveLength:60},{station:length,elevation:21}]};
 const result=s.commit('road.setVertical',{roadId:road.id,vertical});if(!result.ok)throw Error(JSON.stringify(result));s.select({kind:'road',ids:[road.id]});s.openDock('profile');return core.verticalExtrema(vertical)[0];},'/@fs/'+resolve('packages/core/src/index.ts').replace(/\\/g,'/'));
 await expect(page.getByRole('button',{name:/Punto alto/})).toBeVisible();await expect(page.locator('.profile-chart').getByText(/^Max /)).toBeVisible();await page.getByRole('button',{name:/Punto alto/}).click();
 const report=await page.evaluate(async()=>{const p='/src/elios/tools.ts';return await (await import(p)).toolByName('vertical_profile_report')!.run({}) as any;});expect(JSON.stringify(report)).toContain('high');expect(JSON.stringify(report)).toContain(String(expected.station));
 await page.getByRole('button',{name:'Espandi pannello',exact:true}).click();await page.locator('.dock-body').evaluate(e=>e.scrollTop=0);await page.mouse.move(3,3);await page.screenshot({path:'.shots/profile-extrema.png',fullPage:true});expect(errors).toEqual([]);
});
