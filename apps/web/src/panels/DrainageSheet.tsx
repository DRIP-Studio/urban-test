import { COMMERCIAL_DN, DEFAULT_IDF_NOTE, MAX_FILL, MIN_VELOCITY, MAX_VELOCITY, PIPE_MATERIALS, sizeDrainage } from '@drip-urban/core';
import { flyTo } from '../map/mapStore';
import { runDrainage, useDrainage, catchmentSurfaces } from '../state/drainage';
import { commit, setTool, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { DRAIN_KINDS } from '../tools/drainage';
import { useTool } from '../tools/toolState';
import { Button, Empty, Field, NumberField, Section, Segmented, Select, Stat } from '../ui/controls';
import { Icon } from '../ui/Icon';

const f1 = (v: number, d = 1) => v.toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d });

/** Tool options (side panel while the Drenaggio tool is active). */
export function DrainageToolPanel() {
  const t = useTool();
  return (
    <Section title="Rete di drenaggio">
      <Field label="Nodo"><Segmented<'inlet' | 'manhole' | 'outfall'> label="Nodo" size="sm" value={t.drainKind} options={DRAIN_KINDS} onChange={(v) => useTool.setState({ drainKind: v })} /></Field>
      <div className="grid-2">
        <Field label="Profondità scorrimento"><NumberField value={t.drainDepthM} unit="m" min={0.4} max={8} step={0.1} decimals={1} ariaLabel="Profondità" onCommit={(v) => useTool.setState({ drainDepthM: v })} /></Field>
        <Field label="Condotta DN"><Select value={String(t.drainDn)} ariaLabel="DN" options={COMMERCIAL_DN.map((d) => ({ value: String(d), label: `DN ${d}` }))} onChange={(v) => useTool.setState({ drainDn: Number(v) })} /></Field>
      </div>
      <Field label="Materiale"><Select value={t.drainMaterial} ariaLabel="Materiale" options={PIPE_MATERIALS.map((m) => ({ value: m.id, label: `${m.label} · ks ${m.ks}` }))} onChange={(v) => useTool.setState({ drainMaterial: v })} /></Field>
      <p className="muted">Disegna da monte verso valle: ogni clic aggiunge un nodo e la condotta dal precedente, con pendenza minima 0,5% (quote dal DTM se caricato). Clic su un nodo esistente per confluire. Chiudi ogni ramo su uno scarico.</p>
    </Section>
  );
}

export function DrainageSheet() {
  const net = useApp((s) => s.network)!;
  const netVersion = useApp((s) => s.netVersion);
  const { idf, result, version } = useDrainage();
  const nodes = Object.values(net.drainageNodes ?? {}), pipes = Object.values(net.drainagePipes ?? {});
  const stale = result && version !== netVersion;
  const autosize = () => {
    const sizes = sizeDrainage(net, { idf, catchments: undefined });
    const ops = Object.entries(sizes).map(([id, dn]) => ({ type: 'drainage.update', payload: { kind: 'pipe', id, changes: { diameterMm: dn } } }));
    if (!ops.length) { toast.info('Dimensionamento', 'Tutte le condotte sono già adeguate'); runDrainage(); return; }
    if (commit('batch', { label: `Dimensiona ${ops.length} condotte`, ops }).ok) { runDrainage(); toast.success('Condotte dimensionate', `${ops.length} diametri aggiornati (h/D ≤ ${Math.round(MAX_FILL * 100)}%)`); }
  };
  if (!nodes.length) return (
    <Empty icon="wave" title="Nessuna rete di drenaggio" action={<Button variant="primary" icon="wave" onClick={() => setTool('drainage')}>Disegna la rete (C)</Button>}>
      Caditoie, pozzetti e collettori fino al recapito: verifica con il metodo razionale, curve di possibilità pluviometrica, Gauckler-Strickler a riempimento parziale e dimensionamento sui DN commerciali.
    </Empty>
  );
  const bad = result ? Object.values(result.pipes).filter((p) => !p.ok).length : 0;
  return (
    <>
      <Section title="Pioggia di progetto (curva di possibilità pluviometrica h = a·tⁿ)">
        <div className="grid-2">
          <Field label="a"><NumberField value={idf.a} unit="mm/hⁿ" min={5} max={150} step={1} decimals={1} ariaLabel="a" onCommit={(v) => useDrainage.setState({ idf: { ...idf, a: v } })} /></Field>
          <Field label="n"><NumberField value={idf.n} min={0.1} max={0.9} step={0.01} decimals={2} ariaLabel="n" onCommit={(v) => useDrainage.setState({ idf: { ...idf, n: v } })} /></Field>
        </div>
        <p className="muted">{DEFAULT_IDF_NOTE}</p>
        <div className="row">
          <Button variant="primary" icon="play" onClick={() => { const r = runDrainage(); if (r) toast.info('Verifica eseguita', `${Object.keys(r.pipes).length} condotte · ${catchmentSurfaces().length} superfici scolanti`); }}>{result ? (stale ? 'Aggiorna verifica' : 'Ricalcola') : 'Verifica la rete'}</Button>
          <Button icon="sparkle" onClick={autosize}>Dimensiona i diametri</Button>
          <Button icon="wave" onClick={() => setTool('drainage')}>Disegna</Button>
        </div>
      </Section>
      <Section title="Rete">
        <div className="stats-row">
          <Stat label="Caditoie" value={nodes.filter((n) => n.kind === 'inlet').length} />
          <Stat label="Pozzetti" value={nodes.filter((n) => n.kind === 'manhole').length} />
          <Stat label="Scarichi" value={nodes.filter((n) => n.kind === 'outfall').length} />
          <Stat label="Condotte" value={pipes.length} />
        </div>
        {result ? <p className={bad ? 'warn-line' : 'muted'}>{bad ? `${bad} condotte non verificate` : 'Tutte le condotte verificate'} · limiti: h/D ≤ {Math.round(MAX_FILL * 100)}%, {f1(MIN_VELOCITY)}–{f1(MAX_VELOCITY)} m/s</p> : null}
        {result?.issues.length ? <ul className="row-list">{result.issues.slice(0, 20).map((i, k) => <li key={k}><Icon name="warning" size={14} /><span className="grow">{i.message}</span></li>)}</ul> : null}
      </Section>
      {result ? (
        <Section title="Verifica delle condotte">
          <table className="table">
            <thead><tr><th>DN</th><th>L m</th><th>i %</th><th>Q l/s</th><th>h/D</th><th>v m/s</th><th>tc min</th></tr></thead>
            <tbody>{result.order.flatMap((nid) => pipes.filter((p) => p.from === nid)).map((p) => {
              const r = result.pipes[p.id];
              if (!r) return null;
              const a = net.drainageNodes?.[p.from];
              return (
                <tr key={p.id} className={`clickable ${r.ok ? '' : 'bad-row'}`} onClick={() => a && flyTo([a.at[0], a.at[1]], 19)} title={r.issues.map((i) => i.message).join(' · ')}>
                  <td>{p.diameterMm}</td><td className="num">{f1(r.lengthM)}</td><td className="num">{f1(r.slope * 100, 2)}</td><td className="num">{f1(r.q * 1000)}</td>
                  <td className={`num ${r.fill > MAX_FILL ? 'bad' : ''}`}>{Math.round(r.fill * 100)}%</td><td className={`num ${r.velocity < MIN_VELOCITY || r.velocity > MAX_VELOCITY ? 'bad' : ''}`}>{f1(r.velocity, 2)}</td><td className="num">{f1(r.tcMin)}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="muted">{result.method}</p>
        </Section>
      ) : null}
    </>
  );
}
