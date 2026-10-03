import { LocalFrame, geom, layoutSection, type Area, type Oneway, type Road } from '@drip-urban/core';
import { commit, setDock, setTool, useApp } from '../state/store';
import { deleteSelection, duplicateSelection } from '../state/actions';
import { flyTo } from '../map/mapStore';
import { Button, Empty, Field, NumberField, ProvBadge, Section, Segmented, Select, Stat, TextField, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { ToolSettings } from './ToolSettings';
import { RoundaboutInspector } from './RoundaboutPanel';
import { LanesSection, RestrictionsSection, ZoneInspector } from './RulesPanels';

const ROAD_CLASS: Record<string, string> = {
  trunk: 'Strada principale extraurbana', trunk_link: 'Rampa', primary: 'Primaria', secondary: 'Secondaria', tertiary: 'Interquartiere', residential: 'Locale',
  unclassified: 'Locale non classificata', service: 'Di servizio', living_street: 'Zona residenziale', pedestrian: 'Pedonale', footway: 'Marciapiede / percorso pedonale',
  cycleway: 'Ciclabile', path: 'Sentiero', track: 'Strada sterrata', roundabout: 'Anello di rotatoria', construction: 'In costruzione', steps: 'Scalinata',
};

function RoadInspector({ road }: { road: Road }) {
  const b = useApp((s) => s.baseline)!;
  const f = new LocalFrame(b.origin);
  const len = geom.lengthOf(road.axis.map((p) => f.toMetric(p) as geom.V));
  const lay = layoutSection(road);
  const width = lay.outerLeft - lay.outerRight;
  const prov = (k: string) => road.provenance[k]?.kind ?? road.provenance.geometry?.kind;
  return (
    <>
      <Section title="Strada">
        <Field label="Nome" prov={prov('name')}><TextField value={road.name} ariaLabel="Nome strada" onCommit={(v) => commit('road.update', { roadId: road.id, changes: { name: v } })} /></Field>
        <div className="grid-2">
          <Field label="Classe"><span className="readonly">{ROAD_CLASS[road.roadClass] ?? road.roadClass}</span></Field>
          <Field label="Velocità" prov={prov('speedKmh')}><NumberField value={road.speedKmh} unit="km/h" min={5} max={130} step={5} decimals={0} ariaLabel="Velocità" onCommit={(v) => commit('road.update', { roadId: road.id, changes: { speedKmh: v } })} /></Field>
        </div>
        <Field label="Senso di marcia" prov={prov('oneway')}>
          <Segmented<Oneway> label="Senso di marcia" value={road.oneway} onChange={(v) => commit('road.setOneway', { roadId: road.id, oneway: v })}
            options={[{ value: 'no', label: 'Doppio' }, { value: 'forward', label: 'Unico →' }, { value: 'backward', label: 'Unico ←' }]} />
        </Field>
        <div className="stats-row">
          <Stat label="Lunghezza" value={len.toFixed(1).replace('.', ',')} unit="m" prov={prov('geometry')} />
          <Stat label="Sezione" value={width.toFixed(2).replace('.', ',')} unit="m" prov={prov('width')} />
          <Stat label="Corsie" value={road.lanes.length} />
        </div>
      </Section>
      <Section title="Sezione e corsie" actions={<Button size="sm" icon="section" onClick={() => setDock('section')}>Editor</Button>}>
        <div className="mini-section" aria-label="Sezione trasversale">
          {lay.elements.map((e) => <span key={e.el.id} className={`ms ms-${e.el.kind}`} style={{ flexGrow: e.el.widthM }} title={`${e.el.kind} · ${e.el.widthM} m`} />)}
        </div>
      </Section>
      <LanesSection road={road} />
      <RestrictionsSection roads={[road]} />
      <Section title="Provenienza dei dati" defaultOpen={false}>
        <ul className="prov-list">
          {Object.entries(road.provenance).map(([k, p]) => <li key={k}><span>{k}</span><ProvBadge kind={p.kind} /><span className="muted">{p.source}</span></li>)}
        </ul>
        {road.tags && Object.keys(road.tags).length ? <details className="tags"><summary>Tag OSM</summary>{Object.entries(road.tags).map(([k, v]) => <div key={k} className="mono">{k}={v}</div>)}</details> : null}
      </Section>
      <div className="inspector-actions">
        <Button icon="node" onClick={() => setTool('nodes')}>Vertici</Button>
        <Button icon="cut" onClick={() => setTool('cut')}>Taglia</Button>
        <Button icon="trash" variant="danger" onClick={deleteSelection}>Elimina</Button>
      </div>
    </>
  );
}

function AssetInspector({ ids }: { ids: readonly string[] }) {
  const net = useApp((s) => s.network)!;
  const catalogs = useApp((s) => s.catalogs);
  const assets = ids.map((id) => net.assets[id]).filter(Boolean);
  if (!assets.length) return <Empty icon="info" title="Oggetto non più presente" />;
  const a = assets[0]!;
  const sign = catalogs?.signs.items.find((s) => s.id === a.type);
  const item = catalogs?.furniture.items.find((i) => i.id === a.type);
  const label = sign?.label ?? item?.label ?? a.type;
  if (assets.length > 1) {
    return (
      <Section title={`${assets.length} oggetti selezionati`}>
        <p className="muted">Sposta con le frecce (Shift = 1 m), ruota dal menu comandi, duplica con Ctrl+D.</p>
        <div className="inspector-actions"><Button icon="duplicate" onClick={() => duplicateSelection()}>Duplica</Button><Button icon="trash" variant="danger" onClick={deleteSelection}>Elimina</Button></div>
      </Section>
    );
  }
  return (
    <>
      <Section title={label}>
        <div className="asset-head">
          {sign ? <img src={`/signs/${encodeURIComponent(sign.file)}`} alt="" className="asset-thumb" /> : <Icon name={a.type.startsWith('signal') ? 'signal' : a.type.startsWith('vegetation') ? 'tree' : 'furniture'} size={28} />}
          <div><ProvBadge kind={a.state === 'existing' ? a.provenance.kind : a.state === 'removed' ? 'existing' : 'project'} /><span className="muted"> {a.state === 'removed' ? 'Rimosso nello scenario' : a.provenance.source}</span></div>
        </div>
        <div className="grid-2">
          <Field label="Rotazione"><NumberField value={a.rotationDeg} unit="°" min={-360} max={720} step={5} decimals={0} ariaLabel="Rotazione" onCommit={(v) => commit('asset.update', { assetId: a.id, changes: { rotationDeg: v } })} /></Field>
          <Field label="Quota"><NumberField value={a.elevationM ?? 0} unit="m" min={-5} max={50} step={0.1} ariaLabel="Quota" onCommit={(v) => commit('asset.update', { assetId: a.id, changes: { elevationM: v } })} /></Field>
        </div>
        {item ? (
          <div className="stats-row"><Stat label="Larghezza" value={item.dims.w.toString().replace('.', ',')} unit="m" /><Stat label="Profondità" value={item.dims.d.toString().replace('.', ',')} unit="m" /><Stat label="Altezza" value={item.dims.h.toString().replace('.', ',')} unit="m" /></div>
        ) : null}
        {item && catalogs ? (
          <Field label="Materiale">
            <Select value={a.material ?? item.material} ariaLabel="Materiale" onChange={(v) => commit('asset.update', { assetId: a.id, changes: { material: v } })}
              options={catalogs.materials.items.map((m) => ({ value: m.id, label: m.label }))} />
          </Field>
        ) : null}
        {a.properties.poleId ? <p className="muted">Pannello {(a.properties.stackOrder as number ?? 0) + 1} sul palo {String(a.properties.poleId).slice(-6)}</p> : null}
        <p className="mono muted">{a.at[1].toFixed(6)}, {a.at[0].toFixed(6)}</p>
      </Section>
      <div className="inspector-actions">
        <Button icon="crosshair" onClick={() => flyTo([a.at[0], a.at[1]], 19.5)}>Centra</Button>
        <Button icon="duplicate" onClick={() => duplicateSelection()}>Duplica</Button>
        <Button icon="trash" variant="danger" onClick={deleteSelection}>{a.state === 'existing' ? 'Rimuovi' : 'Elimina'}</Button>
      </div>
    </>
  );
}

const AREA_KINDS: { value: Area['kind']; label: string }[] = [
  { value: 'plaza', label: 'Piazza / pavimentazione' }, { value: 'green', label: 'Verde' }, { value: 'tree_pit', label: 'Aiuola alberata' }, { value: 'rain_garden', label: 'Giardino della pioggia' },
  { value: 'bioswale', label: 'Bioswale' }, { value: 'permeable', label: 'Pavimentazione drenante' }, { value: 'parking', label: 'Sosta' }, { value: 'median_green', label: 'Spartitraffico verde' },
  { value: 'playground', label: 'Area gioco' }, { value: 'hatch', label: 'Zebratura' }, { value: 'crossing', label: 'Attraversamento' },
];

function AreaInspector({ area }: { area: Area }) {
  const catalogs = useApp((s) => s.catalogs);
  const b = useApp((s) => s.baseline)!;
  const f = new LocalFrame(b.origin);
  const m = area.polygon.map((p) => f.toMetric(p) as geom.V);
  const set = (changes: Partial<Area>) => commit('area.set', { area: { ...area, ...changes } });
  return (
    <>
      <Section title={area.name ?? AREA_KINDS.find((k) => k.value === area.kind)?.label ?? 'Superficie'}>
        <Field label="Nome"><TextField value={area.name ?? ''} ariaLabel="Nome superficie" onCommit={(v) => set({ name: v })} /></Field>
        <Field label="Tipo"><Select value={area.kind} ariaLabel="Tipo" options={AREA_KINDS} onChange={(v) => set({ kind: v })} /></Field>
        {area.kind !== 'crossing' && catalogs ? <Field label="Materiale"><Select value={area.material} ariaLabel="Materiale" options={catalogs.materials.items.filter((x) => x.category !== 'object').map((x) => ({ value: x.id, label: x.label, hint: x.permeable ? 'drenante' : undefined }))} onChange={(v) => set({ material: v })} /></Field> : null}
        {area.kind === 'crossing' ? <Field label="Profondità strisce"><NumberField value={area.depthM ?? 4} unit="m" min={2} max={8} step={0.5} ariaLabel="Profondità" onCommit={(v) => set({ depthM: v })} /></Field> : null}
        <div className="stats-row">
          {area.kind === 'crossing' ? <Stat label="Lunghezza" value={geom.lengthOf(m).toFixed(1).replace('.', ',')} unit="m" /> : <Stat label="Superficie" value={Math.round(Math.abs(geom.ringArea(m))).toLocaleString('it-IT')} unit="m²" />}
          {area.kind !== 'crossing' ? <Stat label="Perimetro" value={geom.lengthOf([...m, m[0]!]).toFixed(1).replace('.', ',')} unit="m" /> : null}
          <Stat label="Drenante" value={catalogs?.materials.items.find((x) => x.id === area.material)?.permeable ? 'sì' : 'no'} />
        </div>
      </Section>
      <div className="inspector-actions"><Button icon="duplicate" onClick={() => duplicateSelection()}>Duplica</Button><Button icon="trash" variant="danger" onClick={deleteSelection}>Elimina</Button></div>
    </>
  );
}

function MultiRoadInspector({ ids }: { ids: readonly string[] }) {
  const net = useApp((s) => s.network)!;
  const roads = ids.map((id) => net.roads[id]).filter((r): r is Road => !!r);
  const speeds = [...new Set(roads.map((r) => r.speedKmh))];
  return (
    <>
      <Section title={`${roads.length} strade selezionate`}>
        <p className="muted">{[...new Set(roads.map((r) => r.name).filter(Boolean))].slice(0, 4).join(', ')}</p>
        <Field label="Velocità per tutte"><NumberField value={speeds.length === 1 ? speeds[0]! : Number.NaN} unit="km/h" min={5} max={130} step={5} decimals={0} ariaLabel="Velocità" onCommit={(v) => commit('batch', { label: `Limite ${v} km/h su ${roads.length} strade`, ops: roads.map((r) => ({ type: 'road.update', payload: { roadId: r.id, changes: { speedKmh: v } } })) })} /></Field>
      </Section>
      <RestrictionsSection roads={roads} />
      <div className="inspector-actions"><Button icon="trash" variant="danger" onClick={deleteSelection}>Elimina</Button></div>
    </>
  );
}

function NodeInspector({ nodeId }: { nodeId: string }) {
  const net = useApp((s) => s.network)!;
  const node = net.nodes[nodeId];
  const roads = Object.values(net.roads).filter((r) => r.from === nodeId || r.to === nodeId);
  const spec = net.junctions[nodeId];
  return (
    <>
      <Section title={[...new Set(roads.map((r) => r.name).filter(Boolean))].slice(0, 3).join(' × ') || 'Incrocio'}>
        <div className="stats-row"><Stat label="Bracci" value={roads.length} /><Stat label="Regolazione" value={spec ? { uncontrolled: 'Libera', priority: 'Precedenza', stop: 'Stop', signal: 'Semaforo', roundabout: 'Rotatoria' }[spec.control] : 'Non definita'} /></div>
        {node ? <p className="mono muted">{node.at[1].toFixed(6)}, {node.at[0].toFixed(6)}</p> : null}
      </Section>
      <div className="inspector-actions column">
        <Button icon="junction" variant="primary" onClick={() => setDock('junction')}>Junction Lab</Button>
        <Button icon="signal" onClick={() => setDock('signals')}>Signal Studio</Button>
        <Button icon="roundabout" onClick={() => setTool('roundabout')}>Rotatoria</Button>
      </div>
    </>
  );
}

export function Inspector() {
  const sel = useApp((s) => s.selection);
  const net = useApp((s) => s.network);
  useApp((s) => s.netVersion);
  const tool = useApp((s) => s.tool);
  if (!net) return null;
  // Placement tools that work on a picked junction keep their own panel while active.
  if (!sel || tool === 'roundabout') return <ToolSettings />;
  const id = sel.ids[0]!;
  if (sel.kind === 'road' && net.roads[id]) return sel.ids.length > 1 ? <MultiRoadInspector ids={sel.ids} /> : <RoadInspector road={net.roads[id]!} />;
  if (sel.kind === 'asset') return <AssetInspector ids={sel.ids} />;
  if (sel.kind === 'area' && net.areas[id]) return <AreaInspector area={net.areas[id]!} />;
  if (sel.kind === 'zone' && net.zones[id]) return <ZoneInspector zone={net.zones[id]!} />;
  if (sel.kind === 'roundabout' && net.roundabouts[id]) return <RoundaboutInspector rb={net.roundabouts[id]!} />;
  if (sel.kind === 'node') return <NodeInspector nodeId={id} />;
  return <Empty icon="info" title="Elemento non più presente" >È stato modificato o rimosso da un'operazione successiva.</Empty>;
}
