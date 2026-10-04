import { useEffect, useMemo, useRef, useState } from 'react';
import {
  horizontalAlignment,
  checkVertical, crossSection, designElevation, earthworks, groundProfile, proposeVertical, sizeCurves, stationing, verticalRules,
  type Road, type TerrainGrid, type VerticalPVI, type VerticalProfile,
} from '@drip-urban/core';
import { commit, useApp } from '../state/store';
import { fetchTerrain, loadTerrain, uploadTerrain, useTerrain } from '../state/terrain';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, Segmented, Select, Stat } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { NormRef } from '../ui/NormRef';

const EPSG = [
  { value: '32633', label: 'WGS84 / UTM 33N (EPSG:32633)' }, { value: '32632', label: 'WGS84 / UTM 32N (EPSG:32632)' }, { value: '32634', label: 'WGS84 / UTM 34N (EPSG:32634)' },
  { value: '25833', label: 'ETRS89 / UTM 33N (EPSG:25833)' }, { value: '25832', label: 'ETRS89 / UTM 32N (EPSG:25832)' }, { value: '25834', label: 'ETRS89 / UTM 34N (EPSG:25834)' },
  { value: '6708', label: 'RDN2008 / UTM 33N (EPSG:6708)' }, { value: '6707', label: 'RDN2008 / UTM 32N (EPSG:6707)' }, { value: '6709', label: 'RDN2008 / UTM 34N (EPSG:6709)' },
  { value: '4326', label: 'WGS84 gradi (EPSG:4326)' },
];
const fmt = (v: number, d = 2) => v.toFixed(d).replace('.', ',');
const pct = (a: VerticalPVI, b: VerticalPVI) => ((b.elevation - a.elevation) / Math.max(1e-6, b.station - a.station)) * 100;

function TerrainSetup() {
  const busy = useTerrain((s) => s.busy);
  const [epsg, setEpsg] = useState('32633');
  const [spacing, setSpacing] = useState(2);
  const file = useRef<HTMLInputElement>(null);
  const run = (p: Promise<TerrainGrid | null>) => p.then((g) => g && toast.success('Modello del terreno pronto', `${g.nx} × ${g.ny} punti · passo ${fmt(g.resolutionM, 0)} m`)).catch((e: unknown) => toast.error('Terreno', e instanceof Error ? e.message : String(e)));
  return (
    <div className="profile-setup">
      <Empty icon="profile" title="Serve il modello del terreno (DTM)">
        <span>Scarica Copernicus DEM (90 m, gratuito) per l'area del progetto, oppure carica il rilievo: DTM LiDAR regionale (ESRI ASCII Grid .asc), nuvola di punti LAS (si usano i punti classificati terreno) o punti XYZ da stazione totale/GNSS.</span>
      </Empty>
      <div className="profile-setup-actions">
        <Button variant="primary" icon="download" busy={!!busy} onClick={() => void run(fetchTerrain(60))}>Scarica DTM Copernicus</Button>
        <Select value={epsg} ariaLabel="Sistema di riferimento del file" options={EPSG} onChange={setEpsg} />
        <NumberField value={spacing} unit="m" min={0.5} max={30} step={0.5} decimals={1} ariaLabel="Passo della griglia per nuvole di punti" onCommit={setSpacing} />
        <Button icon="upload" disabled={!!busy} onClick={() => file.current?.click()}>Carica rilievo (.asc, .las, .xyz)</Button>
        <input ref={file} type="file" accept=".asc,.txt,.las,.xyz,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(uploadTerrain(f, Number(epsg), spacing)); }} />
      </div>
      {busy ? <p className="muted">{busy}</p> : null}
    </div>
  );
}

/** Longitudinal profile chart: ground, grade line, PVIs (drag to change elevation), cut/fill shading. */
function ProfileChart({ road, ground, v, length, station, onStation, onChange }: {
  road: Road; ground: { station: number; z: number }[]; v: VerticalProfile | null; length: number; station: number;
  onStation: (s: number) => void; onChange: (v: VerticalProfile) => void;
}) {
  const W = 1000, H = 230, padL = 46, padR = 12, padT = 14, padB = 24;
  const design = useMemo(() => (v ? Array.from({ length: Math.ceil(length / 2) + 1 }, (_, k) => { const s = Math.min(length, k * 2); return { station: s, z: designElevation(v, s) }; }) : []), [v, length]);
  const zs = [...ground.map((g) => g.z), ...design.map((d) => d.z)].filter(Number.isFinite);
  const zMin = Math.floor(Math.min(...zs) - 1), zMax = Math.ceil(Math.max(...zs) + 1);
  const X = (s: number) => padL + (s / Math.max(1, length)) * (W - padL - padR);
  const Y = (z: number) => padT + (1 - (z - zMin) / Math.max(1, zMax - zMin)) * (H - padT - padB);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { s: Math.max(0, Math.min(length, (((e.clientX - r.left) / r.width) * W - padL) / (W - padL - padR) * length)), z: zMin + (1 - (((e.clientY - r.top) / r.height) * H - padT) / (H - padT - padB)) * (zMax - zMin) };
  };
  const line = (pts: { station: number; z: number }[]) => pts.filter((p) => Number.isFinite(p.z)).map((p, i) => `${i ? 'L' : 'M'}${X(p.station).toFixed(1)},${Y(p.z).toFixed(1)}`).join('');
  const area = v ? ground.filter((g) => Number.isFinite(g.z)).map((g) => ({ s: g.station, g: g.z, d: designElevation(v, g.station) })) : [];
  const ticks = Array.from({ length: 6 }, (_, k) => zMin + ((zMax - zMin) * k) / 5);
  const sTicks = Array.from({ length: 6 }, (_, k) => (length * k) / 5);
  return (
    <svg ref={svg} className="profile-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Profilo longitudinale di ${road.name || road.id}`}
      onPointerMove={(e) => { if (drag.current !== null && v) { const { z } = toLocal(e); onChange({ pvis: v.pvis.map((p, i) => (i === drag.current ? { ...p, elevation: Math.round(z * 100) / 100 } : p)) }); } }}
      onPointerUp={() => { drag.current = null; }}
      onClick={(e) => onStation(toLocal(e).s)}
      onDoubleClick={(e) => {
        if (!v) return;
        const { s } = toLocal(e);
        if (v.pvis.some((p) => Math.abs(p.station - s) < 5)) return;
        const pvis = [...v.pvis, { station: Math.round(s * 10) / 10, elevation: Math.round(designElevation(v, s) * 100) / 100 }].sort((a, b) => a.station - b.station);
        onChange({ pvis });
      }}>
      {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} className="pc-grid" /><text x={padL - 6} y={Y(t) + 3} className="pc-tick" textAnchor="end">{fmt(t, 1)}</text></g>)}
      {sTicks.map((t) => <text key={t} x={X(t)} y={H - 6} className="pc-tick" textAnchor="middle">{Math.round(t)} m</text>)}
      {area.length > 1 ? area.slice(1).map((q, i) => {
        const p = area[i]!;
        const cut = (p.g + q.g) / 2 > (p.d + q.d) / 2;
        return <path key={i} className={cut ? 'pc-cut' : 'pc-fill'} d={`M${X(p.s)},${Y(p.g)}L${X(q.s)},${Y(q.g)}L${X(q.s)},${Y(q.d)}L${X(p.s)},${Y(p.d)}Z`} />;
      }) : null}
      <path d={line(ground)} className="pc-ground" />
      {v ? (
        <>
          {v.pvis.map((p, i) => (p.curveLength ? <rect key={`c${i}`} x={X(p.station - p.curveLength / 2)} width={X(p.station + p.curveLength / 2) - X(p.station - p.curveLength / 2)} y={padT} height={H - padT - padB} className="pc-curve" /> : null))}
          <path d={line(design)} className="pc-design" />
          {v.pvis.slice(1).map((p, i) => { const a = v.pvis[i]!; const g = pct(a, p); const bad = Math.abs(g) > verticalRules(road).maxGradePct; return <text key={`g${i}`} x={X((a.station + p.station) / 2)} y={Y((a.elevation + p.elevation) / 2) - 8} className={`pc-grade ${bad ? 'is-bad' : ''}`} textAnchor="middle">{fmt(g, 2)}%</text>; })}
          {v.pvis.map((p, i) => (
            <circle key={i} cx={X(p.station)} cy={Y(p.elevation)} r={6} className="pc-pvi" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); drag.current = i; }}
              onContextMenu={(e) => { e.preventDefault(); if (i > 0 && i < v.pvis.length - 1) onChange({ pvis: v.pvis.filter((_, k) => k !== i) }); }}>
              <title>{`Vertice ${i + 1}: progressiva ${fmt(p.station, 1)} m, quota ${fmt(p.elevation)} m — trascina per cambiare quota, tasto destro per eliminarlo`}</title>
            </circle>
          ))}
        </>
      ) : null}
      <line x1={X(station)} x2={X(station)} y1={padT} y2={H - padB} className="pc-cursor" />
    </svg>
  );
}

function CrossSectionView({ road, v, grid, station }: { road: Road; v: VerticalProfile; grid: TerrainGrid; station: number }) {
  const origin = useApp((s) => s.baseline!.origin);
  const cs = useMemo(() => crossSection(road, v, grid, origin, station, 17), [road, v, grid, origin, station]);
  const W = 360, H = 150;
  const xs = [...cs.offsets, ...cs.slopes.map((s) => s.x)];
  const zs = [...cs.ground, cs.design, ...cs.slopes.map((s) => s.z)].filter(Number.isFinite);
  const xMin = Math.min(...xs) - 2, xMax = Math.max(...xs) + 2, zMin = Math.min(...zs) - 1, zMax = Math.max(...zs) + 1;
  // Same scale on both axes (sections are read undistorted).
  const k = Math.min(W / (xMax - xMin), H / (zMax - zMin));
  const X = (x: number) => W / 2 + (-(x - (xMin + xMax) / 2)) * k; // left of the axis on the left of the drawing (looking forward)
  const Y = (z: number) => H / 2 - (z - (zMin + zMax) / 2) * k;
  const right = cs.slopes.find((s) => s.side === 'right'), left = cs.slopes.find((s) => s.side === 'left');
  const platform = [right ? [right.x, right.z] : null, [cs.right, cs.design], [cs.left, cs.design], left ? [left.x, left.z] : null].filter(Boolean) as [number, number][];
  return (
    <div className="cross-section">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sezione alla progressiva ${Math.round(station)} m`}>
        <path className="pc-ground" d={cs.offsets.map((o, i) => `${i ? 'L' : 'M'}${X(o)},${Y(cs.ground[i]!)}`).join('')} />
        <path className="pc-design" d={platform.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('')} />
        <line className="pc-axis" x1={X(0)} x2={X(0)} y1={8} y2={H - 8} />
      </svg>
      <div className="muted">Sezione a {fmt(station, 1)} m · quota progetto {fmt(cs.design)} m · sterro {fmt(cs.cutM2, 1)} m² · riporto {fmt(cs.fillM2, 1)} m²</div>
    </div>
  );
}

/** Andamento planimetrico (Civil 3D alignment report): tangents, curves, curvature diagram, DM 2001 checks. */
function AlignmentView({ road }: { road: Road }) {
  const baseline = useApp((s) => s.baseline)!;
  const al = useMemo(() => horizontalAlignment(road, baseline.origin), [road, baseline]);
  const W = 760, H = 110, kMax = Math.max(1 / al.rMinM, ...al.curvature.map((c) => Math.abs(c.k))) * 1.15;
  const x = (s: number) => (s / Math.max(1, al.lengthM)) * W, y = (k: number) => H / 2 - (k / kMax) * (H / 2 - 6);
  return (
    <div className="ps-body">
      <div className="ps-col">
        <svg viewBox={`0 0 ${W} ${H}`} className="curv-chart" role="img" aria-label="Diagramma delle curvature">
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="axis" />
          {[1, -1].map((sg) => <line key={sg} x1={0} x2={W} y1={y(sg / al.rMinM)} y2={y(sg / al.rMinM)} className="limit" />)}
          {al.elements.filter((e) => e.kind === 'curve').map((e, i) => <rect key={i} x={x(e.s0)} width={Math.max(1, x(e.s1) - x(e.s0))} y={0} height={H} className="curve-band" />)}
          <polyline points={al.curvature.map((c) => `${x(c.s).toFixed(1)},${y(c.k).toFixed(1)}`).join(' ')} className="curv" />
        </svg>
        <p className="muted">Diagramma delle curvature 1/R (sinistra in alto). Tratteggio: 1/R minimo per {al.designSpeedKmh} km/h.</p>
        <table className="table ps-table">
          <thead><tr><th>Elemento</th><th>Da</th><th>A</th><th>Sviluppo</th><th>R</th><th>Deviazione</th><th>q</th></tr></thead>
          <tbody>{al.elements.map((e, i) => (
            <tr key={i}>
              <td>{e.kind === 'tangent' ? 'Rettifilo' : `Curva ${e.direction === 'left' ? 'sx' : 'dx'}`}</td><td>{fmt(e.s0, 1)}</td><td>{fmt(e.s1, 1)}</td><td>{fmt(e.lengthM, 1)} m</td>
              <td className={e.radiusM && e.radiusM < al.rMinM ? 'bad' : ''}>{e.radiusM ? `${fmt(e.radiusM, 0)} m` : '∞'}</td><td>{e.deflectionDeg ? `${fmt(e.deflectionDeg, 1)}°` : ''}</td><td>{e.superelevationPct ? `${fmt(e.superelevationPct, 1)}%` : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="ps-col">
        <div className="stats-row"><Stat label="R minimo" value={fmt(al.rMinM, 0)} unit="m" /><Stat label="V progetto" value={al.designSpeedKmh} unit="km/h" /><Stat label="Arresto" value={al.stoppingDistanceM} unit="m" /></div>
        {al.issues.length ? <ul className="issue-list">{al.issues.map((x, i) => <li key={i} className={x.severity === 'error' ? 'err' : 'warn'}><Icon name="warning" size={14} /><span>{fmt(x.station, 0)} m · {x.message}</span></li>)}</ul>
          : <p className="ok"><Icon name="check" size={14} /> Andamento planimetrico conforme (verifica semplificata).</p>}
        <p className="muted">{al.category} · q max {fmt(al.qMaxPct, 0)}% · <NormRef id="dm-2001" article="§ 5.2" /> · {al.method}</p>
      </div>
    </div>
  );
}

export function ProfileStudio() {
  const [view, setView] = useState<'profile' | 'plan'>('profile');
  const sel = useApp((s) => s.selection);
  const net = useApp((s) => s.network);
  const road = sel?.kind === 'road' && net ? net.roads[sel.ids[0]!] : undefined;
  return (
    <>
      {road ? <div className="ps-switch"><Segmented<'profile' | 'plan'> label="Vista" size="sm" value={view} onChange={setView} options={[{ value: 'profile', label: 'Profilo e sezioni' }, { value: 'plan', label: 'Andamento planimetrico' }]} /></div> : null}
      {view === 'plan' && road ? <AlignmentView road={road} /> : <VerticalStudio />}
    </>
  );
}

function VerticalStudio() {
  const sel = useApp((s) => s.selection);
  const net = useApp((s) => s.network);
  const baseline = useApp((s) => s.baseline);
  const grid = useTerrain((s) => s.grid);
  const loaded = useTerrain((s) => s.loaded);
  useEffect(() => { if (!loaded) void loadTerrain(); }, [loaded]);
  const road = sel?.kind === 'road' && net ? net.roads[sel.ids[0]!] : undefined;
  const [draft, setDraft] = useState<VerticalProfile | null>(null);
  const [station, setStation] = useState(0);
  useEffect(() => { setDraft(road?.vertical ?? null); setStation(0); }, [road?.id, road?.vertical]); // eslint-disable-line react-hooks/exhaustive-deps
  const length = useMemo(() => (road && baseline ? stationing(road, baseline.origin).length : 0), [road, baseline]);
  const ground = useMemo(() => (road && grid && baseline ? groundProfile(road, grid, baseline.origin, Math.max(2, Math.min(10, length / 150))) : []), [road, grid, baseline, length]);
  const issues = useMemo(() => (road && draft ? checkVertical(road, draft, length) : []), [road, draft, length]);
  const ew = useMemo(() => (road && draft && grid && baseline ? earthworks(road, draft, grid, baseline.origin, 10) : null), [road, draft, grid, baseline]);
  if (!road || !net || !baseline) return <Empty icon="profile" title="Seleziona una strada">Il profilo longitudinale si disegna sulla strada selezionata: livellette, raccordi verticali, sezioni e movimenti terra.</Empty>;
  if (!grid) return <TerrainSetup />;
  if (!ground.some((g) => Number.isFinite(g.z))) return <Empty icon="warning" title="Strada fuori dal modello del terreno">Il DTM caricato non copre questa strada.</Empty>;
  const rules = verticalRules(road);
  const propose = () => { try { setDraft(proposeVertical(net, road, grid, baseline.origin)); } catch (e) { toast.error('Proposta non riuscita', e instanceof Error ? e.message : String(e)); } };
  const apply = () => { if (draft && commit('road.setVertical', { roadId: road.id, vertical: draft }).ok) toast.success('Profilo applicato', `${draft.pvis.length} vertici · sterro ${ew?.cutM3 ?? 0} m³ · riporto ${ew?.fillM3 ?? 0} m³`); };
  const setPvi = (i: number, p: Partial<VerticalPVI>) => draft && setDraft({ pvis: draft.pvis.map((q, k) => (k === i ? { ...q, ...p } : q)) });
  const key = (v: VerticalProfile | null | undefined) => (v ? v.pvis.map((q) => `${q.station.toFixed(2)}:${q.elevation.toFixed(2)}:${(q.curveLength ?? 0).toFixed(1)}`).join('|') : '');
  const dirty = key(draft) !== key(road.vertical);
  return (
    <div className="profile-studio">
      <div className="ps-head">
        <div className="ps-title"><strong>{road.name || 'Strada senza nome'}</strong><span className="muted">{rules.category} · {fmt(length, 1)} m · V progetto {rules.designSpeedKmh} km/h · pendenza max {rules.maxGradePct}% · Rv min {rules.rvConvexMinM} m convesso / {rules.rvConcaveMinM} m concavo · {road.roadClass === 'cycleway' ? <NormRef id="dm-557-1999" article="art. 8" /> : <NormRef id="dm-2001" article="cap. 5" />}</span></div>
        <div className="ps-actions">
          <Button size="sm" variant="ghost" icon="sparkle" onClick={propose}>Proponi livellette</Button>
          {draft ? <Button size="sm" variant="ghost" onClick={() => setDraft({ pvis: sizeCurves(road, draft.pvis) })}>Raccordi automatici</Button> : null}
          {!draft ? <Button size="sm" onClick={() => setDraft({ pvis: [{ station: 0, elevation: Math.round(ground[0]!.z * 100) / 100 }, { station: Math.round(length * 100) / 100, elevation: Math.round(ground[ground.length - 1]!.z * 100) / 100 }] })}>Livelletta unica</Button> : null}
          {road.vertical ? <Button size="sm" variant="danger" onClick={() => commit('road.setVertical', { roadId: road.id, vertical: null })}>Rimuovi profilo</Button> : null}
          <Button variant="project" icon="check" disabled={!draft || !dirty || issues.some((i) => i.severity === 'error')} onClick={apply}>{road.vertical ? 'Aggiorna profilo' : 'Applica profilo'}</Button>
        </div>
      </div>
      <ProfileChart road={road} ground={ground} v={draft} length={length} station={station} onStation={setStation} onChange={setDraft} />
      <p className="muted ps-hint">Marrone: terreno ({grid.source}). Arancio: progetto. Clic: sezione · doppio clic: nuovo vertice · trascina un vertice per cambiarne la quota · tasto destro per eliminarlo.</p>
      {draft ? (
        <div className="ps-body">
          <div className="ps-col">
            <table className="table ps-table">
              <thead><tr><th>#</th><th>Progressiva</th><th>Quota</th><th>Raccordo</th><th>Livelletta</th></tr></thead>
              <tbody>{draft.pvis.map((p, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{i === 0 || i === draft.pvis.length - 1 ? `${fmt(p.station, 1)} m` : <NumberField value={p.station} unit="m" min={1} max={length - 1} decimals={1} ariaLabel="Progressiva" onCommit={(v) => setDraft({ pvis: draft.pvis.map((q, k) => (k === i ? { ...q, station: v } : q)).sort((a, b) => a.station - b.station) })} />}</td>
                  <td><NumberField value={p.elevation} unit="m" min={-100} max={5000} step={0.1} decimals={2} ariaLabel="Quota" onCommit={(v) => setPvi(i, { elevation: v })} /></td>
                  <td>{i === 0 || i === draft.pvis.length - 1 ? '—' : <NumberField value={p.curveLength ?? 0} unit="m" min={0} max={2000} decimals={1} ariaLabel="Lunghezza raccordo" onCommit={(v) => setPvi(i, { curveLength: v })} />}</td>
                  <td>{i > 0 ? `${fmt(pct(draft.pvis[i - 1]!, p))}%` : ''}</td>
                </tr>
              ))}</tbody>
            </table>
            {issues.length ? <ul className="issue-list">{issues.map((x, i) => <li key={i} className={x.severity === 'error' ? 'err' : 'warn'}><Icon name="warning" size={14} /><button type="button" className="link" onClick={() => x.station !== undefined && setStation(x.station)}>{x.message}</button></li>)}</ul>
              : <p className="ok"><Icon name="check" size={14} /> Pendenze e raccordi conformi (verifica semplificata DM 5/11/2001).</p>}
          </div>
          <div className="ps-col">
            {ew ? (
              <>
                <div className="stats-row"><Stat label="Sterro" value={ew.cutM3.toLocaleString('it-IT')} unit="m³" prov="estimated" /><Stat label="Riporto" value={ew.fillM3.toLocaleString('it-IT')} unit="m³" prov="estimated" /><Stat label="Bilancio" value={(ew.cutM3 - ew.fillM3).toLocaleString('it-IT')} unit="m³" /></div>
                <p className="muted">{ew.method}. Piattaforma {fmt(ew.platformWidthM, 1)} m.</p>
              </>
            ) : null}
            <Field label="Sezione trasversale"><CrossSectionView road={road} v={draft} grid={grid} station={station} /></Field>
          </div>
        </div>
      ) : <p className="muted">Nessun profilo di progetto: la strada segue il terreno. Usa «Proponi livellette» per una prima proposta conforme.</p>}
    </div>
  );
}
