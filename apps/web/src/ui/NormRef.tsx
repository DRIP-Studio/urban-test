import { normById } from '@drip-urban/core';
import { openNorm } from '../state/norms';
import './norms.css';

/**
 * Inline citation of a norm of the library, e.g. «DM 5/11/2001 cap. 3». The tooltip shows the full
 * title; a click opens the reference in the «Normativa e verifiche» sheet.
 */
export function NormRef({ id, article, label }: { id: string; article?: string; label?: string }) {
  const n = normById(id);
  const text = label ?? (n ? `${n.short}${article ? ` ${article}` : ''}` : article ?? id);
  const art = article ? n?.articles.find((a) => a.ref === article) : undefined;
  const tip = n ? `${n.title}${art ? ` — ${art.ref}: ${art.summary}` : ''}` : text;
  return (
    <button type="button" className="norm-ref" title={tip} onClick={(e) => { e.stopPropagation(); openNorm(id); }}>{text}</button>
  );
}
