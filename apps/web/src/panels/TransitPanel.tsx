import {startProjectSimulation} from '../traffic/startSimulation';
import { engine } from '../engine/engine';
import { getProjectClock, useProjectClock } from '../state/projectTime';
import type { TransitMetrics } from '@drip-urban/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LocalFrame, geom } from '@drip-urban/core';
import { api } from '../api/client';
import { fc, type Feature } from '../engine/geojson';
import { fitBounds, flyTo, setSource, toggleLayer } from '../map/mapStore';
import { newId, setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { drawTransit, usePicks, type TransitRouteDesign } from '../tools/picks';
import { BANDS, MODES, bikeCoverage, catchment, lineMetrics, proposeBikeStations, type BikeShare, type TransitMode } from '../transit/model';
import { Button, Empty, Field, NumberField, ProvBadge, Section, Select, Stat, TextField, Toggle } from '../ui/controls';
import { confirmAction } from '../ui/confirm';
import { Icon } from '../ui/Icon';

const fmtEur = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2).replace('.', ',')} M€` : `${Math.round(v / 1000).toLocaleString('it-IT')} k€`);
const n0 = (v: number) => Math.round(v).toLocaleString('it-IT');
const MODE_ORDER: TransitMode[] = ['bus', 'brt', 'trolleybus', 'tram', 'metro', 'train', 'funicular', 'ferry', 'on_demand'];

function Gtfs() {
  const project = useApp((s) => s.project);
  const transit = usePicks((s) => s.transit);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const upload = async (body: FormData | null) => {
    if (!project) return;
    setBusy(true);
    try {
      const qs = body ? '' : `?url=${encodeURIComponent(url)}`;
      const res = await fetch(`/api/projects/${project.id}/gtfs${qs}`, { method: 'POST', body: body ?? undefined });
      if (!res.ok) throw new Error((await res.json()).detail ?? `Errore ${res.status}`);
      const j = await res.json() as { routes: number; stops: number };
      toast.success('GTFS importato', `${j.routes} linee, ${j.stops} fermate`);
      await usePicks.getState().loadTransit();
    } catch (e) { toast.error('Import GTFS', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const g = transit.gtfs;
  const byMode = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of g?.routes ?? []) m.set(r.mode, (m.get(r.mode) ?? 0) + 1);
    return [...m.entries()];
  }, [g]);
  return (
    <Section title="Rete esistente (GTFS)" defaultOpen={!g}>
      {g ? (
        <>
          <div className="stats-row"><Stat label="Linee" value={g.routes.length} prov="existing" /><Stat label="Fermate" value={g.stops.length} /><Stat label="Operatori" value={g.agencies.length} /></div>
          <div className="feature-list">{byMode.map(([m, c]) => <span key={m} className="is-on">{MODES[m as TransitMode]?.label ?? m}: {c}</span>)}</div>
          <p className="muted">Fonte: {g.source} · importato {new Date(g.importedAt).toLocaleString('it-IT')}</p>
          <ul className="route-list">{g.routes.slice(0, 40).map((r) => (
            <li key={r.id}><span className="swatch" style={{ background: r.color }} /><strong>{r.shortName}</strong><span>{r.longName}</span><span className="hint">{r.amPeakHeadwayMin ? `ogni ${r.amPeakHeadwayMin}′ (7-9)` : `${r.tripsPerDay} corse`}</span></li>
          ))}</ul>
        </>
      ) : <Empty icon="transit" title="Nessun GTFS importato">Carica il feed GTFS dell'operatore (ZIP): metro, treni, tram, bus e traghetti con linee, fermate e frequenze reali.</Empty>}
      <input ref={file} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); void upload(fd); } e.target.value = ''; }} />
      <div className="inspector-actions"><Button icon="import" busy={busy} onClick={() => file.current?.click()}>Carica GTFS (.zip)</Button></div>
      <Field label="oppure URL del feed"><TextField value={url} placeholder="https://…/gtfs.zip" ariaLabel="URL GTFS" onCommit={setUrl} /></Field>
      <Button size="sm" disabled={!url} busy={busy} onClick={() => void upload(null)}>Importa da URL</Button>
    </Section>
  );
}

function Realtime() {
  const [data, setData] = useState<{ status: string; freshness?: string; ageS?: number | null; retrievedAt?: string; feedTimestamp?: number | null; vehicles: { id: string; at: [number, number]; routeId: string }[]; message?: string } | null>(null);
  const load = () => { const pid=useApp.getState().project?.id; return api.get<typeof data>('/api/transit/realtime').then((d) => {
    if(useApp.getState().project?.id!==pid)return;
    setData(d);
    setSource('rt-vehicles', d?.status === 'ok' ? fc(d.vehicles.map((v): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: v.at }, properties: { id: v.id, route: v.routeId } }))) : null);
  }).catch(()=>{if(useApp.getState().project?.id===pid){setData({status:'error',vehicles:[]});setSource('rt-vehicles',null);}}); };
  return (
    <Section title="Tempo reale (GTFS-RT)" defaultOpen={false}>
      <Button size="sm" icon="refresh" onClick={() => void load()}>Leggi posizioni veicoli</Button>
      {data?.status === 'not_configured' ? <p className="muted">URL GTFS-RT non configurato in Impostazioni: nessun dato live viene simulato.</p> : null}
      {data?.status === 'ok' ? <><p>{data.freshness === 'recent' ? <ProvBadge kind="live" /> : <strong className="warn-line">{data.freshness === 'stale' ? 'Feed non aggiornato' : 'Data del feed non verificata'}</strong>} · {data.vehicles.length} posizioni nel feed</p><p className="muted">{data.feedTimestamp ? `Istante feed: ${new Date(data.feedTimestamp*1000).toLocaleString('it-IT')}` : 'Timestamp feed assente'}{data.ageS != null ? ` · età alla lettura ${Math.round(data.ageS/60)} min` : ''}. Ultima lettura: {data.retrievedAt ? new Date(data.retrievedAt).toLocaleString('it-IT') : 'non disponibile'}.</p></> : null}
      {data?.status === 'error' ? <p className="warn-line">{data.message ?? 'Feed non raggiungibile'}</p> : null}
    </Section>
  );
}

/** Places stops along the line at the mode's typical spacing (terminals included). */
function autoStops(r: TransitRouteDesign, origin: [number, number]) {
  const f = new LocalFrame(origin);
  const axis = r.line.map((p) => f.toMetric(p) as geom.V);
  const L = geom.lengthOf(axis);
  const step = MODES[r.mode].stopSpacingM;
  const n = Math.max(1, Math.round(L / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ id: newId('st'), name: i === 0 ? 'Capolinea A' : i === n ? 'Capolinea B' : `Fermata ${i + 1}`, at: f.toLngLat(geom.sampleAt(axis, (L * i) / n).p) }));
}

function LineEditor({ sel, upd, onDelete }: { sel: TransitRouteDesign; upd: (p: Partial<TransitRouteDesign>) => void; onDelete: () => void }) {
  const baseline = useApp((s) => s.baseline)!;
  const m = useMemo(() => lineMetrics(sel, baseline), [sel, baseline]);
  const spec = MODES[sel.mode];
  const {time} = useProjectClock();
  const [simulationStarting,setSimulationStarting]=useState(false);
  const [runtime,setRuntime]=useState<readonly TransitMetrics[]>(engine.lastSim?.metrics.transit??[]);
  useEffect(()=>engine.onSim(frame=>setRuntime(frame?.metrics.transit??[])),[]);
  const authoredLines=useApp(s=>s.network?.transit);
  const lines=authoredLines??[];
  const operational=runtime.find(r=>r.lineId===sel.id);
  return (
    <Section title={sel.name}>
      <div className="grid-2">
        <Field label="Nome"><TextField value={sel.name} ariaLabel="Nome linea" onCommit={(v) => upd({ name: v })} /></Field>
        <Field label="Modo"><Select value={sel.mode} ariaLabel="Modo" options={MODE_ORDER.map((k) => ({ value: k, label: MODES[k].label }))} onChange={(v) => { const ms = MODES[v]; upd({ mode: v, speedKmh: ms.speedKmh, vehicle: ms.vehicles[0]!.label, capacity: ms.vehicles[0]!.capacity, color: ms.color }); }} /></Field>
        <Field label="Veicolo"><Select value={sel.vehicle} ariaLabel="Veicolo" options={spec.vehicles.map((v) => ({ value: v.label, label: v.label, hint: `${v.capacity} pax` }))} onChange={(v) => upd({ vehicle: v, capacity: spec.vehicles.find((x) => x.label === v)?.capacity ?? sel.capacity })} /></Field>
        <Field label="Capacità per veicolo"><NumberField value={sel.capacity} unit="pax" min={5} max={2000} decimals={0} ariaLabel="Capacità" onCommit={(v) => upd({ capacity: v })} /></Field>
        <Field label="Velocità commerciale"><NumberField value={sel.speedKmh} unit="km/h" min={5} max={120} decimals={0} ariaLabel="Velocità" onCommit={(v) => upd({ speedKmh: v })} /></Field>
        <Field label="Colore"><input type="color" className="color-field" value={sel.color} onChange={(e) => upd({ color: e.target.value })} aria-label="Colore linea" /></Field>
        <Field label="Prima corsa"><input type="time" className="text-field" value={sel.firstDeparture} onChange={(e) => e.target.value && upd({ firstDeparture: e.target.value })} aria-label="Prima corsa" /></Field>
        <Field label="Ultima corsa"><input type="time" className="text-field" value={sel.lastDeparture} onChange={(e) => e.target.value && upd({ lastDeparture: e.target.value })} aria-label="Ultima corsa" /></Field>
      </div>
      <Field label="Frequenza per fascia (minuti tra le corse, 0 = nessun servizio)">
        <div className="grid-2">{BANDS.map((b) => (
          <label key={b.id} className="band"><span className="muted">{b.label}</span>
            <NumberField value={sel.headways[b.id]} unit="min" min={0} max={240} decimals={0} ariaLabel={`Frequenza ${b.label}`} onCommit={(v) => upd({ headways: { ...sel.headways, [b.id]: v }, ...(b.id === 'peak' ? { headwayMin: v } : {}) })} />
          </label>
        ))}</div>
      </Field>
      <p className="muted"><ProvBadge kind="estimated" /> Stime DRIP: esercizio da lunghezza, velocità e frequenze; domanda dai residenti stimati negli edifici entro {spec.catchmentM} m dalle fermate. Non sono conteggi.</p>
      <div className="stats-row"><Stat label="Lunghezza" value={m.lengthKm.toFixed(2).replace('.', ',')} unit="km" prov="project" /><Stat label="Percorrenza" value={Math.round(m.oneWayMin)} unit="min" /><Stat label="Flotta" value={m.fleet} unit="veicoli" /></div>
      <div className="stats-row"><Stat label="Capacità in punta" value={n0(m.capacityPeak)} unit="pax/h" /><Stat label="Attesa media" value={m.waitPeakMin.toFixed(1).replace('.', ',')} unit="min" /><Stat label="Interdistanza" value={m.spacingM ? Math.round(m.spacingM) : '—'} unit="m" /></div>
      <div className="stats-row"><Stat label="Bacino" value={n0(m.catchmentPop)} unit="abitanti" prov="estimated" /><Stat label="Saliti/giorno" value={n0(m.boardingsDay)} prov="estimated" /><Stat label="Riempimento punta" value={Math.round(m.loadFactorPeak * 100)} unit="%" /></div>
      <div className="stats-row"><Stat label="Vett·km/giorno" value={n0(m.vehKmDay)} /><Stat label="Costo esercizio" value={fmtEur(m.costYear)} unit="/anno" prov="estimated" /><Stat label="CO₂ evitata" value={n0(m.co2SavedTYear)} unit="t/anno" prov="estimated" /></div>
      {m.loadFactorPeak > 1 ? <p className="warn-line"><Icon name="warning" size={14} />Domanda stimata oltre la capacità in punta: aumenta la frequenza o la capacità dei veicoli.</p> : null}
      <Field label="Sosta alle fermate"><NumberField ariaLabel="Sosta TPL" value={sel.dwellS??spec.dwellS} min={0} max={600} unit="s" onCommit={dwellS=>upd({dwellS})}/></Field>
      <Button icon="play" busy={simulationStarting} onClick={async()=>{setSimulationStarting(true);try{await startProjectSimulation({mode:'microscopic',dailyTrips:60000,seed:42,scopeName:'Intero comune · TPL operativo'});}catch(error){toast.error('Simulazione TPL',String(error));}finally{setSimulationStarting(false);}}}>Simula traffico e TPL</Button>
      {operational && <><div className="stats-row"><Stat label="Mezzi attivi" value={operational.active}/><Stat label="Corse completate" value={operational.completed}/><Stat label="Saliti" value={operational.boarded}/><Stat label="In attesa" value={operational.waiting}/></div><div className="stats-row"><Stat label="Ritardo partenza" value={operational.meanDepartureDelayS.toFixed(1)} unit="s"/><Stat label="Attesa passeggeri" value={operational.passengerWaitS.toFixed(1)} unit="s"/><Stat label="Percorrenza effettiva" value={operational.meanTravelS.toFixed(1)} unit="s"/></div>{operational.issue&&<p role="alert" className="warn-line">{operational.issue}</p>}</>}
      <p className="muted">Esercizio sul tracciato A → B. Domanda alle fermate: ipotesi esplicita in pax/h, zero se non inserita. I mezzi stradali rispettano traffico e semafori; i tracciati su sede propria usano velocità e soste impostate.</p>
      <ol className="steps">{sel.stops.map((s, i) => (
        <li key={s.id}><span className="pin">{i + 1}</span>
          <input className="text-field inline" defaultValue={s.name} aria-label={`Nome fermata ${i + 1}`} onBlur={(e) => e.target.value !== s.name && upd({ stops: sel.stops.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) })} />
          <NumberField ariaLabel={`Domanda fermata ${i+1}`} value={s.arrivalsPerHour??0} min={0} max={10000} unit="pax/h" onCommit={arrivalsPerHour=>upd({stops:sel.stops.map(st=>st.id===s.id?{...st,arrivalsPerHour}:st)})}/>
          <Select ariaLabel={`Interscambio fermata ${i+1}`} value={s.transferTo?`${s.transferTo.lineId}|${s.transferTo.stopId}`:''} options={[{value:'',label:'Nessun interscambio'},...lines.filter(l=>l.id!==sel.id).flatMap(l=>l.stops.map(st=>({value:`${l.id}|${st.id}`,label:`${l.name} · ${st.name}`})))]} onChange={value=>{const [lineId,stopId]=value.split('|');upd({stops:sel.stops.map(st=>st.id===s.id?{...st,transferTo:value?{lineId:lineId!,stopId:stopId!,fraction:.5,walkS:120}:undefined}:st)});}}/>
          {s.transferTo&&<><NumberField ariaLabel={`Quota interscambio ${i+1}`} value={s.transferTo.fraction*100} min={0} max={100} unit="%" onCommit={v=>upd({stops:sel.stops.map(st=>st.id===s.id?{...st,transferTo:{...s.transferTo!,fraction:v/100}}:st)})}/><NumberField ariaLabel={`Cammino interscambio ${i+1}`} value={s.transferTo.walkS} min={0} max={7200} unit="s ipotizzati" onCommit={walkS=>upd({stops:sel.stops.map(st=>st.id===s.id?{...st,transferTo:{...s.transferTo!,walkS}}:st)})}/></>}
          <NumberField ariaLabel={`Quota discesa fermata ${i+1}`} value={(s.alightFraction??0)*100} min={0} max={100} unit="%" onCommit={v=>upd({stops:sel.stops.map(st=>st.id===s.id?{...st,alightFraction:v/100}:st)})}/>
          <button type="button" className="link" onClick={() => flyTo([s.at[0], s.at[1]], 18.5)}>vedi</button>
          <button type="button" className="link" onClick={() => upd({ stops: sel.stops.filter((x) => x.id !== s.id) })}>rimuovi</button></li>
      ))}</ol>
      <div className="inspector-actions">
        <Button icon="bus" onClick={() => setTool('transitStop')}>Aggiungi fermate</Button>
        <Button icon="sparkle" onClick={() => upd({ stops: autoStops(sel, baseline.origin as [number, number]) })}>Fermate automatiche ({spec.stopSpacingM} m)</Button>
        <Button icon="trash" variant="danger" onClick={onDelete}>Elimina linea</Button>
      </div>
    </Section>
  );
}

function BikeSharing() {
  const baseline = useApp((s) => s.baseline)!;
  const scenario = useApp((s) => s.scenario);
  const transit = usePicks((s) => s.transit);
  const sid = scenario?.id ?? 'baseline';
  const bs: BikeShare = transit.bikeshare?.[sid] ?? { system: 'Bike sharing', stations: [], dockless: false };
  const save = (next: BikeShare) => void usePicks.getState().saveTransit({ ...transit, bikeshare: { ...(transit.bikeshare ?? {}), [sid]: next } });
  const cov = useMemo(() => bikeCoverage(baseline, bs.stations), [baseline, bs.stations]);
  const propose = () => {
    const found = proposeBikeStations(baseline, baseline.bbox);
    if (!found.length) { toast.info('Bike sharing', 'Nessuna area abbastanza densa trovata.'); return; }
    save({ ...bs, stations: [...bs.stations, ...found.map((x, i) => ({ id: newId('bs'), name: `Stazione ${bs.stations.length + i + 1}`, at: x.at, docks: x.docks, ebikeShare: 0.4 }))] });
    toast.success('Stazioni proposte', `${found.length} stazioni dove i residenti stimati sono più densi`);
  };
  return (
    <Section title="Bike sharing" count={bs.stations.length} defaultOpen={false}>
      <div className="grid-2">
        <Field label="Nome del servizio"><TextField value={bs.system} ariaLabel="Nome servizio" onCommit={(v) => save({ ...bs, system: v })} /></Field>
        <Field label="Free floating"><Toggle checked={bs.dockless} label="Anche senza stazione" onChange={(v) => save({ ...bs, dockless: v })} /></Field>
      </div>
      <div className="stats-row"><Stat label="Stazioni" value={bs.stations.length} prov="project" /><Stat label="Stalli" value={cov.docks} /><Stat label="Copertura 300 m" value={cov.total ? Math.round((cov.covered / cov.total) * 100) : 0} unit="% abitanti" prov="estimated" /></div>
      <ul className="row-list">{bs.stations.slice(0, 60).map((st) => (
        <li key={st.id}>
          <input className="text-field inline grow" defaultValue={st.name} aria-label="Nome stazione" onBlur={(e) => e.target.value !== st.name && save({ ...bs, stations: bs.stations.map((x) => (x.id === st.id ? { ...x, name: e.target.value } : x)) })} />
          <NumberField value={st.docks} unit="stalli" min={4} max={60} decimals={0} ariaLabel="Stalli" onCommit={(v) => save({ ...bs, stations: bs.stations.map((x) => (x.id === st.id ? { ...x, docks: v } : x)) })} />
          <button type="button" className="link" onClick={() => flyTo([st.at[0], st.at[1]], 18)}>vedi</button>
          <button type="button" className="link" onClick={() => save({ ...bs, stations: bs.stations.filter((x) => x.id !== st.id) })}>rimuovi</button>
        </li>
      ))}</ul>
      <div className="inspector-actions">
        <Button icon="bike" onClick={() => setTool('bikeStation')}>Aggiungi stazioni</Button>
        <Button icon="sparkle" onClick={propose}>Proponi stazioni</Button>
        {bs.stations.length ? <Button variant="ghost" onClick={() => save({ ...bs, stations: [] })}>Svuota</Button> : null}
      </div>
    </Section>
  );
}

function NetworkSummary({ routes }: { routes: TransitRouteDesign[] }) {
  const baseline = useApp((s) => s.baseline)!;
  const s = useMemo(() => {
    const ms = routes.map((r) => lineMetrics(r, baseline));
    const stops = routes.flatMap((r) => r.stops.map((x) => x.at));
    return {
      fleet: ms.reduce((t, m) => t + m.fleet, 0), cost: ms.reduce((t, m) => t + m.costYear, 0), vkm: ms.reduce((t, m) => t + m.vehKmDay, 0),
      boardings: ms.reduce((t, m) => t + m.boardingsDay, 0), covered: stops.length ? catchment(baseline, stops, 500) : 0,
    };
  }, [routes, baseline]);
  if (!routes.length) return null;
  return (
    <Section title="Rete di progetto">
      <div className="stats-row"><Stat label="Flotta" value={s.fleet} unit="veicoli" /><Stat label="Costo esercizio" value={fmtEur(s.cost)} unit="/anno" prov="estimated" /><Stat label="Saliti/giorno" value={n0(s.boardings)} prov="estimated" /></div>
      <div className="stats-row"><Stat label="Vett·km/giorno" value={n0(s.vkm)} /><Stat label="Abitanti a 500 m" value={n0(s.covered)} prov="estimated" /><Stat label="Linee" value={routes.length} /></div>
    </Section>
  );
}

export function TransitPanel() {
  const scenario = useApp((s) => s.scenario);
  const { transit, selectedRouteId, newLineMode } = usePicks();
  useEffect(() => { void usePicks.getState().loadTransit(); toggleLayer('transit', true); toggleLayer('bikeshare', true); }, []);
  useEffect(() => { drawTransit(); }, [scenario?.id]);
  const routes = transit.design?.[scenario?.id ?? 'baseline'] ?? [];
  const sel = routes.find((r) => r.id === selectedRouteId);
  const save = (next: TransitRouteDesign[]) => void usePicks.getState().saveTransit({ ...transit, design: { ...(transit.design ?? {}), [scenario?.id ?? 'baseline']: next } });
  const upd = (p: Partial<TransitRouteDesign>) => sel && save(routes.map((r) => (r.id === sel.id ? { ...r, ...p } : r)));
  return (
    <div className="panel-stack">
      <Section title="Nuova linea">
        <div className="mode-grid">{MODE_ORDER.map((k) => (
          <button key={k} type="button" className={`mode-chip ${newLineMode === k ? 'is-on' : ''}`} onClick={() => { usePicks.setState({ newLineMode: k }); setTool('transitRoute'); }} style={{ ['--mode' as string]: MODES[k].color }}>
            <Icon name={MODES[k].icon} size={16} /><span>{MODES[k].label}</span>
          </button>
        ))}</div>
        <p className="muted">{MODES[newLineMode].label}: {MODES[newLineMode].rightOfWay.toLowerCase()} · {MODES[newLineMode].speedKmh} km/h · fermate ogni ~{MODES[newLineMode].stopSpacingM} m. {MODES[newLineMode].onRoad ? 'Il tracciato segue le strade tra i punti cliccati.' : 'Il tracciato resta come disegnato (sede propria).'}</p>
      </Section>
      <Section title="Linee di progetto" count={routes.length}>
        {routes.length ? (
          <ul className="route-list">{routes.map((r) => (
            <li key={r.id}><button type="button" className={`route-pick ${r.id === selectedRouteId ? 'is-on' : ''}`} onClick={() => {
              usePicks.setState({ selectedRouteId: r.id });
              const xs = r.line.map((p) => p[0]), ys = r.line.map((p) => p[1]);
              fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 80);
            }}><span className="swatch" style={{ background: r.color }} /><strong>{r.name}</strong><span className="hint">{MODES[r.mode]?.label} · {r.stops.length} fermate · ogni {r.headways.peak}′</span></button></li>
          ))}</ul>
        ) : <Empty icon="transit" title="Nessuna linea di progetto">Scegli il modo qui sopra e clicca il percorso sulla mappa (Invio per finire).</Empty>}
      </Section>
      {sel ? <LineEditor sel={sel} upd={upd} onDelete={() => void confirmAction('Eliminare la linea?', `${sel.name} e le sue fermate verranno rimosse dallo scenario.`, { danger: true, confirmLabel: 'Elimina' }).then((y) => { if (y) { save(routes.filter((r) => r.id !== sel.id)); usePicks.setState({ selectedRouteId: null }); } })} /> : null}
      <NetworkSummary routes={routes} />
      <BikeSharing />
      <Gtfs />
      <Realtime />
    </div>
  );
}
