import { LocalFrame } from '../geo/projection';
import { add, mul, sub, type V } from '../geo/polyline';
import type { LngLat, Network, Zone } from '../model/types';
import { isPedestrianRoad } from '../physical/section';
import { windowActive } from './restrictions';

export interface ZoneGate {
  readonly roadId: string;
  readonly roadName: string;
  /** Point on the road axis, just outside the boundary (where the gate camera and LED panel stand). */
  readonly at: LngLat;
  /** Direction faced by the panel: towards vehicles about to enter, degrees from north. */
  readonly bearingDeg: number;
  /** Whether traffic can actually enter here (false: exit-only one-way road). */
  readonly entry: boolean;
}

function inside(p: V, poly: readonly V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) r = !r;
  }
  return r;
}

function segX(a: V, b: V, c: V, d: V): number | null {
  const r = sub(b, a), s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * Entry points of a zone (varchi ZTL): every vehicular road whose axis crosses the boundary.
 * The gate stands `setbackM` outside the boundary, facing traffic about to enter.
 */
export function zoneGates(net: Network, frameOrigin: LngLat, zone: Zone, setbackM = 6): ZoneGate[] {
  const f = new LocalFrame(frameOrigin);
  const poly = zone.polygon.map((q) => f.toMetric(q) as V);
  const out: ZoneGate[] = [];
  for (const road of Object.values(net.roads)) {
    if (isPedestrianRoad(road) || road.tags?.roundabout) continue;
    const axis = road.axis.map((q) => f.toMetric(q) as V);
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i - 1]!, b = axis[i]!;
      for (let k = 0; k < poly.length; k++) {
        const t = segX(a, b, poly[k]!, poly[(k + 1) % poly.length]!);
        if (t === null) continue;
        const hit = add(a, mul(sub(b, a), t));
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const u: V = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        // Travelling a→b enters when a is outside.
        const enteringForward = !inside(a, poly);
        const dirIn: V = enteringForward ? u : mul(u, -1);
        const at = sub(hit, mul(dirIn, setbackM));
        const entry = road.oneway === 'no' || (road.oneway === 'forward') === enteringForward;
        // The panel faces drivers coming towards the zone: bearing opposite to the entering direction.
        const face = mul(dirIn, -1);
        out.push({ roadId: road.id, roadName: road.name, at: f.toLngLat(at), bearingDeg: (Math.atan2(face[0], face[1]) * 180) / Math.PI, entry });
      }
    }
  }
  return out;
}

/** Whether a zone is active at a given local time (day 0 = Monday). */
export function zoneActiveAt(zone: Zone, day: number, minutes: number): boolean {
  return windowActive(zone.schedule, day, minutes);
}

/** Day (0 = Monday) and minutes for a JS Date, local time. */
export function localDayMinutes(d: Date): { day: number; minutes: number } {
  return { day: (d.getDay() + 6) % 7, minutes: d.getHours() * 60 + d.getMinutes() };
}
