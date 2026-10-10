import { LocalFrame } from '@drip-urban/core';
import { commit, openDock, useApp } from '../state/store';
import { Button, Field, NumberField, Section } from '../ui/controls';
import { applyTwinTransform, duplicateTwinSelection, selectedTwinAssets, transformedAssets } from './editing';

export function TwinInspector() {
  const selection = useApp((s) => s.selection), network = useApp((s) => s.network), baseline = useApp((s) => s.baseline);
  const assets = selectedTwinAssets(), first = assets[0];
  if (!selection || !network || !baseline || !first) return null;
  const frame = new LocalFrame(baseline.origin), p = frame.toMetric(first.at);
  const move = (axis: 'x' | 'y' | 'z' | 'rotation', target: number, previous: number) => applyTwinTransform(transformedAssets(assets, baseline.origin, axis, target - previous, true));
  const scaleAllowed = assets.every((a) => !a.type.startsWith('it.sign.') && !a.type.startsWith('signal.') && !a.type.startsWith('ztl.'));
  return <aside className="twin-inspector" aria-label="Inspector oggetti Twin">
    <Section title={`${assets.length === 1 ? first.type : `${assets.length} oggetti`} · Twin`}>
      <p className="muted">X est · Y nord · Z quota rispetto alla superficie. Trascina gli assi; Ctrl/clic aggiunge alla selezione. Alt sospende gli snap.</p>
      <div className="grid-2">
        <Field label="X · est"><NumberField value={p[0]} decimals={3} unit="m" ariaLabel="Twin X" onCommit={(v) => move('x', v, p[0])} /></Field>
        <Field label="Y · nord"><NumberField value={p[1]} decimals={3} unit="m" ariaLabel="Twin Y" onCommit={(v) => move('y', v, p[1])} /></Field>
        <Field label="Z · quota"><NumberField value={first.elevationM ?? 0} min={-1000} max={10000} decimals={3} unit="m" ariaLabel="Twin Z" onCommit={(v) => move('z', v, first.elevationM ?? 0)} /></Field>
        <Field label="Rotazione"><NumberField value={first.rotationDeg} min={0} max={360} decimals={2} unit="°" ariaLabel="Rotazione Twin" onCommit={(v) => move('rotation', v, first.rotationDeg)} /></Field>
        {scaleAllowed ? <Field label="Scala uniforme"><NumberField value={first.scale ?? 1} min={0.01} max={100} decimals={3} ariaLabel="Scala Twin" onCommit={(scale) => applyTwinTransform(assets.map((a) => ({ ...a, scale })), 'Scala oggetti Twin')} /></Field> : null}
      </div>
      {assets.length > 1 ? <div className="row"><Button size="sm" onClick={() => applyTwinTransform(assets.map((a) => ({ ...a, at: [first.at[0], a.at[1]] })), 'Allinea X nel Twin')}>Allinea X</Button><Button size="sm" onClick={() => applyTwinTransform(assets.map((a) => ({ ...a, at: [a.at[0], first.at[1]] })), 'Allinea Y nel Twin')}>Allinea Y</Button><Button size="sm" onClick={() => applyTwinTransform(assets.map((a) => ({ ...a, rotationDeg: first.rotationDeg })), 'Allinea rotazioni nel Twin')}>Allinea rotazioni</Button></div> : null}
      <Button size="sm" onClick={()=>openDock('modeling')}>Modellazione e push/pull</Button>
      <Button size="sm" onClick={() => openDock('materials')}>Materiali e texture</Button>
      <div className="row"><Button icon="duplicate" size="sm" onClick={duplicateTwinSelection}>Duplica</Button><Button icon="trash" size="sm" onClick={() => commit('asset.remove', { assetIds: assets.map((a) => a.id) })}>Elimina</Button></div>
    </Section>
  </aside>;
}
