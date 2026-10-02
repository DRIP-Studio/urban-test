import { useMemo } from 'react';
import type { MaterialItem } from '../api/types';
import { patternImage } from '../map/patterns';
import { useApp } from '../state/store';
import { useTool } from '../tools/toolState';
import { Section } from '../ui/controls';

const SWATCH = new Map<string, string>();
/** Real texture preview at street zoom (cached data URL). */
function swatch(m: MaterialItem): string {
  const hit = SWATCH.get(m.id);
  if (hit) return hit;
  const img = patternImage(m, 23); // closer than street zoom so the joints read in a 55 px swatch
  let url = '';
  if (img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    url = c.toDataURL();
  }
  SWATCH.set(m.id, url);
  return url;
}

const GROUPS: [string, string][] = [['stone', 'Pietre'], ['paving', 'Pavimentazioni pedonali'], ['road', 'Pavimentazioni stradali'], ['nature', 'Naturali']];

export function PavingLibrary() {
  const items = useApp((s) => s.catalogs?.materials.items ?? []);
  const current = useTool((s) => s.pavingMaterial);
  const groups = useMemo(() => GROUPS.map(([cat, label]) => [label, items.filter((m) => m.category === cat && !m.id.startsWith('foliage') && m.id !== 'bark' && m.id !== 'water')] as const), [items]);
  return (
    <>
      {groups.map(([label, list]) => (
        <Section key={label} title={label} count={list.length}>
          <div className="paving-grid">
            {list.map((m) => (
              <button key={m.id} type="button" className={`paving-swatch ${current === m.id ? 'is-on' : ''}`} onClick={() => useTool.setState({ pavingMaterial: m.id })} aria-pressed={current === m.id}>
                <span className="paving-img" style={{ backgroundColor: m.color, backgroundImage: swatch(m) ? `url(${swatch(m)})` : undefined }} />
                <span className="paving-label">{m.label}</span>
                {m.permeable ? <span className="paving-tag">drenante</span> : null}
              </button>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}
