import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { DEFAULT_TRAFFIC, LocalFrame, NetworkReplayer, buildPhysicalModel, geom, layoutSection, type SafetyScore, type TerrainGrid, type TrafficResult } from '@drip-urban/core';
import { api } from '../api/client';
import { buildDxf } from '../export/dxf';
import { buildIfc } from '../export/ifc';
import { buildLandXml } from '../export/landxml';
import { engine } from '../engine/engine';
import { LAYERS } from '../map/layers';
import { getMap, useMapUi } from '../map/mapStore';
import { BASEMAPS } from '../map/basemaps';
import { useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Section } from '../ui/controls';
import { scenarioMetrics } from './ComparePanel';

const slug = (s: string) => s.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function download(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csv = (rows: (string | number | null)[][]) => new Blob(['﻿' + rows.map((r) => r.map((c) => {
  const s = c === null ? '' : String(c);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });

/** Map snapshot with title, legend of visible layers, scale and attribution. */
async function composeImage(title: string, subtitle: string): Promise<HTMLCanvasElement> {
  const map = getMap();
  if (!map) throw new Error('Mappa non pronta');
  const src = await new Promise<HTMLCanvasElement>((resolve) => { map.once('render', () => resolve(map.getCanvas())); map.triggerRepaint(); });
  const W = src.width, H = src.height, band = Math.round(H * 0.09), dpr = W / map.getContainer().clientWidth;
  const c = document.createElement('canvas');
  c.width = W; c.height = H + band;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, W, band);
  g.drawImage(src, 0, band);
  g.fillStyle = '#eceae5'; g.font = `600 ${Math.round(band * 0.32)}px Ginto, sans-serif`; g.fillText(title, band * 0.35, band * 0.45);
  g.fillStyle = '#b4b3ae'; g.font = `${Math.round(band * 0.2)}px Ginto, sans-serif`; g.fillText(subtitle, band * 0.35, band * 0.8);
  // Legend of visible layers that have one.
  const vis = useMapUi.getState().visible;
  // Only layers that actually draw something in this view get a legend entry.
  const items = LAYERS.filter((l) => vis[l.id] && l.legend && map.queryRenderedFeatures({ layers: l.mapLayers.filter((id) => map.getLayer(id)) }).length > 0).flatMap((l) => l.legend!);
  const lh = 18 * dpr, pad = 10 * dpr;
  if (items.length) {
    const boxW = 190 * dpr, boxH = items.length * lh + pad * 2;
    g.fillStyle = 'rgba(13,13,13,0.82)'; g.fillRect(pad, band + pad, boxW, boxH);
    g.font = `${12 * dpr}px Ginto, sans-serif`;
    items.forEach((it, i) => {
      g.fillStyle = it.color; g.fillRect(pad * 2, band + pad * 2 + i * lh, 12 * dpr, 10 * dpr);
      g.fillStyle = '#eceae5'; g.fillText(it.label, pad * 2 + 18 * dpr, band + pad * 2 + i * lh + 9 * dpr);
    });
  }
  const basemap = BASEMAPS.find((b) => b.id === useMapUi.getState().basemap);
  const attr = `Dati: OpenStreetMap contributors (ODbL)${basemap?.attribution ? ` · Base: ${basemap.attribution}` : ''} · DRIP Urban`;
  g.font = `${11 * dpr}px Ginto, sans-serif`;
  const tw = g.measureText(attr).width;
  g.fillStyle = 'rgba(245,243,239,0.9)'; g.fillRect(W - tw - pad * 2, H + band - 22 * dpr, tw + pad * 2, 22 * dpr);
  g.fillStyle = '#131212'; g.fillText(attr, W - tw - pad, H + band - 7 * dpr);
  // Scale bar from the map's metres per pixel.
  const mpp = useMapUi.getState().mpp / dpr;
  const target = 100 * dpr * mpp;
  const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((v) => v >= target) ?? 2000;
  const px = nice / mpp;
  g.fillStyle = '#131212'; g.fillRect(pad, H + band - 16 * dpr, px, 4 * dpr);
  g.font = `${11 * dpr}px Ginto, sans-serif`; g.fillText(`${nice} m`, pad, H + band - 20 * dpr);
  return c;
}

export function ExportSheet() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const net = useApp((s) => s.network);
  const baseline = useApp((s) => s.baseline);
  const catalogs = useApp((s) => s.catalogs);
  const [busy, setBusy] = useState<string | null>(null);
  if (!project || !scenario || !net || !baseline) return null;
  const base = `${slug(project.name)}_${slug(scenario.name)}`;
  const run = async (id: string, fn: () => Promise<void> | void) => {
    setBusy(id);
    try { await fn(); toast.success('Esportazione pronta'); } catch (e) { toast.error('Esportazione non riuscita', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const geojson = () => {
    const p = engine.lastPhysical;
    if (!p) throw new Error('Modello fisico non ancora calcolato');
    const roads = Object.values(net.roads).map((r) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.axis }, properties: { layer: 'road_axis', id: r.id, name: r.name, class: r.roadClass, oneway: r.oneway, speed_kmh: r.speedKmh, lanes: r.lanes.length, width_m: Number((layoutSection(r).outerLeft - layoutSection(r).outerRight).toFixed(2)), provenance: Object.fromEntries(Object.entries(r.provenance).map(([k, v]) => [k, v.kind])) } }));
    const assets = Object.values(net.assets).map((a) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: a.at }, properties: { layer: 'asset', id: a.id, type: a.type, state: a.state, rotation_deg: a.rotationDeg, source: a.provenance.source } }));
    const zones = Object.values(net.zones).map((z) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...z.polygon, z.polygon[0]]] }, properties: { layer: 'zone', id: z.id, kind: z.kind, name: z.name, allowed: z.allowedModes.join(',') } }));
    const tag = (fc: { features: { properties: Record<string, unknown> }[] }, layer: string) => fc.features.map((f) => ({ ...f, properties: { ...f.properties, layer } }));
    const out = { type: 'FeatureCollection', name: base, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [...tag(p.surfaces, 'surface'), ...tag(p.markings, 'marking'), ...roads, ...assets, ...zones],
      metadata: { project: project.name, scenario: scenario.name, exportedAt: new Date().toISOString(), source: 'DRIP Urban · OpenStreetMap contributors (ODbL)' } };
    download(`${base}.geojson`, new Blob([JSON.stringify(out)], { type: 'application/geo+json' }));
  };
  const roadsCsv = () => {
    const f = new LocalFrame(baseline.origin);
    download(`${base}_strade.csv`, csv([['id', 'nome', 'classe', 'senso', 'velocita_kmh', 'corsie', 'sezione_m', 'lunghezza_m', 'stato'],
      ...Object.values(net.roads).map((r) => [r.id, r.name, r.roadClass, r.oneway, r.speedKmh, r.lanes.length, Number((layoutSection(r).outerLeft - layoutSection(r).outerRight).toFixed(2)), Number(geom.lengthOf(r.axis.map((q) => f.toMetric(q) as geom.V)).toFixed(1)), Object.values(r.provenance).some((p) => p.kind === 'project') ? 'progetto' : 'esistente'])]));
  };
  const trafficCsv = async () => {
    const t = await engine.job<TrafficResult>('traffic', { params: DEFAULT_TRAFFIC });
    download(`${base}_traffico_stimato.csv`, csv([['strada', 'nome', 'verso', 'veicoli_h', 'capacita_h', 'vc', 'velocita_kmh', 'velocita_libera_kmh', 'provenienza'],
      ...t.flows.filter((x) => x.volumeVph > 0).map((x) => [x.roadId, net.roads[x.roadId]?.name ?? '', x.forward ? 'asse' : 'contrario', x.volumeVph, x.capacityVph, x.vc, x.speedKmh, x.freeSpeedKmh, 'stima DRIP'])]));
  };
  const safetyCsv = async () => {
    const s = await engine.job<SafetyScore[]>('safety', { crashes: [], useTraffic: true });
    download(`${base}_sicurezza.csv`, csv([['nodo', 'incrocio', 'punteggio', 'base', 'conflitti_attraversamento', 'bracci', 'velocita_max', 'esposizione_pedonale', 'lat', 'lon'],
      ...s.map((x) => [x.nodeId, x.name, x.score, x.basis === 'observed' ? 'sinistri osservati' : 'screening surrogato', x.factors.crossingConflicts, x.factors.arms, x.factors.maxSpeedKmh, x.factors.pedestrianExposure, x.at[1], x.at[0]])]));
  };
  const png = async () => {
    const c = await composeImage(project.name, `${scenario.name} · ${new Date().toLocaleDateString('it-IT')}`);
    await new Promise<void>((res, rej) => c.toBlob((b) => (b ? (download(`${base}.png`, b), res()) : rej(new Error('Immagine non generata'))), 'image/png'));
  };
  const pdf = async () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297;
    doc.setFillColor(13, 13, 13); doc.rect(0, 0, W, 210, 'F');
    doc.setTextColor(236, 234, 229); doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.text(project.name, 20, 70);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(180, 179, 174);
    doc.text(`Scenario: ${scenario.name}`, 20, 84); doc.text(`${project.city} · ${new Date().toLocaleDateString('it-IT')}`, 20, 93);
    doc.setFontSize(10); doc.text('DRIP Urban · dati OpenStreetMap contributors (ODbL) · valori di traffico e sicurezza: stime di modello', 20, 190);
    const img = await composeImage(project.name, scenario.name);
    doc.addPage(); const r = img.height / img.width; const w = W - 20;
    doc.addImage(img.toDataURL('image/jpeg', 0.9), 'JPEG', 10, 10, w, Math.min(190, w * r));
    const pm = new Set(catalogs?.materials.items.filter((m) => m.permeable).map((m) => m.id));
    const a = scenarioMetrics(new NetworkReplayer().derive(baseline, []).net, baseline, pm), b = scenarioMetrics(net, baseline, pm);
    doc.addPage(); doc.setTextColor(19, 18, 18); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Metriche dello scenario', 20, 24);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const rows: [string, number, number, string][] = [['Strade modificate', a.roadsChanged, b.roadsChanged, ''], ['Nuove strade', Math.round(a.newRoadM), Math.round(b.newRoadM), 'm'], ['Sensi di marcia cambiati', a.oneway, b.oneway, ''], ['Rotatorie', a.roundabouts, b.roundabouts, ''], ['Incroci semaforizzati', a.signals, b.signals, ''], ['Zone', a.zones, b.zones, ''], ['Superfici drenanti', Math.round(a.greenM2), Math.round(b.greenM2), 'm²'], ['Sosta su strada (stima)', Math.round(a.parkingM2), Math.round(b.parkingM2), 'm²'], ['Alberi', a.trees, b.trees, '']];
    doc.text('Indicatore', 20, 40); doc.text('Oggi', 150, 40); doc.text('Scenario', 200, 40);
    rows.forEach(([l, x, y, u], i) => { doc.text(l, 20, 50 + i * 9); doc.text(`${x.toLocaleString('it-IT')} ${u}`, 150, 50 + i * 9); doc.text(`${y.toLocaleString('it-IT')} ${u}`, 200, 50 + i * 9); });
    doc.setFontSize(9); doc.setTextColor(110, 110, 110); doc.text(`Operazioni nello scenario: ${scenario.operations.length}. Modello fisico e metriche calcolati da DRIP Urban sulla rete OSM.`, 20, 190);
    doc.save(`${base}.pdf`);
  };
  const dxf = async () => {
    const physical = buildPhysicalModel(net, { origin: baseline.origin, features: baseline.features });
    const text = buildDxf({ network: net, physical, buildings: Object.values(baseline.buildings), origin: baseline.origin, title: `${project.name} · ${scenario.name}` });
    download(`${base}.dxf`, new Blob([text], { type: 'application/dxf' }));
  };
  /** Project DTM (doc `terrain`), null when not acquired yet or unreachable. */
  const terrain = async () => (await api.get<{ grid?: TerrainGrid } | null>(`/api/projects/${encodeURIComponent(project.id)}/docs/terrain`).catch(() => null))?.grid ?? null;
  const ifc = async () => {
    const physical = buildPhysicalModel(net, { origin: baseline.origin, features: baseline.features });
    const furniture = useApp.getState().catalogs?.furniture.items ?? [];
    const text = buildIfc({ network: net, physical, origin: baseline.origin, title: `${project.name} · ${scenario.name}`, terrain: await terrain(), furniture, fileName: `${base}.ifc` });
    download(`${base}.ifc`, new Blob([text], { type: 'application/x-step' }));
  };
  const landXml = async () => {
    const text = buildLandXml({ network: net, origin: baseline.origin, title: `${project.name} · ${scenario.name}`, terrain: await terrain() });
    download(`${base}.xml`, new Blob([text], { type: 'application/xml' }));
  };
  /** A3 technical sheet: CTR map at a standard scale, title block (cartiglio), north arrow, scale bar. */
  const tavola = async () => {
    const map = getMap();
    if (!map) throw new Error('Mappa non pronta');
    const prev = useMapUi.getState().basemap;
    useMapUi.setState({ basemap: 'ctr' });
    await new Promise((r) => setTimeout(r, 900));
    try {
      const src = await new Promise<HTMLCanvasElement>((resolve) => { map.once('render', () => resolve(map.getCanvas())); map.triggerRepaint(); });
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const W = 420, H = 297, m = 10, cartH = 42;
      const frameW = W - 2 * m, frameH = H - 2 * m - cartH;
      // Map scale: metres per CSS pixel × pixels per mm on paper, rounded to a standard scale.
      const mpp = useMapUi.getState().mpp;
      const cssW = map.getContainer().clientWidth;
      const groundW = mpp * cssW;
      const raw = (groundW * 1000) / frameW;
      const scales = [200, 500, 1000, 2000, 2500, 5000, 10000, 25000];
      const scale = scales.find((x) => x >= raw) ?? Math.round(raw);
      const imgW = (groundW * 1000) / scale; // mm on paper at the nominal scale
      const r = src.height / src.width;
      const w = Math.min(frameW, imgW), h = Math.min(frameH, w * r);
      doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.5); doc.rect(m, m, frameW, frameH + cartH);
      doc.addImage(src.toDataURL('image/png'), 'PNG', m + (frameW - w) / 2, m + (frameH - h) / 2, w, h);
      doc.line(m, m + frameH, m + frameW, m + frameH);
      // Title block.
      const y0 = m + frameH, cols = [m, m + 150, m + 260, m + 330, m + frameW];
      for (const x of cols.slice(1, -1)) doc.line(x, y0, x, y0 + cartH);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(`Comune di ${project.city}`, m + 5, y0 + 10);
      doc.setFontSize(12); doc.text(project.name, m + 5, y0 + 19);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(`Planimetria di progetto · scenario «${scenario.name}»`, m + 5, y0 + 27);
      doc.setFontSize(8); doc.setTextColor(90, 90, 90); doc.text('Base: OpenStreetMap contributors (ODbL), modello fisico DRIP Urban. Elaborato tecnico non sostitutivo del rilievo.', m + 5, y0 + 36);
      doc.setTextColor(17, 17, 17); doc.setFontSize(9);
      const kv = (x: number, y: number, k: string, v: string) => { doc.setFont('helvetica', 'normal'); doc.text(k, x, y); doc.setFont('helvetica', 'bold'); doc.text(v, x, y + 5); };
      kv(cols[1]! + 4, y0 + 9, 'Scala', `1:${scale.toLocaleString('it-IT')}`);
      kv(cols[1]! + 4, y0 + 24, 'Data', new Date().toLocaleDateString('it-IT'));
      kv(cols[1]! + 55, y0 + 9, 'Tavola', 'P.01');
      kv(cols[1]! + 55, y0 + 24, 'Formato', 'A3');
      kv(cols[2]! + 4, y0 + 9, 'Redatto', useApp.getState().user?.name ?? '—');
      kv(cols[2]! + 4, y0 + 24, 'Sistema', 'WGS84 / UTM');
      // North arrow and scale bar.
      const nx = cols[3]! + 14, ny = y0 + 8;
      doc.setFillColor(17, 17, 17); doc.triangle(nx, ny, nx - 4, ny + 12, nx + 4, ny + 12, 'F'); doc.setFontSize(10); doc.text('N', nx - 1.6, ny + 18);
      const barM = scale <= 500 ? 20 : scale <= 1000 ? 50 : scale <= 2500 ? 100 : 500;
      const barMm = (barM * 1000) / scale;
      const bx = cols[3]! + 30, by = y0 + 22;
      for (let i = 0; i < 4; i++) { doc.setFillColor(i % 2 ? 255 : 17, i % 2 ? 255 : 17, i % 2 ? 255 : 17); doc.rect(bx + (i * barMm) / 4, by, barMm / 4, 2.5, 'FD'); }
      doc.setFontSize(7); doc.text('0', bx - 0.8, by + 6.5); doc.text(`${barM} m`, bx + barMm - 3, by + 6.5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('DRIP Urban', cols[3]! + 30, y0 + 12);
      doc.save(`${base}_tavola_A3.pdf`);
    } finally {
      useMapUi.setState({ basemap: prev });
    }
  };
  const scenarioJson = () => download(`${base}.scenario.json`, new Blob([JSON.stringify({ format: 'drip-urban-scenario', schemaVersion: 1, project: project.name, scenario })], { type: 'application/json' }));
  const items: [string, string, string, () => Promise<void> | void][] = [
    ['geojson', 'GeoJSON del progetto', 'Superfici, segnaletica, assi stradali con provenienza, oggetti e zone (CRS84)', geojson],
    ['png', 'Immagine della vista', 'PNG con titolo, legenda, scala e attribuzioni', png],
    ['pdf', 'Report PDF', 'Copertina, mappa, metriche oggi/scenario', pdf],
    ['tavola', 'Tavola tecnica A3 (PDF)', 'Carta tecnica in scala nominale (1:500, 1:1000, 1:2000…), cartiglio, nord e scala grafica', tavola],
    ['dxf', 'DXF per CAD (Civil 3D, AutoCAD, QGIS)', 'Carreggiate, marciapiedi, cordoli, segnaletica, assi, edifici, arredo e zone su layer separati, in UTM metri', dxf],
    ['ifc', 'IFC 4.3 (BIM, InfraWorks, Revit)', 'Strada, pavimentazioni, verde, terreno, arredo e segnali come oggetti BIM georeferenziati (UTM)', ifc],
    ['landxml', 'LandXML (Civil 3D: assi, profili, DTM)', 'Assi stradali come tracciati, profili longitudinali e modello del terreno (TIN) in UTM metri', landXml],
    ['roads', 'CSV strade', 'Attributi e stato di ogni strada', roadsCsv],
    ['traffic', 'CSV traffico (stima)', 'Flussi stimati per strada e verso, ore 8', trafficCsv],
    ['safety', 'CSV sicurezza', 'Classifica incroci con fattori e base dei dati', safetyCsv],
    ['scenario', 'Scenario (JSON)', 'Elenco delle operazioni, reimportabile', scenarioJson],
    ['package', 'Pacchetto progetto (.zip)', 'Città, scenari, documenti: portabile su un altro computer', () => { window.location.href = `/api/projects/${encodeURIComponent(project.id)}/package`; }],
  ];
  return (
    <Section title="Esporta">
      <ul className="export-list">{items.map(([id, label, hint, fn]) => (
        <li key={id}><div><strong>{label}</strong><span className="muted">{hint}</span></div><Button size="sm" icon="export" busy={busy === id} onClick={() => void run(id, fn)}>Esporta</Button></li>
      ))}</ul>
    </Section>
  );
}
