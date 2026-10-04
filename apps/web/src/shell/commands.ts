import { copySelection, deleteSelection, duplicateSelection, moveAssets, pasteAt, rotateAssets } from '../state/actions';
import { flushSave, navigate, redo, setDock, setMode, setTool, undo, useApp, type Mode } from '../state/store';
import { api } from '../api/client';
import { toast } from '../state/toasts';
import { TOOLS } from '../tools/registry';
import { fitBounds, useMapUi } from '../map/mapStore';
import { usePalette } from './palette';
import { useShortcuts } from './shortcutsState';
import { importExistingSidewalks } from '../state/existingState';
import { useTool } from '../tools/toolState';

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly shortcut?: string;
  readonly when?: () => boolean;
  run(): void;
}

const inProject = () => !!useApp.getState().project;
const MODES: { id: Mode; label: string; key: string }[] = [
  { id: 'design', label: 'Progetta', key: '1' }, { id: 'analyze', label: 'Analizza', key: '2' }, { id: 'traffic', label: 'Traffico', key: '3' },
  { id: 'transit', label: 'TPL', key: '4' }, { id: 'twin', label: 'Twin 3D', key: '5' }, { id: 'present', label: 'Presenta', key: '6' }, { id: 'civic', label: 'Civico FST', key: '7' },
];
export { MODES };

export async function saveSnapshot(label = 'Salvataggio manuale'): Promise<void> {
  const p = useApp.getState().project;
  if (!p) return;
  await flushSave();
  try {
    await api.post(`/api/projects/${encodeURIComponent(p.id)}/snapshots`, { label });
    toast.success('Versione salvata', label);
  } catch (e) { toast.error('Salvataggio versione non riuscito', e instanceof Error ? e.message : String(e)); }
}

export const COMMANDS: Command[] = [
  { id: 'undo', label: 'Annulla', group: 'Modifica', shortcut: 'Ctrl+Z', when: inProject, run: undo },
  { id: 'redo', label: 'Ripristina', group: 'Modifica', shortcut: 'Ctrl+Y', when: inProject, run: redo },
  { id: 'delete', label: 'Elimina selezione', group: 'Modifica', shortcut: 'Canc', when: () => !!useApp.getState().selection, run: deleteSelection },
  { id: 'duplicate', label: 'Duplica selezione', group: 'Modifica', shortcut: 'Ctrl+D', when: () => !!useApp.getState().selection, run: () => duplicateSelection() },
  { id: 'copy', label: 'Copia', group: 'Modifica', shortcut: 'Ctrl+C', when: () => !!useApp.getState().selection, run: copySelection },
  { id: 'paste', label: 'Incolla nel punto del cursore', group: 'Modifica', shortcut: 'Ctrl+V', when: inProject, run: () => { const p = useMapUi.getState().pointer; if (p) pasteAt(p); } },
  { id: 'deselect', label: 'Deseleziona', group: 'Modifica', shortcut: 'Esc', when: inProject, run: () => useApp.setState({ selection: null }) },
  { id: 'snapshot', label: 'Salva una versione', group: 'Progetto', shortcut: 'Ctrl+S', when: inProject, run: () => void saveSnapshot() },
  { id: 'hub', label: 'Torna al Project Hub', group: 'Progetto', when: inProject, run: () => navigate({ view: 'hub' }) },
  { id: 'layers', label: 'Livelli', group: 'Vista', shortcut: 'Ctrl+L', when: inProject, run: () => setDock('layers') },
  { id: 'history', label: 'Cronologia e versioni', group: 'Progetto', when: inProject, run: () => setDock('history') },
  { id: 'export', label: 'Esporta', group: 'Progetto', shortcut: 'Ctrl+E', when: inProject, run: () => setDock('export') },
  { id: 'sidewalks', label: 'Importa marciapiedi esistenti (dalle sagome degli edifici)', group: 'Progetto', when: inProject, run: () => void importExistingSidewalks() },
  { id: 'plans', label: 'Piani: urbanistico (PUC/PRG, standard DM 1444), traffico (PGTU), indicatori PUMS', group: 'Analisi', when: inProject, run: () => setDock('plans') },
  { id: 'water', label: 'Rete acquedotto: pressioni, velocità, prova antincendio, dimensionamento', group: 'Progetto', when: inProject, run: () => setDock('water') },
  { id: 'drainage', label: 'Drenaggio urbano: rete di caditoie e collettori, verifica e dimensionamento', group: 'Progetto', when: inProject, run: () => setDock('drainage') },
  { id: 'norms', label: 'Normativa e verifiche di conformità (CdS, DM 5/11/2001, accessibilità…)', group: 'Analisi', when: inProject, run: () => setDock('norms') },
  { id: 'quantities', label: 'Computo metrico estimativo dello scenario', group: 'Progetto', when: inProject, run: () => setDock('quantities') },
  { id: 'profile', label: 'Profilo longitudinale, livellette e movimenti terra della strada selezionata', group: 'Progetto', when: inProject, run: () => { setMode('design'); setDock('profile'); } },
  { id: 'connect', label: 'Aggancia strade non collegate (senza deformare la rete)', group: 'Progetto', when: inProject, run: () => { setMode('design'); setDock('connect'); } },
  { id: 'audit', label: 'Verifica progetto (geometria, topologia, semafori)', group: 'Analisi', when: inProject, run: () => { setMode('analyze'); setDock('audit'); } },
  { id: 'settings', label: 'Impostazioni e chiavi API', group: 'Sistema', when: () => true, run: () => setDock('settings') },
  { id: 'qa', label: 'Diagnostica sviluppatore', group: 'Sistema', shortcut: 'Ctrl+Shift+D', when: () => true, run: () => setDock('qa') },
  { id: 'snapGrid', label: 'Snap alla griglia on/off', group: 'Vista', when: inProject, run: () => useMapUi.setState((s) => ({ snap: { ...s.snap, grid: !s.snap.grid } })) },
  { id: 'shortcuts', label: 'Scorciatoie da tastiera', group: 'Aiuto', shortcut: '?', when: () => true, run: () => useShortcuts.getState().toggle() },
  { id: 'search', label: 'Cerca comandi, luoghi, strade', group: 'Vista', shortcut: '/', when: () => true, run: () => usePalette.getState().toggle() },
  { id: 'frame', label: 'Inquadra la selezione', group: 'Vista', shortcut: 'Shift+F', when: () => !!useApp.getState().selection, run: frameSelection },
  { id: 'frameAll', label: 'Inquadra tutto il progetto', group: 'Vista', shortcut: '0', when: inProject, run: () => { const b = useApp.getState().baseline; if (b) fitBounds(b.bbox); } },
  { id: 'focus', label: 'Modalità focus (nascondi pannelli)', group: 'Vista', shortcut: '\\', when: inProject, run: () => useMapUi.setState((s) => ({ focus: !s.focus })) },
  { id: 'rotateL', label: 'Ruota selezione −15°', group: 'Modifica', shortcut: 'Q', when: () => useApp.getState().selection?.kind === 'asset' && useApp.getState().tool === 'select', run: () => rotateAssets(useApp.getState().selection!.ids, -15) },
  { id: 'rotateR', label: 'Ruota selezione +15°', group: 'Modifica', shortcut: 'E', when: () => useApp.getState().selection?.kind === 'asset' && useApp.getState().tool === 'select', run: () => rotateAssets(useApp.getState().selection!.ids, 15) },
  ...MODES.map((m): Command => ({ id: `mode.${m.id}`, label: `Modalità ${m.label}`, group: 'Modalità', shortcut: `Alt+${m.key}`, when: inProject, run: () => setMode(m.id) })),
  ...TOOLS.map((t): Command => ({ id: `tool.${t.id}`, label: `Strumento ${t.label}`, group: 'Strumenti', shortcut: t.shortcut, when: () => inProject() && t.modes.includes(useApp.getState().mode), run: () => setTool(t.id) })),
];

/** Fits the map to whatever is selected (roads, nodes, objects, roundabouts, areas, zones). */
function frameSelection(): void {
  const { selection, network } = useApp.getState();
  if (!selection || !network) return;
  const pts: (readonly [number, number])[] = [];
  for (const id of selection.ids) {
    if (selection.kind === 'road') pts.push(...(network.roads[id]?.axis ?? []));
    else if (selection.kind === 'node' && network.nodes[id]) pts.push(network.nodes[id]!.at);
    else if (selection.kind === 'asset' && network.assets[id]) pts.push(network.assets[id]!.at);
    else if (selection.kind === 'area') pts.push(...(network.areas[id]?.polygon ?? []));
    else if (selection.kind === 'zone') pts.push(...(network.zones[id]?.polygon ?? []));
    else if (selection.kind === 'roundabout' && network.roundabouts[id]) {
      const rb = network.roundabouts[id]!, d = rb.outerDiameterM / 111_000;
      pts.push([rb.center[0] - d, rb.center[1] - d], [rb.center[0] + d, rb.center[1] + d]);
    }
  }
  if (!pts.length) return;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 0.0002;
  fitBounds([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad], 80);
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Global keyboard dispatcher. Tool handlers get the first chance on keys while drawing. */
export function installShortcuts(toolKey: (e: KeyboardEvent) => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); usePalette.getState().toggle(); return; }
    if (!useApp.getState().project) return;
    if (toolKey(e)) { e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    const run = (id: string) => { const c = COMMANDS.find((x) => x.id === id); if (c && (!c.when || c.when())) { e.preventDefault(); c.run(); } };
    if (ctrl && k === 'z' && !e.shiftKey) return run('undo');
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return run('redo');
    if (ctrl && k === 'd' && e.shiftKey) return run('qa');
    if (ctrl && k === 'd') return run('duplicate');
    if (ctrl && k === 'c') return run('copy');
    if (ctrl && k === 'v') return run('paste');
    if (ctrl && k === 's') return run('snapshot');
    if (ctrl && k === 'l') return run('layers');
    if (ctrl && k === 'e') return run('export');
    if (!ctrl && !e.altKey) {
      if (e.key === '?') return run('shortcuts');
      if (e.key === '/') return run('search');
      if (e.key === '\\') return run('focus');
      if (e.key === '0') return run('frameAll');
      if (e.shiftKey && k === 'f') return run('frame');
      const s = useApp.getState();
      if ((k === 'q' || k === 'e') && s.selection?.kind === 'asset' && s.tool === 'select') return run(k === 'q' ? 'rotateL' : 'rotateR');
    }
    if (e.altKey && /^[1-7]$/.test(e.key)) { const m = MODES[Number(e.key) - 1]; if (m) { e.preventDefault(); setMode(m.id); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') return run('delete');
    if (e.key === 'Escape') { useTool.setState({ draft: [] }); return run('deselect'); }
    const sel = useApp.getState().selection;
    if (sel?.kind === 'asset' && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.1;
      moveAssets(sel.ids, k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? step : k === 'arrowdown' ? -step : 0);
      return;
    }
    if (ctrl || e.altKey) return;
    const mode = useApp.getState().mode;
    const tool = TOOLS.find((t) => t.shortcut?.toLowerCase() === k && t.modes.includes(mode));
    if (tool) { e.preventDefault(); setTool(tool.id); }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
