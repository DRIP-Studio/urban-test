import type { CDPSession } from '@playwright/test';

/** Measure the simulation isolate, not just the page containing the renderers. */
export async function simulationWorkerHeap(cdp: CDPSession): Promise<number> {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.type === 'worker' && t.url.includes('simulation.worker'));
  if (!target) throw new Error('Simulation worker target unavailable');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let sequence = 0;
  const command = (method: string) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', receive); reject(new Error(`Worker ${method} timed out`)); }, 10000);
    const receive = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== sessionId) return;
      const response = JSON.parse(event.message);
      if (response.id !== id) return;
      clearTimeout(timeout); cdp.off('Target.receivedMessageFromTarget', receive);
      if (response.error) reject(new Error(JSON.stringify(response.error))); else resolve(response.result);
    };
    cdp.on('Target.receivedMessageFromTarget', receive);
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method }) }).catch(reject);
  });
  try {
    await command('HeapProfiler.collectGarbage');
    return (await command('Runtime.getHeapUsage')).usedSize;
  } finally { await cdp.send('Target.detachFromTarget', { sessionId }); }
}
