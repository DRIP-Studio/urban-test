import { useEffect, useMemo, useRef, useState } from 'react';
import { NetworkReplayer, earthworks, type CityBaseline } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import type { FeatureCollection, Polygon } from '../engine/geojson';
import {
  CHAPTERS, DEFAULT_PRICES_NOTE, EMPTY_PRICELIST, computeQuantities, computeTotals, computoCsv, effectivePrices, importPriceCsv, itNum,
  overrideFor, priceItems, withOverride, withoutOverride, type CsvImport, type PriceList, type QtyItem,
} from '../quantities/quantities';
import { useApp } from '../state/store';
import { loadTerrain, useTerrain } from '../state/terrain';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, Section, Skeleton, Stat, TextField, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';

const eur = (v: number) => `€ ${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (r: QtyItem) => r.quantity.toLocaleString('it-IT', { maximumFractionDigits: r.unit === 'cad' ? 0 : 2 });
const slug = (s: string) => s.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Baseline physical model (no operations), computed once per baseline in the worker. */
const baselinePhys = new WeakMap<CityBaseline, Promise<FeatureCollection<Polygon>>>();
function baselineSurfaces(b: CityBaseline): Promise<FeatureCollection<Polygon>> {
  let p = baselinePhys.get(b);
  if (!p) {
    p = engine.job<{ surfaces: FeatureCollection<Polygon> }>('physicalFor', { ops: [] }).then((r) => r.surfaces);
    p.catch(() => baselinePhys.delete(b));
    baselinePhys.set(b, p);
  }
  return p;
}

/** Text of an uploaded CSV: UTF-8, falling back to Windows-1252 (common in regional price lists). */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

function download(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Computo metrico estimativo of the active scenario, priced with the project price list. */
export function QuantitiesSheet() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const net = useApp((s) => s.network);
  const baseline = useApp((s) => s.baseline);
  const catalogs = useApp((s) => s.catalogs);
  const netVersion = useApp((s) => s.netVersion);
  const [physVersion, setPhysVersion] = useState(0);
  const [base, setBase] = useState<FeatureCollection<Polygon> | null>(null);
  const [list, setList] = useState<PriceList | null>(null);
  const [preview, setPreview] = useState<(CsvImport & { name: string; source: string; keepDefaults: boolean }) | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const docUrl = project ? `/api/projects/${encodeURIComponent(project.id)}/docs/pricelist` : null;

  useEffect(() => engine.onPhysical(() => setPhysVersion((v) => v + 1)), []);
  useEffect(() => {
    if (!baseline) return;
    let live = true;
    baselineSurfaces(baseline).then((s) => { if (live) setBase(s); }).catch((e) => toast.error('Stato attuale non calcolato', e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [baseline]);
  useEffect(() => {
    if (!docUrl) return;
    api.get<PriceList | null>(docUrl).then((d) => setList(d && Array.isArray(d.items) ? { ...EMPTY_PRICELIST, ...d } : EMPTY_PRICELIST)).catch(() => setList(EMPTY_PRICELIST));
  }, [docUrl]);

  const grid = useTerrain((s) => s.grid);
  const terrainLoaded = useTerrain((s) => s.loaded);
  useEffect(() => { if (!terrainLoaded) void loadTerrain(); }, [terrainLoaded]);
  const basePlans = useMemo(() => (baseline ? Object.keys(new NetworkReplayer().derive(baseline, []).net.signalPlans) : []), [baseline]);
  const labels = useMemo(() => ({
    materials: Object.fromEntries((catalogs?.materials.items ?? []).map((m) => [m.id, m.label])),
    assets: Object.fromEntries([...(catalogs?.furniture.items ?? []), ...(catalogs?.signs.items ?? [])].map((i) => [i.id, i.label])),
  }), [catalogs]);
  const raw = useMemo(() => {
    const p = engine.lastPhysical;
    if (!p || !base || !net) return null;
    return computeQuantities({
      surfaces: p.surfaces.features, markings: p.markings.features, lines: p.lines.features, baselineSurfaces: base.features,
      assets: Object.values(net.assets), signalPlanIds: Object.keys(net.signalPlans), baselineSignalPlanIds: basePlans, labels,
      earthworks: grid && baseline ? Object.values(net.roads).filter((r) => r.vertical).map((r) => { const e = earthworks(r, r.vertical!, grid, baseline.origin, 10); return { roadName: r.name || r.id, cutM3: e.cutM3, fillM3: e.fillM3 }; }) : [],
    });
  }, [physVersion, netVersion, base, net, basePlans, labels, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project || !scenario || !net) return null;
  if (!raw || !list) return <Skeleton lines={5} />;

  const rows = priceItems(raw, list);
  const vatPct = list.vatPct ?? 10, safetyPct = list.safetyPct ?? 3;
  const t = computeTotals(rows, vatPct, safetyPct);
  const usesDefaults = rows.some((r) => r.priceOrigin === 'default');
  const imported = list.items.filter((i) => i.origin === 'import');

  const save = (n: PriceList) => {
    setList(n);
    if (docUrl) api.put(docUrl, n).catch((e) => toast.error('Prezziario non salvato', e instanceof Error ? e.message : String(e)));
  };
  const setPrice = (r: QtyItem, v: number) => {
    const cur = effectivePrices(list).find((i) => i.code === r.priceCode && i.origin === 'import');
    save(withOverride(list, overrideFor(r, v, cur)));
  };
  const setCode = (r: QtyItem, code: string) => {
    const c = code.trim();
    if (!c) { save(withoutOverride(list, r)); return; }
    const hit = list.items.find((i) => i.origin === 'import' && i.code.toLowerCase() === c.toLowerCase());
    if (!hit) { toast.warn('Voce non trovata', `Il codice «${c}» non è nel prezziario importato.`); return; }
    if (hit.unit !== r.unit) { toast.warn('Unità diversa', `La voce ${hit.code} è in ${hit.unit}, la riga in ${r.unit}.`); return; }
    save(withOverride(list, overrideFor(r, hit.price, hit)));
  };
  const onFile = async (f: File) => {
    try {
      const res = importPriceCsv(await readText(f));
      setPreview({ ...res, name: f.name.replace(/\.csv$/i, ''), source: f.name, keepDefaults: true });
    } catch (e) { toast.error('File non leggibile', e instanceof Error ? e.message : String(e)); }
  };
  const applyImport = () => {
    if (!preview) return;
    save({ ...list, name: preview.name, source: preview.source, useDefaults: preview.keepDefaults, items: [...list.items.filter((i) => i.origin === 'user'), ...preview.items] });
    toast.success('Prezziario importato', `${preview.items.length} voci${preview.errors.length ? `, ${preview.errors.length} righe scartate` : ''}.`);
    setPreview(null);
  };
  const exportCsv = () => {
    const s = computoCsv(rows, t, {
      project: project.name, scenario: scenario.name, priceList: list.name, priceSource: list.source || 'non indicata',
      vatPct, safetyPct, date: new Date().toLocaleDateString('it-IT'),
    });
    download(`${slug(project.name)}_${slug(scenario.name)}_computo.csv`, new Blob([s], { type: 'text/csv;charset=utf-8' }));
  };
  const unmapped = preview ? preview.items.filter((i) => !Object.keys(i.match).length).length : 0;

  return (
    <div className="panel-stack qty">
      {usesDefaults ? (
        <div className="banner banner-warn qty-banner">
          <Icon name="warning" />
          <div><strong>{DEFAULT_PRICES_NOTE}</strong><span>Le voci marcate «indicativo» usano prezzi di riferimento DRIP: non sono prezzi ufficiali e non valgono come stima di progetto.</span></div>
        </div>
      ) : null}
      <Section title="Riepilogo">
        <div className="stats-row">
          <Stat label="Lavori" value={eur(t.works)} />
          <Stat label="Oneri sicurezza" value={eur(t.safety)} />
          <Stat label="IVA" value={eur(t.vat)} />
        </div>
        <div className="qty-total"><span>Totale complessivo</span><strong className="mono">{eur(t.total)}</strong></div>
        <div className="grid-2">
          <Field label="IVA (aliquota)" hint="10% per opere di urbanizzazione; verificare il caso"><NumberField value={vatPct} unit="%" min={0} max={30} step={1} decimals={1} ariaLabel="IVA (aliquota)" onCommit={(v) => save({ ...list, vatPct: v })} /></Field>
          <Field label="Oneri sicurezza" hint="% sui lavori, non soggetti a ribasso"><NumberField value={safetyPct} unit="%" min={0} max={20} step={0.5} decimals={1} ariaLabel="Oneri sicurezza" onCommit={(v) => save({ ...list, safetyPct: v })} /></Field>
        </div>
        <div className="row">
          <Button icon="export" variant="primary" disabled={!rows.length} onClick={exportCsv}>Esporta CSV</Button>
          <Button icon="import" onClick={() => file.current?.click()}>Importa prezziario CSV</Button>
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
        </div>
        <p className="muted">
          Prezziario: {list.name}{list.source ? ` · fonte: ${list.source}` : ''}{imported.length ? ` · ${imported.length} voci importate` : ''}.
          {t.unpriced ? ` ${t.unpriced} voci senza prezzo escluse dai totali.` : ''}
        </p>
        {list.items.length ? <Button size="sm" variant="ghost" icon="refresh" onClick={() => save({ ...EMPTY_PRICELIST, vatPct, safetyPct })}>Torna ai prezzi indicativi</Button> : null}
      </Section>

      {preview ? (
        <Section title="Anteprima prezziario" count={preview.items.length}>
          <p className="muted">{preview.rows} righe lette (separatore «{preview.separator}»): {preview.items.length} voci valide{preview.errors.length ? `, ${preview.errors.length} scartate` : ''}.</p>
          {unmapped ? <p className="muted">{unmapped} voci senza colonne di abbinamento (chapter, kind, material, assetType): non si applicano da sole, ma puoi assegnarle a una riga scrivendone il codice.</p> : null}
          {preview.errors.length ? <ul className="issue-list">{preview.errors.slice(0, 30).map((e, i) => <li key={i} className="is-error"><Icon name="warning" size={14} /><span>{e}</span></li>)}{preview.errors.length > 30 ? <li className="muted">… altri {preview.errors.length - 30} errori</li> : null}</ul> : null}
          {preview.items.length ? (
            <table className="table qty-table">
              <thead><tr><th>Codice</th><th>Descrizione</th><th>U.M.</th><th className="num">Prezzo</th></tr></thead>
              <tbody>{preview.items.slice(0, 8).map((i) => <tr key={i.code}><td className="mono">{i.code}</td><td>{i.description}</td><td>{i.unit}</td><td className="mono num">{itNum(i.price)}</td></tr>)}</tbody>
            </table>
          ) : null}
          <Field label="Fonte dei prezzi"><TextField value={preview.source} ariaLabel="Fonte dei prezzi" placeholder="es. Prezzario Regione Campania 2026" onCommit={(v) => setPreview({ ...preview, source: v })} /></Field>
          <Toggle checked={preview.keepDefaults} onChange={(v) => setPreview({ ...preview, keepDefaults: v })} label="Usa i prezzi indicativi DRIP per le voci non coperte" />
          <div className="row">
            <Button variant="primary" icon="check" disabled={!preview.items.length} onClick={applyImport}>Applica prezziario</Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>Annulla</Button>
          </div>
        </Section>
      ) : null}

      {!rows.length ? <Empty icon="calculator" title="Nessuna quantità di progetto">Il computo considera superfici, cordoli, segnaletica e oggetti in stato «di progetto» o «da rimuovere» dello scenario attivo.</Empty> : null}
      {CHAPTERS.map((ch) => {
        const rs = rows.filter((r) => r.chapter === ch);
        if (!rs.length) return null;
        return (
          <Section key={ch} title={ch} count={rs.length} actions={<span className="mono qty-sub">{eur(t.byChapter[ch] ?? 0)}</span>}>
            <table className="table qty-table">
              <thead><tr><th>Voce</th><th className="num">Quantità</th><th className="num">€/u</th><th className="num">Importo</th></tr></thead>
              <tbody>{rs.map((r) => (
                <tr key={r.key}>
                  <td>
                    <div className="qty-desc"><span className="mono muted">{r.code}</span> {r.description}</div>
                    <div className="qty-meta">
                      <input className="text-field qty-code" defaultValue={r.priceOrigin === 'default' ? '' : r.priceCode ?? ''} key={`${r.key}:${r.priceCode ?? ''}`}
                        placeholder={r.priceCode ?? 'codice voce'} aria-label={`Voce di prezziario per ${r.description}`}
                        onBlur={(e) => { if (e.target.value !== (r.priceOrigin === 'default' ? '' : r.priceCode ?? '')) setCode(r, e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                      {r.priceOrigin === 'default' ? <span className="prov prov-estimated" title={DEFAULT_PRICES_NOTE}>indicativo</span> : null}
                      {r.priceOrigin === 'user' ? <button type="button" className="chip chip-sm" title="Rimuovi il prezzo inserito per questa riga" onClick={() => save(withoutOverride(list, r))}>ripristina</button> : null}
                    </div>
                  </td>
                  <td className="mono num">{qty(r)} {r.unit}</td>
                  <td className="num"><NumberField value={r.unitPrice ?? NaN} min={0} max={10_000_000} decimals={2} ariaLabel={`Prezzo unitario ${r.description}`} onCommit={(v) => setPrice(r, v)} /></td>
                  <td className="mono num">{r.amount !== undefined ? eur(r.amount) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </Section>
        );
      })}
      <p className="muted qty-foot">Quantità misurate sul modello fisico dello scenario (superfici in proiezione metrica locale): stima preliminare da verificare. Le demolizioni sono approssimate con le superfici attuali delle strade e degli incroci ricostruiti.</p>
    </div>
  );
}
