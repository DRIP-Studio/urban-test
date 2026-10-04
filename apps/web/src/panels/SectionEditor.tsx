import { useEffect, useRef, useState } from 'react';
import { ROAD_TEMPLATES, roadFromTemplate, type CrossSectionElement, type CrossSectionElementKind, type Lane, type Road, type TurnKind } from '@drip-urban/core';
import { commit, newId, useApp } from '../state/store';
import { Button, Empty, Field, NumberField, Segmented, Select, FieldGroup } from '../ui/controls';
import { Icon } from '../ui/Icon';

const KIND_LABEL: Record<CrossSectionElementKind, string> = {
  sidewalk: 'Marciapiede', furniture: 'Fascia arredo', parking: 'Sosta', cycle: 'Ciclabile', bus: 'Corsia bus', lane: 'Corsia',
  median: 'Spartitraffico', green: 'Verde', shoulder: 'Banchina', curb: 'Cordolo',
};
const DEFAULT_W: Record<CrossSectionElementKind, number> = { sidewalk: 2, furniture: 1.2, parking: 2, cycle: 1.5, bus: 3.5, lane: 3, median: 1.5, green: 1.5, shoulder: 0.5, curb: 0.15 };
const MIN_W: Record<CrossSectionElementKind, number> = { sidewalk: 1.5, furniture: 0.5, parking: 1.8, cycle: 1.0, bus: 3.0, lane: 2.5, median: 0.5, green: 0.5, shoulder: 0.25, curb: 0.1 };
const LANE_KINDS = new Set<CrossSectionElementKind>(['lane', 'bus']);

interface Draft { elements: CrossSectionElement[]; lanes: Lane[] }

function fromRoad(r: Road): Draft { return { elements: [...r.section.elements], lanes: [...r.lanes] }; }

/** Re-indexes lanes right → left after edits; index 0 = rightmost lane. */
function normalize(d: Draft): Draft {
  const laneEls = d.elements.filter((e) => LANE_KINDS.has(e.kind) && e.laneId);
  const lanes = laneEls.map((e, i) => {
    const l = d.lanes.find((x) => x.id === e.laneId)!;
    return { ...l, index: laneEls.length - 1 - i, widthM: e.widthM, ...(e.kind === 'bus' ? { restriction: 'bus_only' as const, modes: ['bus' as const, 'emergency' as const] } : l.restriction === 'bus_only' ? { restriction: 'none' as const, modes: ['car' as const, 'bus' as const, 'truck' as const, 'bike' as const, 'emergency' as const] } : {}) };
  });
  return { elements: d.elements, lanes };
}

export function SectionEditor() {
  const sel = useApp((s) => s.selection);
  const net = useApp((s) => s.network);
  const road = sel?.kind === 'road' ? net?.roads[sel.ids[0]!] : undefined;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [active, setActive] = useState<number>(0);
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; startX: number; startW: number; pxPerM: number } | null>(null);
  useEffect(() => { setDraft(road ? fromRoad(road) : null); setActive(0); }, [road]);
  if (!road || !draft) return <Empty icon="section" title="Nessuna strada selezionata">Seleziona una strada (strumento Sezione o Seleziona) per modificarne la sezione trasversale.</Empty>;
  const total = draft.elements.reduce((s, e) => s + e.widthM, 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromRoad(road));
  const apply = (d: Draft) => {
    const n = normalize(d);
    const anyFwd = n.lanes.some((l) => l.direction === 'forward'), anyBwd = n.lanes.some((l) => l.direction === 'backward');
    commit('road.setSection', { roadId: road.id, lanes: n.lanes, section: { elements: n.elements }, oneway: anyFwd && anyBwd ? 'no' : anyFwd ? 'forward' : 'backward' });
  };
  const el = draft.elements[active];
  const lane = el?.laneId ? draft.lanes.find((l) => l.id === el.laneId) : undefined;
  const update = (i: number, patch: Partial<CrossSectionElement>) => setDraft({ ...draft, elements: draft.elements.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const updateLane = (patch: Partial<Lane>) => lane && setDraft({ ...draft, lanes: draft.lanes.map((l) => (l.id === lane.id ? { ...l, ...patch } : l)) });
  const add = (kind: CrossSectionElementKind, side: 'left' | 'right') => {
    const id = newId(`${road.id}:e`);
    let laneId: string | undefined;
    let lanes = draft.lanes;
    if (LANE_KINDS.has(kind)) {
      laneId = newId(`${road.id}:l`);
      lanes = [...lanes, { id: laneId, index: 0, direction: side === 'right' ? 'forward' : 'backward', widthM: DEFAULT_W[kind], modes: kind === 'bus' ? ['bus', 'emergency'] : ['car', 'bus', 'truck', 'bike', 'emergency'], turns: ['through'] }];
    }
    const e: CrossSectionElement = { id, kind, widthM: DEFAULT_W[kind], ...(laneId ? { laneId } : {}) };
    // New carriageway elements go next to the carriageway, others on the outer edge.
    const els = [...draft.elements];
    const firstCw = els.findIndex((x) => LANE_KINDS.has(x.kind) || x.kind === 'median');
    const lastCw = els.length - 1 - [...els].reverse().findIndex((x) => LANE_KINDS.has(x.kind) || x.kind === 'median');
    const pos = LANE_KINDS.has(kind) ? (side === 'left' ? Math.max(0, firstCw) : lastCw + 1) : side === 'left' ? 0 : els.length;
    els.splice(pos, 0, e);
    setDraft({ elements: els, lanes });
    setActive(pos);
  };
  const remove = (i: number) => {
    const e = draft.elements[i]!;
    if (LANE_KINDS.has(e.kind) && draft.elements.filter((x) => LANE_KINDS.has(x.kind)).length <= 1) return;
    setDraft({ elements: draft.elements.filter((_, j) => j !== i), lanes: draft.lanes.filter((l) => l.id !== e.laneId) });
    setActive(Math.max(0, i - 1));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.elements.length) return;
    const els = [...draft.elements];
    [els[i], els[j]] = [els[j]!, els[i]!];
    setDraft({ ...draft, elements: els });
    setActive(j);
  };
  const applyTemplate = (tid: string) => {
    const t = ROAD_TEMPLATES.find((x) => x.id === tid)!;
    const r = roadFromTemplate(t, road.id, road.from, road.to, road.axis, road.name);
    setDraft({ elements: [...r.section.elements], lanes: [...r.lanes] });
    setActive(0);
  };
  const onPointerDown = (i: number, ev: React.PointerEvent) => {
    const w = strip.current?.getBoundingClientRect().width ?? 1;
    drag.current = { i, startX: ev.clientX, startW: draft.elements[i]!.widthM, pxPerM: w / total };
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = draft.elements[d.i]!.kind;
    const w = Math.max(MIN_W[k], Math.round((d.startW + (ev.clientX - d.startX) / d.pxPerM) * 20) / 20);
    update(d.i, { widthM: w });
  };
  return (
    <div className="section-editor">
      <div className="se-head">
        <div>
          <strong>{road.name || 'Strada senza nome'}</strong>
          <span className="muted"> · sezione totale <span className="mono">{total.toFixed(2).replace('.', ',')} m</span> · vista nel senso dell'asse</span>
        </div>
        <div className="se-head-actions">
          <Select value={null} placeholder="Applica template…" ariaLabel="Template" options={ROAD_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))} onChange={applyTemplate} />
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(fromRoad(road))}>Ripristina</Button>
          <Button variant="project" icon="check" disabled={!dirty} onClick={() => apply(draft)}>Applica alla strada</Button>
        </div>
      </div>
      <div className="se-body">
        <div className="se-add">
          <span className="muted">Aggiungi a sinistra</span>
          {(['sidewalk', 'parking', 'cycle', 'green', 'lane', 'bus', 'median'] as CrossSectionElementKind[]).map((k) => <button key={k} type="button" className="chip" onClick={() => add(k, 'left')}>+ {KIND_LABEL[k]}</button>)}
        </div>
        <div className="se-strip" ref={strip} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}>
          {draft.elements.map((e, i) => {
            const l = e.laneId ? draft.lanes.find((x) => x.id === e.laneId) : undefined;
            return (
              <div key={e.id} className={`se-el ms-${e.kind} ${i === active ? 'is-active' : ''}`} style={{ flexGrow: e.widthM, flexBasis: 0 }} onClick={() => setActive(i)} role="button" tabIndex={0} aria-label={`${KIND_LABEL[e.kind]} ${e.widthM} m`}
                onKeyDown={(ev) => { if (ev.key === 'Delete') remove(i); if (ev.key === 'ArrowLeft' && ev.altKey) move(i, -1); if (ev.key === 'ArrowRight' && ev.altKey) move(i, 1); }}>
                <span className="se-label">{KIND_LABEL[e.kind]}</span>
                {l ? <span className="se-dir"><Icon name={l.direction === 'backward' ? 'chevronLeft' : 'chevronRight'} size={16} /></span> : null}
                <span className="se-w mono">{e.widthM.toFixed(2).replace('.', ',')}</span>
                <span className="se-handle" onPointerDown={(ev) => onPointerDown(i, ev)} aria-hidden />
              </div>
            );
          })}
        </div>
        <div className="se-add">
          <span className="muted">Aggiungi a destra</span>
          {(['sidewalk', 'parking', 'cycle', 'green', 'lane', 'bus', 'furniture'] as CrossSectionElementKind[]).map((k) => <button key={k} type="button" className="chip" onClick={() => add(k, 'right')}>+ {KIND_LABEL[k]}</button>)}
        </div>
      </div>
      {el ? (
        <div className="se-props">
          <Field label="Elemento"><Select value={el.kind} ariaLabel="Tipo elemento" options={Object.entries(KIND_LABEL).filter(([k]) => LANE_KINDS.has(el.kind) === LANE_KINDS.has(k as CrossSectionElementKind)).map(([value, label]) => ({ value: value as CrossSectionElementKind, label }))} onChange={(v) => update(active, { kind: v })} /></Field>
          <Field label="Larghezza"><NumberField value={el.widthM} unit="m" min={MIN_W[el.kind]} max={15} step={0.05} ariaLabel="Larghezza" onCommit={(v) => update(active, { widthM: v })} /></Field>
          {lane ? (
            <>
              <FieldGroup label="Direzione"><Segmented label="Direzione corsia" value={lane.direction} onChange={(v) => updateLane({ direction: v })} options={[{ value: 'forward', label: 'Con l\'asse' }, { value: 'backward', label: 'Contro' }, { value: 'reversible', label: 'Reversibile' }]} /></FieldGroup>
              <Field label="Svolte consentite">
                <div className="chips">{(['left', 'through', 'right'] as TurnKind[]).map((t) => (
                  <button key={t} type="button" className={`chip ${lane.turns.includes(t) ? 'is-on' : ''}`} onClick={() => updateLane({ turns: lane.turns.includes(t) ? lane.turns.filter((x) => x !== t) : [...lane.turns, t] })}>{{ left: '↰ Sinistra', through: '↑ Dritto', right: '↱ Destra', uturn: 'Inversione' }[t]}</button>
                ))}</div>
              </Field>
              <Field label="Velocità corsia"><NumberField value={lane.speedKmh ?? road.speedKmh} unit="km/h" min={5} max={130} step={5} decimals={0} ariaLabel="Velocità corsia" onCommit={(v) => updateLane({ speedKmh: v })} /></Field>
            </>
          ) : null}
          <div className="se-el-actions">
            <Button size="sm" icon="chevronLeft" onClick={() => move(active, -1)}>Sposta</Button>
            <Button size="sm" icon="chevronRight" onClick={() => move(active, 1)}>Sposta</Button>
            <Button size="sm" icon="trash" variant="danger" onClick={() => remove(active)}>Rimuovi</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
