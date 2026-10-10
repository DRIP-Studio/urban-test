import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TRAFFIC, type CityBaseline, type LabResult, type LabSettings, type Operation } from '@drip-urban/core';
import { api } from '../api/client';
import type { StoredScenario } from '../api/types';
import { getProjectClock, useProjectClock } from '../state/projectTime';
import { flushSave, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Field, NumberField, Section, Select } from '../ui/controls';

interface LabRun { settings: LabSettings; results: Record<string, LabResult>; createdAt: string; scope: string }
const measures: { key: string; label: string; value: (r: LabResult) => number }[] = [
  {key:'tplCompleted',label:'TPL · corse completate',value:r=>(r.metrics.transit??[]).reduce((sum,t)=>sum+t.completed,0)},
  {key:'tplWaiting',label:'TPL · passeggeri in attesa',value:r=>(r.metrics.transit??[]).reduce((sum,t)=>sum+t.waiting,0)},
  { key: 'speed', label: 'Velocità media · km/h', value: (r) => r.meanSpeedKmh },
  { key: 'delay', label: 'Ritardo medio arrivi · s', value: (r) => r.metrics.avgDelayS },
  { key: 'travel', label: 'Tempo medio arrivi · s', value: (r) => r.metrics.avgTravelS },
  { key: 'queues', label: 'Picco veicoli in coda', value: (r) => r.peakQueuedVehicles },
  { key: 'completed', label: 'Viaggi completati', value: (r) => r.metrics.completed },
  { key: 'pending', label: 'Domanda non ancora inserita', value: (r) => r.metrics.waitingDemand ?? 0 },
  { key: 'co2', label: 'CO₂ stimata · kg', value: (r) => r.co2EstimateKg },
  { key: 'km', label: 'Percorrenza simulata · veicoli·km', value: (r) => r.vehicleKm },
  { key: 'congestion', label: 'Strade oltre capacità · stima', value: (r) => r.traffic.totals.overCapacity },
  { key: 'walk', label: 'Accessibilità pedonale · % rete residenziale', value: (r) => r.walkingCoverage },
  { key: 'bike', label: 'Accessibilità ciclabile · % rete residenziale', value: (r) => r.cyclingCoverage },
  { key: 'critical', label: 'Strade critiche per connettività', value: (r) => r.criticalRoads },
  { key: 'components', label: 'Componenti connesse della rete', value: (r) => r.components },
  { key: 'safety', label: 'Conflitti geometrici di attraversamento', value: (r) => r.crossingConflicts },
];

export function ScenarioLab() {
  const project = useApp((s) => s.project), baseline = useApp((s) => s.baseline);
  const { time } = useProjectClock();
  const [selected, setSelected] = useState<string[]>([]);
  const [dailyTrips, setDaily] = useState(DEFAULT_TRAFFIC.dailyTrips);
  const [mode, setMode] = useState<'microscopic' | 'hybrid'>('hybrid');
  const [co2, setCo2] = useState(160), [idleCo2, setIdleCo2] = useState(1);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [run, setRun] = useState<LabRun | null>(null);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    setSelected(project?.scenarios.filter((s) => !s.archived).map((s) => s.id) ?? []);
    setRun(null);
    return () => { generation.current++; worker.current?.terminate(); worker.current = null; };
  }, [project?.id]);
  if (!project || !baseline) return null;
  const names = new Map(project.scenarios.map((s) => [s.id, s.name]));
  const cancel = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setProgress('Confronto annullato'); };
  const start = async () => {
    const own = ++generation.current;
    setBusy(true); setProgress('Caricamento scenari e rete comunale…'); setRun(null);
    try {
      await flushSave();
      const fullBaseline = project.large ? await api.get<CityBaseline>(`/api/projects/${encodeURIComponent(project.id)}/baseline`) : baseline;
      const candidates = await Promise.all(selected.map(async (id) => {
        const current = useApp.getState().scenario;
        const operations: Operation[] = current?.id === id ? [...current.operations] : [...(await api.get<StoredScenario>(`/api/projects/${project.id}/scenarios/${id}`)).operations];
        return { id, operations };
      }));
      if (own !== generation.current) return;
      const settings: LabSettings = { clock: getProjectClock(), traffic: { ...DEFAULT_TRAFFIC, dailyTrips }, seed: 42, mode, co2GPerKm: co2, idleCo2GPerSecond: idleCo2 };
      const next: LabRun = { settings, results: {}, createdAt: new Date().toISOString(), scope: project.large ? 'Rete comunale completa' : 'Rete del progetto' };
      setRun(next);
      const w = new Worker(new URL('../engine/scenarioLab.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onmessage = (event: MessageEvent<{ type: string; id?: string; elapsedS?: number; result?: LabResult; message?: string }>) => {
        if (worker.current !== w) return;
        const m = event.data;
        if (m.type === 'progress') setProgress(`${names.get(m.id!) ?? m.id} · ${Math.round(m.elapsedS!)} / ${settings.clock.durationS} s`);
        if (m.type === 'result') setRun((r) => r && ({ ...r, results: { ...r.results, [m.id!]: m.result! } }));
        if (m.type === 'complete' || m.type === 'error') {
          w.terminate(); worker.current = null; setBusy(false);
          setProgress(m.type === 'complete' ? 'Confronto completato' : 'Confronto interrotto');
          if (m.type === 'error') toast.error('Scenario Lab', m.message ?? 'Errore nel confronto');
        }
      };
      w.onerror = (event) => { cancel(); toast.error('Scenario Lab', event.message); };
      w.postMessage({ type: 'run', baseline: fullBaseline, candidates, settings });
    } catch (e) { if (own !== generation.current) return; setBusy(false); toast.error('Scenario Lab', e instanceof Error ? e.message : String(e)); }
  };
  const exportRun = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...run, scenarioNames: Object.fromEntries(names) }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `scenario-lab-${project.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const results = Object.entries(run?.results ?? {});
  return <Section title="Scenario Lab · valutazione temporale">
    <p className="muted">{time.date} · {Math.floor(time.hour)}:{String(Math.floor(time.minutes % 60)).padStart(2, '0')} · durata e velocità dal clock globale. Ogni alternativa usa la stessa domanda, seed e data, anche quando ha un clock salvato diverso.</p>
    <div className="chips" role="group" aria-label="Scenari da valutare">{project.scenarios.filter((s) => !s.archived).map((s) => <label key={s.id} className="chip"><input type="checkbox" disabled={busy} checked={selected.includes(s.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id))} />{s.name}</label>)}</div>
    <div className="grid-2">
      <Field label="Domanda giornaliera"><NumberField value={dailyTrips} min={0} max={10000000} decimals={0} ariaLabel="Domanda Scenario Lab" onCommit={setDaily} /></Field>
      <Field label="Solver"><Select value={mode} ariaLabel="Solver Scenario Lab" options={[{ value: 'microscopic', label: 'Microscopico' }, { value: 'hybrid', label: 'Ibrido comunale' }]} onChange={(v) => setMode(v as typeof mode)} /></Field>
      <Field label="Ipotesi CO₂ in movimento"><NumberField value={co2} min={0} max={10000} unit="g/km" ariaLabel="Fattore CO2 movimento" onCommit={setCo2} /></Field>
      <Field label="Ipotesi CO₂ in coda"><NumberField value={idleCo2} min={0} max={100} decimals={2} unit="g/s" ariaLabel="Fattore CO2 coda" onCommit={setIdleCo2} /></Field>
    </div>
    <div className="row"><Button variant="primary" icon="play" disabled={busy || selected.length < 2} onClick={() => void start()}>Valuta gli scenari selezionati</Button>{busy ? <Button icon="stop" onClick={cancel}>Annulla confronto</Button> : null}{results.length ? <Button icon="export" onClick={exportRun}>Esporta risultati</Button> : null}</div>
    {progress ? <p role="status">{progress}</p> : null}
    {results.length ? <div className="lab-table-scroll"><table className="table compare"><thead><tr><th>Indicatore</th>{results.map(([id]) => <th key={id}>{names.get(id)}</th>)}</tr></thead><tbody>{measures.map((measure) => <tr key={measure.key}><td>{measure.label}</td>{results.map(([id, result]) => <td className="mono" key={id}>{measure.value(result).toLocaleString('it-IT', { maximumFractionDigits: 2 })}</td>)}</tr>)}</tbody></table></div> : null}
    {results.length ? <p className="muted">{run!.scope}. {results[0]![1].method} Tempi e ritardi riguardano solo gli arrivi: confronta sempre anche viaggi completati e domanda in attesa. Emissioni, traffico e sicurezza sono stime di progetto.</p> : null}
  </Section>;
}
