import { geom, horizontalAlignment, type Road } from '@drip-urban/core';
import type { Feature } from '../engine/geojson';
import type { NetworkIndex } from './snap';

/**
 * Live drafting guide for the road pen (Cities: Skylines-like, but advisory only): curve radii with
 * the DM 5/11/2001 minimum, crossings that will become junctions with their angle, junction spacing.
 * Nothing is changed automatically: the hints are shown on the map and in the tool panel.
 */
export interface GuideHint { readonly level: 'ok' | 'warn' | 'info'; readonly text: string }

function segX(a: geom.V, b: geom.V, c: geom.V, d: geom.V): { t: number; u: number } | null {
  const r = geom.sub(b, a), s = geom.sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const q = geom.sub(c, a);
  const t = (q[0] * s[1] - q[1] * s[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den;
  return t > 0.02 && t < 0.98 && u >= 0 && u <= 1 ? { t, u } : null;
}

export function roadGuide(idx: NetworkIndex, axis: readonly geom.V[], preview: Road, origin: readonly [number, number]): { feats: Feature[]; hints: GuideHint[] } {
  const feats: Feature[] = [];
  const hints: GuideHint[] = [];
  if (axis.length < 2) return { feats, hints };
  const L = geom.lengthOf(axis);
  // Curves.
  const al = horizontalAlignment(preview, [origin[0], origin[1]]);
  for (const c of al.elements.filter((e) => e.kind === 'curve')) {
    const { p } = geom.sampleAt(axis, (c.s0 + c.s1) / 2);
    const tight = c.radiusM! < al.rMinM;
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...idx.frame.toLngLat(p)] }, properties: { kind: 'guide', label: `R ${Math.round(c.radiusM!)} m${tight ? ' ⚠' : ''}` } });
    hints.push(tight ? { level: 'warn', text: `Curva R ${Math.round(c.radiusM!)} m sotto il minimo ${Math.round(al.rMinM)} m a ${al.designSpeedKmh} km/h: allarga la curva o prevedi un limite più basso (DM 5/11/2001 § 5.2.4)` } : { level: 'ok', text: `Curva R ${Math.round(c.radiusM!)} m conforme (min ${Math.round(al.rMinM)} m)` });
  }
  // Crossings with existing roads → new junctions.
  const lo = axis.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1])], [Infinity, Infinity]);
  const hi = axis.reduce((m, p) => [Math.max(m[0], p[0]), Math.max(m[1], p[1])], [-Infinity, -Infinity]);
  const crossings: { s: number; angle: number; name: string; at: geom.V }[] = [];
  for (const r of Object.values(idx.net.roads)) {
    const ra = idx.axis(r.id);
    if (!ra.length || ra.every((p) => p[0] < lo[0] - 5 || p[0] > hi[0] + 5 || p[1] < lo[1] - 5 || p[1] > hi[1] + 5)) continue;
    let acc = 0;
    for (let i = 0; i + 1 < axis.length; i++) {
      const a = axis[i]!, b = axis[i + 1]!;
      for (let j = 0; j + 1 < ra.length; j++) {
        const x = segX(a, b, ra[j]!, ra[j + 1]!);
        if (!x) continue;
        const u = geom.unit(geom.sub(b, a)), v = geom.unit(geom.sub(ra[j + 1]!, ra[j]!));
        const ang = (Math.acos(Math.min(1, Math.abs(u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
        crossings.push({ s: acc + geom.dist(a, b) * x.t, angle: ang, name: r.name || 'strada', at: geom.add(a, geom.mul(geom.sub(b, a), x.t)) });
      }
      acc += geom.dist(a, b);
    }
  }
  crossings.sort((a, b) => a.s - b.s);
  for (const c of crossings) {
    const skew = c.angle < 70;
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...idx.frame.toLngLat(c.at)] }, properties: { kind: 'guide', snap: true, label: `incrocio ${Math.round(c.angle)}°${skew ? ' ⚠' : ''}` } });
    hints.push(skew ? { level: 'warn', text: `Incrocio con ${c.name} a ${Math.round(c.angle)}°: l'angolo dovrebbe essere tra 70° e 110° (DM 19/4/2006 § 4.6); valuta una rotatoria` } : { level: 'info', text: `Nuovo incrocio con ${c.name} (${Math.round(c.angle)}°): dopo la creazione regola precedenze o semaforo` });
  }
  for (let i = 1; i < crossings.length; i++) {
    const d = crossings[i]!.s - crossings[i - 1]!.s;
    if (d < 30) hints.push({ level: 'warn', text: `Due incroci a ${Math.round(d)} m: troppo vicini per le corsie di accumulo (consigliati ≥ 30 m in ambito urbano)` });
  }
  if (L > 0 && !crossings.length) hints.push({ level: 'info', text: `Lunghezza ${L.toFixed(0)} m · nessun incrocio con la rete esistente` });
  return { feats, hints };
}
