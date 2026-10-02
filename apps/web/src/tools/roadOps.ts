import { ROAD_TEMPLATES, geom, isPedestrianRoad, roadFromTemplate, type LngLat, type RoadNode } from '@drip-urban/core';
import { newId } from '../state/store';
import type { NetworkIndex, SnapResult } from './snap';

/** Catmull-Rom spline through control points, sampled every ~1.5 m (curve tool). */
export function spline(idx: NetworkIndex, pts: readonly LngLat[]): LngLat[] {
  if (pts.length < 3) return [...pts];
  const m = pts.map((p) => idx.frame.toMetric(p) as geom.V);
  const out: geom.V[] = [m[0]!];
  for (let i = 0; i < m.length - 1; i++) {
    const p0 = m[Math.max(0, i - 1)]!, p1 = m[i]!, p2 = m[i + 1]!, p3 = m[Math.min(m.length - 1, i + 2)]!;
    const n = Math.max(2, Math.ceil(geom.dist(p1, p2) / 1.5));
    for (let s = 1; s <= n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out.map((p) => idx.frame.toLngLat(p));
}

export interface PlannedOps { readonly ops: { type: string; payload: unknown }[]; readonly error?: string }

/**
 * Turns a drawn axis into operations: endpoints snapped to a node reuse it,
 * endpoints on a road split that road, free endpoints create nodes.
 */
export function planRoad(idx: NetworkIndex, points: readonly SnapResult[], axisLL: readonly LngLat[], templateId: string, name: string): PlannedOps {
  const t = ROAD_TEMPLATES.find((x) => x.id === templateId) ?? ROAD_TEMPLATES[0]!;
  if (points.length < 2) return { ops: [], error: 'Servono almeno due punti' };
  const len = geom.lengthOf(axisLL.map((p) => idx.frame.toMetric(p) as geom.V));
  if (len < 3) return { ops: [], error: 'Strada troppo corta (minimo 3 m)' };
  const ops: { type: string; payload: unknown }[] = [];
  const newNodes: RoadNode[] = [];
  // Track splits so that a second split on the same road targets the right piece.
  const pieces = new Map<string, { id: string; from: number; to: number }[]>();
  const endpoint = (s: SnapResult): string => {
    if (s.kind === 'node' && s.nodeId) return s.nodeId;
    if ((s.kind === 'edge' || s.kind === 'midpoint') && s.roadId && s.along !== undefined) {
      const list = pieces.get(s.roadId) ?? [{ id: s.roadId, from: 0, to: Infinity }];
      const piece = list.find((p) => s.along! >= p.from && s.along! < p.to)!;
      const nodeId = newId('n');
      const a = newId('r'), b = newId('r');
      ops.push({ type: 'road.split', payload: { roadId: piece.id, at: s.at, nodeId, newRoadIds: [a, b] } });
      const i = list.indexOf(piece);
      list.splice(i, 1, { id: a, from: piece.from, to: s.along! }, { id: b, from: s.along!, to: piece.to });
      pieces.set(s.roadId, list);
      return nodeId;
    }
    const id = newId('n');
    newNodes.push({ id, at: s.at });
    return id;
  };
  const first = points[0]!, last = points[points.length - 1]!;
  const from = endpoint(first);
  const to = endpoint(last);
  if (from === to) return { ops: [], error: 'Inizio e fine coincidono' };
  const axisM = axisLL.map((p) => idx.frame.toMetric(p) as geom.V);
  axisM[0] = idx.frame.toMetric(first.at) as geom.V;
  axisM[axisM.length - 1] = idx.frame.toMetric(last.at) as geom.V;
  const L = geom.lengthOf(axisM);
  // Every crossing with an existing road becomes a real junction: both roads are split there.
  const skip = new Set([first.roadId, last.roadId].filter(Boolean) as string[]);
  const cuts = idx.crossings(axisM, (id) => {
    const r = idx.net.roads[id];
    return Boolean(r) && !skip.has(id) && !r!.tags?.roundabout && !isPedestrianRoad(r!);
  }).filter((c) => c.s > 2 && c.s < L - 2);
  const stops: { s: number; node: string }[] = [{ s: 0, node: from }];
  for (const c of cuts) {
    if (c.s - stops[stops.length - 1]!.s < 2) continue;
    const node = endpoint({ at: idx.frame.toLngLat(c.at), kind: 'edge', roadId: c.roadId, along: c.along });
    stops.push({ s: c.s, node });
  }
  stops.push({ s: L, node: to });
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    const piece = geom.slice(axisM, a.s, b.s).map((p) => idx.frame.toLngLat(p));
    if (piece.length < 2) continue;
    const id = newId('r');
    const road = roadFromTemplate(t, id, a.node, b.node, piece, name.trim() || t.label);
    ops.push({ type: 'road.add', payload: { road, nodes: newNodes.filter((n) => n.id === a.node || n.id === b.node) } });
  }
  return { ops };
}
