import type { Route, TravelMode } from '@drip-urban/core';
import { setSource } from '../map/mapStore';
import { setTool } from '../state/store';
import { drawRoutePins, usePicks } from '../tools/picks';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Stat, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';

const MODES: { value: TravelMode; label: string }[] = [
  { value: 'car', label: 'Auto' }, { value: 'truck', label: 'Camion' }, { value: 'bus', label: 'Bus' },
  { value: 'bike', label: 'Bici' }, { value: 'walk', label: 'A piedi' }, { value: 'emergency', label: 'Emergenza' },
];
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const fmtT = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
const fmtD = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`);
const MAN: Record<string, string> = { depart: 'route', straight: 'chevronRight', left: 'chevronLeft', right: 'chevronRight', slight_left: 'chevronLeft', slight_right: 'chevronRight', uturn: 'undo', roundabout: 'roundabout', arrive: 'pin' };

function Steps({ r }: { r: Route }) {
  return <ol className="steps">{r.steps.map((s, i) => <li key={i}><Icon name={MAN[s.maneuver] ?? 'chevronRight'} size={15} /><span>{s.instruction}</span>{s.distanceM > 0 ? <span className="hint">{fmtD(s.distanceM)}</span> : null}</li>)}</ol>;
}

export function Navigator() {
  const { mode, departure, from, to, via, addingVia, vehicle, result, routing } = usePicks();
  const set = usePicks.setState;
  const rerun = () => void usePicks.getState().runRoute();
  const t = result?.today, p = result?.project;
  return (
    <>
      <Section title="Navigatore sullo scenario">
        <Field label="Mezzo"><Segmented<TravelMode> label="Mezzo" size="sm" value={mode} options={MODES} onChange={(v) => { set({ mode: v }); rerun(); }} /></Field>
        <div className="grid-2">
          <Field label="Giorno"><Select value={String(departure.day)} ariaLabel="Giorno" options={DAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(v) => { set({ departure: { ...departure, day: Number(v) } }); rerun(); }} /></Field>
          <Field label="Partenza"><NumberField value={departure.minutes / 60} unit="h" min={0} max={23.75} step={0.25} ariaLabel="Ora di partenza" onCommit={(v) => { set({ departure: { ...departure, minutes: Math.round(v * 60) } }); rerun(); }} /></Field>
        </div>
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
          <div><span className="pin">A</span>{from ? `${from[1].toFixed(5)}, ${from[0].toFixed(5)}` : 'Clic sulla mappa per l\'origine'}</div>
          {via.map((v, i) => (
            <div key={i}><span className="pin is-via">{i + 1}</span>{`${v[1].toFixed(5)}, ${v[0].toFixed(5)}`}
              <button type="button" className="icon-btn" aria-label={`Togli tappa ${i + 1}`} onClick={() => { set({ via: via.filter((_, j) => j !== i) }); drawRoutePins(); rerun(); }}><Icon name="close" size={12} /></button></div>
          ))}
          <div><span className="pin">B</span>{to ? `${to[1].toFixed(5)}, ${to[0].toFixed(5)}` : from ? 'Clic per la destinazione' : '—'}</div>
        </div>
        <div className="inspector-actions">
          <Button icon="route" onClick={() => setTool('route')}>Scegli punti</Button>
          <Button icon="waypoint" disabled={!from || !to || via.length >= 8} variant={addingVia ? 'primary' : 'default'} onClick={() => { set({ addingVia: !addingVia }); setTool('route'); }}>{addingVia ? 'Clic sulla tappa…' : 'Aggiungi tappa'}</Button>
          <Button variant="ghost" onClick={() => { set({ from: null, to: null, via: [], addingVia: false, result: null }); setSource('route', null); setSource('compare', null); setSource('draft', null); }}>Azzera</Button>
        </div>
      </Section>
      {routing ? <p className="muted">Calcolo percorso…</p> : null}
      {p && t ? (
        <Section title="Oggi e progetto">
          <div className="stats-row">
            <Stat label="Durata progetto" value={p.found ? fmtT(p.durationS) : 'non raggiungibile'} delta={p.found && t.found ? { value: Math.round((p.durationS - t.durationS) / 6) / 10, goodWhen: 'down', unit: ' min' } : undefined} />
            <Stat label="Distanza" value={p.found ? fmtD(p.distanceM) : '—'} delta={p.found && t.found ? { value: Math.round(p.distanceM - t.distanceM), goodWhen: 'down', unit: ' m' } : undefined} />
            <Stat label="Oggi" value={t.found ? fmtT(t.durationS) : 'non raggiungibile'} />
          </div>
          <p className="muted">Linea tratteggiata grigia: percorso con la città di oggi. Linea azzurra: con lo scenario (sensi unici, chiusure, ZTL attive all'orario scelto, velocità, rotatorie).</p>
          {[...p.warnings, ...(!t.found ? ['Oggi non esiste un percorso con queste regole'] : [])].map((w) => <p key={w} className="warn-line"><Icon name="warning" size={14} />{w}</p>)}
          {p.found ? <Steps r={p} /> : null}
        </Section>
      ) : !routing ? <Empty icon="route" title="Nessun percorso">Clicca due punti sulla mappa: il navigatore usa la rete dello scenario attivo e la confronta con quella di oggi.</Empty> : null}
    </>
  );
}
