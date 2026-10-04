import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TRAFFIC, type SimFrame, type TrafficParams, type TrafficResult } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { registerLive } from '../state/live';
import { fc, type Feature } from '../engine/geojson';
import { flyTo, getMap, setSource, toggleLayer } from '../map/mapStore';
import { optimizeAllSignals, type OptimizeSummary } from '../traffic/signals';
import { drawLive, refreshLive, setLiveAuto, useLive, vmsMessage } from '../traffic/live';
import { Icon } from '../ui/Icon';
import { vehiclesFC } from '../map/sources';
import { select, setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, ProvBadge, Section, Segmented, Select, Slider, Stat, Toggle, FieldGroup } from '../ui/controls';
import { Navigator } from './Navigator';

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
      <Section title="Traffico in tempo reale">
        {res.status === 'not_configured' ? (
          <Empty icon="traffic" title="Fonte live non configurata">
            Nessun dato in tempo reale viene mostrato senza un fornitore reale. Inserisci la chiave HERE Traffic in Impostazioni, oppure usa la scheda Stima (dichiarata come tale).
          </Empty>
        ) : res.status === 'error' ? (
          <Empty icon="warning" title="Fornitore non raggiungibile">{res.message}</Empty>
        ) : res.status === 'ok' ? (
          <>
            <div className="stats-row">
              <Stat label="Tratti con dato" value={res.flow.length} prov="live" />
              <Stat label="Eventi" value={res.incidents.length} prov="live" />
              <Stat label="Rilevato" value={res.capturedAt ? new Date(res.capturedAt).toLocaleTimeString('it-IT') : '—'} />
            </div>
            <p className="muted">Fonte: {res.provider}. Copertura limitata alla rete monitorata dal fornitore; i tratti senza colore non hanno dato.</p>
          </>
        ) : null}
        <Toggle label={`Aggiornamento automatico (ogni ${live.intervalMin} min e quando sposti la mappa)`} checked={live.auto} onChange={(v) => setLiveAuto(v)} />
        {live.auto ? (
          <FieldGroup label="Intervallo"><Segmented<string> label="Intervallo" size="sm" value={String(live.intervalMin)} onChange={(v) => setLiveAuto(true, Number(v))}
            options={[{ value: '2', label: '2 min' }, { value: '3', label: '3 min' }, { value: '5', label: '5 min' }, { value: '10', label: '10 min' }]} /></FieldGroup>
        ) : null}
        <Button icon="refresh" busy={live.busy} onClick={() => void refreshLive()}>Aggiorna area visibile</Button>
      </Section>
      {res.status === 'ok' && res.incidents.length ? (
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
  const [p, setP] = useState<TrafficParams>(DEFAULT_TRAFFIC);
  const [res, setRes] = useState<{ today: TrafficResult; project: TrafficResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => registerLive('traffic-estimate', () => (res ? runRef.current() : undefined)), [res]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await engine.job<{ today: TrafficResult; project: TrafficResult }>('trafficCompare', { params: p });
      setRes(r);
      drawEstimate(r.project);
      await engine.job('traffic', { params: p }); // keep the latest estimate in the worker for audit and safety
    } catch (e) { toast.error('Stima traffico', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  runRef.current = run;

  const d = (a: number, b: number) => Math.round(b - a);
  return (
    <>
      <Section title="Parametri della stima">
        <div className="grid-2">
          <Field label="Spostamenti auto / giorno"><NumberField value={p.dailyTrips} min={1000} max={1000000} step={1000} decimals={0} ariaLabel="Spostamenti" onCommit={(v) => setP({ ...p, dailyTrips: v })} /></Field>
          <Field label="Quota di attraversamento"><NumberField value={p.externalShare * 100} unit="%" min={0} max={90} step={5} decimals={0} ariaLabel="Attraversamento" onCommit={(v) => setP({ ...p, externalShare: v / 100 })} /></Field>
          <Field label="Giorno"><Select value={String(p.day)} ariaLabel="Giorno" options={DAYS.map((x, i) => ({ value: String(i), label: x }))} onChange={(v) => setP({ ...p, day: Number(v) })} /></Field>
          <Field label="Crescita domanda"><NumberField value={p.growthPercent} unit="%" min={-50} max={200} step={5} decimals={0} ariaLabel="Crescita" onCommit={(v) => setP({ ...p, growthPercent: v })} /></Field>
        </div>
        <Slider label="Ora" min={0} max={23} step={1} value={p.hour} format={(v) => `${String(v).padStart(2, '0')}:00`} onChange={(v) => setP({ ...p, hour: v })} />
        <Button variant="primary" icon="play" busy={busy} onClick={() => void run()}>Calcola stima (oggi e progetto)</Button>
        <p className="muted"><ProvBadge kind="estimated" /> Modello DRIP: non è un conteggio. Calibra gli spostamenti giornalieri con dati reali quando disponibili.</p>
      </Section>
      {res ? (
        <Section title={`Risultato · ${DAYS[p.day]} ${String(p.hour).padStart(2, '0')}:00`}>
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
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [hour, setHour] = useState(8);
  const [daily, setDaily] = useState(60000);
  const [frame, setFrame] = useState<SimFrame | null>(null);
  const baseline = useApp((s) => s.baseline);
  const last = useRef(0);
  useEffect(() => {
    toggleLayer('vehicles', true);
    const off = engine.onSim((f) => {
      if (!f) { setSource('vehicles', null); setFrame(null); return; }
      const now = performance.now();
      if (baseline) setSource('vehicles', vehiclesFC(f, baseline.origin));
      if (now - last.current > 400) { setFrame(f); last.current = now; }
    });
    return () => { off(); engine.simStop(); setSource('vehicles', null); };
  }, [baseline]);
  const start = () => {
    const bb = viewBbox();
    engine.simStart({ day: 1, hour, dailyTrips: daily, scale: 1, seed: 42, ...(bb ? { focus: bb as [number, number, number, number] } : {}) });
    engine.simSpeed(speed);
    setRunning(true); setPaused(false);
  };
  const m = frame?.metrics;
  const clock = m ? new Date((hour * 3600 + m.t) * 1000).toISOString().slice(11, 19) : '—';
  return (
    <>
      <Section title="DRIP Flow · simulazione">
        <div className="grid-2">
          <Field label="Spostamenti auto / giorno"><NumberField value={daily} min={1000} max={1000000} step={5000} decimals={0} ariaLabel="Domanda" onCommit={setDaily} /></Field>
          <Field label="Ora di inizio"><NumberField value={hour} unit="h" min={0} max={23} decimals={0} ariaLabel="Ora" onCommit={setHour} /></Field>
        </div>
        <div className="sim-controls">
          {!running ? <Button variant="primary" icon="play" onClick={start}>Avvia nell'area visibile</Button> : (
            <>
              <Button icon={paused ? 'play' : 'pause'} onClick={() => { engine.simPause(!paused); setPaused(!paused); }}>{paused ? 'Riprendi' : 'Pausa'}</Button>
              <Button icon="stop" onClick={() => { engine.simStop(); setRunning(false); }}>Ferma</Button>
              <Button icon="refresh" onClick={() => { engine.simStop(); start(); }}>Riavvia</Button>
            </>
          )}
        </div>
        <Segmented<string> label="Velocità" value={String(speed)} onChange={(v) => { setSpeed(Number(v)); engine.simSpeed(Number(v)); }} options={[{ value: '1', label: '1×' }, { value: '4', label: '4×' }, { value: '10', label: '10×' }, { value: '30', label: '30×' }]} />
        <p className="muted"><ProvBadge kind="simulated" /> Veicoli con dimensioni reali in corsia, modello di inseguimento IDM, stop al rosso e al giallo, precedenze in rotatoria e agli stop. La domanda è la stessa ipotesi della stima.</p>
      </Section>
      {m ? (
        <Section title={`Tempo simulato ${clock}`}>
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
  const [tab, setTab] = useState<Tab>('estimate');
  useEffect(() => { toggleLayer('traffic', true); return () => setSource('traffic', null); }, []);
  useEffect(() => { if (tab === 'navigator') setTool('route'); else setTool('select'); }, [tab]);
  return (
    <div className="panel-stack">
      <Segmented<Tab> label="Fonte traffico" size="sm" value={tab} onChange={(v) => { setTab(v); if (v !== 'live') { setLiveAuto(false); setSource('incidents', null); } if (v !== 'live' && v !== 'estimate') setSource('traffic', null); }}
        options={[{ value: 'live', label: 'Live' }, { value: 'history', label: 'Storico' }, { value: 'estimate', label: 'Stima' }, { value: 'simulation', label: 'Simulazione' }, { value: 'navigator', label: 'Navigatore' }]} />
      {tab === 'live' ? <Live /> : tab === 'history' ? <History /> : tab === 'estimate' ? <Estimate /> : tab === 'simulation' ? <Simulation /> : <Navigator />}
    </div>
  );
}
