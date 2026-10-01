import { useEffect, useMemo, useRef, useState } from 'react';
import { LocalFrame, type SignalPhase, type SignalPlan } from '@drip-urban/core';
import { setSignalPreview } from '../map/signalsLive';
import { commit, newId, useApp } from '../state/store';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Skeleton } from '../ui/controls';
import { drawJunction, useJunctionAnalysis } from './JunctionLab';

const COLORS = ['#83b4d1', '#e8772e', '#c98bb0', '#6fae86', '#d9a441', '#7e8fa3'];

export function SignalStudio() {
  const { nodeId, data, loading, error } = useJunctionAnalysis();
  const net = useApp((s) => s.network);
  const existing = net && nodeId ? Object.values(net.signalPlans).find((p) => p.nodeId === nodeId) : undefined;
  const [plan, setPlan] = useState<SignalPlan | null>(null);
  const [t, setT] = useState(0);
  const timeline = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; key: 'greenS'; startX: number; start: number; pxPerS: number } | null>(null);
  useEffect(() => { setPlan(existing ?? data?.suggested ?? null); }, [existing, data]);
  useEffect(() => { drawJunction(data?.analysis ?? null); return () => drawJunction(null); }, [data]);
  // Live preview of the plan being edited at time t (heads appear once the plan is applied).
  useEffect(() => { setSignalPreview(plan ? { plan, t } : null); return () => setSignalPreview(null); }, [plan, t]);
  const bad = useMemo(() => new Set((data?.analysis.incompatible ?? []).map(([a, b]) => `${a}|${b}`)), [data]);
  if (!nodeId) return <Empty icon="signal" title="Seleziona un incrocio">Usa lo strumento Semafori (T) e clicca su un incrocio.</Empty>;
  if (loading && !data) return <Skeleton lines={5} />;
  if (error || !data || !plan) return <Empty icon="warning" title="Signal Studio non disponibile">{error ?? 'Nessun gruppo di corsie in ingresso.'}</Empty>;
  const a = data.analysis;
  const total = plan.phases.reduce((s, p) => s + p.greenS + p.yellowS + p.allRedS, 0);
  const conflictsIn = (p: SignalPhase) => p.greenGroups.flatMap((x) => p.greenGroups.filter((y) => x < y && bad.has([x, y].sort().join('|'))).map((y) => `${x}×${y}`));
  const errors = [...plan.phases.flatMap((p) => conflictsIn(p).map((c) => `${p.name}: verdi in conflitto ${c}`)), ...(Math.abs(total - plan.cycleS) > 0.5 ? [`Somma fasi ${total} s ≠ ciclo ${plan.cycleS} s`] : []), ...a.groups.filter((g) => !plan.phases.some((p) => p.greenGroups.includes(g.id))).map((g) => `${g.id} senza verde`)];
  const setPhase = (i: number, p: Partial<SignalPhase>) => setPlan({ ...plan, phases: plan.phases.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const fitCycle = () => setPlan({ ...plan, cycleS: total });
  const save = () => commit('signal.setPlan', { plan: { ...plan, id: plan.id || `plan:${nodeId}` }, conflicts: a.incompatible });
  const pxPerS = (timeline.current?.getBoundingClientRect().width ?? 600) / Math.max(total, 1);
  return (
    <div className="signal-studio">
      <div className="ss-head">
        <div className="ss-params">
          <Field label="Logica"><Segmented<SignalPlan['mode']> label="Logica" value={plan.mode} onChange={(v) => setPlan({ ...plan, mode: v, ...(v === 'actuated' || v === 'adaptive' ? { actuation: plan.actuation ?? { minGreenS: 8, maxGreenS: 45, gapOutS: 3, extensionS: 2.5 } } : {}) })}
            options={[{ value: 'fixed_time', label: 'Tempo fisso' }, { value: 'actuated', label: 'Attuato' }, { value: 'adaptive', label: 'Adattivo' }, { value: 'green_wave', label: 'Onda verde' }]} /></Field>
          <Field label="Ciclo"><NumberField value={plan.cycleS} unit="s" min={30} max={180} step={1} decimals={0} ariaLabel="Ciclo" onCommit={(v) => setPlan({ ...plan, cycleS: v })} /></Field>
          <Field label="Offset"><NumberField value={plan.offsetS} unit="s" min={0} max={plan.cycleS} step={1} decimals={0} ariaLabel="Offset" onCommit={(v) => setPlan({ ...plan, offsetS: v })} /></Field>
        </div>
        <div className="ss-actions">
          {Math.abs(total - plan.cycleS) > 0.5 ? <Button size="sm" onClick={fitCycle}>Ciclo = somma fasi ({total} s)</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => setPlan(data.suggested)}>Proposta automatica</Button>
          {existing ? <Button size="sm" variant="danger" onClick={() => commit('signal.removePlan', { planId: existing.id })}>Rimuovi piano</Button> : null}
          <Button variant="project" icon="check" disabled={errors.length > 0} onClick={save}>{existing ? 'Aggiorna piano' : 'Applica piano'}</Button>
        </div>
      </div>
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
              <span className="ss-drag" aria-label={`Durata verde ${p.name}`} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { i, key: 'greenS', startX: e.clientX, start: p.greenS, pxPerS }; }} />
            </div>
          </div>
        ))}
        <span className="ss-cursor" style={{ left: `${(t / Math.max(total, 1)) * 100}%` }} />
      </div>
      <div className="ss-groups">
        <table className="table">
          <thead><tr><th>Gruppo</th>{a.groups.map((g) => <th key={g.id} title={g.label}>{g.id}</th>)}<th>Pedoni</th><th>Verde</th><th>Giallo</th><th>Tutto rosso</th><th /></tr></thead>
          <tbody>
            {plan.phases.map((p, i) => (
              <tr key={p.id}>
                <td><span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />{p.name}</td>
                {a.groups.map((g) => {
                  const on = p.greenGroups.includes(g.id);
                  const blocked = !on && p.greenGroups.some((x) => bad.has([x, g.id].sort().join('|')));
                  return (
                    <td key={g.id}>
                      <button type="button" className={`cell ${on ? 'is-on' : ''} ${blocked ? 'is-blocked' : ''}`} title={blocked ? 'In conflitto con un gruppo già verde in questa fase' : g.label} disabled={blocked}
                        onClick={() => setPhase(i, { greenGroups: on ? p.greenGroups.filter((x) => x !== g.id) : [...p.greenGroups, g.id] })} aria-pressed={on} aria-label={`${p.name} ${g.label}`}>{on ? 'V' : blocked ? '×' : ''}</button>
                    </td>
                  );
                })}
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
          {errors.length ? <ul className="issue-list">{errors.map((e) => <li key={e} className="is-error">{e}</li>)}</ul> : <span className="ok">Piano valido: nessun verde in conflitto. Semafori pedonali a 3 luci (rosso/giallo/verde).</span>}
        </div>
      </div>
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
      {plan.mode === 'green_wave' ? <GreenWave plan={plan} onOffset={(o) => setPlan({ ...plan, offsetS: o })} /> : null}
    </div>
  );
}

function GreenWave({ plan, onOffset }: { plan: SignalPlan; onOffset: (o: number) => void }) {
  const net = useApp((s) => s.network)!;
  const baseline = useApp((s) => s.baseline)!;
  const others = Object.values(net.signalPlans).filter((p) => p.nodeId !== plan.nodeId);
  const [ref, setRef] = useState<string | null>(others[0]?.id ?? null);
  const [speed, setSpeed] = useState(40);
  const refPlan = others.find((p) => p.id === ref);
  if (!others.length) return <Section title="Onda verde"><p className="muted">Serve almeno un altro incrocio semaforizzato nello scenario come riferimento a monte.</p></Section>;
  const f = new LocalFrame(baseline.origin);
  const a = f.toMetric(net.nodes[plan.nodeId]!.at), b = refPlan ? f.toMetric(net.nodes[refPlan.nodeId]!.at) : a;
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const travel = d / (speed / 3.6);
  const offset = refPlan ? Math.round((refPlan.offsetS + travel) % plan.cycleS) : 0;
  const H = 120, W = 420;
  return (
    <Section title="Onda verde">
      <div className="grid-2">
        <Field label="Incrocio a monte"><Select value={ref} ariaLabel="Riferimento" options={others.map((p) => ({ value: p.id, label: p.name + ' · ' + p.nodeId.slice(-6) }))} onChange={setRef} /></Field>
        <Field label="Velocità di progetto"><NumberField value={speed} unit="km/h" min={20} max={70} step={5} decimals={0} ariaLabel="Velocità" onCommit={setSpeed} /></Field>
      </div>
      <p>Distanza {d.toFixed(0)} m · tempo di percorrenza {travel.toFixed(1)} s → offset consigliato <strong className="mono">{offset} s</strong></p>
      {refPlan ? (
        <svg className="time-space" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Diagramma spazio-tempo">
          <text x="4" y="14">{refPlan.name} (monte)</text><text x="4" y={H - 6}>{plan.name}</text>
          {[0, 1, 2].map((k) => {
            const g = refPlan.phases[0]!.greenS, c = plan.cycleS, sx = W / (c * 3);
            const t0 = (refPlan.offsetS + k * c) * sx;
            return <g key={k}><rect x={t0} y={20} width={g * sx} height={6} fill="#3fc06a" /><rect x={(offset + k * c) * sx} y={H - 30} width={plan.phases[0]!.greenS * sx} height={6} fill="#3fc06a" />
              <line x1={t0} y1={26} x2={t0 + travel * sx} y2={H - 30} stroke="#83b4d1" strokeDasharray="3 2" /></g>;
          })}
        </svg>
      ) : null}
      <Button size="sm" onClick={() => onOffset(offset)}>Usa offset {offset} s</Button>
    </Section>
  );
}
