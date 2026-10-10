import { test, expect } from '@playwright/test';
import { createProject, openWorkspace, junctions } from './helpers';

test('Elios proactively exposes a native long-cycle warning and prepares contextual investigation', async ({page,request})=>{
  await openWorkspace(page,await createProject(request,'Elios diagnostics'));
  const node=(await junctions(page,4))[0]!;
  await page.evaluate(async id=>{
    const t='/src/elios/tools.ts',s='/src/state/store.ts',c='/src/elios/Elios.tsx';
    const tools=await import(t),store=await import(s);
    await tools.toolByName('design_signal_plan').run({nodeId:id});
    const plan=Object.values(store.useApp.getState().network.signalPlans).find((p:any)=>p.nodeId===id) as any;
    // Extend actual green times proportionally, preserving intergreens and native validation.
    const fixed=plan.phases.reduce((sum:number,p:any)=>sum+p.yellowS+p.allRedS,0),green=plan.phases.reduce((sum:number,p:any)=>sum+p.greenS,0);
    const next={...plan,cycleS:180,phases:plan.phases.map((p:any)=>({...p,greenS:p.greenS*(180-fixed)/green}))};
    const payload=store.useApp.getState().scenario.operations.at(-1).payload;
    const result=store.commit('signal.setPlan',{...payload,plan:next});if(!result.ok)throw Error(JSON.stringify(result.issues));
    (await import(c)).useElios.setState({open:true});
  },node.id);
  const diagnostics=page.locator('.elios-diagnostics');
  await expect(diagnostics).toBeVisible();
  await diagnostics.locator('summary').click();
  await expect(diagnostics).toContainText('180 s');
  await diagnostics.getByRole('button',{name:'Prepara richiesta a Elios'}).first().click();
  await expect(page.getByRole('textbox',{name:'Messaggio per Elios'})).toHaveValue(/Indaga questo rilievo effettivo/);
  await page.screenshot({path:'.shots/elios-diagnostics.png',fullPage:true});
});
