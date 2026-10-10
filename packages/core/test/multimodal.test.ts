import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { LocalFrame, NetworkReplayer, multimodalAlternatives, multimodalRoute, route, type CityBaseline, type TransitLine } from '../src/index';
const baseline = JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../../services/api/seed/frattamaggiore.baseline.json.gz', import.meta.url)))).toString()) as CityBaseline;
const source = new NetworkReplayer().derive(baseline, []).net, frame = new LocalFrame(baseline.origin);
const at = (x: number) => frame.toLngLat([x, 0]);
const template = Object.values(source.roads).find(r => r.oneway === 'no' && r.lanes.some(l => l.modes.includes('car')))!;
const roads = Object.fromEntries([0, 1].map(i => [`r${i}`, { ...template, id: `r${i}`, from: `n${i}`, to: `n${i + 1}`, axis: [at(i * 1000), at((i + 1) * 1000)], tags: {}, restrictions: undefined, structure: undefined, speedKmh: 30 }]));
const base = { ...source, roads, nodes: Object.fromEntries([0, 1, 2].map(i => [`n${i}`, { id: `n${i}`, at: at(i * 1000) }])), zones: {}, signalPlans: {}, roundabouts: {}, junctions: {} };
const line = (id: string, start: number, end: number): TransitLine => ({ id, name: id, mode: 'bus', color: '#ff8000', line: [at(start), at(end)], stops: [{ id: `${id}a`, name: `${id} A`, at: at(start) }, { id: `${id}b`, name: `${id} B`, at: at(end) }], headways: { peak: 5, offpeak: 5, evening: 5, weekend: 10 }, firstDeparture: '08:00', lastDeparture: '23:00', vehicle: 'Bus', capacity: 50, speedKmh: 30, dwellS: 20 });
const net = { ...base, transit: [line('L1', 100, 900), line('L2', 1100, 1900)] };
const ctx = { mode: 'walk' as const, day: 4, minutes: 480, date: '2026-10-09' };
it('routes actual walking transfers and scheduled waits across two native services', () => {
  const r = multimodalRoute(net, baseline.origin, at(100), at(1900), ctx, { requireTransit: true, accessM: 100, transferM: 300 });
  expect(r.found).toBe(true); expect(r.steps.some(s => s.instruction.startsWith('L1:'))).toBe(true); expect(r.steps.some(s => s.instruction.startsWith('L2:'))).toBe(true);
  expect(r.steps.some(s => s.instruction === 'Cambio linea a piedi')).toBe(true);
  expect(r.steps.some(s => s.instruction.startsWith('Attendi'))).toBe(true);
  expect(r.durationS).toBeCloseTo(r.steps.reduce((s, step) => s + step.durationS, 0), 5);
  expect(r.distanceM).toBeCloseTo(1800, 1);
});
it('never substitutes a straight transit leg for a road closed to motor vehicles', () => {
  const blocked = { ...net, roads: { ...roads, r1: { ...roads.r1!, restrictions: { motorVehicle: 'no' as const }, lanes: roads.r1!.lanes.map(l => ({ ...l, restriction: 'closed' as const })) } } };
  expect(multimodalRoute(blocked, baseline.origin, at(100), at(1900), ctx, { requireTransit: true, accessM: 100, transferM: 300 }).found).toBe(false);
  expect(multimodalRoute({ ...base, transit: [] }, baseline.origin, at(100), at(1900), ctx).found).toBe(true);
});
it('routes motorcycles in general lanes and respects motor vehicle restrictions', () => {
  expect(route(base, baseline.origin, at(100), at(1900), { ...ctx, mode: 'motorcycle' }).found).toBe(true);
  const blocked = { ...base, roads: { ...roads, r1: { ...roads.r1!, restrictions: { motorVehicle: 'no' as const } } } };
  expect(route(blocked, baseline.origin, at(100), at(1900), { ...ctx, mode: 'motorcycle' }).roadIds).not.toContain('r1');
});

it('checks timed closures after waiting and permits a road that opens before boarding', () => {
  const timed = (from: string, to: string) => ({...base, transit:[line('Scheduled',100,900)], roads:{...roads,r0:{...roads.r0!,lanes:roads.r0!.lanes.map(l=>({...l,restriction:'closed' as const,restrictionSchedule:[{days:[4],from,to}]}))}}});
  const options = {requireTransit:true,accessM:1,transferM:0};
  const start = {...ctx,minutes:481}; // waits until 08:05
  const delayed=multimodalRoute(timed('08:05','08:10'),baseline.origin,at(100),at(900),start,options);expect(delayed.found).toBe(true);expect(delayed.durationS).toBeGreaterThan(540);
  expect(multimodalRoute(timed('08:00','08:04'),baseline.origin,at(100),at(900),start,options).found).toBe(true);
  const during=multimodalRoute(timed('08:06','08:10'),baseline.origin,at(100),at(900),start,options);expect(during.found).toBe(true);expect(during.durationS).toBeGreaterThan(540);
});

it('produces distinct scheduled alternatives using other authored services',()=>{
 const a=line('Express',100,900),b={...line('Local',100,900),speedKmh:15};
 const routes=multimodalAlternatives({...base,transit:[a,b]},baseline.origin,at(100),at(900),ctx,{requireTransit:true,accessM:1,transferM:0});
 expect(routes).toHaveLength(2);expect(routes[0]!.steps.some(s=>s.instruction.startsWith('Express:'))).toBe(true);expect(routes[1]!.steps.some(s=>s.instruction.startsWith('Local:'))).toBe(true);expect(routes[0]!.durationS).toBeLessThan(routes[1]!.durationS);
});

it('reprojects authored works at actual service date across midnight',()=>{
 const night={...line('Night',100,900),firstDeparture:'00:05',lastDeparture:'00:05'};
 const works=[{id:'closure',name:'Overnight works',contractor:'QA',category:'road',startDate:'2026-10-10',endDate:'2026-10-10',budget:0,status:'planned' as const,dependencies:[],targets:[{kind:'road' as const,id:'r0',action:'close' as const}]}];
 const result=multimodalRoute({...base,transit:[night],works},baseline.origin,at(100),at(900),{...ctx,minutes:1439},{requireTransit:true,accessM:1,transferM:0});
 expect(result.found).toBe(false);
});


it('does not use the opposite open lane to validate a scheduled forward service',()=>{
 const r={...roads.r0!,lanes:[{...roads.r0!.lanes[0]!,direction:'forward' as const,modes:['bus' as const],restriction:'closed' as const,restrictionSchedule:[{days:[4],from:'08:05',to:'08:10'}]},{...roads.r0!.lanes[0]!,direction:'backward' as const,modes:['bus' as const],restriction:undefined}]};
 const result=multimodalRoute({...base,roads:{...roads,r0:r},transit:[line('Directional',100,900)]},baseline.origin,at(100),at(900),{...ctx,minutes:481},{requireTransit:true,accessM:1,transferM:0});
 expect(result.found).toBe(true);expect(result.durationS).toBeGreaterThan(540);expect(result.steps.some(s=>s.instruction==='Attendi 9 min alla fermata')).toBe(true);
});
