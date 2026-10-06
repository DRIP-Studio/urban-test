import { useMemo, useState } from 'react';
import { LocalFrame, geom, type LngLat, type Network, type Route, type TravelMode } from '@drip-urban/core';
import { api } from '../api/client';
import { flyTo, setSource } from '../map/mapStore';
import { setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { drawRoutePins, usePicks } from '../tools/picks';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Stat, Toggle, FieldGroup } from '../ui/controls';
import { Icon } from '../ui/Icon';

const MODES: { value: TravelMode; label: string }[] = [
  { value: 'car', label: 'Auto' }, { value: 'truck', label: 'Camion' }, { value: 'bus', label: 'Bus' },
  { value: 'bike', label: 'Bici' }, { value: 'walk', label: 'A piedi' }, { value: 'emergency', label: 'Emergenza' },
];
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const fmtT = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
const fmtD = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`);
const fmtClock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60) % 60).padStart(2, '0')}`;
const MAN: Record<string, string> = { depart: 'route', straight: 'chevronRight', left: 'chevronLeft', right: 'chevronRight', slight_left: 'chevronLeft', slight_right: 'chevronRight', uturn: 'undo', roundabout: 'roundabout', arrive: 'pin' };

/** Name of the road nearest to a point (within 40 m), for readable origins and destinations. */
function placeName(net: Network | null, origin: LngLat | undefined, at: LngLat | null): string {
  if (!at) return '';
  if (net && origin) {
    const f = new LocalFrame(origin);
    const p = f.toMetric(at) as geom.V;
    let best: { name: string; d: number } | null = null;
    for (const r of Object.values(net.roads)) {
      if (!r.name) continue;
      const q = f.toMetric(r.axis[0]!);
      if (Math.abs(q[0] - p[0]) > 600 || Math.abs(q[1] - p[1]) > 600) continue;
      const d = geom.project(r.axis.map((x) => f.toMetric(x) as geom.V), p).d;
      if (d < 40 && (!best || d < best.d)) best = { name: r.name, d };
    }
    if (best) return best.name;
  }
  return `${at[1].toFixed(5)}, ${at[0].toFixed(5)}`;
}

/** Main roads of a route (longest named stretches), to tell alternatives apart. */
const mainRoads = (r: Route) => [...r.steps].filter((s) => s.roadName && s.maneuver !== 'arrive').sort((a, b) => b.distanceM - a.distanceM).slice(0, 2).map((s) => s.roadName).join(', ');

function gpx(r: Route, name: string): string {
  const pts = r.line.map(([lon, lat]) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>`).join('');
  const esc = (t: string) => t.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="DRIP Urban" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

function Steps({ r, departMin }: { r: Route; departMin: number }) {
  let t = departMin * 60;
  return (
    <ol className="steps">
      {r.steps.map((s, i) => {
        const at = t; t += s.durationS;
        return (
          <li key={i}>
            <button type="button" className="step-btn" onClick={() => flyTo([s.at[0], s.at[1]], 18)} title="Inquadra in mappa">
              <Icon name={MAN[s.maneuver] ?? 'chevronRight'} size={15} /><span>{s.instruction}</span>
              <span className="hint mono">{s.distanceM > 0 ? fmtD(s.distanceM) : fmtClock(at / 60)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Origin or destination picked by street name (offline, from the network) or by address (geocoder). */
function PlaceSearch({ label, value, onPick }: { label: string; value: string; onPick: (at: LngLat) => void }) {
  const net = useApp((s) => s.network);
  const project = useApp((s) => s.project);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => [...new Set(Object.values(net?.roads ?? {}).map((r) => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')), [net]);
  const go = async () => {
    const text = q.trim();
    if (!text || !net) return;
    // A street of the network: its longest stretch, at mid length.
    const roads = Object.values(net.roads).filter((r) => r.name.toLowerCase() === text.toLowerCase());
    if (roads.length) {
      const f = new LocalFrame(roads[0]!.axis[0]!);
      const r = roads.reduce((a, b) => (geom.lengthOf(b.axis.map((x) => f.toMetric(x) as geom.V)) > geom.lengthOf(a.axis.map((x) => f.toMetric(x) as geom.V)) ? b : a));
      const axis = r.axis.map((x) => f.toMetric(x) as geom.V);
      onPick(f.toLngLat(geom.sampleAt(axis, geom.lengthOf(axis) / 2).p));
      setQ('');
      return;
    }
    setBusy(true);
    try {
      const found = await api.get<{ name: string; at: [number, number] }[]>(`/api/geocode?q=${encodeURIComponent(text)}${project ? `&bbox=${project.bbox.join(',')}` : ''}`);
      if (!found.length) toast.info('Nessun risultato', `«${text}» non trovato nell'area del progetto.`);
      else { onPick(found[0]!.at); setQ(''); }
    } catch (e) { toast.error('Ricerca indirizzo', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const listId = `nav-streets-${label}`;
  return (
    <div className="nav-place">
      <span className="pin">{label}</span>
      <input type="search" list={listId} value={q} placeholder={value || 'Via, indirizzo o clic sulla mappa'} aria-label={`Punto ${label}`}
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} />
      <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      <button type="button" className="icon-btn" disabled={!q.trim() || busy} aria-label={`Cerca il punto ${label}`} onClick={() => void go()}><Icon name="search" size={14} /></button>
    </div>
  );
}

export function Navigator() {
  const { mode, departure, from, to, via, addingVia, vehicle, result, routing, traffic, altIndex } = usePicks();
  const net = useApp((s) => s.network);
  const origin = useApp((s) => s.baseline?.origin);
  const set = usePicks.setState;
  const rerun = () => void usePicks.getState().runRoute();
  const setEnd = (which: 'from' | 'to', at: LngLat) => {
    set(which === 'from' ? { from: at } : { to: at });
    drawRoutePins();
    flyTo([at[0], at[1]]);
    if (usePicks.getState().from && usePicks.getState().to) rerun();
  };
  const t = result?.today, p = result?.project;
  const alts = result?.alternatives ?? [];
  const nameA = placeName(net, origin, from), nameB = placeName(net, origin, to);
  const exportGpx = () => {
    if (!p?.found) return;
    const url = URL.createObjectURL(new Blob([gpx(p, `${nameA} → ${nameB}`)], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = `percorso-${mode}.gpx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <Section title="Navigatore sullo scenario">
        <FieldGroup label="Mezzo"><Segmented<TravelMode> label="Mezzo" size="sm" value={mode} options={MODES} onChange={(v) => { set({ mode: v }); rerun(); }} /></FieldGroup>
        <div className="grid-2">
          <Field label="Giorno"><Select value={String(departure.day)} ariaLabel="Giorno" options={DAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(v) => { set({ departure: { ...departure, day: Number(v) } }); rerun(); }} /></Field>
          <Field label="Partenza"><NumberField value={departure.minutes / 60} unit="h" min={0} max={23.75} step={0.25} ariaLabel="Ora di partenza" onCommit={(v) => { set({ departure: { ...departure, minutes: Math.round(v * 60) } }); rerun(); }} /></Field>
        </div>
        <Toggle label="Tempi con il traffico stimato (congestione)" checked={traffic} onChange={(v) => { set({ traffic: v }); rerun(); }} />
        {mode === 'truck' ? (
          <div className="grid-2">
            <Field label="Massa a pieno carico"><NumberField value={vehicle.weightT} unit="t" min={3.5} max={44} step={0.5} decimals={1} ariaLabel="Massa" onCommit={(v) => { set({ vehicle: { ...vehicle, weightT: v } }); rerun(); }} /></Field>
            <Field label="Altezza"><NumberField value={vehicle.heightM} unit="m" min={2} max={4.5} step={0.1} decimals={2} ariaLabel="Altezza" onCommit={(v) => { set({ vehicle: { ...vehicle, heightM: v } }); rerun(); }} /></Field>
            <Field label="Larghezza"><NumberField value={vehicle.widthM} unit="m" min={1.8} max={3} step={0.05} decimals={2} ariaLabel="Larghezza" onCommit={(v) => { set({ vehicle: { ...vehicle, widthM: v } }); rerun(); }} /></Field>
            <Field label="Lunghezza"><NumberField value={vehicle.lengthM} unit="m" min={5} max={18.75} step={0.5} decimals={1} ariaLabel="Lunghezza" onCommit={(v) => { set({ vehicle: { ...vehicle, lengthM: v } }); rerun(); }} /></Field>
            <Field label="Massa per asse"><NumberField value={vehicle.axleLoadT} unit="t" min={2} max={13} step={0.5} decimals={1} ariaLabel="Massa per asse" onCommit={(v) => { set({ vehicle: { ...vehicle, axleLoadT: v } }); rerun(); }} /></Field>
            <Field label="Merci pericolose"><Toggle checked={vehicle.hazmat} label="ADR" onChange={(v) => { set({ vehicle: { ...vehicle, hazmat: v } }); rerun(); }} /></Field>
          </div>
        ) : null}
        <div className="od">
          <PlaceSearch label="A" value={nameA} onPick={(at) => setEnd('from', at)} />
          {via.map((v, i) => (
            <div key={i} className="nav-via"><span className="pin is-via">{i + 1}</span><span className="grow">{placeName(net, origin, v)}</span>
              <button type="button" className="icon-btn" aria-label={`Togli tappa ${i + 1}`} onClick={() => { set({ via: via.filter((_, j) => j !== i) }); drawRoutePins(); rerun(); }}><Icon name="close" size={12} /></button></div>
          ))}
          <PlaceSearch label="B" value={nameB} onPick={(at) => setEnd('to', at)} />
        </div>
        <div className="inspector-actions">
          <Button icon="route" onClick={() => setTool('route')}>Scegli sulla mappa</Button>
          <Button icon="refresh" variant="ghost" disabled={!from || !to} onClick={() => usePicks.getState().swapEnds()}>Inverti A↔B</Button>
          <Button icon="waypoint" disabled={!from || !to || via.length >= 8} variant={addingVia ? 'primary' : 'default'} onClick={() => { set({ addingVia: !addingVia }); setTool('route'); }}>{addingVia ? 'Clic sulla tappa…' : 'Aggiungi tappa'}</Button>
          <Button variant="ghost" onClick={() => { set({ from: null, to: null, via: [], addingVia: false, result: null }); setSource('route', null); setSource('compare', null); setSource('draft', null); }}>Azzera</Button>
        </div>
      </Section>
      {routing ? <p className="muted">Calcolo percorso…</p> : null}
      {p && t ? (
        <>
          {alts.length > 1 ? (
            <Section title="Percorsi" count={alts.length}>
              <ul className="alt-list" role="listbox" aria-label="Percorsi alternativi">
                {alts.map((r, i) => (
                  <li key={i}>
                    <button type="button" role="option" aria-selected={i === altIndex} className={`alt-card${i === altIndex ? ' is-on' : ''}`} onClick={() => usePicks.getState().selectAlternative(i)}>
                      <strong>{fmtT(r.durationS)}</strong>
                      <span>{fmtD(r.distanceM)}{i > 0 ? ` · +${Math.max(1, Math.round((r.durationS - alts[0]!.durationS) / 60))} min` : ' · il più rapido'}</span>
                      <span className="muted">via {mainRoads(r) || '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title="Oggi e progetto">
            <div className="stats-row">
              <Stat label="Durata progetto" value={p.found ? fmtT(p.durationS) : 'non raggiungibile'} delta={p.found && t.found ? { value: Math.round((p.durationS - t.durationS) / 6) / 10, goodWhen: 'down', unit: ' min' } : undefined} />
              <Stat label="Arrivo" value={p.found ? fmtClock(departure.minutes + p.durationS / 60) : '—'} />
              <Stat label="Distanza" value={p.found ? fmtD(p.distanceM) : '—'} delta={p.found && t.found ? { value: Math.round(p.distanceM - t.distanceM), goodWhen: 'down', unit: ' m' } : undefined} />
              <Stat label="Oggi" value={t.found ? fmtT(t.durationS) : 'non raggiungibile'} />
            </div>
            <p className="muted">Linea tratteggiata grigia: la città di oggi. Linea azzurra: lo scenario (sensi unici, chiusure, ZTL attive all'orario scelto, velocità, rotatorie, semafori). {traffic ? 'Tempi con la congestione della stima DRIP del traffico (BPR).' : 'Tempi a flusso libero più i ritardi agli incroci.'}</p>
            {[...p.warnings, ...(!t.found ? ['Oggi non esiste un percorso con queste regole'] : [])].map((w) => <p key={w} className="warn-line"><Icon name="warning" size={14} />{w}</p>)}
            {p.found ? <Steps r={p} departMin={departure.minutes} /> : null}
            {p.found ? <div className="inspector-actions"><Button icon="download" variant="ghost" onClick={exportGpx}>Esporta GPX</Button></div> : null}
          </Section>
        </>
      ) : !routing ? <Empty icon="route" title="Nessun percorso">Scrivi una via o un indirizzo per A e B, oppure clicca due punti sulla mappa: il navigatore usa la rete dello scenario attivo e la confronta con quella di oggi.</Empty> : null}
    </>
  );
}
