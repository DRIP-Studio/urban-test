import { useEffect, useMemo, useRef, useState } from 'react';
import { NetworkReplayer } from '@drip-urban/core';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import type { FeatureCollection } from '../engine/geojson';
import { buildingsFC } from '../map/sources';
import { newId, setMode, useApp } from '../state/store';
import { toast } from '../state/toasts';
import { scenarioMetrics } from '../panels/ComparePanel';
import { CivicLockup, TechnicalLockup } from '../shell/Brand';
import { Button, Empty, Skeleton, TextField, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { BeforeAfter, type Camera } from './BeforeAfter';
import { setPendingTwinCamera, type TwinCamera } from '../twin/pending';

interface Scene { id: string; title: string; text: string; camera: Camera | null; twin?: TwinCamera }
interface PresentationDoc { scenes?: Scene[]; civic?: boolean }

export function PresentView() {
  const project = useApp((s) => s.project);
  const baseline = useApp((s) => s.baseline);
  const scenario = useApp((s) => s.scenario);
  const net = useApp((s) => s.network);
  const catalogs = useApp((s) => s.catalogs);
  const [before, setBefore] = useState<{ surfaces: FeatureCollection; markings: FeatureCollection } | null>(null);
  const [doc, setDoc] = useState<PresentationDoc>({});
  const [active, setActive] = useState<number>(-1);
  const camera = useRef<Camera | null>(null);
  const [goto, setGoto] = useState<Camera | null>(null);
  useEffect(() => { engine.job<{ surfaces: FeatureCollection; markings: FeatureCollection }>('physicalFor', { ops: [] }).then(setBefore); }, []);
  useEffect(() => {
    if (!project) return;
    api.get<PresentationDoc | null>(`/api/projects/${project.id}/docs/presentation`).then((d) => setDoc(d ?? {})).catch(() => setDoc({}));
  }, [project]);
  const buildings = useMemo(() => (baseline ? buildingsFC(baseline) : null), [baseline]);
  const after = engine.lastPhysical;
  const permeable = useMemo(() => new Set(catalogs?.materials.items.filter((m) => m.permeable).map((m) => m.id)), [catalogs]);
  const metrics = useMemo(() => {
    if (!baseline || !net) return null;
    return { a: scenarioMetrics(new NetworkReplayer().derive(baseline, []).net, baseline, permeable), b: scenarioMetrics(net, baseline, permeable) };
  }, [baseline, net, permeable]);
  const initial = useMemo(() => project?.bbox as [number, number, number, number], [project]);
  if (!project || !baseline || !catalogs) return null;
  const save = async (d: PresentationDoc) => {
    setDoc(d);
    try { await api.put(`/api/projects/${project.id}/docs/presentation`, d); } catch (e) { toast.error('Scene non salvate', e instanceof Error ? e.message : String(e)); }
  };
  const scenes = doc.scenes ?? [];
  const civic = !!doc.civic;
  const go = (i: number) => {
    const s = scenes[i];
    if (!s) return;
    setActive(i);
    if (s.twin) { setPendingTwinCamera(s.twin); setMode('twin'); return; }
    if (s.camera) setGoto({ ...s.camera });
  };
  const m = metrics;
  return (
    <div className={`present ${civic ? 'is-civic' : ''}`}>
      <aside className="present-rail">
        <div className="present-brand">{civic ? <CivicLockup /> : <TechnicalLockup city={project.city} />}</div>
        <h1 className={civic ? 'editorial' : ''}>{project.name}</h1>
        <p className="muted">{scenario?.isBaseline ? 'Stato attuale' : `Scenario: ${scenario?.name}`}</p>
        <Toggle label="Versione civica (identità FST)" checked={civic} onChange={(v) => void save({ ...doc, civic: v })} />
        <ol className="scenes">
          {scenes.map((s, i) => (
            <li key={s.id} className={i === active ? 'is-on' : ''}>
              <button type="button" className="scene-pick" onClick={() => go(i)}><span className="scene-n">{String(i + 1).padStart(2, '0')}</span><span>{s.title}</span>{s.twin ? <Icon name="cube" size={14} /> : null}</button>
              {i === active ? (
                <div className="scene-edit">
                  <TextField value={s.title} ariaLabel="Titolo scena" onCommit={(v) => void save({ ...doc, scenes: scenes.map((x) => (x.id === s.id ? { ...x, title: v } : x)) })} />
                  <TextField multiline value={s.text} ariaLabel="Testo scena" placeholder="Cosa deve vedere chi guarda" onCommit={(v) => void save({ ...doc, scenes: scenes.map((x) => (x.id === s.id ? { ...x, text: v } : x)) })} />
                  <div className="row-actions">
                    <button type="button" className="link" onClick={() => camera.current && void save({ ...doc, scenes: scenes.map((x) => (x.id === s.id ? { ...x, camera: camera.current } : x)) })}>Aggiorna inquadratura</button>
                    <button type="button" className="link danger" onClick={() => { setActive(-1); void save({ ...doc, scenes: scenes.filter((x) => x.id !== s.id) }); }}>Elimina</button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {!scenes.length ? <p className="muted">Inquadra la mappa e aggiungi una scena; dal Twin salvi anche viste 3D.</p> : null}
        <Button icon="plus" onClick={() => { const s: Scene = { id: newId('sc'), title: `Scena ${scenes.length + 1}`, text: '', camera: camera.current }; void save({ ...doc, scenes: [...scenes, s] }); setActive(scenes.length); }}>Aggiungi scena dall'inquadratura</Button>
        {scenes.length ? (
          <div className="present-nav">
            <Button icon="chevronLeft" disabled={active <= 0} onClick={() => go(active - 1)}>Precedente</Button>
            <Button icon="chevronRight" disabled={active >= scenes.length - 1} onClick={() => go(active + 1)}>Successiva</Button>
          </div>
        ) : null}
      </aside>
      <section className="present-stage">
        {before && after && buildings ? (
          <BeforeAfter editorial={civic} materials={catalogs.materials.items} initial={initial} camera={goto}
            before={{ surfaces: before.surfaces, markings: before.markings, buildings, label: 'Oggi' }}
            after={{ surfaces: after.surfaces, markings: after.markings, buildings, label: scenario?.isBaseline ? 'Oggi' : 'Progetto' }} />
        ) : <Skeleton lines={6} />}
        <CameraTracker onCamera={(c) => { camera.current = c; }} />
        {active >= 0 && scenes[active]?.text ? <div className={`scene-caption ${civic ? 'editorial' : ''}`}>{scenes[active]!.text}</div> : null}
        {m ? (
          <div className="present-metrics">
            {[
              { l: 'Strade modificate', a: 0, b: m.b.roadsChanged, u: '' },
              { l: 'Superfici drenanti', a: Math.round(m.a.greenM2), b: Math.round(m.b.greenM2), u: ' m²' },
              { l: 'Alberi', a: m.a.trees, b: m.b.trees, u: '' },
              { l: 'Sosta su strada', a: Math.round(m.a.parkingM2), b: Math.round(m.b.parkingM2), u: ' m²' },
              { l: 'Incroci semaforizzati', a: m.a.signals, b: m.b.signals, u: '' },
            ].map((x) => <div key={x.l} className="pm"><span>{x.l}</span><strong>{x.b.toLocaleString('it-IT')}{x.u}</strong><small>oggi {x.a.toLocaleString('it-IT')}{x.u}</small></div>)}
          </div>
        ) : null}
        {!after ? <Empty icon="present" title="Modello in calcolo" /> : null}
      </section>
    </div>
  );
}

/** Reads the camera of the "after" map through the DOM-independent event the BeforeAfter maps emit. */
function CameraTracker({ onCamera }: { onCamera: (c: Camera) => void }) {
  useEffect(() => {
    const h = (e: Event) => onCamera((e as CustomEvent<Camera>).detail);
    window.addEventListener('drip:ba-camera', h);
    return () => window.removeEventListener('drip:ba-camera', h);
  }, [onCamera]);
  return null;
}
