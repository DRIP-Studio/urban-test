import { useMemo } from 'react';
import {
  LocalFrame, localDayMinutes, osmRestrictions, restrictionSign, restrictionsOf, zoneActiveAt, zoneGates,
  type Asset, type Lane, type Road, type RoadRestrictions, type Zone, type ZoneKind,
} from '@drip-urban/core';
import { deleteSelection } from '../state/actions';
import { commit, newId, select, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Field, NumberField, ProvBadge, Section, Segmented, Select, TextField, Toggle } from '../ui/controls';
import { ScheduleEditor, describeSchedule } from '../ui/ScheduleEditor';
import { NormRef } from '../ui/NormRef';
import { generateZoneGates } from '../state/suggestions';
import { setAllSides, setSideEnabled, setSidewalksEnabled, useSidewalks } from '../state/sidewalks';

const PROJECT = { kind: 'project' as const, source: 'DRIP Urban scenario' };

const ZONE_KINDS: { value: ZoneKind; label: string }[] = [
  { value: 'ztl', label: 'ZTL' }, { value: 'pedestrian', label: 'Area pedonale' }, { value: 'school', label: 'Strada scolastica' }, { value: 'zone30', label: 'Zona 30' },
  { value: 'low_emission', label: 'Basse emissioni' }, { value: 'parking', label: 'Zona sosta' }, { value: 'work', label: 'Cantiere / chiusura' },
];
const MODE_LABEL: Record<string, string> = { car: 'Auto', truck: 'Mezzi pesanti', bus: 'Bus', tram: 'Tram', bike: 'Bici', walk: 'Pedoni', emergency: 'Emergenza' };
const PERMITS = ['Residenti', 'Disabili (CUDE)', 'Taxi', 'NCC', 'Veicoli elettrici', 'Car sharing', 'Carico/scarico', 'Medici in visita', 'Forze dell\'ordine', 'Ospiti strutture ricettive'];

/** ZTL / zone: weekly schedule with several windows, permits, delivery windows, gates with LED panels. */
export function ZoneInspector({ zone }: { zone: Zone }) {
  const net = useApp((s) => s.network)!;
  const baseline = useApp((s) => s.baseline)!;
  const set = (changes: Partial<Zone>) => commit('zone.set', { zone: { ...zone, ...changes } });
  const now = localDayMinutes(new Date());
  const active = zoneActiveAt(zone, now.day, now.minutes);
  const gates = Object.values(net.assets).filter((a) => a.properties.zoneId === zone.id && a.state !== 'removed');
  const timed = zone.kind === 'ztl' || zone.kind === 'school' || zone.kind === 'pedestrian' || zone.kind === 'work' || zone.kind === 'low_emission';
  const generateGates = () => generateZoneGates(zone);
  return (
    <>
      <Section title={zone.name}>
        <div className="row"><span className={`plan-chip ${active ? 'is-hot' : ''}`}>{active ? 'Attiva ora' : 'Non attiva ora'}</span><span className="muted">{describeSchedule(zone.schedule)}</span></div>
        <Field label="Nome"><TextField value={zone.name} ariaLabel="Nome zona" onCommit={(v) => set({ name: v })} /></Field>
        <Field label="Tipo"><Select value={zone.kind} ariaLabel="Tipo zona" options={ZONE_KINDS} onChange={(v) => set({ kind: v })} /></Field>
        <Field label="Veicoli ammessi quando è attiva">
          <div className="chips">
            {Object.entries(MODE_LABEL).map(([m, l]) => (
              <button key={m} type="button" className={`chip ${zone.allowedModes.includes(m as never) ? 'is-on' : ''}`} aria-pressed={zone.allowedModes.includes(m as never)}
                onClick={() => set({ allowedModes: zone.allowedModes.includes(m as never) ? zone.allowedModes.filter((x) => x !== m) : [...zone.allowedModes, m as never] })}>{l}</button>
            ))}
          </div>
        </Field>
        {zone.kind === 'zone30' || zone.kind === 'school' || zone.kind === 'low_emission' ? <Field label="Limite"><NumberField value={zone.speedKmh ?? 30} unit="km/h" min={10} max={50} step={5} decimals={0} ariaLabel="Limite" onCommit={(v) => set({ speedKmh: v })} /></Field> : null}
      </Section>
      {timed ? (
        <Section title="Orari e giorni di attivazione">
          <Toggle label="Sempre attiva" checked={!zone.schedule?.length} onChange={(v) => set({ schedule: v ? undefined : [{ days: [0, 1, 2, 3, 4], from: '08:00', to: '20:00' }] })} />
          {zone.schedule?.length ? <ScheduleEditor value={zone.schedule} onChange={(schedule) => set({ schedule: schedule.length ? schedule : undefined })} /> : null}
        </Section>
      ) : null}
      {zone.kind === 'ztl' || zone.kind === 'pedestrian' ? (
        <Section title="Permessi e deroghe" defaultOpen={false}>
          <div className="chips">{PERMITS.map((p) => (
            <button key={p} type="button" className={`chip chip-sm ${zone.permits?.includes(p) ? 'is-on' : ''}`} aria-pressed={!!zone.permits?.includes(p)}
              onClick={() => set({ permits: zone.permits?.includes(p) ? zone.permits.filter((x) => x !== p) : [...(zone.permits ?? []), p] })}>{p}</button>
          ))}</div>
          <Field label="Carico e scarico merci" hint="I mezzi pesanti possono entrare in queste fasce anche a zona attiva.">
            <ScheduleEditor value={zone.deliveryWindows ?? []} onChange={(deliveryWindows) => set({ deliveryWindows: deliveryWindows.length ? deliveryWindows : undefined })}
              presets={[{ label: 'Mattino 6–10', windows: [{ days: [0, 1, 2, 3, 4, 5], from: '06:00', to: '10:00' }] }, { label: 'Pomeriggio 14–16', windows: [{ days: [0, 1, 2, 3, 4], from: '14:00', to: '16:00' }] }]} />
          </Field>
        </Section>
      ) : null}
      {zone.kind === 'ztl' || zone.kind === 'school' || zone.kind === 'low_emission' ? (
        <Section title="Varchi e pannelli LED" count={gates.filter((g) => g.type === 'ztl.gate').length}>
          <p className="muted">Un varco per ogni strada che entra nella zona: telecamera, pannello a messaggio variabile «ZTL attiva / non attiva» comandato dagli orari, segnale fig. II 322 CdS. <NormRef id="cds" article="art. 7 c. 9" /> · <NormRef id="dpr-250-1999" /></p>
          <div className="grid-2">
            <Field label="Testo zona attiva"><TextField value={zone.ledText?.on ?? 'ZTL ATTIVA'} ariaLabel="Testo attiva" onCommit={(v) => set({ ledText: { on: v, off: zone.ledText?.off ?? 'ZTL NON ATTIVA' } })} /></Field>
            <Field label="Testo zona non attiva"><TextField value={zone.ledText?.off ?? 'ZTL NON ATTIVA'} ariaLabel="Testo non attiva" onCommit={(v) => set({ ledText: { on: zone.ledText?.on ?? 'ZTL ATTIVA', off: v } })} /></Field>
          </div>
          <div className="row">
            <Button size="sm" icon="led" variant="project" onClick={generateGates}>{gates.length ? 'Rigenera varchi' : 'Genera varchi agli ingressi'}</Button>
            {gates.length ? <Button size="sm" variant="ghost" onClick={() => commit('asset.remove', { assetIds: gates.map((a) => a.id) })}>Rimuovi varchi</Button> : null}
          </div>
          {gates.filter((g) => g.type === 'ztl.gate').length ? (
            <ul className="row-list">{gates.filter((g) => g.type === 'ztl.gate').map((g) => (
              <li key={g.id}><span className={`led-dot ${active ? 'is-on' : ''}`} /><span className="grow">{String(g.properties.label ?? 'Varco')}</span>
                <button type="button" className="chip chip-sm" onClick={() => select({ kind: 'asset', ids: [g.id] })}>Seleziona</button></li>
            ))}</ul>
          ) : null}
        </Section>
      ) : null}
      <p className="muted pad">La zona entra nel navigatore, nella stima del traffico e nella simulazione dello scenario, con i suoi orari.</p>
      <div className="inspector-actions"><button type="button" className="btn btn-md btn-danger" onClick={deleteSelection}>Elimina zona</button></div>
    </>
  );
}

const HGV_OPTS: { value: string; label: string }[] = [
  { value: '', label: 'Nessun limite' }, { value: 'no', label: 'Divieto di transito' }, { value: 'destination', label: 'Solo per destinazione' }, { value: 'delivery', label: 'Solo carico/scarico' },
];

/** Traffic restrictions of one or more roads (truck bans, mass and size limits, closures, schedules). */
export function RestrictionsSection({ roads }: { roads: readonly Road[] }) {
  const first = roads[0]!;
  const eff = restrictionsOf(first);
  const r: RoadRestrictions = eff?.restrictions ?? {};
  const fromOsm = eff?.source === 'osm';
  const osm = osmRestrictions(first.tags);
  const ids = roads.map((x) => x.id);
  const set = (patch: Partial<RoadRestrictions>) => {
    const next = Object.fromEntries(Object.entries({ ...r, ...patch }).filter(([, v]) => v !== undefined && v !== '' && v !== false)) as RoadRestrictions;
    commit('road.setRestrictions', { roadIds: ids, restrictions: next });
  };
  const network = useApp((s) => s.network);
  const sameName = useMemo(() => (first.name && network ? Object.values(network.roads).filter((x) => x.name === first.name).map((x) => x.id) : []), [first.name, network]);
  const placeSigns = () => {
    const sign = restrictionSign(r);
    if (!sign) { toast.info('Nessun segnale', 'Imposta prima un divieto o un limite.'); return; }
    const net = useApp.getState().network!;
    const baseline = useApp.getState().baseline!;
    const f = new LocalFrame(baseline.origin);
    // A sign at each end where traffic enters, 3 m into the road, on the right edge, facing incoming drivers.
    const assets: Asset[] = [];
    for (const road of roads) {
      const ax = road.axis.map((q) => f.toMetric(q));
      const half = road.section.elements.reduce((t, e) => t + e.widthM, 0) / 2;
      const ends: { p: readonly [number, number]; q: readonly [number, number]; enabled: boolean }[] = [
        { p: ax[0]!, q: ax[1]!, enabled: road.oneway !== 'backward' },
        { p: ax[ax.length - 1]!, q: ax[ax.length - 2]!, enabled: road.oneway !== 'forward' },
      ];
      for (const e of ends) {
        if (!e.enabled) continue;
        const L = Math.hypot(e.q[0] - e.p[0], e.q[1] - e.p[1]) || 1;
        const u = [(e.q[0] - e.p[0]) / L, (e.q[1] - e.p[1]) / L];
        const right = [u[1]!, -u[0]!];
        const at = f.toLngLat([e.p[0] + u[0]! * 3 + right[0]! * (half + 0.4), e.p[1] + u[1]! * 3 + right[1]! * (half + 0.4)]);
        const facing = (Math.atan2(-u[0]!, -u[1]!) * 180) / Math.PI;
        assets.push({ id: newId('a'), type: sign, at, rotationDeg: facing, state: 'project', properties: { roadId: road.id, note: r.schedule ? describeSchedule(r.schedule) : undefined }, provenance: PROJECT });
      }
      void net;
    }
    if (commit('asset.add', { assets }).ok) toast.success('Segnaletica posata', `${assets.length} segnali (art. 6 CdS) agli ingressi`);
  };
  return (
    <Section title="Divieti e limitazioni di transito" defaultOpen={!!eff}>
      {fromOsm ? <div className="row"><ProvBadge kind="osm" /><span className="muted">Letti da OpenStreetMap: modificandoli diventano decisioni di progetto.</span></div> : null}
      <Field label="Mezzi pesanti (oltre 3,5 t)">
        <Select value={r.hgv ?? ''} ariaLabel="Mezzi pesanti" options={HGV_OPTS} onChange={(v) => set({ hgv: (v || undefined) as RoadRestrictions['hgv'] })} />
      </Field>
      <Field label="Tutti i veicoli a motore">
        <Segmented<string> label="Veicoli a motore" size="sm" value={r.motorVehicle ?? ''} onChange={(v) => set({ motorVehicle: (v || undefined) as RoadRestrictions['motorVehicle'] })}
          options={[{ value: '', label: 'Ammessi' }, { value: 'destination', label: 'Solo destinazione' }, { value: 'no', label: 'Divieto' }]} />
      </Field>
      <div className="grid-2">
        <Field label="Massa massima"><NumberField value={r.maxWeightT ?? 0} unit="t" min={0} max={100} step={0.5} decimals={1} ariaLabel="Massa massima" onCommit={(v) => set({ maxWeightT: v || undefined })} /></Field>
        <Field label="Massa per asse"><NumberField value={r.maxAxleLoadT ?? 0} unit="t" min={0} max={20} step={0.5} decimals={1} ariaLabel="Massa per asse" onCommit={(v) => set({ maxAxleLoadT: v || undefined })} /></Field>
        <Field label="Altezza massima"><NumberField value={r.maxHeightM ?? 0} unit="m" min={0} max={6} step={0.1} decimals={2} ariaLabel="Altezza massima" onCommit={(v) => set({ maxHeightM: v || undefined })} /></Field>
        <Field label="Larghezza massima"><NumberField value={r.maxWidthM ?? 0} unit="m" min={0} max={5} step={0.1} decimals={2} ariaLabel="Larghezza massima" onCommit={(v) => set({ maxWidthM: v || undefined })} /></Field>
        <Field label="Lunghezza massima"><NumberField value={r.maxLengthM ?? 0} unit="m" min={0} max={30} step={0.5} decimals={1} ariaLabel="Lunghezza massima" onCommit={(v) => set({ maxLengthM: v || undefined })} /></Field>
        <Field label="Merci pericolose (ADR)"><Toggle checked={!!r.hazmat} label="Vietate" onChange={(v) => set({ hazmat: v || undefined })} /></Field>
      </div>
      {r.hgv || r.motorVehicle ? (
        <Field label="Quando vale il divieto">
          <Toggle label="Sempre" checked={!r.schedule?.length} onChange={(v) => set({ schedule: v ? undefined : [{ days: [0, 1, 2, 3, 4, 5], from: '07:00', to: '20:00' }] })} />
          {r.schedule?.length ? <ScheduleEditor value={r.schedule} onChange={(schedule) => set({ schedule: schedule.length ? schedule : undefined })} /> : null}
        </Field>
      ) : null}
      <Field label="Deroghe"><TextField value={r.note ?? ''} placeholder="Es. eccetto autorizzati, mezzi d'opera, residenti" ariaLabel="Deroghe" onCommit={(v) => set({ note: v || undefined })} /></Field>
      <div className="row">
        <Button size="sm" icon="sign" onClick={placeSigns}>Posa i segnali</Button>
        {sameName.length > roads.length ? <Button size="sm" variant="ghost" onClick={() => commit('road.setRestrictions', { roadIds: sameName, restrictions: r })}>Applica a tutta {first.name}</Button> : null}
        {first.restrictions ? <Button size="sm" variant="ghost" onClick={() => commit('road.setRestrictions', { roadIds: ids, restrictions: null })}>{osm ? 'Torna ai dati OSM' : 'Rimuovi limitazioni'}</Button> : null}
      </div>
      <p className="muted">Il navigatore per mezzi pesanti, la stima del traffico e la simulazione rispettano divieti, limiti e fasce orarie.</p>
    </Section>
  );
}

const LANE_MODES: { value: string; label: string }[] = [
  { value: 'general', label: 'Ordinaria' }, { value: 'bus', label: 'Preferenziale bus' }, { value: 'bus_taxi', label: 'Bus e taxi' }, { value: 'bike', label: 'Ciclabile' }, { value: 'closed', label: 'Chiusa' },
];
const laneMode = (l: Lane) => (l.restriction === 'bus_only' ? (l.taxiAllowed ? 'bus_taxi' : 'bus') : l.restriction === 'bike_only' ? 'bike' : l.restriction === 'closed' ? 'closed' : 'general');

/** Lane by lane: preferential bus/taxi lanes with their hours, cycle lanes, closures. */
export function LanesSection({ road }: { road: Road }) {
  const lanes = useMemo(() => [...road.lanes].sort((a, b) => a.index - b.index), [road]);
  const setLane = (laneId: string, mode: string, schedule?: Lane['restrictionSchedule'] | null) => {
    const next = road.lanes.map((l) => {
      if (l.id !== laneId) return l;
      const { taxiAllowed: _t, restrictionSchedule: oldSch, ...rest } = l;
      const sch = schedule === null ? undefined : schedule ?? oldSch;
      const base = { ...rest, ...(sch && mode !== 'general' ? { restrictionSchedule: sch } : {}) };
      switch (mode) {
        case 'bus': return { ...base, restriction: 'bus_only' as const, modes: ['bus', 'emergency'] as Lane['modes'], priority: 'transit' as const };
        case 'bus_taxi': return { ...base, restriction: 'bus_only' as const, taxiAllowed: true, modes: ['bus', 'emergency'] as Lane['modes'], priority: 'transit' as const };
        case 'bike': return { ...base, restriction: 'bike_only' as const, modes: ['bike'] as Lane['modes'] };
        case 'closed': return { ...base, restriction: 'closed' as const };
        default: return { ...base, restriction: 'none' as const, modes: ['car', 'bus', 'truck', 'bike', 'emergency'] as Lane['modes'], priority: 'normal' as const };
      }
    });
    // The cross-section element follows: bus lanes are painted red-brown and marked BUS.
    const byId = new Map(next.map((l) => [l.id, l]));
    const section = { elements: road.section.elements.map((e) => {
      if (!e.laneId) return e;
      const l = byId.get(e.laneId)!;
      return { ...e, kind: l.restriction === 'bus_only' ? 'bus' as const : e.kind === 'bus' ? 'lane' as const : e.kind };
    }) };
    commit('road.setSection', { roadId: road.id, lanes: next, section });
  };
  const DIR: Record<string, string> = { forward: '→ verso asse', backward: '← verso opposto', reversible: '⇄ reversibile' };
  return (
    <Section title="Corsie e preferenziali" count={lanes.length} defaultOpen={false}>
      <ul className="row-list">
        {lanes.map((l) => (
          <li key={l.id} className="lane-row">
            <span className="grow">Corsia {l.index + 1} · {DIR[l.direction]} · {l.widthM.toFixed(2).replace('.', ',')} m</span>
            <Select value={laneMode(l)} ariaLabel={`Uso corsia ${l.index + 1}`} options={LANE_MODES} onChange={(v) => setLane(l.id, v)} />
            {laneMode(l) !== 'general' && laneMode(l) !== 'closed' ? (
              <div className="lane-sch">
                <Toggle compact={false} label={l.restrictionSchedule?.length ? `Solo ${describeSchedule(l.restrictionSchedule)}` : 'Riservata sempre'} checked={!!l.restrictionSchedule?.length}
                  onChange={(v) => setLane(l.id, laneMode(l), v ? [{ days: [0, 1, 2, 3, 4, 5], from: '07:00', to: '20:00' }] : null)} />
                {l.restrictionSchedule?.length ? <ScheduleEditor value={l.restrictionSchedule} onChange={(s) => setLane(l.id, laneMode(l), s.length ? s : null)} /> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="muted">Corsie riservate e preferenziali (art. 7 c. 1 lett. b e c. 9 CdS): fuori dagli orari diventano corsie ordinarie per navigatore e simulazione.</p>
    </Section>
  );
}

const SIDE_STATUS: Record<string, string> = {
  data: 'Marciapiede nei dati', footway: 'Percorso pedonale separato (OSM)', estimated: 'Stimato', no_room: 'Nessuno spazio: facciate sul ciglio', rural: 'Nessun edificio vicino: non previsto',
};

/** Sidewalk status of both sides: data, mapped footway, or an estimate that can be switched on/off. */
export function SidewalkSection({ road }: { road: Road }) {
  const { doc, bySide, loading } = useSidewalks();
  const sides = (['left', 'right'] as const).map((side) => ({ side, s: bySide.get(`${road.id}:${side}`) }));
  if (!sides.some((x) => x.s)) return null;
  const addToSection = (side: 'left' | 'right', w: number) => {
    const els = road.section.elements;
    const el = { id: `${road.id}:sw${side[0]}-${newId('e')}`, kind: 'sidewalk' as const, widthM: w };
    commit('road.setSection', { roadId: road.id, lanes: road.lanes, section: { elements: side === 'left' ? [el, ...els] : [...els, el] } });
  };
  return (
    <Section title="Marciapiedi">
      {!doc.enabled ? <p className="muted">Marciapiedi stimati disattivati per il progetto.</p> : null}
      <ul className="row-list">
        {sides.map(({ side, s }) => (
          <li key={side}>
            <span className="grow"><strong>{side === 'left' ? 'Sinistro' : 'Destro'}</strong> · {s ? SIDE_STATUS[s.status] : loading ? 'calcolo…' : '—'}{s?.status === 'estimated' ? ` ${s.widthM.toString().replace('.', ',')} m` : ''}</span>
            {s?.status === 'estimated' ? (
              <>
                <ProvBadge kind="estimated" />
                <Toggle compact checked={doc.enabled && !doc.disabled.includes(s.key)} label={`Marciapiede stimato ${side}`} onChange={(v) => { if (!doc.enabled && v) setSidewalksEnabled(true); setSideEnabled(s.key, v); }} />
                <button type="button" className="chip chip-sm" title="Aggiunge il marciapiede alla sezione di progetto (modifica la strada nello scenario)" onClick={() => addToSection(side, s.widthM)}>In sezione</button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="muted">I marciapiedi stimati non modificano la strada: sono una sovrapposizione attivabile, larga secondo la classe (DM 5/11/2001, minimo 1,50 m) e limitata dallo spazio prima degli edifici.</p>
    </Section>
  );
}

/** Project-wide switch and counts for estimated sidewalks. */
export function SidewalkOverview() {
  const { doc, coverage, loading } = useSidewalks();
  if (!coverage) return loading ? <p className="muted pad">Calcolo dei marciapiedi stimati…</p> : null;
  const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  const est = coverage.sides.filter((s) => s.status === 'estimated');
  const on = est.filter((s) => !doc.disabled.includes(s.key)).length;
  return (
    <Section title="Marciapiedi" defaultOpen={false}>
      <dl className="kv">
        <dt>Nei dati</dt><dd>{km(coverage.totals.data)}</dd>
        <dt>Percorsi pedonali OSM</dt><dd>{km(coverage.totals.footway)}</dd>
        <dt>Stimati</dt><dd>{km(coverage.totals.estimated)} · {on}/{est.length} lati attivi</dd>
        <dt>Senza spazio</dt><dd>{km(coverage.totals.no_room)}</dd>
      </dl>
      <Toggle checked={doc.enabled} label="Mostra e usa i marciapiedi stimati" onChange={setSidewalksEnabled} />
      <div className="row">
        <Button size="sm" onClick={() => setAllSides(true)}>Attiva tutti</Button>
        <Button size="sm" variant="ghost" onClick={() => setAllSides(false)}>Disattiva tutti</Button>
      </div>
    </Section>
  );
}
