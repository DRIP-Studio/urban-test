import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONSTRAINT_LABEL, DM1444_COLOR, DM1444_LABEL, FUNCTIONAL_CLASSES, FUNCTIONAL_COLOR, FUNCTIONAL_LABEL, PUMS_MACRO_LABEL, PUMS_NOTE, STANDARD_LABEL,
  buildingCompliance, checkFunctionalClasses, checkScenarioAgainstPlan, effectiveFunctionalClasses, environmentalIslands, generateConstraints, islandZone,
  proposeFunctionalClasses, pumsIndicators, urbanStandards,
  type ClassificationResult, type Dm1444Class, type FunctionalClass, type PumsMacro, type UrbanPlanDoc,
} from '@drip-urban/core';
import { flyTo } from '../map/mapStore';
import { drawFunctionalClasses, drawPlan, loadPlan, savePlan, showPlanLayers, usePlans } from '../state/plans';
import { commit, newId, select, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, Section, Segmented, Select, Stat } from '../ui/controls';
import { Icon } from '../ui/Icon';

type Tab = 'urban' | 'traffic' | 'pums';
const n0 = (v: number) => Math.round(v).toLocaleString('it-IT');
const n1 = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 1 });

/** «Piani»: piano urbanistico (PUC/PRG, DM 1444/68), piano del traffico (PGTU) e indicatori PUMS. */
export function PlansSheet() {
  const [tab, setTab] = useState<Tab>('urban');
  const loaded = usePlans((s) => s.loaded);
  useEffect(() => { if (!loaded) void loadPlan(); }, [loaded]);
  useEffect(() => { showPlanLayers('urban', tab === 'urban'); showPlanLayers('traffic', tab === 'traffic'); }, [tab]);
  return (
    <div className="plans">
      <Segmented<Tab> label="Piano" value={tab} onChange={setTab} options={[{ value: 'urban', label: 'Urbanistico (PUC/PRG)' }, { value: 'traffic', label: 'Traffico (PGTU)' }, { value: 'pums', label: 'PUMS' }]} />
      {tab === 'urban' ? <UrbanPlan /> : tab === 'traffic' ? <TrafficPlan /> : <Pums />}
    </div>
  );
}

// ------------------------------------------------------------------ urban plan

const EPSG = [
  { value: '', label: 'Automatico (.prj o WGS84)' }, { value: '3003', label: 'Monte Mario / Gauss-Boaga Ovest (3003)' }, { value: '3004', label: 'Monte Mario / Gauss-Boaga Est (3004)' },
  { value: '32632', label: 'WGS84 / UTM 32N (32632)' }, { value: '32633', label: 'WGS84 / UTM 33N (32633)' }, { value: '32634', label: 'WGS84 / UTM 34N (32634)' },
  { value: '25832', label: 'ETRS89 / UTM 32N (25832)' }, { value: '25833', label: 'ETRS89 / UTM 33N (25833)' }, { value: '6707', label: 'RDN2008 / UTM 32N (6707)' }, { value: '6708', label: 'RDN2008 / UTM 33N (6708)' },
  { value: '4326', label: 'WGS84 geografiche (4326)' },
];
interface Preview { format: string; crs: { name: string; epsg?: number }; count: number; insideProject: number; fields: string[]; suggested: Record<string, string | null>; classes: Record<string, number> }
const MAPPING: { key: string; label: string; target: 'zones' | 'constraints' | 'both' }[] = [
  { key: 'codeField', label: 'Sigla zona (es. B2)', target: 'zones' }, { key: 'classField', label: 'Classe DM 1444 (se separata)', target: 'zones' },
  { key: 'nameField', label: 'Nome / descrizione', target: 'both' }, { key: 'indexField', label: 'Indice fondiario m³/m²', target: 'zones' },
  { key: 'coverageField', label: 'Rapporto di copertura %', target: 'zones' }, { key: 'heightField', label: 'Altezza massima m', target: 'zones' },
  { key: 'typeField', label: 'Tipo di vincolo', target: 'constraints' },
];

function PlanImport() {
  const project = useApp((s) => s.project)!;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [epsg, setEpsg] = useState('');
  const [target, setTarget] = useState<'zones' | 'constraints'>('zones');
  const [pv, setPv] = useState<Preview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const url = (what: string) => `/api/projects/${encodeURIComponent(project.id)}/urbanplan/${what}${epsg ? `?epsg=${epsg}` : ''}`;
  const send = async (what: 'preview' | 'import', f: File, opts: Record<string, unknown>) => {
    const fd = new FormData();
    fd.append('file', f); fd.append('opts', JSON.stringify(opts));
    const res = await fetch(url(what), { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Errore ${res.status}`);
    return res.json();
  };
  const preview = async (f: File) => {
    setFile(f); setBusy(true);
    try {
      const p = await send('preview', f, {}) as Preview;
      setPv(p);
      setMap(Object.fromEntries(Object.entries(p.suggested).filter(([, v]) => v).map(([k, v]) => [k, v!])));
    } catch (e) { toast.error('Piano non leggibile', e instanceof Error ? e.message : String(e)); setPv(null); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await send('import', file, { ...map, target, source: file.name }) as { zones: number; constraints: number; skipped: number };
      await loadPlan();
      showPlanLayers('urban', true);
      toast.success('Piano importato', target === 'zones' ? `${r.zones} zone omogenee${r.skipped ? ` · ${r.skipped} fuori area o senza classe` : ''}` : `${r.constraints} vincoli`);
      setPv(null); setFile(null);
    } catch (e) { toast.error('Import non riuscito', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Importa dal PUC/PRG" defaultOpen={!usePlans.getState().doc.zones.length}>
      <input ref={input} type="file" accept=".zip,.geojson,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void preview(f); e.target.value = ''; }} />
      <div className="grid-2">
        <Field label="Contenuto"><Segmented<'zones' | 'constraints'> label="Contenuto" size="sm" value={target} onChange={setTarget} options={[{ value: 'zones', label: 'Zonizzazione' }, { value: 'constraints', label: 'Vincoli' }]} /></Field>
        <Field label="Sistema di riferimento"><Select value={epsg} ariaLabel="EPSG" options={EPSG} onChange={setEpsg} /></Field>
      </div>
      <Button icon="import" busy={busy} onClick={() => input.current?.click()}>Scegli Shapefile (.zip) o GeoJSON</Button>
      {pv ? (
        <div className="plan-preview">
          <p className="muted">{file?.name} · {pv.format} · {pv.crs.name} · {pv.count} poligoni, {pv.insideProject} nell'area del progetto</p>
          {target === 'zones' ? <div className="chips">{Object.entries(pv.classes).map(([c, k]) => <span key={c} className="chip chip-sm" style={{ boxShadow: `inset 3px 0 0 ${DM1444_COLOR[c as Dm1444Class] ?? '#888'}` }}>{c === '?' ? 'non riconosciute' : `Zona ${c}`}: {k}</span>)}</div> : null}
          <div className="grid-2">
            {MAPPING.filter((m) => m.target === 'both' || m.target === target).map((m) => (
              <Field key={m.key} label={m.label}><Select value={map[m.key] ?? ''} ariaLabel={m.label} options={[{ value: '', label: '—' }, ...pv.fields.map((f) => ({ value: f, label: f }))]} onChange={(v) => setMap((s) => ({ ...s, [m.key]: v }))} /></Field>
            ))}
          </div>
          <Button variant="primary" icon="check" busy={busy} onClick={() => void run()}>Importa nel progetto</Button>
        </div>
      ) : null}
      <p className="muted">Shapefile zippato (.shp, .dbf, .prj) o GeoJSON. Gauss-Boaga convertito con parametri nazionali (precisione metrica, adeguata alla scala di piano). La classe DM 1444/68 si ricava dalla sigla (A1 → A).</p>
    </Section>
  );
}

function UrbanPlan() {
  const doc = usePlans((s) => s.doc);
  const baseline = useApp((s) => s.baseline)!;
  const net = useApp((s) => s.network)!;
  const netVersion = useApp((s) => s.netVersion);
  const [includePlanned, setIncludePlanned] = useState(false);
  const std = useMemo(() => urbanStandards(baseline, net, doc, { includePlanned }), [baseline, doc, includePlanned, netVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const comp = useMemo(() => buildingCompliance(baseline, doc), [baseline, doc]);
  const issues = useMemo(() => checkScenarioAgainstPlan(net, baseline.origin, doc), [net, baseline, doc]);
  const byClass = doc.zones.reduce<Record<string, number>>((a, z) => ({ ...a, [z.dm1444]: (a[z.dm1444] ?? 0) + 1 }), {});
  const genConstraints = () => {
    const gen = generateConstraints(net, baseline, { where: 'inside', idPrefix: newId('gen') });
    void savePlan({ ...doc, constraints: [...doc.constraints.filter((c) => !c.source.startsWith('Generata')), ...gen] as UrbanPlanDoc['constraints'] });
    showPlanLayers('urban', true);
    toast.success('Fasce di rispetto generate', `${gen.length} fasce (strade, ferrovie, cimiteri): indicative, da verificare sugli atti`);
  };
  const t = std.town;
  return (
    <>
      <PlanImport />
      <Section title="Zonizzazione" count={doc.zones.length}>
        {doc.zones.length ? (
          <div className="chips">{(Object.keys(DM1444_LABEL) as Dm1444Class[]).filter((c) => byClass[c]).map((c) => <span key={c} className="chip chip-sm" title={DM1444_LABEL[c]} style={{ boxShadow: `inset 3px 0 0 ${DM1444_COLOR[c]}` }}>Zona {c}: {byClass[c]}</span>)}</div>
        ) : <Empty icon="map" title="Nessuna zona del piano">Importa la zonizzazione del PUC/PRG per verificare standard, indici e vincoli.</Empty>}
        <div className="row">
          <Button size="sm" icon="shield" onClick={genConstraints}>Genera fasce di rispetto</Button>
          {doc.zones.length || doc.constraints.length ? <Button size="sm" variant="ghost" icon="trash" onClick={() => void savePlan({ zones: [], constraints: [] })}>Svuota piano</Button> : null}
        </div>
        {doc.constraints.length ? <p className="muted">Vincoli: {Object.entries(doc.constraints.reduce<Record<string, number>>((a, c) => ({ ...a, [c.type]: (a[c.type] ?? 0) + 1 }), {})).map(([k, v]) => `${CONSTRAINT_LABEL[k as keyof typeof CONSTRAINT_LABEL] ?? k} ${v}`).join(' · ')}</p> : null}
      </Section>
      <Section title="Standard urbanistici (DM 1444/68 art. 3)">
        <div className="stats-row">
          <Stat label="Abitanti insediati (stima)" value={n0(t.residents)} />
          <Stat label="Volume residenziale" value={n0(t.residentialVolumeM3 / 1000)} unit="k m³" />
          <Stat label="Standard" value={n1(t.residents ? t.totalComputedM2 / t.residents : 0)} unit="m²/ab" />
        </div>
        <table className="table">
          <thead><tr><th>Standard</th><th>Richiesto</th><th>Dotazione</th><th>Saldo</th><th>m²/ab</th></tr></thead>
          <tbody>{t.rows.map((r) => (
            <tr key={r.kind}><td>{STANDARD_LABEL[r.kind]}</td><td className="num">{n0(r.requiredM2)}</td><td className="num">{n0(r.computedM2)}</td>
              <td className={`num ${r.balanceM2 < 0 ? 'bad' : 'good'}`}>{r.balanceM2 < 0 ? '−' : '+'}{n0(Math.abs(r.balanceM2))}</td><td className="num">{n1(r.perResidentM2)} / {r.standardPerResident}</td></tr>
          ))}</tbody>
        </table>
        <label className="check"><input type="checkbox" checked={includePlanned} onChange={(e) => setIncludePlanned(e.target.checked)} /> Conta le aree riservate dal piano (verifica di piano)</label>
        <p className="muted">{std.method}</p>
      </Section>
      {comp.length ? (
        <Section title="Edificato rispetto alle norme di zona" count={comp.filter((c) => c.coverageOk === false || c.indexOk === false || c.heightOk === false).length}>
          <table className="table">
            <thead><tr><th>Zona</th><th>Edifici</th><th>Copertura</th><th>Indice</th><th>H max</th></tr></thead>
            <tbody>{comp.slice(0, 60).map((c) => (
              <tr key={c.zoneId} className="clickable" onClick={() => { const z = doc.zones.find((x) => x.id === c.zoneId); if (z) flyTo([z.polygon[0]![0], z.polygon[0]![1]], 16.5); }}>
                <td><span className="swatch" style={{ background: DM1444_COLOR[c.dm1444] }} />{c.code}</td><td className="num">{c.buildings}</td>
                <td className={`num ${c.coverageOk === false ? 'bad' : ''}`}>{n1(c.coveragePct)}%</td>
                <td className={`num ${c.indexOk === false ? 'bad' : ''}`}>{n1(c.indexM3M2)}</td>
                <td className={`num ${c.heightOk === false ? 'bad' : ''}`}>{n1(c.tallest)} m</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      ) : null}
      <Section title="Verifica del progetto rispetto al piano" count={issues.length}>
        {issues.length ? (
          <ul className="row-list">{issues.slice(0, 40).map((i, k) => (
            <li key={k} className="clickable" onClick={() => select({ kind: i.targetKind === 'road' ? 'road' : i.targetKind === 'area' ? 'area' : 'asset', ids: [i.targetId] })}>
              <Icon name={i.severity === 'error' ? 'warning' : 'info'} size={14} /><span className="grow">{i.message}</span>
            </li>
          ))}</ul>
        ) : <p className="muted">{doc.constraints.length || doc.zones.length ? 'Nessuna interferenza tra gli elementi di progetto e vincoli o zone del piano.' : 'Importa o genera il piano per verificare il progetto.'}</p>}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ traffic plan (PGTU)

function TrafficPlan() {
  const net = useApp((s) => s.network)!;
  const baseline = useApp((s) => s.baseline)!;
  const netVersion = useApp((s) => s.netVersion);
  const doc = usePlans((s) => s.doc);
  const islands = usePlans((s) => s.islands);
  const [proposal, setProposal] = useState<ClassificationResult | null>(null);
  const classes = useMemo(() => effectiveFunctionalClasses(net), [net]);
  const issues = useMemo(() => checkFunctionalClasses(net, classes), [net, classes]);
  useEffect(() => { drawFunctionalClasses(); }, [netVersion]);
  const km = (FUNCTIONAL_CLASSES as readonly FunctionalClass[]).map((c) => ({ c, n: Object.values(classes).filter((x) => x === c).length }));
  const authored = Object.values(net.roads).filter((r) => r.functionalClass).length;
  const propose = () => {
    const p = proposeFunctionalClasses(net, baseline, null);
    setProposal(p);
    toast.info('Proposta pronta', `${p.proposals.length} strade · rete principale ${n1(p.principalKm)} km in ${p.principalComponents} componenti`);
  };
  const apply = () => {
    if (!proposal) return;
    const res = commit('road.setFunctionalClass', { classes: Object.fromEntries(proposal.proposals.map((p) => [p.roadId, p.cls])), source: 'auto' });
    if (res.ok) { setProposal(null); drawFunctionalClasses(); toast.success('Classificazione applicata', 'Modificabile strada per strada dall\'Inspector'); }
  };
  const findIslands = () => {
    const list = environmentalIslands(net, baseline, classes, { plan: doc });
    usePlans.setState({ islands: list });
    drawPlan();
    showPlanLayers('traffic', true);
    toast.info('Isole ambientali', `${list.length} isole delimitate dalla rete principale`);
  };
  const createZone = (i: (typeof islands)[number]) => {
    const z = islandZone(i, newId('z'));
    if (commit('zone.set', { zone: z }).ok) { usePlans.setState((s) => ({ islands: s.islands.filter((x) => x.id !== i.id) })); drawPlan(); select({ kind: 'zone', ids: [z.id] }); }
  };
  const createAll = () => {
    const ops = islands.filter((i) => !i.existingZoneId).map((i) => ({ type: 'zone.set', payload: { zone: islandZone(i, newId('z')) } }));
    if (ops.length && commit('batch', { label: `Isole ambientali (${ops.length})`, ops }).ok) { usePlans.setState({ islands: [] }); drawPlan(); toast.success('Zone create', `${ops.length} isole ambientali`); }
  };
  return (
    <>
      <Section title="Classificazione funzionale (Direttive 12/4/1995)">
        <div className="legend-grid">{km.map(({ c, n }) => <span key={c} className="legend-item"><span className="swatch" style={{ background: FUNCTIONAL_COLOR[c] }} />{FUNCTIONAL_LABEL[c]} <strong>{n}</strong></span>)}</div>
        <p className="muted">{authored} strade classificate nel progetto, le altre dalla gerarchia OSM.</p>
        <div className="row">
          <Button icon="sparkle" onClick={propose}>Proponi classificazione</Button>
          {proposal ? <Button variant="primary" icon="check" onClick={apply}>Applica a {proposal.proposals.length} strade</Button> : null}
        </div>
        {proposal ? <p className="muted">{proposal.method}</p> : null}
      </Section>
      <Section title="Verifiche della classificazione" count={issues.length} defaultOpen={issues.some((i) => i.severity === 'warning') && issues.length < 12}>
        {issues.length ? <ul className="row-list">{issues.slice(0, 40).map((i, k) => <li key={k} className="clickable" onClick={() => select({ kind: 'road', ids: [i.roadId] })}><Icon name={i.severity === 'warning' ? 'warning' : 'info'} size={14} /><span className="grow">{i.message}</span></li>)}</ul> : <p className="muted">Nessuna incoerenza rilevata.</p>}
      </Section>
      <Section title="Isole ambientali" count={islands.length}>
        <p className="muted">Maglie della rete principale con traffico solo di destinazione: Zona 30 di norma, ZTL nei centri storici (zona A), aree pedonali nei nuclei densi.</p>
        <div className="row">
          <Button icon="zone" onClick={findIslands}>Individua isole ambientali</Button>
          {islands.length ? <Button variant="primary" icon="check" onClick={createAll}>Crea tutte le zone</Button> : null}
        </div>
        {islands.length ? (
          <table className="table">
            <thead><tr><th>Proposta</th><th>Area</th><th>Abitanti</th><th>Strade int.</th><th /></tr></thead>
            <tbody>{islands.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => flyTo([i.zonePolygon[0]![0], i.zonePolygon[0]![1]], 16)} title={i.reason}>
                <td>{i.proposal === 'ztl' ? 'ZTL' : i.proposal === 'pedestrian' ? 'Area pedonale' : 'Zona 30'}{i.existingZoneId ? ' (esiste)' : ''}</td>
                <td className="num">{n1(i.areaHa)} ha</td><td className="num">{n0(i.residents)}</td><td className="num">{n1(i.internalKm)} km</td>
                <td>{i.existingZoneId ? null : <button type="button" className="link" onClick={(e) => { e.stopPropagation(); createZone(i); }}>crea</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ PUMS

function Pums() {
  const net = useApp((s) => s.network)!;
  const baseline = useApp((s) => s.baseline)!;
  const list = useMemo(() => {
    const stops = Object.values(net.assets).filter((a) => a.type.startsWith('transit.') && a.state !== 'removed').map((a) => a.at);
    return pumsIndicators({ net, baseline, transitStops: stops });
  }, [net, baseline]);
  return (
    <>
      {(Object.keys(PUMS_MACRO_LABEL) as PumsMacro[]).map((m) => {
        const rows = list.filter((x) => x.macro === m);
        if (!rows.length) return null;
        return (
          <Section key={m} title={PUMS_MACRO_LABEL[m]}>
            <table className="table">
              <tbody>{rows.map((r) => <tr key={r.id} title={r.note}><td>{r.label}</td><td className="num">{r.value === null ? '—' : n1(r.value)} <span className="muted">{r.unit}</span></td></tr>)}</tbody>
            </table>
          </Section>
        );
      })}
      <p className="muted">{PUMS_NOTE}</p>
    </>
  );
}

/** PGTU class of a road in the Inspector (authored, or derived from OSM when absent). */
export function FunctionalClassField({ roadId }: { roadId: string }) {
  const road = useApp((s) => s.network?.roads[roadId]);
  const net = useApp((s) => s.network)!;
  if (!road) return null;
  const eff = effectiveFunctionalClasses(net)[roadId];
  return (
    <Field label="Classe funzionale (PGTU)">
      <Select<string> value={road.functionalClass ?? ''} ariaLabel="Classe funzionale" placeholder={eff ? `${FUNCTIONAL_LABEL[eff]} (da OSM)` : 'Non classificata'}
        options={[{ value: '', label: eff ? `Automatica: ${FUNCTIONAL_LABEL[eff]}` : 'Non classificata' }, ...FUNCTIONAL_CLASSES.map((c) => ({ value: c, label: FUNCTIONAL_LABEL[c] }))]}
        onChange={(v) => commit('road.setFunctionalClass', { classes: { [roadId]: (v || null) as FunctionalClass | null }, source: 'manual' })} />
    </Field>
  );
}
