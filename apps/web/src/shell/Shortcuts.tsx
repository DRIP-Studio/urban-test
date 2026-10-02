import { useEffect } from 'react';
import { useApp } from '../state/store';
import { TOOLS } from '../tools/registry';
import { COMMANDS } from './commands';
import { useShortcuts } from './shortcutsState';

/** Keys that only exist inside a tool (they are handled by the tool, not by the command registry). */
const IN_TOOL: { tool: string; keys: [string, string][] }[] = [
  { tool: 'Strada', keys: [['Clic', 'vertice'], ['Clic e trascina', 'curva con maniglie'], ['Shift', 'angoli a 15°'], ['Alt', 'senza snap'], ['Backspace', 'togli l\'ultimo punto'], ['Invio · doppio clic', 'crea'], ['Esc', 'annulla il disegno']] },
  { tool: 'Rotatoria', keys: [['[  ]', 'diametro −/+ 2 m'], ['Invio', 'crea'], ['Esc', 'riposiziona']] },
  { tool: 'Cartelli · Arredo', keys: [['Q  E', 'ruota di 15°'], ['Shift + rotella', 'ruota fine'], ['Alt + clic su un cartello', 'altro pannello sullo stesso palo']] },
  { tool: 'Selezione', keys: [['Frecce', 'sposta di 10 cm'], ['Shift + frecce', 'sposta di 1 m'], ['Shift + clic', 'aggiungi alla selezione'], ['Shift + trascina', 'selezione a riquadro']] },
];

const keysOf = (s: string) => s.split('+').map((k) => k.trim());

function Keys({ combo }: { combo: string }) {
  return <span className="sc-keys">{keysOf(combo).map((k, i) => <kbd key={i} className="kbd">{k}</kbd>)}</span>;
}

export function ShortcutsSheet() {
  const open = useShortcuts((s) => s.open);
  const mode = useApp((s) => s.mode);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); useShortcuts.getState().close(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [open]);
  if (!open) return null;
  const groups = new Map<string, { label: string; shortcut: string }[]>();
  for (const c of COMMANDS) {
    if (!c.shortcut || c.id.startsWith('tool.')) continue;
    (groups.get(c.group) ?? groups.set(c.group, []).get(c.group)!).push({ label: c.label, shortcut: c.shortcut });
  }
  const tools = TOOLS.filter((t) => t.shortcut && t.modes.includes(mode));
  return (
    <div className="modal-backdrop" onMouseDown={() => useShortcuts.getState().close()}>
      <div className="modal shortcuts" role="dialog" aria-modal="true" aria-label="Scorciatoie da tastiera" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sc-head"><h2>Scorciatoie</h2><span className="muted">Premi <kbd className="kbd">?</kbd> in qualsiasi momento</span></header>
        <div className="sc-grid">
          <section>
            <h3>Strumenti · {mode === 'design' ? 'Progetta' : 'modalità attiva'}</h3>
            <ul>{tools.map((t) => <li key={t.id}><span>{t.label}</span><Keys combo={t.shortcut!} /></li>)}</ul>
          </section>
          {[...groups].map(([g, items]) => (
            <section key={g}>
              <h3>{g}</h3>
              <ul>{items.map((i) => <li key={i.label}><span>{i.label}</span><Keys combo={i.shortcut} /></li>)}</ul>
            </section>
          ))}
          {IN_TOOL.map((t) => (
            <section key={t.tool}>
              <h3>{t.tool}</h3>
              <ul>{t.keys.map(([k, what]) => <li key={k}><span>{what}</span><span className="sc-keys"><kbd className="kbd">{k}</kbd></span></li>)}</ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
