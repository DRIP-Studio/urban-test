// Frozen pre-upgrade geometry path, used only by the opt-in crash reproduction.
import { LocalFrame, SIM_STRIDE, type SimFrame, type LngLat } from '@drip-urban/core';
import { fc, type Feature, type Polygon } from '../../apps/web/src/engine/geojson';
import { VEHICLE_CLASSES as CLS, paintsOf, paintIndex, vehiclePrints, colorOfPart } from '../../apps/web/src/models/vehicles';
export function vehiclesFC(frame: SimFrame, origin: LngLat) {
  const f = new LocalFrame(origin);
  const out: Feature<Polygon>[] = [];
  const d = frame.data;
  for (let i = 0, n = 0; i < d.length; i += SIM_STRIDE, n++) {
    const cls = CLS[d[i + 3]!] ?? 'car';
    const id = d[i + 5]!;
    const paint = paintsOf(cls)[paintIndex(cls, id)]!;
    const c = f.toMetric([d[i]!, d[i + 1]!]);
    const a = (-d[i + 2]! * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    vehiclePrints(cls).forEach((p, k) => {
      const ring = p.ring.map(([x, y]) => { const ll = f.toLngLat([c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]); return [ll[0], ll[1]]; });
      ring.push(ring[0]!);
      out.push({ type: 'Feature', id: n * 64 + k, geometry: { type: 'Polygon', coordinates: [ring] }, properties: { cls: d[i + 3]!, v: d[i + 4]!, c: colorOfPart(p.mat, paint), b: p.base, h: p.top } });
    });
  }
  return fc(out);
}
