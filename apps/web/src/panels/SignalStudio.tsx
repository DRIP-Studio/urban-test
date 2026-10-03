import { useEffect, useMemo, useRef, useState } from 'react';
import { LocalFrame, activeTurns, planIssues, type CoordinationResult, type JunctionAnalysis, type LaneGroup, type SignalPhase, type SignalPlan, type TurnKind } from '@drip-urban/core';
import { engine } from '../engine/engine';
import { setSignalPreview } from '../map/signalsLive';
import { commit, newId, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, Section, Segmented, Skeleton, Toggle } from '../ui/controls';
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
          <Field label="Logica"><Segmented<SignalPlan['mode']> label="Logica" value={plan.mode} onChange={(v) => setPlan({ ...plan, mode: v, ...(v === 'actuated' || v === 'adaptive' ? { actuation: plan.actuation ?? { minGreenS: 8, maxGreenS: 45, gapOutS: 3, extensionS: 2.5 } } : {}) })}
            options={[{ value: 'fixed_time', label: 'Tempo fisso' }, { value: 'actuated', label: 'Attuato' }, { value: 'adaptive', label: 'Adattivo' }, { value: 'green_wave', label: 'Onda verde' }]} /></Field>
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

/** Links this junction with other signalised junctions: common cycle and offsets for a green wave. */
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
  const [chosen, setChosen] = useState<string[]>(() => corridor.filter((p) => p.id !== plan.id).map((p) => p.id));
  const [speed, setSpeed] = useState(plan.coordination?.speedKmh ?? 40);
  const [direction, setDirection] = useState<'oneway' | 'twoway'>(plan.coordination?.direction ?? 'oneway');
  const [cycle, setCycle] = useState(plan.cycleS);
  const [result, setResult] = useState<(CoordinationResult & { order: string[] }) | null>(null);
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
  const compute = async () => {
    const order = ordered();
    const r = await engine.job<CoordinationResult>('coordinate', { planIds: order, speedKmh: speed, cycleS: cycle, direction });
    setResult({ ...r, order });
  };
  const apply = () => {
    if (!result) return;
    const id = plan.coordination?.id ?? newId('coord');
    const name = `Onda verde ${net.roads[Object.values(net.roads).find((r) => r.from === plan.nodeId || r.to === plan.nodeId)?.id ?? '']?.name ?? ''}`.trim();
    const ok = commit('signal.coordinate', { coordination: { id, name, speedKmh: speed, direction }, cycleS: cycle, plans: result.offsets.map((o) => ({ planId: o.planId, offsetS: o.offsetS })) });
    if (ok.ok) toast.success('Incroci collegati', `${result.offsets.length} semafori · ciclo ${cycle} s · banda ${result.bandwidthS} s`);
  };
  return (
    <Section title="Coordinamento con altri incroci (onda verde)" count={corridor.length || undefined}>
      {corridor.length ? (
        <div className="row"><span className="plan-chip">{plan.coordination!.name}</span><span className="muted">{corridor.length} incroci · {plan.coordination!.speedKmh} km/h · {plan.coordination!.direction === 'twoway' ? 'doppio senso' : 'senso principale'}</span>
          <Button size="sm" variant="ghost" onClick={() => commit('signal.uncoordinate', { coordinationId: plan.coordination!.id })}>Scollega</Button></div>
      ) : null}
      {!others.length ? <p className="muted">Nessun altro incrocio semaforizzato nello scenario.</p> : (
        <>
          <ul className="row-list">
            {others.slice(0, 12).map((o) => (
              <li key={o.plan.id}>
                <input type="checkbox" checked={chosen.includes(o.plan.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, o.plan.id] : chosen.filter((x) => x !== o.plan.id))} aria-label={`Collega ${o.plan.name}`} />
                <span className="grow">{o.plan.name} · {o.plan.nodeId.slice(-6)} · {Math.round(o.d)} m · ciclo {o.plan.cycleS} s{o.plan.coordination ? ` · già in «${o.plan.coordination.name}»` : ''}</span>
              </li>
            ))}
          </ul>
          <div className="grid-3">
            <Field label="Velocità di progetto"><NumberField value={speed} unit="km/h" min={10} max={90} step={5} decimals={0} ariaLabel="Velocità" onCommit={setSpeed} /></Field>
            <Field label="Ciclo comune"><NumberField value={cycle} unit="s" min={30} max={180} step={1} decimals={0} ariaLabel="Ciclo comune" onCommit={setCycle} /></Field>
            <Field label="Direzione"><Segmented<'oneway' | 'twoway'> label="Direzione" value={direction} onChange={setDirection} options={[{ value: 'oneway', label: 'Un senso' }, { value: 'twoway', label: 'Due sensi' }]} /></Field>
          </div>
          <div className="row">
            <Button size="sm" disabled={!chosen.length} onClick={() => void compute()}>Calcola offset</Button>
            <Button size="sm" variant="project" icon="link" disabled={!result} onClick={apply}>Collega incroci</Button>
          </div>
          {result ? <CorridorDiagram result={result} /> : null}
        </>
      )}
    </Section>
  );
}

function CorridorDiagram({ result }: { result: CoordinationResult & { order: string[] } }) {
  const net = useApp((s) => s.network)!;
  const W = 460, H = 34 + result.offsets.length * 34, C = result.cycleS, sx = W / (C * 2.5);
  const maxD = result.offsets.reduce((t, o) => t + o.distanceM, 0) || 1;
  let cum = 0;
  const rows = result.offsets.map((o) => { cum += o.distanceM; return { ...o, y: 20 + (cum / maxD) * (H - 40) }; });
  return (
    <>
      <table className="table"><thead><tr><th>Incrocio</th><th>Distanza</th><th>Percorrenza</th><th>Offset</th></tr></thead>
        <tbody>{result.offsets.map((o) => <tr key={o.planId}><td>{net.signalPlans[o.planId]?.name} · {net.signalPlans[o.planId]?.nodeId.slice(-6)}</td><td className="mono">{o.distanceM} m</td><td className="mono">{o.travelS} s</td><td className="mono">{o.offsetS} s</td></tr>)}</tbody></table>
      <p>Banda verde: <strong className="mono">{result.bandwidthS} s</strong>{result.bandwidthBackS !== null ? <> in andata, <strong className="mono">{result.bandwidthBackS} s</strong> al ritorno</> : null}</p>
      <svg className="time-space" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Diagramma spazio-tempo del corridoio">
        {rows.map((r) => {
          const p = net.signalPlans[r.planId];
          const g = p?.phases[0]?.greenS ?? 0;
          return <g key={r.planId}>{[0, 1, 2].map((k) => <rect key={k} x={(r.offsetS + k * C) * sx} y={r.y - 3} width={g * sx} height={6} fill="#3fc06a" />)}<line x1={0} y1={r.y} x2={W} y2={r.y} stroke="currentColor" strokeOpacity={0.15} /></g>;
        })}
        {[0, 1].map((k) => <polyline key={k} fill="none" stroke="#83b4d1" strokeDasharray="3 2" points={rows.map((r) => `${(rows[0]!.offsetS + r.travelS + k * C) * sx},${r.y}`).join(' ')} />)}
      </svg>
    </>
  );
}
