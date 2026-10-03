import { importExistingSidewalks } from '../state/existingState';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { setTool, useApp, setDock } from '../state/store';
import { Section, Stat } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SidewalkOverview } from './RulesPanels';

interface MigrationDoc { from: string; report: { level: string; what: string; reason: string }[] }

export function ProjectSummary() {
  const project = useApp((s) => s.project);
  const scenario = useApp((s) => s.scenario);
  const net = useApp((s) => s.network);
  const failed = useApp((s) => s.failedOps);
  const [migration, setMigration] = useState<MigrationDoc | null>(null);
  useEffect(() => {
    if (!project) return;
    api.get<MigrationDoc | null>(`/api/projects/${encodeURIComponent(project.id)}/docs/migration`).then(setMigration).catch(() => setMigration(null));
  }, [project]);
  if (!project || !net || !scenario) return null;
  const projRoads = Object.values(net.roads).filter((r) => Object.values(r.provenance).some((p) => p.kind === 'project')).length;
  const projAssets = Object.values(net.assets).filter((a) => a.state === 'project').length;
  const issues = migration?.report.filter((r) => r.level !== 'info') ?? [];
  return (
    <>
      <Section title={scenario.isBaseline ? 'Stato attuale' : scenario.name}>
        {scenario.isBaseline ? <p className="muted">La baseline è la città com'è oggi e non si modifica. Crea o scegli uno scenario dal menu in alto per progettare.</p> : null}
        <div className="stats-row">
          <Stat label="Modifiche" value={scenario.operations.length} prov="project" />
          <Stat label="Strade toccate" value={projRoads} />
          <Stat label="Oggetti nuovi" value={projAssets} />
        </div>
        <div className="stats-row">
          <Stat label="Rotatorie" value={Object.keys(net.roundabouts).length} />
          <Stat label="Piani semaforici" value={Object.keys(net.signalPlans).length} />
          <Stat label="Zone" value={Object.keys(net.zones).length} />
        </div>
      </Section>
      {failed.length ? (
        <Section title="Operazioni non applicabili" count={failed.length}>
          <ul className="issue-list">{failed.map((f) => <li key={f.opId} className="is-error"><Icon name="warning" size={14} /><span><strong>{f.type}</strong> {f.messages.join(' · ')}</span></li>)}</ul>
          <p className="muted">Restano nello scenario: non vengono cancellate in silenzio.</p>
        </Section>
      ) : null}
      {migration ? (
        <Section title="Migrazione da DRIP Urban 53.0" count={issues.length} defaultOpen={issues.length > 0}>
          <ul className="issue-list">{issues.map((r, i) => <li key={i} className={r.level === 'error' ? 'is-error' : 'is-warn'}><Icon name="warning" size={14} /><span><strong>{r.what}</strong> — {r.reason}</span></li>)}</ul>
          <p className="muted">{migration.report.length - issues.length} note informative (elementi rigenerati dal nuovo modello). Origine: {migration.from}</p>
        </Section>
      ) : null}
      <SidewalkOverview />
      <Section title="Per iniziare" defaultOpen={!scenario.operations.length}>
        <div className="quick">
          <button type="button" onClick={() => setTool('road')}><Icon name="road" /><span>Disegna una strada</span><kbd className="kbd">R</kbd></button>
          <button type="button" onClick={() => setTool('section')}><Icon name="section" /><span>Modifica una sezione</span><kbd className="kbd">S</kbd></button>
          <button type="button" onClick={() => setTool('roundabout')}><Icon name="roundabout" /><span>Inserisci una rotatoria</span><kbd className="kbd">O</kbd></button>
          <button type="button" onClick={() => setTool('junction')}><Icon name="junction" /><span>Analizza un incrocio</span><kbd className="kbd">J</kbd></button>
          <button type="button" onClick={() => setTool('furniture')}><Icon name="tree" /><span>Arredo e verde</span><kbd className="kbd">F</kbd></button>
          <button type="button" onClick={() => void importExistingSidewalks()}><Icon name="ped" /><span>Importa marciapiedi esistenti</span></button>
          <button type="button" onClick={() => setDock('connect')}><Icon name="connect" /><span>Aggancia strade non collegate</span></button>
        </div>
      </Section>
    </>
  );
}
