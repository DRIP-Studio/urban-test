import type { MapGeoJSONFeature } from 'maplibre-gl';
import { commit, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { useTool } from './toolState';
import type { ToolHandler } from './types';

/**
 * Paving: click a surface to give it the chosen material.
 * Click = that surface · Shift+click = every sidewalk of the road · Alt+click = pick the material (eyedropper).
 * Road elements change through road.setSection, areas through area.set, roundabout islands through
 * roundabout.update; junction corners follow their sidewalk.
 */

const topSurface = (feats: MapGeoJSONFeature[]) => feats
  .filter((f) => f.layer.id === 'surfaces-fill')
  .sort((a, b) => Number(b.properties.z) - Number(a.properties.z))[0];

export const pavingTool: ToolHandler = {
  click(e, ctx) {
    const f = topSurface(ctx.map.queryRenderedFeatures([[e.point.x - 2, e.point.y - 2], [e.point.x + 2, e.point.y + 2]], { layers: ['surfaces-fill'] }));
    if (!f) { toast.info('Pavimentazione', 'Clicca su una superficie: marciapiede, carreggiata, piazza, isola.'); return; }
    const { network } = useApp.getState();
    if (!network) return;
    if (e.alt) {
      useTool.setState({ pavingMaterial: String(f.properties.material) });
      toast.info('Materiale prelevato', String(f.properties.material));
      return;
    }
    const material = useTool.getState().pavingMaterial;
    const fid = String(f.properties.id);
    if (f.properties.areaId) {
      const area = network.areas[String(f.properties.areaId)];
      if (area) commit('area.set', { area: { ...area, material } });
      return;
    }
    if (fid.startsWith('rb:') && f.properties.kind === 'roundabout_island') {
      const rb = network.roundabouts[fid.split(':')[1]!];
      if (rb) commit('roundabout.update', { roundabout: { ...rb, islandMaterial: material } });
      return;
    }
    if (f.properties.kind === 'corner') {
      toast.info('Angolo d\'incrocio', 'Gli angoli seguono il marciapiede: pavimenta il marciapiede della strada.');
      return;
    }
    const road = f.properties.roadId ? network.roads[String(f.properties.roadId)] : undefined;
    if (!road || !fid.startsWith('s:')) { toast.info('Pavimentazione', 'Questa superficie si modifica dal suo pannello.'); return; }
    const elId = fid.slice(2);
    const target = road.section.elements.find((x) => x.id === elId);
    if (!target) return;
    const hits = e.shift ? road.section.elements.filter((x) => x.kind === target.kind) : [target];
    const ids = new Set(hits.map((x) => x.id));
    if (hits.every((x) => x.material === material)) return;
    commit('road.setSection', {
      roadId: road.id, lanes: road.lanes,
      section: { ...road.section, elements: road.section.elements.map((x) => (ids.has(x.id) ? { ...x, material } : x)) },
    });
  },
};
