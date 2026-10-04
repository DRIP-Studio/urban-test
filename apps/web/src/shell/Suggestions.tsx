import { useEffect } from 'react';
import { installSuggestions, dismissSuggestion, useSuggest } from '../state/suggestions';
import { useApp } from '../state/store';
import { Icon } from '../ui/Icon';

/** Next-step suggestions after an edit (top right of the map), each with norm and one-click action. */
export function Suggestions() {
  useEffect(() => installSuggestions(), []);
  const items = useSuggest((s) => s.items);
  const mode = useApp((s) => s.mode);
  if (!items.length || mode !== 'design') return null;
  return (
    <aside className="suggest" aria-label="Suggerimenti">
      <header className="suggest-head"><Icon name="sparkle" size={14} /><span>Prossimi passi</span><span className="count">{items.length}</span></header>
      {items.map((s) => (
        <article key={s.key} className="suggest-card">
          <div className="suggest-title"><Icon name={s.icon} size={15} /><strong>{s.title}</strong>
            <button type="button" className="suggest-x" aria-label="Ignora suggerimento" onClick={() => dismissSuggestion(s.key)}><Icon name="close" size={12} /></button>
          </div>
          <p>{s.detail}</p>
          {s.ref ? <span className="suggest-ref"><Icon name="law" size={11} />{s.ref}</span> : null}
          <div className="suggest-actions">
            {s.actions.filter((a) => a.label !== 'Ignora').map((a) => <button key={a.label} type="button" className={`btn btn-sm ${a.primary ? 'btn-primary' : 'btn-ghost'}`} onClick={a.run}>{a.label}</button>)}
          </div>
        </article>
      ))}
    </aside>
  );
}
