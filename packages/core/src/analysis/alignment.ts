import {designAlignment} from './civil';
import { LocalFrame } from '../geo/projection';
import { lengthOf, sampleAt, type V } from '../geo/polyline';
import type { LngLat, Road } from '../model/types';
import { layoutSection } from '../physical/section';
import { verticalRules } from './vertical';

/**
 * Andamento planimetrico (Civil 3D «alignment report»): the road axis split into tangents (rettifili)
 * and circular curves, with the DM 5/11/2001 § 5.2 checks — minimum radius for the design speed,
 * curve development, tangent lengths, radius after a tangent, sequence of radii, sight distance in curve.
 * The axis comes from survey data (polyline): curves are fitted from the heading change, so the
 * report is a verification aid, not a design of the transition curves.
 */
export interface AlignmentElement {
  readonly kind: 'tangent' | 'curve' | 'clothoid';
  readonly s0: number;
  readonly s1: number;
  readonly lengthM: number;
  readonly radiusM?: number;
  readonly deflectionDeg?: number;
  readonly direction?: 'left' | 'right';
  /** Superelevation from the DM abacus (simplified), %. */
  readonly superelevationPct?: number;
  /** Lateral clearance needed for the stopping sight distance, m (from the inner lane axis). */
  readonly clearanceM?: number;
}

export interface AlignmentIssue { readonly severity: 'error' | 'warning'; readonly message: string; readonly station: number }

export interface HorizontalAlignment {
  readonly lengthM: number;
  readonly designSpeedKmh: number;
  readonly category: string;
  readonly rMinM: number;
  readonly qMaxPct: number;
  readonly stoppingDistanceM: number;
  readonly elements: readonly AlignmentElement[];
  /** Curvature diagram: station (m) → curvature 1/R (signed, left positive). */
  readonly curvature: readonly { readonly s: number; readonly k: number }[];
  readonly issues: readonly AlignmentIssue[];
  readonly method: string;
}

const URBAN = (r: Road) => !['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(r.roadClass);

/** Transverse friction coefficient (DM 5/11/2001 fig. 5.2.4, interpolated). */
export function transverseFriction(V: number): number {
  return Math.max(0.1, 0.21 - 0.00075 * (V - 25));
}

/** Minimum radius R = V² / (127 (q_max + f_t)). */
export function minRadius(V: number, qMax: number): number {
  return (V * V) / (127 * (qMax + transverseFriction(V)));
}

/** Minimum tangent length between curves (DM 5/11/2001 Tab. 5.2.2), interpolated on V. */
export function minTangent(V: number): number {
  const t: [number, number][] = [[40, 30], [50, 40], [60, 50], [70, 65], [80, 90], [90, 115], [100, 150], [110, 190], [120, 250], [130, 300], [140, 360]];
  if (V <= t[0]![0]) return t[0]![1];
  for (let i = 1; i < t.length; i++) if (V <= t[i]![0]) { const [v0, l0] = t[i - 1]!, [v1, l1] = t[i]!; return l0 + ((l1 - l0) * (V - v0)) / (v1 - v0); }
  return t[t.length - 1]![1];
}

const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',');

export function horizontalAlignment(road: Road, origin: LngLat): HorizontalAlignment {
  const f = new LocalFrame(origin);
  const pts = road.axis.map((q) => f.toMetric(q) as V);
  const L = road.alignment?road.alignment.elements.reduce((sum,e)=>sum+e.lengthM,0):lengthOf(pts);
  const rules = verticalRules(road);
  const V = rules.designSpeedKmh;
  const qMax = URBAN(road) ? 0.05 : 0.07;
  const rMin = minRadius(V, qMax);
  const step = Math.max(1, Math.min(3, L / 60));
  const n = Math.max(2, Math.floor(L / step));
  // Heading every `step` m, unwrapped; curvature from the heading change over a ±window (smooths survey noise).
  const head: number[] = [];
  for (let i = 0; i <= n; i++) { const { t } = sampleAt(pts, (L * i) / n); head.push(Math.atan2(t[1], t[0])); }
  for (let i = 1; i < head.length; i++) { while (head[i]! - head[i - 1]! > Math.PI) head[i]! -= 2 * Math.PI; while (head[i]! - head[i - 1]! < -Math.PI) head[i]! += 2 * Math.PI; }
  const w = Math.max(1, Math.round(6 / step));
  let curvature = head.map((_, i) => {
    const a = Math.max(0, i - w), b = Math.min(head.length - 1, i + w);
    const ds = ((b - a) * L) / n;
    return { s: (L * i) / n, k: ds > 0 ? (head[b]! - head[a]!) / ds : 0 };
  });
  // Curves: runs with |k| above 1/1500 m and the same sign, at least 5 m long.
  const K = 1 / 1500;
  const elements: AlignmentElement[] = [];
  let i = 0;
  const pushTangent = (s0: number, s1: number) => { if (s1 - s0 > 0.5) elements.push({ kind: 'tangent', s0, s1, lengthM: s1 - s0 }); };
  let last = 0;
  while (i < curvature.length) {
    const sign = Math.sign(curvature[i]!.k);
    if (Math.abs(curvature[i]!.k) < K) { i++; continue; }
    let j = i;
    while (j + 1 < curvature.length && Math.sign(curvature[j + 1]!.k) === sign && Math.abs(curvature[j + 1]!.k) >= K) j++;
    const s0 = curvature[i]!.s, s1 = curvature[j]!.s;
    if (s1 - s0 >= 5) {
      const ia = Math.round((s0 / L) * n), ib = Math.round((s1 / L) * n);
      const defl = head[ib]! - head[ia]!;
      const R = Math.abs(defl) > 1e-4 ? (s1 - s0) / Math.abs(defl) : Infinity;
      if (Number.isFinite(R) && Math.abs(defl) * 180 / Math.PI >= 3) {
        pushTangent(last, s0);
        const D = rules.stoppingDistanceM;
        // Superelevation: linear between q_max at R_min and 2,5% at R = 2,5 R_min (abacus, simplified).
        const q = R <= rMin ? qMax * 100 : Math.max(2.5, qMax * 100 - ((qMax * 100 - 2.5) * (R - rMin)) / (1.5 * rMin));
        const clearance = D < 2 * R ? R * (1 - Math.cos(D / (2 * R))) : D * D / (8 * R);
        elements.push({ kind: 'curve', s0, s1, lengthM: s1 - s0, radiusM: R, deflectionDeg: (Math.abs(defl) * 180) / Math.PI, direction: defl > 0 ? 'left' : 'right', superelevationPct: q, clearanceM: clearance });
        last = s1;
      }
    }
    i = j + 1;
  }
  pushTangent(last, L);

  if(road.alignment){
    const analytical=designAlignment(road.axis[0]!,road.alignment);
    curvature=[{s:0,k:0},...analytical.samples.map(p=>({s:p.station,k:-p.curvature}))];
    elements.length=0;let station=0;
    for(const e of road.alignment.elements){const k0=e.kind==='arc'?(e.turn==='left'?-1:1)/e.radiusM!:e.kind==='clothoid'?e.startCurvature!:0,k1=e.kind==='clothoid'?e.endCurvature!:k0,maxK=Math.max(Math.abs(k0),Math.abs(k1)),R=maxK?1/maxK:Infinity,D=rules.stoppingDistanceM;
      curvature.push({s:station,k:-k0});curvature.push({s:station+e.lengthM,k:-k1});
      const q=R<=rMin?qMax*100:Math.max(2.5,qMax*100-((qMax*100-2.5)*(R-rMin))/(1.5*rMin));
      elements.push({kind:e.kind==='tangent'?'tangent':e.kind==='clothoid'?'clothoid':'curve',s0:station,s1:station+e.lengthM,lengthM:e.lengthM,...(maxK?{radiusM:R,direction:k0+k1<0?'left' as const:'right' as const,deflectionDeg:Math.abs((k0+k1)/2*e.lengthM)*180/Math.PI,superelevationPct:q,clearanceM:D<2*R?R*(1-Math.cos(D/(2*R))):D*D/(8*R)}:{})});station+=e.lengthM;
    }
    curvature.sort((a,b)=>a.s-b.s);
  }
  const issues: AlignmentIssue[] = [];
  const halfW = (() => { const l = layoutSection(road); return (l.outerLeft - l.outerRight) / 2; })();
  elements.forEach((e, k) => {
    if (e.kind !== 'tangent'&&e.radiusM) {
      const R = e.radiusM!;
      if (R < rMin * 0.98) issues.push({ severity: URBAN(road) ? 'warning' : 'error', station: (e.s0 + e.s1) / 2, message: `Curva R ≈ ${fmt(R)} m sotto il minimo ${fmt(rMin)} m per ${V} km/h (q ${fmt(qMax * 100)}%): ridurre la velocità o allargare la curva` });
      const minDev = (V / 3.6) * 2.5;
      if (e.lengthM < minDev && e.deflectionDeg! > 10) issues.push({ severity: 'warning', station: e.s0, message: `Sviluppo ${fmt(e.lengthM)} m sotto i ${fmt(minDev)} m (2,5 s a ${V} km/h)` });
      if (e.clearanceM! > halfW + 1.5) issues.push({ severity: 'warning', station: (e.s0 + e.s1) / 2, message: `Visibilità per l'arresto (${rules.stoppingDistanceM} m): serve un franco laterale di ${fmt(e.clearanceM!, 1)} m dall'asse della corsia interna` });
      const prev = elements[k - 1], nextC = elements.slice(k + 1).find((x) => x.kind === 'curve');
      if (prev?.kind === 'tangent' && prev.s0 > 0) {
        const need = prev.lengthM < 300 ? prev.lengthM : 400;
        if (!URBAN(road) && R < need) issues.push({ severity: 'warning', station: e.s0, message: `Dopo un rettifilo di ${fmt(prev.lengthM)} m il raggio dovrebbe essere ≥ ${fmt(need)} m (DM 2001 § 5.2.5)` });
      }
      if (nextC && nextC.radiusM && Math.max(R, nextC.radiusM) / Math.min(R, nextC.radiusM) > 2 && Math.min(R, nextC.radiusM) < 500) issues.push({ severity: 'warning', station: nextC.s0, message: `Raggi consecutivi ${fmt(R)} → ${fmt(nextC.radiusM)} m: rapporto oltre 2 (abaco DM 2001 fig. 5.2.6)` });
    } else {
      const between = k > 0 && k < elements.length - 1;
      if (between && e.lengthM < minTangent(V) && e.lengthM > 2) issues.push({ severity: 'warning', station: e.s0, message: `Rettifilo di ${fmt(e.lengthM)} m tra due curve: minimo ${fmt(minTangent(V))} m a ${V} km/h (Tab. 5.2.2)` });
      if (!URBAN(road) && e.lengthM > 22 * V) issues.push({ severity: 'warning', station: e.s0, message: `Rettifilo di ${fmt(e.lengthM)} m oltre 22·V = ${fmt(22 * V)} m` });
    }
  });
  return {
    lengthM: L, designSpeedKmh: V, category: rules.category, rMinM: rMin, qMaxPct: qMax * 100, stoppingDistanceM: rules.stoppingDistanceM, elements, curvature, issues,
    method: road.alignment?'Tracciato analitico: curvature esatte di rettifili, archi e clotoidi; per le clotoidi raggio minimo all’estremo più curvo. Verifiche preliminari semplificate, senza ostacoli di rilievo.':'Rettifili e curve circolari riconosciuti dalla variazione di direzione dell\'asse (finestra ±6 m); verifiche semplificate DM 5/11/2001 § 5.2 (raggio minimo, sviluppo, rettifili, successione dei raggi, visibilità in curva). Le clotoidi di transizione non sono ricostruite dal rilievo.',
  };
}
