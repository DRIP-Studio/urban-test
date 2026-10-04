import { LocalFrame } from '../geo/projection';
import { lengthOf, ringArea, sampleAt, type V } from '../geo/polyline';
import type { Area, Asset, CityBaseline, CrossSectionElement, LngLat, Network, Road, Zone } from '../model/types';
import { isPedestrianRoad } from '../physical/section';
import { MetricCache, incidence, vehicularArms } from '../physical/topology';
import { checkVertical, stationing, verticalRules } from '../analysis/vertical';
import { zoneGates } from '../analysis/zones';
import type { Severity } from '../ops/registry';
import { NORMS, citeNorm } from './library';

/**
 * Compliance checker (verifiche normative) over the effective network of a scenario.
 *
 * Simplified, preliminary-design checks against the reference values of Italian road and urban
 * design rules. Every finding names its norm (library id) and article. Existing elements (OSM,
 * survey) are reported one severity lower by default: DM 5/11/2001 applies to new construction
 * and is only a reference for existing roads (DM 22/4/2004). Where a value is a reference rather
 * than a strict legal limit, the message says «valore di riferimento».
 */


export interface ComplianceFinding {
  /** Unique within one report. */
  readonly id: string;
  /** Rule of the catalogue (RULES). */
  readonly rule: string;
  readonly severity: Severity;
  readonly title: string;
  readonly message: string;
  /** Library id (NORMS). */
  readonly normId: string;
  readonly article: string;
  readonly roadId?: string;
  readonly nodeId?: string;
  readonly assetId?: string;
  readonly zoneId?: string;
  readonly areaId?: string;
  readonly roundaboutId?: string;
  readonly at?: LngLat;
  readonly value?: number;
  readonly limit?: number;
  readonly unit?: string;
  /** The element is part of the existing city (not authored in the scenario). */
  readonly existing?: boolean;
}

export interface ComplianceOptions {
  /** 'project': only elements authored in the scenario; 'all' (default): the whole network. */
  readonly scope?: 'all' | 'project';
  /** Report existing elements one severity lower (default true). */
  readonly existingAsReference?: boolean;
  /** Sign family from the catalogue ('warning', 'prohibition'…), used for danger-sign checks. */
  readonly signFamily?: (type: string) => string | undefined;
  /** Rule ids to skip. */
  readonly skip?: readonly string[];
}

export interface ComplianceRule {
  readonly id: string;
  readonly title: string;
  readonly normId: string;
  readonly article: string;
  readonly description: string;
}

/** Catalogue of the implemented checks. */
export const RULES: readonly ComplianceRule[] = [
  { id: 'lane.width', title: 'Larghezza delle corsie', normId: 'dm-2001', article: 'Tab. 3.4.a', description: 'Larghezza minima delle corsie di marcia per categoria di strada (A 3,75; B 3,75; C 3,50–3,75; D 3,25; E 3,00; F extraurbana 3,25–3,50; F urbana 2,75 m).' },
  { id: 'lane.bus', title: 'Corsie riservate al trasporto pubblico', normId: 'dm-2001', article: 'cap. 3', description: 'Valore di riferimento 3,50 m per le corsie riservate ai mezzi pubblici.' },
  { id: 'sidewalk.width', title: 'Larghezza dei marciapiedi', normId: 'dm-2001', article: 'cap. 3', description: 'Marciapiedi di larghezza non inferiore a 1,50 m.' },
  { id: 'sidewalk.accessible', title: 'Percorso pedonale accessibile', normId: 'dm-236-1989', article: '§ 8.2.1', description: 'Larghezza minima 0,90 m con allargamenti di 1,50 m per l\'inversione ogni 10 m.' },
  { id: 'cycle.width', title: 'Larghezza delle piste ciclabili', normId: 'dm-557-1999', article: 'art. 7', description: '1,50 m per corsia; 1,25 m per corsie contigue (totale 2,50 m); 1,00 m solo eccezionalmente su tratti brevi e segnalati.' },
  { id: 'speed.urban', title: 'Limiti di velocità', normId: 'cds', article: 'art. 142', description: '50 km/h nei centri abitati (fino a 70 km/h su strade con caratteristiche idonee); 90/110/130 km/h fuori dai centri abitati.' },
  { id: 'speed.zone', title: 'Velocità nelle zone 30 e scolastiche', normId: 'cds', article: 'artt. 7 e 142', description: 'Le strade interne a una zona 30 non possono avere un limite superiore a quello della zona.' },
  { id: 'sign.pole', title: 'Segnali per sostegno', normId: 'reg-cds', article: 'art. 81', description: 'Di norma non più di due segnali per sostegno, oltre ai pannelli integrativi.' },
  { id: 'sign.height', title: 'Altezza dei segnali sui marciapiedi', normId: 'reg-cds', article: 'art. 81', description: 'Bordo inferiore ad almeno 2,20 m quando il segnale sporge su percorsi pedonali (valore di riferimento).' },
  { id: 'sign.danger', title: 'Distanza dei segnali di pericolo', normId: 'reg-cds', article: 'art. 84', description: 'Segnali di pericolo a 150 m dal pericolo fuori dai centri abitati, salvo pannello di distanza.' },
  { id: 'roundabout.diameter', title: 'Diametro delle rotatorie', normId: 'dm-2006', article: 'Allegato, § 4.5', description: 'Mini 14–25 m, compatte 25–40 m, convenzionali 40–50 m di diametro esterno.' },
  { id: 'roundabout.ring', title: 'Larghezza della corona giratoria', normId: 'dm-2006', article: 'Allegato, § 4.5', description: 'Valori di riferimento: 6,00 m (D ≥ 40 m), 7,00 m (25–40 m), 7,00–8,00 m (14–25 m).' },
  { id: 'junction.angle', title: 'Angolo tra i bracci delle intersezioni', normId: 'dm-2006', article: 'Allegato, cap. 4', description: 'Bracci prossimi all\'ortogonale; valore di riferimento ≥ 70° tra bracci adiacenti.' },
  { id: 'junction.visibility', title: 'Triangoli di visibilità', normId: 'dm-2006', article: 'Allegato, cap. 4', description: 'Verifica approssimata: edifici dentro il triangolo costruito con la distanza di arresto su ciascun braccio.' },
  { id: 'vertical.profile', title: 'Profilo longitudinale', normId: 'dm-2001', article: 'cap. 5', description: 'Pendenze massime e raggi minimi dei raccordi verticali per la visibilità d\'arresto.' },
  { id: 'ztl.gates', title: 'Varchi delle ZTL', normId: 'cds', article: 'art. 7 c. 9', description: 'Un varco (con segnale e, se elettronico, impianto autorizzato DPR 250/1999) per ogni strada di ingresso.' },
  { id: 'ztl.schedule', title: 'Orari e deroghe delle ZTL', normId: 'cds', article: 'art. 7 c. 9', description: 'Orari, categorie ammesse e deroghe definiti nella deliberazione di giunta.' },
  { id: 'crossing.width', title: 'Larghezza degli attraversamenti pedonali', normId: 'reg-cds', article: 'art. 145', description: 'Almeno 2,50 m sulle strade locali e urbane di quartiere, 4 m sulle altre.' },
  { id: 'crossing.ramps', title: 'Raccordi degli attraversamenti', normId: 'dpr-503-1996', article: 'artt. 5–6', description: 'Scivoli o piattaforme rialzate tra marciapiede e attraversamento (rampe ≤ 15% per dislivelli fino a 15 cm, DM 236/1989 § 8.2.1).' },
  { id: 'parking.accessible', title: 'Posti auto riservati', normId: 'dpr-503-1996', article: 'art. 10', description: 'Un posto riservato ogni 50 o frazione di 50 (larghezza ≥ 3,20 m, DM 236/1989 § 8.2.3).' },
  { id: 'lighting', title: 'Illuminazione pubblica', normId: 'uni-11248', article: 'prospetti', description: 'Categoria illuminotecnica (UNI 11248), requisiti UNI EN 13201-2, CAM illuminazione.' },
  { id: 'playground', title: 'Aree gioco', normId: 'uni-en-1176', article: 'EN 1176-1', description: 'Attrezzature conformi a UNI EN 1176 e superfici di caduta UNI EN 1177.' },
  { id: 'green.cam', title: 'Verde pubblico', normId: 'cam-verde', article: 'criteri', description: 'Progetto del verde secondo i CAM (DM 63/2020).' },
  { id: 'furniture.cam', title: 'Arredo urbano', normId: 'cam-arredo', article: 'criteri', description: 'Arredi conformi ai CAM arredo urbano.' },
  { id: 'earthworks', title: 'Terre e rocce da scavo', normId: 'dpr-120-2017', article: 'artt. 4, 24', description: 'Gestione dei materiali di scavo previsti dai profili longitudinali.' },
];

// ---------------------------------------------------------------- road categories (DM 5/11/2001)

export interface DmCategory {
  readonly code: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  readonly label: string;
  readonly urban: boolean;
  /** Minimum lane width (m), DM 5/11/2001 Tab. 3.4.a (lower value where the table has two subcategories). */
  readonly laneMinM: number;
  /** Maximum general speed limit for the category (art. 142 CdS). */
  readonly speedMaxKmh: number;
}

const RURAL_RE = /rural|extraurb/i;
const URBAN_RE = /urban/i;

/** Whether the road is outside built-up areas: OSM maxspeed source when present, else class (motorway/trunk) or speed > 70. */
export function isRuralRoad(road: Road): boolean {
  const src = road.tags?.['source:maxspeed'] ?? road.tags?.['maxspeed:type'] ?? road.tags?.['zone:traffic'];
  if (src && RURAL_RE.test(src)) return true;
  if (src && URBAN_RE.test(src)) return false;
  const cls = road.roadClass.replace(/_link$/, '');
  return cls === 'motorway' || cls === 'trunk' || road.speedKmh > 70;
}

/**
 * DM 5/11/2001 category of a road from its OSM class and context. Lane widths (Tab. 3.4.a):
 * A 3,75 · B 3,75 · C1 3,75 / C2 3,50 · D 3,25 · E 3,00 · F extraurbana F1 3,50 / F2 3,25 · F urbana 2,75 m.
 * Where the table has two subcategories the lower value is used as the minimum.
 */
export function dmCategory(road: Road): DmCategory | null {
  const cls = road.roadClass.replace(/_link$/, '');
  const rural = isRuralRoad(road);
  switch (cls) {
    case 'motorway': return { code: 'A', label: 'A — autostrada', urban: !rural, laneMinM: 3.75, speedMaxKmh: rural ? 130 : 70 };
    case 'trunk': return { code: 'B', label: 'B — extraurbana principale', urban: false, laneMinM: 3.75, speedMaxKmh: 110 };
    case 'primary': return rural
      ? { code: 'C', label: 'C — extraurbana secondaria', urban: false, laneMinM: 3.5, speedMaxKmh: 90 }
      : { code: 'D', label: 'D — urbana di scorrimento', urban: true, laneMinM: 3.25, speedMaxKmh: 70 };
    case 'secondary': case 'tertiary': return rural
      ? { code: 'C', label: 'C — extraurbana secondaria', urban: false, laneMinM: 3.5, speedMaxKmh: 90 }
      : { code: 'E', label: 'E — urbana di quartiere', urban: true, laneMinM: 3.0, speedMaxKmh: 50 };
    case 'unclassified': case 'residential': case 'living_street': case 'road': return rural
      ? { code: 'F', label: 'F — locale extraurbana', urban: false, laneMinM: 3.25, speedMaxKmh: 90 }
      : { code: 'F', label: 'F — locale urbana', urban: true, laneMinM: 2.75, speedMaxKmh: 50 };
    default: return null;
  }
}

// ---------------------------------------------------------------- helpers

const VEHICULAR = new Set(['car', 'truck', 'bus', 'emergency', 'tram']);
const NOT_CHECKED = new Set(['service', 'track', 'construction', 'path', 'steps', 'footway', 'pedestrian', 'cycleway', 'bridleway', 'proposed', 'raceway', 'roundabout']);
const PLATE_RE = /pannello|distanza|estesa|eccetto|integrativ/;

const isProjectRoad = (r: Road) => Object.values(r.provenance).some((p) => p.kind === 'project');
const isProjectAsset = (a: Asset) => a.state === 'project' || a.provenance.kind === 'project';
const isProjectArea = (a: Area) => a.state === 'project' || a.provenance.kind === 'project';
const isRingRoad = (r: Road) => r.roadClass === 'roundabout' || !!r.tags?.roundabout || r.tags?.junction === 'roundabout';
const fmt = (v: number, d = 2) => v.toFixed(d).replace('.', ',');
const roadLabel = (r: Road) => r.name || `strada ${r.id}`;

function down(s: Severity): Severity { return s === 'error' ? 'warning' : 'info'; }

function inside(p: V, poly: readonly V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) r = !r;
  }
  return r;
}

function segDist(p: V, a: V, b: V): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

/** Groups of contiguous elements of one kind in a cross-section. */
function runs(els: readonly CrossSectionElement[], kind: CrossSectionElement['kind']): CrossSectionElement[][] {
  const out: CrossSectionElement[][] = [];
  let cur: CrossSectionElement[] = [];
  for (const e of els) {
    if (e.kind === kind) cur.push(e);
    else if (e.kind !== 'curb' && cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- checker

/**
 * Runs every rule of the catalogue on the network. Pure and synchronous; `baseline` provides the
 * project origin, the buildings (visibility) and the existing features (crossings, car parks).
 */
export function checkCompliance(net: Network, baseline: CityBaseline, opts: ComplianceOptions = {}): ComplianceFinding[] {
  const frame = new LocalFrame(baseline.origin);
  const metric = new MetricCache(frame);
  const projectOnly = opts.scope === 'project';
  const lower = opts.existingAsReference !== false;
  const skip = new Set(opts.skip ?? []);
  const out: ComplianceFinding[] = [];
  const seen = new Map<string, number>();

  type Draft = Omit<ComplianceFinding, 'id' | 'normId' | 'article' | 'existing'> & { normId?: string; article?: string };
  const push = (d: Draft, existing: boolean) => {
    if (skip.has(d.rule) || (projectOnly && existing)) return;
    const rule = RULES.find((r) => r.id === d.rule)!;
    const key = `${d.rule}:${d.roadId ?? d.nodeId ?? d.assetId ?? d.zoneId ?? d.areaId ?? d.roundaboutId ?? 'net'}`;
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    out.push({
      ...d, id: k > 1 ? `${key}#${k}` : key, normId: d.normId ?? rule.normId, article: d.article ?? rule.article,
      severity: existing && lower && d.severity !== 'info' ? down(d.severity) : d.severity,
      existing: existing || undefined,
    });
  };

  const axisM = (r: Road) => metric.axis(r);
  const midOf = (r: Road): LngLat => {
    const a = axisM(r);
    return frame.toLngLat(sampleAt(a, lengthOf(a) / 2).p);
  };
  const existingNote = ' Strada esistente: il DM 5/11/2001 è riferimento per gli adeguamenti (DM 22/4/2004).';

  // ------------------------------------------------ roads: lanes, sidewalks, cycle lanes, speed
  const zones = Object.values(net.zones);
  const slowZones = zones.filter((z) => z.kind === 'zone30' || z.kind === 'school').map((z) => ({ z, poly: z.polygon.map((q) => frame.toMetric(q) as V) }));
  for (const road of Object.values(net.roads)) {
    const proj = isProjectRoad(road);
    const existing = !proj;
    if (projectOnly && existing) continue;
    const ped = isPedestrianRoad(road);
    const at = midOf(road);
    const name = roadLabel(road);

    if (!ped && !NOT_CHECKED.has(road.roadClass) && !isRingRoad(road)) {
      const cat = dmCategory(road);
      if (cat) {
        const veh = road.lanes.filter((l) => l.modes.some((m) => VEHICULAR.has(m)) && l.restriction !== 'bike_only' && l.restriction !== 'closed' && l.restriction !== 'bus_only');
        if (veh.length) {
          const w = Math.min(...veh.map((l) => l.widthM));
          if (w < cat.laneMinM - 1e-6) {
            const estimated = road.provenance.width?.kind === 'estimated';
            push({
              rule: 'lane.width', severity: estimated ? 'info' : cat.laneMinM - w > 0.25 ? 'error' : 'warning',
              title: `Corsia di ${fmt(w)} m su ${name}`,
              message: `Categoria ${cat.label}: larghezza minima della corsia ${fmt(cat.laneMinM)} m (DM 5/11/2001 Tab. 3.4.a).${estimated ? ' Larghezza stimata dalla classe OSM, non rilevata.' : ''}${existing ? existingNote : ''}`,
              roadId: road.id, at, value: w, limit: cat.laneMinM, unit: 'm',
            }, existing);
          }
        }
        const bus = road.lanes.filter((l) => l.restriction === 'bus_only');
        const busEls = road.section.elements.filter((e) => e.kind === 'bus');
        const busW = [...bus.map((l) => l.widthM), ...busEls.map((e) => e.widthM)];
        if (busW.length && Math.min(...busW) < 3.5 - 1e-6) {
          const w = Math.min(...busW);
          push({ rule: 'lane.bus', severity: 'warning', title: `Corsia riservata di ${fmt(w)} m su ${name}`,
            message: `Valore di riferimento per le corsie riservate ai mezzi pubblici: 3,50 m.${existing ? existingNote : ''}`, roadId: road.id, at, value: w, limit: 3.5, unit: 'm' }, existing);
        }
        // Speed limits (art. 142 CdS).
        if (road.speedKmh > cat.speedMaxKmh) {
          push({ rule: 'speed.urban', severity: 'error', title: `Limite di ${road.speedKmh} km/h su ${name}`,
            message: `${cat.label}: limite massimo ${cat.speedMaxKmh} km/h (art. 142 CdS).`, roadId: road.id, at, value: road.speedKmh, limit: cat.speedMaxKmh, unit: 'km/h' }, existing);
        } else if (cat.urban && road.speedKmh > 50) {
          push({ rule: 'speed.urban', severity: cat.code === 'D' ? 'info' : 'warning', title: `Limite di ${road.speedKmh} km/h in ambito urbano su ${name}`,
            message: `Nei centri abitati il limite è 50 km/h; fino a 70 km/h solo su strade con caratteristiche costruttive e funzionali idonee, con apposita segnaletica (art. 142 c. 1 CdS).`, roadId: road.id, at, value: road.speedKmh, limit: 50, unit: 'km/h' }, existing);
        }
      }
      // Sidewalks (DM 5/11/2001; DM 236/1989).
      const sw = road.section.elements.filter((e) => e.kind === 'sidewalk');
      if (sw.length) {
        const w = Math.min(...sw.map((e) => e.widthM));
        if (w < 0.9 - 1e-6) {
          push({ rule: 'sidewalk.accessible', severity: 'error', title: `Marciapiede di ${fmt(w)} m su ${name}`,
            message: `Larghezza inferiore al minimo di 0,90 m del percorso accessibile (DM 236/1989 § 8.2.1) e a 1,50 m (DM 5/11/2001).`, roadId: road.id, at, value: w, limit: 0.9, unit: 'm' }, existing);
        } else if (w < 1.5 - 1e-6) {
          push({ rule: 'sidewalk.width', severity: 'error', title: `Marciapiede di ${fmt(w)} m su ${name}`,
            message: `Larghezza minima dei marciapiedi 1,50 m (DM 5/11/2001). Sotto 1,50 m il percorso accessibile richiede allargamenti di 1,50 m per l'inversione ogni 10 m (DM 236/1989 § 8.2.1).${existing ? existingNote : ''}`,
            roadId: road.id, at, value: w, limit: 1.5, unit: 'm' }, existing);
        }
      }
      // Speed inside zone 30 / school zones.
      if (slowZones.length) {
        const mid = frame.toMetric(at) as V;
        for (const { z, poly } of slowZones) {
          const lim = z.speedKmh ?? 30;
          if (road.speedKmh > lim && inside(mid, poly)) {
            push({ rule: 'speed.zone', severity: 'warning', title: `${name}: ${road.speedKmh} km/h in «${z.name}»`,
              message: `La strada è interna a ${z.kind === 'school' ? 'una zona scolastica' : 'una zona 30'} con limite ${lim} km/h: aggiornare il limite della strada e la segnaletica di inizio/fine zona.`,
              roadId: road.id, zoneId: z.id, at, value: road.speedKmh, limit: lim, unit: 'km/h' }, existing);
            break;
          }
        }
      }
    } else if (ped && road.roadClass !== 'steps' && road.roadClass !== 'cycleway') {
      const w = road.section.elements.filter((e) => e.kind === 'sidewalk' || e.kind === 'cycle').reduce((s, e) => s + e.widthM, 0)
        || road.lanes.reduce((s, l) => s + l.widthM, 0);
      if (w > 0 && w < 0.9 - 1e-6 && road.roadClass !== 'path') {
        push({ rule: 'sidewalk.accessible', severity: 'error', title: `Percorso pedonale di ${fmt(w)} m (${name})`,
          message: 'Larghezza minima del percorso pedonale accessibile 0,90 m (DM 236/1989 § 8.2.1).', roadId: road.id, at, value: w, limit: 0.9, unit: 'm' }, existing);
      }
    }

    // Cycle lanes in the cross-section (DM 557/1999 art. 7).
    for (const run of runs(road.section.elements, 'cycle')) {
      const total = run.reduce((s, e) => s + e.widthM, 0);
      const min = Math.min(...run.map((e) => e.widthM));
      if (run.length === 1 && total < 1.5 - 1e-6) {
        push({ rule: 'cycle.width', severity: 'error', title: `Corsia ciclabile di ${fmt(total)} m su ${name}`,
          message: `Larghezza minima della corsia ciclabile 1,50 m comprese le strisce (DM 557/1999 art. 7). La riduzione a 1,00 m è ammessa solo eccezionalmente per tratti di limitata lunghezza, opportunamente segnalati.`,
          roadId: road.id, at, value: total, limit: 1.5, unit: 'm' }, existing);
      } else if (run.length > 1 && (min < 1.25 - 1e-6 || total < 2.5 - 1e-6)) {
        push({ rule: 'cycle.width', severity: 'error', title: `Pista ciclabile di ${fmt(total)} m su ${name}`,
          message: `Due corsie contigue: almeno 1,25 m ciascuna e 2,50 m complessivi (DM 557/1999 art. 7).`, roadId: road.id, at, value: total, limit: 2.5, unit: 'm' }, existing);
      }
    }
    // Separate cycleways.
    if (road.roadClass === 'cycleway') {
      const w = road.section.elements.filter((e) => e.kind === 'cycle').reduce((s, e) => s + e.widthM, 0)
        || road.lanes.filter((l) => l.modes.includes('bike')).reduce((s, l) => s + l.widthM, 0);
      const twoWay = road.oneway === 'no';
      const lim = twoWay ? 2.5 : 1.5;
      if (w > 0 && w < lim - 1e-6 && !runs(road.section.elements, 'cycle').length) {
        push({ rule: 'cycle.width', severity: 'error', title: `Pista ciclabile ${twoWay ? 'bidirezionale ' : ''}di ${fmt(w)} m (${name})`,
          message: `Larghezza minima ${twoWay ? '2,50 m per la pista bidirezionale (2 × 1,25 m)' : '1,50 m per la pista monodirezionale'} (DM 557/1999 art. 7).`, roadId: road.id, at, value: w, limit: lim, unit: 'm' }, existing);
      }
    }

    // Vertical profile (DM 5/11/2001 cap. 5; DM 557/1999 art. 8; DM 236/1989).
    if (road.vertical && !skip.has('vertical.profile')) {
      const len = stationing(road, baseline.origin).length;
      const rules = verticalRules(road);
      const normId = road.roadClass === 'cycleway' ? 'dm-557-1999' : /footway|pedestrian|path|steps/.test(road.roadClass) ? 'dm-236-1989' : 'dm-2001';
      const article = normId === 'dm-557-1999' ? 'art. 8' : normId === 'dm-236-1989' ? '§ 8.1.11, § 8.2.1' : 'cap. 5';
      for (const issue of checkVertical(road, road.vertical, len)) {
        const st = issue.station ?? 0;
        const a = axisM(road);
        push({ rule: 'vertical.profile', severity: issue.severity, title: `Profilo di ${name}${issue.station !== undefined ? ` al km ${fmt(st / 1000, 3)}` : ''}`,
          message: `${issue.message} — ${rules.category}.`, normId, article, roadId: road.id, at: frame.toLngLat(sampleAt(a, Math.min(lengthOf(a), st)).p) }, existing);
      }
    }
  }

  // ------------------------------------------------ signs on poles (Reg. CdS art. 81, 84)
  const poles = new Map<string, Asset[]>();
  for (const a of Object.values(net.assets)) {
    if (!a.type.startsWith('it.sign.') || a.state === 'removed') continue;
    const pole = (a.properties.poleId as string | undefined) ?? a.id;
    (poles.get(pole) ?? poles.set(pole, []).get(pole)!).push(a);
  }
  const existingDanger: Asset[] = [];
  for (const list of poles.values()) {
    list.sort((x, y) => ((x.properties.stackOrder as number) ?? 0) - ((y.properties.stackOrder as number) ?? 0));
    const main = list.filter((a) => !PLATE_RE.test(a.type));
    const existing = !list.some(isProjectAsset);
    if (main.length > 2) {
      push({ rule: 'sign.pole', severity: 'warning', title: `${main.length} segnali sullo stesso sostegno`,
        message: 'Di norma non più di due segnali per sostegno, oltre ai pannelli integrativi (art. 81 Reg. CdS): separare su un secondo palo o eliminare i segnali ridondanti.',
        assetId: main[0]!.id, at: main[0]!.at, value: main.length, limit: 2 }, existing);
    }
    for (const a of list) {
      const h = Number(a.properties.lowerEdgeM ?? a.properties.mountHeightM);
      if (Number.isFinite(h) && h > 0 && h < 2.2 - 1e-6 && a.properties.onSidewalk !== false) {
        push({ rule: 'sign.height', severity: 'warning', title: `Segnale con bordo inferiore a ${fmt(h)} m`,
          message: 'Sui marciapiedi e lungo i percorsi pedonali il bordo inferiore dei segnali deve stare ad almeno 2,20 m (art. 81 Reg. CdS, valore di riferimento): evita urti e lascia libero il passaggio.',
          assetId: a.id, at: a.at, value: h, limit: 2.2, unit: 'm' }, !isProjectAsset(a));
      }
      if (opts.signFamily?.(a.type) === 'warning') {
        if (isProjectAsset(a)) {
          push({ rule: 'sign.danger', severity: 'info', title: 'Segnale di pericolo: verificare la distanza',
            message: 'Fuori dai centri abitati il segnale va posto a 150 m dal pericolo; distanze diverse richiedono il pannello integrativo di distanza (art. 84 Reg. CdS).', assetId: a.id, at: a.at, limit: 150, unit: 'm' }, false);
        } else existingDanger.push(a);
      }
    }
  }
  if (existingDanger.length) {
    push({ rule: 'sign.danger', severity: 'info', title: `${existingDanger.length} segnali di pericolo esistenti`,
      message: 'Verificare distanza dal pericolo (150 m fuori dai centri abitati) e pannelli di distanza (art. 84 Reg. CdS).', assetId: existingDanger[0]!.id, at: existingDanger[0]!.at }, true);
  }

  // ------------------------------------------------ roundabouts (DM 19/4/2006)
  for (const rb of Object.values(net.roundabouts)) {
    const D = rb.outerDiameterM;
    const base = { roundaboutId: rb.id, at: rb.center } as const;
    if (D < 14 - 1e-6) {
      push({ rule: 'roundabout.diameter', severity: 'error', title: `${rb.name}: diametro ${fmt(D, 1)} m`, message: 'Il diametro esterno minimo di una rotatoria (mini-rotatoria) è 14 m (DM 19/4/2006).', ...base, value: D, limit: 14, unit: 'm' }, false);
    } else if (D > 50 + 1e-6) {
      push({ rule: 'roundabout.diameter', severity: 'warning', title: `${rb.name}: diametro ${fmt(D, 1)} m`, message: 'Oltre 50 m di diametro esterno non si tratta di una rotatoria convenzionale ma di una sistemazione a circolazione rotatoria: le immissioni vanno verificate come intersezioni a raso (DM 19/4/2006).', ...base, value: D, limit: 50, unit: 'm' }, false);
    }
    const cls = D < 25 ? 'mini' : D <= 40 ? 'compact' : 'standard';
    const declared = rb.type === 'mini' ? 'mini' : rb.type === 'compact' ? 'compact' : 'standard';
    if (D >= 14 && cls !== declared) {
      const lbl = { mini: 'mini-rotatoria (14–25 m)', compact: 'rotatoria compatta (25–40 m)', standard: 'rotatoria convenzionale (40–50 m)' };
      push({ rule: 'roundabout.diameter', severity: 'warning', title: `${rb.name}: tipo e diametro non coerenti`,
        message: `Con ${fmt(D, 1)} m di diametro esterno è una ${lbl[cls]}, non una ${lbl[declared]} (DM 19/4/2006).`, ...base, value: D }, false);
    }
    // Ring width (reference values, DM 19/4/2006 § 4.5: corona giratoria 6,00 m for D ≥ 40, 7,00 m for 25–40, 7,00–8,00 m for 14–25).
    const ringRef = D >= 40 ? 6 : 7;
    if (D >= 14 && rb.circulatoryWidthM < ringRef - 1e-6) {
      push({ rule: 'roundabout.ring', severity: 'warning', title: `${rb.name}: corona di ${fmt(rb.circulatoryWidthM)} m`,
        message: `Valore di riferimento della corona giratoria per diametro ${D >= 40 ? '≥ 40 m: 6,00 m' : D >= 25 ? 'tra 25 e 40 m: 7,00 m' : 'tra 14 e 25 m: 7,00–8,00 m'} (DM 19/4/2006).`,
        ...base, value: rb.circulatoryWidthM, limit: ringRef, unit: 'm' }, false);
    }
  }

  // ------------------------------------------------ intersections: angles and visibility (DM 19/4/2006)
  const inc = incidence(net);
  let bgrid: ((p: V, r: number) => V[]) | null = null;
  const buildingGrid = () => {
    if (bgrid) return bgrid;
    const CELL = 20;
    const g = new Map<string, V[]>();
    for (const b of Object.values(baseline.buildings)) {
      for (const q of b.footprint) {
        const p = frame.toMetric(q) as V;
        const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
        (g.get(k) ?? g.set(k, []).get(k)!).push(p);
      }
    }
    bgrid = (p: V, r: number) => {
      const res: V[] = [];
      for (let x = Math.floor((p[0] - r) / CELL); x <= Math.floor((p[0] + r) / CELL); x++)
        for (let y = Math.floor((p[1] - r) / CELL); y <= Math.floor((p[1] + r) / CELL); y++) res.push(...(g.get(`${x},${y}`) ?? []));
      return res;
    };
    return bgrid;
  };
  for (const [nodeId, ends] of inc.byNode) {
    if (ends.length < 3 || ends.some((e) => isRingRoad(e.road))) continue;
    const node = net.nodes[nodeId];
    if (!node) continue;
    const arms = vehicularArms(net, nodeId, metric).filter((a) => !NOT_CHECKED.has(a.road.roadClass) && a.length > 5);
    if (arms.length < 3 || arms.length > 5) continue;
    const spec = net.junctions[nodeId];
    const proj = !!spec || arms.some((a) => isProjectRoad(a.road));
    if (projectOnly && !proj) continue;
    let minGap = Infinity;
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i]!, b = arms[(i + 1) % arms.length]!;
      let gap = b.angle - a.angle;
      if (gap <= 0) gap += 2 * Math.PI;
      minGap = Math.min(minGap, gap);
    }
    const deg = (minGap * 180) / Math.PI;
    if (deg < 70) {
      push({ rule: 'junction.angle', severity: 'warning', title: `Incrocio con bracci a ${Math.round(deg)}°`,
        message: `Angolo tra bracci adiacenti inferiore al valore di riferimento di 70°: angoli acuti peggiorano visibilità e manovre; valutare la rettifica dell'innesto o una rotatoria (DM 19/4/2006).`,
        nodeId, at: node.at, value: Math.round(deg), limit: 70, unit: '°' }, !proj);
    }
    // Visibility triangles: only on authored junctions without signals (approximate).
    if (proj && spec?.control !== 'signal' && spec?.control !== 'roundabout' && !skip.has('junction.visibility')) {
      const c = frame.toMetric(node.at) as V;
      const blocked: string[] = [];
      for (let i = 0; i < arms.length; i++) {
        const a = arms[i]!, b = arms[(i + 1) % arms.length]!;
        let gap = b.angle - a.angle;
        if (gap <= 0) gap += 2 * Math.PI;
        if (gap > (150 * Math.PI) / 180) continue;
        const La = Math.min(a.length, verticalRules(a.road).stoppingDistanceM), Lb = Math.min(b.length, verticalRules(b.road).stoppingDistanceM);
        const pa: V = [c[0] + a.u[0] * La, c[1] + a.u[1] * La], pb: V = [c[0] + b.u[0] * Lb, c[1] + b.u[1] * Lb];
        const tri = [c, pa, pb];
        const hw = Math.max(a.cwLeft, -a.cwRight, b.cwLeft, -b.cwRight, 2);
        const hit = buildingGrid()(c, Math.max(La, Lb)).some((p) => inside(p, tri) && segDist(p, c, pa) > hw && segDist(p, c, pb) > hw);
        if (hit) blocked.push(`${roadLabel(a.road)} / ${roadLabel(b.road)}`);
      }
      if (blocked.length) {
        push({ rule: 'junction.visibility', severity: 'warning', title: `Visibilità ridotta all'incrocio (${blocked.length} ${blocked.length === 1 ? 'angolo' : 'angoli'})`,
          message: `Edifici dentro il triangolo di visibilità costruito con la distanza di arresto sui bracci (${blocked.join('; ')}). Verifica approssimata: controllare con il rilievo, valutare arretramento della linea di arresto, regolazione con STOP o riduzione della velocità.`,
          nodeId, at: node.at }, false);
      }
    }
  }

  // ------------------------------------------------ ZTL (art. 7 c. 9 CdS, DPR 250/1999)
  for (const z of zones) {
    if (z.kind !== 'ztl') continue;
    checkZtl(z);
  }
  function checkZtl(z: Zone): void {
    const centre = z.polygon[0] ?? baseline.origin;
    const entries = zoneGates(net, baseline.origin, z).filter((g) => g.entry);
    const gates = Object.values(net.assets).filter((a) => a.type === 'ztl.gate' && a.properties.zoneId === z.id && a.state !== 'removed');
    const covered = new Set(gates.map((g) => g.properties.roadId as string | undefined).filter(Boolean));
    const missing = entries.filter((e) => !covered.has(e.roadId));
    if (entries.length && (gates.length < entries.length || (covered.size && missing.length))) {
      const m = missing[0] ?? entries[0]!;
      push({ rule: 'ztl.gates', severity: 'warning', title: `ZTL «${z.name}»: ${gates.length} varchi su ${entries.length} ingressi`,
        message: `Ogni strada di ingresso richiede un varco con il segnale di zona a traffico limitato (fig. II.322/a, art. 135 Reg. CdS); se il controllo è elettronico, impianti omologati e autorizzati dal Ministero (DPR 250/1999). Ingressi scoperti: ${missing.slice(0, 6).map((g) => g.roadName || g.roadId).join(', ')}${missing.length > 6 ? '…' : ''}.`,
        zoneId: z.id, at: m.at, value: gates.length, limit: entries.length }, false);
    }
    if (!z.schedule?.length) {
      push({ rule: 'ztl.schedule', severity: 'info', title: `ZTL «${z.name}» attiva 24 ore su 24`,
        message: 'Nessuna fascia oraria: confermare che la deliberazione di giunta preveda l\'attivazione permanente (art. 7 c. 9 CdS).', zoneId: z.id, at: centre }, false);
    }
    if (!z.permits?.length) {
      push({ rule: 'ztl.schedule', severity: 'info', title: `ZTL «${z.name}»: nessuna categoria autorizzata`,
        message: 'Indicare le deroghe (residenti, veicoli al servizio di persone con disabilità — art. 188 CdS —, soccorso, carico/scarico) come da deliberazione.', normId: 'cds', article: 'artt. 7 c. 9, 188', zoneId: z.id, at: centre }, false);
    }
  }

  // ------------------------------------------------ crossings (Reg. CdS art. 145; DPR 503/1996)
  const roadsList = Object.values(net.roads).filter((r) => !isPedestrianRoad(r) && !NOT_CHECKED.has(r.roadClass));
  const nearestRoad = (p: V, maxD = 25): Road | null => {
    let best: Road | null = null, bd = maxD;
    for (const r of roadsList) {
      const a = axisM(r);
      for (let i = 1; i < a.length; i++) {
        const d = segDist(p, a[i - 1]!, a[i]!);
        if (d < bd) { bd = d; best = r; }
      }
    }
    return best;
  };
  const hasSidewalk = (r: Road) => r.section.elements.some((e) => e.kind === 'sidewalk');
  for (const ar of Object.values(net.areas)) {
    if (ar.kind !== 'crossing' || ar.state === 'removed' || ar.polygon.length < 2) continue;
    const proj = isProjectArea(ar);
    if (projectOnly && !proj) continue;
    const p0 = frame.toMetric(ar.polygon[0]!), p1 = frame.toMetric(ar.polygon[1]!);
    const mid: V = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const at = frame.toLngLat(mid);
    const road = nearestRoad(mid);
    const cat = road ? dmCategory(road) : null;
    const minW = cat && (cat.code === 'E' || (cat.code === 'F' && cat.urban)) ? 2.5 : 4;
    const depth = ar.depthM ?? 2.5;
    if (road && depth < minW - 1e-6) {
      push({ rule: 'crossing.width', severity: 'error', title: `Attraversamento pedonale largo ${fmt(depth)} m`,
        message: `Su ${roadLabel(road)} (${cat?.label ?? road.roadClass}) la larghezza minima dell'attraversamento è ${fmt(minW)} m: 2,50 m sulle strade locali e urbane di quartiere, 4 m sulle altre (art. 145 Reg. CdS).`,
        areaId: ar.id, roadId: road.id, at, value: depth, limit: minW, unit: 'm' }, !proj);
    }
    if (road && hasSidewalk(road) && !ar.properties.kerbRamps && !ar.properties.raised) {
      push({ rule: 'crossing.ramps', severity: 'warning', title: 'Attraversamento: scivoli da verificare',
        message: 'Raccordare marciapiede e carreggiata con scivoli (pendenza ≤ 15% per dislivelli fino a 15 cm, DM 236/1989 § 8.2.1) o con attraversamento rialzato; dislivello marciapiede ≤ 15 cm (DPR 503/1996 artt. 5–6). Segna la proprietà «scivoli» quando previsti.',
        areaId: ar.id, roadId: road.id, at }, !proj);
    }
  }
  for (const spec of Object.values(net.junctions)) {
    const withSw = spec.crossingRoadIds.filter((id) => net.roads[id] && hasSidewalk(net.roads[id]!));
    const node = net.nodes[spec.nodeId];
    if (!withSw.length || !node) continue;
    push({ rule: 'crossing.ramps', severity: 'info', title: `Incrocio con ${withSw.length} attraversamenti: scivoli`,
      message: 'Prevedere scivoli o piattaforme rialzate a ogni attraversamento (DPR 503/1996 artt. 5–6; DM 236/1989 § 8.2.1) e segnali tattili per persone con disabilità visiva.', nodeId: spec.nodeId, at: node.at, value: withSw.length }, false);
  }
  const existingCrossings = Object.values(baseline.features).filter((f) => f.kind === 'crossing');
  if (existingCrossings.length && !projectOnly) {
    push({ rule: 'crossing.ramps', severity: 'info', title: `${existingCrossings.length} attraversamenti esistenti`,
      message: 'Rilevare la presenza di scivoli e il dislivello dei marciapiedi agli attraversamenti esistenti (DPR 503/1996 artt. 5–6), base del PEBA (L. 104/1992 art. 24).', at: existingCrossings[0]!.coords[0] }, true);
  }

  // ------------------------------------------------ parking (DPR 503/1996 art. 10)
  const accessibleSigns = Object.values(net.assets).filter((a) => a.state !== 'removed' && (/disabil|invalid/.test(a.type) || a.properties.accessible === true)).map((a) => frame.toMetric(a.at) as V);
  const parkingCheck = (id: { areaId?: string; roadId?: string }, ring: readonly V[] | null, stalls: number, declared: number | undefined, at: LngLat, existing: boolean, label: string, near: (p: V) => boolean) => {
    if (stalls < 1) return;
    const required = Math.ceil(stalls / 50);
    const have = declared ?? accessibleSigns.filter((p) => (ring ? inside(p, ring) || near(p) : near(p))).length;
    if (have >= required) return;
    push({ rule: 'parking.accessible', severity: 'warning', title: `${label}: ${have} posti riservati su ${required} richiesti`,
      message: `Circa ${stalls} stalli: servono almeno ${required} posti riservati ai veicoli al servizio di persone con disabilità (1 ogni 50 o frazione, DPR 503/1996 art. 10), larghi almeno 3,20 m (DM 236/1989 § 8.2.3) e segnalati (art. 188 CdS).${declared === undefined ? ' Stalli stimati dalla superficie.' : ''}`,
      ...id, at, value: have, limit: required }, existing);
  };
  for (const ar of Object.values(net.areas)) {
    if (ar.kind !== 'parking' || ar.state === 'removed' || ar.polygon.length < 3) continue;
    const ring = ar.polygon.map((q) => frame.toMetric(q) as V);
    const stalls = Number(ar.properties.stalls) || Math.floor(Math.abs(ringArea(ring)) / 25);
    const declared = ar.properties.accessibleStalls !== undefined ? Number(ar.properties.accessibleStalls) : undefined;
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length] as V, [0, 0] as V);
    parkingCheck({ areaId: ar.id }, ring, stalls, declared, frame.toLngLat(c), !isProjectArea(ar), ar.name || 'Parcheggio', (p) => ring.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 5));
  }
  for (const road of Object.values(net.roads)) {
    const park = road.section.elements.filter((e) => e.kind === 'parking');
    if (!park.length) continue;
    const proj = isProjectRoad(road);
    if (projectOnly && !proj) continue;
    const a = axisM(road);
    const L = lengthOf(a);
    // Parallel parking: one stall every 5 m per parking strip (estimate).
    const stalls = Math.floor(L / 5) * park.length;
    if (stalls < 10 && !proj) continue;
    parkingCheck({ roadId: road.id }, null, stalls, undefined, midOf(road), !proj, `Sosta su ${roadLabel(road)}`,
      (p) => a.some((q, i) => i > 0 && segDist(p, a[i - 1]!, q) < 15));
  }
  if (!projectOnly) {
    for (const f of Object.values(baseline.features)) {
      if (f.geometry !== 'polygon' || !(f.kind === 'parking' || f.category === 'parking') || f.coords.length < 3) continue;
      const ring = f.coords.map((q) => frame.toMetric(q) as V);
      const stalls = Math.floor(Math.abs(ringArea(ring)) / 25);
      if (stalls < 10) continue;
      const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length] as V, [0, 0] as V);
      parkingCheck({ areaId: f.id }, ring, stalls, undefined, frame.toLngLat(c), true, f.name || 'Parcheggio esistente', () => false);
    }
  }

  // ------------------------------------------------ lighting, green, play, furniture, earthworks (info)
  const projRoads = Object.values(net.roads).filter(isProjectRoad);
  const projAssets = Object.values(net.assets).filter((a) => isProjectAsset(a) && a.state !== 'removed');
  if (projRoads.length) {
    const lights = projAssets.filter((a) => /light|lamp|smart_pole/.test(a.type)).length;
    push({ rule: 'lighting', severity: 'info', title: `Illuminazione di ${projRoads.length} ${projRoads.length === 1 ? 'strada' : 'strade'} di progetto`,
      message: `Definire la categoria illuminotecnica (UNI 11248) e verificare i requisiti UNI EN 13201-2 con apparecchi conformi ai CAM illuminazione (DM 27/9/2017) e alla legge regionale sull'inquinamento luminoso. Punti luce di progetto nello scenario: ${lights}.`,
      roadId: projRoads[0]!.id, at: midOf(projRoads[0]!), value: lights }, false);
  }
  const play = [...Object.values(net.areas).filter((a) => a.kind === 'playground' && a.state !== 'removed' && isProjectArea(a)), ...projAssets.filter((a) => a.type === 'furniture.play')];
  for (const p of play) {
    const isArea = 'polygon' in p;
    push({ rule: 'playground', severity: 'info', title: 'Area gioco: norme UNI EN 1176/1177',
      message: 'Attrezzature conformi a UNI EN 1176, spazi di caduta liberi e superfici ammortizzanti secondo UNI EN 1177 in funzione dell\'altezza di caduta critica.',
      ...(isArea ? { areaId: p.id, at: (p as Area).polygon[0] } : { assetId: p.id, at: (p as Asset).at }) }, false);
  }
  const green = Object.values(net.areas).filter((a) => isProjectArea(a) && a.state !== 'removed' && ['green', 'tree_pit', 'rain_garden', 'bioswale', 'median_green'].includes(a.kind));
  const trees = projAssets.filter((a) => a.type.startsWith('vegetation.'));
  if (green.length || trees.length) {
    const first = green[0];
    push({ rule: 'green.cam', severity: 'info', title: `Verde di progetto: ${green.length} aree, ${trees.length} alberi/arbusti`,
      message: 'Applicare i CAM verde pubblico (DM 63/2020): specie adatte al sito, sesti d\'impianto, piano di manutenzione; superfici permeabili e gestione delle acque meteoriche (CAM edilizia).',
      ...(first ? { areaId: first.id, at: first.polygon[0] } : { assetId: trees[0]!.id, at: trees[0]!.at }), value: green.length + trees.length }, false);
  }
  const furn = projAssets.filter((a) => a.type.startsWith('furniture.') && a.type !== 'furniture.play');
  if (furn.length) {
    push({ rule: 'furniture.cam', severity: 'info', title: `${furn.length} elementi di arredo di progetto`,
      message: 'Arredi conformi ai CAM arredo urbano (DM 5/2/2015); collocazione che lasci libero il percorso pedonale accessibile (DM 236/1989 § 8.2.1).', assetId: furn[0]!.id, at: furn[0]!.at, value: furn.length }, false);
  }
  const graded = Object.values(net.roads).filter((r) => r.vertical);
  if (graded.length) {
    push({ rule: 'earthworks', severity: 'info', title: `Movimenti terra su ${graded.length} ${graded.length === 1 ? 'strada' : 'strade'}`,
      message: 'Il profilo di progetto comporta scavi e riporti: piano di utilizzo o dichiarazione per le terre e rocce da scavo (DPR 120/2017), riutilizzo in sito se non contaminate (D.Lgs. 152/2006 art. 185).', roadId: graded[0]!.id, at: midOf(graded[0]!), value: graded.length }, !graded.some(isProjectRoad));
  }

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.normId.localeCompare(b.normId) || a.title.localeCompare(b.title));
}

export interface ComplianceSummary {
  readonly total: number;
  readonly counts: Readonly<Record<Severity, number>>;
  /** Findings per library id, with the citation. */
  readonly byNorm: readonly { readonly normId: string; readonly cite: string; readonly counts: Readonly<Record<Severity, number>> }[];
}

export function summarizeFindings(findings: readonly ComplianceFinding[]): ComplianceSummary {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const per = new Map<string, Record<Severity, number>>();
  for (const f of findings) {
    counts[f.severity]++;
    const c = per.get(f.normId) ?? per.set(f.normId, { error: 0, warning: 0, info: 0 }).get(f.normId)!;
    c[f.severity]++;
  }
  const order = new Map(NORMS.map((n, i) => [n.id, i]));
  return {
    total: findings.length, counts,
    byNorm: [...per].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99)).map(([normId, c]) => ({ normId, cite: citeNorm(normId), counts: c })),
  };
}
