import { useEffect, useRef, useState } from 'react';
import type { ProjectMaterial } from '@drip-urban/core';
import { api } from '../api/client';
import { commit, newId, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { materialCanvas, useMaterialUi } from '../models/materials';
import { Button, Field, NumberField, Section, Select, TextField, Toggle } from '../ui/controls';

export function MaterialEditor() {
  const catalogs = useApp((s) => s.catalogs), project = useApp((s) => s.project), selection = useApp((s) => s.selection), network = useApp((s) => s.network);
  const [draft, setDraft] = useState<ProjectMaterial>(() => ({ ...(catalogs!.materials.items.find(m => m.id === useMaterialUi.getState().selectedId) ?? catalogs!.materials.items[0]!), id: `custom.${newId('mat')}`, label: 'Materiale progetto', brightness: 1, contrast: 1, metallic: 0 }));
  const [busy, setBusy] = useState(false), preview = useRef<HTMLCanvasElement>(null);
  const patch = (value: Partial<ProjectMaterial>) => setDraft((m) => ({ ...m, ...value }));
  useEffect(() => { let alive = true; materialCanvas(draft).then((canvas) => { if (!alive || !preview.current) return; const g = preview.current.getContext('2d')!; g.clearRect(0, 0, 320, 200); g.fillStyle = g.createPattern(canvas, 'repeat')!; g.fillRect(0, 0, 320, 200); }).catch((error) => toast.error('Texture', String(error))); return () => { alive = false; }; }, [draft]);
  const save = (apply: boolean) => {
    const ops: { type: string; payload: unknown }[] = [{ type: 'material.set', payload: { material: draft } }];
    if (apply && selection && network) for (const id of selection.ids) {
      if (selection.kind === 'road' && network.roads[id]) { const road=network.roads[id]!;ops.push({type:'road.setSection',payload:{roadId:id,lanes:road.lanes,section:{...road.section,elements:road.section.elements.map((element)=>({...element,material:draft.id}))}}}); }
      if (selection.kind === 'asset' && network.assets[id]) ops.push({ type: 'asset.update', payload: { assetId: id, changes: { material: draft.id } } });
      if (selection.kind === 'building') ops.push({ type: 'building.style', payload: { buildingId: id, style: { ...network.buildingStyles?.[id], facadeMaterial: draft.id } } });
      if (selection.kind === 'area' && network.areas[id]) ops.push({ type: 'area.set', payload: { area: { ...network.areas[id], material: draft.id } } });
    }
    commit('batch', { label: 'Materiale progetto', ops });
  };
  const upload = async (file: File, normal = false) => {
    if (!project) return; const initial=useApp.getState(),revision=JSON.stringify(initial.scenario?.operations);setBusy(true);
    try { const form = new FormData(); form.append('file', file); const result = await api.post<{ id: string }>(`/api/projects/${project.id}/textures`, form);const current=useApp.getState();if(current.project?.id!==project.id||current.scenario?.id!==initial.scenario?.id||JSON.stringify(current.scenario?.operations)!==revision)throw Error('Scenario cambiato durante import: texture conservata nel progetto originale');patch(normal ? { normalMap: result.id } : { texture: result.id, color: '#ffffff', crop: [0, 0, 1, 1] }); }
    catch (error) { toast.error('Import texture', String(error)); } finally { setBusy(false); }
  };
  const numeric = (key: 'scaleM' | 'opacity' | 'roughness' | 'metallic' | 'rotationDeg' | 'brightness' | 'contrast' | 'bump' | 'emissive', label: string, min: number, max: number, fallback: number) => <Field label={label}><NumberField value={draft[key] ?? fallback} min={min} max={max} step={.05} decimals={2} ariaLabel={`Materiale ${key}`} onCommit={(value) => patch({ [key]: value })} /></Field>;
  return <>
    <Section title="Materiali del progetto">
      <Select value={draft.id} ariaLabel="Materiale da modificare" options={catalogs!.materials.items.map((m) => ({ value: m.id, label: m.label }))} onChange={(id) => { const m = catalogs!.materials.items.find((m) => m.id === id)!; setDraft({ ...m, id: id.startsWith('custom.') ? id : `custom.${newId('mat')}`, label: id.startsWith('custom.') ? m.label : `${m.label} · progetto` }); }} />
      <Field label="Nome"><TextField value={draft.label} ariaLabel="Nome materiale" onCommit={(label) => patch({ label })} /></Field>
      <canvas ref={preview} width={320} height={200} style={{ width: '100%', height: 180, borderRadius: 6 }} aria-label="Anteprima materiale" />
      <Field label="Colore / tinta"><input type="color" value={draft.color} aria-label="Colore materiale" onChange={(e) => patch({ color: e.target.value })} /></Field>
      <Field label="Texture immagine"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label="Importa texture" onChange={(e) => { if (e.target.files?.[0]) void upload(e.target.files[0]); }} /></Field>
      {draft.texture ? <Button size="sm" onClick={() => patch({ texture: undefined })}>Rimuovi immagine</Button> : null}
      <Field label="Normal map"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label="Importa normal map" onChange={(e) => { if (e.target.files?.[0]) void upload(e.target.files[0], true); }} /></Field>
      <div className="grid-2">{numeric('scaleM', 'Ripetizione · m', .01, 1000, 1)}{numeric('rotationDeg', 'Rotazione · °', -360, 360, 0)}{numeric('opacity', 'Opacità', 0, 1, 1)}{numeric('roughness', 'Rugosità', 0, 1, .8)}{numeric('metallic', 'Metallicità', 0, 1, 0)}{numeric('brightness', 'Luminosità', 0, 3, 1)}{numeric('contrast', 'Contrasto', 0, 3, 1)}{numeric('bump', 'Rilievo', 0, 10, 0)}{numeric('emissive', 'Emissione', 0, 10, 0)}
        {[0, 1].map((axis) => <Field key={axis} label={`Offset ${axis ? 'Y' : 'X'} · m`}><NumberField value={draft.offset?.[axis] ?? 0} decimals={2} ariaLabel={`Offset texture ${axis}`} onCommit={(value) => { const offset: [number, number] = [...(draft.offset ?? [0, 0])]; offset[axis] = value; patch({ offset }); }} /></Field>)}
        {draft.texture ? [0, 1, 2, 3].map((index) => <Field key={index} label={`Ritaglio ${['X', 'Y', 'larghezza', 'altezza'][index]} · 0–1`}><NumberField value={draft.crop?.[index] ?? (index > 1 ? 1 : 0)} min={index > 1 ? .01 : 0} max={1} decimals={2} ariaLabel={`Ritaglio texture ${index}`} onCommit={(value) => { const crop: [number, number, number, number] = [...(draft.crop ?? [0, 0, 1, 1])]; crop[index] = value; patch({ crop }); }} /></Field>) : null}
      </div>
      <Toggle label="Permeabile" checked={draft.permeable} onChange={(permeable) => patch({ permeable })} />
      <div className="row"><Button icon="save" disabled={busy} onClick={() => save(false)}>Salva materiale</Button><Button variant="primary" disabled={busy || !selection || !['asset', 'area', 'building', 'road'].includes(selection.kind)} onClick={() => save(true)}>Applica alla selezione</Button></div>
      <p className="muted">Materiali salvati nello scenario, immagini nel pacchetto del progetto. Ogni applicazione è annullabile.</p>
    </Section>
  </>;
}
