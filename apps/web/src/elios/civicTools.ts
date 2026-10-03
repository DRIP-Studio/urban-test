import { api } from '../api/client';
import { flyTo } from '../map/mapStore';
import { newId, useApp } from '../state/store';
import { registerEliosTools } from './tools';

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, required });
interface Report { id: number; title: string; category: string; status: string; workflow_label?: string; location_text?: string; created_at?: string; geometry: { type: string; coordinates: number[] } }

async function reportsInArea(): Promise<Report[]> {
  const p = useApp.getState().project;
  if (!p) throw new Error('Apri un progetto');
  const r = await api.get<{ status: string; message?: string; items: Report[] }>(`/api/civic/fst/reports?bbox=${p.bbox.join(',')}`);
  if (r.status !== 'ok') throw new Error(r.message ?? 'Piattaforma FST non raggiungibile');
  return r.items;
}

registerEliosTools([
  {
    name: 'fst_reports', kind: 'read', label: 'Lette le segnalazioni FST',
    description: "Segnalazioni dei cittadini su Frattamaggiore Si Trasforma nell'area del progetto, filtrabili per testo o categoria (sola lettura: gli stati restano quelli del portale).",
    parameters: OBJ({ query: { type: 'STRING', description: 'Testo da cercare (titolo, luogo)' }, category: { type: 'STRING', description: 'Categoria esatta' }, limit: { type: 'NUMBER', description: 'Massimo risultati (predefinito 20)' } }),
    async run(a) {
      const q = String(a.query ?? '').toLowerCase();
      const items = (await reportsInArea()).filter((r) => (!a.category || r.category === a.category) && (!q || `${r.title} ${r.location_text ?? ''}`.toLowerCase().includes(q)));
      return { total: items.length, reports: items.slice(0, Number(a.limit ?? 20)).map((r) => ({ id: r.id, title: r.title, category: r.category, status: r.workflow_label ?? r.status, where: r.location_text, date: r.created_at })) };
    },
  },
  {
    name: 'fst_create_task', kind: 'write', label: 'Segnalazione FST presa in carico',
    description: 'Trasforma una segnalazione FST in attività di progetto dello scenario attivo e centra la mappa sul luogo; la pubblicazione civica potrà rispondere alla segnalazione.',
    parameters: OBJ({ reportId: { type: 'NUMBER', description: 'Id della segnalazione' }, note: { type: 'STRING', description: 'Nota di progetto' } }, ['reportId']),
    async run(a) {
      const { project, scenario } = useApp.getState();
      if (!project || !scenario) throw new Error('Apri un progetto');
      const r = (await reportsInArea()).find((x) => x.id === Number(a.reportId));
      if (!r || r.geometry?.type !== 'Point') throw new Error(`Segnalazione #${String(a.reportId)} non trovata nell'area del progetto`);
      const doc = (await api.get<{ tasks?: { reportId: number }[] } | null>(`/api/projects/${project.id}/docs/civic`).catch(() => null)) ?? {};
      const tasks = doc.tasks ?? [];
      if (tasks.some((t) => t.reportId === r.id)) return { already: true, reportId: r.id };
      const at = r.geometry.coordinates as [number, number];
      await api.put(`/api/projects/${project.id}/docs/civic`, { ...doc, tasks: [...tasks, { id: newId('task'), reportId: r.id, title: r.title, category: r.category, at, createdAt: new Date().toISOString(), scenarioId: scenario.id, note: String(a.note ?? ''), status: 'aperta' }] });
      flyTo(at, 19);
      return { created: true, reportId: r.id, scenario: scenario.name };
    },
  },
]);
