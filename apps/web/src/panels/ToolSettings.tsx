import { PavingLibrary } from './PavingLibrary';
import { useMemo, useState } from 'react';
import { ROAD_TEMPLATES, type AreaKind, type ZoneKind } from '@drip-urban/core';
import { useApp } from '../state/store';
import { useTool } from '../tools/toolState';
import { toolById } from '../tools/registry';
import { Empty, Field, NumberField, Section, Select, TextField } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { RoundaboutPlacePanel } from './RoundaboutPanel';
import { ProjectSummary } from './ProjectSummary';

function RoadTemplates() {
  const t = useTool();
  return (
    <Section title="Tipo di strada">
      <div className="template-list" role="radiogroup" aria-label="Template stradale">
        {ROAD_TEMPLATES.map((tpl) => {
          const els = [...[...tpl.sides].reverse(), ...Array.from({ length: tpl.lanes }, () => ({ kind: tpl.pedestrian ? 'sidewalk' : 'lane', widthM: tpl.laneWidthM })), ...tpl.sides];
          const total = els.reduce((s, e) => s + e.widthM, 0) + (tpl.medianM ?? 0);
          return (
            <button key={tpl.id} type="button" role="radio" aria-checked={t.roadTemplate === tpl.id} className={`template ${t.roadTemplate === tpl.id ? 'is-on' : ''}`} onClick={() => useTool.setState({ roadTemplate: tpl.id })}>
              <span className="mini-section">{els.map((e, i) => <span key={i} className={`ms ms-${e.kind}`} style={{ flexGrow: e.widthM }} />)}</span>
              <span className="template-name">{tpl.label}</span>
              <span className="template-meta">{total.toFixed(1).replace('.', ',')} m · {tpl.lanes} {tpl.lanes === 1 ? 'corsia' : 'corsie'} · {tpl.speedKmh} km/h{tpl.oneway !== 'no' ? ' · senso unico' : ''}</span>
            </button>
          );
        })}
      </div>
      <Field label="Nome della nuova strada"><TextField value={t.roadName} placeholder="es. Via di progetto" ariaLabel="Nome" onCommit={(v) => useTool.setState({ roadName: v })} /></Field>
    </Section>
  );
}

function FurnitureLibrary({ target }: { target: 'furnitureId' | 'arrayItem' }) {
  const catalogs = useApp((s) => s.catalogs);
  const current = useTool((s) => s[target]);
  const [q, setQ] = useState('');
  if (!catalogs) return null;
  const cats = catalogs.furniture.categories;
  const items = catalogs.furniture.items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Section title="Libreria arredo e verde" count={catalogs.furniture.items.length}>
      <input className="text-field search" placeholder="Cerca (panchina, albero, pensilina…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca arredo" />
      {Object.entries(cats).map(([cid, clabel]) => {
        const list = items.filter((i) => i.category === cid);
        if (!list.length) return null;
        return (
          <div key={cid} className="lib-group">
            <div className="lib-group-title">{clabel}</div>
            {list.map((i) => (
              <button key={i.id} type="button" className={`lib-row ${current === i.id ? 'is-on' : ''}`} onClick={() => useTool.setState({ [target]: i.id } as never)}>
                <span className="lib-swatch" style={{ background: catalogs.materials.items.find((m) => m.id === i.material)?.color }} />
                <span>{i.label}</span><span className="hint">{i.dims.w}×{i.dims.d} m · h {i.dims.h} m</span>
              </button>
            ))}
          </div>
        );
      })}
    </Section>
  );
}

function SignLibrary() {
  const catalogs = useApp((s) => s.catalogs);
  const { signId, recentSigns, favoriteSigns } = useTool();
  const [q, setQ] = useState('');
  const [family, setFamily] = useState<string>('priority');
  const list = useMemo(() => {
    if (!catalogs) return [];
    const ql = q.trim().toLowerCase();
    if (ql) return catalogs.signs.items.filter((s) => s.label.toLowerCase().includes(ql));
    if (family === 'fav') return catalogs.signs.items.filter((s) => favoriteSigns.includes(s.id));
    if (family === 'recent') return recentSigns.map((id) => catalogs.signs.items.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
    return catalogs.signs.items.filter((s) => s.family === family);
  }, [catalogs, q, family, favoriteSigns, recentSigns]);
  if (!catalogs) return null;
  const toggleFav = (id: string) => useTool.setState((s) => ({ favoriteSigns: s.favoriteSigns.includes(id) ? s.favoriteSigns.filter((x) => x !== id) : [...s.favoriteSigns, id] }));
  return (
    <Section title="Segnaletica verticale (Codice della Strada)" count={catalogs.signs.items.length}>
      <input className="text-field search" placeholder="Cerca segnale (stop, divieto di sosta, zona 30…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca segnale" />
      {!q ? (
        <div className="chips">
          <button type="button" className={`chip ${family === 'recent' ? 'is-on' : ''}`} onClick={() => setFamily('recent')}>Recenti</button>
          <button type="button" className={`chip ${family === 'fav' ? 'is-on' : ''}`} onClick={() => setFamily('fav')}>Preferiti</button>
          {Object.entries(catalogs.signs.families).map(([id, l]) => <button key={id} type="button" className={`chip ${family === id ? 'is-on' : ''}`} onClick={() => setFamily(id)}>{l}</button>)}
        </div>
      ) : null}
      {list.length ? (
        <div className="sign-grid">
          {list.map((s) => (
            <button key={s.id} type="button" className={`sign-cell ${signId === s.id ? 'is-on' : ''}`} onClick={() => useTool.setState({ signId: s.id })} title={s.label}
              onContextMenu={(e) => { e.preventDefault(); toggleFav(s.id); }}>
              <img src={`/signs/${encodeURIComponent(s.file)}`} alt="" loading="lazy" />
              {favoriteSigns.includes(s.id) ? <span className="fav">★</span> : null}
            </button>
          ))}
        </div>
      ) : <Empty icon="sign" title={family === 'fav' ? 'Nessun preferito' : family === 'recent' ? 'Nessun segnale recente' : 'Nessun risultato'}>{family === 'fav' ? 'Clic destro su un segnale per aggiungerlo ai preferiti.' : null}</Empty>}
      <p className="muted">{catalogs.signs.items.find((s) => s.id === signId)?.label} · fonte: Wikimedia Commons, {catalogs.signs.license}</p>
    </Section>
  );
}

const AREA_OPTIONS: { value: AreaKind; label: string; material: string }[] = [
  { value: 'plaza', label: 'Piazza / pavimentazione', material: 'stone' }, { value: 'green', label: 'Verde', material: 'grass' }, { value: 'rain_garden', label: 'Giardino della pioggia', material: 'grass' },
  { value: 'bioswale', label: 'Bioswale', material: 'grass' }, { value: 'permeable', label: 'Pavimentazione drenante', material: 'permeable_pavers' }, { value: 'tree_pit', label: 'Aiuola alberata', material: 'soil' },
  { value: 'parking', label: 'Sosta', material: 'asphalt' }, { value: 'playground', label: 'Area gioco', material: 'rubber' }, { value: 'hatch', label: 'Zebratura', material: 'road_marking_white' },
];

export function ToolSettings() {
  const tool = useApp((s) => s.tool);
  const catalogs = useApp((s) => s.catalogs);
  const t = useTool();
  const def = toolById(tool);
  switch (tool) {
    case 'road': return <RoadTemplates />;
    case 'furniture': return (
      <>
        <Section title="Posizionamento"><Field label="Rotazione aggiuntiva"><NumberField value={t.rotationDeg} unit="°" step={15} decimals={0} ariaLabel="Rotazione" onCommit={(v) => useTool.setState({ rotationDeg: v })} /></Field></Section>
        <FurnitureLibrary target="furnitureId" />
      </>
    );
    case 'signs': return <SignLibrary />;
    case 'array': return (
      <>
        <Section title="Distribuzione"><Field label="Passo"><NumberField value={t.arraySpacingM} unit="m" min={1} max={100} step={1} ariaLabel="Passo" onCommit={(v) => useTool.setState({ arraySpacingM: v })} /></Field></Section>
        <FurnitureLibrary target="arrayItem" />
      </>
    );
    case 'area': return (
      <Section title="Superficie">
        <Field label="Tipo"><Select value={t.areaKind} ariaLabel="Tipo superficie" options={AREA_OPTIONS} onChange={(v) => useTool.setState({ areaKind: v, areaMaterial: AREA_OPTIONS.find((o) => o.value === v)!.material })} /></Field>
        {catalogs ? <Field label="Materiale"><Select value={t.areaMaterial} ariaLabel="Materiale" options={catalogs.materials.items.filter((m) => m.category !== 'object').map((m) => ({ value: m.id, label: m.label, hint: m.permeable ? 'drenante' : undefined }))} onChange={(v) => useTool.setState({ areaMaterial: v })} /></Field> : null}
      </Section>
    );
    case 'zone': return (
      <Section title="Zona">
        <Field label="Tipo"><Select<ZoneKind> value={t.zoneKind} ariaLabel="Tipo zona" onChange={(v) => useTool.setState({ zoneKind: v })}
          options={[{ value: 'ztl', label: 'ZTL' }, { value: 'pedestrian', label: 'Area pedonale' }, { value: 'school', label: 'Strada scolastica' }, { value: 'zone30', label: 'Zona 30' }, { value: 'low_emission', label: 'Basse emissioni' }, { value: 'parking', label: 'Zona sosta' }, { value: 'work', label: 'Cantiere / chiusura' }]} /></Field>
        <p className="muted">Dopo aver chiuso il perimetro imposti orari e veicoli ammessi nell'inspector.</p>
      </Section>
    );
    case 'roundabout': return <RoundaboutPlacePanel />;
    case 'paving': return <PavingLibrary />;
    case 'select': return <ProjectSummary />;
    default: return (
      <Section title={def.label}>
        <div className="tool-help"><Icon name={def.icon} size={22} /><p>{def.hint}</p></div>
      </Section>
    );
  }
}
