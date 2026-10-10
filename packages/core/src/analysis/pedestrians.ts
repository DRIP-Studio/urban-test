import { LocalFrame } from '../geo/projection';
import { add, leftNormal, lengthOf, mul, sampleAt, type V } from '../geo/polyline';
import type { LngLat, Network } from '../model/types';
import { layoutSection } from '../physical/section';
import { buildGraph, type RoutingContext } from './graph';

interface Path { id: string; roadId: string; axis: V[]; length: number; weight: number; planId?: string; nodeId?: string; crossing: boolean; people: Person[]; }
interface Person { id: number; s: number; speed: number; waiting: boolean; }
export interface PedestrianMetrics { active: number; completed: number; waiting: number; waitingDemand: number; paths: number; demandPerHour: number; }
export interface PedestrianSnapshot { /** lon, lat, heading, id, waiting */ data: Float32Array; metrics: PedestrianMetrics; }

/** Local walking trips on authored sidewalks, footpaths and signal crossings. No observed people are inferred. */
export class PedestrianSimulation {
  private readonly frame: LocalFrame;
  private readonly paths: Path[] = [];
  private crossings = new Map<string, Path[]>();
  private pending = 0;
  private completed = 0;
  private id = 0;
  private totalWeight = 0;
  private minute = -1;
  private allowed = new Set<string>();
  constructor(private readonly net: Network, origin: LngLat, readonly demandPerHour: number, private readonly random: () => number) {
    if (!Number.isFinite(demandPerHour) || demandPerHour < 0 || demandPerHour > 100000) throw Error('Domanda pedonale non valida');
    this.frame = new LocalFrame(origin);
    if (!demandPerHour) return;
    const stops = (net.transit ?? []).flatMap(line => line.stops);
    const append = (path: Omit<Path, 'people'>) => { if (path.length >= 1) { const entry = { ...path, people: [] }; this.paths.push(entry); this.totalWeight += path.weight; if (path.crossing) { const key = `${path.roadId}|${path.nodeId}`, list = this.crossings.get(key) ?? []; list.push(entry); this.crossings.set(key, list); } } };
    for (const road of Object.values(net.roads)) {
      const axis = road.axis.map(at => this.frame.toMetric(at) as V), length = lengthOf(axis);
      if (length < 2) continue;
      const section = layoutSection(road);
      const footpath = ['footway', 'pedestrian', 'path', 'steps', 'living_street'].includes(road.roadClass);
      const sidewalks = section.elements.filter(element => element.el.kind === 'sidewalk');
      const offsets = sidewalks.length ? sidewalks.map(element => (element.left + element.right) / 2) : footpath ? [0] : [];
      for (const [index, offset] of offsets.entries()) {
        const count = Math.max(1, Math.ceil(length / 8));
        const points = Array.from({ length: count + 1 }, (_, i) => { const sample = sampleAt(axis, length * i / count); return add(sample.p, mul(leftNormal(sample.t), offset)); });
        const nearStop = stops.some(stop => { const at = this.frame.toMetric(stop.at) as V; return Math.hypot(at[0] - points[0]![0], at[1] - points[0]![1]) < 80; });
        append({ id: `walk:${road.id}:${index}`, roadId: road.id, axis: points, length: lengthOf(points), weight: nearStop ? 5 : footpath ? 2 : 1, crossing: false });
      }
    }
    for (const plan of Object.values(net.signalPlans)) {
      for (const roadId of new Set(plan.phases.flatMap(phase => phase.pedestrianRoadIds))) {
        const road = net.roads[roadId]; if (!road) continue;
        const axis = road.axis.map(at => this.frame.toMetric(at) as V), length = lengthOf(axis), section = layoutSection(road);
        const sample = sampleAt(axis, road.from === plan.nodeId ? Math.min(6, length / 3) : Math.max(0, length - 6));
        const normal = leftNormal(sample.t), points = [add(sample.p, mul(normal, section.cwRight - 1)), add(sample.p, mul(normal, section.cwLeft + 1))];
        append({ id: `cross:${plan.id}:${roadId}`, roadId, axis: points, length: lengthOf(points), weight: 4, planId: plan.id, nodeId: plan.nodeId, crossing: true });
      }
    }
  }
  step(dt: number, context: Omit<RoutingContext, 'mode'>, green: (planId: string, roadId: string) => boolean): void {
    if (!this.demandPerHour) return;
    const minute = context.day * 1440 + Math.floor(context.minutes);
    if (minute !== this.minute) { this.minute = minute; this.allowed = new Set(buildGraph(this.net, this.frame, { ...context, mode: 'walk' }).edges.map(edge => edge.roadId)); }
    this.pending += this.demandPerHour * dt / 3600;
    // Bound insertion work, never discard demand when a path entrance is occupied.
    const attempts = Math.min(100, Math.floor(this.pending));
    for (let attempt = 0; attempt < attempts; attempt++) {
      let weight = this.random() * this.totalWeight;
      const path = this.paths.find(candidate => (weight -= candidate.weight) <= 0);
      if (!path || !this.allowed.has(path.roadId) || path.people.some(person => person.s < 1.3)) continue;
      path.people.push({ id: ++this.id, s: 0, speed: 1.05 + this.random() * .5, waiting: false });
      this.pending--;
    }
    for (const path of this.paths) {
      let leader = Infinity;
      for (const person of path.people) {
        const stop = !this.allowed.has(path.roadId) || path.crossing && person.s < .05 && !green(path.planId!, path.roadId);
        const next = stop ? person.s : Math.max(person.s, Math.min(leader - 1.2, person.s + person.speed * dt));
        person.waiting = next === person.s; person.s = next; leader = person.s;
      }
      const remaining = path.people.filter(person => person.s < path.length);
      this.completed += path.people.length - remaining.length; path.people = remaining;
    }
  }
  crossingOccupied(roadId: string, nodeId: string): boolean {
    return (this.crossings.get(`${roadId}|${nodeId}`) ?? []).some(path => path.people.some(person => person.s > .05 && person.s < path.length - .5));
  }
  snapshot(budget: number, bounds?: readonly number[]): PedestrianSnapshot {
    const data: number[] = []; let active = 0, waiting = 0;
    for (const path of this.paths) for (const person of path.people) {
      active++; if (person.waiting) waiting++;
      if (data.length / 5 >= budget) continue;
      const sample = sampleAt(path.axis, person.s), at = this.frame.toLngLat(sample.p);
      if (bounds && (at[0] < bounds[0]! || at[0] > bounds[2]! || at[1] < bounds[1]! || at[1] > bounds[3]!)) continue;
      data.push(at[0], at[1], Math.atan2(sample.t[0], sample.t[1]) * 180 / Math.PI, person.id, person.waiting ? 1 : 0);
    }
    return { data: new Float32Array(data), metrics: { active, completed: this.completed, waiting, waitingDemand: Math.floor(this.pending), paths: this.paths.length, demandPerHour: this.demandPerHour } };
  }
}
