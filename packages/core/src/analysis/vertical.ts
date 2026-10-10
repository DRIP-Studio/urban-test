import {corridorCrossfall} from './crossfall';
import type { LngLat, Network, Road, TerrainGrid, VerticalProfile, VerticalPVI } from '../model/types';
import { LocalFrame } from '../geo/projection';
import { leftNormal, lengthOf, sampleAt, type V } from '../geo/polyline';
import { layoutSection } from '../physical/section';

/**
 * Vertical design of roads (altimetria): ground profile from the DTM, grade lines with parabolic
 * vertical curves, checks after DM 5/11/2001 (pendenze massime, raccordi verticali per visibilità
 * d'arresto) and earthworks by average end areas. Preliminary-design level: the pavement package and
 * the subgrade are not modelled; slopes are 1:1 in cut and 3:2 in fill.
 */

export interface ProfilePoint { readonly station: number; readonly z: number }

/** Bilinear sample of the DTM; NaN outside the grid. */
export function sampleTerrain(g: TerrainGrid, lon: number, lat: number): number {
  const fx = ((lon - g.west) / (g.east - g.west)) * (g.nx - 1);
  const fy = ((lat - g.south) / (g.north - g.south)) * (g.ny - 1);
  if (!(fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1)) return Number.NaN;
  const i = Math.min(Math.floor(fx), g.nx - 2), j = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - i, ty = fy - j;
  const z = (ii: number, jj: number) => g.z[jj * g.nx + ii]!;
  return (z(i, j) * (1 - tx) + z(i + 1, j) * tx) * (1 - ty) + (z(i, j + 1) * (1 - tx) + z(i + 1, j + 1) * tx) * ty;
}

export interface Stationing { readonly length: number; readonly frame: LocalFrame; readonly pts: readonly V[]; at(s: number): { p: V; t: V } }

/** Metric axis of a road and chainage helpers (station 0 at node `from`). */
export function stationing(road: Road, origin: LngLat): Stationing {
  const frame = new LocalFrame(origin);
  const pts = road.axis.map((q) => frame.toMetric(q) as V);
  return { length: lengthOf(pts), frame, pts, at: (s: number) => sampleAt(pts, s) };
}

function groundAt(st: Stationing, g: TerrainGrid, s: number, offset = 0): number {
  const { p, t } = st.at(s);
  const n = leftNormal(t);
  const ll = st.frame.toLngLat([p[0] + n[0] * offset, p[1] + n[1] * offset]);
  return sampleTerrain(g, ll[0], ll[1]);
}

/** Ground elevation along the axis every `step` metres (always including both ends). */
export function groundProfile(road: Road, g: TerrainGrid, origin: LngLat, step = 5): ProfilePoint[] {
  const st = stationing(road, origin);
  const n = Math.max(1, Math.ceil(st.length / step));
  return Array.from({ length: n + 1 }, (_, k) => { const s = Math.min(st.length, k * step); return { station: s, z: groundAt(st, g, s) }; });
}

const grade = (a: VerticalPVI, b: VerticalPVI) => (b.elevation - a.elevation) / Math.max(1e-6, b.station - a.station);

/** Exact isolated high/low points: roots of the parabolic derivative, or sharp grade reversals. */
export function verticalExtrema(profile: VerticalProfile): readonly { station: number; elevation: number; kind: 'high' | 'low' }[] {
  const points: { station: number; elevation: number; kind: 'high' | 'low' }[] = [];
  for (let i = 1; i < profile.pvis.length - 1; i++) {
    const p = profile.pvis[i]!, before = grade(profile.pvis[i - 1]!, p), after = grade(p, profile.pvis[i + 1]!);
    if (before * after >= 0) continue;
    const length = p.curveLength ?? 0;
    const station = length > 0 ? p.station - length / 2 - before * length / (after - before) : p.station;
    points.push({ station, elevation: designElevation(profile, station), kind: before > 0 ? 'high' : 'low' });
  }
  return points.sort((a,b)=>a.station-b.station);
}

/** Elevation of the grade line at station `s`, with symmetric parabolic curves centred on the PVIs. */
export function designElevation(v: VerticalProfile, s: number): number {
  const p = v.pvis;
  if (!p.length) return Number.NaN;
  if (s <= p[0]!.station) return p[0]!.elevation;
  if (s >= p[p.length - 1]!.station) return p[p.length - 1]!.elevation;
  for (let i = 1; i < p.length - 1; i++) {
    const L = p[i]!.curveLength ?? 0;
    if (L > 0 && Math.abs(s - p[i]!.station) <= L / 2) {
      const g1 = grade(p[i - 1]!, p[i]!), g2 = grade(p[i]!, p[i + 1]!);
      const x = s - (p[i]!.station - L / 2);
      return p[i]!.elevation - (g1 * L) / 2 + g1 * x + ((g2 - g1) / (2 * L)) * x * x;
    }
  }
  let k = 1;
  while (k < p.length - 1 && p[k]!.station < s) k++;
  const a = p[k - 1]!, b = p[k]!;
  return a.elevation + grade(a, b) * (s - a.station);
}

export interface VerticalRules {
  readonly category: string;
  readonly designSpeedKmh: number;
  readonly maxGradePct: number;
  readonly stoppingDistanceM: number;
  readonly rvConvexMinM: number;
  readonly rvConcaveMinM: number;
}

/** Design parameters for a road after DM 5/11/2001 (pendenze Tab. 5.4; raccordi verticali § 5.3). */
export function verticalRules(road: Road): VerticalRules {
  const cls = road.roadClass;
  const [category, maxGradePct] =
    cls === 'motorway' || cls === 'motorway_link' ? ['A — autostrada', 5]
      : cls === 'trunk' || cls === 'trunk_link' ? ['B — extraurbana principale', 6]
        : cls === 'primary' || cls === 'primary_link' ? ['D — urbana di scorrimento', 6]
          : cls === 'secondary' || cls === 'tertiary' || cls === 'secondary_link' || cls === 'tertiary_link' ? ['E — urbana di quartiere', 8]
            : cls === 'cycleway' ? ['Pista ciclabile (DM 557/1999)', 5]
              : cls === 'footway' || cls === 'pedestrian' || cls === 'path' || cls === 'steps' ? ['Percorso pedonale (DM 236/1989)', 8]
                : ['F — locale', 10];
  const V = Math.max(30, road.speedKmh + 10); // upper end of the design speed range
  const tau = 2.8 - 0.01 * V;
  const fl = Math.max(0.25, 0.45 - 0.0017 * (V - 25));
  const D = (V * tau) / 3.6 + (V * V) / (254 * fl);
  const h1 = 1.1, h2 = 0.1, h = 0.5, theta = Math.PI / 180;
  return {
    category, designSpeedKmh: V, maxGradePct, stoppingDistanceM: Math.round(D),
    rvConvexMinM: Math.round((D * D) / (2 * (h1 + h2 + 2 * Math.sqrt(h1 * h2)))),
    rvConcaveMinM: Math.round((D * D) / (2 * (h + D * Math.sin(theta)))),
  };
}

export interface VerticalIssue { readonly severity: 'error' | 'warning'; readonly message: string; readonly station?: number }

export function checkVertical(road: Road, v: VerticalProfile, length: number): VerticalIssue[] {
  const r = verticalRules(road);
  const out: VerticalIssue[] = [];
  const p = v.pvis;
  if (Math.abs(p[0]!.station) > 0.5 || Math.abs(p[p.length - 1]!.station - length) > 0.5) out.push({ severity: 'error', message: `Il profilo deve coprire la strada da 0 a ${length.toFixed(1)} m` });
  for (let i = 1; i < p.length; i++) {
    const gp = Math.abs(grade(p[i - 1]!, p[i]!)) * 100;
    if (gp > r.maxGradePct + 1e-6) out.push({ severity: gp > r.maxGradePct + 2 ? 'error' : 'warning', station: (p[i - 1]!.station + p[i]!.station) / 2, message: `Livelletta al ${gp.toFixed(1)}% oltre il massimo del ${r.maxGradePct}% (${r.category})` });
  }
  for (let i = 1; i < p.length - 1; i++) {
    const g1 = grade(p[i - 1]!, p[i]!), g2 = grade(p[i]!, p[i + 1]!), dg = g2 - g1;
    if (Math.abs(dg) < 0.005) continue;
    const L = p[i]!.curveLength ?? 0;
    const convex = dg < 0;
    const rv = L > 0 ? L / Math.abs(dg) : 0;
    const min = convex ? r.rvConvexMinM : r.rvConcaveMinM;
    if (rv < min) out.push({ severity: L === 0 ? 'warning' : rv < min * 0.7 ? 'error' : 'warning', station: p[i]!.station, message: `Raccordo ${convex ? 'convesso' : 'concavo'}: raggio ${Math.round(rv)} m < minimo ${min} m (visibilità d'arresto ${r.stoppingDistanceM} m a ${r.designSpeedKmh} km/h)` });
    const room = Math.min(p[i]!.station - p[i - 1]!.station - (p[i - 1]!.curveLength ?? 0) / 2, p[i + 1]!.station - p[i]!.station - (p[i + 1]!.curveLength ?? 0) / 2);
    if (L / 2 > room + 1e-6) out.push({ severity: 'error', station: p[i]!.station, message: `Raccordo di ${Math.round(L)} m sovrapposto al vertice vicino` });
  }
  return out;
}

/** Elevation at a node from the vertical profiles of the other roads that end there (continuity at junctions). */
export function nodeElevation(net: Network, nodeId: string, exceptRoadId: string, origin: LngLat): number | null {
  for (const r of Object.values(net.roads)) {
    if (r.id === exceptRoadId || !r.vertical) continue;
    if (r.from === nodeId) return r.vertical.pvis[0]!.elevation;
    if (r.to === nodeId) return r.vertical.pvis[r.vertical.pvis.length - 1]!.elevation;
  }
  void origin;
  return null;
}

function simplify(pts: ProfilePoint[], tol: number): ProfilePoint[] {
  if (pts.length <= 2) return pts;
  const a = pts[0]!, b = pts[pts.length - 1]!;
  let best = -1, bd = tol;
  for (let i = 1; i < pts.length - 1; i++) {
    const q = pts[i]!;
    const zLine = a.z + ((b.z - a.z) * (q.station - a.station)) / Math.max(1e-6, b.station - a.station);
    const d = Math.abs(q.z - zLine);
    if (d > bd) { bd = d; best = i; }
  }
  if (best < 0) return [a, b];
  return [...simplify(pts.slice(0, best + 1), tol).slice(0, -1), ...simplify(pts.slice(best), tol)];
}

/**
 * Proposed grade line: the ground profile simplified (tolerance `tolM`), grades clamped to the category
 * maximum, ends tied to the neighbouring profiles (or to the ground), curves sized for stopping sight.
 */
export function proposeVertical(net: Network, road: Road, g: TerrainGrid, origin: LngLat, opts: { tolM?: number; minSpacingM?: number } = {}): VerticalProfile {
  const st = stationing(road, origin);
  const ground = groundProfile(road, g, origin, Math.max(2, Math.min(10, st.length / 20))).filter((q) => Number.isFinite(q.z));
  if (ground.length < 2) throw new Error('Il modello del terreno non copre questa strada');
  const rules = verticalRules(road);
  let pv = simplify(ground, opts.tolM ?? 0.35);
  // Drop vertices closer than the minimum spacing (short grades are unbuildable).
  const minSp = opts.minSpacingM ?? Math.max(15, Math.min(60, st.length / 6));
  pv = pv.filter((q, i) => i === 0 || i === pv.length - 1 || (q.station - pv[i - 1]!.station >= minSp && pv[pv.length - 1]!.station - q.station >= minSp));
  const z = pv.map((q) => q.z);
  const z0 = nodeElevation(net, road.from, road.id, origin), z1 = nodeElevation(net, road.to, road.id, origin);
  if (z0 !== null) z[0] = z0;
  if (z1 !== null) z[z.length - 1] = z1;
  const gmax = rules.maxGradePct / 100 * 0.98;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < z.length; i++) { const ds = pv[i]!.station - pv[i - 1]!.station; z[i] = Math.max(z[i - 1]! - gmax * ds, Math.min(z[i - 1]! + gmax * ds, z[i]!)); }
    for (let i = z.length - 2; i >= 0; i--) { const ds = pv[i + 1]!.station - pv[i]!.station; z[i] = Math.max(z[i + 1]! - gmax * ds, Math.min(z[i + 1]! + gmax * ds, z[i]!)); }
  }
  const pvis: VerticalPVI[] = pv.map((q, i) => ({ station: Math.round(q.station * 100) / 100, elevation: Math.round(z[i]! * 100) / 100 }));
  pvis[pvis.length - 1] = { ...pvis[pvis.length - 1]!, station: Math.round(st.length * 100) / 100 };
  return { pvis: sizeCurves(road, pvis) };
}

/** Curve lengths from the minimum radii, limited by the room between vertices. */
export function sizeCurves(road: Road, pvis: readonly VerticalPVI[]): VerticalPVI[] {
  const r = verticalRules(road);
  const out = pvis.map((q) => ({ ...q, curveLength: 0 }));
  for (let i = 1; i < out.length - 1; i++) {
    const g1 = grade(out[i - 1]!, out[i]!), g2 = grade(out[i]!, out[i + 1]!), dg = g2 - g1;
    if (Math.abs(dg) < 0.002) continue;
    const want = (dg < 0 ? r.rvConvexMinM : r.rvConcaveMinM) * Math.abs(dg);
    const room = Math.min(out[i]!.station - out[i - 1]!.station, out[i + 1]!.station - out[i]!.station) * 0.95;
    out[i] = { ...out[i]!, curveLength: Math.round(Math.max(10, Math.min(want, room)) * 10) / 10 };
  }
  // Neighbouring curves must not overlap: shrink pairs that do.
  for (let i = 1; i < out.length - 2; i++) {
    const gap = out[i + 1]!.station - out[i]!.station, need = (out[i]!.curveLength + out[i + 1]!.curveLength) / 2;
    if (need > gap) { const k = gap / need * 0.98; out[i] = { ...out[i]!, curveLength: Math.round(out[i]!.curveLength * k * 10) / 10 }; out[i + 1] = { ...out[i + 1]!, curveLength: Math.round(out[i + 1]!.curveLength * k * 10) / 10 }; }
  }
  return out.map((q, i) => (i === 0 || i === out.length - 1 ? { station: q.station, elevation: q.elevation } : q));
}

export interface SectionCut {
  readonly station: number;
  readonly ground: number;
  readonly design: number;
  readonly cutM2: number;
  readonly fillM2: number;
}

export interface Earthworks { readonly rows: readonly SectionCut[]; readonly cutM3: number; readonly fillM3: number; readonly platformWidthM: number; readonly method: string }

const CUT_SLOPE = 1, FILL_SLOPE = 1.5;

/** Cross-section geometry at a station: ground across the platform and the design platform with side slopes. */
export function crossSection(road: Road, v: VerticalProfile, g: TerrainGrid, origin: LngLat, station: number, samples = 13) {
  const st = stationing(road, origin);
  const lay = layoutSection(road);
  const left = lay.outerLeft, right = lay.outerRight;
  const zd = designElevation(v, station);
  const offsets = Array.from({ length: samples }, (_, k) => right + ((left - right) * k) / (samples - 1));
  const ground = offsets.map((o) => groundAt(st, g, station, o));
  const packageDepth=(road.corridor?.layers??[]).reduce((sum,l)=>sum+l.thicknessM,0);
  const designProfile=offsets.map(o=>zd+corridorCrossfall(road.corridor,station,o));
  const subgrade=designProfile.map((z,i)=>z-(road.corridor?.layers??[]).filter(l=>Math.abs(offsets[i]!)<=(l.widthM??left-right)/2).reduce((sum,l)=>sum+l.thicknessM,0));
  let cut = 0, fill = 0;
  for (let k = 1; k < samples; k++) {
    const w = offsets[k]! - offsets[k - 1]!;
    const d0 = ground[k - 1]! - subgrade[k-1]!, d1 = ground[k]! - subgrade[k]!;
    cut += (Math.max(0, d0) + Math.max(0, d1)) / 2 * w;
    fill += (Math.max(0, -d0) + Math.max(0, -d1)) / 2 * w;
  }
  // Side slopes from the platform edges down/up to the ground (triangle approximation).
  const slopes: { side: 'left' | 'right'; x: number; z: number }[] = [];
  for (const [side, o, gz] of [['right', right, ground[0]!], ['left', left, ground[samples - 1]!]] as const) {
    const edgeZ=zd+corridorCrossfall(road.corridor,station,o)-packageDepth;
    const hgt = gz - edgeZ;
    if (!Number.isFinite(hgt)) continue;
    const retained=road.corridor?.retaining?.[side];
    const m = retained?0:hgt > 0 ? road.corridor?.cutSlope??CUT_SLOPE : road.corridor?.fillSlope??FILL_SLOPE;
    if (hgt > 0) cut += (hgt * hgt * m) / 2; else fill += (hgt * hgt * m) / 2;
    slopes.push({ side, x: o + Math.sign(o || 1) * Math.abs(hgt) * m, z: gz });
  }
  return { station, offsets, ground, design: zd, designProfile,subgrade, left, right, slopes, cutM2: cut, fillM2: fill };
}

/** Earthworks along the road by average end areas, sections every `step` metres. */
export function earthworks(road: Road, v: VerticalProfile, g: TerrainGrid, origin: LngLat, step = 10): Earthworks {
  const st = stationing(road, origin);
  const n = Math.max(1, Math.ceil(st.length / step));
  const rows: SectionCut[] = [];
  for (let k = 0; k <= n; k++) {
    const s = Math.min(st.length, k * step);
    const c = crossSection(road, v, g, origin, s, 9);
    rows.push({ station: s, ground: groundAt(st, g, s), design: c.design, cutM2: c.cutM2, fillM2: c.fillM2 });
  }
  let cut = 0, fill = 0;
  for (let k = 1; k < rows.length; k++) {
    const ds = rows[k]!.station - rows[k - 1]!.station;
    cut += ((rows[k - 1]!.cutM2 + rows[k]!.cutM2) / 2) * ds;
    fill += ((rows[k - 1]!.fillM2 + rows[k]!.fillM2) / 2) * ds;
  }
  const lay = layoutSection(road);
  return { rows, cutM3: Math.round(cut), fillM3: Math.round(fill), platformWidthM: lay.outerLeft - lay.outerRight,
    method: `Sezioni ogni ${step} m, aree medie; scarpate H/V ${road.corridor?.cutSlope??CUT_SLOPE} sterro / ${road.corridor?.fillSlope??FILL_SLOPE} rilevato; ${road.corridor?'pacchetto e pendenze assembly inclusi':'pacchetto stradale escluso'}` };
}

/** Exact interval restriction: clipped parabolas become equivalent symmetric PVI curves. */
export function sliceVerticalProfile(v:VerticalProfile,start:number,end:number):VerticalProfile {
 if(!(Number.isFinite(start)&&Number.isFinite(end)&&end>start))throw Error('Intervallo profilo non valido');
 const curves=v.pvis.slice(1,-1).flatMap((p,j)=>{const length=p.curveLength??0;return length>0?[{a:p.station-length/2,b:p.station+length/2,p,gradeIn:grade(v.pvis[j]!,p),gradeOut:grade(p,v.pvis[j+2]!)}]:[];});
 const breaks=[...new Set([start,end,...v.pvis.filter(p=>p.station>start&&p.station<end&&!curves.some(c=>p.station>c.a&&p.station<c.b)).map(p=>p.station),...curves.flatMap(c=>[c.a,c.b]).filter(s=>s>start&&s<end)])].sort((a,b)=>a-b);
 const pvis:VerticalPVI[]=[{station:0,elevation:designElevation(v,start)}];
 for(let i=1;i<breaks.length;i++){const a=breaks[i-1]!,b=breaks[i]!,mid=(a+b)/2,curve=curves.find(c=>mid>c.a&&mid<c.b);if(curve){const g0=curve.gradeIn+(curve.gradeOut-curve.gradeIn)*(a-curve.a)/(curve.b-curve.a);pvis.push({station:mid-start,elevation:designElevation(v,a)+g0*(b-a)/2,curveLength:b-a});}pvis.push({station:b-start,elevation:designElevation(v,b)});}
 return{...v,pvis};
}
