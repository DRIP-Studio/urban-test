import {expect,test} from '@playwright/test';
import {createProject,openWorkspace,junctions} from './helpers';
test('TPL runs through project history, real worker, stops and Twin follow',async({page,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const pid=await createProject(request,'Operational TPL');await openWorkspace(page,pid);
 await page.evaluate(async()=>{
  const p='/src/state/store.ts',t='/src/state/projectTime.ts',m='/src/transit/model.ts',picks='/src/tools/picks.ts';
  const {useApp,commit}=await import(p);const state=useApp.getState(),distance=(a:any,b:any)=>Math.hypot((a[0]-b[0])*84000,(a[1]-b[1])*111000);
  const roads=Object.values(state.network.roads).filter((r:any)=>r.axis.length===2&&r.lanes.length&&distance(r.axis[0],r.axis[1])>250) as any[];
  const road=roads.sort((a,b)=>distance(a.axis[0],state.baseline.origin)-distance(b.axis[0],state.baseline.origin))[0];
  const pts=[.15,.5,.85].map(t=>[road.axis[0][0]+(road.axis[1][0]-road.axis[0][0])*t,road.axis[0][1]+(road.axis[1][1]-road.axis[0][1])*t]);const line=(await import(m)).defaultLine('qa-tpl','tram',[pts[0],pts[2]],0);
  line.name='Tram operativo QA';line.firstDeparture='08:00';line.lastDeparture='20:00';line.headways={peak:2,offpeak:2,evening:2,weekend:2};line.dwellS=10;line.stops=pts.map((at,i)=>({id:`qa-${i}`,name:`Fermata ${i+1}`,at,arrivalsPerHour:120,alightFraction:.5}));
  commit('transit.set',{lines:[line]});(await import(picks)).usePicks.setState({selectedRouteId:line.id});(await import(t)).setProjectWallTime('2026-10-09',480);
 });
 await page.getByRole('button',{name:'TPL',exact:true}).click();await expect(page.getByLabel('Sosta TPL')).toBeVisible();
 await page.getByLabel('Sosta TPL').fill('12');await page.getByLabel('Sosta TPL').press('Enter');await page.getByLabel('Sosta TPL').blur();
 await page.keyboard.press('Control+z');await expect(page.getByLabel('Sosta TPL')).toHaveValue('10');
 await page.evaluate(async()=>{const p='/src/engine/engine.ts',t='/src/state/projectTime.ts';const {engine}=await import(p),state=(window as any).__drip.useApp.getState();engine.simulationBaseline(state.baseline,state.scenario.operations);engine.simStart({mode:'microscopic',day:4,hour:8,dailyTrips:0,scale:1,seed:42,clock:{...(await import(t)).getProjectClock(),speed:4}});});
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/engine/engine.ts';return (await import(p)).engine.lastSim?.metrics.transit?.[0]?.departed??0;})).toBeGreaterThan(0);
 await expect(page.getByText('Mezzi attivi',{exact:true})).toBeVisible();await page.getByText('Mezzi attivi',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.shots/tpl-operational.png',fullPage:true});
 await page.getByRole('button',{name:'Twin 3D',exact:true}).click();await page.waitForFunction(()=>Boolean((window as any).__dripTwin));
 await page.evaluate(async()=>{const p='/src/engine/engine.ts',u='/src/twin/viewState.ts';const {engine}=await import(p);const d=engine.lastSim.data;let id=0;for(let i=0;i<d.length;i+=6)if(d[i+3]===5){id=d[i+5];break;}if(!id)throw Error('Tram non presente');(await import(u)).pickTwinVehicle(id);});
 await page.getByRole('button',{name:'Segui veicolo',exact:true}).click();await expect(page.getByLabel('Telemetria veicolo Twin')).toContainText('Tram operativo QA');await page.waitForTimeout(2500);await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);await page.screenshot({path:'.shots/tpl-tram-follow.png',fullPage:true});expect(errors).toEqual([]);
});
test('signal candidate comparison evaluates real solver outcomes before applying',async({page,request})=>{
 const pid=await createProject(request,'Signal optimisation');await openWorkspace(page,pid);const node=(await junctions(page,4))[0]!;
 await page.evaluate(async(id)=>{const p='/src/state/store.ts';const {select,setDock}=await import(p);select({kind:'node',ids:[id]});setDock('signals');},node.id);
 await page.getByText('Ottimizzazione verificata nel solver',{exact:true}).click();await page.getByLabel('Durata ottimizzazione').fill('30');await page.getByLabel('Durata ottimizzazione').press('Enter');await page.getByRole('button',{name:'Confronta cicli, offset e controller',exact:true}).click();await expect(page.getByText('Valutazione completata',{exact:true})).toBeVisible({timeout:60000});expect(await page.getByRole('button',{name:'Usa candidato',exact:true}).count()).toBeGreaterThanOrEqual(8);await page.getByText('Valutazione completata',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.shots/signal-optimisation.png',fullPage:true});
});

test('bike sharing uses native history and manual road routes never substitute disconnected straight lines',async({page,request})=>{
 await openWorkspace(page,await createProject(request,'Bike history and routing'));
 const count=await page.evaluate(()=>(window as any).__drip.useApp.getState().scenario.operations.length);
 await page.evaluate(async()=>{const p='/src/tools/picks.ts',store=(window as any).__drip.useApp.getState();(await import(p)).usePicks.getState().addBikeStation(store.baseline.origin);});
 await expect.poll(()=>page.evaluate(()=>(window as any).__drip.useApp.getState().network.bikeShare?.stations.length??0)).toBe(1);await page.locator('.statusbar').click();await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(()=>(window as any).__drip.useApp.getState().network.bikeShare?.stations.length??0)).toBe(0);await page.keyboard.press('Control+Shift+z');await expect.poll(()=>page.evaluate(()=>(window as any).__drip.useApp.getState().network.bikeShare?.stations.length??0)).toBe(1);
 await page.evaluate(async()=>{const p='/src/tools/picks.ts';(await import(p)).usePicks.getState().addTransitRoute([[-170,-70],[-169,-71]]);});await expect(page.getByText('Linea TPL non creata',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__drip.useApp.getState().scenario.operations.length)).toBe(count+1);
});
