import { useEffect, useRef, useState } from 'react';
import { LocalFrame, geom } from '@drip-urban/core';
import { api } from '../api/client';
import { fc, type Feature } from '../engine/geojson';
import { fitBounds, setSource, toggleLayer } from '../map/mapStore';
import { setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { drawTransit, usePicks, type TransitRouteDesign } from '../tools/picks';
import { Button, Empty, Field, NumberField, ProvBadge, Section, Select, Stat, TextField } from '../ui/controls';
import { confirmAction } from '../ui/confirm';

function routeMetrics(r: TransitRouteDesign, origin: [number, number]) {
  const f = new LocalFrame(origin);
  const L = geom.lengthOf(r.line.map((p) => f.toMetric(p) as geom.V));
  const dwell = r.stops.length * 25;
  const oneWayS = L / (r.speedKmh / 3.6) + dwell;
  const cycleMin = (2 * oneWayS) / 60 + 6; // two directions + terminal layover
  const vehicles = Math.ceil(cycleMin / Math.max(1, r.headwayMin));
  const capacity = Math.round((60 / Math.max(1, r.headwayMin)) * r.capacity);
  const spacing = r.stops.length > 1 ? L / (r.stops.length - 1) : null;
  return { L, oneWayMin: oneWayS / 60, cycleMin, vehicles, capacity, spacing };
}

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
  return (
    <Section title="Rete esistente (GTFS)">
      {g ? (
        <>
          <div className="stats-row"><Stat label="Linee" value={g.routes.length} prov="existing" /><Stat label="Fermate" value={g.stops.length} /><Stat label="Operatori" value={g.agencies.length} /></div>
          <p className="muted">Fonte: {g.source} · importato {new Date(g.importedAt).toLocaleString('it-IT')}</p>
          <ul className="route-list">{g.routes.slice(0, 40).map((r) => (
            <li key={r.id}><span className="swatch" style={{ background: r.color }} /><strong>{r.shortName}</strong><span>{r.longName}</span><span className="hint">{r.amPeakHeadwayMin ? `ogni ${r.amPeakHeadwayMin}′ (7-9)` : `${r.tripsPerDay} corse`}</span></li>
          ))}</ul>
        </>
      ) : <Empty icon="transit" title="Nessun GTFS importato">Carica il feed GTFS dell'operatore (ZIP) per vedere linee, fermate e frequenze reali.</Empty>}
      <input ref={file} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); void upload(fd); } e.target.value = ''; }} />
      <div className="inspector-actions"><Button icon="import" busy={busy} onClick={() => file.current?.click()}>Carica GTFS (.zip)</Button></div>
      <Field label="oppure URL del feed"><TextField value={url} placeholder="https://…/gtfs.zip" ariaLabel="URL GTFS" onCommit={setUrl} /></Field>
      <Button size="sm" disabled={!url} busy={busy} onClick={() => void upload(null)}>Importa da URL</Button>
    </Section>
  );
}

function Realtime() {
  const [data, setData] = useState<{ status: string; vehicles: { id: string; at: [number, number]; routeId: string }[]; message?: string } | null>(null);
  const load = () => api.get<typeof data>('/api/transit/realtime').then((d) => {
    setData(d);
    setSource('rt-vehicles', d?.status === 'ok' ? fc(d.vehicles.map((v): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: v.at }, properties: { id: v.id, route: v.routeId } }))) : null);
  }).catch(() => setData({ status: 'error', vehicles: [] }));
  return (
    <Section title="Tempo reale (GTFS-RT)" defaultOpen={false}>
      <Button size="sm" icon="refresh" onClick={() => void load()}>Leggi posizioni veicoli</Button>
      {data?.status === 'not_configured' ? <p className="muted">URL GTFS-RT non configurato in Impostazioni: nessun dato live viene simulato.</p> : null}
      {data?.status === 'ok' ? <p><ProvBadge kind="live" /> {data.vehicles.length} veicoli in servizio</p> : null}
      {data?.status === 'error' ? <p className="warn-line">{data.message ?? 'Feed non raggiungibile'}</p> : null}
    </Section>
  );
}

export function TransitPanel() {
  const baseline = useApp((s) => s.baseline);
  const scenario = useApp((s) => s.scenario);
  const { transit, selectedRouteId } = usePicks();
  useEffect(() => { void usePicks.getState().loadTransit(); toggleLayer('transit', true); }, []);
  useEffect(() => { drawTransit(); }, [scenario?.id]);
  const routes = transit.design?.[scenario?.id ?? 'baseline'] ?? [];
  const sel = routes.find((r) => r.id === selectedRouteId);
  const save = (next: TransitRouteDesign[]) => void usePicks.getState().saveTransit({ ...transit, design: { ...(transit.design ?? {}), [scenario?.id ?? 'baseline']: next } });
  const upd = (p: Partial<TransitRouteDesign>) => sel && save(routes.map((r) => (r.id === sel.id ? { ...r, ...p } : r)));
  const m = sel && baseline ? routeMetrics(sel, baseline.origin as [number, number]) : null;
  return (
    <div className="panel-stack">
      <Section title="Linee di progetto" count={routes.length} actions={<Button size="sm" icon="plus" onClick={() => setTool('transitRoute')}>Nuova</Button>}>
        {routes.length ? (
          <ul className="route-list">{routes.map((r) => (
            <li key={r.id}><button type="button" className={`route-pick ${r.id === selectedRouteId ? 'is-on' : ''}`} onClick={() => {
              usePicks.setState({ selectedRouteId: r.id });
              const xs = r.line.map((p) => p[0]), ys = r.line.map((p) => p[1]);
              fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 80);
            }}><span className="swatch" style={{ background: r.color }} /><strong>{r.name}</strong><span className="hint">{r.stops.length} fermate · ogni {r.headwayMin}′</span></button></li>
          ))}</ul>
        ) : <Empty icon="transit" title="Nessuna linea di progetto">Disegna un percorso con lo strumento Linea TPL (L), poi aggiungi le fermate (B).</Empty>}
      </Section>
      {sel && m ? (
        <Section title={sel.name}>
          <div className="grid-2">
            <Field label="Nome"><TextField value={sel.name} ariaLabel="Nome linea" onCommit={(v) => upd({ name: v })} /></Field>
            <Field label="Modo"><Select value={sel.mode} ariaLabel="Modo" options={[{ value: 'bus', label: 'Bus' }, { value: 'brt', label: 'BRT' }, { value: 'tram', label: 'Tram' }]} onChange={(v) => upd({ mode: v })} /></Field>
            <Field label="Frequenza"><NumberField value={sel.headwayMin} unit="min" min={2} max={120} decimals={0} ariaLabel="Frequenza" onCommit={(v) => upd({ headwayMin: v })} /></Field>
            <Field label="Velocità commerciale"><NumberField value={sel.speedKmh} unit="km/h" min={8} max={45} decimals={0} ariaLabel="Velocità" onCommit={(v) => upd({ speedKmh: v })} /></Field>
            <Field label="Prima corsa"><TextField value={sel.firstDeparture} ariaLabel="Prima corsa" onCommit={(v) => /^\d{2}:\d{2}$/.test(v) && upd({ firstDeparture: v })} /></Field>
            <Field label="Ultima corsa"><TextField value={sel.lastDeparture} ariaLabel="Ultima corsa" onCommit={(v) => /^\d{2}:\d{2}$/.test(v) && upd({ lastDeparture: v })} /></Field>
            <Field label="Veicolo"><Select value={sel.vehicle} ariaLabel="Veicolo" options={['Minibus 8 m', 'Autobus 10 m', 'Autobus 12 m', 'Autobus snodato 18 m', 'Tram 32 m'].map((v) => ({ value: v, label: v }))} onChange={(v) => upd({ vehicle: v, capacity: { 'Minibus 8 m': 45, 'Autobus 10 m': 70, 'Autobus 12 m': 85, 'Autobus snodato 18 m': 140, 'Tram 32 m': 220 }[v] ?? sel.capacity })} /></Field>
            <Field label="Capacità per veicolo"><NumberField value={sel.capacity} unit="pax" min={10} max={400} decimals={0} ariaLabel="Capacità" onCommit={(v) => upd({ capacity: v })} /></Field>
          </div>
          <div className="stats-row"><Stat label="Lunghezza" value={(m.L / 1000).toFixed(2).replace('.', ',')} unit="km" prov="project" /><Stat label="Percorrenza" value={Math.round(m.oneWayMin)} unit="min" /><Stat label="Veicoli necessari" value={m.vehicles} /></div>
          <div className="stats-row"><Stat label="Capacità" value={m.capacity.toLocaleString('it-IT')} unit="pax/h" /><Stat label="Interdistanza fermate" value={m.spacing ? Math.round(m.spacing) : '—'} unit="m" /><Stat label="Ciclo" value={Math.round(m.cycleMin)} unit="min" /></div>
          <p className="muted">Percorrenza = lunghezza / velocità commerciale + 25 s per fermata; ciclo con 6 min di sosta ai capolinea.</p>
          <ol className="steps">{sel.stops.map((s, i) => <li key={s.id}><span className="pin">{i + 1}</span><span>{s.name}</span><button type="button" className="link" onClick={() => upd({ stops: sel.stops.filter((x) => x.id !== s.id) })}>rimuovi</button></li>)}</ol>
          <div className="inspector-actions">
            <Button icon="bus" onClick={() => setTool('transitStop')}>Aggiungi fermate</Button>
            <Button icon="trash" variant="danger" onClick={() => void confirmAction('Eliminare la linea?', `${sel.name} e le sue fermate verranno rimosse dallo scenario.`, { danger: true, confirmLabel: 'Elimina' }).then((y) => { if (y) { save(routes.filter((r) => r.id !== sel.id)); usePicks.setState({ selectedRouteId: null }); } })}>Elimina linea</Button>
          </div>
        </Section>
      ) : null}
      <Gtfs />
      <Realtime />
    </div>
  );
}
