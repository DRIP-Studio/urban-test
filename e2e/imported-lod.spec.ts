import {expect,test} from '@playwright/test';
import {API,createProject,openWorkspace,opCount} from './helpers';

test('real imported mesh switches to declared distant bounds without editing authored assets',async({page,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const pid=await createProject(request,'Imported LOD QA');
 const positions=Buffer.from(new Float32Array([-5,0,0,5,0,0,0,10,0]).buffer);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:positions.length,uri:'data:application/octet-stream;base64,'+positions.toString('base64')}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-5,0,0],max:[5,10,0]}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[0.9,0.25,0.1,1],metallicFactor:0}}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 const uploaded=await request.post(`${API}/api/projects/${pid}/models`,{multipart:{file:{name:'QA-triangle.gltf',mimeType:'model/gltf+json',buffer:Buffer.from(JSON.stringify(doc))},w:'10',d:'1',h:'10'}});expect(uploaded.ok(),await uploaded.text()).toBe(true);const model=await uploaded.json();await openWorkspace(page,pid);
 await page.evaluate(async(id)=>{const p='/src/models/models.ts';await(await import(p)).loadModels();const s=(window as any).__drip,s0=s.useApp.getState(),[x,y]=s0.baseline.origin;const r=s.commit('asset.add',{assets:[{id:'import-lod',type:`model:${id}`,at:[x,y],rotationDeg:0,state:'project',properties:{},provenance:{kind:'project',source:'QA imported triangle'}}]});if(!r.ok)throw Error(JSON.stringify(r));},model.id);
 const count=await opCount(page);await page.getByRole('button',{name:'Twin 3D',exact:true}).click();await page.waitForFunction(()=>Boolean((window as any).__dripTwin));
 const camera=async(range:number)=>page.evaluate(range=>{const {viewer,Cesium:C}=(window as any).__dripTwin,[x,y]=(window as any).__drip.useApp.getState().baseline.origin;viewer.camera.lookAt(C.Cartesian3.fromDegrees(x,y,0),new C.HeadingPitchRange(0,-.8,range));viewer.scene.requestRender();},range);
 const loaded=()=>page.evaluate(()=>{const {viewer}=(window as any).__dripTwin;for(let i=0;i<viewer.scene.primitives.length;i++){const p=viewer.scene.primitives.get(i);if(p.id==='import-lod'&&p.ready)return true;}return false;});
 await camera(100);await expect.poll(loaded).toBe(true);await page.screenshot({path:'.shots/imported-lod-near.png'});
 await camera(1800);await expect.poll(loaded).toBe(false);await expect(page.getByText(/modelli importati lontani = ingombro/)).toBeVisible();await page.screenshot({path:'.shots/imported-lod-far.png'});expect(await opCount(page)).toBe(count);
 await camera(100);await expect.poll(loaded).toBe(true);expect(errors).toEqual([]);
});
