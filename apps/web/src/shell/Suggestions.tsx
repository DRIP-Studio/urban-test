import { useEffect, useState } from 'react';
import { installSuggestions, dismissSuggestion, useSuggest } from '../state/suggestions';
import { useApp } from '../state/store';
import { flyTo } from '../map/mapStore';
import { Icon } from '../ui/Icon';
import { toast } from '../state/toasts';

/**
 * Next-step suggestions after an edit (bottom right of the map), each with norm and one-click action.
 * Advisory only: one card open at a time, the others on one line, the whole panel can be folded so it
 * never hides the drawing. Opening a card frames its place on the map.
 */
/** An action never fails silently: an unexpected error is reported and the card stays. */
function runAction(a: { label: string; run: () => void }): void {
  try { a.run(); } catch (e) {
    console.error('[suggestion]', a.label, e);
    toast.error(`«${a.label}» non applicato`, e instanceof Error ? e.message : String(e));
  }
}

export function Suggestions() {
  useEffect(() => installSuggestions(), []);
  const items = useSuggest((s) => s.items);
  const mode = useApp((s) => s.mode);
  const [open, setOpen] = useState<string | null>(null);
  const folded = useSuggest((s) => s.folded);
  const setFolded = (f: boolean | ((v: boolean) => boolean)) => useSuggest.setState((s) => ({ folded: typeof f === 'function' ? f(s.folded) : f }));
  // A new batch of suggestions opens its first card and unfolds the panel.
  const first = items[0]?.key ?? null;
  useEffect(() => { setOpen(first); if (first) setFolded(false); }, [first]);
  if (!items.length || mode !== 'design') return null;
  const current = items.some((s) => s.key === open) ? open : first;
  return (
    <aside className={`suggest${folded ? ' is-folded' : ''}`} aria-label="Prossimi passi">
      <button type="button" className="suggest-head" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
        <Icon name="sparkle" size={14} /><span>Prossimi passi</span><span className="count">{items.length}</span>
        <Icon name={folded ? 'chevronUp' : 'chevronDown'} size={12} />
      </button>
      {folded ? null : items.map((s) => {
        const isOpen = s.key === current;
        return (
          <article key={s.key} className={`suggest-card${isOpen ? ' is-open' : ''}`}>
            <div className="suggest-title">
              <button type="button" className="suggest-toggle" aria-expanded={isOpen} onClick={() => { setOpen(s.key); if (s.at) flyTo([s.at[0], s.at[1]]); }}>
                <Icon name={s.icon} size={15} /><strong>{s.title}</strong>
              </button>
              <button type="button" className="suggest-x" aria-label={`Ignora: ${s.title}`} onClick={() => dismissSuggestion(s.key)}><Icon name="close" size={12} /></button>
            </div>
            {isOpen ? (
              <>
                <p>{s.detail}</p>
                {s.ref ? <span className="suggest-ref"><Icon name="law" size={11} />{s.ref}</span> : null}
                <div className="suggest-actions">
                  {s.actions.filter((a) => a.label !== 'Ignora').map((a) => <button key={a.label} type="button" className={`btn btn-sm ${a.primary ? 'btn-primary' : 'btn-ghost'}`} onClick={() => runAction(a)}>{a.label}</button>)}
                </div>
              </>
            ) : null}
          </article>
        );
      })}
    </aside>
  );
}
