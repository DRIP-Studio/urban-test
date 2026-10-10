import { useState } from 'react';
import { useEvaluation } from './evaluationState';
import { toolByName } from './tools';
import { Button } from '../ui/controls';
import { toast } from '../state/toasts';

export function EvaluationResults() {
  const { rows, busy, stage, progress, recommendation, error } = useEvaluation();
  const [saving, setSaving] = useState(false);
  if (!stage && !rows.length) return null;
  return <section className="elios-evaluation" aria-label="Confronto alternative Elios">
    <strong role="status">{stage}</strong>
    {busy ? <progress aria-label="Avanzamento simulazioni alternative" max={1} value={progress} /> : null}
    {error ? <p className="warn-line">{error}</p> : null}
    {rows.length ? <>
      <p className="muted">Stessa domanda, seed e finestra temporale. Le code sono simulate. Una prova senza coda di riferimento non dimostra una riduzione percentuale.</p>
      <div className="elios-comparison-table"><table className="table"><thead><tr><th>Scenario</th><th>Picco code</th><th>Δ code</th><th>Arrivati</th><th>Attesa</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th>{row.label}{row.id === recommendation ? ' · consigliato' : ''}</th>
          <td>{row.result.peakQueuedVehicles}</td><td>{row.queueReductionPct === null ? 'N/V' : `${(-row.queueReductionPct).toFixed(1)}%`}</td>
          <td>{row.result.metrics.completed}</td><td>{row.result.metrics.waitingDemand ?? 0}</td></tr>)}</tbody></table></div>
      {rows.slice(1).map(row => <div className="elios-candidate" key={row.id}>
        <strong>{row.label}</strong>
        <p className="muted">{row.reasons.join(' · ') || 'Nessun peggioramento rilevato nei vincoli confrontati.'}</p>
        <Button size="sm" disabled={saving || busy} onClick={() => {
          try { toolByName('apply_evaluated_intervention')!.run({ candidateId: row.id }); toast.success('Alternativa applicata', 'Modifica annullabile con Ctrl+Z'); }
          catch (failure) { toast.error('Alternativa non applicata', String(failure)); }
        }}>Applica {row.label}</Button>
      </div>)}
      <Button busy={saving} onClick={async () => { setSaving(true); try { await toolByName('save_evaluated_scenarios')!.run({ candidateIds: rows.slice(1).map(row => row.id) }); toast.success('Scenari salvati', 'Alternative disponibili nel selettore scenari'); } catch (failure) { toast.error('Salvataggio alternative', String(failure)); } finally { setSaving(false); } }}>Salva tutte come scenari</Button>
    </> : null}
  </section>;
}
