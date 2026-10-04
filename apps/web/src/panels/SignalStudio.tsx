import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { LocalFrame, activeTurns, planIssues, type CoordinationResult, type DetectedCorridor, type PlantDesign, type JunctionAnalysis, type LaneGroup, type SignalPhase, type SignalPlan, type TurnKind } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { setSignalPreview } from '../map/signalsLive';
import { commit, newId, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, Section, Segmented, Skeleton, Stat, Toggle, FieldGroup } from '../ui/controls';
import { drawJunction, useJunctionAnalysis, type JunctionResult } from './JunctionLab';

const COLORS = ['#83b4d1', '#e8772e', '#c98bb0', '#6fae86', '#d9a441', '#7e8fa3'];
const ARROW: Record<TurnKind, string> = { left: '←', through: '↑', right: '→', uturn: '↶' };
const TURN_IT: Record<TurnKind, string> = { left: 'sinistra', through: 'dritto', right: 'destra', uturn: 'inversione' };

/** Payload for signal.setPlan with movement-level checks (directional control, permitted lefts). */
export function planPayload(plan: SignalPlan, a: JunctionAnalysis) {
  return {
    plan, conflicts: a.incompatible, movementConflicts: a.movementConflicts, permissivePairs: a.permissivePairs,
    groupTurns: Object.fromEntries(a.groups.map((g) => [g.id, g.turns])),
  };
}

export function SignalStudio() {
  const { nodeId, data, loading, error } = useJunctionAnalysis();
  const net = useApp((s) => s.network);
  const existing = net && nodeId ? Object.values(net.signalPlans).find((p) => p.nodeId === nodeId) : undefined;
  const [plan, setPlan] = useState<SignalPlan | null>(null);
  const [design, setDesign] = useState<JunctionResult['suggested']['design'] | null>(null);
  const [t, setT] = useState(0);
  const timeline = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; startX: number; start: number; pxPerS: number } | null>(null);
  useEffect(() => {
    setPlan(existing ?? (data?.suggested ? stripDesign(data.suggested) : null));
    setDesign(existing ? null : data?.suggested.design ?? null);
  }, [existing, data]);
  useEffect(() => { drawJunction(data?.analysis ?? null); return () => drawJunction(null); }, [data]);
  useEffect(() => { setSignalPreview(plan ? { plan, t } : null); return () => setSignalPreview(null); }, [plan, t]);
  const issues = useMemo(() => (plan && data ? planIssues(plan, data.analysis) : []), [plan, data]);
  if (!nodeId) return <Empty icon="signal" title="Seleziona un incrocio">Usa lo strumento Semafori (T) e clicca su un incrocio.</Empty>;
  if (loading && !data) return <Skeleton lines={5} />;
  if (error || !data || !plan) return <Empty icon="warning" title="Signal Studio non disponibile">{error ?? 'Nessun gruppo di corsie in ingresso.'}</Empty>;
  const a = data.analysis;
  const total = plan.phases.reduce((s, p) => s + p.greenS + p.yellowS + p.allRedS, 0);
  const setPhase = (i: number, p: Partial<SignalPhase>) => setPlan({ ...plan, phases: plan.phases.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const save = () => {
    const r = commit('signal.setPlan', planPayload({ ...plan, id: plan.id || `plan:${nodeId}` }, a));
    if (r.ok) toast.success(existing ? 'Piano aggiornato' : 'Piano applicato', `${plan.phases.length} fasi · ciclo ${plan.cycleS} s`);
  };
  const propose = async (permissiveLeft: boolean) => {
    const r = await engine.job<JunctionResult | null>('junction', { nodeId, permissiveLeft });
    if (!r) return;
    setPlan({ ...stripDesign(r.suggested), id: plan.id, disabledHeads: plan.disabledHeads, coordination: plan.coordination });
    setDesign(r.suggested.design);
  };
  const pxPerS = (timeline.current?.getBoundingClientRect().width ?? 600) / Math.max(total, 1);
  const errors = issues.filter((i) => i.kind !== 'timing' || true);
  return (
    <div className="signal-studio">
      <div className="ss-head">
        <div className="ss-params">
          <FieldGroup label="Logica"><Segmented<SignalPlan['mode']> label="Logica" value={plan.mode} onChange={(v) => setPlan({ ...plan, mode: v, ...(v === 'actuated' || v === 'adaptive' ? { actuation: plan.actuation ?? { minGreenS: 8, maxGreenS: 45, gapOutS: 3, extensionS: 2.5 } } : {}) })}
            options={[{ value: 'fixed_time', label: 'Tempo fisso' }, { value: 'actuated', label: 'Attuato' }, { value: 'adaptive', label: 'Adattivo' }, { value: 'green_wave', label: 'Onda verde' }]} /></FieldGroup>
          <Field label="Ciclo"><NumberField value={plan.cycleS} unit="s" min={20} max={240} step={1} decimals={0} ariaLabel="Ciclo" onCommit={(v) => setPlan({ ...plan, cycleS: v })} /></Field>
          <Field label="Offset"><NumberField value={plan.offsetS} unit="s" min={0} max={plan.cycleS} step={1} decimals={0} ariaLabel="Offset" onCommit={(v) => setPlan({ ...plan, offsetS: v })} /></Field>
          <Field label="Svolte a sinistra"><Toggle checked={!!plan.permissiveLeft} label="Permesse (danno precedenza)" onChange={(v) => setPlan({ ...plan, permissiveLeft: v })} /></Field>
        </div>
        <div className="ss-actions">
          {Math.abs(total - plan.cycleS) > 0.5 ? <Button size="sm" onClick={() => setPlan({ ...plan, cycleS: total })}>Ciclo = somma fasi ({total} s)</Button> : null}
          <Button size="sm" variant="ghost" icon="sparkle" onClick={() => void propose(!!plan.permissiveLeft)}>Proposta automatica</Button>
          {existing ? <Button size="sm" variant="danger" onClick={() => commit('signal.removePlan', { planId: existing.id })}>Rimuovi piano</Button> : null}
          <Button variant="project" icon="check" disabled={issues.length > 0} onClick={save}>{existing ? 'Aggiorna piano' : 'Applica piano'}</Button>
        </div>
      </div>
      {design ? (
        <p className="ss-design">
          <strong>{design.method}</strong> · ciclo {design.cycleS} s · tempo perso {design.lostTimeS} s · Y = {design.criticalRatio}
          {design.criticalRatio > 0.85 ? <span className="warn-line"> incrocio vicino alla saturazione: valuta corsie dedicate o rotatoria</span> : null}
        </p>
      ) : null}
      <div className="ss-timeline" ref={timeline} onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        setPhase(d.i, { greenS: Math.max(5, Math.round(d.start + (e.clientX - d.startX) / d.pxPerS)) });
      }} onPointerUp={() => { drag.current = null; }} onClick={(e) => { const r = timeline.current!.getBoundingClientRect(); setT(Math.max(0, (e.clientX - r.left) / pxPerS)); }}>
        {plan.phases.map((p, i) => (
          <div key={p.id} className="ss-phase" style={{ flexGrow: p.greenS + p.yellowS + p.allRedS }}>
            <div className="ss-bar">
              <span className="g" style={{ flexGrow: p.greenS, background: COLORS[i % COLORS.length] }}>{p.name} · {p.greenS}s</span>
              <span className="y" style={{ flexGrow: p.yellowS }} />
              <span className="r" style={{ flexGrow: p.allRedS }} />
              <span className="ss-drag" aria-label={`Durata verde ${p.name}`} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { i, startX: e.clientX, start: p.greenS, pxPerS }; }} />
            </div>
          </div>
        ))}
        <span className="ss-cursor" style={{ left: `${(t / Math.max(total, 1)) * 100}%` }} />
      </div>
      <div className="ss-groups">
        <table className="table">
          <thead><tr><th>Fase</th>{a.groups.map((g) => <th key={g.id} title={g.label}>{g.id}<br /><span className="muted">{g.approachName.slice(0, 14)}</span></th>)}<th>Pedoni</th><th>Verde</th><th>Giallo</th><th>Tutto rosso</th><th /></tr></thead>
          <tbody>
            {plan.phases.map((p, i) => (
              <tr key={p.id}>
                <td><span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />{p.name}</td>
                {a.groups.map((g) => <td key={g.id}><TurnCell plan={plan} phase={p} group={g} analysis={a} onChange={(next) => setPhase(i, next)} /></td>)}
                <td><div className="chips">{a.arms.map((arm) => (
                  <button key={arm.roadId} type="button" className={`chip chip-sm ${p.pedestrianRoadIds.includes(arm.roadId) ? 'is-on' : ''}`} onClick={() => setPhase(i, { pedestrianRoadIds: p.pedestrianRoadIds.includes(arm.roadId) ? p.pedestrianRoadIds.filter((x) => x !== arm.roadId) : [...p.pedestrianRoadIds, arm.roadId] })} title={arm.name}>{arm.name.slice(0, 10)}</button>
                ))}</div></td>
                <td><NumberField value={p.greenS} unit="s" min={5} max={120} decimals={0} ariaLabel="Verde" onCommit={(v) => setPhase(i, { greenS: v })} /></td>
                <td><NumberField value={p.yellowS} unit="s" min={3} max={6} decimals={0} ariaLabel="Giallo" onCommit={(v) => setPhase(i, { yellowS: v })} /></td>
                <td><NumberField value={p.allRedS} unit="s" min={0} max={6} decimals={0} ariaLabel="Tutto rosso" onCommit={(v) => setPhase(i, { allRedS: v })} /></td>
                <td><Button size="sm" variant="ghost" icon="trash" disabled={plan.phases.length <= 1} onClick={() => setPlan({ ...plan, phases: plan.phases.filter((_, j) => j !== i) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ss-footer">
          <Button size="sm" icon="plus" onClick={() => setPlan({ ...plan, phases: [...plan.phases, { id: newId('F'), name: `Fase ${plan.phases.length + 1}`, greenGroups: [], greenS: 10, yellowS: 3, allRedS: 2, pedestrianRoadIds: [] }] })}>Aggiungi fase</Button>
          {errors.length ? <ul className="issue-list">{errors.map((e) => <li key={e.message} className="is-error">{e.message}</li>)}</ul> : <span className="ok">Piano valido: nessun verde in conflitto{plan.permissiveLeft ? ' (svolte a sinistra permesse)' : ''}. Semafori pedonali a 3 luci.</span>}
        </div>
        <p className="muted">Clic sulle frecce per decidere quali direzioni hanno il verde in ogni fase (lanterne a frecce, art. 159–163 Reg. CdS). Le direzioni in conflitto con un verde già acceso sono bloccate.</p>
      </div>
      <HeadsSection plan={plan} analysis={a} existing={existing} onChange={(disabledHeads) => setPlan({ ...plan, disabledHeads })} />
      {plan.mode === 'actuated' || plan.mode === 'adaptive' ? (
        <Section title={plan.mode === 'actuated' ? 'Attuazione (spire / detector)' : 'Logica adattiva'}>
          <div className="grid-4">
            <Field label="Verde minimo"><NumberField value={plan.actuation!.minGreenS} unit="s" min={4} max={60} decimals={0} ariaLabel="Verde minimo" onCommit={(v) => setPlan({ ...plan, actuation: { ...plan.actuation!, minGreenS: v } })} /></Field>
            <Field label="Verde massimo"><NumberField value={plan.actuation!.maxGreenS} unit="s" min={10} max={120} decimals={0} ariaLabel="Verde massimo" onCommit={(v) => setPlan({ ...plan, actuation: { ...plan.actuation!, maxGreenS: v } })} /></Field>
            <Field label="Gap-out"><NumberField value={plan.actuation!.gapOutS} unit="s" min={1} max={10} step={0.5} ariaLabel="Gap-out" onCommit={(v) => setPlan({ ...plan, actuation: { ...plan.actuation!, gapOutS: v } })} /></Field>
            <Field label="Estensione"><NumberField value={plan.actuation!.extensionS} unit="s" min={0.5} max={10} step={0.5} ariaLabel="Estensione" onCommit={(v) => setPlan({ ...plan, actuation: { ...plan.actuation!, extensionS: v } })} /></Field>
          </div>
          <p className="muted">Nella simulazione DRIP Flow il piano è eseguito con i tempi di base; l'estensione dinamica per presenza veicoli è un parametro di progetto documentato nel piano.</p>
        </Section>
      ) : null}
      {existing ? <Coordination plan={existing} /> : <Section title="Coordinamento con altri incroci"><p className="muted">Applica prima il piano di questo incrocio, poi collegalo agli altri semafori.</p></Section>}
    </div>
  );
}

const stripDesign = (p: JunctionResult['suggested']): SignalPlan => { const { design: _d, ...plan } = p; return plan; };

/** One cell of the phase matrix: the group's turns as toggles. */
function TurnCell({ plan, phase, group, analysis, onChange }: { plan: SignalPlan; phase: SignalPhase; group: LaneGroup; analysis: JunctionAnalysis; onChange: (p: Partial<SignalPhase>) => void }) {
  const on = activeTurns(phase, group);
  const permissive = new Set(plan.permissiveLeft ? analysis.permissivePairs.map(([x, y]) => [x, y].sort().join('|')) : []);
  const conflict = new Set(analysis.movementConflicts.map(([x, y]) => [x, y].sort().join('|')));
  const greenElsewhere = analysis.groups.filter((g) => g.id !== group.id).flatMap((g) => activeTurns(phase, g).map((t) => `${g.id}:${t}`));
  const blocked = (t: TurnKind) => greenElsewhere.some((k) => { const key = [`${group.id}:${t}`, k].sort().join('|'); return conflict.has(key) && !permissive.has(key); });
  const toggle = (t: TurnKind) => {
    const next = on.includes(t) ? on.filter((x) => x !== t) : [...on, t];
    const greenGroups = next.length ? [...new Set([...phase.greenGroups, group.id])] : phase.greenGroups.filter((x) => x !== group.id);
    const gm = { ...(phase.greenMovements ?? {}) };
    if (!next.length || next.length === group.turns.length) delete gm[group.id]; else gm[group.id] = next;
    onChange({ greenGroups, greenMovements: Object.keys(gm).length ? gm : undefined });
  };
  return (
    <div className="turn-cell" role="group" aria-label={group.label}>
      {group.turns.map((t) => {
        const isOn = on.includes(t);
        const isBlocked = !isOn && blocked(t);
        return (
          <button key={t} type="button" className={`cell turn ${isOn ? 'is-on' : ''} ${isBlocked ? 'is-blocked' : ''}`} disabled={isBlocked} aria-pressed={isOn}
            title={isBlocked ? `${TURN_IT[t]}: in conflitto con un verde già acceso` : `${group.approachName} · ${TURN_IT[t]}`} onClick={() => toggle(t)}>{ARROW[t]}</button>
        );
      })}
    </div>
  );
}

/** Lanterns: every head can be removed from (or re-added to) the junction without touching the timing. */
function HeadsSection({ plan, analysis, existing, onChange }: { plan: SignalPlan; analysis: JunctionAnalysis; existing?: SignalPlan; onChange: (d: string[]) => void }) {
  const off = new Set(plan.disabledHeads ?? []);
  const pedRoads = [...new Set(plan.phases.flatMap((p) => p.pedestrianRoadIds))];
  const heads = [
    ...analysis.groups.map((g) => ({ key: g.id, label: `${g.approachName} · ${g.turns.map((t) => ARROW[t]).join('')}`, kind: 'Veicolare' })),
    ...pedRoads.flatMap((rid) => [0, 1].map((side) => ({ key: `ped:${rid}:${side}`, label: `${analysis.arms.find((a) => a.roadId === rid)?.name ?? rid} · lato ${side === 0 ? 'sinistro' : 'destro'}`, kind: 'Pedonale' }))),
  ];
  const set = (key: string, installed: boolean) => {
    const next = installed ? [...off].filter((k) => k !== key) : [...off, key];
    onChange(next);
    if (existing) commit('signal.setHeads', { planId: existing.id, disabledHeads: next });
  };
  return (
    <Section title="Lanterne installate" count={heads.length - heads.filter((h) => off.has(h.key)).length} defaultOpen={false}>
      <ul className="row-list">
        {heads.map((h) => (
          <li key={h.key}>
            <span className="grow"><strong>{h.kind}</strong> · {h.label}</span>
            <Toggle compact checked={!off.has(h.key)} label={`Lanterna ${h.label}`} onChange={(v) => set(h.key, v)} />
          </li>
        ))}
      </ul>
      <p className="muted">Una lanterna rimossa resta nel piano (tempi e fasi) ma non compare in mappa, nel Twin e negli export: utile per lanterne non presenti nello stato di fatto o da eliminare.</p>
    </Section>
  );
}

type CoordResult = CoordinationResult & { order: string[] };

/** Applies a computed corridor (one undoable operation). */
function applyCorridor(r: CoordResult, name: string, existingId?: string): boolean {
  const ok = commit('signal.coordinate', {
    coordination: { id: existingId ?? newId('coord'), name, speedKmh: r.speedKmh, direction: r.direction },
    cycleS: r.cycleS, plans: r.offsets.map((o) => ({ planId: o.planId, offsetS: o.offsetS, halfCycle: o.halfCycle })),
  }).ok;
  if (ok) toast.success('Onda verde applicata', `${r.offsets.length} incroci · ciclo ${r.cycleS} s · banda ${r.bandwidthS} s${r.bandwidthBackS !== null ? ` / ${r.bandwidthBackS} s` : ''}`);
  return ok;
}

/** Green waves and merged plants: automatic corridors, manual selection, impianto unico. */
function Coordination({ plan }: { plan: SignalPlan }) {
  const net = useApp((s) => s.network)!;
  const baseline = useApp((s) => s.baseline)!;
  const f = useMemo(() => new LocalFrame(baseline.origin), [baseline]);
  const here = f.toMetric(net.nodes[plan.nodeId]!.at);
  const others = Object.values(net.signalPlans).filter((p) => p.id !== plan.id).map((p) => {
    const m = f.toMetric(net.nodes[p.nodeId]!.at);
    return { plan: p, d: Math.hypot(m[0] - here[0], m[1] - here[1]) };
  }).sort((x, y) => x.d - y.d);
  const corridor = plan.coordination ? Object.values(net.signalPlans).filter((p) => p.coordination?.id === plan.coordination!.id).sort((x, y) => x.coordination!.order - y.coordination!.order) : [];
  const plant = plan.plant ? Object.values(net.signalPlans).filter((p) => p.plant?.id === plan.plant!.id) : [];
  const [chosen, setChosen] = useState<string[]>(() => corridor.filter((p) => p.id !== plan.id).map((p) => p.id));
  const [speed, setSpeed] = useState(plan.coordination?.speedKmh ?? 40);
  const [direction, setDirection] = useState<'oneway' | 'twoway'>(plan.coordination?.direction ?? 'twoway');
  const [cycle, setCycle] = useState<number | null>(null);
  const [half, setHalf] = useState(true);
  const [result, setResult] = useState<CoordResult | null>(null);
  const [auto, setAuto] = useState<{ c: DetectedCorridor; r: CoordResult }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [plantDesign, setPlantDesign] = useState<PlantDesign | null>(null);
  const run = async (planIds: string[]): Promise<CoordResult> => {
    const r = await engine.job<CoordinationResult>('coordinate', { planIds, speedKmh: speed, cycleS: cycle, direction, allowHalfCycle: half });
    return { ...r, order: planIds };
  };
  // Order along the corridor: projection on the direction from this junction to the farthest chosen one.
  const ordered = () => {
    const ids = [plan.id, ...chosen];
    const far = others.filter((o) => chosen.includes(o.plan.id)).pop();
    if (!far) return ids;
    const fm = f.toMetric(net.nodes[far.plan.nodeId]!.at);
    const ux = fm[0] - here[0], uy = fm[1] - here[1];
    const along = (id: string) => { const m = f.toMetric(net.nodes[net.signalPlans[id]!.nodeId]!.at); return (m[0] - here[0]) * ux + (m[1] - here[1]) * uy; };
    return ids.sort((x, y) => along(x) - along(y));
  };
  const detect = async () => {
    setBusy('detect');
    try {
      const cs = await engine.job<DetectedCorridor[]>('detectCorridors', {});
      const rs: { c: DetectedCorridor; r: CoordResult }[] = [];
      for (const c of cs.slice(0, 12)) rs.push({ c, r: await run([...c.planIds]) });
      setAuto(rs);
      if (!rs.length) toast.info('Nessun corridoio', 'Servono almeno due incroci semaforizzati lungo la stessa via entro 800 m.');
    } finally { setBusy(null); }
  };
  const coordinateAll = () => {
    if (!auto?.length) return;
    // Each junction joins one corridor only: the longest ones first.
    const taken = new Set<string>();
    let n = 0;
    for (const { c, r } of auto) {
      if (c.planIds.some((id) => taken.has(id))) continue;
      if (applyCorridor(r, `Onda verde ${c.name}`)) { n++; c.planIds.forEach((id) => taken.add(id)); }
    }
    toast.success('Rete coordinata', `${n} corridoi con onda verde`);
  };
  const mergeSelected = async () => {
    const ids = ordered();
    setBusy('plant');
    try { setPlantDesign(await engine.job<PlantDesign>('designPlant', { planIds: ids, speedKmh: Math.min(speed, 30) })); } finally { setBusy(null); }
  };
  const applyPlant = () => {
    if (!plantDesign) return;
    const ok = commit('signal.mergePlant', { plant: { id: plan.plant?.id ?? newId('plant'), name: `Impianto ${plan.name}`, speedKmh: Math.min(speed, 30) }, cycleS: plantDesign.cycleS, plans: plantDesign.plans }).ok;
    if (ok) { toast.success('Impianto unico', `${plantDesign.plans.length} incroci con un solo regolatore · ciclo ${plantDesign.cycleS} s`); setPlantDesign(null); }
  };
  return (
    <Section title="Coordinamento e impianti" count={corridor.length || undefined}>
      {corridor.length ? (
        <div className="row"><span className="plan-chip">{plan.coordination!.name}</span><span className="muted">{corridor.length} incroci · {plan.coordination!.speedKmh} km/h · {plan.coordination!.direction === 'twoway' ? 'due sensi' : 'senso principale'}{plan.coordination!.halfCycle ? ' · doppio ciclo' : ''}</span>
          <Button size="sm" variant="ghost" onClick={() => commit('signal.uncoordinate', { coordinationId: plan.coordination!.id })}>Scollega</Button></div>
      ) : null}
      {plant.length ? (
        <div className="row"><span className="plan-chip">{plan.plant!.name}</span><span className="muted">impianto unico · {plant.length} incroci · ciclo {plan.cycleS} s</span>
          <Button size="sm" variant="ghost" onClick={() => commit('signal.splitPlant', { plantId: plan.plant!.id })}>Separa</Button></div>
      ) : null}
      <div className="grid-3">
        <Field label="Velocità di progressione"><NumberField value={speed} unit="km/h" min={10} max={90} step={5} decimals={0} ariaLabel="Velocità" onCommit={setSpeed} /></Field>
        <Field label="Ciclo comune"><NumberField value={cycle ?? 0} unit="s" min={0} max={180} step={1} decimals={0} ariaLabel="Ciclo comune (0 = automatico)" onCommit={(v) => setCycle(v >= 30 ? v : null)} /></Field>
        <FieldGroup label="Direzione"><Segmented<'oneway' | 'twoway'> label="Direzione" value={direction} onChange={setDirection} options={[{ value: 'oneway', label: 'Un senso' }, { value: 'twoway', label: 'Due sensi' }]} /></FieldGroup>
      </div>
      <Toggle checked={half} label="Doppio ciclo per gli incroci minori quando allarga la banda" onChange={setHalf} />
      <p className="muted">Ciclo comune 0 = il più lungo tra gli incroci (Webster). La banda è calcolata sulle finestre di verde reali del movimento lungo il corridoio e sui tempi di percorrenza lungo le strade.</p>

      <h4 className="sub-title">Corridoi rilevati automaticamente</h4>
      <div className="row">
        <Button size="sm" icon="sparkle" busy={busy === 'detect'} onClick={() => void detect()}>Trova corridoi e calcola</Button>
        {auto?.length ? <Button size="sm" variant="project" icon="link" onClick={coordinateAll}>Coordina tutta la rete ({auto.length})</Button> : null}
      </div>
      {auto?.length ? (
        <ul className="row-list">{auto.map(({ c, r }) => (
          <li key={c.planIds.join()}>
            <span className="grow"><strong>{c.name}</strong> · {c.planIds.length} incroci · {c.lengthM} m · banda {r.bandwidthS} s{r.bandwidthBackS !== null ? ` / ${r.bandwidthBackS} s` : ''} ({Math.round(r.efficiency * 100)}%) · semplice {r.naiveBandwidthS} s</span>
            <button type="button" className="link" onClick={() => setResult(r)}>Diagramma</button>
            <button type="button" className="link" onClick={() => applyCorridor(r, `Onda verde ${c.name}`)}>Applica</button>
          </li>
        ))}</ul>
      ) : null}

      <h4 className="sub-title">Scelta manuale degli incroci</h4>
      {!others.length ? <p className="muted">Nessun altro incrocio semaforizzato nello scenario.</p> : (
        <>
          <ul className="row-list">
            {others.slice(0, 12).map((o) => (
              <li key={o.plan.id}>
                <input type="checkbox" checked={chosen.includes(o.plan.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, o.plan.id] : chosen.filter((x) => x !== o.plan.id))} aria-label={`Collega ${o.plan.name}`} />
                <span className="grow">{o.plan.name} · {Math.round(o.d)} m · ciclo {o.plan.cycleS} s{o.plan.coordination ? ` · in «${o.plan.coordination.name}»` : ''}{o.plan.plant ? ` · ${o.plan.plant.name}` : ''}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <Button size="sm" disabled={!chosen.length} busy={busy === 'manual'} onClick={() => { setBusy('manual'); void run(ordered()).then(setResult).finally(() => setBusy(null)); }}>Calcola onda verde</Button>
            <Button size="sm" variant="project" icon="link" disabled={!result} onClick={() => result && applyCorridor(result, `Onda verde ${net.roads[Object.values(net.roads).find((r) => r.from === plan.nodeId || r.to === plan.nodeId)?.id ?? '']?.name ?? ''}`.trim(), plan.coordination?.id)}>Applica onda verde</Button>
            <Button size="sm" disabled={!chosen.length} busy={busy === 'plant'} onClick={() => void mergeSelected()}>Unisci in un unico impianto</Button>
          </div>
        </>
      )}
      {plantDesign ? (
        <div className="plant-design">
          <p><strong>Impianto unico</strong> · ciclo {plantDesign.cycleS} s · sfasamenti {plantDesign.plans.map((p) => `${net.signalPlans[p.planId]?.name ?? p.planId} ${p.offsetS} s`).join(' · ')}</p>
          <table className="table"><thead><tr><th>Tratto interno</th><th>Lunghezza</th><th>Percorrenza</th><th>Accumulo</th><th>Coda attesa</th></tr></thead>
            <tbody>{plantDesign.links.map((l) => <tr key={l.from + l.to} className={l.ok ? '' : 'is-err'}><td>{net.signalPlans[l.from]?.name} → {net.signalPlans[l.to]?.name}</td><td className="mono">{l.lengthM} m</td><td className="mono">{l.travelS} s</td><td className="mono">{l.storageVeh} veic.</td><td className="mono">{l.queueVeh} veic.</td></tr>)}</tbody></table>
          {plantDesign.warnings.map((w) => <p key={w} className="warn-line">{w}</p>)}
          <div className="row"><Button size="sm" variant="project" icon="check" onClick={applyPlant}>Applica impianto unico</Button><Button size="sm" variant="ghost" onClick={() => setPlantDesign(null)}>Annulla</Button></div>
        </div>
      ) : null}
      {result ? <CorridorDiagram result={result} /> : null}
    </Section>
  );
}

/** Time–space diagram: real green windows per junction (outbound/inbound) and the two bands. */
function CorridorDiagram({ result }: { result: CoordResult }) {
  const net = useApp((s) => s.network)!;
  const C = result.cycleS, span = C * 2;
  const W = 560, padL = 92, padR = 10, padT = 14, padB = 22;
  const total = result.windows.reduce((t, w) => t + w.distanceM, 0) || 1;
  const H = padT + padB + Math.max(120, result.windows.length * 46);
  const X = (t: number) => padL + (t / span) * (W - padL - padR);
  let cum = 0;
  const rows = result.windows.map((w) => { cum += w.distanceM; return { ...w, y: padT + (1 - cum / total) * (H - padT - padB) }; });
  const v = result.speedKmh / 3.6;
  const bandPoly = (start: number, width: number, back: boolean) => {
    const pts: string[] = [];
    const tAt = (d: number) => (back ? (total - d) / v : d / v);
    const firstD = back ? total : 0;
    void firstD;
    const t0 = start, t1 = start + width;
    const ds = [0, total];
    for (const d of ds) pts.push(`${X(t0 + tAt(d))},${padT + (1 - d / total) * (H - padT - padB)}`);
    for (const d of [...ds].reverse()) pts.push(`${X(t1 + tAt(d))},${padT + (1 - d / total) * (H - padT - padB)}`);
    return pts.join(' ');
  };
  return (
    <div className="corridor">
      <div className="stats-row">
        <Stat label="Banda andata" value={result.bandwidthS} unit="s" />
        {result.bandwidthBackS !== null ? <Stat label="Banda ritorno" value={result.bandwidthBackS} unit="s" /> : null}
        <Stat label="Efficienza" value={`${Math.round(result.efficiency * 100)}%`} />
        <Stat label="Offset semplici" value={result.naiveBandwidthS} unit="s" />
      </div>
      {result.warnings.map((w) => <p key={w} className="warn-line">{w}</p>)}
      <svg className="time-space" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Diagramma spazio-tempo del corridoio">
        {[0, C, 2 * C].map((t) => <g key={t}><line x1={X(t)} x2={X(t)} y1={padT} y2={H - padB} stroke="currentColor" strokeOpacity={0.12} /><text x={X(t)} y={H - 6} textAnchor="middle">{t} s</text></g>)}
        {result.bandwidthS > 0 ? [0, C].map((k) => <polygon key={`f${k}`} points={bandPoly(result.bandStartS + k, result.bandwidthS, false)} fill="#83b4d1" fillOpacity={0.28} stroke="#83b4d1" strokeOpacity={0.7} />) : null}
        {result.bandwidthBackS && result.bandBackStartS !== null ? [0, C].map((k) => <polygon key={`b${k}`} points={bandPoly(result.bandBackStartS! + k, result.bandwidthBackS!, true)} fill="#e8772e" fillOpacity={0.2} stroke="#e8772e" strokeOpacity={0.6} />) : null}
        {rows.map((r) => {
          const reps = Math.ceil(span / r.cycleS) + 1;
          const bars: ReactElement[] = [];
          for (let k = -1; k < reps; k++) {
            const base = r.offsetS + k * r.cycleS;
            bars.push(<rect key={`r${k}`} x={X(Math.max(0, base))} y={r.y - 4} width={Math.max(0, X(Math.min(span, base + r.cycleS)) - X(Math.max(0, base)))} height={8} fill="#b9312a" opacity={0.75} />);
            for (const [s0, e0] of r.fwd) { const s1 = Math.max(0, base + s0), e1 = Math.min(span, base + e0); if (e1 > s1) bars.push(<rect key={`g${k}-${s0}`} x={X(s1)} y={r.y - 4} width={X(e1) - X(s1)} height={4} fill="#3fae6b" />); }
            for (const [s0, e0] of r.back) { const s1 = Math.max(0, base + s0), e1 = Math.min(span, base + e0); if (e1 > s1) bars.push(<rect key={`h${k}-${s0}`} x={X(s1)} y={r.y} width={X(e1) - X(s1)} height={4} fill="#2f7d5b" />); }
          }
          return (
            <g key={r.planId}>
              {bars}
              <text x={4} y={r.y - 2}>{(net.signalPlans[r.planId]?.name ?? r.planId).slice(0, 16)}</text>
              <text x={4} y={r.y + 9}>{r.offsetS} s{r.halfCycle ? ' · ½C' : ''}</text>
            </g>
          );
        })}
      </svg>
      <table className="table"><thead><tr><th>Incrocio</th><th>Distanza</th><th>Percorrenza</th><th>Offset</th><th>Ciclo</th></tr></thead>
        <tbody>{result.windows.map((o) => <tr key={o.planId}><td>{net.signalPlans[o.planId]?.name}</td><td className="mono">{o.distanceM} m</td><td className="mono">{o.travelS} s</td><td className="mono">{o.offsetS} s</td><td className="mono">{o.cycleS} s{o.halfCycle ? ' (½)' : ''}</td></tr>)}</tbody></table>
    </div>
  );
}
