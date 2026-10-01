import { useState } from 'react';
import { api } from '../api/client';
import type { ScenarioSummary } from '../api/types';
import { navigate, refreshProject, selectScenario, setDock, setMode, undo, redo, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/controls';
import { MenuItem, Popover } from '../ui/Popover';
import { confirmAction } from '../ui/confirm';
import { TechnicalLockup } from './Brand';
import { MODES } from './commands';
import { usePalette } from './palette';

const SAVE_LABEL: Record<string, string> = { saved: 'Salvato', dirty: 'Modifiche in corso', saving: 'Salvataggio…', offline: 'Offline · in coda', error: 'Errore di salvataggio', conflict: 'Conflitto' };

function ScenarioMenu() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!project || !scenario) return null;
  const pid = encodeURIComponent(project.id);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await refreshProject(); toast.success(ok); } catch (e) { toast.error('Scenario', e instanceof Error ? e.message : String(e)); }
  };
  const create = (copyFrom?: string) => act(async () => {
    const s = await api.post<ScenarioSummary>(`/api/projects/${pid}/scenarios`, { name: copyFrom ? `${scenario.name} (copia)` : `Scenario ${String.fromCharCode(64 + project.scenarios.filter((x) => !x.isBaseline).length + 1)}`, copyFrom });
    await refreshProject();
    await selectScenario(s.id);
  }, copyFrom ? 'Scenario duplicato' : 'Scenario creato');
  return (
    <Popover width={320} trigger={(open, toggle) => (
      <button type="button" className={`scenario-trigger ${open ? 'is-open' : ''}`} onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <span className="scn-label">{scenario.isBaseline ? 'Stato attuale' : 'Scenario'}</span>
        <span className="scn-name">{scenario.name}{scenario.locked && !scenario.isBaseline ? <Icon name="lock" size={12} /> : null}</span>
        <Icon name="chevronDown" size={14} />
      </button>
    )}>
      {(close) => (
        <div className="scenario-menu">
          <div className="menu-title">Scenari di {project.name}</div>
          {project.scenarios.filter((s) => !s.archived).map((s) => (
            <div key={s.id} className={`scn-row ${s.id === scenario.id ? 'is-current' : ''}`}>
              {renaming === s.id ? (
                <input autoFocus defaultValue={s.name} className="text-field" aria-label="Nome scenario"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value; setRenaming(null); void act(() => api.patch(`/api/projects/${pid}/scenarios/${s.id}`, { name: v }), 'Scenario rinominato'); }
                    if (e.key === 'Escape') setRenaming(null);
                  }} onBlur={() => setRenaming(null)} />
              ) : (
                <button type="button" className="scn-pick" onClick={() => { close(); void selectScenario(s.id); }}>
                  <span>{s.name}</span><span className="hint">{s.isBaseline ? 'baseline' : `${s.opCount} modifiche`}</span>
                </button>
              )}
              {!s.isBaseline ? (
                <span className="scn-actions">
                  <IconButton icon="doc" label="Rinomina" size={14} onClick={() => setRenaming(s.id)} />
                  <IconButton icon={s.locked ? 'unlock' : 'lock'} label={s.locked ? 'Sblocca' : 'Blocca'} size={14} onClick={() => void act(() => api.patch(`/api/projects/${pid}/scenarios/${s.id}`, { locked: !s.locked }), s.locked ? 'Scenario sbloccato' : 'Scenario bloccato')} />
                  <IconButton icon="folder" label="Archivia" size={14} onClick={() => void act(() => api.patch(`/api/projects/${pid}/scenarios/${s.id}`, { archived: true }), 'Scenario archiviato')} />
                  <IconButton icon="trash" label="Elimina (con versione di sicurezza)" size={14} tone="danger" onClick={() => {
                    void confirmAction('Eliminare lo scenario?', `"${s.name}" verrà eliminato. Prima viene salvata automaticamente una versione di sicurezza del progetto, ripristinabile da Cronologia.`, { confirmLabel: 'Elimina', danger: true })
                      .then((yes) => { if (yes) void act(async () => { await api.del(`/api/projects/${pid}/scenarios/${s.id}`); if (s.id === scenario.id) await selectScenario('baseline'); }, 'Scenario eliminato'); });
                  }} />
                </span>
              ) : null}
            </div>
          ))}
          <div className="menu-sep" />
          <MenuItem icon={<Icon name="plus" size={15} />} label="Nuovo scenario vuoto" onClick={() => { close(); void create(); }} />
          <MenuItem icon={<Icon name="duplicate" size={15} />} label="Duplica scenario corrente" disabled={scenario.isBaseline} onClick={() => { close(); void create(scenario.id); }} />
          <MenuItem icon={<Icon name="chart" size={15} />} label="Confronta scenari" onClick={() => { close(); setMode('analyze'); setDock('compare'); }} />
        </div>
      )}
    </Popover>
  );
}

export function TopBar() {
  const project = useApp((s) => s.project);
  const mode = useApp((s) => s.mode);
  const save = useApp((s) => s.saveStatus);
  const canUndo = useApp((s) => s.canUndo), canRedo = useApp((s) => s.canRedo);
  const undoLabel = useApp((s) => s.undoLabel), redoLabel = useApp((s) => s.redoLabel);
  const lastSaved = useApp((s) => s.lastSavedAt);
  return (
    <header className="topbar">
      <button type="button" className="brand-btn" onClick={() => navigate({ view: 'hub' })} aria-label="Project Hub">
        <TechnicalLockup city={project?.city ?? null} />
      </button>
      <div className="topbar-project">
        <span className="project-name" title={project?.name}>{project?.name}</span>
        <ScenarioMenu />
      </div>
      <nav className="modes" aria-label="Modalità">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={`mode ${mode === m.id ? 'is-on' : ''}`} onClick={() => setMode(m.id)} aria-current={mode === m.id ? 'page' : undefined} data-tip={`${m.label} · Alt+${m.key}`}>{m.label}</button>
        ))}
      </nav>
      <div className="topbar-actions">
        <button type="button" className="search-btn" onClick={() => usePalette.getState().toggle()} aria-label="Comandi e ricerca">
          <Icon name="search" size={15} /><span>Cerca comandi, luoghi, strade</span><kbd className="kbd">Ctrl K</kbd>
        </button>
        <IconButton icon="undo" label={undoLabel ? `Annulla: ${undoLabel}` : 'Annulla'} shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo} />
        <IconButton icon="redo" label={redoLabel ? `Ripristina: ${redoLabel}` : 'Ripristina'} shortcut="Ctrl+Y" onClick={redo} disabled={!canRedo} />
        <span className={`save-status save-${save}`} role="status" title={lastSaved ? `Ultimo salvataggio ${new Date(lastSaved).toLocaleTimeString('it-IT')}` : undefined}>
          <span className="dot" />{SAVE_LABEL[save]}
        </span>
        <IconButton icon="layers" label="Livelli" shortcut="Ctrl+L" onClick={() => setDock('layers')} />
        <IconButton icon="clock" label="Cronologia e versioni" onClick={() => setDock('history')} />
        <IconButton icon="export" label="Esporta" shortcut="Ctrl+E" onClick={() => setDock('export')} />
        <IconButton icon="settings" label="Impostazioni" onClick={() => setDock('settings')} />
      </div>
    </header>
  );
}
