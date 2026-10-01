import { useEffect } from 'react';
import { LocalFrame, type Roundabout, type RoundaboutType } from '@drip-urban/core';
import { fc } from '../engine/geojson';
import { setSource } from '../map/mapStore';
import { commit, newId, select, setTool, useApp } from '../state/store';
import { deleteSelection } from '../state/actions';
import { useTool } from '../tools/toolState';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Toggle } from '../ui/controls';

const TYPES: { value: RoundaboutType; label: string; range: [number, number]; hint: string }[] = [
  { value: 'mini', label: 'Mini', range: [14, 25], hint: 'isola sormontabile' },
  { value: 'compact', label: 'Compatta', range: [25, 40], hint: 'isola non sormontabile' },
  { value: 'standard', label: 'Convenzionale', range: [40, 70], hint: '> 40 m' },
  { value: 'elliptical', label: 'Ellittica', range: [40, 70], hint: 'assi diversi' },
  { value: 'turbo', label: 'Turbo', range: [40, 70], hint: 'corsie separate' },
];

function ring(center: [number, number], r: number, aspect: number, orientationDeg: number, origin: [number, number]) {
  const f = new LocalFrame(origin);
  const c = f.toMetric(center);
  const rot = ((90 - orientationDeg) * Math.PI) / 180;
  const pts = Array.from({ length: 97 }, (_, i) => {
    const t = (2 * Math.PI * i) / 96;
    const x = r * Math.cos(t), y = r * aspect * Math.sin(t);
    const ll = f.toLngLat([c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)]);
    return [ll[0], ll[1]];
  });
  return pts;
}

export function RoundaboutPlacePanel() {
  const rb = useTool((s) => s.rb);
  const net = useApp((s) => s.network);
  const baseline = useApp((s) => s.baseline);
  useEffect(() => {
    if (!rb || !net || !baseline || !net.nodes[rb.nodeId]) { setSource('draft', null); return; }
    const c = net.nodes[rb.nodeId]!.at as [number, number];
    const R = rb.outerDiameterM / 2;
    const aspect = rb.type === 'elliptical' ? rb.aspect : 1;
    setSource('draft', fc([
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(c, R, aspect, rb.orientationDeg, baseline.origin as [number, number]), ring(c, R - rb.circulatoryWidthM, aspect, rb.orientationDeg, baseline.origin as [number, number])] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { snap: true, label: `Ø ${rb.outerDiameterM} m` } },
    ]));
    return () => setSource('draft', null);
  }, [rb, net, baseline]);
  if (!rb) return <Empty icon="roundabout" title="Scegli un incrocio">Clicca su un incrocio con almeno 3 bracci: vedrai l'anteprima della rotatoria prima di confermarla.</Empty>;
  const set = (p: Partial<NonNullable<typeof rb>>) => useTool.setState({ rb: { ...rb, ...p } });
  const type = TYPES.find((t) => t.value === rb.type)!;
  const arms = net ? Object.values(net.roads).filter((r) => r.from === rb.nodeId || r.to === rb.nodeId).length : 0;
  const confirm = () => {
    const center = net!.nodes[rb.nodeId]!.at;
    const r: Roundabout = {
      id: newId('rb'), name: 'Rotatoria di progetto', type: rb.type, center, replacedNodeId: rb.nodeId, outerDiameterM: rb.outerDiameterM, aspect: rb.type === 'elliptical' ? rb.aspect : 1,
      orientationDeg: rb.orientationDeg, circulatoryWidthM: rb.circulatoryWidthM, lanes: rb.lanes, apronWidthM: rb.apronWidthM, islandMaterial: rb.islandMaterial,
      control: 'yield', speedKmh: rb.type === 'mini' ? 20 : 30,
      arms: Object.values(net!.roads).filter((x) => x.from === rb.nodeId || x.to === rb.nodeId).map((x) => ({
        roadId: x.id, entryRadiusM: Math.max(6, rb.outerDiameterM * 0.35), exitRadiusM: Math.max(8, rb.outerDiameterM * 0.45),
        splitter: rb.splitters && rb.type !== 'mini', splitterLengthM: 10, splitterWidthM: 1.5, crossing: rb.crossings,
      })),
    };
    const res = commit('roundabout.add', { roundabout: r });
    if (res.ok) {
      useTool.setState({ rb: null });
      setTool('select');
      select({ kind: 'roundabout', ids: [r.id] });
    }
  };
  return (
    <>
      <Section title="Nuova rotatoria">
        <p className="muted">{arms} bracci · la rotatoria sostituisce l'incrocio nel grafo di routing (anello antiorario) e genera la geometria fisica tangente.</p>
        <Field label="Tipo (DM 19/04/2006)"><Select value={rb.type} ariaLabel="Tipo rotatoria" options={TYPES.map((t) => ({ value: t.value, label: t.label, hint: `${t.range[0]}–${t.range[1]} m · ${t.hint}` }))}
          onChange={(v) => { const t = TYPES.find((x) => x.value === v)!; set({ type: v, outerDiameterM: Math.min(t.range[1], Math.max(t.range[0], rb.outerDiameterM)), apronWidthM: v === 'mini' ? 1 : rb.apronWidthM }); }} /></Field>
        <div className="grid-2">
          <Field label="Diametro esterno"><NumberField value={rb.outerDiameterM} unit="m" min={type.range[0]} max={type.range[1]} step={1} ariaLabel="Diametro" onCommit={(v) => set({ outerDiameterM: v })} /></Field>
          <Field label="Larghezza anello"><NumberField value={rb.circulatoryWidthM} unit="m" min={6} max={12} step={0.25} ariaLabel="Larghezza anello" onCommit={(v) => set({ circulatoryWidthM: v })} /></Field>
          <Field label="Fascia sormontabile"><NumberField value={rb.apronWidthM} unit="m" min={0} max={3} step={0.25} ariaLabel="Fascia" onCommit={(v) => set({ apronWidthM: v })} /></Field>
          <Field label="Corsie anello"><Segmented<'1' | '2'> label="Corsie" value={String(rb.lanes) as '1' | '2'} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }]} onChange={(v) => set({ lanes: Number(v) as 1 | 2 })} /></Field>
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
      <div className="inspector-actions"><Button variant="ghost" onClick={() => useTool.setState({ rb: null })}>Annulla</Button><Button variant="project" icon="check" onClick={confirm}>Crea rotatoria</Button></div>
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
        <Field label="Regolazione"><Segmented<Roundabout['control']> label="Regolazione" value={rb.control} onChange={(v) => update({ control: v })}
          options={[{ value: 'yield', label: 'Precedenza' }, { value: 'signalized', label: 'Semaforica' }, { value: 'metered', label: 'A dosaggio' }, { value: 'part_time', label: 'Fasce orarie' }]} /></Field>
      </Section>
      <Section title="Bracci" count={rb.arms.length}>
        {rb.arms.map((a, i) => (
          <div key={a.roadId} className="arm-row">
            <strong>{net.roads[a.roadId]?.name || `Braccio ${i + 1}`}</strong>
            <Toggle label="Spartitraffico" checked={a.splitter} onChange={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, splitter: v } : x)) })} />
            <Toggle label="Attraversamento" checked={a.crossing} onChange={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, crossing: v } : x)) })} />
            <div className="grid-2">
              <Field label="Raggio d'entrata"><NumberField value={a.entryRadiusM} unit="m" min={4} max={40} ariaLabel="Raggio entrata" onCommit={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, entryRadiusM: v } : x)) })} /></Field>
              {a.splitter ? <Field label="Lunghezza isola"><NumberField value={a.splitterLengthM} unit="m" min={4} max={30} ariaLabel="Lunghezza isola" onCommit={(v) => update({ arms: rb.arms.map((x) => (x.roadId === a.roadId ? { ...x, splitterLengthM: v } : x)) })} /></Field> : null}
            </div>
          </div>
        ))}
      </Section>
      <div className="inspector-actions"><Button icon="trash" variant="danger" onClick={deleteSelection}>Rimuovi rotatoria</Button></div>
    </>
  );
}
