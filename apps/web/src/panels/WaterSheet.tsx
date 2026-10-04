import { FIRE_MIN_M, P_MAX_M, P_MIN_M, V_MAX, V_MIN, WATER_DN, WATER_MATERIALS, fireFlowCheck, sizeWaterPipes } from '@drip-urban/core';
import { flyTo } from '../map/mapStore';
import { commit, setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { runWater, useWater } from '../state/water';
import { WATER_KINDS } from '../tools/water';
import { useTool } from '../tools/toolState';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Stat, FieldGroup } from '../ui/controls';
import { Icon } from '../ui/Icon';

const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');

export function WaterToolPanel() {
  const t = useTool();
  return (
    <Section title="Rete acquedotto">
      <FieldGroup label="Elemento"><Segmented label="Elemento" size="sm" value={t.waterKind} options={WATER_KINDS} onChange={(v) => useTool.setState({ waterKind: v })} /></FieldGroup>
      <div className="grid-2">
        <Field label="Condotta DN"><Select value={String(t.waterDn)} ariaLabel="DN" options={WATER_DN.map((d) => ({ value: String(d), label: `DN ${d}` }))} onChange={(v) => useTool.setState({ waterDn: Number(v) })} /></Field>
        <Field label="Materiale"><Select value={t.waterMaterial} ariaLabel="Materiale" options={WATER_MATERIALS.map((m) => ({ value: m.id, label: `${m.label} · C ${m.c}` }))} onChange={(v) => useTool.setState({ waterMaterial: v })} /></Field>
        <Field label="Domanda per nodo"><NumberField value={t.waterDemandLs} unit="l/s" min={0} max={100} step={0.1} decimals={2} ariaLabel="Domanda" onCommit={(v) => useTool.setState({ waterDemandLs: v })} /></Field>
        <Field label="Carico serbatoio"><NumberField value={t.waterHeadM} unit="m sul suolo" min={5} max={150} step={1} decimals={0} ariaLabel="Carico" onCommit={(v) => useTool.setState({ waterHeadM: v })} /></Field>
      </div>
      <p className="muted">Inizia dal serbatoio o dal punto di consegna, poi nodi e idranti. Le reti a maglie sono ammesse: clicca un nodo esistente per chiudere l'anello.</p>
    </Section>
  );
}

export function WaterSheet() {
  const net = useApp((s) => s.network)!;
  const { result, demandFactor } = useWater();
  const nodes = Object.values(net.waterNodes ?? {}), pipes = Object.values(net.waterPipes ?? {});
  if (!nodes.length) return (
    <Empty icon="drop" title="Nessuna rete acquedotto" action={<Button variant="primary" icon="drop" onClick={() => setTool('water')}>Disegna la rete (Q)</Button>}>
      Serbatoi, condotte, nodi di utenza e idranti: calcolo delle pressioni a gradiente globale con Hazen–Williams, verifica antincendio e dimensionamento dei diametri.
    </Empty>
  );
  const size = () => {
    const s = sizeWaterPipes(net);
    const ops = Object.entries(s).map(([id, dn]) => ({ type: 'water.update', payload: { kind: 'pipe', id, changes: { diameterMm: dn } } }));
    if (!ops.length) { toast.info('Diametri', 'Già adeguati (v ≤ 1,5 m/s)'); return; }
    if (commit('batch', { label: `Dimensiona ${ops.length} condotte acquedotto`, ops }).ok) { runWater(); toast.success('Diametri aggiornati', `${ops.length} condotte`); }
  };
  const hydrants = nodes.filter((n) => n.kind === 'hydrant');
  const bad = result ? result.issues.filter((i) => i.severity === 'error').length : 0;
  return (
    <>
      <Section title="Calcolo idraulico">
        <div className="grid-2">
          <Field label="Coefficiente di punta"><NumberField value={demandFactor} min={0.2} max={5} step={0.1} decimals={1} ariaLabel="Coefficiente di punta" onCommit={(v) => { useWater.setState({ demandFactor: v }); if (result) runWater(); }} /></Field>
        </div>
        <div className="row">
          <Button variant="primary" icon="play" onClick={() => { const r = runWater(); if (r) toast.info('Calcolo eseguito', r.method); }}>{result ? 'Ricalcola' : 'Calcola pressioni'}</Button>
          <Button icon="sparkle" onClick={size}>Dimensiona i diametri</Button>
          <Button icon="drop" onClick={() => setTool('water')}>Disegna</Button>
        </div>
        <p className="muted">Verifiche: pressione {P_MIN_M}–{P_MAX_M} m ai nodi con utenza, velocità {f1(V_MIN)}–{f1(V_MAX)} m/s, idranti con ≥ {FIRE_MIN_M} m residui a 10 l/s (UNI 10779).</p>
      </Section>
      <Section title="Rete">
        <div className="stats-row">
          <Stat label="Nodi" value={nodes.length} />
          <Stat label="Condotte" value={pipes.length} />
          <Stat label="Idranti" value={hydrants.length} />
          <Stat label="Domanda" value={f1(nodes.reduce((s, n) => s + (n.demandLs ?? 0), 0) * demandFactor)} unit="l/s" />
        </div>
        {result ? <p className={bad ? 'warn-line' : 'muted'}>{result.converged ? (bad ? `${bad} problemi da risolvere` : 'Rete verificata') : 'Calcolo non convergente'}</p> : null}
        {result?.issues.length ? <ul className="row-list">{result.issues.slice(0, 30).map((i, k) => <li key={k} className={i.severity === 'error' ? 'hint-warn' : ''}><Icon name="warning" size={14} /><span className="wrap">{i.message}</span></li>)}</ul> : null}
      </Section>
      {result ? (
        <Section title="Nodi">
          <table className="table">
            <thead><tr><th>Nodo</th><th>Quota</th><th>Carico</th><th>Pressione</th><th>Domanda</th></tr></thead>
            <tbody>{nodes.map((n) => { const r = result.nodes[n.id]!; return (
              <tr key={n.id} className="clickable" onClick={() => flyTo([n.at[0], n.at[1]], 19)}>
                <td>{WATER_KINDS.find((k) => k.value === n.kind)?.label ?? n.kind}</td><td className="num">{f1(n.elevation)}</td><td className="num">{f1(r.headM)}</td>
                <td className={`num ${r.pressureM < P_MIN_M && r.demandLs > 0 ? 'bad' : ''}`}>{f1(r.pressureM)} m · {f1(r.pressureBar)} bar</td><td className="num">{f1(r.demandLs, 2)}</td>
              </tr>); })}</tbody>
          </table>
        </Section>
      ) : null}
      {result ? (
        <Section title="Condotte">
          <table className="table">
            <thead><tr><th>DN</th><th>L m</th><th>Q l/s</th><th>v m/s</th><th>J m/km</th></tr></thead>
            <tbody>{pipes.map((p) => { const r = result.pipes[p.id]!; return (
              <tr key={p.id} className={r.velocity > V_MAX ? 'bad-row' : ''}><td>{p.diameterMm}{p.status === 'closed' ? ' (chiusa)' : ''}</td><td className="num">{f1(r.lengthM)}</td><td className="num">{f1(r.flowLs, 2)}</td><td className="num">{f1(r.velocity, 2)}</td><td className="num">{f1(r.headlossMKm, 1)}</td></tr>); })}</tbody>
          </table>
        </Section>
      ) : null}
      {hydrants.length ? (
        <Section title="Prova antincendio">
          <ul className="row-list">{hydrants.map((h) => (
            <li key={h.id}><span className="grow">Idrante {h.name ?? h.id.slice(-4)}</span>
              <button type="button" className="chip chip-sm" onClick={() => { const r = fireFlowCheck(net, h.id, 10); toast[r.ok ? 'success' : 'warn']('Prova antincendio 10 l/s', `Pressione residua ${f1(r.residualM)} m (minimo ${FIRE_MIN_M} m) · minima in rete ${f1(r.minPressureM)} m`); }}>Verifica 10 l/s</button>
            </li>
          ))}</ul>
        </Section>
      ) : null}
    </>
  );
}
