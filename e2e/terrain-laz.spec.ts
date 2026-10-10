import {expect,test} from '@playwright/test';
import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';
import {createProject,openWorkspace} from './helpers';
test('actual compressed LAZ upload reaches native terrain and rendered profile',async({page,request})=>{
 await openWorkspace(page,await createProject(request,'LAZ terrain QA'));
 const bbox=await page.evaluate(async()=>{const p='/src/state/store.ts';const s=await import(p),state=s.useApp.getState(),r=Object.values(state.network.roads).find((r:any)=>r.from!==r.to&&r.axis.length===2) as any;s.select({kind:'road',ids:[r.id]});s.openDock('profile');return state.project.bbox;});
 const script="import sys,json,io,base64,laspy,numpy as np; sys.path.insert(0,'services/api'); from tests.test_terrain import _plane_points; p,_=_plane_points(json.loads(sys.stdin.read()),step=25); d=laspy.LasData(laspy.LasHeader(version='1.2',point_format=0)); d.x=np.array([q[0] for q in p]); d.y=np.array([q[1] for q in p]); d.z=np.array([q[2] for q in p]); d.classification=np.array([q[3] for q in p]); b=io.BytesIO(); d.write(b,do_compress=True); print(base64.b64encode(b.getvalue()).decode())";
 const generated=spawnSync(resolve('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),['-c',script],{encoding:'utf8',input:JSON.stringify(bbox),maxBuffer:10*1024*1024});expect(generated.status,generated.stderr).toBe(0);
 await page.getByLabel('Passo della griglia per nuvole di punti',{exact:true}).fill('25');await page.getByLabel('Passo della griglia per nuvole di punti',{exact:true}).press('Enter');const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Carica rilievo (.asc, .las, .laz, .xyz)',exact:true}).click();await(await chooser).setFiles({name:'qa-ground.laz',mimeType:'application/octet-stream',buffer:Buffer.from(generated.stdout.trim(),'base64')});
 await expect(page.locator('.profile-chart')).toBeVisible({timeout:60000});await expect(page.getByText(/DTM da LAZ/)).toBeVisible();await page.getByRole('button',{name:'Espandi pannello',exact:true}).click();await page.screenshot({path:'.shots/laz-profile.png',fullPage:true});
});
