import { SIDEWALK_PROVENANCE, inferSidewalks } from '@drip-urban/core';
import { api } from '../api/client';
import { confirmAction } from '../ui/confirm';
import { flushSave, reloadBaseline, useApp } from './store';
import { toast } from './toasts';

/**
 * Imports the existing sidewalks into the project's existing state (baseline, not a scenario change):
 * widths come from the free strip between carriageway and building fronts. Undo = restore the automatic
 * version saved just before (Cronologia).
 */
export async function importExistingSidewalks(opts: { silent?: boolean } = {}): Promise<void> {
  const { project, baseline } = useApp.getState();
  if (!project || !baseline) return;
  const r = inferSidewalks(baseline);
  if (!r.changes.length) { if (!opts.silent) toast.info('Marciapiedi', 'Lo stato esistente è già aggiornato.'); return; }
  const km = (r.totalLengthM / 1000).toFixed(1).replace('.', ',');
  const ok = opts.silent || await confirmAction(
    'Importare i marciapiedi esistenti?',
    `${r.roadsWithSidewalks} strade con marciapiede (${km} km di lati), ${r.roadsWithout} senza spazio tra carreggiata e edifici. `
    + `Le larghezze sono misurate sulle sagome degli edifici di OpenStreetMap e marcate come "ricavate", non come rilievo. `
    + `Lo stato esistente del progetto viene aggiornato; prima viene salvata una versione ripristinabile da Cronologia.`,
    { confirmLabel: `Aggiorna ${r.changes.length} strade` },
  );
  if (!ok) return;
  // One toast for the whole operation: progress, then result.
  const tid = toast.progress('Marciapiedi esistenti', 'Misuro i marciapiedi sulle sagome degli edifici…');
  await flushSave();
  try {
    await api.patch(`/api/projects/${encodeURIComponent(project.id)}/baseline/roads`, {
      roads: Object.fromEntries(r.changes.map((c) => [c.roadId, c.section])),
      label: 'Marciapiedi esistenti', provenanceKey: 'sidewalks', provenance: SIDEWALK_PROVENANCE,
    });
    toast.update(tid, { progress: 0.6, body: 'Aggiorno lo stato esistente…' });
    await reloadBaseline();
    toast.done(tid, 'Marciapiedi importati', `${r.changes.length} strade aggiornate nello stato esistente.`);
  } catch (e) {
    toast.fail(tid, 'Marciapiedi non importati', e instanceof Error ? e.message : String(e));
  }
}
