import type { LngLat, Network, Zone } from '@drip-urban/core';

const M = 111_320;
function inside(p: LngLat, ring: readonly LngLat[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function edgeDistM(p: LngLat, ring: readonly LngLat[]): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ax = (a[0] - p[0]) * k * M, ay = (a[1] - p[1]) * M, bx = (b[0] - p[0]) * k * M, by = (b[1] - p[1]) * M;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export const ztlZones = (net: Network): Zone[] => Object.values(net.zones).filter((z) => z.kind === 'ztl');

/** ZTL a gate/panel at `at` belongs to: the zone containing it, else the nearest boundary within `maxM`. */
export function zoneForPoint(net: Network, at: LngLat, maxM = 150): Zone | null {
  const zones = ztlZones(net);
  const hit = zones.find((z) => inside(at, z.polygon));
  if (hit) return hit;
  let best: Zone | null = null, bd = maxM;
  for (const z of zones) { const d = edgeDistM(at, z.polygon); if (d < bd) { bd = d; best = z; } }
  return best;
}
