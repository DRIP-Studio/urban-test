import { useModalFocus } from '../ui/useModalFocus';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LngLat } from '@drip-urban/core';
import { api } from '../api/client';
import { flyTo, getMap, useMapUi } from '../map/mapStore';
import { deleteSelection, duplicateSelection, pasteAt } from '../state/actions';
import { navigate, moveWorkArea, select, selectScenario, setDock, setMode, setTool, useApp, commit } from '../state/store';
import { dismiss, pauseToast, useToasts } from '../state/toasts';
import { GROUP_LABEL, TOOLS } from '../tools/registry';
import { setLive, useLive } from '../state/live';
import { pickAt } from '../tools/select';
import { usePicks } from '../tools/picks';
import { toggleElios, useElios } from '../elios/Elios';
import { useTool } from '../tools/toolState';
import { DEFAULT_RB } from '../tools/roundabout';
import { toggleAllSnaps } from '../tools/snap';
import { Icon } from '../ui/Icon';
import { COMMANDS } from './commands';
import { useContextMenu } from './contextMenu';
import { usePalette } from './palette';
import {useUtilityFocus} from '../state/utilityFocus';
import type {ProjectSummary} from '../api/types';
import { searchScore, searchProject } from './projectSearch';

const RAIL_KEY = 'drip.rail.expanded';
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } };

export function ToolRail() {
  const mode = useApp((s) => s.mode);
  const tool = useApp((s) => s.tool);
  const eliosOpen = useElios((s) => s.open);
  const [expanded, setExpanded] = useState(readRail);
  const toggle = () => { setExpanded((v) => { try { localStorage.setItem(RAIL_KEY, v ? '0' : '1'); } catch { /* private mode */ } return !v; }); };
  const tools = TOOLS.filter((t) => t.modes.includes(mode));
  const groups = [...new Set(tools.map((t) => t.group))];
  const tip = (label: string) => (expanded ? undefined : label);
  return (
    <nav className={`rail ${expanded ? 'is-expanded' : ''}`} aria-label="Strumenti">
      <button type="button" className="rail-btn rail-toggle" onClick={toggle} aria-expanded={expanded} aria-label={expanded ? 'Riduci la barra strumenti' : 'Mostra i nomi degli strumenti'} data-tip={tip('Mostra i nomi')} data-tip-side="right">
        <Icon name={expanded ? 'chevronLeft' : 'menu'} size={18} />
        <span>{expanded ? 'Riduci' : 'Espandi'}</span>
      </button>
      {groups.map((g) => (
        <div key={g} className="rail-group" role="group" aria-label={GROUP_LABEL[g]}>
          <span className="rail-label">{GROUP_LABEL[g]}</span>
          {tools.filter((t) => t.group === g).map((t) => (
            <button key={t.id} type="button" className={`rail-btn ${tool === t.id ? 'is-on' : ''}`} onClick={() => setTool(t.id)} aria-pressed={tool === t.id} aria-label={t.label} aria-keyshortcuts={t.shortcut || undefined} data-tip={tip(`${t.label}${t.shortcut ? ` · ${t.shortcut}` : ''}`)} data-tip-side="right">
              <Icon name={t.icon} size={20} />
              <span>{t.label}{t.shortcut ? <kbd>{t.shortcut}</kbd> : null}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="rail-group rail-end" role="group" aria-label="Assistente">
        <span className="rail-label">Assistente</span>
        <button type="button" className={`rail-btn ${eliosOpen ? 'is-on' : ''}`} onClick={toggleElios} aria-pressed={eliosOpen} aria-label="Elios, assistente AI" data-tip={tip('Elios · assistente AI')} data-tip-side="right">
          <Icon name="sparkle" size={20} />
          <span>Elios</span>
        </button>
      </div>
    </nav>
  );
}

export function ToolHint() {
  const tool = useApp((s) => s.tool);
  const def = TOOLS.find((t) => t.id === tool);
  const measure = useTool((s) => s.measure);
  if (!def || def.id === 'select') return null;
  return (
    <div className="tool-hint" role="status">
      <Icon name={def.icon} size={15} /><strong>{def.label}</strong><span>{def.hint}</span>
      {measure && def.id === 'measure' ? <span className="mono">{measure.total.toFixed(1).replace('.', ',')} m{measure.area !== null ? ` · ${Math.round(measure.area).toLocaleString('it-IT')} m²` : ''}</span> : null}
    </div>
  );
}

const fmtCoord = (p: LngLat | null) => (p ? `${p[1].toFixed(6)}, ${p[0].toFixed(6)}` : '—');

export function StatusBar() {
  const { zoom, mpp, pointer, snap, snapEnabled, gridM } = useMapUi();
  const stats = useApp((s) => s.physStats);
  const failed = useApp((s) => s.failedOps);
  const scenario = useApp((s) => s.scenario);
  const project = useApp((s) => s.project);
  const scale = Math.round((mpp * 96) / 0.0254);
  return (
    <footer className="statusbar">
      <span className="sb-item">{project?.city ?? ''}</span>
      <span className="sb-item mono">{fmtCoord(pointer)}</span>
      <span className="sb-item mono">z {zoom.toFixed(1)} · 1:{scale.toLocaleString('it-IT')}</span>
      <button type="button" className={`sb-item sb-toggle ${snapEnabled ? 'is-on' : ''}`} aria-pressed={snapEnabled} aria-keyshortcuts="F9" title="Tutti gli agganci · F9 · Alt sospende durante il disegno" onClick={toggleAllSnaps}>
        Snap {snapEnabled ? 'on' : 'off'} · F9
      </button>
      <button type="button" className={`sb-item sb-toggle ${snap.grid ? 'is-on' : ''}`} onClick={() => useMapUi.setState((s) => ({ snap: { ...s.snap, grid: !s.snap.grid } }))}>
        Griglia {gridM.toString().replace('.', ',')} m
      </button>
      <button type="button" className={`sb-item sb-toggle ${snap.angle ? 'is-on' : ''}`} onClick={() => useMapUi.setState((s) => ({ snap: { ...s.snap, angle: !s.snap.angle } }))}>Angolo 15°</button>
      <button type="button" className={`sb-item sb-toggle ${snap.objects ? 'is-on' : ''}`} aria-pressed={snap.objects} title="Arredo e cartelli allineati alla strada, segnaletica centrata sulla corsia · F9 spegne tutti gli agganci" onClick={() => useMapUi.setState((s) => ({ snap: { ...s.snap, objects: !s.snap.objects } }))}>Aggancio elementi</button>
      <LiveToggle />
      <WorkAreaControl />
      <span className="sb-spacer" />
      {failed.length ? (
        <button type="button" className="sb-item sb-warn" onClick={() => { setMode('analyze'); setDock('audit'); }}>
          <Icon name="warning" size={13} />{failed.length} {project?.large ? 'modifiche fuori dalla zona di lavoro o non applicabili' : 'operazioni non applicabili'}
        </button>
      ) : null}
      {scenario ? <span className="sb-item">{scenario.operations.length} modifiche</span> : null}
      {stats ? <span className="sb-item mono" title="Modello fisico: strade, incroci, rotatorie, elementi di segnaletica — tempo di calcolo">{stats.roads} strade · {stats.junctions} incroci · {stats.markings} marking · {stats.ms} ms</span> : <span className="sb-item">Calcolo modello fisico…</span>}
    </footer>
  );
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} onMouseEnter={() => pauseToast(t.id, 'hover', true)} onMouseLeave={() => pauseToast(t.id, 'hover', false)} onFocusCapture={() => pauseToast(t.id, 'focus', true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) pauseToast(t.id, 'focus', false); }}>
          <Icon name={t.kind === 'error' ? 'warning' : t.kind === 'warn' ? 'warning' : t.kind === 'success' ? 'check' : 'info'} size={16} />
          <div className="toast-text"><strong>{t.title}</strong>{t.body ? <span>{t.body}</span> : null}
            {t.progress !== undefined ? <span className="progress"><span style={{ width: '100%', transformOrigin: 'left', transform: `scaleX(${Math.max(0, Math.min(1, t.progress))})` }} /></span> : null}
          </div>
          {t.action ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button> : null}
          <button type="button" className="toast-close" aria-label="Chiudi" onClick={() => dismiss(t.id)}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function ContextMenu() {
  const req = useContextMenu((s) => s.req);
  const close = useContextMenu((s) => s.close);
  useEffect(() => {
    if (!req) return;
    const off = () => close();
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', off);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', off); };
  }, [req, close]);
  const hit = useMemo(() => { const map = getMap(); return req && map ? pickAt(map, req.point) : null; }, [req]);
  useEffect(() => { if (hit) select(hit); }, [hit]);
  if (!req) return null;
  const items: { label: string; icon: string; run: () => void; danger?: boolean }[] = [];
  const map = getMap();
  const head = map && map.getLayer('plan-signals-icon') ? map.queryRenderedFeatures([[req.point.x - 8, req.point.y - 8], [req.point.x + 8, req.point.y + 8]], { layers: ['plan-signals-icon'] })[0] : undefined;
  if (head?.properties.planId) {
    const plan = useApp.getState().network?.signalPlans[String(head.properties.planId)];
    if (plan) items.push({ label: 'Rimuovi questa lanterna', icon: 'signal', danger: true, run: () => { commit('signal.setHeads', { planId: plan.id, disabledHeads: [...(plan.disabledHeads ?? []), String(head.properties.key)] }); } });
    // Vehicle heads: take the whole approach out of the signal plan, so its traffic stops elsewhere.
    const roadId = head.properties.roadId ? String(head.properties.roadId) : '';
    if (plan && roadId && !head.properties.pedestrian) {
      items.push({ label: 'Ramo senza semaforo: dare precedenza', icon: 'warning', run: () => { commit('signal.setApproach', { planId: plan.id, roadId, control: 'give_way' }); } });
      items.push({ label: 'Ramo senza semaforo: STOP', icon: 'stop', run: () => { commit('signal.setApproach', { planId: plan.id, roadId, control: 'stop' }); } });
      items.push({ label: 'Ramo senza semaforo: libero', icon: 'route', run: () => { commit('signal.setApproach', { planId: plan.id, roadId, control: 'free' }); } });
    }
  }
  if (hit?.kind === 'node') {
    items.push({ label: 'Apri Junction Lab', icon: 'junction', run: () => { setMode('design'); setDock('junction'); } });
    items.push({ label: 'Signal Studio', icon: 'signal', run: () => { setMode('design'); setDock('signals'); } });
    items.push({ label: 'Inserisci rotatoria qui', icon: 'roundabout', run: () => { setMode('design'); setTool('roundabout'); const node = useApp.getState().network?.nodes[hit.ids[0]!]; if (node) useTool.setState({ rb: { ...DEFAULT_RB, center: node.at, nodeId: node.id, placed: true } }); } });
  }
  if (hit?.kind === 'road') {
    items.push({ label: 'Modifica sezione', icon: 'section', run: () => setDock('section') });
    items.push({ label: 'Modifica vertici', icon: 'node', run: () => setTool('nodes') });
  }
  if (hit && (hit.kind === 'asset' || hit.kind === 'area')) items.push({ label: 'Duplica', icon: 'duplicate', run: () => duplicateSelection() });
  items.push({ label: 'Incolla qui', icon: 'import', run: () => pasteAt(req.lngLat) });
  items.push({ label: 'Percorso da qui', icon: 'route', run: () => { usePicks.setState({ from: req.lngLat, to: null }); setMode('traffic'); setTool('route'); } });
  items.push({ label: 'Isocrona a piedi da qui', icon: 'walk', run: () => { setMode('analyze'); usePicks.getState().pickIsochrone(req.lngLat); } });
  if (hit) items.push({ label: 'Elimina', icon: 'trash', run: deleteSelection, danger: true });
  return (
    <div className="context-menu" style={{ left: Math.min(req.x, innerWidth - 240), top: Math.min(req.y, innerHeight - items.length * 34 - 16) }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
      {items.map((i) => (
        <button key={i.label} type="button" role="menuitem" className={`menu-item ${i.danger ? 'is-danger' : ''}`} onClick={() => { close(); i.run(); }}>
          <Icon name={i.icon} size={15} /><span>{i.label}</span>
        </button>
      ))}
    </div>
  );
}

interface PaletteItem { id: string; label: string; group: string; hint?: string; run: () => void }

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const close = usePalette((s) => s.close);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [places, setPlaces] = useState<PaletteItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useModalFocus(open, modal);
  const network = useApp((s) => s.network);
  const baseline = useApp((s) => s.baseline);
  const [projects,setProjects]=useState<ProjectSummary[]>([]);
  useEffect(()=>{if(!open)return;let alive=true;api.get<ProjectSummary[]>('/api/projects').then(rows=>{if(alive)setProjects(rows);}).catch(()=>undefined);return()=>{alive=false;};},[open]);
  const project = useApp((s) => s.project);
  const catalogs = useApp((s) => s.catalogs);
  useEffect(() => { if (open) { setQ(''); setHi(0); setPlaces([]); } }, [open]);
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmds: PaletteItem[] = COMMANDS.filter((c) => !c.when || c.when()).map((c) => ({ id: c.id, label: c.label, group: c.group, hint: c.shortcut, run: c.run }));
    const objects: PaletteItem[] = network ? searchProject(network, q, catalogs,20,baseline).map((r) => ({ id: `${r.kind}:${r.id}`, label: r.label, group: r.group, hint: r.id, run: () => { flyTo([r.at[0], r.at[1]],18);if(r.kind==='transit'){setMode('transit');usePicks.setState({selectedRouteId:r.parentId??r.id});}else if(r.kind==='utilityNode'||r.kind==='utilityLink'){useUtilityFocus.setState({kind:r.kind==='utilityNode'?'node':'link',id:r.id});setMode('design');setDock('utilities');}else{setMode('design');select({kind:r.kind,ids:[r.id]});} } })) : [];
    const scenarios: PaletteItem[] = ql.length >= 2 ? (project?.scenarios ?? []).filter((s) => !s.archived && s.name.toLowerCase().includes(ql)).map((s) => ({ id: `scenario:${s.id}`, label: s.name, group: 'Scenari', run: () => { void selectScenario(s.id); } })) : [];
    const projectItems:PaletteItem[]=ql.length>=2?projects.filter(p=>p.id!==project?.id&&Number.isFinite(searchScore(p.name,ql))).slice(0,8).map(p=>({id:`project:${p.id}`,label:p.name,group:'Progetti',run:()=>navigate({view:'workspace',projectId:p.id})})):[];
    return [...cmds.filter(c=>!ql||Number.isFinite(searchScore(c.label+' '+c.group,ql))).sort((a,b)=>searchScore(a.label,ql)-searchScore(b.label,ql)).slice(0,14), ...objects,...scenarios,...projectItems,...places];
  }, [q, network, catalogs, project, places,baseline,projects]);
  useEffect(() => {
    setPlaces([]);
    if (!open || q.trim().length < 3 || !project) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get<{ name: string; at: [number, number] }[]>(`/api/geocode?q=${encodeURIComponent(q)}&bbox=${project.bbox.join(',')}`)
        .then((rows) => { if (!cancelled) setPlaces(rows.slice(0, 6).map((r, i) => ({ id: `geo:${i}`, label: r.name, group: 'Luoghi (OpenStreetMap Nominatim)', run: () => flyTo(r.at, 18) }))); })
        .catch(() => { if (!cancelled) setPlaces([]); });
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open, project]);
  if (!open) return null;
  const runAt = (i: number) => { const it = items[i]; if (it) { close(); it.run(); } };
  let lastGroup = '';
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div ref={modal} className="palette" role="dialog" aria-modal="true" aria-label="Comandi" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input ref={input} value={q} placeholder="Comandi, strade, oggetti, segnali, scenari, luoghi…" aria-label="Cerca" onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.max(0, Math.min(items.length - 1, h + 1))); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              if (e.key === 'Enter') runAt(hi);
            }} />
        </div>
        <div className="palette-list" role="listbox">
          {items.length === 0 ? <div className="palette-empty">Nessun risultato per “{q}”</div> : items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="palette-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head}
                <button type="button" role="option" aria-selected={i === hi} className={`palette-item ${i === hi ? 'is-hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => runAt(i)}>
                  <span>{it.label}</span>{it.hint ? <kbd className="kbd">{it.hint}</kbd> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LiveToggle() {
  const { enabled, running } = useLive();
  return (
    <button type="button" className={`sb-item sb-toggle ${enabled ? 'is-on' : ''}`} title="Aggiornamento automatico di verifiche, analisi e mappe a ogni modifica" onClick={() => setLive(!enabled)}>
      <span className={`live-dot ${enabled ? (running ? 'is-busy' : 'is-on') : ''}`} />Live {enabled ? (running ? '· aggiorno' : 'on') : 'off'}
    </button>
  );
}

/** Large projects: the loaded work area and a command to move it to the visible map. */
function WorkAreaControl() {
  const project = useApp((s) => s.project);
  const baseline = useApp((s) => s.baseline);
  const [busy, setBusy] = useState(false);
  if (!project?.large || !baseline) return null;
  const [w, s, e, n] = baseline.bbox;
  const km2 = Math.abs(e - w) * 111.32 * Math.cos(((s + n) / 2) * Math.PI / 180) * Math.abs(n - s) * 110.57;
  const move = async () => {
    const m = getMap();
    if (!m) return;
    const b = m.getBounds();
    setBusy(true);
    try { await moveWorkArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); } finally { setBusy(false); }
  };
  return (
    <button type="button" className="sb-item sb-toggle is-on" title="Progetto grande: si lavora per zone. Inquadra un'altra parte della città e premi per caricarla (fino a 36 km²)." onClick={() => void move()} disabled={busy}>
      <Icon name="map" size={13} />Zona di lavoro {km2.toFixed(1).replace('.', ',')} km² · {busy ? 'caricamento…' : 'lavora qui'}
    </button>
  );
}
