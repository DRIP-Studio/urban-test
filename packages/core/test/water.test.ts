import { describe, expect, it } from 'vitest';
import { LocalFrame, analyzeWater, fireFlowCheck, hwResistance, sizeWaterPipes, type Network, type WaterNode, type WaterPipe } from '../src/index';

const o: [number, number] = [14.27, 40.94];
const f = new LocalFrame(o);
const LL = (x: number, y: number) => f.toLngLat([x, y]);
const node = (id: string, kind: WaterNode['kind'], x: number, y: number, extra: Partial<WaterNode> = {}): WaterNode => ({ id, kind, at: LL(x, y), elevation: 10, ...extra });
const pipe = (id: string, from: string, to: string, dn = 160, extra: Partial<WaterPipe> = {}): WaterPipe => ({ id, from, to, diameterMm: dn, material: 'PEAD', c: 150, ...extra });
const net = (nodes: WaterNode[], pipes: WaterPipe[]): Network => ({ nodes: {}, roads: {}, assets: {}, junctions: {}, roundabouts: {}, signalPlans: {}, zones: {}, areas: {}, waterNodes: Object.fromEntries(nodes.map((n) => [n.id, n])), waterPipes: Object.fromEntries(pipes.map((p) => [p.id, p])) });

describe('water supply network (global gradient, Hazen–Williams)', () => {
  it('single pipe: head loss equals Hazen–Williams', () => {
    const n = net([node('R', 'reservoir', 0, 0, { headM: 60 }), node('A', 'junction', 500, 0, { demandLs: 10 })], [pipe('p', 'R', 'A', 110)]);
    const r = analyzeWater(n);
    expect(r.converged).toBe(true);
    const hl = hwResistance(500, 110, 150) * 0.01 ** 1.852;
    expect(r.nodes.A!.headM).toBeCloseTo(60 - hl, 2);
    expect(r.pipes.p!.flowLs).toBeCloseTo(10, 3);
  });

  it('looped network: mass balance at every junction, closed pipe carries nothing', () => {
    const nodes = [node('R', 'reservoir', 0, 0, { headM: 55 }), node('A', 'junction', 300, 0, { demandLs: 4 }), node('B', 'junction', 300, 300, { demandLs: 6 }), node('C', 'junction', 0, 300, { demandLs: 3 }), node('D', 'hydrant', 150, 150, { demandLs: 0 })];
    const pipes = [pipe('p1', 'R', 'A', 200), pipe('p2', 'A', 'B', 160), pipe('p3', 'B', 'C', 110), pipe('p4', 'C', 'R', 160), pipe('p5', 'A', 'D', 90, { status: 'closed' }), pipe('p6', 'D', 'B', 90)];
    const n = net(nodes, pipes);
    const r = analyzeWater(n);
    expect(r.converged).toBe(true);
    for (const j of ['A', 'B', 'C', 'D']) {
      let bal = 0;
      for (const p of pipes) { const q = r.pipes[p.id]!.flowLs; if (p.to === j) bal += q; if (p.from === j) bal -= q; }
      expect(Math.abs(bal - (n.waterNodes![j]!.demandLs ?? 0))).toBeLessThan(1e-3);
    }
    expect(r.pipes.p5!.flowLs).toBe(0);
    expect(r.nodes.B!.pressureM).toBeGreaterThan(30);
    expect(r.issues.some((i) => /sotto/.test(i.message))).toBe(false);
  });

  it('reports low pressure, unsupplied nodes and sizes pipes; fire flow check', () => {
    const n = net([node('R', 'reservoir', 0, 0, { headM: 30 }), node('A', 'junction', 2000, 0, { demandLs: 15 }), node('Z', 'junction', 0, 900, { demandLs: 1 })], [pipe('p', 'R', 'A', 75)]);
    const r = analyzeWater(n);
    expect(r.issues.some((i) => i.nodeId === 'A' && /sotto/.test(i.message))).toBe(true);
    expect(r.issues.some((i) => i.nodeId === 'Z' && /non collegato/.test(i.message))).toBe(true);
    const sizes = sizeWaterPipes(n);
    expect(sizes.p).toBeGreaterThanOrEqual(125);
    const ok = net([node('R', 'reservoir', 0, 0, { headM: 70 }), node('H', 'hydrant', 200, 0)], [pipe('p', 'R', 'H', 160)]);
    expect(fireFlowCheck(ok, 'H', 10).ok).toBe(true);
  });
});
