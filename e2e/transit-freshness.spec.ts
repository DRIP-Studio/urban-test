import {expect,test} from '@playwright/test';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {API,createProject,openWorkspace} from './helpers';
test('real GTFS protobuf through API labels stale and missing timestamps and clears failures',async({page,request})=>{
 const py=resolve('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const script="from google.transit import gtfs_realtime_pb2; f=gtfs_realtime_pb2.FeedMessage(); f.header.gtfs_realtime_version='2.0'; f.header.timestamp=1; e=f.entity.add(); e.id='fixture'; e.vehicle.position.latitude=40.94; e.vehicle.position.longitude=14.27; print(f.SerializeToString().hex()); f.header.ClearField('timestamp'); print(f.SerializeToString().hex())";
 const generated=spawnSync(py,['-c',script],{encoding:'utf8'});expect(generated.status,generated.stderr).toBe(0);const feeds=generated.stdout.trim().split(/\r?\n/).map(s=>Buffer.from(s,'hex'));let mode=0;
 const server=createServer((_req,res)=>{res.writeHead(mode===2?503:200,{'Content-Type':'application/x-protobuf'});res.end(mode===2?'Unavailable':feeds[mode]);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 try{
  const saved=await request.put(`${API}/api/providers/gtfs_rt`,{data:{value:`http://127.0.0.1:${port}/fixture.pb`}});expect(saved.ok()).toBe(true);
  await openWorkspace(page,await createProject(request,'GTFS freshness QA'));await page.getByRole('button',{name:'TPL',exact:true}).click();await page.getByText('Tempo reale (GTFS-RT)',{exact:true}).click();await page.getByRole('button',{name:'Leggi posizioni veicoli',exact:true}).click();await expect(page.getByText('Feed non aggiornato',{exact:true})).toBeVisible();await expect(page.getByText(/1 posizioni nel feed/)).toBeVisible();await page.getByText('Feed non aggiornato',{exact:true}).scrollIntoViewIfNeeded();await page.mouse.move(3,3);await page.screenshot({path:'.shots/gtfs-stale.png',fullPage:true});
  mode=1;await page.getByRole('button',{name:'Leggi posizioni veicoli',exact:true}).click();await expect(page.getByText('Data del feed non verificata',{exact:true})).toBeVisible();
  mode=2;await page.getByRole('button',{name:'Leggi posizioni veicoli',exact:true}).click();await expect(page.getByText('Feed non aggiornato',{exact:true})).toHaveCount(0);await expect(page.getByText('Data del feed non verificata',{exact:true})).toHaveCount(0);
 }finally{await request.put(`${API}/api/providers/gtfs_rt`,{data:{value:''}});await new Promise<void>((r,e)=>server.close(err=>err?e(err):r()));}
});
