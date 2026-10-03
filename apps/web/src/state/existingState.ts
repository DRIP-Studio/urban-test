import { SIDEWALK_PROVENANCE, inferSidewalks } from '@drip-urban/core';
import { api } from '../api/client';
import { confirmAction } from '../ui/confirm';
import { flushSave, openProject, useApp } from './store';
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
  await flushSave();
  try {
    await api.patch(`/api/projects/${encodeURIComponent(project.id)}/baseline/roads`, {
      roads: Object.fromEntries(r.changes.map((c) => [c.roadId, c.section])),
      label: 'Marciapiedi esistenti', provenanceKey: 'sidewalks', provenance: SIDEWALK_PROVENANCE,
    });
    await openProject(project.id);
    toast.success('Marciapiedi importati', `${r.changes.length} strade aggiornate nello stato esistente.`);
  } catch (e) {
    toast.error('Marciapiedi non importati', e instanceof Error ? e.message : String(e));
  }
}
