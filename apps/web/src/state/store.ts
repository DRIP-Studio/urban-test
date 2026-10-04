import { create } from 'zustand';
import {
  OperationRejected, ScenarioHistory, ScenarioReadOnly,
  type CityBaseline, type Issue, type Network, type Operation,
} from '@drip-urban/core';
import { api, ApiError } from '../api/client';
import type { Catalogs, ProjectDetail, StoredScenario, UserInfo } from '../api/types';
import { engine } from '../engine/engine';
import { toast } from './toasts';

export type Mode = 'design' | 'analyze' | 'traffic' | 'transit' | 'twin' | 'present' | 'civic';
export type SelectionKind = 'road' | 'node' | 'roundabout' | 'asset' | 'area' | 'zone' | 'feature' | 'marking' | 'building';
export interface Selection { readonly kind: SelectionKind; readonly ids: readonly string[] }
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'offline' | 'error' | 'conflict';
export type Route = { view: 'hub' } | { view: 'workspace'; projectId: string } | { view: 'publication'; pubId: string };

interface PhysStats { roads: number; junctions: number; roundabouts: number; markings: number; ms: number }

interface AppState {
  route: Route;
  user: UserInfo | null;
  catalogs: Catalogs | null;
  project: ProjectDetail | null;
  baseline: CityBaseline | null;
  loading: string | null;
  loadError: string | null;
  scenario: StoredScenario | null;
  history: ScenarioHistory | null;
  network: Network | null;
  /** Bumped on every network change: cheap dependency for derived UI. */
  netVersion: number;
  mode: Mode;
  tool: string;
  selection: Selection | null;
  dock: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  physStats: PhysStats | null;
  failedOps: { opId: string; type: string; messages: string[] }[];
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  compareBaseline: boolean;
}

const initial: AppState = {
  route: { view: 'hub' }, user: null, catalogs: null, project: null, baseline: null, loading: null, loadError: null,
  scenario: null, history: null, network: null, netVersion: 0, mode: 'design', tool: 'select', selection: null, dock: null,
  saveStatus: 'saved', lastSavedAt: null, physStats: null, failedOps: [], canUndo: false, canRedo: false, undoLabel: null, redoLabel: null,
  compareBaseline: false,
};

export const useApp = create<AppState>(() => initial);
const set = useApp.setState;
const get = useApp.getState;

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------- routing (hash based)

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'p' && b) return { view: 'workspace', projectId: decodeURIComponent(b) };
  if (a === 'civico' && b) return { view: 'publication', pubId: decodeURIComponent(b) };
  return { view: 'hub' };
}

export function navigate(route: Route): void {
  const hash = route.view === 'workspace' ? `#/p/${encodeURIComponent(route.projectId)}` : route.view === 'publication' ? `#/civico/${encodeURIComponent(route.pubId)}` : '#/';
  if (location.hash !== hash) location.hash = hash;
  else void applyRoute(route);
}

async function applyRoute(route: Route): Promise<void> {
  set({ route });
  if (route.view === 'workspace') {
    if (get().project?.id !== route.projectId) await openProject(route.projectId);
  } else if (get().project) {
    await flushSave();
    closeProject();
  }
}

let routingStarted = false;
export function startRouting(): void {
  if (routingStarted) return; // StrictMode mounts effects twice: one listener only
  routingStarted = true;
  window.addEventListener('hashchange', () => void applyRoute(parseHash()));
  void applyRoute(parseHash());
  void loadCatalogs();
  void refreshUser();
}

export async function refreshUser(): Promise<void> {
  try { set({ user: await api.get<UserInfo>('/api/user') }); } catch { /* server offline handled by hub */ }
}

async function loadCatalogs(): Promise<void> {
  try {
    const [signs, furniture, materials] = await Promise.all([
      api.get<Catalogs['signs']>('/catalog/signs.json'), api.get<Catalogs['furniture']>('/catalog/furniture.json'), api.get<Catalogs['materials']>('/catalog/materials.json'),
    ]);
    set({ catalogs: { signs, furniture, materials } });
  } catch (e) {
    toast.error('Cataloghi non caricati', e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- project lifecycle

const pendingKey = (pid: string, sid: string) => `drip-urban:pending:${pid}:${sid}`;

let opening: string | null = null;
export async function openProject(pid: string): Promise<void> {
  if (opening === pid) return;
  opening = pid;
  set({ loading: 'Apertura progetto', loadError: null });
  try {
    const project = await api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(pid)}`);
    set({ loading: 'Caricamento della città' });
    // The baseline is cached as immutable; its revision changes when the existing state is updated.
    const area = project.large && project.workArea ? `&bbox=${project.workArea.map((x) => x.toFixed(6)).join(',')}` : '';
    if (project.large) set({ loading: 'Caricamento della zona di lavoro' });
    const baseline = await api.get<CityBaseline>(`/api/projects/${encodeURIComponent(pid)}/baseline?rev=${project.baselineRevision ?? 0}${area}`);
    set({ loading: 'Costruzione del modello fisico' });
    await engine.init(baseline);
    set({ project, baseline, loading: null, mode: 'design', tool: 'select', selection: null, dock: null });
    await selectScenario(project.activeScenarioId || project.scenarios.find((s) => !s.isBaseline)?.id || 'baseline');
    void import('./sidewalks').then((m) => m.initSidewalks());
    void import('../models/models').then((m) => m.loadModels());
  } catch (e) {
    set({ loading: null, loadError: e instanceof Error ? e.message : String(e) });
  } finally {
    opening = null;
  }
}

export function closeProject(): void {
  set({ project: null, baseline: null, scenario: null, history: null, network: null, selection: null, physStats: null, failedOps: [] });
}

export async function refreshProject(): Promise<void> {
  const p = get().project;
  if (!p) return;
  set({ project: await api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(p.id)}`) });
}

export async function selectScenario(sid: string): Promise<void> {
  const { project, baseline } = get();
  if (!project || !baseline) return;
  await flushSave();
  let sc = await api.get<StoredScenario>(`/api/projects/${encodeURIComponent(project.id)}/scenarios/${encodeURIComponent(sid)}`);
  // Crash / offline recovery: a locally queued save newer than the server copy.
  const pending = localStorage.getItem(pendingKey(project.id, sid));
  if (pending) {
    try {
      const p = JSON.parse(pending) as { baseRevision: number; operations: Operation[]; at: string };
      if (p.baseRevision === sc.revision) {
        sc = { ...sc, operations: p.operations };
        toast.info('Modifiche recuperate', `Ripristinate le modifiche non salvate del ${new Date(p.at).toLocaleString('it-IT')}.`);
        set({ saveStatus: 'dirty' });
        scheduleSave();
      } else {
        localStorage.removeItem(pendingKey(project.id, sid));
      }
    } catch { localStorage.removeItem(pendingKey(project.id, sid)); }
  }
  const author = get().user?.name ?? 'Utente locale';
  const history = new ScenarioHistory(baseline, sc, author, () => newId('op'));
  set({ scenario: sc, history, selection: null });
  syncFromHistory();
  if (project.activeScenarioId !== sid) void api.patch(`/api/projects/${encodeURIComponent(project.id)}`, { activeScenarioId: sid }).catch(() => undefined);
}

function syncFromHistory(): void {
  const h = get().history;
  if (!h) return;
  set((s) => ({
    network: h.network, netVersion: s.netVersion + 1, canUndo: h.canUndo, canRedo: h.canRedo,
    undoLabel: h.undoEntry?.label ?? null, redoLabel: h.redoEntry?.label ?? null,
    scenario: s.scenario ? { ...s.scenario, operations: h.scenario.operations } : s.scenario,
  }));
  engine.build(h.scenario.operations);
}

engine.onPhysical((m) => set({ physStats: m.stats, failedOps: m.failed }));

// ---------------------------------------------------------------- command bus

export interface CommitResult { ok: boolean; issues: Issue[] }

/** The single entry point for every scenario change (undoable, validated, autosaved). */
type CommitListener = (before: Network, after: Network, type: string) => void;
const commitListeners = new Set<CommitListener>();
/** Called after every successful edit (not on undo/redo): used by the suggestions engine. */
export function onCommit(l: CommitListener): () => void { commitListeners.add(l); return () => commitListeners.delete(l); }

export function commit<P>(type: string, payload: P, opts: { silent?: boolean } = {}): CommitResult {
  const h = get().history;
  if (!h) return { ok: false, issues: [] };
  try {
    const before = h.network;
    const { warnings } = h.commit({ type, payload });
    syncFromHistory();
    markDirty();
    for (const l of commitListeners) { try { l(before, h.network, type); } catch (err) { console.error(err); } }
    if (warnings.length && !opts.silent) toast.warn('Operazione applicata con avvisi', warnings.map((w) => w.message).join(' · '));
    return { ok: true, issues: warnings };
  } catch (e) {
    if (e instanceof OperationRejected) {
      if (!opts.silent) toast.error('Operazione non valida', e.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' · '));
      return { ok: false, issues: [...e.issues] };
    }
    if (e instanceof ScenarioReadOnly) {
      if (!opts.silent) toast.warn('Scenario non modificabile', e.message);
      return { ok: false, issues: [{ code: 'readonly', severity: 'error', message: e.message }] };
    }
    throw e;
  }
}

export function undo(): void {
  const e = get().history?.undo();
  if (e) { syncFromHistory(); markDirty(); toast.info('Annullato', e.label); }
}
export function redo(): void {
  const e = get().history?.redo();
  if (e) { syncFromHistory(); markDirty(); toast.info('Ripristinato', e.label); }
}

// ---------------------------------------------------------------- autosave

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

function markDirty(): void {
  set({ saveStatus: 'dirty' });
  const { project, scenario, history } = get();
  if (project && scenario && history) {
    localStorage.setItem(pendingKey(project.id, scenario.id), JSON.stringify({ baseRevision: scenario.revision, operations: history.scenario.operations, at: new Date().toISOString() }));
  }
  scheduleSave();
}

function scheduleSave(delay = 900): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), delay);
}

async function save(): Promise<void> {
  if (saving) { await saving; }
  const { project, scenario, history, saveStatus } = get();
  if (!project || !scenario || !history || saveStatus === 'saved' || saveStatus === 'conflict' || scenario.isBaseline) return;
  set({ saveStatus: 'saving' });
  const ops = history.scenario.operations;
  saving = (async () => {
    try {
      const res = await api.put<{ revision: number; updatedAt: string }>(`/api/projects/${encodeURIComponent(project.id)}/scenarios/${encodeURIComponent(scenario.id)}`, { scenario: { operations: ops }, baseRevision: scenario.revision });
      const stillSame = get().history?.scenario.operations === ops;
      set((s) => ({ scenario: s.scenario ? { ...s.scenario, revision: res.revision, updatedAt: res.updatedAt } : s.scenario, saveStatus: stillSame ? 'saved' : 'dirty', lastSavedAt: res.updatedAt }));
      if (stillSame) localStorage.removeItem(pendingKey(project.id, scenario.id));
      else scheduleSave(200);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await rebaseOnServer(project.id, scenario.id, ops);
      } else if (e instanceof ApiError && e.status === 0) {
        set({ saveStatus: 'offline' });
        scheduleSave(5000);
      } else {
        set({ saveStatus: 'error' });
        toast.error('Salvataggio non riuscito', e instanceof Error ? e.message : String(e));
        scheduleSave(8000);
      }
    }
  })();
  await saving;
  saving = null;
}

/** Colleague whose save is waiting to be merged (live collaboration): names the next rebase message. */
let remoteHint: string | null = null;
export function setRemoteHint(author: string | null): void { remoteHint = author; }

/**
 * Another window saved first: replay our operations that the server does not have
 * on top of the saved version (operation-log rebase). Nothing is lost: operations
 * that no longer apply stay in the scenario and are reported as not applicable.
 * `abortIf` is checked once the server copy has arrived (e.g. the user edited meanwhile).
 */
async function rebaseOnServer(pid: string, sid: string, localOps: readonly Operation[], opts: { remoteAuthor?: string; abortIf?: () => boolean } = {}): Promise<boolean> {
  const { baseline } = get();
  if (!baseline) return false;
  const server = await api.get<StoredScenario>(`/api/projects/${encodeURIComponent(pid)}/scenarios/${encodeURIComponent(sid)}`);
  if (opts.abortIf?.()) return false;
  const known = new Set(server.operations.map((o) => o.id));
  const mine = localOps.filter((o) => !known.has(o.id));
  const merged: StoredScenario = { ...server, operations: [...server.operations, ...mine] };
  const author = get().user?.name ?? 'Utente locale';
  const history = new ScenarioHistory(baseline, merged, author, () => newId('op'));
  set({ scenario: { ...merged, revision: server.revision }, history, saveStatus: mine.length ? 'dirty' : 'saved' });
  syncFromHistory();
  const who = opts.remoteAuthor ?? remoteHint;
  remoteHint = null;
  const body = mine.length ? `Le tue ${mine.length} modifiche sono state riapplicate sopra la versione salvata.` : 'Caricata la versione salvata.';
  if (who) (mine.length ? toast.warn : toast.info)(`Aggiornato da ${who}`, body);
  else toast.warn('Scenario aggiornato da un’altra finestra', body);
  if (mine.length) scheduleSave(100);
  return true;
}

let pulling: Promise<unknown> | null = null;
/**
 * Live collaboration: someone else saved `sid` at `revision`. With nothing unsaved here the server copy
 * is loaded through the same rebase path (no local operations to replay); with unsaved work the
 * caller waits: the next save gets a 409 and rebases on its own.
 */
export async function pullRemote(sid: string, revision: number, author: string): Promise<'pulled' | 'pending' | 'ignored'> {
  if (pulling) await pulling.catch(() => undefined);
  const { project, scenario } = get();
  if (!project || !scenario || scenario.id !== sid || scenario.isBaseline || revision <= scenario.revision) return 'ignored';
  const busy = () => get().saveStatus !== 'saved' || saving !== null;
  if (busy()) return 'pending';
  const pid = project.id;
  const run = rebaseOnServer(pid, sid, [], { remoteAuthor: author, abortIf: () => busy() || get().project?.id !== pid || get().scenario?.id !== sid });
  pulling = run;
  try {
    return (await run) ? 'pulled' : 'pending';
  } catch {
    return 'pending';
  } finally {
    if (pulling === run) pulling = null;
  }
}

export async function flushSave(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (get().saveStatus === 'dirty' || get().saveStatus === 'offline') await save();
  else if (saving) await saving;
}

window.addEventListener('beforeunload', (e) => {
  if (['dirty', 'saving', 'offline', 'error'].includes(get().saveStatus)) e.preventDefault();
});

// ---------------------------------------------------------------- UI state helpers

export const setMode = (mode: Mode) => set({ mode, tool: 'select', dock: null });
export const setTool = (tool: string) => set({ tool });
export const select = (selection: Selection | null) => set({ selection });
export const setDock = (dock: string | null) => set((s) => ({ dock: s.dock === dock ? null : dock }));
/** Opens a panel without toggling (programmatic callers: Elios, links). */
export const openDock = (dock: string) => set({ dock });

// Development-only handle for automated UI verification (stripped from production builds).
if (import.meta.env.DEV) (window as unknown as { __drip: unknown }).__drip = { useApp, commit, undo, redo };

/** Large projects: moves the work area (e.g. to the visible map) and reloads the city around it. */
export async function moveWorkArea(bbox: readonly [number, number, number, number]): Promise<void> {
  const project = get().project;
  if (!project?.large) return;
  await flushSave();
  await api.patch(`/api/projects/${encodeURIComponent(project.id)}`, { workArea: bbox });
  set({ project: null });
  await openProject(project.id);
}
