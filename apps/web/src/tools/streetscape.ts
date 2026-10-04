import { geom, humpLimits, layoutSection, type LngLat, type Marking, type RoadFeature, type RoadFeatureKind } from '@drip-urban/core';
import { commit, newId, select, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { makeDrawTool } from './draw';
import { useTool } from './toolState';
import type { ToolHandler } from './types';

const PROJECT = { kind: 'project' as const, source: 'DRIP Urban scenario' };

/** Sizes after art. 179 Reg. CdS (dossi) and common practice for platforms and raised crossings. */
export const CALMING: Record<RoadFeatureKind, { label: string; lengthM: number; rampM: number; heightCm: number; hint: string }> = {
  speed_hump: { label: 'Dosso artificiale', lengthM: 0.6, rampM: 0.6, heightCm: 5, hint: 'art. 179 Reg. CdS: limite ≤ 50 km/h; h ≤ 3/5/7 cm per 50/40/30 km/h; zebratura gialla e nera' },
  speed_table: { label: 'Piattaforma rialzata', lengthM: 6, rampM: 1.5, heightCm: 10, hint: 'Rallentatore a piattaforma, rampe con «denti di squalo»' },
  raised_crossing: { label: 'Attraversamento pedonale rialzato', lengthM: 4, rampM: 1.2, heightCm: 10, hint: 'Piano dell\'attraversamento alla quota del marciapiede, zebre e rampe segnalate' },
  speed_cushion: { label: 'Cuscino berlinese', lengthM: 2.5, rampM: 0.6, heightCm: 7, hint: 'Un cuscino per corsia, larghezza 1,80 m: i bus lo scavalcano' },
  rumble_strips: { label: 'Bande rumorose / ottiche', lengthM: 5, rampM: 0, heightCm: 1, hint: 'Bande trasversali di preavviso (art. 179 c. 2 Reg.)' },
  raised_junction: { label: 'Incrocio rialzato', lengthM: 0, rampM: 2, heightCm: 10, hint: 'Clic su un incrocio: tutta l\'area di intersezione alla quota dei marciapiedi' },
};

/** Click on a road (or a junction for raised_junction) to place the chosen element. */
export const calmingTool: ToolHandler = {
  click(e, ctx) {
    const idx = ctx.index();
    const { network } = useApp.getState();
    if (!idx || !network) return;
    const t = useTool.getState();
    const spec = CALMING[t.calmingKind];
    const p = idx.frame.toMetric(e.lngLat) as geom.V;
    let feature: RoadFeature;
    if (t.calmingKind === 'raised_junction') {
      let best: { id: string; d: number } | null = null;
      for (const n of Object.values(network.nodes)) { const q = idx.frame.toMetric(n.at); const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < 25 && (!best || d < best.d)) best = { id: n.id, d }; }
      if (!best) { toast.info('Nessun incrocio', 'Clicca al centro di un incrocio.'); return; }
      feature = { id: newId('f'), kind: 'raised_junction', nodeId: best.id, lengthM: 0, rampM: spec.rampM, heightM: t.calmingHeightCm / 100, state: 'project', properties: {}, provenance: PROJECT };
    } else {
      const r = idx.nearestRoad(p, 12, true);
      if (!r) { toast.info('Nessuna strada', 'Clicca sulla carreggiata.'); return; }
      const road = network.roads[r.id]!;
      let h = t.calmingHeightCm / 100;
      if (t.calmingKind === 'speed_hump' || t.calmingKind === 'speed_cushion') {
        const lim = humpLimits(road.speedKmh);
        if (!lim) { toast.warn('Dosso non ammesso', `«${road.name || 'strada'}» ha limite ${road.speedKmh} km/h: l'art. 179 Reg. CdS ammette i dossi solo fino a 50 km/h. Abbassa il limite (Inspector) o usa bande rumorose.`); return; }
        h = Math.min(h, lim.maxHeightM);
      }
      feature = { id: newId('f'), kind: t.calmingKind, roadId: r.id, station: Math.round(r.along * 10) / 10, lengthM: spec.lengthM, rampM: spec.rampM, heightM: h, state: 'project', properties: {}, provenance: PROJECT };
    }
    if (commit('feature.set', { feature }).ok) select({ kind: 'feature', ids: [feature.id] });
  },
};

const POLY = new Set(['hatch', 'chevrons', 'box_junction']);
const POINT = new Set(['text', 'symbol', 'arrow', 'give_way_triangle']);

/** Lines and areas: click the vertices, Enter; text/symbols/arrows: click the position, then the direction of travel. */
export const markingDraw = makeDrawTool({
  shape: 'line', minPoints: 2,
  finish: (points) => saveMarking(points),
});

function saveMarking(points: readonly { at: LngLat }[]): boolean {
    const t = useTool.getState();
    if (POLY.has(t.markingKind) && points.length < 3) { toast.info('Area incompleta', 'Servono almeno 3 vertici'); return false; }
    const geometry = POINT.has(t.markingKind) ? [points[0]!.at, points[1]!.at] : points.map((p) => p.at);
    const marking: Marking = {
      id: newId('mk'), kind: t.markingKind, geometry, color: t.markingKind === 'box_junction' || t.markingKind === 'line_yellow' ? 'yellow' : t.markingColor, state: 'project', provenance: PROJECT,
      ...(t.markingKind === 'text' ? { text: t.markingText.toUpperCase().slice(0, 12) } : {}),
      ...(t.markingKind === 'symbol' ? { symbol: t.markingSymbol } : {}),
      ...(t.markingKind === 'arrow' ? { symbol: t.markingArrow } : {}),
      ...(t.markingKind === 'parking_bays' ? { bays: { layout: t.bayLayout, lengthM: 5, widthM: t.bayLayout === 'parallel' ? 2 : 2.5, side: 'right' as const } } : {}),
    };
    const ok = commit('marking.set', { marking }).ok;
    if (ok) select({ kind: 'marking', ids: [marking.id] });
    return ok;
}

/**
 * Text, symbols, arrows and give-way triangles: one click on the carriageway, oriented on the lane's
 * direction of travel (right-hand traffic; one-way roads follow their direction). Away from roads it
 * falls back to two clicks (position, then direction).
 */
export const markingTool: ToolHandler = {
  ...markingDraw,
  click(e, ctx) {
    const t = useTool.getState();
    const idx = ctx.index();
    const net = useApp.getState().network;
    if (!POINT.has(t.markingKind) || t.draft.length || !idx || !net) return markingDraw.click?.(e, ctx);
    const p = idx.frame.toMetric(e.lngLat) as geom.V;
    const near = idx.nearestRoad(p, 15, true);
    if (!near) return markingDraw.click?.(e, ctx);
    const road = net.roads[near.id]!;
    const { t: tan } = geom.sampleAt(road.axis.map((q) => idx.frame.toMetric(q) as geom.V), near.along);
    const off = tan[0] * (p[1] - near.at[1]) - tan[1] * (p[0] - near.at[0]);
    const sign = road.oneway === 'forward' ? 1 : road.oneway === 'backward' ? -1 : off > 0 ? -1 : 1;
    // Centre on the clicked lane.
    const lane = layoutSection(road).elements.find((x) => x.el.kind === 'lane' && x.right <= off && off <= x.left);
    const c = lane ? (lane.left + lane.right) / 2 : off;
    const at: geom.V = [near.at[0] - tan[1] * c, near.at[1] + tan[0] * c];
    saveMarking([{ at: idx.frame.toLngLat(at) }, { at: idx.frame.toLngLat([at[0] + tan[0] * sign, at[1] + tan[1] * sign]) }]);
  },
};
