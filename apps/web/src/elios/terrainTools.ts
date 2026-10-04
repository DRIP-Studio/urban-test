import { checkVertical, earthworks, groundProfile, proposeVertical, stationing, verticalRules } from '@drip-urban/core';
import { commit, openDock, select, useApp } from '../state/store';
import { fetchTerrain, loadTerrain, useTerrain } from '../state/terrain';
import { registerEliosTools, resolveRoads } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
const ROAD = { roadName: { type: 'STRING', description: 'Nome della strada (predefinito: strada selezionata)' }, roadIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Id strade' } };

async function grid() {
  const g = useTerrain.getState().grid ?? (await loadTerrain());
  if (!g) throw new Error('Manca il modello del terreno: usa load_terrain (Copernicus) o carica un DTM .asc dal pannello Profilo');
  return g;
}

registerEliosTools([
  {
    name: 'load_terrain', kind: 'write', label: 'Modello del terreno scaricato',
    description: "Scarica il modello digitale del terreno (Copernicus DEM GLO-90) per l'area del progetto: serve per profili longitudinali, livellette e movimenti terra.",
    parameters: OBJ({ spacingM: { type: 'NUMBER', description: 'Passo della griglia in metri (predefinito 60)' } }),
    async run(a) {
      const g = await fetchTerrain(Number(a.spacingM) || 60);
      if (!g) throw new Error('Apri un progetto');
      return { nx: g.nx, ny: g.ny, resolutionM: g.resolutionM, minM: Math.min(...g.z), maxM: Math.max(...g.z), source: g.source };
    },
  },
  {
    name: 'road_profile_report', kind: 'read', label: 'Analizzato il profilo altimetrico',
    description: 'Profilo altimetrico di una strada: quote del terreno, pendenze, verifiche DM 5/11/2001 e movimenti terra del profilo di progetto (se presente).',
    parameters: OBJ(ROAD),
    async run(a) {
      const g = await grid();
      const { baseline } = useApp.getState();
      return resolveRoads(a).slice(0, 5).map((road) => {
        const L = stationing(road, baseline!.origin).length;
        const gp = groundProfile(road, g, baseline!.origin, 10).filter((q) => Number.isFinite(q.z));
        const rules = verticalRules(road);
        const v = road.vertical;
        return {
          road: road.name || road.id, lengthM: Math.round(L), groundMinM: Math.min(...gp.map((q) => q.z)), groundMaxM: Math.max(...gp.map((q) => q.z)),
          groundMeanGradePct: gp.length > 1 ? Math.round(((gp[gp.length - 1]!.z - gp[0]!.z) / L) * 1000) / 10 : 0, rules,
          design: v ? { pvis: v.pvis, issues: checkVertical(road, v, L).map((i) => i.message), earthworks: (({ cutM3, fillM3 }) => ({ cutM3, fillM3 }))(earthworks(road, v, g, baseline!.origin, 10)) } : null,
        };
      });
    },
  },
  {
    name: 'design_road_profile', kind: 'write', label: 'Profilo longitudinale progettato',
    description: 'Progetta e applica il profilo longitudinale (livellette e raccordi verticali) di una o più strade seguendo il terreno entro i limiti del DM 5/11/2001, raccordandosi ai profili delle strade vicine; apre il pannello Profilo.',
    parameters: OBJ({ ...ROAD, toleranceM: { type: 'NUMBER', description: 'Scostamento massimo dal terreno nella semplificazione (predefinito 0,35 m)' } }),
    async run(a) {
      const g = await grid();
      const roads = resolveRoads(a).slice(0, 30);
      const out = [];
      for (const road of roads) {
        const { network, baseline } = useApp.getState();
        const v = proposeVertical(network!, network!.roads[road.id]!, g, baseline!.origin, { tolM: Number(a.toleranceM) || undefined });
        const r = commit('road.setVertical', { roadId: road.id, vertical: v });
        const ew = earthworks(network!.roads[road.id]!, v, g, baseline!.origin, 10);
        out.push({ road: road.name || road.id, applied: r.ok, pvis: v.pvis.length, cutM3: ew.cutM3, fillM3: ew.fillM3 });
      }
      if (roads.length) { select({ kind: 'road', ids: roads.map((r) => r.id) }); openDock('profile'); }
      return out;
    },
  },
]);
