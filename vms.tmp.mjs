import { chromium } from '@playwright/test';
const SD='/tmp/claude-0/-home-user-urban/047d2a46-5fe5-5d2c-a160-6709b148b5f9/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, storageState: SD+'/state.json' });
const p = await ctx.newPage();
const logs=[]; p.on('pageerror', e => logs.push('PAGEERROR '+e.message));
await p.goto('http://127.0.0.1:8765/'); await p.waitForTimeout(1500);
const meta = await p.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: 'frattamaggiore', name: 'PMV test' }) })).json()));
const pid = meta.id; const bb = meta.bbox; const c = [(bb[0]+bb[2])/2, (bb[1]+bb[3])/2];
const script = [
  [{functionCall:{name:'apply_operations',args:{label:'PMV',ops:[{type:'asset.add',payload:{assets:[{id:'vms1',type:'traffic.vms',at:c,rotationDeg:0,state:'project',properties:{vmsText:'ZTL ATTIVA\nDALLE 8 ALLE 20'},provenance:{kind:'project',source:'test'}}]}}]}}}],
  [{text:'Fatto'}],
];
let n=0;
await p.route('**/api/elios/chat', async (route) => { const parts = script[n++] ?? [{text:'ok'}]; await route.fulfill({ json: { status:'ok', parts } }); });
await p.goto('http://127.0.0.1:8765/#/p/'+pid); await p.waitForTimeout(9000);
await p.click('.elios-orb'); await p.fill('.elios-input textarea', 'pmv'); await p.keyboard.press('Enter');
await p.waitForTimeout(4000);
console.log((await p.locator('.elios-action').allTextContents()).join(' | '));
await p.click('.elios-head button[aria-label=Chiudi]', { timeout: 3000 }).catch(() => {});
const box = await p.locator('.ws-stage').boundingBox();
await p.mouse.move(box.x + box.width/2, box.y + box.height/2);
for (let i=0;i<9;i++){ await p.mouse.wheel(0,-400); await p.waitForTimeout(250);} 
await p.waitForTimeout(2500);
await p.screenshot({ path: SD+'/shots/vms-map.png' });
await p.getByRole('button', { name: /^Traffico/ }).first().click(); await p.waitForTimeout(3000);
await p.screenshot({ path: SD+'/shots/vms-traffic.png' });
await p.getByRole('button', { name: /^Civico FST/ }).first().click(); await p.waitForTimeout(12000);
await p.screenshot({ path: SD+'/shots/civic.png' });
console.log(logs.join('\n'));
await b.close();
