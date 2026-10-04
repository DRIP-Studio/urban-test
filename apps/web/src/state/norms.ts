import { create } from 'zustand';
import { checkCompliance, citeNorm, normById, type ComplianceFinding, type Severity } from '@drip-urban/core';
import { fc, type Feature, type Point } from '../engine/geojson';
import { flyTo, setSource, toggleLayer } from '../map/mapStore';
import { openDock, select, useApp, type Selection } from './store';
import { registerLive } from './live';

/**
 * Normativa e verifiche: compliance findings of the active scenario, the map overlay and the
 * navigation state of the «Normativa e verifiche» sheet (tab, search, focused library entry).
 */
interface NormsState {
  tab: 'checks' | 'library';
  query: string;
  /** Library entry opened from a NormRef. */
  focus: string | null;
  scope: 'all' | 'project';
  severities: Record<Severity, boolean>;
  findings: ComplianceFinding[] | null;
  /** netVersion the findings were computed for. */
  version: number;
  ms: number;
  overlay: boolean;
}

export const useNorms = create<NormsState>(() => ({
  tab: 'checks', query: '', focus: null, scope: 'all', severities: { error: true, warning: true, info: false },
  findings: null, version: -1, ms: 0, overlay: true,
}));

export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Non conforme', warning: 'Da verificare', info: 'Informazione' };

/** Runs the checks on the active scenario (synchronous, ~0,1 s on a town). */
// Live: once computed, the checks follow every edit.
registerLive('norms', () => { if (useNorms.getState().findings) runChecks(); });

export function runChecks(): ComplianceFinding[] {
  const { network, baseline, catalogs, netVersion } = useApp.getState();
  if (!network || !baseline) return [];
  const families = new Map((catalogs?.signs.items ?? []).map((i) => [i.id, i.family]));
  const t0 = performance.now();
  const findings = checkCompliance(network, baseline, { scope: useNorms.getState().scope, signFamily: (t) => families.get(t) });
  useNorms.setState({ findings, version: netVersion, ms: Math.round(performance.now() - t0) });
  drawFindings();
  return findings;
}

export function visibleFindings(s: Pick<NormsState, 'findings' | 'severities'> = useNorms.getState()): ComplianceFinding[] {
  return (s.findings ?? []).filter((f) => s.severities[f.severity]);
}

export function drawFindings(): void {
  const s = useNorms.getState();
  if (!s.overlay || !s.findings) { setSource('norms', null); return; }
  const feats: Feature<Point>[] = visibleFindings(s).filter((f) => f.at).map((f) => ({
    type: 'Feature', id: f.id, geometry: { type: 'Point', coordinates: [f.at![0], f.at![1]] },
    properties: { id: f.id, severity: f.severity, title: f.title, norm: citeNorm(f.normId, f.article) },
  }));
  setSource('norms', fc(feats));
}

export function setOverlay(on: boolean): void {
  useNorms.setState({ overlay: on });
  toggleLayer('norms', on);
  drawFindings();
}

/** Flies to a finding and selects the element it refers to. */
export function focusFinding(f: ComplianceFinding): void {
  if (f.at) flyTo([f.at[0], f.at[1]], 18.5);
  const net = useApp.getState().network;
  let sel: Selection | null = null;
  if (f.roundaboutId && net?.roundabouts[f.roundaboutId]) sel = { kind: 'roundabout', ids: [f.roundaboutId] };
  else if (f.assetId && net?.assets[f.assetId]) sel = { kind: 'asset', ids: [f.assetId] };
  else if (f.areaId && net?.areas[f.areaId]) sel = { kind: 'area', ids: [f.areaId] };
  else if (f.zoneId && net?.zones[f.zoneId]) sel = { kind: 'zone', ids: [f.zoneId] };
  else if (f.roadId && net?.roads[f.roadId]) sel = { kind: 'road', ids: [f.roadId] };
  else if (f.nodeId && net?.nodes[f.nodeId]) sel = { kind: 'node', ids: [f.nodeId] };
  if (sel) select(sel);
}

/** Opens the sheet on a library entry (from a NormRef). */
export function openNorm(id: string): void {
  if (!normById(id)) return;
  useNorms.setState({ tab: 'library', focus: id, query: '' });
  openDock('norms');
}

// ---------------------------------------------------------------- exports

const csvCell = (v: unknown) => {
  const t = v === undefined || v === null ? '' : String(v);
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Semicolon-separated CSV (Italian Excel), one row per finding. */
export function findingsCsv(findings: readonly ComplianceFinding[]): string {
  const head = ['Esito', 'Titolo', 'Norma', 'Articolo', 'Descrizione', 'Valore', 'Limite', 'Unità', 'Elemento', 'Esistente', 'Longitudine', 'Latitudine'];
  const num = (v: number | undefined) => (v === undefined ? '' : String(v).replace('.', ','));
  const rows = findings.map((f) => [
    SEVERITY_LABEL[f.severity], f.title, citeNorm(f.normId), f.article, f.message, num(f.value), num(f.limit), f.unit ?? '',
    f.roadId ?? f.nodeId ?? f.assetId ?? f.zoneId ?? f.areaId ?? f.roundaboutId ?? '', f.existing ? 'sì' : 'no', f.at?.[0] ?? '', f.at?.[1] ?? '',
  ]);
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Printable «Relazione di conformità»: summary, findings table, cited references. */
export function complianceReportHtml(findings: readonly ComplianceFinding[], meta: { project: string; scenario: string; author?: string }): string {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const cited = [...new Set(findings.map((f) => f.normId))].map((id) => normById(id)).filter((n) => !!n);
  const date = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const rows = findings.map((f, i) => `<tr class="${f.severity}"><td>${i + 1}</td><td>${SEVERITY_LABEL[f.severity]}</td><td><strong>${esc(f.title)}</strong><br>${esc(f.message)}</td><td>${esc(citeNorm(f.normId, f.article))}</td><td>${f.value !== undefined ? `${String(f.value).replace('.', ',')}${f.unit ? ` ${esc(f.unit)}` : ''}` : ''}${f.limit !== undefined ? ` / ${String(f.limit).replace('.', ',')}${f.unit ? ` ${esc(f.unit)}` : ''}` : ''}</td><td>${f.existing ? 'esistente' : 'progetto'}</td></tr>`).join('');
  const refs = cited.map((n) => `<li><strong>${esc(n!.short)}</strong> — ${esc(n!.title)}${n!.statusNote ? `. <em>${esc(n!.statusNote)}</em>` : ''}${n!.url ? ` <a href="${esc(n!.url)}">${esc(n!.url)}</a>` : ''}</li>`).join('');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Relazione di conformità — ${esc(meta.project)}</title>
<style>
body{font:11pt/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1d1b;margin:2cm;background:#fff}
h1{font-size:18pt;margin:0 0 4pt}h2{font-size:13pt;margin:18pt 0 6pt;border-bottom:1px solid #ccc;padding-bottom:3pt}
.meta{color:#555;margin-bottom:12pt}.counts span{display:inline-block;margin-right:14pt}
table{border-collapse:collapse;width:100%;font-size:9.5pt}th,td{border:1px solid #ccc;padding:4pt 6pt;vertical-align:top;text-align:left}
th{background:#f1efe9}tr.error td:nth-child(2){color:#b23b2a;font-weight:600}tr.warning td:nth-child(2){color:#9a6a0c;font-weight:600}
li{margin-bottom:4pt}a{color:#1f5f8b;word-break:break-all}.note{color:#555;font-size:9.5pt}
@media print{body{margin:1.5cm}tr{page-break-inside:avoid}}
</style></head><body>
<h1>Relazione di conformità normativa</h1>
<div class="meta">${esc(meta.project)} · scenario «${esc(meta.scenario)}» · ${date}${meta.author ? ` · ${esc(meta.author)}` : ''}</div>
<div class="counts"><span><strong>${counts.error}</strong> non conformità</span><span><strong>${counts.warning}</strong> da verificare</span><span><strong>${counts.info}</strong> informazioni</span></div>
<p class="note">Verifiche automatiche semplificate, a livello di progetto preliminare, sui valori di riferimento delle norme citate. Gli elementi esistenti sono segnalati con un livello di gravità inferiore: il DM 5/11/2001 si applica alle nuove costruzioni ed è riferimento per gli adeguamenti (DM 22/4/2004). La relazione non sostituisce la verifica del progettista sul testo vigente delle norme.</p>
<h2>Esiti</h2>
<table><thead><tr><th>#</th><th>Esito</th><th>Descrizione</th><th>Riferimento</th><th>Valore / limite</th><th>Stato</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Nessun rilievo.</td></tr>'}</tbody></table>
<h2>Riferimenti normativi</h2><ul>${refs}</ul>
<p class="note">Generata con DRIP Urban.</p>
</body></html>`;
}
