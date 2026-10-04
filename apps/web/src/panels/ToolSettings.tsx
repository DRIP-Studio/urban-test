import { gltfDims } from '../models/gltf';
import { loadModels, useModels } from '../models/models';
import { api } from '../api/client';
import { toast } from '../state/toasts';
import { PavingLibrary } from './PavingLibrary';
import { useMemo, useRef, useState } from 'react';
import { ROAD_TEMPLATES, type AreaKind, type ZoneKind } from '@drip-urban/core';
import { commit, select, useApp } from '../state/store';
import { useTool } from '../tools/toolState';
import { toolById } from '../tools/registry';
import { Button, Empty, Field, NumberField, Section, Select, TextField, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { RoundaboutPlacePanel } from './RoundaboutPanel';
import { ProjectSummary } from './ProjectSummary';
import { CalmingPalette, MarkingPalette } from './StreetscapePanels';

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

/** Project 3D models (glTF/GLB from SketchUp, Blender, Revit…): upload, place like furniture, shown in the Twin. */
function ModelLibrary() {
  const project = useApp((s) => s.project);
  const list = useModels((s) => s.list);
  const current = useTool((s) => s.furnitureId);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const modelClear = useTool((s) => s.modelClear);
  const baseline = useApp((s) => s.baseline);
  const removed = Object.keys(useApp((s) => s.network?.removedBuildings) ?? {});
  if (!project) return null;
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const dims = gltfDims(buf);
      const fd = new FormData();
      fd.append('file', f); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      fd.append('w', String(Math.max(0.05, dims.w))); fd.append('d', String(Math.max(0.05, dims.d))); fd.append('h', String(Math.max(0.05, dims.h))); fd.append('scale', String(scale));
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/models`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Errore ${res.status}`);
      const rec = await res.json() as { id: string; name: string };
      await loadModels();
      useTool.setState({ furnitureId: `model:${rec.id}` });
      toast.success('Modello importato', `${rec.name}: ${(dims.w * scale).toFixed(1)} × ${(dims.d * scale).toFixed(1)} m, h ${(dims.h * scale).toFixed(1)} m · clic sulla mappa per posarlo`);
    } catch (e) { toast.error('Modello 3D', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Modelli 3D del progetto" count={list.length}>
      <input ref={file} type="file" accept=".glb,.gltf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <div className="provider-row">
        <Button icon="model3d" busy={busy} onClick={() => file.current?.click()}>Importa modello (.glb, .gltf)</Button>
        <Select value={String(scale)} ariaLabel="Unità del modello" onChange={(v) => setScale(Number(v))} options={[{ value: '1', label: 'metri' }, { value: '0.01', label: 'centimetri' }, { value: '0.001', label: 'millimetri' }, { value: '0.0254', label: 'pollici (SketchUp)' }]} />
      </div>
      {list.map((m) => (
        <div key={m.id} className={`lib-row ${current === `model:${m.id}` ? 'is-on' : ''}`} role="button" tabIndex={0} onClick={() => useTool.setState({ furnitureId: `model:${m.id}` })}>
          <Icon name="model3d" size={15} /><span>{m.name}</span><span className="hint">{(m.dims.w * m.scale).toFixed(1)}×{(m.dims.d * m.scale).toFixed(1)} m · {(m.sizeBytes / 1048576).toFixed(1)} MB</span>
          <button type="button" className="link" onClick={(e) => { e.stopPropagation(); void api.del(`/api/projects/${encodeURIComponent(project.id)}/models/${m.id}`).then(loadModels); }}>elimina</button>
        </div>
      ))}
      <Toggle label="Libera l'area: demolisci gli edifici e rimuovi gli arredi sotto il modello" checked={modelClear} onChange={(v) => useTool.setState({ modelClear: v })} />
      <p className="muted">Da SketchUp: esporta in glTF/GLB (estensione o SketchUp 2024+). I modelli si posano come l'arredo (Q/E o Maiusc+rotella per ruotare), compaiono in pianta con il loro ingombro e nel Twin 3D con la loro geometria. Un edificio esistente si demolisce anche selezionandolo sulla mappa.</p>
      {removed.length ? (
        <div className="lib-group">
          <div className="lib-group-title">Edifici demoliti nello scenario ({removed.length})</div>
          {removed.slice(0, 30).map((id) => (
            <div key={id} className="lib-row" role="button" tabIndex={0} onClick={() => select({ kind: 'building', ids: [id] })}>
              <Icon name="trash" size={14} /><span>{baseline?.buildings[id]?.name || `Edificio ${id.replace(/^\D+/, '')}`}</span><span className="hint">h {baseline?.buildings[id]?.heightM.toFixed(0) ?? '?'} m</span>
              <button type="button" className="link" onClick={(e) => { e.stopPropagation(); commit('building.remove', { buildingIds: [id], restore: true }); }}>ripristina</button>
            </div>
          ))}
          <Button size="sm" icon="undo" onClick={() => commit('building.remove', { buildingIds: removed, restore: true })}>Ripristina tutti</Button>
        </div>
      ) : null}
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
  const { signId, recentSigns, favoriteSigns, signStack } = useTool();
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
      <Toggle checked={signStack} label="Clic su un cartello: aggiungi sotto, sullo stesso palo" onChange={(v) => useTool.setState({ signStack: v })} />
      <p className="muted">Con Alt il comportamento si inverte. L'ordine dei pannelli si cambia dall'Inspector del cartello.</p>
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
        <ModelLibrary />
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
    case 'marking': return <MarkingPalette />;
    case 'calming': return <CalmingPalette />;
    case 'paving': return <PavingLibrary />;
    case 'select': return <ProjectSummary />;
    default: return (
      <Section title={def.label}>
        <div className="tool-help"><Icon name={def.icon} size={22} /><p>{def.hint}</p></div>
      </Section>
    );
  }
}
