import { add, leftNormal, lengthOf, mul, offset, sampleAt, slice, sub, unit, type V } from '../geo/polyline';
import type { Road, TurnKind } from '../model/types';

export interface DashSpec {
  readonly widthM: number;
  readonly dashM: number;
  readonly gapM: number;
}

/** Codice della Strada (art. 138–141 Reg.) dimensions used for markings. */
export const MARKING = {
  urbanDashed: { widthM: 0.12, dashM: 3.0, gapM: 4.5 } satisfies DashSpec,
  ruralDashed: { widthM: 0.15, dashM: 4.5, gapM: 7.5 } satisfies DashSpec,
  edgeWidthM: 0.12,
  stopWidthM: 0.5,
  giveWayDash: { widthM: 0.5, dashM: 0.5, gapM: 0.5 } satisfies DashSpec,
  zebraStripeM: 0.5,
  zebraGapM: 0.5,
  zebraDepthM: 4.0,
  arrowLengthM: 4.5,
} as const;

const RURAL = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link']);
const EDGE_LINES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link']);

export const dashFor = (road: Road): DashSpec => (RURAL.has(road.roadClass) || road.speedKmh > 70 ? MARKING.ruralDashed : MARKING.urbanDashed);
export const hasEdgeLines = (road: Road): boolean => EDGE_LINES.has(road.roadClass);

/** Rectangle ring around the polyline piece `pts` with total width w. */
function strip(pts: readonly V[], w: number): V[] {
  return [...offset(pts, w / 2), ...offset(pts, -w / 2).reverse()];
}

/** Dashed line as metric rectangles, phase anchored at the start of the line. */
export function dashes(line: readonly V[], spec: DashSpec): V[][] {
  const L = lengthOf(line);
  const out: V[][] = [];
  const period = spec.dashM + spec.gapM;
  // Centre the pattern so both ends get the same partial gap.
  const count = Math.floor((L + spec.gapM) / period);
  if (count <= 0) return out;
  const start = (L - (count * period - spec.gapM)) / 2;
  for (let i = 0; i < count; i++) {
    const d0 = start + i * period;
    const piece = slice(line, d0, d0 + spec.dashM);
    if (piece.length >= 2) out.push(strip(piece, spec.widthM));
  }
  return out;
}

export function solid(line: readonly V[], widthM: number): V[] {
  return strip(line, widthM);
}

/**
 * Italian lane arrow (fig. II.437/438 family), drawn in metres.
 * `at` is the arrow tail; `dir` the travel direction.
 */
export function arrowRing(at: V, dir: V, turn: TurnKind = 'through', length: number = MARKING.arrowLengthM): V[] {
  const u = unit(dir), n = leftNormal(u);
  const P = (along: number, side: number): V => add(add(at, mul(u, along)), mul(n, side));
  const shaft = 0.15, headHalf = 0.5, headLen = 1.4;
  if (turn === 'through') {
    const s = length - headLen;
    return [P(0, -shaft), P(s, -shaft), P(s, -headHalf), P(length, 0), P(s, headHalf), P(s, shaft), P(0, shaft)];
  }
  // Turn arrow: straight shaft, then a 45° bent head towards the turn side.
  const side = turn === 'left' ? 1 : -1;
  const s = length * 0.55;
  const bend = unit(add(u, mul(n, side)));
  const bn = leftNormal(bend);
  const Q = (along: number, w: number): V => add(add(P(s, 0), mul(bend, along)), mul(bn, w));
  const hl = length - s - 0.2;
  const hs = hl - headLen * 0.8;
  const ring: V[] = [P(0, -shaft), P(s, -shaft), Q(hs, -shaft), Q(hs, -headHalf), Q(hl, 0), Q(hs, headHalf), Q(hs, shaft), P(s, shaft), P(0, shaft)];
  return ring;
}

/** Along-road interval [from, to] (m) where no other marking may be painted, e.g. a zebra crossing. */
export type KeepOut = readonly [number, number];

/** Keep-out of a zebra centred at `along`: its depth plus 1 m on each side. */
export const zebraKeepOut = (along: number, depthM: number = MARKING.zebraDepthM): KeepOut => [along - depthM / 2 - 1, along + depthM / 2 + 1];

/**
 * Station for a marking of length `len` whose tail is at `s` and which extends towards `dir` (+1 along the
 * axis, -1 against it): moved upstream (against `dir`) until it clears every keep-out interval.
 * Null when it would leave [lo, hi]: better no arrow than an arrow painted inside a crossing.
 */
export function clearStation(s: number, len: number, dir: 1 | -1, keepOut: readonly KeepOut[], lo: number, hi: number): number | null {
  let x = s;
  for (let guard = 0; guard <= keepOut.length; guard++) {
    const a = Math.min(x, x + dir * len), b = Math.max(x, x + dir * len);
    const hit = keepOut.find(([k0, k1]) => a < k1 && b > k0);
    if (!hit) return a >= lo && b <= hi ? x : null;
    x = dir > 0 ? hit[0] - len : hit[1] + len;
  }
  return null;
}

/** Positions (distance along the lane line) for repeated direction arrows. */
export function arrowStations(laneLength: number, spacing = 45, margin = 8): number[] {
  const usable = laneLength - 2 * margin - MARKING.arrowLengthM;
  if (usable < 0) return laneLength >= MARKING.arrowLengthM + 2 ? [(laneLength - MARKING.arrowLengthM) / 2] : [];
  const n = Math.max(1, Math.floor(usable / spacing) + 1);
  const step = n > 1 ? usable / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => margin + (n > 1 ? i * step : usable / 2));
}

/** Zebra crossing stripes across a carriageway, centred at `along` on the axis. */
export function zebra(axis: readonly V[], along: number, left: number, right: number, depthM: number = MARKING.zebraDepthM): V[][] {
  const { p, t } = sampleAt(axis, along);
  const n = leftNormal(t);
  const half = depthM / 2;
  const out: V[][] = [];
  const width = left - right;
  const period = MARKING.zebraStripeM + MARKING.zebraGapM;
  const count = Math.max(1, Math.floor((width + MARKING.zebraGapM) / period));
  const start = right + (width - (count * period - MARKING.zebraGapM)) / 2;
  for (let i = 0; i < count; i++) {
    const o0 = start + i * period, o1 = o0 + MARKING.zebraStripeM;
    const c0 = add(p, mul(n, o0)), c1 = add(p, mul(n, o1));
    out.push([sub(c0, mul(t, half)), add(c0, mul(t, half)), add(c1, mul(t, half)), sub(c1, mul(t, half))]);
  }
  return out;
}
