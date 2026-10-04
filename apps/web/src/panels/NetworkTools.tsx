import { useEffect, useMemo, useState } from 'react';
import { connectorOps, danglingLinks, linkOps, type DanglingLink } from '@drip-urban/core';
import { fc, type Feature } from '../engine/geojson';
import { flyTo, setSource } from '../map/mapStore';
import { commit, newId, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Empty, Field, NumberField, Section, Segmented, FieldGroup } from '../ui/controls';

function drawLinks(links: readonly DanglingLink[], net: NonNullable<ReturnType<typeof useApp.getState>['network']>): void {
  const feats: Feature[] = [];
  for (const l of links) {
    const from = net.nodes[l.nodeId]?.at;
    if (!from) continue;
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[...from], [...l.at]] }, properties: { kind: 'handle' } });
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [...l.at] }, properties: { snap: true, label: `${l.distM.toString().replace('.', ',')} m` } });
  }
  setSource('draft', fc(feats));
}

/** Connects roads drawn without snapping: only their loose end moves; the roads they meet are split in place. */
export function ConnectSheet() {
  const net = useApp((s) => s.network);
  const [tol, setTol] = useState(10);
  const [mode, setMode] = useState<'connector' | 'move'>('connector');
  const links = useMemo(() => (net ? danglingLinks(net, tol) : []), [net, tol]);
  useEffect(() => { if (net) drawLinks(links, net); return () => setSource('draft', null); }, [links, net]);
  if (!net) return null;
  const connect = (list: readonly DanglingLink[]) => {
    // Each link is applied on the network left by the previous ones: recompute targets as we go.
    let ok = 0;
    for (const l of list) {
      const current = danglingLinks(useApp.getState().network!, tol).find((x) => x.nodeId === l.nodeId);
      if (!current) continue;
      const res = commit('batch', { label: 'Aggancia strada', ops: mode === 'connector' ? connectorOps(useApp.getState().network!, current, { node: newId('n'), roads: [newId('r'), newId('r')], connector: newId('r') }) : linkOps(current, { node: newId('n'), roads: [newId('r'), newId('r')] }) }, { silent: true });
      if (res.ok) ok++;
    }
    if (ok) toast.success('Strade agganciate', `${ok} estremi collegati alla rete: il navigatore ora le percorre.`);
    else toast.warn('Nessun aggancio', 'Gli estremi trovati non possono essere collegati automaticamente.');
  };
  return (
    <>
      <Section title="Aggancia strade non collegate">
        <p className="muted">Estremi di strada a meno di {tol} m dalla rete ma non collegati: per il navigatore sono interrotti. Con il raccordo nessuna geometria esistente cambia: la strada di arrivo si divide esattamente sul suo asse e un breve tratto collega l'estremo libero. In alternativa si sposta solo l'estremo libero. Per collegare due strade a mano usa lo strumento Aggancia (E).</p>
        <FieldGroup label="Modalità"><Segmented<'connector' | 'move'> label="Modalità" size="sm" value={mode} onChange={setMode} options={[{ value: 'connector', label: 'Raccordo (geometrie invariate)' }, { value: 'move', label: 'Sposta l\'estremo' }]} /></FieldGroup>
        <Field label="Distanza massima"><NumberField value={tol} unit="m" min={1} max={60} step={1} decimals={0} ariaLabel="Distanza massima" onCommit={setTol} /></Field>
        {links.length ? <Button variant="project" icon="connect" onClick={() => connect(links)}>Aggancia tutte ({links.length})</Button> : null}
      </Section>
      {!links.length ? <Empty icon="check" title="Rete collegata">Nessun estremo libero vicino ad altre strade entro {tol} m.</Empty> : (
        <Section title="Estremi da collegare" count={links.length}>
          <ul className="row-list">
            {links.slice(0, 200).map((l) => (
              <li key={l.nodeId}>
                <span className="grow">{net.roads[l.roadId]?.name || 'Strada senza nome'} → {l.kind === 'node' ? 'incrocio' : net.roads[l.targetRoadId!]?.name || 'strada'} · {l.distM.toString().replace('.', ',')} m</span>
                <button type="button" className="chip chip-sm" onClick={() => flyTo([l.at[0], l.at[1]], 19)}>Vedi</button>
                <button type="button" className="chip chip-sm is-on" onClick={() => connect([l])}>Aggancia</button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
