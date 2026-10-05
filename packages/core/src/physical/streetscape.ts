import { add, dot, leftNormal, lengthOf, mul, offset, project, sampleAt, sub, unit, type V } from '../geo/polyline';
import type { LngLat, Marking, MarkingColor, Network, Road, RoadFeature, TurnKind } from '../model/types';
import { arrowRing, clearStation, dashes, MARKING, solid, zebra, type KeepOut } from './markings';
import { layoutSection } from './section';
import type { MetricCache } from './topology';
import type { PhysPolygon, PhysState } from './build';

/**
 * Streetscape detail of the physical model:
 *  - traffic calming and raised elements (art. 179 Reg. CdS): plateau + ramps as raised surfaces, with
 *    their regulatory markings (yellow/black stripes on humps, zebra and "denti di squalo" on raised
 *    crossings and platforms, transverse bands for rumble strips);
 *  - custom horizontal markings drawn by the designer (artt. 137–155 Reg.): lines, zig-zag, text, symbols,
 *    hatching, chevrons, box junctions, parking bays;
 *  - automatic markings: parking bays on parking strips, approach arrows and solid lines on lanes before
 *    junctions (preselezione), bus-stop zig-zag + «BUS», «STOP» before stop lines.
 */

export const MARKING_MATERIAL: Record<MarkingColor | 'black', string> = {
  white: 'road_marking_white', yellow: 'road_marking_yellow', blue: 'road_marking_blue', red: 'road_marking_red', pink: 'road_marking_pink', green: 'asphalt_green', black: 'road_marking_black',
};

type Out = { surfaces: PhysPolygon[]; markings: PhysPolygon[] };
type ToLL = (r: readonly V[]) => LngLat[];

const quad = (c: V, u: V, n: V, a0: number, a1: number, o0: number, o1: number): V[] =>
  [add(add(c, mul(u, a0)), mul(n, o0)), add(add(c, mul(u, a1)), mul(n, o0)), add(add(c, mul(u, a1)), mul(n, o1)), add(add(c, mul(u, a0)), mul(n, o1))];

// ------------------------------------------------------------------ stroke font for road lettering

/** Letters on a 4 × 6 grid (x across, y along travel), as polylines. Road letters are elongated along travel. */
const FONT: Record<string, number[][][]> = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]], B: [[[0, 0], [0, 6], [3, 6], [4, 5], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 6], [0, 6], [0, 0], [4, 0]]], D: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 1], [3, 0], [0, 0]]], E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]], G: [[[4, 6], [0, 6], [0, 0], [4, 0], [4, 3], [2, 3]]], H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[2, 0], [2, 6]], [[1, 6], [3, 6]], [[1, 0], [3, 0]]], K: [[[0, 0], [0, 6]], [[4, 6], [0, 3], [4, 0]]], L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]], N: [[[0, 0], [0, 6], [4, 0], [4, 6]]], O: [[[0, 0], [0, 6], [4, 6], [4, 0], [0, 0]]],
  P: [[[0, 0], [0, 6], [4, 6], [4, 3], [0, 3]]], R: [[[0, 0], [0, 6], [4, 6], [4, 3], [0, 3], [4, 0]]], S: [[[4, 6], [0, 6], [0, 3], [4, 3], [4, 0], [0, 0]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]], U: [[[0, 6], [0, 0], [4, 0], [4, 6]]], V: [[[0, 6], [2, 0], [4, 6]]], X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]], Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]], W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
  '0': [[[0, 0], [0, 6], [4, 6], [4, 0], [0, 0]]], '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]], '2': [[[0, 6], [4, 6], [4, 3], [0, 3], [0, 0], [4, 0]]],
  '3': [[[0, 6], [4, 6], [4, 0], [0, 0]], [[1, 3], [4, 3]]], '4': [[[0, 6], [0, 3], [4, 3]], [[3, 6], [3, 0]]], '5': [[[4, 6], [0, 6], [0, 3], [4, 3], [4, 0], [0, 0]]],
  '6': [[[4, 6], [0, 6], [0, 0], [4, 0], [4, 3], [0, 3]]], '7': [[[0, 6], [4, 6], [1, 0]]], '8': [[[0, 0], [0, 6], [4, 6], [4, 0], [0, 0]], [[0, 3], [4, 3]]],
  '9': [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 3], [4, 3]]],
};

/**
 * Text across a lane, read by a driver travelling along `u` (letters elongated: `heightM` along travel,
 * fig. II.441 Reg. CdS: 1,6 m in urban areas, 4 m outside), centred at `c`, total width `widthM`.
 */
export function roadText(text: string, c: V, u: V, widthM: number, heightM = 1.6, strokeM = 0.12): V[][] {
  const chars = [...text.toUpperCase()].filter((ch) => FONT[ch] || ch === ' ');
  if (!chars.length) return [];
  const n = leftNormal(u); // left of travel
  const cw = Math.min(widthM / chars.length, heightM * 0.55), gap = cw * 0.22, w = cw - gap;
  const out: V[][] = [];
  chars.forEach((ch, i) => {
    const x0 = -widthM / 2 + (widthM - chars.length * cw) / 2 + i * cw + gap / 2;
    for (const stroke of FONT[ch] ?? []) {
      // Grid x → across (driver's left to right = −n), y → along travel.
      const pts = stroke.map(([gx, gy]) => add(add(c, mul(n, -(x0 + (gx! / 4) * w))), mul(u, -heightM / 2 + (gy! / 6) * heightM)));
      for (let k = 1; k < pts.length; k++) out.push(solid([pts[k - 1]!, pts[k]!], strokeM));
    }
  });
  return out;
}

/** Pictograms (fig. II.442–445 family, simplified line art), about `size` metres, facing travel `u`. */
export function roadSymbol(symbol: string, c: V, u: V, size = 1.6): V[][] {
  const n = leftNormal(u);
  const P = (x: number, y: number): V => add(add(c, mul(n, -x * size)), mul(u, y * size));
  const ring = (cx: number, cy: number, r: number, k = 14) => Array.from({ length: k + 1 }, (_, i) => P(cx + r * Math.cos((i / k) * Math.PI * 2), cy + r * Math.sin((i / k) * Math.PI * 2)));
  const L = (pts: V[], w = 0.08) => pts.slice(1).map((p, i) => solid([pts[i]!, p], w));
  switch (symbol) {
    case 'bike': return [...L(ring(-0.3, -0.25, 0.2)), ...L(ring(0.3, -0.25, 0.2)), ...L([P(-0.3, -0.25), P(-0.05, 0.1), P(0.3, -0.25), P(0.15, 0.15), P(-0.05, 0.1)]), ...L([P(0.15, 0.15), P(0.25, 0.25)]), ...L([P(-0.1, 0.18), P(0.02, 0.18)])];
    case 'wheelchair': return [...L(ring(0, -0.15, 0.25)), ...L([P(-0.05, 0.4), P(-0.05, 0.05), P(0.2, 0.05), P(0.3, -0.35)]), ...L(ring(-0.05, 0.5, 0.06, 8))];
    case 'pedestrian': return [...L(ring(0, 0.45, 0.07, 8)), ...L([P(0, 0.35), P(0, 0)]), ...L([P(0, 0), P(-0.15, -0.4)]), ...L([P(0, 0), P(0.15, -0.4)]), ...L([P(-0.2, 0.2), P(0.2, 0.2)])];
    case 'bus': return [...L([P(-0.3, -0.5), P(0.3, -0.5), P(0.3, 0.5), P(-0.3, 0.5), P(-0.3, -0.5)]), ...L([P(-0.3, 0.2), P(0.3, 0.2)])];
    case 'school': return [...L([P(-0.35, -0.4), P(0, 0.45), P(0.35, -0.4), P(-0.35, -0.4)])];
    default: return [];
  }
}

/** Stripes inside a polygon at `angleDeg` to `u`, every `spacing` m (zebratura), with the outline. */
function hatch(poly: readonly V[], u: V, spacing = 1.0, angleDeg = 45, stripe = 0.3): V[][] {
  const a = (angleDeg * Math.PI) / 180;
  const d = add(mul(u, Math.cos(a)), mul(leftNormal(u), Math.sin(a)));
  const nn = leftNormal(d);
  const ps = poly.map((p) => dot(p, nn));
  const out: V[][] = [];
  for (let s = Math.min(...ps) + spacing / 2; s < Math.max(...ps); s += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      const sp = dot(p, nn) - s, sq = dot(q, nn) - s;
      if ((sp > 0) !== (sq > 0)) { const t = sp / (sp - sq); xs.push(dot(add(p, mul(sub(q, p), t)), d)); }
    }
    xs.sort((x, y) => x - y);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a0 = add(mul(nn, s), mul(d, xs[k]!)), a1 = add(mul(nn, s), mul(d, xs[k + 1]!));
      if (Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) > 0.2) out.push(solid([a0, a1], stripe));
    }
  }
  for (let i = 0; i < poly.length; i++) out.push(solid([poly[i]!, poly[(i + 1) % poly.length]!], 0.12));
  return out;
}

function zigzag(line: readonly V[], amp = 0.5, step = 1.0, w = 0.12): V[][] {
  const L = lengthOf(line);
  const pts: V[] = [];
  for (let s = 0, k = 0; s <= L; s += step, k++) { const { p, t } = sampleAt(line, s); pts.push(add(p, mul(leftNormal(t), k % 2 ? amp : -amp))); }
  return pts.slice(1).map((p, i) => solid([pts[i]!, p], w));
}

// ------------------------------------------------------------------ traffic calming

function addFeatures(net: Network, metric: MetricCache, toLL: ToLL, out: Out): void {
  for (const f of Object.values(net.features ?? {})) {
    if (f.state === 'removed' || f.kind === 'raised_junction') continue;
    const road = f.roadId ? net.roads[f.roadId] : undefined;
    if (!road) continue;
    const axis = metric.axis(road);
    const { p, t } = sampleAt(axis, Math.min(lengthOf(axis), f.station ?? 0));
    const n = leftNormal(t);
    const lay = layoutSection(road);
    const L = lay.cwLeft, R = lay.cwRight;
    const state: PhysState = f.state === 'project' ? 'project' : 'existing';
    const half = f.lengthM / 2;
    let k = 0;
    const surf = (ring: V[], h: number, material: string) => out.surfaces.push({ id: `f:${f.id}:${k++}`, kind: 'raised', ring: toLL(ring), roadId: road.id, state, material, z: 8, heightM: h });
    const mark = (ring: V[], color: keyof typeof MARKING_MATERIAL) => out.markings.push({ id: `fm:${f.id}:${k++}`, kind: 'calming', ring: toLL(ring), roadId: road.id, state, material: MARKING_MATERIAL[color], z: 11, heightM: f.heightM });
    if (f.kind === 'rumble_strips') {
      // Transverse bands (bande ottiche/rumorose): 5 bands 0,30 m, every 1,2 m.
      for (let i = -2; i <= 2; i++) mark(quad(p, t, n, i * 1.2 - 0.15, i * 1.2 + 0.15, R + 0.2, L - 0.2), 'white');
      continue;
    }
    if (f.kind === 'speed_cushion') {
      // One cushion per lane, 1,8 m wide, leaving the wheel track of buses free.
      for (const pe of lay.elements.filter((e) => e.el.kind === 'lane')) {
        const c = (pe.left + pe.right) / 2;
        surf(quad(p, t, n, -half - f.rampM, half + f.rampM, c - 0.9, c + 0.9), f.heightM, 'asphalt_red');
        mark(quad(p, t, n, -half, half, c - 0.15, c + 0.15), 'white');
      }
      continue;
    }
    // Plateau and ramps across the carriageway.
    surf(quad(p, t, n, -half, half, R, L), f.heightM, f.kind === 'speed_hump' ? 'asphalt' : f.kind === 'raised_crossing' ? 'asphalt_red' : 'pavers_warm');
    surf(quad(p, t, n, -half - f.rampM, -half, R, L), f.heightM / 2, 'asphalt');
    surf(quad(p, t, n, half, half + f.rampM, R, L), f.heightM / 2, 'asphalt');
    if (f.kind === 'speed_hump') {
      // Yellow and black stripes parallel to travel (art. 179 c. 5 Reg.).
      const stripes = Math.max(4, Math.floor((L - R) / 0.5));
      for (let i = 0; i < stripes; i++) {
        const o0 = R + ((L - R) * i) / stripes, o1 = R + ((L - R) * (i + 1)) / stripes;
        mark(quad(p, t, n, -half - f.rampM, half + f.rampM, o0, o1), i % 2 ? 'black' : 'yellow');
      }
    } else {
      if (f.kind === 'raised_crossing') zebra([sub(p, t), add(p, t)], 1, L, R, Math.min(f.lengthM, 4)).forEach((r) => mark(r, 'white'));
      // "Denti di squalo" on both ramps, pointing up the ramp.
      for (const side of [-1, 1]) {
        const base = side * (half + f.rampM), tip = side * half;
        for (let o = R + 0.3; o + 0.5 <= L - 0.2; o += 0.9) mark([add(add(p, mul(t, base)), mul(n, o)), add(add(p, mul(t, base)), mul(n, o + 0.5)), add(add(p, mul(t, tip)), mul(n, o + 0.25))], 'white');
      }
    }
  }
}

// ------------------------------------------------------------------ custom markings

function addCustomMarkings(net: Network, metric: MetricCache, toLL: ToLL, out: Out): void {
  const frame = metric.frame;
  for (const m of Object.values(net.markings ?? {})) {
    if (m.state === 'removed') continue;
    const pts = m.geometry.map((q) => frame.toMetric(q) as V);
    const state: PhysState = m.state === 'project' ? 'project' : 'existing';
    const mat = MARKING_MATERIAL[m.color] ?? 'road_marking_white';
    const w = m.widthM ?? 0.12;
    let k = 0;
    const push = (ring: V[], material = mat) => out.markings.push({ id: `cm:${m.id}:${k++}`, kind: 'custom', ring: toLL(ring), state, material, z: 12, heightM: 0 });
    const dir = pts.length >= 2 ? unit(sub(pts[1]!, pts[0]!)) : ([0, 1] as V);
    switch (m.kind) {
      case 'line_solid': case 'line_yellow': case 'stop_line': push(solid(pts, m.kind === 'stop_line' ? MARKING.stopWidthM : w), m.kind === 'line_yellow' ? MARKING_MATERIAL.yellow : mat); break;
      case 'line_dashed': for (const r of dashes(pts, { widthM: w, dashM: 3, gapM: 4.5 })) push(r); break;
      case 'give_way_line': for (const r of dashes(pts, MARKING.giveWayDash)) push(r); break;
      case 'line_double': push(solid(offset(pts, 0.12), w)); push(solid(offset(pts, -0.12), w)); break;
      case 'line_mixed': push(solid(offset(pts, 0.12), w)); for (const r of dashes(offset(pts, -0.12), { widthM: w, dashM: 3, gapM: 4.5 })) push(r); break;
      case 'zigzag': for (const r of zigzag(pts)) push(r); break;
      case 'give_way_triangle': {
        // Fig. II.433 (triangolo): base 1,0 m, height 1,5 m (urban reference), apex towards the driver.
        const c = pts[0]!, n = leftNormal(dir);
        push([add(c, mul(n, -0.5)), add(c, mul(n, 0.5)), add(c, mul(dir, -1.5))]);
        break;
      }
      case 'arrow': {
        const turns = (m.symbol ?? 'through').split('+') as TurnKind[];
        for (const tk of turns) push(arrowRing(pts[0]!, dir, tk));
        break;
      }
      case 'text': for (const r of roadText(m.text ?? '', pts[0]!, dir, m.widthM ?? 2.8)) push(r); break;
      case 'symbol': for (const r of roadSymbol(m.symbol ?? 'bike', pts[0]!, dir)) push(r); break;
      case 'hatch': for (const r of hatch(pts, dir, 1.0, 45, 0.3)) push(r); break;
      case 'chevrons': {
        for (const r of hatch(pts, dir, 1.6, 45, 0.4)) push(r);
        for (const r of hatch(pts, dir, 1.6, -45, 0.4)) push(r);
        break;
      }
      case 'box_junction': for (const r of [...hatch(pts, dir, 1.5, 45, 0.15), ...hatch(pts, dir, 1.5, -45, 0.15)]) push(r, MARKING_MATERIAL.yellow); break;
      case 'parking_bays': {
        const purpose = m.bays?.purpose ?? 'free';
        const pm = PURPOSE[purpose] ?? {};
        const color = pm.color ?? m.color;
        const layout = m.bays?.layout ?? 'parallel', side = m.bays?.side ?? 'right';
        const lengthM = m.bays?.lengthM ?? (purpose === 'motorcycle' ? 2 : 5), widthM = m.bays?.widthM ?? (purpose === 'disabled' ? 3.2 : purpose === 'motorcycle' ? 1 : 2);
        for (const r of bays(pts, layout, lengthM, widthM, side)) push(r, MARKING_MATERIAL[color]);
        // Symbol or text in every bay (per-bay label: wheelchair, TAXI, CARICO SCARICO…).
        const pitch = layout === 'parallel' ? lengthM : layout === 'perpendicular' ? widthM : widthM / Math.SQRT1_2;
        const depth = layout === 'parallel' ? widthM : lengthM;
        const Lb = lengthOf(pts), count = Math.floor(Lb / pitch), start = (Lb - count * pitch) / 2, s = side === 'left' ? 1 : -1;
        if (pm.symbol || pm.text) for (let i = 0; i < count; i++) {
          const { p, t } = sampleAt(pts, start + (i + 0.5) * pitch);
          const c = add(p, mul(leftNormal(t), (s * depth) / 2));
          const u = layout === 'parallel' ? t : mul(leftNormal(t), -s);
          const rings = pm.symbol ? roadSymbol(pm.symbol, c, u, Math.min(1.4, depth * 0.6)) : roadText(pm.text!, c, u, Math.min(depth, pitch) * 0.8, layout === 'parallel' ? 0.9 : 1.2, 0.1);
          for (const r of rings) push(r, MARKING_MATERIAL[color]);
        }
        break;
      }
      case 'zebra': {
        // Fig. II.434: stripes 50 cm every 1 m across the carriageway, depth ≥ 2,5 m (4 m on main roads).
        const a = pts[0]!, b = pts[pts.length - 1]!, across = unit(sub(b, a)), along = leftNormal(across), depth = m.widthM && m.widthM > 1 ? m.widthM : 4;
        const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let x = 0.25; x + 0.5 <= L0; x += 1.0) push(quad(add(a, mul(across, x + 0.25)), across, along, -0.25, 0.25, -depth / 2, depth / 2).map((q) => q) as V[]);
        break;
      }
      case 'bike_crossing': {
        // Art. 146 c. 3: two lines of 50 × 50 cm squares, 50 cm apart, 2 m between the lines (one-way 1 m).
        const a = pts[0]!, b = pts[pts.length - 1]!, across = unit(sub(b, a)), along = leftNormal(across), L0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (const o of [-1.25, 1.25]) for (let x = 0; x + 0.5 <= L0; x += 1.0) push(quad(add(add(a, mul(across, x + 0.25)), mul(along, o)), across, along, -0.25, 0.25, -0.25, 0.25));
        if (m.color === 'green' || m.color === 'red') push(solid([add(a, mul(along, 0)), add(b, mul(along, 0))], 2.0), MARKING_MATERIAL[m.color] === 'asphalt_green' ? 'asphalt_green' : MARKING_MATERIAL[m.color]);
        break;
      }
      case 'shark_teeth': {
        // Fig. II.432 «denti di squalo»: triangles 50 cm base, 60 cm high, every 75 cm, apex towards the driver.
        const L0 = lengthOf(pts);
        for (let x = 0.3; x + 0.25 <= L0; x += 0.75) {
          const { p, t } = sampleAt(pts, x);
          const n = leftNormal(t);
          push([add(p, mul(t, -0.25)), add(p, mul(t, 0.25)), add(p, mul(n, -0.6))]);
        }
        break;
      }
      case 'island': {
        // Isola spartitraffico rialzata: kerbed platform 15 cm, white kerb outline and hatched approach nose.
        if (pts.length >= 3) {
          out.surfaces.push({ id: `cm:${m.id}:isl`, kind: 'raised', ring: toLL(pts), state, material: 'concrete', z: 9, heightM: 0.15 });
          push(solid([...pts, pts[0]!], 0.15));
        }
        break;
      }
      case 'bus_lane': {
        // Corsia riservata (art. 140 c. 2-bis Reg.): yellow line 30 cm, «BUS» every 50 m in the lane.
        push(solid(pts, 0.3), MARKING_MATERIAL.yellow);
        const L0 = lengthOf(pts);
        for (let x = 15; x < L0 - 5; x += 50) { const { p, t } = sampleAt(pts, x); for (const r of roadText(m.text || 'BUS', add(p, mul(leftNormal(t), -1.75)), t, 2.2, 1.6)) push(r, MARKING_MATERIAL.yellow); }
        break;
      }
      case 'bike_lane': {
        // Pista ciclabile su corsia (DM 557/1999 art. 7): white line 12 cm (or yellow), bike symbol and arrow every 40 m.
        push(solid(pts, w));
        const L0 = lengthOf(pts);
        for (let x = 8; x < L0 - 3; x += 40) {
          const { p, t } = sampleAt(pts, x), c = add(p, mul(leftNormal(t), -0.8));
          for (const r of roadSymbol('bike', c, t, 1.2)) push(r);
          push(arrowRing(add(c, mul(t, 2.2)), t, 'through'));
        }
        break;
      }
      case 'speed_number': for (const r of roadText(m.text || '30', pts[0]!, dir, 2.2, 2.5, 0.15)) push(r); break;
    }
  }
}

const PURPOSE: Record<string, { color?: 'white' | 'yellow' | 'blue' | 'pink' | 'green'; symbol?: string; text?: string }> = {
  free: {}, paid: { color: 'blue' }, residents: { color: 'white', text: 'R' }, motorcycle: {},
  disabled: { color: 'yellow', symbol: 'wheelchair' }, loading: { color: 'yellow', text: 'CARICO' }, taxi: { color: 'yellow', text: 'TAXI' },
  pink: { color: 'pink', symbol: 'pedestrian' }, electric: { color: 'green', text: 'E' },
};

/** Bay outlines along a kerb line (stalli, art. 149 Reg.): parallel 2,0 × 5,0, perpendicular 2,5 × 5,0, angled 45°. */
export function bays(line: readonly V[], layout: 'parallel' | 'perpendicular' | 'angled', lengthM: number, widthM: number, side: 'left' | 'right'): V[][] {
  const L = lengthOf(line);
  const s = side === 'left' ? 1 : -1;
  const out: V[][] = [];
  const pitch = layout === 'parallel' ? lengthM : layout === 'perpendicular' ? widthM : widthM / Math.SQRT1_2;
  const depth = layout === 'parallel' ? widthM : layout === 'perpendicular' ? lengthM : lengthM * Math.SQRT1_2 + widthM * Math.SQRT1_2;
  const count = Math.floor(L / pitch);
  if (count < 1) return out;
  const start = (L - count * pitch) / 2;
  const tick = (along: number) => {
    const { p, t } = sampleAt(line, along);
    const n = mul(leftNormal(t), s);
    const end = layout === 'angled' ? add(add(p, mul(n, depth)), mul(t, depth)) : add(p, mul(n, depth));
    out.push(solid([p, end], 0.12));
  };
  for (let i = 0; i <= count; i++) tick(start + i * pitch);
  // Outer line of the bays.
  const outerPts: V[] = [];
  for (let a = start; a <= start + count * pitch + 1e-6; a += Math.max(1, pitch / 2)) { const { p, t } = sampleAt(line, a); outerPts.push(add(p, mul(leftNormal(t), s * depth))); }
  if (outerPts.length >= 2) out.push(solid(outerPts, 0.12));
  return out;
}

// ------------------------------------------------------------------ automatic markings

/** Parking strips of the cross-section get their bays (colour and layout from the element). */
function autoParkingBays(road: Road, axis: readonly V[], state: PhysState, toLL: ToLL, out: Out): void {
  const lay = layoutSection(road);
  let k = 0;
  for (const pe of lay.elements) {
    if (pe.el.kind !== 'parking') continue;
    const color = pe.el.parking?.color ?? 'white', layout = pe.el.parking?.layout ?? 'parallel';
    // Bays start at the carriageway edge of the strip and extend towards the kerb.
    const inner = Math.abs(pe.left) < Math.abs(pe.right) ? pe.left : pe.right;
    const side = (pe.left + pe.right) / 2 > 0 ? 'left' : 'right';
    const depth = Math.abs(pe.left - pe.right);
    const lengthM = layout === 'parallel' ? 5 : 5, widthM = layout === 'parallel' ? Math.min(2.0, depth) : 2.5;
    const line = offset(axis, inner);
    const L = lengthOf(line);
    if (L < 8) continue;
    const trimmed = line; // ends are already trimmed by the junction setbacks
    for (const r of bays(trimmed, layout, lengthM, layout === 'parallel' ? Math.max(1.8, Math.min(2.2, depth)) : widthM, side)) {
      out.markings.push({ id: `pb:${road.id}:${pe.el.id}:${k++}`, kind: 'parking_bay', ring: toLL(r), roadId: road.id, state, material: MARKING_MATERIAL[color], z: 10, heightM: 0 });
    }
    // Reserved bays (yellow): wheelchair symbol every third bay.
    if (color === 'yellow') {
      const pitch = layout === 'parallel' ? 5 : 2.5;
      for (let a = pitch * 1.5; a < L - pitch; a += pitch * 3) {
        const { p, t } = sampleAt(trimmed, a);
        for (const r of roadSymbol('wheelchair', add(p, mul(leftNormal(t), (side === 'left' ? 1 : -1) * depth / 2)), t, 1.2)) out.markings.push({ id: `pb:${road.id}:${pe.el.id}:${k++}`, kind: 'parking_bay', ring: toLL(r), roadId: road.id, state, material: MARKING_MATERIAL.yellow, z: 10, heightM: 0 });
      }
    }
  }
}

/**
 * Preselezione: on the last 30 m before a junction with ≥ 3 arms, lane separators become solid and every
 * inbound lane gets its turn arrows (from lane.turns; inferred when empty: leftmost lane left+through,
 * rightmost through+right, single lane none).
 */
function autoApproachArrows(road: Road, axis: readonly V[], atEndIsJunction: [boolean, boolean], state: PhysState, toLL: ToLL, out: Out, keepOut: readonly KeepOut[]): void {
  const lay = layoutSection(road);
  const L = lengthOf(axis);
  if (L < 25) return;
  let k = 0;
  const push = (ring: V[], kind: PhysPolygon['kind'] = 'arrow') => out.markings.push({ id: `pa:${road.id}:${k++}`, kind, ring: toLL(ring), roadId: road.id, state, material: 'road_marking_white', z: 10, heightM: 0 });
  for (const end of [0, 1] as const) {
    if (!atEndIsJunction[end]) continue;
    // Inbound lanes at this end: forward lanes reach the end of the axis, backward lanes the start.
    const inbound = lay.elements.filter((e) => e.el.kind === 'lane').map((e) => ({ e, lane: road.lanes.find((l) => l.id === e.el.laneId) })).filter((x) => x.lane && (end === 1 ? x.lane.direction !== 'backward' : x.lane.direction === 'backward'));
    if (inbound.length < 2) continue;
    // Order from the driver's left to right.
    inbound.sort((a, b) => (end === 1 ? (b.e.left + b.e.right) - (a.e.left + a.e.right) : (a.e.left + a.e.right) - (b.e.left + b.e.right)));
    inbound.forEach(({ e, lane }, i) => {
      const turns: TurnKind[] = lane!.turns.length ? [...lane!.turns] : i === 0 ? ['left', 'through'] : i === inbound.length - 1 ? ['through', 'right'] : ['through'];
      const c = (e.left + e.right) / 2;
      for (const back of [12, 32]) {
        // Tail `back` metres from the junction, head towards it; never inside a crossing.
        const along = clearStation(end === 1 ? L - back : back, MARKING.arrowLengthM, end === 1 ? 1 : -1, keepOut, 1, L - 1);
        if (along === null) continue;
        const { p, t } = sampleAt(axis, along);
        const dir = end === 1 ? t : mul(t, -1);
        const tail = add(p, mul(leftNormal(t), c));
        for (const tk of turns.filter((x) => x !== 'uturn')) push(arrowRing(tail, dir, tk));
      }
    });
    // Solid separators between inbound lanes on the last 30 m.
    for (let i = 1; i < inbound.length; i++) {
      const a = inbound[i - 1]!.e, b = inbound[i]!.e;
      const o = Math.abs(a.right - b.left) < 0.05 ? a.right : Math.abs(b.right - a.left) < 0.05 ? b.right : (a.right + b.left) / 2;
      const seg = end === 1 ? [L - 30, L - 2] : [2, 30];
      const pts: V[] = [];
      for (let s = seg[0]!; s <= seg[1]! + 1e-6; s += 2) { const { p, t } = sampleAt(axis, s); pts.push(add(p, mul(leftNormal(t), o))); }
      push(solid(pts, MARKING.edgeWidthM), 'lane_line');
    }
  }
}

/** Bus stops (transit.stop assets): yellow zig-zag 12 m + «BUS» at the kerb of the nearest road. */
function autoBusStops(net: Network, metric: MetricCache, toLL: ToLL, out: Out): void {
  const frame = metric.frame;
  for (const a of Object.values(net.assets)) {
    if (a.type !== 'transit.stop' || a.state === 'removed') continue;
    const p = frame.toMetric(a.at) as V;
    let best: { road: Road; along: number; d: number; side: number } | null = null;
    for (const road of Object.values(net.roads)) {
      const lay = layoutSection(road);
      if (lay.pedestrianOnly) continue;
      const ax = metric.axis(road);
      const pr = project(ax, p);
      if (pr.d > 15 || (best && pr.d >= best.d)) continue;
      const { t } = sampleAt(ax, pr.along);
      const side = Math.sign(dot(sub(p, pr.at), leftNormal(t))) || -1;
      best = { road, along: pr.along, d: pr.d, side };
    }
    if (!best) continue;
    const ax = metric.axis(best.road);
    const lay = layoutSection(best.road);
    const edge = best.side > 0 ? lay.cwLeft - 1.0 : lay.cwRight + 1.0;
    const L = lengthOf(ax);
    const s0 = Math.max(1, best.along - 6), s1 = Math.min(L - 1, best.along + 6);
    if (s1 - s0 < 6) continue;
    const pts: V[] = [];
    for (let s = s0; s <= s1 + 1e-6; s += 1) { const { p: q, t } = sampleAt(ax, s); pts.push(add(q, mul(leftNormal(t), edge))); }
    const state: PhysState = a.state === 'project' ? 'project' : 'existing';
    let k = 0;
    for (const r of zigzag(pts, 0.45, 1.0, 0.12)) out.markings.push({ id: `bs:${a.id}:${k++}`, kind: 'bus_stop', ring: toLL(r), roadId: best.road.id, state, material: MARKING_MATERIAL.yellow, z: 10, heightM: 0 });
    const { p: c, t } = sampleAt(ax, best.along);
    const centre = add(c, mul(leftNormal(t), edge - best.side * 1.3));
    for (const r of roadText('BUS', centre, best.side > 0 ? mul(t, -1) : t, 2.2, 1.6)) out.markings.push({ id: `bs:${a.id}:${k++}`, kind: 'bus_stop', ring: toLL(r), roadId: best.road.id, state, material: MARKING_MATERIAL.yellow, z: 10, heightM: 0 });
  }
}

/** Raised junctions: the junction surface lifted (incrocio rialzato) with its own paving. */
function addRaisedJunctions(net: Network, surfaces: PhysPolygon[]): void {
  const raised = new Map(Object.values(net.features ?? {}).filter((f) => f.kind === 'raised_junction' && f.state !== 'removed' && f.nodeId).map((f) => [f.nodeId!, f]));
  if (!raised.size) return;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i]!;
    const f = s.nodeId ? raised.get(s.nodeId) : undefined;
    if (f && s.kind === 'junction') surfaces[i] = { ...s, material: (f.properties.material as string) ?? 'pavers_warm', heightM: f.heightM, state: 'project' };
  }
}

/** Per-road automatic markings (cached by the builder per road). */
export function addStreetscapeRoads(net: Network, roads: Map<string, { axis: readonly V[]; state: PhysState; ends: [boolean, boolean]; keepOut?: readonly KeepOut[] }>, toLL: ToLL, out: Out): void {
  for (const [roadId, x] of roads) {
    const road = net.roads[roadId];
    if (!road) continue;
    autoParkingBays(road, x.axis, x.state, toLL, out);
    autoApproachArrows(road, x.axis, x.ends, x.state, toLL, out, x.keepOut ?? []);
    autoReservedLanes(road, x.axis, x.state, toLL, out, x.keepOut ?? []);
  }
}

/**
 * Corsie riservate: bus lanes get «BUS» in yellow every 50 m (the yellow 30 cm separator comes from the
 * lane lines); cycle lanes in the section get the bike symbol and direction arrow every 40 m.
 */
function autoReservedLanes(road: Road, axis: readonly V[], state: PhysState, toLL: ToLL, out: Out, keepOut: readonly KeepOut[]): void {
  const lay = layoutSection(road);
  const L = lengthOf(axis);
  if (L < 20) return;
  let k = 0;
  const push = (ring: V[], material: string) => out.markings.push({ id: `rl:${road.id}:${k++}`, kind: 'text', ring: toLL(ring), roadId: road.id, state, material, z: 10, heightM: 0 });
  for (const pe of lay.elements) {
    const lane = road.lanes.find((l) => l.id === pe.el.laneId);
    const bus = pe.el.kind === 'bus' || lane?.restriction === 'bus_only' || lane?.priority === 'transit';
    const bike = pe.el.kind === 'cycle' || lane?.restriction === 'bike_only';
    if (!bus && !bike) continue;
    const c = (pe.left + pe.right) / 2;
    const backward = lane?.direction === 'backward' || (!lane && c > 0 && road.oneway === 'no');
    for (let x0 = bus ? 20 : 10; x0 < L - 8; x0 += bus ? 50 : 40) {
      // «BUS» is ~6 m long, the bike symbol plus arrow ~7 m: both kept out of crossings.
      const x = clearStation(x0, bus ? 6 : 7, 1, keepOut.map(([a, b]) => (backward ? [L - b, L - a] as const : [a, b] as const)), 2, L - 2);
      if (x === null) continue;
      const { p, t } = sampleAt(axis, backward ? L - x : x);
      const dir = backward ? mul(t, -1) : t;
      const at = add(p, mul(leftNormal(t), c));
      if (bus) for (const r of roadText('BUS', at, dir, Math.min(2.4, Math.abs(pe.left - pe.right) * 0.75), 1.6)) push(r, MARKING_MATERIAL.yellow);
      else { for (const r of roadSymbol('bike', at, dir, Math.min(1.2, Math.abs(pe.left - pe.right) * 0.8))) push(r, 'road_marking_white'); push(arrowRing(add(at, mul(dir, 2)), dir, 'through'), 'road_marking_white'); }
    }
  }
}

/** Network-wide elements: traffic calming, custom markings, bus stops, raised junctions. */
export function addStreetscape(net: Network, metric: MetricCache, toLL: ToLL, out: Out): void {
  addFeatures(net, metric, toLL, out);
  addCustomMarkings(net, metric, toLL, out);
  autoBusStops(net, metric, toLL, out);
  addRaisedJunctions(net, out.surfaces);
}

export type { Marking, RoadFeature };
