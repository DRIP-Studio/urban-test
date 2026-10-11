import { startProjectSimulation } from '../traffic/startSimulation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TRAFFIC, type CityBaseline, type SimFrame, type TrafficParams, type TrafficResult } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { registerLive } from '../state/live';
import { fc, type Feature } from '../engine/geojson';
import { flyTo, getMap, setSource, toggleLayer } from '../map/mapStore';
import { optimizeAllSignals, type OptimizeSummary } from '../traffic/signals';
import { drawLive, refreshLive, refreshTrafficState, trafficSourceMode, liveFreshness, setLiveAuto, useLive, vmsMessage } from '../traffic/live';
import { Icon } from '../ui/Icon';
import { commit, select, setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, ProvBadge, Section, Segmented, Select, Slider, Stat, Toggle, FieldGroup } from '../ui/controls';
import { TrafficSourceControl } from '../traffic/TrafficSourceControl';
import { Navigator } from './Navigator';
import { getProjectClock, getProjectTime, isProjectLive, setProjectTimeMode, configureProjectClock, useProjectClock, useProjectTime } from '../state/projectTime';
import { SIMULATION_SCOPES, simulationScope, type SimulationScope } from '../traffic/simulationScope';

type Tab = 'live' | 'history' | 'estimate' | 'simulation' | 'navigator';
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

interface TrafficDoc { captures?: { at: string; day: number; hour: number; meanRatio: number; segments: number }[] }

function drawEstimate(t: TrafficResult | null): void {
  const net = useApp.getState().network;
  if (!t || !net) { setSource('traffic', null); return; }
  const by = new Map<string, { ratio: number; vc: number; vol: number }>();
  for (const f of t.flows) {
    if (f.volumeVph <= 0) continue;
    const ratio = f.speedKmh / Math.max(1, f.freeSpeedKmh);
    const cur = by.get(f.roadId);
    if (!cur || ratio < cur.ratio) by.set(f.roadId, { ratio, vc: f.vc, vol: f.volumeVph + (cur?.vol ?? 0) });
  }
  setSource('traffic', fc([...by.entries()].filter(([id]) => net.roads[id]).map(([id, v]): Feature => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: net.roads[id]!.axis.map((p) => [...p]) }, properties: { id, ...v } }))));
}

function viewBbox(): number[] | null {
  const m = getMap();
  if (!m) return null;
  const b = m.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

function Live() {
  const live = useLive();
  const project = useApp((s) => s.project);
  useEffect(() => { if (project && live.status === 'idle') void refreshLive(); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drawLive(); }, []);
  const res = live;
  return (
    <>
      <Section title="Fonte e copertura del traffico">
        <TrafficSourceControl />
        {res.status === 'not_configured' ? (
          <Empty icon="traffic" title="Fonte live non configurata">
            Nessun dato in tempo reale viene mostrato senza un fornitore reale. Inserisci la chiave HERE Traffic in Impostazioni, oppure usa la scheda Stima (dichiarata come tale).
          </Empty>
        ) : res.status === 'error' ? (
          <Empty icon="warning" title="Fornitore non raggiungibile">{res.message}</Empty>
        ) : res.status === 'ok' ? (
          <>
            <div className="stats-row">
              <Stat label="Tratti del feed" value={res.flow.length} prov="live" />
              <Stat label="Eventi" value={res.incidents.length} prov="live" />
              <Stat label="Rilevato" value={res.capturedAt ? new Date(res.capturedAt).toLocaleTimeString('it-IT') : '—'} />
            </div>
            <p className="muted">Fonte: {res.provider}. Le osservazioni del fornitore sono indicate a tratto continuo; le stime a tratto discontinuo.</p>
          </>
        ) : null}
        <Toggle label={`Aggiornamento automatico (ogni ${live.intervalMin} min e quando sposti la mappa)`} checked={live.auto} onChange={(v) => setLiveAuto(v)} />
        {live.auto ? (
          <FieldGroup label="Intervallo"><Segmented<string> label="Intervallo" size="sm" value={String(live.intervalMin)} onChange={(v) => setLiveAuto(true, Number(v))}
            options={[{ value: '2', label: '2 min' }, { value: '3', label: '3 min' }, { value: '5', label: '5 min' }, { value: '10', label: '10 min' }]} /></FieldGroup>
        ) : null}
        <Button icon="refresh" busy={live.busy} onClick={() => void refreshLive()}>Aggiorna area visibile</Button>
      </Section>
      {res.status === 'ok' && liveFreshness() === 'fresh' && res.incidents.length ? (
        <Section title="Incidenti, cantieri e chiusure" count={res.incidents.length}>
          <ul className="issue-list">{res.incidents.slice(0, 40).map((f) => {
            const c = f.geometry.type === 'Point' ? (f.geometry.coordinates as number[]) : (f.geometry.coordinates as number[][])[0]!;
            return (
              <li key={String(f.properties.id)}>
                <Icon name={f.properties.roadClosed ? 'warning' : 'traffic'} size={14} />
                <span><strong>{String(f.properties.label)}</strong>{f.properties.roadClosed ? ' · strada chiusa' : ''}{f.properties.description ? ` · ${String(f.properties.description)}` : ''}
                  {f.properties.end ? <span className="muted"> · fino al {new Date(String(f.properties.end)).toLocaleString('it-IT')}</span> : null}</span>
                <button type="button" className="link" onClick={() => flyTo([c[0]!, c[1]!], 17)}>Mostra</button>
              </li>
            );
          })}</ul>
        </Section>
      ) : null}
      <VmsSection />
    </>
  );
}

/** Variable-message panels of the scenario: message now (manual or from live traffic). */
function VmsSection() {
  const net = useApp((s) => s.network);
  const catalogs = useApp((s) => s.catalogs);
  const live = useLive();
  const vms = useMemo(() => {
    const ids = new Set(catalogs?.furniture.items.filter((i) => i.led?.kind === 'vms').map((i) => i.id));
    return Object.values(net?.assets ?? {}).filter((a) => ids.has(a.type) && a.state !== 'removed');
  }, [net, catalogs]);
  return (
    <Section title="Pannelli a messaggio variabile (PMV)" count={vms.length}>
      {vms.length ? (
        <ul className="vms-list">{vms.map((a) => (
          <li key={a.id}>
            <pre className="vms-text">{vmsMessage(a, live)}</pre>
            <span className="muted">{a.properties.vmsMode === 'live' ? 'Automatico da traffico live' : 'Testo manuale'}</span>
            <button type="button" className="link" onClick={() => { select({ kind: 'asset', ids: [a.id] }); flyTo([a.at[0], a.at[1]], 18.5); }}>Seleziona</button>
          </li>
        ))}</ul>
      ) : <p className="muted">Nessun PMV nello scenario. Inseriscilo da Arredo → «Varchi, pannelli e PMV»: in modalità automatica mostra code, incidenti e chiusure entro 2 km dal traffico live.</p>}
    </Section>
  );
}

function History() {
  const project = useApp((s) => s.project);
  const [doc, setDoc] = useState<TrafficDoc | null>(null);
  useEffect(() => { if (project) api.get<TrafficDoc | null>(`/api/projects/${project.id}/docs/traffic`).then(setDoc).catch(() => setDoc(null)); }, [project]);
  const caps = doc?.captures ?? [];
  if (!caps.length) return <Empty icon="clock" title="Nessuno storico registrato">Lo storico si costruisce solo da rilevazioni live reali salvate dal progetto (scheda Live). Nessun profilo viene inventato.</Empty>;
  const grid = DAYS.map((_, d) => Array.from({ length: 24 }, (_, h) => { const c = caps.filter((x) => x.day === d && x.hour === h); return c.length ? c.reduce((s, x) => s + x.meanRatio, 0) / c.length : null; }));
  return (
    <Section title={`Storico rilevazioni (${caps.length})`}>
      <div className="heat-grid" role="table" aria-label="Velocità media / libero deflusso per giorno e ora">
        {grid.map((row, d) => (
          <div key={d} className="hg-row" role="row"><span className="hg-day">{DAYS[d]!.slice(0, 3)}</span>
            {row.map((v, h) => <span key={h} role="cell" className="hg-cell" title={v === null ? `${h}:00 nessun dato` : `${h}:00 · ${(v * 100).toFixed(0)}%`} style={{ background: v === null ? 'transparent' : v > 0.8 ? '#3fae6b' : v > 0.55 ? '#e2b13c' : v > 0.35 ? '#e1703a' : '#b9312a' }} />)}
          </div>
        ))}
      </div>
      <p className="muted">Rapporto velocità rilevata / libero deflusso. Prima rilevazione {new Date(caps[0]!.at).toLocaleString('it-IT')}.</p>
    </Section>
  );
}

function Estimate() {
  const { time } = useProjectClock();
  const [p, setP] = useState<TrafficParams>(DEFAULT_TRAFFIC);
  const [res, setRes] = useState<{ today: TrafficResult; project: TrafficResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => registerLive('traffic-estimate', () => (res ? runRef.current() : undefined)), [res]);
  const run = async () => {
    setBusy(true);
    try {
      const at = getProjectTime(), params = { ...p, day: at.day, hour: at.minutes / 60, holiday: at.holiday, date: at.date };
      const r = await engine.job<{ today: TrafficResult; project: TrafficResult }>('trafficCompare', { params });
      setRes(r);
      if (trafficSourceMode() === 'simulated') drawEstimate(r.project);
      await engine.job('traffic', { params }); // keep the latest estimate in the worker for audit and safety
    } catch (e) { toast.error('Stima traffico', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  runRef.current = run;

  const d = (a: number, b: number) => Math.round(b - a);
  return (
    <>
      <Section title="Parametri della stima">
        <p className="muted">Clock globale: {time.date} · {DAYS[time.day]} · {Math.floor(time.minutes / 60)}:{String(Math.floor(time.minutes % 60)).padStart(2, '0')}</p>
        <div className="grid-2">
          <Field label="Spostamenti auto / giorno"><NumberField value={p.dailyTrips} min={1000} max={1000000} step={1000} decimals={0} ariaLabel="Spostamenti" onCommit={(v) => setP({ ...p, dailyTrips: v })} /></Field>
          <Field label="Quota di attraversamento"><NumberField value={p.externalShare * 100} unit="%" min={0} max={90} step={5} decimals={0} ariaLabel="Attraversamento" onCommit={(v) => setP({ ...p, externalShare: v / 100 })} /></Field>
          <Field label="Crescita domanda"><NumberField value={p.growthPercent} unit="%" min={-50} max={200} step={5} decimals={0} ariaLabel="Crescita" onCommit={(v) => setP({ ...p, growthPercent: v })} /></Field>
        </div>
        <Button variant="primary" icon="play" busy={busy} onClick={() => void run()}>Calcola stima (oggi e progetto)</Button>
        <p className="muted"><ProvBadge kind="estimated" /> Modello DRIP: non è un conteggio. Calibra gli spostamenti giornalieri con dati reali quando disponibili.</p>
      </Section>
      {res ? (
        <Section title={`Risultato · ${DAYS[res.project.params.day]} ${Math.floor(res.project.params.hour)}:${String(Math.round(res.project.params.hour % 1 * 60)).padStart(2, '0')}`}>
          <div className="stats-row">
            <Stat label="Veicoli·km nell’ora" value={res.project.totals.vehKm.toLocaleString('it-IT')} prov="estimated" delta={{ value: d(res.today.totals.vehKm, res.project.totals.vehKm), goodWhen: 'down' }} />
            <Stat label="Velocità media" value={res.project.totals.avgSpeedKmh} unit="km/h" delta={{ value: d(res.today.totals.avgSpeedKmh, res.project.totals.avgSpeedKmh), goodWhen: 'up', unit: ' km/h' }} />
            <Stat label="Tratti v/c > 1" value={res.project.totals.overCapacity} delta={{ value: d(res.today.totals.overCapacity, res.project.totals.overCapacity), goodWhen: 'down' }} />
          </div>
          <div className="stats-row">
            <Stat label="Veicoli·ora" value={res.project.totals.vehHours.toLocaleString('it-IT')} delta={{ value: d(res.today.totals.vehHours, res.project.totals.vehHours), goodWhen: 'down' }} />
            <Stat label="Spostamenti/ora" value={res.project.hourlyTrips.toLocaleString('it-IT')} />
            <Stat label="Non raggiungibili" value={res.project.totals.unreachableTrips} />
          </div>
          <p className="muted">{res.project.method}</p>
        </Section>
      ) : null}
      <NetworkSignals />
    </>
  );
}

/** Network-wide retiming of every signal plan (Webster on the estimate, corridors on a common cycle). */
export function NetworkSignals() {
  const plans = useApp((s) => Object.keys(s.network?.signalPlans ?? {}).length);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<OptimizeSummary | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await optimizeAllSignals();
      setLast(r);
      if (r.applied) toast.success('Semafori ottimizzati', `${r.plans} piani · ciclo medio ${r.before} → ${r.after} s · annullabile con Ctrl+Z`);
    } catch (e) { toast.error('Ottimizzazione non riuscita', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Rete semaforica" count={plans}>
      <p className="muted">Ricalcola tutti i piani con Webster sui flussi stimati: fasi senza conflitti, ciclo ottimo, verdi proporzionali. Restano invariati logica, svolte permesse, lanterne rimosse e corridoi coordinati (ciclo comune, offset mantenuti).</p>
      {last ? (
        <>
          <div className="stats-row"><Stat label="Piani" value={last.plans} /><Stat label="Ciclo medio prima" value={last.before} unit="s" /><Stat label="Ciclo medio dopo" value={last.after} unit="s" /></div>
          {last.saturated.length ? <p className="warn-line">Vicini alla saturazione (Y &gt; 0,85): {last.saturated.slice(0, 6).join(', ')}{last.saturated.length > 6 ? '…' : ''}. Valuta corsie dedicate o rotatoria.</p> : null}
        </>
      ) : null}
      <Button icon="sparkle" busy={busy} disabled={!plans} onClick={() => void run()}>Ottimizza tutti i semafori</Button>
    </Section>
  );
}

function Simulation() {
  const pedestrianDemand = useApp(s => s.network?.environment?.pedestrianDemandPerHour ?? 1800);
  const { clock: projectClock, time } = useProjectClock();
  const speed = useProjectTime((s) => s.speed);
  const [running, setRunning] = useState(Boolean(engine.lastSim));
  const [paused, setPaused] = useState(engine.simPaused);
  useEffect(() => useProjectTime.subscribe((s) => setPaused(!s.playing)), []);
  const [daily, setDaily] = useState(engine.lastSimOptions?.dailyTrips ?? 60000);
  const [frame, setFrame] = useState<SimFrame | null>(engine.lastSim);
  const [scope, setScope] = useState<SimulationScope>(engine.lastSimOptions?.focus ? 'visible' : 'municipality');
  const [quality, setQuality] = useState('balanced');
  const [mode, setSimulationMode] = useState<'microscopic' | 'hybrid'>(engine.lastSimOptions?.mode ?? 'microscopic');
  const [starting, setStarting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ fps: number; heapMB: number | null }>({ fps: 0, heapMB: null });
  const budget = { performance: 500, balanced: 2000, high: 4000, ultra: 8000 }[quality] ?? 2000;
  const baseline = useApp((s) => s.baseline);
  const last = useRef(0);
  useEffect(() => {
    let raf = 0, frames = 0, since = performance.now();
    const sample = () => {
      frames++;
      const now = performance.now();
      if (now - since >= 1000) {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        setDiagnostics({ fps: frames * 1000 / (now - since), heapMB: memory ? memory.usedJSHeapSize / 1048576 : null });
        since = now; frames = 0;
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    return engine.onSim((f) => {
      if (!f) { last.current=0; setFrame(null); setRunning(false); setPaused(false); return; }
      setRunning(true);
      const now=performance.now();
      if(last.current===0||f.metrics.t===0||now-last.current>400){setFrame(f);last.current=now;}
    });
  }, []);
  useEffect(() => {
    const update = () => {
      const bounds = viewBbox();
      engine.simView({ budget, ...(bounds ? { bounds: bounds as [number, number, number, number] } : {}) });
      if (mode === 'hybrid' && bounds) engine.simFocus(bounds as [number, number, number, number]);
    };
    update();
    const map = getMap(); map?.on('moveend', update);
    return () => { map?.off('moveend', update); };
  }, [budget, mode]);
  const start = async () => {
    setStarting(true);
    try {
    const state = useApp.getState();
    if (!state.network) throw new Error('Rete non disponibile');
    const bounds = viewBbox() as [number, number, number, number] | null;
    const extent = simulationScope(scope, state.network, state.selection, bounds);
    await startProjectSimulation({mode,dailyTrips:daily,pedestrianDemandPerHour:pedestrianDemand,seed:42,...extent,...(bounds?{microBounds:bounds}:{})},speed);
    setRunning(true); setPaused(false);
    } catch (e) { toast.error('Avvio simulazione', e instanceof Error ? e.message : String(e)); }
    finally { setStarting(false); }
  };
  const m = frame?.metrics;
  const clock = m ? new Date(((engine.lastSimOptions?.hour ?? time.minutes / 60) * 3600 + m.t) * 1000).toISOString().slice(11, 19) : '—';
  return (
    <>
      <Section title="DRIP Flow · simulazione">
        <TrafficSourceControl disabled={running || starting} />
        <p className="muted">Le velocità e le chiusure della fonte scelta vincolano questo run. Il numero dei veicoli deriva dalla domanda impostata, non da conteggi Live.</p>
        <p className="muted">Avvio dal clock globale: {time.date} · {projectClock.timeZone}</p>
        <Segmented<string> label="Modello simulazione" value={mode} options={[{ value: 'microscopic', label: 'Microscopica' }, { value: 'hybrid', label: 'Ibrida comunale' }]} onChange={(v) => setSimulationMode(v as 'microscopic' | 'hybrid')} />
        <div className="grid-2">
        <Field label="Ambito"><Select value={scope} ariaLabel="Ambito simulazione" options={SIMULATION_SCOPES} onChange={(v) => setScope(v as SimulationScope)} /></Field>
        <Field label="Qualità grafica"><Select value={quality} ariaLabel="Qualità simulazione" options={[{ value: 'performance', label: 'Performance' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }]} onChange={setQuality} /></Field>
        </div>
        <div className="grid-2">
          <Field label="Pedoni / ora · domanda sintetica"><NumberField value={pedestrianDemand} min={0} max={100000} step={100} decimals={0} ariaLabel="Domanda pedonale" onCommit={pedestrianDemandPerHour => commit('environment.set', { pedestrianDemandPerHour })} /></Field>
          <Field label="Spostamenti auto / giorno"><NumberField value={daily} min={1000} max={1000000} step={5000} decimals={0} ariaLabel="Domanda" onCommit={setDaily} /></Field>
        </div>
        <p className="muted">{mode === 'hybrid' ? 'IDM nell’area di dettaglio e agli incroci; flussi per corsia nelle tratte lontane.' : 'IDM per ogni veicolo.'} Qualità: solo carico grafico. Ambito e domanda applicati all’avvio. Comunale carica tutta la rete, anche fuori dalla zona di lavoro.</p>
        <div className="sim-controls">
          {!running ? <Button variant="primary" icon="play" busy={starting} onClick={() => void start()}>{scope === 'municipality' ? 'Avvia simulazione comunale' : 'Avvia nell’ambito scelto'}</Button> : (
            <>
              <Button icon={paused ? 'play' : 'pause'} onClick={() => { engine.simPause(!paused); setPaused(!paused); }}>{paused ? 'Riprendi' : 'Pausa'}</Button>
              <Button icon="stop" onClick={() => { engine.simStop(); setRunning(false); }}>Ferma</Button>
              <Button icon="refresh" onClick={() => { engine.simStop(); void start(); }}>Riavvia</Button>
            </>
          )}
        </div>
        <Segmented<string> label="Velocità" value={String(speed)} onChange={(v) => { configureProjectClock({ speed: Number(v) }); }} options={[{ value: '1', label: '1×' }, { value: '4', label: '4×' }, { value: '10', label: '10×' }, { value: '30', label: '30×' }]} />
        <p className="muted"><ProvBadge kind="simulated" /> Veicoli con dimensioni reali in corsia, modello di inseguimento IDM, stop al rosso e al giallo, precedenze in rotatoria e agli stop. La domanda è la stessa ipotesi della stima.</p>
      </Section>
      {m ? (
        <Section title={`Tempo simulato ${clock}`}>
          {frame?.pedestrians ? <div className="stats-row"><Stat label="Pedoni simulati" value={frame.pedestrians.metrics.active} /><Stat label="Pedoni in attesa" value={frame.pedestrians.metrics.waiting} /><Stat label="Pedoni disegnati" value={frame.pedestrians.data.length/5} /></div> : null}
          <p className="muted">Ambito attivo: {engine.lastSimOptions?.scopeName ?? 'Intero comune'}</p>
          <div className="stats-row"><Stat label="Veicoli disegnati" value={frame!.data.length / 6} /><Stat label="Tick worker" value={Math.round(engine.simPerformance.tickMs)} unit="ms" /><Stat label="Latenza worker" value={Math.round(engine.simPerformance.latencyMs)} unit="ms" /></div>
          <div className="stats-row"><Stat label="Passi fisici" value={engine.simPerformance.solverHz.toFixed(1)} unit="Hz" /><Stat label="FPS UI" value={Math.round(diagnostics.fps)} /><Stat label="Heap browser stimato" value={diagnostics.heapMB === null ? 'N/D' : Math.round(diagnostics.heapMB)} unit={diagnostics.heapMB === null ? undefined : 'MB'} /></div>
          <div className="stats-row"><Stat label="Microscopici" value={m.microscopic ?? m.vehicles} /><Stat label="Aggregati" value={m.aggregated ?? 0} /><Stat label="Domanda in attesa" value={m.waitingDemand ?? 0} /></div>
          <div className="stats-row"><Stat label="Veicoli in rete" value={m.vehicles} prov="simulated" /><Stat label="Velocità media" value={m.avgSpeedKmh} unit="km/h" /><Stat label="Fermi" value={m.stopped} /></div>
          <div className="stats-row"><Stat label="Arrivati" value={m.completed} /><Stat label="Portata" value={m.throughputVph} unit="veic/h" /><Stat label="Ritardo medio" value={m.avgDelayS} unit="s" /></div>
          {m.queues.length ? (
            <table className="table"><thead><tr><th>Coda</th><th>Veicoli</th></tr></thead><tbody>
              {m.queues.map((q) => <tr key={`${q.roadId}${q.nodeId}`}><td>{useApp.getState().network?.roads[q.roadId]?.name || q.roadId}</td><td className="mono">{q.vehicles}</td></tr>)}
            </tbody></table>
          ) : null}
        </Section>
      ) : running ? <p className="muted">Avvio…</p> : null}
    </>
  );
}

export function TrafficStudio() {
  const tool = useApp((s) => s.tool);
  // The Navigator tool (P) opens its tab; leaving the tab leaves the tool.
  const [tab, setTab] = useState<Tab>(() => (useApp.getState().tool === 'route' ? 'navigator' : 'estimate'));
  useEffect(() => { toggleLayer('traffic', true); drawLive(); }, []);
  useEffect(() => { if (tool === 'route' && tab !== 'navigator') setTab('navigator'); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'navigator') setTool('route'); else if (useApp.getState().tool === 'route') setTool('select'); }, [tab]);
  return (
    <div className="panel-stack">
      <Segmented<Tab> label="Fonte traffico" size="sm" value={tab} onChange={(v) => { setTab(v); drawLive(); }}
        options={[{ value: 'live', label: 'Live' }, { value: 'history', label: 'Storico' }, { value: 'estimate', label: 'Stima' }, { value: 'simulation', label: 'Simulazione' }, { value: 'navigator', label: 'Navigatore' }]} />
      {tab === 'live' ? <Live /> : tab === 'history' ? <History /> : tab === 'estimate' ? <Estimate /> : tab === 'simulation' ? <Simulation /> : <Navigator />}
    </div>
  );
}
