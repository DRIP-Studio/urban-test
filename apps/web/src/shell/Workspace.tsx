import { ShortcutsSheet } from './Shortcuts';
import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { api } from '../api/client';
import { engine } from '../engine/engine';
import { MapView, captureThumbnail, getIndex } from '../map/MapView';
import { getMap, useMapUi } from '../map/mapStore';
import { AnalyzePanel } from '../panels/AnalyzePanel';
import { CivicPanel } from '../panels/CivicPanel';
import { ComparePanel } from '../panels/ComparePanel';
import { ExportSheet } from '../panels/ExportSheet';
import { Inspector } from '../panels/Inspector';
import { JunctionLab } from '../panels/JunctionLab';
import { SectionEditor } from '../panels/SectionEditor';
import { HistorySheet, LayersSheet, QASheet, SettingsSheet } from '../panels/Sheets';
import { ProfileStudio } from '../panels/ProfileStudio';
import { SignalStudio } from '../panels/SignalStudio';
import { TrafficStudio } from '../panels/TrafficStudio';
import { ConnectSheet } from '../panels/NetworkTools';
import { QuantitiesSheet } from '../panels/QuantitiesSheet';
import { NormsSheet } from '../panels/NormsSheet';
import { TransitPanel } from '../panels/TransitPanel';
import { PresentView } from '../present/PresentView';
import { setDock, useApp } from '../state/store';
import { toolById } from '../tools/registry';
import { Skeleton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/controls';
import { ContextMenu, StatusBar, ToolHint, ToolRail } from './Chrome';
import { installShortcuts } from './commands';
import { TopBar } from './TopBar';
import { EliosPanel } from '../elios/Elios';

const TwinView = lazy(() => import('../twin/TwinView'));

const BOTTOM: Record<string, { title: string; icon: string; render: () => ReactElement }> = {
  section: { title: 'Sezione stradale', icon: 'section', render: () => <SectionEditor /> },
  junction: { title: 'Junction Lab', icon: 'junction', render: () => <JunctionLab /> },
  signals: { title: 'Signal Studio', icon: 'signal', render: () => <SignalStudio /> },
  profile: { title: 'Profilo longitudinale e movimenti terra', icon: 'profile', render: () => <ProfileStudio /> },
};
const SHEETS: Record<string, { title: string; render: () => ReactElement }> = {
  layers: { title: 'Livelli', render: () => <LayersSheet /> },
  history: { title: 'Cronologia e versioni', render: () => <HistorySheet /> },
  export: { title: 'Esporta', render: () => <ExportSheet /> },
  settings: { title: 'Impostazioni', render: () => <SettingsSheet /> },
  qa: { title: 'Diagnostica', render: () => <QASheet /> },
  compare: { title: 'Confronto scenari', render: () => <ComparePanel /> },
  connect: { title: 'Aggancia strade', render: () => <ConnectSheet /> },
  quantities: { title: 'Computo metrico', render: () => <QuantitiesSheet /> },
  norms: { title: 'Normativa e verifiche', render: () => <NormsSheet /> },
};
const MODE_TITLE: Record<string, string> = { design: 'Progetta', analyze: 'Analizza', traffic: 'Traffico', transit: 'Trasporto pubblico', civic: 'Civico' };

function RightPanel() {
  const mode = useApp((s) => s.mode);
  const content = mode === 'design' ? <Inspector /> : mode === 'analyze' ? <AnalyzePanel /> : mode === 'traffic' ? <TrafficStudio /> : mode === 'transit' ? <TransitPanel /> : mode === 'civic' ? <CivicPanel /> : null;
  if (!content) return null;
  return (
    <aside className="inspector" aria-label={MODE_TITLE[mode]}>
      <div className="inspector-scroll">{content}</div>
    </aside>
  );
}

/** Captures a real map thumbnail once per project open, after the physical model is on screen. */
function useThumbnail(): void {
  const project = useApp((s) => s.project);
  useEffect(() => {
    if (!project) return;
    let done = false;
    const off = engine.onPhysical(() => {
      if (done) return;
      done = true;
      const map = getMap();
      if (!map) return;
      map.once('idle', () => {
        void captureThumbnail(map).then((b) => b && api.put(`/api/projects/${encodeURIComponent(project.id)}/thumbnail`, b)).catch(() => undefined);
      });
    });
    return off;
  }, [project]);
}

export function Workspace() {
  const project = useApp((s) => s.project);
  const network = useApp((s) => s.network);
  const loading = useApp((s) => s.loading);
  const loadError = useApp((s) => s.loadError);
  const mode = useApp((s) => s.mode);
  const dock = useApp((s) => s.dock);
  const catalogs = useApp((s) => s.catalogs);
  const focus = useMapUi((s) => s.focus);
  useThumbnail();
  useEffect(() => installShortcuts((e) => {
    const h = toolById(useApp.getState().tool).handler;
    const map = getMap();
    return map && h.key ? Boolean(h.key(e, { map, index: getIndex })) : false;
  }), []);
  if (loadError) return <div className="fullscreen-state"><Icon name="warning" size={28} /><h1>Progetto non aperto</h1><p>{loadError}</p><a className="btn btn-md btn-default" href="#/">Torna ai progetti</a></div>;
  if (!project || !network || !catalogs) return <div className="fullscreen-state"><span className="spinner lg" /><p>{loading ?? 'Caricamento'}</p></div>;
  const bottom = dock ? BOTTOM[dock] : undefined;
  const sheet = dock ? SHEETS[dock] : undefined;
  const map = mode !== 'twin' && mode !== 'present';
  return (
    <div className={`workspace mode-${mode} ${focus ? 'is-focus' : ''}`}>
      <TopBar />
      <div className="ws-body">
        {mode !== 'present' ? <ToolRail /> : null}
        <main className="ws-center">
          <div className="ws-stage">
            {map ? <MapView /> : null}
            {mode === 'twin' ? <Suspense fallback={<div className="fullscreen-state"><span className="spinner lg" /><p>Caricamento del Twin 3D</p></div>}><TwinView /></Suspense> : null}
            {mode === 'present' ? <PresentView /> : null}
            {map ? <ToolHint /> : null}
            {mode !== 'present' ? <EliosPanel /> : null}
          </div>
          {bottom && map ? (
            <section className="dock" aria-label={bottom.title}>
              <header className="dock-head"><Icon name={bottom.icon} size={16} /><strong>{bottom.title}</strong><span className="spacer" /><IconButton icon="close" label="Chiudi pannello" onClick={() => setDock(null)} /></header>
              <div className="dock-body">{bottom.render()}</div>
            </section>
          ) : null}
        </main>
        {map ? <RightPanel /> : null}
        {sheet ? (
          <aside className="sheet" aria-label={sheet.title}>
            <header className="sheet-head"><strong>{sheet.title}</strong><IconButton icon="close" label="Chiudi" onClick={() => setDock(null)} /></header>
            <div className="sheet-body"><Suspense fallback={<Skeleton />}>{sheet.render()}</Suspense></div>
          </aside>
        ) : null}
      </div>
      <StatusBar />
      <ContextMenu />
      <ShortcutsSheet />
    </div>
  );
}
