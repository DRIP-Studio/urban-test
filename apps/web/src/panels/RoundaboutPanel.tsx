import { useEffect, useMemo } from 'react';
import { planRoundabout, type Roundabout, type RoundaboutType } from '@drip-urban/core';
import { commit, useApp } from '../state/store';
import { createRoundabout, drawPreview, roundaboutFrom } from '../tools/roundabout';
import { deleteSelection } from '../state/actions';
import { useTool } from '../tools/toolState';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Toggle, FieldGroup } from '../ui/controls';
import { NormRef } from '../ui/NormRef';

const TYPES: { value: RoundaboutType; label: string; range: [number, number]; hint: string }[] = [
  { value: 'mini', label: 'Mini', range: [14, 25], hint: 'isola sormontabile' },
  { value: 'compact', label: 'Compatta', range: [25, 40], hint: 'isola non sormontabile' },
  { value: 'standard', label: 'Convenzionale', range: [40, 70], hint: '> 40 m' },
  { value: 'elliptical', label: 'Ellittica', range: [40, 70], hint: 'assi diversi' },
  { value: 'turbo', label: 'Turbo', range: [40, 70], hint: 'corsie separate' },
];

export function RoundaboutPlacePanel() {
  const rb = useTool((s) => s.rb);
  const net = useApp((s) => s.network);
  useEffect(() => { drawPreview(rb); }, [rb, net]);
  const plan = useMemo(() => (rb && net ? planRoundabout(net, roundaboutFrom(rb)) : null), [rb, net]);
  if (!rb || !plan) return <Empty icon="roundabout" title="Posiziona la rotatoria">Muovi il puntatore sulla mappa: l'anello segue il cursore e si aggancia agli incroci. Clic per fissarla.</Empty>;
  const set = (p: Partial<NonNullable<typeof rb>>) => useTool.setState({ rb: { ...rb, ...p } });
  const type = TYPES.find((t) => t.value === rb.type)!;
  return (
    <>
      <Section title="Nuova rotatoria">
        <p className="muted">
          {rb.nodeId ? "Sull'incrocio esistente" : 'Posizione libera'} · {plan.arms.length} {plan.arms.length === 1 ? 'braccio' : 'bracci'}
          {plan.removedRoadIds.length ? ` · ${plan.removedRoadIds.length} tratti interni sostituiti dall'anello` : ''}
          {plan.arms.length === 0 ? " · disegna poi le strade fino all'anello per collegarle" : ''}
        </p>
        {plan.overlaps.length ? <p className="warn-line">Si sovrappone a un'altra rotatoria: spostala o riduci il diametro.</p> : null}
        <Field label="Tipo (DM 19/04/2006)"><Select value={rb.type} ariaLabel="Tipo rotatoria" options={TYPES.map((t) => ({ value: t.value, label: t.label, hint: `${t.range[0]}–${t.range[1]} m · ${t.hint}` }))}
          onChange={(v) => { const t = TYPES.find((x) => x.value === v)!; set({ type: v, outerDiameterM: Math.min(t.range[1], Math.max(t.range[0], rb.outerDiameterM)), apronWidthM: v === 'mini' ? 1 : rb.apronWidthM }); }} /></Field>
        <div className="grid-2">
          <Field label="Diametro esterno"><NumberField value={rb.outerDiameterM} unit="m" min={type.range[0]} max={type.range[1]} step={1} ariaLabel="Diametro" onCommit={(v) => set({ outerDiameterM: v })} /></Field>
          <Field label="Larghezza anello"><NumberField value={rb.circulatoryWidthM} unit="m" min={6} max={12} step={0.25} ariaLabel="Larghezza anello" onCommit={(v) => set({ circulatoryWidthM: v })} /></Field>
          <Field label="Fascia sormontabile"><NumberField value={rb.apronWidthM} unit="m" min={0} max={3} step={0.25} ariaLabel="Fascia" onCommit={(v) => set({ apronWidthM: v })} /></Field>
          <FieldGroup label="Corsie anello"><Segmented<'1' | '2'> label="Corsie" value={String(rb.lanes) as '1' | '2'} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }]} onChange={(v) => set({ lanes: Number(v) as 1 | 2 })} /></FieldGroup>
        </div>
        {rb.type === 'elliptical' ? (
          <div className="grid-2">
            <Field label="Rapporto assi"><NumberField value={rb.aspect} min={0.5} max={1} step={0.05} ariaLabel="Rapporto assi" onCommit={(v) => set({ aspect: v })} /></Field>
            <Field label="Orientamento"><NumberField value={rb.orientationDeg} unit="°" min={-180} max={180} step={5} decimals={0} ariaLabel="Orientamento" onCommit={(v) => set({ orientationDeg: v })} /></Field>
          </div>
        ) : null}
        <Field label="Isola centrale"><Select value={rb.islandMaterial} ariaLabel="Isola" options={[{ value: 'grass', label: 'Verde' }, { value: 'porphyry', label: 'Porfido' }, { value: 'concrete', label: 'Calcestruzzo' }, { value: 'stone', label: 'Pietra' }]} onChange={(v) => set({ islandMaterial: v })} /></Field>
        <Toggle label="Isole spartitraffico sugli accessi" checked={rb.splitters} onChange={(v) => set({ splitters: v })} />
        <Toggle label="Attraversamenti pedonali sugli accessi" checked={rb.crossings} onChange={(v) => set({ crossings: v })} />
        <p className="muted">Nessuna segnaletica viene aggiunta in automatico oltre alla linea di dare precedenza richiesta dalla regolazione.</p>
      </Section>
      <div className="inspector-actions">
        <Button variant="ghost" onClick={() => set({ placed: false })}>{rb.placed ? 'Riposiziona' : 'Annulla'}</Button>
        <Button variant="project" icon="check" disabled={!rb.placed || plan.overlaps.length > 0} onClick={createRoundabout}>Crea rotatoria</Button>
      </div>
    </>
  );
}

export function RoundaboutInspector({ rb }: { rb: Roundabout }) {
  const net = useApp((s) => s.network)!;
  const update = (p: Partial<Roundabout>) => commit('roundabout.update', { roundabout: { ...rb, ...p } });
  const type = TYPES.find((t) => t.value === rb.type)!;
  return (
    <>
      <Section title={rb.name}>
        <Field label="Tipo"><Select value={rb.type} ariaLabel="Tipo" options={TYPES.map((t) => ({ value: t.value, label: t.label, hint: `${t.range[0]}–${t.range[1]} m` }))} onChange={(v) => { const t = TYPES.find((x) => x.value === v)!; update({ type: v, outerDiameterM: Math.min(t.range[1], Math.max(t.range[0], rb.outerDiameterM)) }); }} /></Field>
        <div className="grid-2">
          <Field label="Diametro esterno" prov="project"><NumberField value={rb.outerDiameterM} unit="m" min={type.range[0]} max={type.range[1]} ariaLabel="Diametro" onCommit={(v) => update({ outerDiameterM: v })} /></Field>
          <Field label="Larghezza anello"><NumberField value={rb.circulatoryWidthM} unit="m" min={6} max={12} step={0.25} ariaLabel="Anello" onCommit={(v) => update({ circulatoryWidthM: v })} /></Field>
          <Field label="Fascia sormontabile"><NumberField value={rb.apronWidthM} unit="m" min={0} max={3} step={0.25} ariaLabel="Fascia" onCommit={(v) => update({ apronWidthM: v })} /></Field>
          <Field label="Velocità anello"><NumberField value={rb.speedKmh} unit="km/h" min={10} max={50} step={5} decimals={0} ariaLabel="Velocità" onCommit={(v) => update({ speedKmh: v })} /></Field>
        </div>
        <FieldGroup label="Corsie anello"><Segmented<'1' | '2'> label="Corsie anello" value={String(rb.lanes) as '1' | '2'} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }]} onChange={(v) => update({ lanes: Number(v) as 1 | 2 })} /></FieldGroup>
        {rb.outerDiameterM > 2 * (6 + rb.apronWidthM) + 1 ? <Field label="Diametro isola centrale"><NumberField value={rb.outerDiameterM - 2 * (rb.circulatoryWidthM + rb.apronWidthM)} unit="m" min={Math.max(1, rb.outerDiameterM - 2 * (12 + rb.apronWidthM))} max={rb.outerDiameterM - 2 * (6 + rb.apronWidthM)} step={0.5} ariaLabel="Diametro isola centrale" onCommit={(v) => update({ circulatoryWidthM: (rb.outerDiameterM - v) / 2 - rb.apronWidthM })} /></Field> : null}
        <Field label="Materiale isola"><Select value={rb.islandMaterial} ariaLabel="Materiale isola" options={[{ value: 'grass', label: 'Verde' }, { value: 'porphyry', label: 'Porfido' }, { value: 'concrete', label: 'Calcestruzzo' }, { value: 'stone', label: 'Pietra' }]} onChange={(v) => update({ islandMaterial: v })} /></Field>
        {rb.type === 'elliptical' ? <div className="grid-2">
          <Field label="Rapporto assi"><NumberField value={rb.aspect} min={0.5} max={1} step={0.05} ariaLabel="Rapporto assi" onCommit={(v) => update({ aspect: v })} /></Field>
          <Field label="Orientamento"><NumberField value={rb.orientationDeg} unit="°" min={-180} max={180} step={5} ariaLabel="Orientamento" onCommit={(v) => update({ orientationDeg: v })} /></Field>
        </div> : null}
        <FieldGroup label="Regolazione"><Segmented<Roundabout['control']> label="Regolazione" value={rb.control} onChange={(v) => update({ control: v })}
          options={[{ value: 'yield', label: 'Precedenza' }, { value: 'signalized', label: 'Semaforica' }, { value: 'metered', label: 'A dosaggio' }, { value: 'part_time', label: 'Fasce orarie' }]} /></FieldGroup>
        {rb.control !== 'yield' ? <p className="warn-line">Servono piani semaforici applicati agli accessi. Senza un piano sull’accesso, DRIP Flow e segnaletica mantengono la precedenza all’anello. Dosaggio e fasce orarie richiedono una logica dedicata non ancora disponibile.</p> : null}
        <p className="muted">Diametri e corona giratoria: <NormRef id="dm-2006" article="Allegato, § 4.5" /> (mini 14–25 m, compatte 25–40 m, convenzionali 40–50 m).</p>
      </Section>
      <Section title="Bracci" count={rb.arms.length}>
        {rb.arms.map((a, i) => (
          <div key={a.roadId} className="arm-row">
            <strong>{net.roads[a.roadId]?.name || `Braccio ${i + 1}`}</strong>
            <Toggle label="Spartitraffico" checked={a.splitter} onChange={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, splitter: v } : x)) })} />
            <Toggle label="Attraversamento" checked={a.crossing} onChange={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, crossing: v } : x)) })} />
            <div className="grid-2">
              <Field label="Raggio d'entrata"><NumberField value={a.entryRadiusM} unit="m" min={4} max={40} ariaLabel="Raggio entrata" onCommit={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, entryRadiusM: v } : x)) })} /></Field>
              <Field label="Raggio d'uscita"><NumberField value={a.exitRadiusM} unit="m" min={4} max={40} ariaLabel="Raggio uscita" onCommit={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, exitRadiusM: v } : x)) })} /></Field>
              {a.splitter ? <Field label="Lunghezza isola"><NumberField value={a.splitterLengthM} unit="m" min={4} max={30} ariaLabel="Lunghezza isola" onCommit={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, splitterLengthM: v } : x)) })} /></Field> : null}
              {a.splitter ? <Field label="Larghezza isola"><NumberField value={a.splitterWidthM} unit="m" min={1.5} max={6} step={0.25} ariaLabel="Larghezza isola" onCommit={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, splitterWidthM: v } : x)) })} /></Field> : null}
            </div>
          </div>
        ))}
      </Section>
      <div className="inspector-actions"><Button icon="trash" variant="danger" onClick={deleteSelection}>Rimuovi rotatoria</Button></div>
    </>
  );
}
