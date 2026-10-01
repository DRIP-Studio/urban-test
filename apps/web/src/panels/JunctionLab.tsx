import { useEffect, useMemo, useState } from 'react';
import { LocalFrame, geom, type JunctionAnalysis, type JunctionControl, type JunctionSpec, type SignalPlan } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { fc, type Feature } from '../engine/geojson';
import { setSource, toggleLayer } from '../map/mapStore';
import { commit, setDock, useApp } from '../state/store';
import { Button, Empty, Field, NumberField, Segmented, Select, Skeleton, Stat, Toggle } from '../ui/controls';

export const SWEPT_VEHICLES = [
  { id: 'car', label: 'Auto', width: 1.8, wheelbase: 2.7, front: 0.9 },
  { id: 'van', label: 'Furgone', width: 2.0, wheelbase: 3.6, front: 1.0 },
  { id: 'bus10', label: 'Autobus 10 m', width: 2.55, wheelbase: 5.0, front: 2.6 },
  { id: 'bus12', label: 'Autobus 12 m', width: 2.55, wheelbase: 6.0, front: 2.7 },
  { id: 'bus18', label: 'Autobus snodato 18 m', width: 2.55, wheelbase: 5.9, front: 2.7 },
  { id: 'truck', label: 'Autocarro 10 m', width: 2.5, wheelbase: 5.5, front: 1.4 },
  { id: 'semi', label: 'Autoarticolato 16,5 m', width: 2.55, wheelbase: 7.7, front: 1.4 },
  { id: 'emergency', label: 'Autopompa VVF', width: 2.5, wheelbase: 4.4, front: 1.5 },
] as const;

export interface JunctionResult { analysis: JunctionAnalysis; suggested: SignalPlan }

/** Shared loader: Junction Lab and Signal Studio analyse the selected node through the worker. */
export function useJunctionAnalysis(): { nodeId: string | null; data: JunctionResult | null; loading: boolean; error: string | null } {
  const sel = useApp((s) => s.selection);
  const netVersion = useApp((s) => s.netVersion);
  const nodeId = sel?.kind === 'node' ? sel.ids[0]! : null;
  const [state, setState] = useState<{ data: JunctionResult | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!nodeId) { setState({ data: null, loading: false, error: null }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    // The worker builds asynchronously: give it the latest ops first.
    engine.job<JunctionResult | null>('junction', { nodeId })
      .then((data) => { if (live) setState({ data, loading: false, error: data ? null : 'Questo nodo non è un incrocio veicolare (servono almeno 3 bracci).' }); })
      .catch((e) => { if (live) setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [nodeId, netVersion]);
  return { nodeId, ...state };
}

export function drawJunction(a: JunctionAnalysis | null, highlightGroup?: string | null): void {
  if (!a) { setSource('moves', null); setSource('conflicts', null); return; }
  setSource('moves', fc(a.movements.map((m): Feature => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: m.path.map((p) => [...p]) }, properties: { id: m.id, turn: m.turn, dim: highlightGroup ? m.groupId !== highlightGroup : false } }))));
  setSource('conflicts', fc(a.conflicts.map((c): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...c.at] }, properties: { id: c.id, kind: c.kind, severity: c.severity } }))));
}

function sweptEnvelope(path: readonly [number, number][], origin: [number, number], v: (typeof SWEPT_VEHICLES)[number]): { ring: number[][]; minRadius: number; widthM: number } {
  const f = new LocalFrame(origin);
  const m = path.map((p) => f.toMetric(p) as geom.V);
  let minR = Infinity;
  for (let i = 1; i < m.length - 1; i++) {
    const a = m[i - 1]!, b = m[i]!, c = m[i + 1]!;
    const ab = geom.dist(a, b), bc = geom.dist(b, c), ca = geom.dist(c, a);
    const area2 = Math.abs(geom.cross(geom.sub(b, a), geom.sub(c, a)));
    if (area2 > 1e-6) minR = Math.min(minR, (ab * bc * ca) / (2 * area2));
  }
  const R = Number.isFinite(minR) ? minR : 1e6;
  const offtrack = R > v.wheelbase ? R - Math.sqrt(R * R - v.wheelbase * v.wheelbase) : v.wheelbase;
  const frontSwing = Math.sqrt((R + v.width / 2) ** 2 + (v.wheelbase + v.front) ** 2) - (R + v.width / 2);
  // Turning direction decides which side gets the inner off-tracking.
  const turn = Math.sign(geom.cross(geom.sub(m[Math.floor(m.length / 2)]!, m[0]!), geom.sub(m[m.length - 1]!, m[0]!)));
  const left = v.width / 2 + (turn < 0 ? offtrack : frontSwing), right = -(v.width / 2 + (turn < 0 ? frontSwing : offtrack));
  const ring = geom.band(m, left, right).map((p) => { const ll = f.toLngLat(p); return [ll[0], ll[1]]; });
  return { ring: [...ring, ring[0]!], minRadius: R, widthM: left - right };
}

export function JunctionLab() {
  const { nodeId, data, loading, error } = useJunctionAnalysis();
  const net = useApp((s) => s.network);
  const baseline = useApp((s) => s.baseline);
  const [group, setGroup] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<string>('bus12');
  const [movement, setMovement] = useState<string | null>(null);
  useEffect(() => { toggleLayer('junction', true); }, []);
  useEffect(() => { drawJunction(data?.analysis ?? null, group); return () => drawJunction(null); }, [data, group]);
  const swept = useMemo(() => {
    const m = data?.analysis.movements.find((x) => x.id === movement);
    const v = SWEPT_VEHICLES.find((x) => x.id === vehicle)!;
    return m && baseline ? sweptEnvelope(m.path as [number, number][], baseline.origin as [number, number], v) : null;
  }, [data, movement, vehicle, baseline]);
  useEffect(() => {
    setSource('draft', swept ? fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [swept.ring] }, properties: {} }]) : null);
    return () => setSource('draft', null);
  }, [swept]);
  if (!nodeId) return <Empty icon="junction" title="Seleziona un incrocio">Usa lo strumento Junction Lab (J) e clicca su un incrocio della città o del progetto.</Empty>;
  if (loading && !data) return <Skeleton lines={5} />;
  if (error || !data || !net) return <Empty icon="warning" title="Analisi non disponibile">{error}</Empty>;
  const a = data.analysis;
  const spec: JunctionSpec = net.junctions[nodeId] ?? { nodeId, control: 'uncontrolled', cornerRadiusM: 4, minorRoadIds: [], crossingRoadIds: [] };
  const setSpec = (p: Partial<JunctionSpec>) => commit('junction.set', { spec: { ...spec, ...p } });
  const by = (k: string) => a.conflicts.filter((c) => c.kind === k).length;
  const plan = Object.values(net.signalPlans).find((p) => p.nodeId === nodeId);
  return (
    <div className="junction-lab">
      <div className="jl-col">
        <h3>Incrocio</h3>
        <div className="stats-row">
          <Stat label="Bracci" value={a.arms.length} /><Stat label="Movimenti" value={a.movements.length} /><Stat label="Gruppi corsia" value={a.groups.length} />
        </div>
        <div className="stats-row">
          <Stat label="Attraversamento" value={by('crossing')} /><Stat label="Immissione" value={by('merge')} /><Stat label="Diversione" value={by('diverge')} />
        </div>
        <Field label="Regolazione">
          <Segmented<JunctionControl> label="Regolazione" value={plan ? 'signal' : spec.control} onChange={(v) => { if (v === 'signal') setDock('signals'); else setSpec({ control: v }); }}
            options={[{ value: 'uncontrolled', label: 'Libera' }, { value: 'priority', label: 'Precedenza' }, { value: 'stop', label: 'Stop' }, { value: 'signal', label: 'Semaforo' }]} />
        </Field>
        <Field label="Raggio dei cordoli"><NumberField value={spec.cornerRadiusM} unit="m" min={0} max={25} step={0.5} ariaLabel="Raggio cordoli" onCommit={(v) => setSpec({ cornerRadiusM: v })} /></Field>
      </div>
      <div className="jl-col">
        <h3>Bracci</h3>
        <table className="table">
          <thead><tr><th>Strada</th><th>Entrata</th><th>Uscita</th><th>Secondaria</th><th>Attravers.</th></tr></thead>
          <tbody>
            {a.arms.map((arm) => (
              <tr key={arm.roadId}>
                <td>{arm.name}</td><td className="mono">{arm.inbound}</td><td className="mono">{arm.outbound}</td>
                <td><Toggle compact label={`${arm.name}: strada secondaria`} checked={spec.minorRoadIds.includes(arm.roadId)} onChange={(v) => setSpec({ minorRoadIds: v ? [...spec.minorRoadIds, arm.roadId] : spec.minorRoadIds.filter((x) => x !== arm.roadId) })} /></td>
                <td><Toggle compact label={`${arm.name}: attraversamento pedonale`} checked={spec.crossingRoadIds.includes(arm.roadId)} onChange={(v) => setSpec({ crossingRoadIds: v ? [...spec.crossingRoadIds, arm.roadId] : spec.crossingRoadIds.filter((x) => x !== arm.roadId) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Linee di arresto e di dare precedenza vengono disegnate solo con una regolazione esplicita.</p>
      </div>
      <div className="jl-col">
        <h3>Gruppi di corsie e movimenti</h3>
        <ul className="group-list">
          {a.groups.map((g) => (
            <li key={g.id}>
              <button type="button" className={`group-row ${group === g.id ? 'is-on' : ''}`} onClick={() => setGroup(group === g.id ? null : g.id)}>
                <span className="mono">{g.id}</span><span>{g.label}</span><span className="hint">{g.laneIds.length} corsie</span>
              </button>
              {group === g.id ? a.movements.filter((m) => m.groupId === g.id).map((m) => (
                <div key={m.id} className="move-row">
                  <button type="button" className={`link ${movement === m.id ? 'is-on' : ''}`} onClick={() => setMovement(movement === m.id ? null : m.id)}>→ {net.roads[m.toRoadId]?.name || m.toRoadId} ({m.turn === 'left' ? 'sinistra' : m.turn === 'right' ? 'destra' : 'dritto'})</button>
                  <Toggle compact label="Movimento consentito" checked onChange={() => setSpec({ laneConnections: { ...(spec.laneConnections ?? {}), [m.id]: false } })} />
                </div>
              )) : null}
            </li>
          ))}
        </ul>
        {spec.laneConnections && Object.values(spec.laneConnections).some((v) => !v) ? (
          <Button size="sm" variant="ghost" onClick={() => setSpec({ laneConnections: {} })}>Ripristina connessioni automatiche ({Object.values(spec.laneConnections).filter((v) => !v).length} bloccate)</Button>
        ) : null}
      </div>
      <div className="jl-col">
        <h3>Swept path</h3>
        <Field label="Veicolo"><Select value={vehicle} ariaLabel="Veicolo" options={SWEPT_VEHICLES.map((v) => ({ value: v.id, label: v.label }))} onChange={setVehicle} /></Field>
        {swept ? (
          <div className="stats-row"><Stat label="Raggio minimo" value={swept.minRadius > 1000 ? '∞' : swept.minRadius.toFixed(1).replace('.', ',')} unit="m" /><Stat label="Ingombro" value={swept.widthM.toFixed(2).replace('.', ',')} unit="m" /></div>
        ) : <p className="muted">Apri un gruppo e scegli un movimento per vedere l'ingombro del veicolo in curva sulla mappa.</p>}
        <p className="muted">Modello geometrico a bicicletta (offtracking R − √(R² − passo²)); verifica preliminare, non sostituisce una simulazione cinematica certificata.</p>
      </div>
    </div>
  );
}
