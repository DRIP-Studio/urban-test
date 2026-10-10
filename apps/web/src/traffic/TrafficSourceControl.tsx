import { useEffect, useState } from 'react';
import type { TrafficSourceMode } from '@drip-urban/core';
import { useApp } from '../state/store';
import { toast } from '../state/toasts';
import { Button, Field, Segmented, Select, Stat } from '../ui/controls';
import { liveFreshness, loadTrafficHistory, refreshTrafficState, setTrafficSource, useLive } from './live';

export const TRAFFIC_SOURCE_LABELS: Record<TrafficSourceMode, string> = { live: 'Live', historical: 'Storico', simulated: 'Simulato', hybrid: 'Ibrido' };
const explanations: Record<TrafficSourceMode, string> = {
  live: 'Velocità e chiusure rilevate dal fornitore. I tratti scoperti restano senza osservazioni; la navigazione usa lì la velocità di progetto.',
  historical: 'Una rilevazione archiviata del progetto, con data e geometria originali. Non rappresenta il traffico attuale.',
  simulated: 'Stima della domanda sulla rete e all’orario del progetto. Nessuna osservazione dal vivo.',
  hybrid: 'Osservazioni recenti dove disponibili; stima calibrata delle velocità sui tratti scoperti. Senza osservazioni valide, resta la sola stima.',
};

/** One native project setting shared by navigation, map and simulation. */
export function TrafficSourceControl({ disabled = false }: { disabled?: boolean }) {
  const mode = useApp(s => s.network?.environment?.trafficSource ?? 'simulated');
  const projectId = useApp(s => s.project?.id);
  const state = useLive();
  const [captures, setCaptures] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    if (mode === 'historical') void loadTrafficHistory().then(times => { if (active) setCaptures(times); }).catch(error => { if (active) toast.error('Archivio traffico', String(error)); });
    else if (!state.traffic) void refreshTrafficState();
    return () => { active = false; };
  }, [projectId, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const coverage = state.traffic?.mode === mode ? state.traffic.coverage : undefined;
  const freshness = liveFreshness();
  return <div className="traffic-source-control" aria-busy={state.computing}>
    <Segmented<TrafficSourceMode> label="Fonte traffico condivisa" value={mode} disabled={disabled}
      options={Object.entries(TRAFFIC_SOURCE_LABELS).map(([value, label]) => ({ value: value as TrafficSourceMode, label }))}
      onChange={value => { try { setTrafficSource(value); } catch (error) { toast.error('Fonte traffico', String(error)); } }} />
    <p className="muted">{explanations[mode]}</p>
    {mode === 'historical' ? <>
      {captures.length ? <Field label="Rilevazione archiviata"><Select ariaLabel="Rilevazione traffico" value={state.historyAt ?? ''}
        options={captures.map(at => ({ value: at, label: new Date(at).toLocaleString('it-IT') }))}
        onChange={at => { void loadTrafficHistory(at).catch(error => toast.error('Archivio traffico', String(error))); }} /></Field>
        : <p className="muted">Nessuna rilevazione geometrica archiviata. Aggiorna il traffico Live con un fornitore configurato per salvarla.</p>}
    </> : null}
    {(mode === 'live' || mode === 'hybrid') ? <p className="muted" role="status">
      {state.provider ?? 'Fornitore'} · {freshness === 'fresh' ? 'Rilevazione recente' : freshness === 'stale' ? 'Rilevazione scaduta, esclusa dai calcoli' : 'Orario della rilevazione non disponibile'}
      {state.capturedAt ? ` · ${new Date(state.capturedAt).toLocaleString('it-IT')}` : ''}
    </p> : null}
    {coverage ? <div className="stats-row">
      <Stat label="Direzioni osservate" value={`${coverage.observedDirections}/${coverage.totalDirections}`} />
      <Stat label="Direzioni stimate" value={coverage.estimatedDirections} />
      <Stat label="Senza dato" value={coverage.uncoveredDirections} />
    </div> : <p className="muted" role="status">{state.computing ? 'Associazione del traffico alla rete…' : 'Stato del traffico non ancora calcolato.'}</p>}
    <p className="muted">Legenda: continuo = osservato · tratteggiato = stimato. Colore = velocità / limite della strada: verde ≥ 80%, giallo 55–80%, arancio 35–55%, rosso &lt; 35%. Le chiusure hanno velocità nulla.</p>
    {mode === 'simulated' ? <Button icon="refresh" busy={state.computing} onClick={() => void refreshTrafficState()}>Ricalcola all’orario del progetto</Button> : null}
  </div>;
}
