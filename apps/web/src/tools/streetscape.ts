import { LocalFrame, geom, humpLimits, layoutSection, type LngLat, type Marking, type RoadFeature, type RoadFeatureKind } from '@drip-urban/core';
import { commit, newId, select, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { makeDrawTool } from './draw';
import { objectSnap } from './snap';
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

const POLY = new Set(['hatch', 'chevrons', 'box_junction', 'island']);
const POINT = new Set(['text', 'symbol', 'arrow', 'give_way_triangle', 'speed_number']);

/** Lines and areas: click the vertices, Enter; text/symbols/arrows: click the position, then the direction of travel. */
export const markingDraw = makeDrawTool({
  shape: 'line', minPoints: 2,
  finish: (points) => saveMarking(points),
});

function saveMarking(points: readonly { at: LngLat }[]): boolean {
    const t = useTool.getState();
    if (POLY.has(t.markingKind) && points.length < 3) { toast.info('Area incompleta', 'Servono almeno 3 vertici'); return false; }
    if (t.markingKind === 'bollards') return placeBollards(points.map((p) => p.at));
    const kind = t.markingKind;
    const geometry = POINT.has(t.markingKind) ? [points[0]!.at, points[1]!.at] : points.map((p) => p.at);
    const marking: Marking = {
      id: newId('mk'), kind, geometry, color: kind === 'box_junction' || kind === 'line_yellow' || kind === 'bus_lane' ? 'yellow' : t.markingColor, state: 'project', provenance: PROJECT,
      ...(kind === 'text' || kind === 'speed_number' ? { text: t.markingText.toUpperCase().slice(0, 12) } : {}),
      ...(t.markingKind === 'symbol' ? { symbol: t.markingSymbol } : {}),
      ...(t.markingKind === 'arrow' ? { symbol: t.markingArrow } : {}),
      ...(kind === 'parking_bays' ? { bays: { layout: t.bayLayout, lengthM: t.bayPurpose === 'motorcycle' ? 2 : 5, widthM: t.bayPurpose === 'disabled' ? 3.2 : t.bayPurpose === 'motorcycle' ? 1 : t.bayLayout === 'parallel' ? 2 : 2.5, side: 'right' as const, purpose: t.bayPurpose } } : {}),
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
    // Centre on the clicked lane (object snap); otherwise exactly where clicked.
    const lane = objectSnap(e) ? layoutSection(road).elements.find((x) => x.el.kind === 'lane' && x.right <= off && off <= x.left) : undefined;
    const c = lane ? (lane.left + lane.right) / 2 : off;
    const at: geom.V = [near.at[0] - tan[1] * c, near.at[1] + tan[0] * c];
    saveMarking([{ at: idx.frame.toLngLat(at) }, { at: idx.frame.toLngLat([at[0] + tan[0] * sign, at[1] + tan[1] * sign]) }]);
  },
};

/** Dissuasori di sosta: a bollard every 1,5 m along the drawn kerb line (art. 180 Reg.). */
function placeBollards(line: readonly LngLat[]): boolean {
  const b = useApp.getState().baseline;
  if (!b) return false;
  const f = new LocalFrame(b.origin);
  const m = line.map((p) => f.toMetric(p) as geom.V);
  const L = geom.lengthOf(m);
  const n = Math.max(1, Math.floor(L / 1.5));
  const assets = Array.from({ length: n + 1 }, (_, i) => {
    const { p, t } = geom.sampleAt(m, (L * i) / n);
    return { id: newId('a'), type: 'furniture.bollard', at: f.toLngLat(p), rotationDeg: (Math.atan2(t[0], t[1]) * 180) / Math.PI, state: 'project' as const, properties: {}, provenance: PROJECT };
  });
  const ok = commit('asset.add', { assets }).ok;
  if (ok) { select({ kind: 'asset', ids: assets.map((a) => a.id) }); toast.success('Dissuasori posati', `${assets.length} paletti su ${L.toFixed(0)} m`); }
  return ok;
}
