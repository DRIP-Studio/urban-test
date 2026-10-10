import type { Road, RoadRestrictions, TimeWindow, TravelMode } from '../model/types';

/** Vehicle used by routing when the mode is 'truck' and no vehicle is given: a 3-axle rigid truck. */
export const DEFAULT_TRUCK = { weightT: 18, heightM: 3.8, widthM: 2.55, lengthM: 10, axleLoadT: 8 } as const;

const DAYS: Record<string, number> = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };

/** Parses the common subset of OSM opening_hours used in conditional restrictions: "Mo-Fr 07:00-20:00; Sa 07:00-13:00". */
export function parseOpeningHours(text: string): TimeWindow[] {
  const out: TimeWindow[] = [];
  for (const part of text.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    if (!m) continue;
    let days: number[] = [0, 1, 2, 3, 4, 5, 6];
    if (m[1]) {
      days = [];
      for (const r of m[1].split(',').map((x) => x.trim())) {
        const [a, b] = r.split('-');
        const s = DAYS[a!]!, e = b ? DAYS[b]! : s;
        for (let d = s; ; d = (d + 1) % 7) { days.push(d); if (d === e) break; }
      }
    }
    out.push({ days, from: m[2]!.padStart(5, '0'), to: m[3]!.padStart(5, '0') });
  }
  return out;
}

const num = (v: string | undefined) => {
  const x = parseFloat((v ?? '').replace(',', '.'));
  return Number.isFinite(x) && x > 0 ? x : undefined;
};

/** Restrictions read from OSM tags (hgv, maxweight, maxheight, maxwidth, maxlength, maxaxleload, hazmat, motor_vehicle and their :conditional). */
export function osmRestrictions(tags: Readonly<Record<string, string>> | undefined): RoadRestrictions | undefined {
  if (!tags) return undefined;
  const r: { -readonly [K in keyof RoadRestrictions]: RoadRestrictions[K] } = {};
  const hgv = tags.hgv;
  if (hgv === 'no' || hgv === 'destination' || hgv === 'delivery') r.hgv = hgv;
  const cond = tags['hgv:conditional'] ?? tags['motor_vehicle:conditional'];
  if (cond) {
    const m = cond.match(/^(no|destination|delivery)\s*@\s*\(?([^)]*)\)?/);
    if (m) {
      const windows = parseOpeningHours(m[2]!);
      if (windows.length) {
        if (tags['hgv:conditional']) r.hgv = m[1] as RoadRestrictions['hgv'];
        else r.motorVehicle = m[1] === 'no' ? 'no' : 'destination';
        r.schedule = windows;
      }
    }
  }
  // access=no/private on service roads (parking aisles, driveways) means "private", not a public ban.
  const privateAccess = tags.access === 'no' || tags.access === 'private';
  const mv = tags.motor_vehicle ?? (privateAccess ? (tags.highway === 'service' ? 'destination' : tags.access === 'no' ? 'no' : 'destination') : undefined);
  if (mv === 'no' || mv === 'destination' || mv === 'private') r.motorVehicle = mv === 'no' ? 'no' : 'destination';
  r.maxWeightT = num(tags.maxweight);
  r.maxAxleLoadT = num(tags.maxaxleload);
  r.maxHeightM = num(tags.maxheight);
  r.maxWidthM = num(tags.maxwidth);
  r.maxLengthM = num(tags.maxlength);
  if (tags.hazmat === 'no') r.hazmat = true;
  const clean = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as RoadRestrictions;
  return Object.keys(clean).length ? clean : undefined;
}

/** Authored restrictions win over OSM; returns undefined when the road is unrestricted. */
export function restrictionsOf(road: Road): { restrictions: RoadRestrictions; source: 'project' | 'osm' } | undefined {
  if (road.restrictions) return Object.keys(road.restrictions).length ? { restrictions: road.restrictions, source: 'project' } : undefined;
  const o = osmRestrictions(road.tags);
  return o ? { restrictions: o, source: 'osm' } : undefined;
}

/** Whether a weekly window list is active at (day 0 = Monday, minutes since midnight). */
export function windowActive(windows: readonly TimeWindow[] | undefined, day: number, minutes: number): boolean {
  if (!windows || !windows.length) return true;
  return windows.some((s) => {
    const [fh, fm] = s.from.split(':').map(Number), [th, tm] = s.to.split(':').map(Number);
    const a = (fh ?? 0) * 60 + (fm ?? 0), b = (th ?? 0) * 60 + (tm ?? 0);
    if (a === b) return s.days.includes(day);
    return a < b ? s.days.includes(day) && minutes >= a && minutes < b :
      (s.days.includes(day) && minutes >= a) || (s.days.includes((day + 6) % 7) && minutes < b);
  });
}

export interface VehicleSpec { readonly weightT?: number; readonly heightM?: number; readonly widthM?: number; readonly lengthM?: number; readonly axleLoadT?: number; readonly hazmat?: boolean }

/**
 * Whether a vehicle may use a road now. `destination` bans are passable with a cost penalty
 * (the road can be used to reach a destination on it, not as a through route).
 */
export function checkRestrictions(road: Road, mode: TravelMode, vehicle: VehicleSpec | undefined, day: number, minutes: number): { blocked: string | null; penalty: number } {
  const r = restrictionsOf(road)?.restrictions;
  if (!r) return { blocked: null, penalty: 1 };
  const motor = mode === 'motorcycle' || mode === 'car' || mode === 'truck' || mode === 'bus';
  const v = mode === 'truck' ? { ...DEFAULT_TRUCK, ...vehicle } : vehicle;
  const timed = windowActive(r.schedule, day, minutes);
  let penalty = 1;
  if (motor && r.motorVehicle && timed) {
    if (r.motorVehicle === 'no' && mode !== 'bus') return { blocked: 'Divieto di transito', penalty: 1 };
    penalty = Math.max(penalty, 4);
  }
  const heavy = mode === 'truck' || (v?.weightT !== undefined && v.weightT > 3.5);
  if (heavy && r.hgv && timed) {
    if (r.hgv === 'no') return { blocked: `Divieto di transito ai mezzi pesanti${r.schedule ? ' (fascia oraria attiva)' : ''}`, penalty: 1 };
    penalty = Math.max(penalty, 4);
  }
  if (v) {
    if (r.maxWeightT && v.weightT && v.weightT > r.maxWeightT) return { blocked: `Limite di massa ${r.maxWeightT} t`, penalty: 1 };
    if (r.maxAxleLoadT && v.axleLoadT && v.axleLoadT > r.maxAxleLoadT) return { blocked: `Limite per asse ${r.maxAxleLoadT} t`, penalty: 1 };
    if (r.maxHeightM && v.heightM && v.heightM > r.maxHeightM) return { blocked: `Limite di altezza ${r.maxHeightM} m`, penalty: 1 };
    if (r.maxWidthM && v.widthM && v.widthM > r.maxWidthM) return { blocked: `Limite di larghezza ${r.maxWidthM} m`, penalty: 1 };
    if (r.maxLengthM && v.lengthM && v.lengthM > r.maxLengthM) return { blocked: `Limite di lunghezza ${r.maxLengthM} m`, penalty: 1 };
    if (r.hazmat && v.hazmat) return { blocked: 'Divieto merci pericolose', penalty: 1 };
  }
  return { blocked: null, penalty };
}

/** Catalogue sign (CdS figure) that signals a restriction, for automatic sign proposals. */
export function restrictionSign(r: RoadRestrictions): string | null {
  if (r.motorVehicle === 'no') return 'it.sign.divieto_di_transito';
  if (r.hgv === 'no') return 'it.sign.divieto_di_transito_ai_veicoli_da_trasporto';
  if (r.maxWeightT) return 'it.sign.divieto_di_transito_ai_veicoli_da_trasp6_5t';
  if (r.maxHeightM) return 'it.sign.divieto_di_transito_altezza_3,50m';
  if (r.maxWidthM) return 'it.sign.divieto_di_transito_larghezza_2,30m';
  if (r.hazmat) return 'it.sign.divieto_di_transito_a_trasporti_pericolosi';
  return null;
}
