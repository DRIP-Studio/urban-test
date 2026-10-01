import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MaterialCatalog } from '../api/types';
import type { FeatureCollection } from '../engine/geojson';
import { CivicLockup } from '../shell/Brand';
import { Empty, Skeleton } from '../ui/controls';
import { BeforeAfter } from './BeforeAfter';

interface Publication {
  id: string; title: string; summary: string; story: string; status: string; responsibleBody: string; estimatedCostEur: number | null; costSource: string | null;
  publishedAt: string; publishedBy: string; scenarioName?: string; documents: { title: string; url: string }[]; metrics: { label: string; before: number; after: number; unit: string }[];
  geometry: { before: FeatureCollection; after: FeatureCollection; assets?: FeatureCollection }; bbox: [number, number, number, number]; sources: string[];
}
const STATUS_IT: Record<string, string> = { proposta: 'Proposta', in_valutazione: 'In valutazione', approvato: 'Approvato', finanziato: 'Finanziato', in_corso: 'In corso', completato: 'Completato', sospeso: 'Sospeso' };

export function PublicationView({ pubId }: { pubId: string }) {
  const [pub, setPub] = useState<Publication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialCatalog | null>(null);
  useEffect(() => {
    api.get<Publication>(`/api/civic/publications/${encodeURIComponent(pubId)}`).then(setPub).catch((e) => setError(e instanceof ApiError && e.status === 410 ? 'Questa pubblicazione è stata ritirata.' : e instanceof Error ? e.message : String(e)));
    api.get<MaterialCatalog>('/catalog/materials.json').then(setMaterials).catch(() => undefined);
  }, [pubId]);
  const bbox = useMemo(() => pub?.bbox, [pub]);
  if (error) return <div className="publication"><header className="pub-head"><CivicLockup size="lg" /></header><Empty icon="civic" title="Pubblicazione non disponibile">{error}</Empty></div>;
  if (!pub || !materials || !bbox) return <div className="publication"><Skeleton lines={8} /></div>;
  const markings = { type: 'FeatureCollection' as const, features: pub.geometry.after.features.filter((f) => ['lane_line', 'center_line', 'edge_line', 'zebra', 'arrow', 'stop_line', 'give_way', 'ring_line'].includes(String(f.properties.kind))) };
  const surfacesAfter = { type: 'FeatureCollection' as const, features: pub.geometry.after.features.filter((f) => !markings.features.includes(f)) };
  return (
    <article className="publication">
      <header className="pub-head"><CivicLockup size="lg" /><span className={`pub-status st-${pub.status}`}>{STATUS_IT[pub.status] ?? pub.status}</span></header>
      <section className="pub-hero">
        <p className="pub-kicker">Progetto · {new Date(pub.publishedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <h1>{pub.title}</h1>
        <p className="pub-summary">{pub.summary}</p>
      </section>
      <section className="pub-map">
        <BeforeAfter editorial materials={materials.items} initial={bbox}
          before={{ surfaces: pub.geometry.before, label: 'Oggi' }}
          after={{ surfaces: surfacesAfter, markings, assets: pub.geometry.assets, label: 'Proposta' }} />
      </section>
      {pub.metrics.length ? (
        <section className="pub-metrics">
          <h2>Cosa cambia</h2>
          <div className="pm-grid">{pub.metrics.filter((m) => m.before !== m.after).map((m) => (
            <div key={m.label} className="pm-item"><span>{m.label}</span><strong>{m.after.toLocaleString('it-IT')}{m.unit ? ` ${m.unit}` : ''}</strong><small>oggi {m.before.toLocaleString('it-IT')}{m.unit ? ` ${m.unit}` : ''}</small></div>
          ))}</div>
          <p className="pub-note">Valori calcolati dal modello di progetto DRIP Urban sulla rete di OpenStreetMap; non sono rilievi.</p>
        </section>
      ) : null}
      {pub.story ? <section className="pub-story">{pub.story.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</section> : null}
      <section className="pub-transparency">
        <h2>Trasparenza</h2>
        <dl>
          <dt>Stato</dt><dd>{STATUS_IT[pub.status] ?? pub.status}</dd>
          <dt>Soggetto responsabile</dt><dd>{pub.responsibleBody}</dd>
          <dt>Costo stimato</dt><dd>{pub.estimatedCostEur ? `€ ${pub.estimatedCostEur.toLocaleString('it-IT')}${pub.costSource ? ` · fonte: ${pub.costSource}` : ' · fonte non indicata'}` : 'Non indicato'}</dd>
          <dt>Pubblicato da</dt><dd>{pub.publishedBy}, {new Date(pub.publishedAt).toLocaleString('it-IT')}</dd>
          <dt>Scenario</dt><dd>{pub.scenarioName ?? '—'}</dd>
          <dt>Fonti</dt><dd>{pub.sources.join(' · ')}</dd>
        </dl>
        {pub.documents.length ? (
          <>
            <h3>Documenti</h3>
            <ul>{pub.documents.map((d) => <li key={d.url}><a href={d.url} target="_blank" rel="noreferrer noopener">{d.title}</a></li>)}</ul>
          </>
        ) : null}
      </section>
      <footer className="pub-foot"><span>Frattamaggiore Si Trasforma</span><span>Tecnologia DRIP Studio · DRIP Urban</span></footer>
    </article>
  );
}
