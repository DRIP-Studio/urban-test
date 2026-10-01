import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_TRAFFIC, LocalFrame, NetworkReplayer, geom, layoutSection, operationSpec, type CityBaseline, type Network, type Operation } from '@drip-urban/core';
import { api } from '../api/client';
import type { StoredScenario } from '../api/types';
import { engine } from '../engine/engine';
import { selectScenario, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Field, NumberField, Section, Select, Stat } from '../ui/controls';

interface Metrics { roadsChanged: number; newRoadM: number; oneway: number; roundabouts: number; signals: number; zones: number; greenM2: number; parkingM2: number; trees: number; assets: number; areaM2: Record<string, number> }

export function scenarioMetrics(net: Network, baseline: CityBaseline, permeable: Set<string>): Metrics {
  const f = new LocalFrame(baseline.origin);
  const area = (pts: readonly (readonly [number, number])[]) => Math.abs(geom.ringArea(pts.map((p) => f.toMetric(p) as geom.V)));
  let roadsChanged = 0, newRoadM = 0, oneway = 0, parkingM2 = 0;
  for (const r of Object.values(net.roads)) {
    const proj = Object.values(r.provenance).some((p) => p.kind === 'project');
    if (proj) roadsChanged++;
    if (r.provenance.geometry?.kind === 'project' && !baseline.roads[r.id]) newRoadM += geom.lengthOf(r.axis.map((p) => f.toMetric(p) as geom.V));
    if (baseline.roads[r.id] && baseline.roads[r.id]!.oneway !== r.oneway) oneway++;
    const L = geom.lengthOf(r.axis.map((p) => f.toMetric(p) as geom.V));
    for (const e of layoutSection(r).elements) if (e.el.kind === 'parking') parkingM2 += e.el.widthM * L;
  }
  const areas = Object.values(net.areas).filter((a) => a.state !== 'removed' && a.kind !== 'crossing');
  const areaM2: Record<string, number> = {};
  for (const a of areas) areaM2[a.kind] = (areaM2[a.kind] ?? 0) + area(a.polygon);
  return {
    roadsChanged, newRoadM, oneway, roundabouts: Object.keys(net.roundabouts).length, signals: Object.keys(net.signalPlans).length, zones: Object.keys(net.zones).length,
    greenM2: areas.filter((a) => permeable.has(a.material)).reduce((s, a) => s + area(a.polygon), 0),
    parkingM2: parkingM2 + (areaM2.parking ?? 0),
    trees: Object.values(net.assets).filter((a) => a.type.startsWith('vegetation') && a.state !== 'removed').length,
    assets: Object.values(net.assets).filter((a) => a.state === 'project').length, areaM2,
  };
}

interface UnitCosts { roadM2: number; plazaM2: number; greenM2: number; tree: number; signalPlan: number; roundabout: number; source: string }
const EMPTY_COSTS: UnitCosts = { roadM2: 0, plazaM2: 0, greenM2: 0, tree: 0, signalPlan: 0, roundabout: 0, source: '' };

export function ComparePanel() {
  const project = useApp((s) => s.project);
  const baseline = useApp((s) => s.baseline);
  const catalogs = useApp((s) => s.catalogs);
  const current = useApp((s) => s.scenario);
  const [a, setA] = useState('baseline');
  const [b, setB] = useState(current?.id ?? 'baseline');
  const [ops, setOps] = useState<Record<string, Operation[]>>({});
  const [traffic, setTraffic] = useState<Record<string, { totals: { vehHours: number; avgSpeedKmh: number; overCapacity: number }; crossingConflicts: number }>>({});
  const [busy, setBusy] = useState(false);
  const [costs, setCosts] = useState<UnitCosts>(EMPTY_COSTS);
  const [pick, setPick] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!project) return;
    api.get<{ costs?: UnitCosts } | null>(`/api/projects/${project.id}/docs/settings`).then((d) => setCosts(d?.costs ?? EMPTY_COSTS)).catch(() => undefined);
  }, [project]);
  useEffect(() => {
    if (!project) return;
    for (const id of [a, b]) if (!ops[id]) api.get<StoredScenario>(`/api/projects/${project.id}/scenarios/${id}`).then((s) => setOps((o) => ({ ...o, [id]: [...s.operations] })));
  }, [a, b, project]); // eslint-disable-line react-hooks/exhaustive-deps
  const permeable = useMemo(() => new Set(catalogs?.materials.items.filter((m) => m.permeable).map((m) => m.id)), [catalogs]);
  const metrics = useMemo(() => {
    if (!baseline) return {};
    const out: Record<string, Metrics> = {};
    for (const id of [a, b]) if (ops[id]) out[id] = scenarioMetrics(new NetworkReplayer().derive(baseline, ops[id]!).net, baseline, permeable);
    return out;
  }, [a, b, ops, baseline, permeable]);
  if (!project || !baseline) return null;
  const opts = project.scenarios.map((s) => ({ value: s.id, label: s.name }));
  const ma = metrics[a], mb = metrics[b];
  const runTraffic = async () => {
    setBusy(true);
    try {
      for (const id of [a, b]) {
        const r = await engine.job<{ totals: { vehHours: number; avgSpeedKmh: number; overCapacity: number }; crossingConflicts: number }>('scenarioMetrics', { ops: ops[id] ?? [], params: DEFAULT_TRAFFIC });
        setTraffic((t) => ({ ...t, [id]: r }));
      }
    } catch (e) { toast.error('Confronto', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const cost = (m: Metrics | undefined) => (m ? m.newRoadM * 7 * costs.roadM2 + (m.areaM2.plaza ?? 0) * costs.plazaM2 + m.greenM2 * costs.greenM2 + m.trees * costs.tree + m.signals * costs.signalPlan + m.roundabouts * costs.roundabout : 0);
  const hasCosts = Object.entries(costs).some(([k, v]) => k !== 'source' && Number(v) > 0);
  const saveCosts = (c: UnitCosts) => { setCosts(c); void api.get<Record<string, unknown> | null>(`/api/projects/${project.id}/docs/settings`).then((d) => api.put(`/api/projects/${project.id}/docs/settings`, { ...(d ?? {}), costs: c })); };
  const Row = ({ label, k, unit, fmt = (v: number) => Math.round(v).toLocaleString('it-IT'), good = 'up' }: { label: string; k: keyof Metrics; unit?: string; fmt?: (v: number) => string; good?: 'up' | 'down' }) => {
    const va = ma ? (ma[k] as number) : 0, vb = mb ? (mb[k] as number) : 0;
    const dlt = vb - va;
    return <tr><td>{label}</td><td className="mono">{ma ? fmt(va) : '…'}{unit}</td><td className="mono">{mb ? fmt(vb) : '…'}{unit}</td><td className={`mono ${dlt === 0 ? '' : (dlt > 0) === (good === 'up') ? 'is-good' : 'is-bad'}`}>{dlt > 0 ? '+' : ''}{fmt(dlt)}</td></tr>;
  };
  const onlyInB = (ops[b] ?? []).filter((o) => !(ops[a] ?? []).some((x) => x.id === o.id));
  const scA = project.scenarios.find((s) => s.id === a);
  const merge = async () => {
    const chosen = onlyInB.filter((o) => pick.has(o.id));
    if (!chosen.length || !scA || scA.isBaseline || scA.locked) return;
    const full = await api.get<StoredScenario>(`/api/projects/${project.id}/scenarios/${a}`);
    try {
      await api.put(`/api/projects/${project.id}/scenarios/${a}`, { scenario: { operations: [...full.operations, ...chosen] }, baseRevision: full.revision });
      toast.success('Modifiche unite', `${chosen.length} operazioni copiate in ${scA.name}`);
      setOps((o) => ({ ...o, [a]: [...full.operations, ...chosen] }));
      setPick(new Set());
      if (current?.id === a) await selectScenario(a);
    } catch (e) { toast.error('Unione non riuscita', e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="panel-stack">
      <Section title="Confronta scenari">
        <div className="grid-2">
          <Field label="Scenario A"><Select value={a} ariaLabel="Scenario A" options={opts} onChange={setA} /></Field>
          <Field label="Scenario B"><Select value={b} ariaLabel="Scenario B" options={opts} onChange={setB} /></Field>
        </div>
        <table className="table compare">
          <thead><tr><th /><th>A</th><th>B</th><th>Δ</th></tr></thead>
          <tbody>
            <Row label="Strade modificate" k="roadsChanged" /><Row label="Nuove strade" k="newRoadM" unit=" m" />
            <Row label="Sensi di marcia cambiati" k="oneway" /><Row label="Rotatorie" k="roundabouts" /><Row label="Incroci semaforizzati" k="signals" />
            <Row label="Zone (ZTL, 30…)" k="zones" /><Row label="Superfici drenanti" k="greenM2" unit=" m²" /><Row label="Sosta (stima da sezione)" k="parkingM2" unit=" m²" good="down" />
            <Row label="Alberi" k="trees" /><Row label="Oggetti di progetto" k="assets" />
          </tbody>
        </table>
      </Section>
      <Section title="Traffico e sicurezza (stima)">
        <Button icon="play" busy={busy} onClick={() => void runTraffic()}>Calcola per A e B</Button>
        {traffic[a] && traffic[b] ? (
          <table className="table compare"><thead><tr><th /><th>A</th><th>B</th></tr></thead><tbody>
            <tr><td>Veicoli·ora (ora di punta)</td><td className="mono">{traffic[a]!.totals.vehHours}</td><td className="mono">{traffic[b]!.totals.vehHours}</td></tr>
            <tr><td>Velocità media</td><td className="mono">{traffic[a]!.totals.avgSpeedKmh} km/h</td><td className="mono">{traffic[b]!.totals.avgSpeedKmh} km/h</td></tr>
            <tr><td>Tratti oltre capacità</td><td className="mono">{traffic[a]!.totals.overCapacity}</td><td className="mono">{traffic[b]!.totals.overCapacity}</td></tr>
            <tr><td>Conflitti di attraversamento negli incroci</td><td className="mono">{traffic[a]!.crossingConflicts}</td><td className="mono">{traffic[b]!.crossingConflicts}</td></tr>
          </tbody></table>
        ) : <p className="muted">Stima DRIP con la stessa domanda per entrambi gli scenari (ore 8, giorno feriale).</p>}
      </Section>
      <Section title="Costi indicativi" defaultOpen={hasCosts}>
        {!hasCosts ? <p className="muted">Nessun costo mostrato finché non inserisci prezzi unitari con la loro fonte (prezzario regionale, computo, preventivo).</p> : null}
        <div className="grid-2">
          <Field label="Nuova strada (€/m²)"><NumberField value={costs.roadM2} min={0} max={10000} decimals={0} ariaLabel="Costo strada" onCommit={(v) => saveCosts({ ...costs, roadM2: v })} /></Field>
          <Field label="Piazza (€/m²)"><NumberField value={costs.plazaM2} min={0} max={10000} decimals={0} ariaLabel="Costo piazza" onCommit={(v) => saveCosts({ ...costs, plazaM2: v })} /></Field>
          <Field label="Verde drenante (€/m²)"><NumberField value={costs.greenM2} min={0} max={10000} decimals={0} ariaLabel="Costo verde" onCommit={(v) => saveCosts({ ...costs, greenM2: v })} /></Field>
          <Field label="Albero (€)"><NumberField value={costs.tree} min={0} max={100000} decimals={0} ariaLabel="Costo albero" onCommit={(v) => saveCosts({ ...costs, tree: v })} /></Field>
          <Field label="Impianto semaforico (€)"><NumberField value={costs.signalPlan} min={0} max={1000000} decimals={0} ariaLabel="Costo semaforo" onCommit={(v) => saveCosts({ ...costs, signalPlan: v })} /></Field>
          <Field label="Rotatoria (€)"><NumberField value={costs.roundabout} min={0} max={5000000} decimals={0} ariaLabel="Costo rotatoria" onCommit={(v) => saveCosts({ ...costs, roundabout: v })} /></Field>
        </div>
        <Field label="Fonte dei prezzi"><input className="text-field" value={costs.source} onChange={(e) => setCosts({ ...costs, source: e.target.value })} onBlur={() => saveCosts(costs)} placeholder="es. Prezzario Regione Campania 2025" /></Field>
        {hasCosts ? <div className="stats-row"><Stat label="Scenario A" value={`€ ${Math.round(cost(ma)).toLocaleString('it-IT')}`} /><Stat label="Scenario B" value={`€ ${Math.round(cost(mb)).toLocaleString('it-IT')}`} /></div> : null}
        {hasCosts ? <p className="muted">Stima parametrica: nuove strade su sezione media 7 m. Fonte: {costs.source || 'non indicata'}.</p> : null}
      </Section>
      <Section title={`Modifiche presenti solo in B (${onlyInB.length})`} defaultOpen={false}>
        {onlyInB.length ? (
          <>
            <ul className="check-list">{onlyInB.map((o) => (
              <li key={o.id}><label><input type="checkbox" checked={pick.has(o.id)} onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />{(() => { try { return operationSpec(o.type).label(o.payload); } catch { return o.type; } })()}</label></li>
            ))}</ul>
            <Button icon="import" disabled={!pick.size || !scA || scA.isBaseline || scA.locked} onClick={() => void merge()}>Copia le modifiche selezionate in A</Button>
            {scA?.isBaseline || scA?.locked ? <p className="muted">A non è modificabile (stato attuale o bloccato).</p> : null}
          </>
        ) : <p className="muted">Nessuna differenza da unire.</p>}
      </Section>
    </div>
  );
}
