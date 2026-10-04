import type { BayPurpose, Marking, MarkingColor, MarkingKind, Road, RoadFeature, RoadFeatureKind, RoadStructure, TurnKind } from '@drip-urban/core';
import { LocalFrame, geom, humpLimits } from '@drip-urban/core';
import { commit, useApp } from '../state/store';
import { CALMING } from '../tools/streetscape';
import { useTool } from '../tools/toolState';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Stat, TextField, FieldGroup } from '../ui/controls';

/** Marking types with a small plan-view preview (white on asphalt). */
type MkTool = MarkingKind | 'bollards';
const MARKINGS: { kind: MkTool; label: string; ref: string; draw: string; group: string }[] = [
  { group: 'Linee', kind: 'line_solid', label: 'Linea continua', ref: 'art. 138', draw: 'M4 14h40' },
  { group: 'Linee', kind: 'line_dashed', label: 'Linea tratteggiata', ref: 'art. 138', draw: 'M4 14h9M19 14h9M34 14h9' },
  { group: 'Linee', kind: 'line_double', label: 'Doppia continua', ref: 'art. 138', draw: 'M4 11h40M4 17h40' },
  { group: 'Linee', kind: 'line_mixed', label: 'Mista continua/tratteggiata', ref: 'art. 138', draw: 'M4 11h40M4 17h9M19 17h9M34 17h9' },
  { group: 'Linee', kind: 'line_yellow', label: 'Linea gialla (cantiere, sosta vietata)', ref: 'artt. 138, 151', draw: 'M4 14h40' },
  { group: 'Linee', kind: 'zigzag', label: 'Zig-zag (fermata, divieto di sosta)', ref: 'art. 151', draw: 'M4 18l5-8 5 8 5-8 5 8 5-8 5 8 5-8' },
  { group: 'Incroci e attraversamenti', kind: 'stop_line', label: 'Linea di arresto STOP', ref: 'art. 144', draw: 'M4 10h40v8H4z' },
  { group: 'Incroci e attraversamenti', kind: 'give_way_line', label: 'Linea dare precedenza', ref: 'art. 144', draw: 'M4 12h5v4H4zM13 12h5v4h-5zM22 12h5v4h-5zM31 12h5v4h-5zM40 12h4v4h-4z' },
  { group: 'Incroci e attraversamenti', kind: 'give_way_triangle', label: 'Triangolo dare precedenza', ref: 'art. 144', draw: 'M14 6h20L24 24z' },
  { group: 'Incroci e attraversamenti', kind: 'shark_teeth', label: 'Denti di squalo', ref: 'fig. II.432', draw: 'M4 8l3 10 3-10M12 8l3 10 3-10M20 8l3 10 3-10M28 8l3 10 3-10M36 8l3 10 3-10' },
  { group: 'Incroci e attraversamenti', kind: 'zebra', label: 'Attraversamento pedonale (zebre)', ref: 'art. 145', draw: 'M8 4v20M15 4v20M22 4v20M29 4v20M36 4v20' },
  { group: 'Incroci e attraversamenti', kind: 'bike_crossing', label: 'Attraversamento ciclabile', ref: 'art. 146', draw: 'M4 8h4M12 8h4M20 8h4M28 8h4M36 8h4M4 20h4M12 20h4M20 20h4M28 20h4M36 20h4' },
  { group: 'Incroci e attraversamenti', kind: 'box_junction', label: 'Incrocio da non impegnare (giallo)', ref: 'art. 151', draw: 'M6 6h36v16H6zM6 6l36 16M42 6L6 22' },
  { group: 'Frecce e scritte', kind: 'arrow', label: 'Freccia direzionale', ref: 'art. 147', draw: 'M24 24V9M18 13l6-6 6 6' },
  { group: 'Frecce e scritte', kind: 'text', label: 'Scritta (STOP, BUS, SCUOLA…)', ref: 'art. 148', draw: 'M8 20V8M8 8h7M8 14h5M20 8v12M20 8l6 12V8M31 8h8M35 8v12' },
  { group: 'Frecce e scritte', kind: 'speed_number', label: 'Limite di velocità sulla carreggiata', ref: 'art. 148', draw: 'M10 8h8l-8 12h8M24 8h8v12h-8zM24 8v12' },
  { group: 'Frecce e scritte', kind: 'symbol', label: 'Simbolo (bici, disabili, pedoni, scuola)', ref: 'art. 148', draw: 'M14 18a4 4 0 108 0 4 4 0 10-8 0M26 18a4 4 0 108 0 4 4 0 10-8 0M18 18l5-6 7 6' },
  { group: 'Sosta', kind: 'parking_bays', label: 'Stalli di sosta (liberi, pagamento, disabili, carico/scarico, taxi, rosa, ricarica)', ref: 'art. 149', draw: 'M4 8h40M4 8v12M14 8v12M24 8v12M34 8v12M44 8v12M4 20h40' },
  { group: 'Sosta', kind: 'bollards', label: 'Dissuasori di sosta (paletti)', ref: 'art. 180 Reg.', draw: 'M8 10v12M16 10v12M24 10v12M32 10v12M40 10v12' },
  { group: 'Corsie riservate', kind: 'bus_lane', label: 'Corsia bus / preferenziale', ref: 'art. 140', draw: 'M4 6h40M10 12h6v10h-6zM20 12v10M28 12h6' },
  { group: 'Corsie riservate', kind: 'bike_lane', label: 'Corsia ciclabile', ref: 'DM 557/1999', draw: 'M4 6h40M14 18a3 3 0 106 0 3 3 0 10-6 0M26 18a3 3 0 106 0 3 3 0 10-6 0' },
  { group: 'Aree e isole', kind: 'hatch', label: 'Zebratura (isola di traffico)', ref: 'art. 150', draw: 'M6 22L22 6M14 22L30 6M22 22L38 6M30 22L42 10' },
  { group: 'Aree e isole', kind: 'island', label: 'Isola spartitraffico rialzata', ref: 'art. 150, DM 19/4/2006', draw: 'M6 14l12-8h24v16H18z' },
  { group: 'Aree e isole', kind: 'chevrons', label: 'Chevron (deviazione)', ref: 'art. 150', draw: 'M6 20l8-12 8 12M22 20l8-12 8 12' },
];
const BAY_PURPOSE: { value: BayPurpose; label: string }[] = [
  { value: 'free', label: 'Liberi (bianchi)' }, { value: 'paid', label: 'A pagamento (blu)' }, { value: 'disabled', label: 'Persone con disabilità (giallo, 3,2 m)' },
  { value: 'loading', label: 'Carico e scarico (giallo)' }, { value: 'taxi', label: 'Taxi (giallo)' }, { value: 'pink', label: 'Rosa: gestanti e genitori' },
  { value: 'electric', label: 'Ricarica veicoli elettrici (verde)' }, { value: 'residents', label: 'Residenti' }, { value: 'motorcycle', label: 'Motocicli (1 × 2 m)' },
];
const COLORS: { value: MarkingColor; label: string }[] = [
  { value: 'white', label: 'Bianco' }, { value: 'yellow', label: 'Giallo' }, { value: 'blue', label: 'Blu (sosta a pagamento)' },
  { value: 'red', label: 'Rosso' }, { value: 'pink', label: 'Rosa (sosta gestanti)' }, { value: 'green', label: 'Verde (ciclabile)' },
];
const SYMBOLS = [{ value: 'bike', label: 'Bicicletta' }, { value: 'wheelchair', label: 'Persone con disabilità' }, { value: 'pedestrian', label: 'Pedoni' }, { value: 'bus', label: 'Bus' }, { value: 'school', label: 'Scuola' }];
const ARROWS = [{ value: 'through', label: 'Dritto' }, { value: 'left', label: 'Sinistra' }, { value: 'right', label: 'Destra' }, { value: 'through+left', label: 'Dritto e sinistra' }, { value: 'through+right', label: 'Dritto e destra' }, { value: 'left+right', label: 'Sinistra e destra' }];
const COLOR_HEX: Record<MarkingColor, string> = { white: '#f4f3ef', yellow: '#f2c230', blue: '#2f62b0', red: '#c23b2e', pink: '#e58fb3', green: '#5f9d5a' };

function Preview({ d, color }: { d: string; color: string }) {
  return <svg viewBox="0 0 48 28" className="mk-preview" aria-hidden><rect width="48" height="28" rx="4" fill="#3b3e42" /><path d={d} stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="square" /></svg>;
}

export function MarkingPalette() {
  const t = useTool();
  const cur = MARKINGS.find((m) => m.kind === t.markingKind)!;
  return (
    <>
      <Section title="Segnaletica orizzontale">
        {[...new Set(MARKINGS.map((m) => m.group))].map((g) => (
          <div key={g} className="mk-group">
            <div className="lib-group-title">{g}</div>
            <div className="mk-grid">{MARKINGS.filter((m) => m.group === g).map((m) => (
              <button key={m.kind} type="button" className={`mk-tile ${t.markingKind === m.kind ? 'is-on' : ''}`} onClick={() => useTool.setState({ markingKind: m.kind })} title={`${m.label} (${m.ref} Reg. CdS)`}>
                <Preview d={m.draw} color={['line_yellow', 'box_junction', 'bus_lane'].includes(m.kind) ? COLOR_HEX.yellow : m.kind === 'bollards' ? '#9aa0a6' : COLOR_HEX[t.markingColor]} />
                <span>{m.label}</span>
              </button>
            ))}</div>
          </div>
        ))}
      </Section>
      <Section title={cur.label}>
        <p className="muted">{cur.ref} Reg. CdS (DPR 495/1992) · {['text', 'symbol', 'arrow', 'give_way_triangle', 'speed_number'].includes(cur.kind) ? 'un clic sulla corsia: orientamento automatico sul senso di marcia' : ['hatch', 'chevrons', 'box_junction', 'island'].includes(cur.kind) ? 'clic sui vertici dell\'area, Invio per chiudere' : ['zebra', 'bike_crossing'].includes(cur.kind) ? 'clic sui due bordi della carreggiata, Invio' : cur.kind === 'bollards' ? 'clic lungo il ciglio del marciapiede, Invio: un paletto ogni 1,5 m' : 'clic sui vertici, Invio per finire'}</p>
        {cur.kind !== 'line_yellow' && cur.kind !== 'box_junction' ? <Field label="Colore"><Select<MarkingColor> value={t.markingColor} ariaLabel="Colore" options={COLORS} onChange={(v) => useTool.setState({ markingColor: v })} /></Field> : null}
        {cur.kind === 'text' ? (
          <Field label="Scritta">
            <TextField value={t.markingText} ariaLabel="Scritta" onCommit={(v) => useTool.setState({ markingText: v.toUpperCase().slice(0, 12) })} />
            <div className="chips">{['STOP', 'BUS', 'TAXI', 'BUS TAXI', 'SCUOLA', 'LENTO', 'ZTL', '30', '50', 'ZONA 30'].map((x) => <button key={x} type="button" className={`chip chip-sm ${t.markingText === x ? 'is-on' : ''}`} onClick={() => useTool.setState({ markingText: x })}>{x}</button>)}</div>
          </Field>
        ) : null}
        {cur.kind === 'symbol' ? <Field label="Simbolo"><Select value={t.markingSymbol} ariaLabel="Simbolo" options={SYMBOLS} onChange={(v) => useTool.setState({ markingSymbol: v })} /></Field> : null}
        {cur.kind === 'arrow' ? <Field label="Direzioni"><Select value={t.markingArrow} ariaLabel="Direzioni" options={ARROWS} onChange={(v) => useTool.setState({ markingArrow: v })} /></Field> : null}
        {cur.kind === 'parking_bays' ? <Field label="Destinazione"><Select<BayPurpose> value={t.bayPurpose} ariaLabel="Destinazione" options={BAY_PURPOSE} onChange={(v) => useTool.setState({ bayPurpose: v })} /></Field> : null}
        {cur.kind === 'speed_number' ? <div className="chips">{['10', '20', '30', '40', '50'].map((x) => <button key={x} type="button" className={`chip chip-sm ${t.markingText === x ? 'is-on' : ''}`} onClick={() => useTool.setState({ markingText: x })}>{x}</button>)}</div> : null}
        {cur.kind === 'parking_bays' ? (
          <FieldGroup label="Disposizione"><Segmented<'parallel' | 'perpendicular' | 'angled'> label="Disposizione" value={t.bayLayout} onChange={(v) => useTool.setState({ bayLayout: v })}
            options={[{ value: 'parallel', label: 'In linea 2×5 m' }, { value: 'perpendicular', label: 'A pettine 2,5×5 m' }, { value: 'angled', label: 'A spina 45°' }]} /></FieldGroup>
        ) : null}
      </Section>
      <Section title="Segnaletica automatica" defaultOpen={false}>
        <p className="muted">Generata dal modello e sempre aggiornata: linee di corsia e di margine, frecce di preselezione con linee continue negli ultimi 30 m prima degli incroci (dalle svolte delle corsie), stalli sulle fasce di sosta (colore dalla sezione), corsie bus con linea gialla da 30 cm e «BUS» ogni 50 m, corsie ciclabili con simbolo e freccia, zig-zag gialla e «BUS» alle fermate, zebre, linee di arresto e dare precedenza secondo la regolazione dell'incrocio.</p>
      </Section>
    </>
  );
}

export function CalmingPalette() {
  const t = useTool();
  const cur = CALMING[t.calmingKind];
  return (
    <Section title="Moderazione del traffico e rialzati">
      <div className="mk-grid">{(Object.keys(CALMING) as RoadFeatureKind[]).map((k) => (
        <button key={k} type="button" className={`mk-tile ${t.calmingKind === k ? 'is-on' : ''}`} onClick={() => useTool.setState({ calmingKind: k, calmingHeightCm: CALMING[k].heightCm })}>
          <svg viewBox="0 0 48 28" className="mk-preview" aria-hidden><rect width="48" height="28" rx="4" fill="#3b3e42" />{k === 'speed_hump' ? <path d="M18 2v24M30 2v24M24 2v24" stroke="#f2c230" strokeWidth={3} /> : k === 'rumble_strips' ? <path d="M10 2v24M18 2v24M26 2v24M34 2v24" stroke="#f4f3ef" strokeWidth={2} /> : k === 'speed_cushion' ? <path d="M8 6h12v6H8zM28 16h12v6H28z" fill="#c23b2e" /> : k === 'raised_junction' ? <path d="M16 0h16v28H16zM0 8h48v12H0z" fill="#b98d6b" /> : <><path d="M12 2h24v24H12z" fill="#b98d6b" />{k === 'raised_crossing' ? <path d="M16 6h16M16 12h16M16 18h16M16 24h16" stroke="#f4f3ef" strokeWidth={3} /> : null}</>}</svg>
          <span>{CALMING[k].label}</span>
        </button>
      ))}</div>
      <Field label="Altezza"><NumberField value={t.calmingHeightCm} unit="cm" min={1} max={15} step={1} decimals={0} ariaLabel="Altezza" onCommit={(v) => useTool.setState({ calmingHeightCm: v })} /></Field>
      <p className="muted">{cur.hint}</p>
    </Section>
  );
}

export function FeatureInspector({ id }: { id: string }) {
  const net = useApp((s) => s.network)!;
  const f = net.features?.[id];
  if (!f) return <Empty icon="info" title="Elemento non più presente" />;
  const road = f.roadId ? net.roads[f.roadId] : undefined;
  const lim = road ? humpLimits(road.speedKmh) : null;
  const set = (ch: Partial<RoadFeature>) => commit('feature.set', { feature: { ...f, ...ch } });
  return (
    <>
    <Section title={CALMING[f.kind].label}>
      <p className="muted">{road ? `${road.name || 'Strada'} · ${road.speedKmh} km/h · progressiva ${Math.round(f.station ?? 0)} m` : 'Incrocio rialzato'}</p>
      <div className="grid-2">
        {f.kind !== 'raised_junction' ? <Field label="Lunghezza piano"><NumberField value={f.lengthM} unit="m" min={0.2} max={40} step={0.1} decimals={1} ariaLabel="Lunghezza" onCommit={(v) => set({ lengthM: v })} /></Field> : null}
        <Field label="Rampe"><NumberField value={f.rampM} unit="m" min={0} max={6} step={0.1} decimals={1} ariaLabel="Rampe" onCommit={(v) => set({ rampM: v })} /></Field>
        <Field label="Altezza"><NumberField value={Math.round(f.heightM * 100)} unit="cm" min={1} max={20} step={1} decimals={0} ariaLabel="Altezza" onCommit={(v) => set({ heightM: v / 100 })} /></Field>
        {road ? <Field label="Progressiva"><NumberField value={f.station ?? 0} unit="m" min={0} max={9999} step={1} decimals={1} ariaLabel="Progressiva" onCommit={(v) => set({ station: v })} /></Field> : null}
      </div>
      {(f.kind === 'speed_hump' || f.kind === 'speed_cushion') && lim ? <p className="muted">Art. 179 Reg. CdS a {road!.speedKmh} km/h: larghezza ≥ {Math.round(lim.minLengthM * 100)} cm, altezza ≤ {Math.round(lim.maxHeightM * 100)} cm; segnale di preavviso «dosso» (fig. II.2).</p> : null}
      {f.kind === 'raised_crossing' ? <p className="muted">Attraversamento alla quota del marciapiede: continuità del percorso accessibile (DM 236/1989), illuminazione dedicata consigliata (UNI 11248).</p> : null}
    </Section>
    <div className="inspector-actions"><Button icon="trash" variant="danger" onClick={() => commit('feature.remove', { featureIds: [f.id] })}>Elimina</Button></div>
    </>
  );
}

export function MarkingInspector({ id }: { id: string }) {
  const net = useApp((s) => s.network)!;
  const m = net.markings?.[id];
  if (!m) return <Empty icon="info" title="Segnaletica non più presente" />;
  const def = MARKINGS.find((x) => x.kind === m.kind);
  const set = (ch: Partial<Marking>) => commit('marking.set', { marking: { ...m, ...ch } });
  return (
    <>
    <Section title={def?.label ?? 'Segnaletica orizzontale'}>
      <p className="muted">{def?.ref} Reg. CdS</p>
      <Field label="Colore"><Select<MarkingColor> value={m.color} ariaLabel="Colore" options={COLORS} onChange={(v) => set({ color: v })} /></Field>
      {m.kind === 'text' ? <Field label="Scritta"><TextField value={m.text ?? ''} ariaLabel="Scritta" onCommit={(v) => set({ text: v.toUpperCase().slice(0, 12) })} /></Field> : null}
      {m.kind === 'symbol' ? <Field label="Simbolo"><Select value={m.symbol ?? 'bike'} ariaLabel="Simbolo" options={SYMBOLS} onChange={(v) => set({ symbol: v })} /></Field> : null}
      {m.kind === 'parking_bays' && m.bays ? <Field label="Destinazione"><Select<BayPurpose> value={m.bays.purpose ?? 'free'} ariaLabel="Destinazione" options={BAY_PURPOSE} onChange={(v) => set({ bays: { ...m.bays!, purpose: v } })} /></Field> : null}
      {m.kind === 'arrow' ? <Field label="Direzioni"><Select value={m.symbol ?? 'through'} ariaLabel="Direzioni" options={ARROWS} onChange={(v) => set({ symbol: v })} /></Field> : null}
      {m.kind.startsWith('line') ? <Field label="Larghezza striscia"><NumberField value={Math.round((m.widthM ?? 0.12) * 100)} unit="cm" min={10} max={50} step={1} decimals={0} ariaLabel="Larghezza" onCommit={(v) => set({ widthM: v / 100 })} /></Field> : null}
      <p className="muted">Larghezze di riferimento: 12 cm strade urbane, 15 cm extraurbane, 25 cm autostrade (art. 138 Reg.).</p>
    </Section>
    <div className="inspector-actions"><Button icon="trash" variant="danger" onClick={() => commit('marking.remove', { markingIds: [m.id] })}>Elimina</Button></div>
    </>
  );
}

const TURNS: { value: TurnKind; label: string; glyph: string }[] = [
  { value: 'left', label: 'Sinistra', glyph: '↰' }, { value: 'through', label: 'Dritto', glyph: '↑' }, { value: 'right', label: 'Destra', glyph: '↱' }, { value: 'uturn', label: 'Inversione', glyph: '↶' },
];

/** Corsie di preselezione: turn arrows per lane, painted automatically in the last 30 m (art. 147 Reg.). */
export function PreselectionSection({ road }: { road: Road }) {
  const lanes = road.lanes.filter((l) => l.modes.includes('car') || l.modes.length === 0);
  if (!lanes.length) return null;
  const toggle = (laneId: string, cur: readonly TurnKind[], k: TurnKind) => {
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    commit('road.setLaneTurns', { roadId: road.id, turns: { [laneId]: next.length ? next : ['through'] } });
  };
  const byDir = (d: string) => lanes.filter((l) => l.direction === d).sort((a, b) => b.index - a.index);
  return (
    <Section title="Preselezione e frecce" defaultOpen={false}>
      {(['forward', 'backward'] as const).map((d) => byDir(d).length ? (
        <div key={d} className="presel">
          <span className="muted">{d === 'forward' ? 'Verso fine strada' : 'Verso inizio strada'} · da sinistra a destra</span>
          {byDir(d).map((l) => (
            <div key={l.id} className="presel-lane">
              {TURNS.map((t) => <button key={t.value} type="button" className={`chip chip-sm ${l.turns.includes(t.value) ? 'is-on' : ''}`} title={t.label} aria-label={`${t.label} corsia ${l.index + 1}`} onClick={() => toggle(l.id, l.turns, t.value)}>{t.glyph}</button>)}
            </div>
          ))}
        </div>
      ) : null)}
      <p className="muted">Frecce a 12 e 32 m dalla linea di arresto e linee di corsia continue negli ultimi 30 m, generate in automatico <span className="mono">art. 147 Reg. CdS</span>.</p>
    </Section>
  );
}

const STRUCT: { value: RoadStructure['type'] | 'none'; label: string }[] = [
  { value: 'none', label: 'A raso' }, { value: 'bridge', label: 'Ponte' }, { value: 'viaduct', label: 'Viadotto' }, { value: 'tunnel', label: 'Galleria' },
];

/** Strade sopraelevate, ponti, gallerie: deck height, layer, piers. */
export function StructureSection({ road }: { road: Road }) {
  const s = road.structure;
  const set = (ch: Partial<RoadStructure> | null) => commit('road.setStructure', { roadIds: [road.id], structure: ch === null ? undefined : { type: 'viaduct', heightM: 7, layer: 1, piersEveryM: 30, ...s, ...ch } });
  return (
    <Section title="Struttura (ponte, viadotto, galleria)" defaultOpen={!!s}>
      <Segmented<RoadStructure['type'] | 'none'> label="Struttura" size="sm" value={s?.type ?? 'none'} options={STRUCT}
        onChange={(v) => set(v === 'none' ? null : { type: v, layer: v === 'tunnel' ? -1 : Math.max(1, s?.layer ?? 1), heightM: v === 'tunnel' ? 8 : Math.max(5.5, s?.heightM ?? 7) })} />
      {s ? (
        <div className="grid-2">
          <Field label={s.type === 'tunnel' ? 'Profondità' : 'Altezza impalcato'}><NumberField value={s.heightM} unit="m" min={0} max={80} step={0.5} decimals={1} ariaLabel="Altezza" onCommit={(v) => set({ heightM: v })} /></Field>
          <Field label="Livello"><NumberField value={s.layer} min={-5} max={5} step={1} decimals={0} ariaLabel="Livello" onCommit={(v) => set({ layer: Math.round(v) })} /></Field>
          {s.type !== 'tunnel' ? <Field label="Pile ogni"><NumberField value={s.piersEveryM ?? 30} unit="m" min={8} max={200} step={1} decimals={0} ariaLabel="Interasse pile" onCommit={(v) => set({ piersEveryM: v })} /></Field> : null}
        </div>
      ) : null}
      {s && s.type !== 'tunnel' ? <p className="muted">Franco verticale sulle strade sottostanti ≥ 5,00 m <span className="mono">DM 5/11/2001 § 3.8</span>; barriere di sicurezza su impalcato <span className="mono">DM 21/6/2004</span>.</p> : null}
      {s?.type === 'tunnel' ? <p className="muted">Gallerie &gt; 500 m: requisiti di sicurezza <span className="mono">D.Lgs. 264/2006</span>; illuminazione <span className="mono">UNI 11095</span>.</p> : null}
    </Section>
  );
}

/** Baseline building: size, floors, demolition / restore in the scenario (e.g. to place an imported model). */
export function BuildingInspector({ id }: { id: string }) {
  const b = useApp((s) => s.baseline?.buildings[id]);
  const net = useApp((s) => s.network)!;
  const origin = useApp((s) => s.baseline!.origin);
  if (!b) return <Empty icon="info" title="Edificio non trovato" />;
  const f = new LocalFrame(origin);
  const ring = b.footprint.map((p) => f.toMetric(p) as geom.V);
  const area = geom.ringArea(ring);
  const h = b.heightM - b.minHeightM;
  const floors = Math.max(1, Math.round(h / 3.2));
  const removed = !!net.removedBuildings?.[id];
  return (
    <>
      <Section title={b.name || 'Edificio'}>
        {removed ? <p className="plan-chip is-hot">Demolito nello scenario</p> : null}
        <div className="stats-row">
          <Stat label="Superficie coperta" value={Math.round(area).toLocaleString('it-IT')} unit="m²" />
          <Stat label="Altezza" value={b.heightM.toFixed(1).replace('.', ',')} unit="m" />
          <Stat label="Piani (stima)" value={floors} />
        </div>
        <div className="stats-row">
          <Stat label="Volume" value={Math.round(area * h).toLocaleString('it-IT')} unit="m³" />
          <Stat label="SUL (stima)" value={Math.round(area * floors).toLocaleString('it-IT')} unit="m²" />
        </div>
        <p className="muted">Fonte: {b.provenance.source}{b.provenance.kind === 'estimated' ? ' · altezza stimata' : ''}. Piani stimati a 3,20 m di interpiano.</p>
      </Section>
      <div className="inspector-actions">
        {removed
          ? <Button icon="undo" onClick={() => commit('building.remove', { buildingIds: [id], restore: true })}>Ripristina edificio</Button>
          : <Button icon="trash" variant="danger" onClick={() => commit('building.remove', { buildingIds: [id] })}>Demolisci nello scenario</Button>}
      </div>
    </>
  );
}
