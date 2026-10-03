import { LocalFrame, geom } from '@drip-urban/core';
import { usePicks } from '../tools/picks';
import { MODES, lineMetrics, proposeBikeStations, type TransitMode } from '../transit/model';
import { newId, setMode, useApp } from '../state/store';
import { registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
const sid = () => useApp.getState().scenario?.id ?? 'baseline';
const waitFor = async (pred: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150)); };

registerEliosTools([
  {
    name: 'create_transit_line', kind: 'write', label: 'Linea TPL creata',
    description: 'Crea una linea di trasporto pubblico (bus, brt, trolleybus, tram, metro, train, funicular, ferry, on_demand) passante per i punti indicati; bus/BRT/tram seguono le strade. Opzionale: frequenza di punta e fermate automatiche.',
    parameters: OBJ({
      mode: { type: 'STRING', enum: Object.keys(MODES), description: 'Modo' }, name: { type: 'STRING', description: 'Nome linea' },
      points: { type: 'ARRAY', description: 'Punti [lon, lat] del percorso, in ordine', items: { type: 'ARRAY', items: { type: 'NUMBER' }, description: '[lon, lat]' } },
      peakHeadwayMin: { type: 'NUMBER', description: 'Minuti tra le corse in punta' }, autoStops: { type: 'BOOLEAN', description: 'Fermate automatiche alla distanza tipica del modo' },
    }, ['mode', 'points']),
    async run(a) {
      const pts = (a.points as [number, number][]).map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
      if (pts.length < 2) throw new Error('Servono almeno due punti');
      const before = new Set((usePicks.getState().transit.design?.[sid()] ?? []).map((r) => r.id));
      usePicks.setState({ newLineMode: a.mode as TransitMode });
      setMode('transit');
      usePicks.getState().addTransitRoute(pts);
      await waitFor(() => (usePicks.getState().transit.design?.[sid()] ?? []).some((r) => !before.has(r.id)));
      const st = usePicks.getState();
      const list = st.transit.design?.[sid()] ?? [];
      const line = list.find((r) => !before.has(r.id));
      if (!line) throw new Error('Linea non creata');
      const b = useApp.getState().baseline!;
      const f = new LocalFrame(b.origin);
      let next = { ...line, ...(a.name ? { name: String(a.name) } : {}) };
      if (a.peakHeadwayMin) next = { ...next, headways: { ...next.headways, peak: Number(a.peakHeadwayMin) } };
      if (a.autoStops) {
        const axis = next.line.map((p) => f.toMetric(p) as geom.V);
        const L = geom.lengthOf(axis), n = Math.max(1, Math.round(L / MODES[next.mode].stopSpacingM));
        next = { ...next, stops: Array.from({ length: n + 1 }, (_, i) => ({ id: newId('st'), name: `Fermata ${i + 1}`, at: f.toLngLat(geom.sampleAt(axis, (L * i) / n).p) })) };
      }
      await st.saveTransit({ ...st.transit, design: { ...(st.transit.design ?? {}), [sid()]: list.map((r) => (r.id === line.id ? next : r)) } });
      const m = lineMetrics(next, b);
      return { lineId: next.id, lengthKm: Math.round(m.lengthKm * 100) / 100, stops: next.stops.length, fleet: m.fleet, boardingsDayEstimate: m.boardingsDay, costYearEur: m.costYear };
    },
  },
  {
    name: 'propose_bike_sharing', kind: 'write', label: 'Stazioni bike sharing proposte',
    description: 'Propone stazioni di bike sharing (circa ogni 400 m) dove i residenti stimati sono più densi.',
    parameters: OBJ({ spacingM: { type: 'NUMBER', description: 'Passo della griglia (predefinito 400 m)' }, max: { type: 'NUMBER', description: 'Numero massimo di stazioni' } }),
    async run(a) {
      const b = useApp.getState().baseline!;
      const found = proposeBikeStations(b, b.bbox, Number(a.spacingM) || 400, Number(a.max) || 40);
      const st = usePicks.getState();
      const bs = st.transit.bikeshare?.[sid()] ?? { system: 'Bike sharing', stations: [], dockless: false };
      await st.saveTransit({ ...st.transit, bikeshare: { ...(st.transit.bikeshare ?? {}), [sid()]: { ...bs, stations: [...bs.stations, ...found.map((x, i) => ({ id: newId('bs'), name: `Stazione ${bs.stations.length + i + 1}`, at: x.at, docks: x.docks, ebikeShare: 0.4 }))] } } });
      setMode('transit');
      return { stations: found.length, docks: found.reduce((t, x) => t + x.docks, 0) };
    },
  },
]);
