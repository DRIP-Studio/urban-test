/**
 * Computo metrico estimativo: quantities of the active scenario measured on the
 * physical model (surfaces, markings, kerb lines) and on the network assets,
 * priced with a project price list. Pure functions only (no store, no engine).
 */

export type Unit = 'm²' | 'm' | 'cad' | 'm³';

export const CHAPTERS = [
  'Movimenti terra', 'Pavimentazioni', 'Demolizioni e rimozioni', 'Cordoli', 'Segnaletica orizzontale',
  'Segnaletica verticale', 'Arredo e verde', 'Impianti semaforici',
] as const;
export type Chapter = (typeof CHAPTERS)[number];

/** Disclaimer printed wherever the built-in reference prices are used. */
export const DEFAULT_PRICES_NOTE = 'Prezzi indicativi DRIP — sostituire con il prezziario regionale vigente';

export interface QtyItem {
  readonly chapter: Chapter;
  /** WBS code: chapter number + progressive (e.g. "01.003"). */
  readonly code: string;
  readonly description: string;
  readonly unit: Unit;
  readonly quantity: number;
  readonly unitPrice?: number;
  readonly amount?: number;
  /** Where the quantity comes from. */
  readonly source: string;
  /** Stable identity of the row (used for per-row price overrides). */
  readonly key: string;
  readonly kind?: string;
  readonly material?: string;
  readonly assetType?: string;
  /** Price list entry applied, if any. */
  readonly priceCode?: string;
  readonly priceOrigin?: PriceOrigin;
}

// ---------------------------------------------------------------- geometry

type Pos = readonly number[];
interface GeomLike { readonly type: string; readonly coordinates: unknown }
export interface FeatureLike { readonly geometry: GeomLike; readonly properties: Readonly<Record<string, unknown>> }
export interface AssetLike { readonly id: string; readonly type: string; readonly state: string; readonly properties?: Readonly<Record<string, unknown>> }

const DEG = Math.PI / 180;
const WGS_A = 6378137, WGS_E2 = 6.69437999014e-3;

/** Metres per degree of longitude / latitude at a latitude (WGS84 ellipsoid). */
function metresPerDegree(lat: number): [number, number] {
  const s = Math.sin(lat * DEG), w = 1 - WGS_E2 * s * s;
  const N = WGS_A / Math.sqrt(w), M = (WGS_A * (1 - WGS_E2)) / (w * Math.sqrt(w));
  return [N * Math.cos(lat * DEG) * DEG, M * DEG];
}

/**
 * Area (m², unsigned) of a lon/lat ring, closed or not, in a local equirectangular
 * frame on the WGS84 ellipsoid centred on the ring: error well below 0.1 % at street scale.
 */
export function ringAreaM2(input: readonly Pos[]): number {
  // Drop the closing vertex so closed and open rings share the same frame centre.
  const f = input[0], l = input[input.length - 1];
  const ring = input.length > 1 && f && l && f[0] === l[0] && f[1] === l[1] ? input.slice(0, -1) : input;
  const n = ring.length;
  if (n < 3) return 0;
  let lon0 = 0, lat0 = 0;
  for (const p of ring) { lon0 += p[0]!; lat0 += p[1]!; }
  lon0 /= n; lat0 /= n;
  const [kx, ky] = metresPerDegree(lat0);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const ax = (a[0]! - lon0) * kx, ay = (a[1]! - lat0) * ky, bx = (b[0]! - lon0) * kx, by = (b[1]! - lat0) * ky;
    s += ax * by - bx * ay;
  }
  return Math.abs(s) / 2;
}

/** Polygon area (m²): outer ring minus holes. */
export function polygonAreaM2(rings: readonly (readonly Pos[])[]): number {
  if (!rings.length) return 0;
  const outer = ringAreaM2(rings[0]!);
  let holes = 0;
  for (let i = 1; i < rings.length; i++) holes += ringAreaM2(rings[i]!);
  return Math.max(0, outer - holes);
}

/** Polygon or MultiPolygon area (m²); other geometries measure 0. */
export function geometryAreaM2(g: GeomLike | null | undefined): number {
  if (!g) return 0;
  if (g.type === 'Polygon') return polygonAreaM2(g.coordinates as Pos[][]);
  if (g.type === 'MultiPolygon') return (g.coordinates as Pos[][][]).reduce((s, p) => s + polygonAreaM2(p), 0);
  return 0;
}

/** Length (m) of a lon/lat polyline (segment-wise local metric frame). */
export function lineLengthM(line: readonly Pos[]): number {
  let L = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const [kx, ky] = metresPerDegree((a[1]! + b[1]!) / 2);
    L += Math.hypot((b[0]! - a[0]!) * kx, (b[1]! - a[1]!) * ky);
  }
  return L;
}

export function geometryLengthM(g: GeomLike | null | undefined): number {
  if (!g) return 0;
  if (g.type === 'LineString') return lineLengthM(g.coordinates as Pos[]);
  if (g.type === 'MultiLineString') return (g.coordinates as Pos[][]).reduce((s, l) => s + lineLengthM(l), 0);
  return 0;
}

// ---------------------------------------------------------------- quantities

const SURFACE_LABEL: Record<string, string> = {
  carriageway: 'Carreggiata', bus: 'Corsia riservata bus', median: 'Spartitraffico', cycle: 'Pista ciclabile', parking: 'Stalli di sosta',
  sidewalk: 'Marciapiede', furniture: 'Fascia arredo', green: 'Aiuola / verde', shoulder: 'Banchina', curb: 'Fascia cordolo',
  junction: 'Area di incrocio', corner: 'Angolo marciapiede', footpath: 'Percorso pedonale', roundabout_ring: 'Anello di rotatoria',
  roundabout_island: 'Isola centrale di rotatoria', roundabout_apron: 'Fascia sormontabile di rotatoria', splitter: 'Isola spartitraffico', area: 'Area',
};
const AREA_LABEL: Record<string, string> = { plaza: 'piazza', green: 'verde', parking: 'parcheggio', pedestrian: 'area pedonale', crossing: 'attraversamento' };
const MARK_LABEL: Record<string, string> = {
  lane_line: 'Strisce di corsia', edge_line: 'Strisce di margine', center_line: 'Strisce di mezzeria', stop_line: 'Linee di arresto',
  give_way: 'Linee di dare precedenza', zebra: 'Attraversamenti pedonali (zebrature)', arrow: 'Frecce direzionali', ring_line: 'Strisce di rotatoria',
};
/** Baseline surfaces grouped for demolition: road pavement, pedestrian pavement, green. */
const DEMO_GROUP: Record<string, 'stradale' | 'pedonale' | 'verde'> = {
  carriageway: 'stradale', bus: 'stradale', parking: 'stradale', shoulder: 'stradale', cycle: 'stradale', junction: 'stradale',
  roundabout_ring: 'stradale', roundabout_apron: 'stradale', median: 'pedonale', sidewalk: 'pedonale', furniture: 'pedonale',
  curb: 'pedonale', corner: 'pedonale', footpath: 'pedonale', splitter: 'pedonale', area: 'pedonale', green: 'verde', roundabout_island: 'verde',
};
const DEMO_LABEL = {
  stradale: 'Demolizione di pavimentazione stradale (fresatura e scarifica, trasporto a discarica)',
  pedonale: 'Rimozione di pavimentazione pedonale e sottofondo (trasporto a discarica)',
  verde: 'Scotico e rimozione di aree a verde',
};
const TREE_TYPES = /^vegetation\.(tree|tree_small|citrus|palm)\b/;

export interface QuantityInput {
  /** Current physical model (engine.lastPhysical). */
  readonly surfaces: readonly FeatureLike[];
  readonly markings: readonly FeatureLike[];
  readonly lines: readonly FeatureLike[];
  /** Physical model of the baseline (no operations). */
  readonly baselineSurfaces: readonly FeatureLike[];
  readonly assets: readonly AssetLike[];
  readonly signalPlanIds: readonly string[];
  readonly baselineSignalPlanIds: readonly string[];
  readonly labels?: { readonly materials?: Readonly<Record<string, string>>; readonly assets?: Readonly<Record<string, string>> };
  /** Earthworks of roads with a vertical profile (sections on the project DTM). */
  readonly earthworks?: readonly { readonly roadName: string; readonly cutM3: number; readonly fillM3: number }[];
}

type Draft = Omit<QtyItem, 'code'>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Line items of the computo (unpriced), sorted by chapter and with WBS codes. */
export function computeQuantities(input: QuantityInput): QtyItem[] {
  const mat = (id: string) => input.labels?.materials?.[id] ?? id;
  const assetLabel = (t: string) => input.labels?.assets?.[t] ?? t;
  const acc = new Map<string, Draft>();
  const add = (d: Draft) => {
    const cur = acc.get(d.key);
    acc.set(d.key, cur ? { ...cur, quantity: cur.quantity + d.quantity } : d);
  };

  // Pavimentazioni: project-state surfaces by kind + material.
  const touchedRoads = new Set<string>(), touchedNodes = new Set<string>(), touchedAreas = new Set<string>();
  for (const f of input.surfaces) {
    const p = f.properties;
    if (p.state !== 'project') continue;
    const roadId = str(p.roadId), nodeId = str(p.nodeId), areaId = str(p.areaId);
    if (roadId) touchedRoads.add(roadId);
    if (nodeId) touchedNodes.add(nodeId);
    if (areaId) touchedAreas.add(areaId);
    const a = geometryAreaM2(f.geometry);
    if (a <= 0) continue;
    const kind = str(p.kind) ?? 'area', material = str(p.material) ?? 'asphalt', areaKind = str(p.areaKind);
    const what = kind === 'area' && areaKind ? `Area (${AREA_LABEL[areaKind] ?? areaKind})` : SURFACE_LABEL[kind] ?? kind;
    add({
      chapter: 'Pavimentazioni', key: `pav|${kind}|${areaKind ?? ''}|${material}`, kind, material, unit: 'm²', quantity: a,
      description: `${what} — ${mat(material)}`, source: 'Modello fisico DRIP: superfici di progetto',
    });
  }

  // Demolizioni: baseline surfaces of the roads, junctions and areas the project rebuilds.
  for (const f of input.baselineSurfaces) {
    const p = f.properties;
    const roadId = str(p.roadId), nodeId = str(p.nodeId), areaId = str(p.areaId);
    const hit = (roadId && touchedRoads.has(roadId)) || (nodeId && touchedNodes.has(nodeId)) || (areaId && touchedAreas.has(areaId));
    if (!hit) continue;
    const group = DEMO_GROUP[str(p.kind) ?? ''] ?? 'pedonale';
    const a = geometryAreaM2(f.geometry);
    if (a <= 0) continue;
    add({
      chapter: 'Demolizioni e rimozioni', key: `demo|${group}`, kind: `demolizione_${group}`, unit: 'm²', quantity: a,
      description: DEMO_LABEL[group], source: 'Stato attuale: superfici delle strade, incroci e aree ricostruite (stima)',
    });
  }

  // Cordoli: kerb lines in project state.
  for (const f of input.lines) {
    const p = f.properties;
    if (p.state !== 'project' || p.kind !== 'kerb') continue;
    const L = geometryLengthM(f.geometry);
    if (L > 0) add({ chapter: 'Cordoli', key: 'kerb', kind: 'kerb', unit: 'm', quantity: L, description: 'Cordolo stradale (fornitura e posa su fondazione in cls)', source: 'Modello fisico DRIP: cordoli di progetto' });
  }

  // Segnaletica orizzontale: project markings by kind.
  for (const f of input.markings) {
    const p = f.properties;
    if (p.state !== 'project') continue;
    const a = geometryAreaM2(f.geometry);
    if (a <= 0) continue;
    const kind = str(p.kind) ?? 'marking', material = str(p.material) ?? 'road_marking_white';
    add({
      chapter: 'Segnaletica orizzontale', key: `mark|${kind}|${material}`, kind, material, unit: 'm²', quantity: a,
      description: `${MARK_LABEL[kind] ?? kind} — ${mat(material)}`, source: 'Modello fisico DRIP: segnaletica di progetto',
    });
  }

  // Assets: new ones by type, removed ones as removals.
  const poles = new Set<string>();
  for (const a of input.assets) {
    if (a.state === 'removed') {
      add({ chapter: 'Demolizioni e rimozioni', key: `rem|${a.type}`, kind: 'rimozione', assetType: a.type, unit: 'cad', quantity: 1, description: `Rimozione: ${assetLabel(a.type)}`, source: 'Oggetti dello scenario: stato «da rimuovere»' });
      continue;
    }
    if (a.state !== 'project') continue;
    const src = 'Oggetti dello scenario: stato «di progetto»';
    if (a.type.startsWith('it.sign.')) {
      poles.add(str(a.properties?.poleId) ?? a.id);
      add({ chapter: 'Segnaletica verticale', key: `sign|${a.type}`, kind: 'sign', assetType: a.type, unit: 'cad', quantity: 1, description: `Segnale: ${assetLabel(a.type)}`, source: src });
    } else if (a.type.startsWith('signal.')) {
      add({ chapter: 'Impianti semaforici', key: `head|${a.type}`, kind: 'signal_head', assetType: a.type, unit: 'cad', quantity: 1, description: `Lanterna: ${assetLabel(a.type)}`, source: src });
    } else {
      const tree = TREE_TYPES.test(a.type);
      add({ chapter: 'Arredo e verde', key: `asset|${a.type}`, kind: tree ? 'tree' : 'furniture', assetType: a.type, unit: 'cad', quantity: 1, description: tree ? `Albero: ${assetLabel(a.type)}` : assetLabel(a.type), source: src });
    }
  }
  if (poles.size) add({ chapter: 'Segnaletica verticale', key: 'pole', kind: 'pole', unit: 'cad', quantity: poles.size, description: 'Palo di sostegno con plinto di fondazione', source: 'Oggetti dello scenario: pali distinti dei nuovi segnali' });

  const base = new Set(input.baselineSignalPlanIds);
  const newPlans = input.signalPlanIds.filter((id) => !base.has(id)).length;
  if (newPlans) add({ chapter: 'Impianti semaforici', key: 'plan', kind: 'signal_plan', unit: 'cad', quantity: newPlans, description: 'Impianto semaforico nuovo (regolatore, quadro, cavidotti e cablaggi)', source: 'Piani semaforici aggiunti rispetto allo stato attuale' });

  // Movimenti terra: cut and fill from the vertical profiles; the surplus goes to a licensed site.
  const ew = input.earthworks ?? [];
  const cut = ew.reduce((t, e) => t + e.cutM3, 0), fill = ew.reduce((t, e) => t + e.fillM3, 0);
  const src = `Profili longitudinali su DTM: ${ew.length} strade (sezioni ogni 10 m, aree medie)`;
  if (cut > 0) add({ chapter: 'Movimenti terra', key: 'ew|cut', kind: 'scavo', unit: 'm³', quantity: cut, description: 'Scavo di sbancamento e a sezione aperta (anche in presenza d\'acqua)', source: src });
  if (fill > 0) add({ chapter: 'Movimenti terra', key: 'ew|fill', kind: 'rilevato', unit: 'm³', quantity: fill, description: 'Formazione di rilevato con materiali idonei, compattato', source: src });
  if (cut - fill > 0) add({ chapter: 'Movimenti terra', key: 'ew|surplus', kind: 'conferimento', unit: 'm³', quantity: cut - fill, description: 'Trasporto e conferimento a impianto autorizzato del materiale in esubero', source: 'Bilancio sterri − riporti' });

  const out: QtyItem[] = [];
  CHAPTERS.forEach((ch, ci) => {
    const rows = [...acc.values()].filter((d) => d.chapter === ch).sort((x, y) => x.description.localeCompare(y.description, 'it'));
    rows.forEach((d, i) => out.push({ ...d, quantity: round(d.quantity, d.unit === 'cad' ? 0 : 2), code: `${String(ci + 1).padStart(2, '0')}.${String(i + 1).padStart(3, '0')}` }));
  });
  return out.filter((d) => d.quantity > 0);
}

// ---------------------------------------------------------------- price list

export type PriceOrigin = 'default' | 'import' | 'user';
export interface PriceMatch { readonly chapter?: Chapter; readonly kind?: string; readonly material?: string; readonly assetType?: string }
export interface PriceItem {
  readonly code: string;
  readonly description: string;
  readonly unit: Unit;
  readonly price: number;
  readonly match: PriceMatch;
  readonly origin?: PriceOrigin;
}
export interface PriceList {
  readonly name: string;
  readonly source: string;
  readonly items: readonly PriceItem[];
  /** Keep the DRIP reference prices as fallback for rows the list does not cover. */
  readonly useDefaults?: boolean;
  readonly vatPct?: number;
  readonly safetyPct?: number;
}

const D = (code: string, description: string, unit: Unit, price: number, match: PriceMatch): PriceItem => ({ code, description, unit, price, match, origin: 'default' });
const PAV: Chapter = 'Pavimentazioni', ARR: Chapter = 'Arredo e verde', SEM: Chapter = 'Impianti semaforici';

/** Reference prices (orders of magnitude, Italy 2026). Never official: see DEFAULT_PRICES_NOTE. */
export const DEFAULT_PRICES: readonly PriceItem[] = [
  D('DRIP.MT.01', 'Scavo di sbancamento', 'm³', 9, { chapter: 'Movimenti terra', kind: 'scavo' }),
  D('DRIP.MT.02', 'Rilevato con materiali idonei', 'm³', 18, { chapter: 'Movimenti terra', kind: 'rilevato' }),
  D('DRIP.MT.03', 'Trasporto e conferimento a impianto autorizzato', 'm³', 22, { chapter: 'Movimenti terra', kind: 'conferimento' }),
  D('DRIP.PAV.00', 'Pavimentazione (voce generica)', 'm²', 45, { chapter: PAV }),
  D('DRIP.PAV.01', 'Conglomerato bituminoso: binder + usura su fondazione esistente', 'm²', 25, { chapter: PAV, material: 'asphalt' }),
  D('DRIP.PAV.02', 'Conglomerato bituminoso drenante', 'm²', 32, { chapter: PAV, material: 'porous_asphalt' }),
  D('DRIP.PAV.03', 'Conglomerato bituminoso colorato', 'm²', 34, { chapter: PAV, material: 'asphalt_red' }),
  D('DRIP.PAV.04', 'Conglomerato bituminoso colorato', 'm²', 34, { chapter: PAV, material: 'asphalt_green' }),
  D('DRIP.PAV.05', 'Pavimentazione ciclabile in conglomerato colorato', 'm²', 30, { chapter: PAV, material: 'cycle_pavement' }),
  D('DRIP.PAV.06', 'Massetto / pavimentazione in calcestruzzo', 'm²', 45, { chapter: PAV, material: 'concrete' }),
  D('DRIP.PAV.07', 'Calcestruzzo architettonico granigliato', 'm²', 65, { chapter: PAV, material: 'concrete_exposed' }),
  D('DRIP.PAV.08', 'Masselli autobloccanti in cls su sottofondo', 'm²', 70, { chapter: PAV, material: 'concrete_pavers' }),
  D('DRIP.PAV.09', 'Masselli drenanti in cls', 'm²', 78, { chapter: PAV, material: 'permeable_pavers' }),
  D('DRIP.PAV.10', 'Masselli in cls tono caldo', 'm²', 72, { chapter: PAV, material: 'pavers_warm' }),
  D('DRIP.PAV.11', 'Lastre urbane in cls/pietra ricostruita', 'm²', 95, { chapter: PAV, material: 'slab_light' }),
  D('DRIP.PAV.12', 'Pavimentazione in laterizio', 'm²', 90, { chapter: PAV, material: 'brick' }),
  D('DRIP.PAV.13', 'Basoli in pietra lavica', 'm²', 180, { chapter: PAV, material: 'basalt' }),
  D('DRIP.PAV.14', 'Lastre di granito', 'm²', 160, { chapter: PAV, material: 'granite' }),
  D('DRIP.PAV.15', 'Lastre in pietra calcarea', 'm²', 140, { chapter: PAV, material: 'stone' }),
  D('DRIP.PAV.16', 'Cubetti di porfido su letto di sabbia', 'm²', 150, { chapter: PAV, material: 'porphyry' }),
  D('DRIP.PAV.17', 'Sampietrini in basalto', 'm²', 150, { chapter: PAV, material: 'sampietrini' }),
  D('DRIP.PAV.18', 'Acciottolato', 'm²', 130, { chapter: PAV, material: 'cobbles' }),
  D('DRIP.PAV.19', 'Lastre di travertino', 'm²', 170, { chapter: PAV, material: 'travertine' }),
  D('DRIP.PAV.20', 'Percorso tattile LOGES', 'm²', 160, { chapter: PAV, material: 'loges_warning' }),
  D('DRIP.PAV.21', 'Percorso tattile LOGES', 'm²', 160, { chapter: PAV, material: 'loges_direction' }),
  D('DRIP.PAV.22', 'Formazione di prato su terreno vegetale', 'm²', 12, { chapter: PAV, material: 'grass' }),
  D('DRIP.PAV.23', 'Prato rustico', 'm²', 9, { chapter: PAV, material: 'meadow' }),
  D('DRIP.PAV.24', 'Terra vegetale / pacciamatura', 'm²', 10, { chapter: PAV, material: 'soil' }),
  D('DRIP.PAV.25', 'Ghiaia stabilizzata', 'm²', 28, { chapter: PAV, material: 'gravel' }),
  D('DRIP.PAV.26', 'Pavimentazione in gomma colata antitrauma', 'm²', 95, { chapter: PAV, material: 'rubber' }),
  D('DRIP.DEM.00', 'Demolizione e rimozione (voce generica)', 'm²', 12, { chapter: 'Demolizioni e rimozioni' }),
  D('DRIP.DEM.01', 'Fresatura/demolizione pavimentazione stradale e trasporto a discarica', 'm²', 12, { chapter: 'Demolizioni e rimozioni', kind: 'demolizione_stradale' }),
  D('DRIP.DEM.02', 'Rimozione pavimentazione pedonale e sottofondo', 'm²', 18, { chapter: 'Demolizioni e rimozioni', kind: 'demolizione_pedonale' }),
  D('DRIP.DEM.03', 'Scotico di aree a verde', 'm²', 4, { chapter: 'Demolizioni e rimozioni', kind: 'demolizione_verde' }),
  D('DRIP.DEM.10', 'Rimozione di elemento di arredo o segnaletica', 'cad', 60, { chapter: 'Demolizioni e rimozioni', kind: 'rimozione' }),
  D('DRIP.DEM.11', 'Abbattimento albero e rimozione ceppaia', 'cad', 450, { chapter: 'Demolizioni e rimozioni', kind: 'rimozione', assetType: 'vegetation.tree' }),
  D('DRIP.COR.01', 'Cordolo in pietra/cls su fondazione in cls', 'm', 45, { chapter: 'Cordoli' }),
  D('DRIP.SOR.01', 'Segnaletica orizzontale in vernice rifrangente', 'm²', 8, { chapter: 'Segnaletica orizzontale' }),
  D('DRIP.SOR.02', 'Attraversamento pedonale in termoplastico', 'm²', 22, { chapter: 'Segnaletica orizzontale', kind: 'zebra' }),
  D('DRIP.SVE.01', 'Segnale verticale in alluminio rifrangente classe 2', 'cad', 110, { chapter: 'Segnaletica verticale', kind: 'sign' }),
  D('DRIP.SVE.02', 'Palo in acciaio zincato con plinto di fondazione', 'cad', 90, { chapter: 'Segnaletica verticale', kind: 'pole' }),
  D('DRIP.ARR.00', 'Elemento di arredo urbano (voce generica)', 'cad', 600, { chapter: ARR, kind: 'furniture' }),
  D('DRIP.ARR.01', 'Messa a dimora di albero con fossa, tutori e irrigazione', 'cad', 650, { chapter: ARR, kind: 'tree' }),
  ...([
    ['vegetation.shrub', 'Arbusto in vaso', 45], ['furniture.bench', 'Panchina', 900], ['furniture.seat_module', 'Seduta modulare', 1200],
    ['furniture.light_pole', 'Lampione stradale con plinto e cavidotto', 2500], ['furniture.light_pedestrian', 'Lampione pedonale con plinto', 1800],
    ['furniture.smart_pole', 'Palo smart', 4500], ['furniture.bollard', 'Dissuasore', 180], ['furniture.fence', 'Transenna parapedonale', 160],
    ['furniture.barrier', 'Barriera mobile', 250], ['furniture.guardrail', 'Guardrail (4 m)', 280], ['furniture.jersey', 'New Jersey (2 m)', 220],
    ['furniture.bus_shelter', 'Pensilina bus', 8500], ['furniture.green_shelter', 'Pensilina verde', 14000], ['furniture.transit_display', 'Display TPL', 6000],
    ['transit.stop', 'Palina di fermata', 350], ['furniture.bike_rack', 'Rastrelliera bici', 450], ['furniture.bike_station', 'Stazione bike sharing', 25000],
    ['furniture.ev_charger', 'Colonnina di ricarica', 9000], ['furniture.parking_meter', 'Parcometro', 6500], ['furniture.hydrant', 'Idrante', 1800],
    ['furniture.storm_inlet', 'Caditoia con allaccio', 450], ['furniture.bin', 'Cestino', 350], ['furniture.drinking_fountain', 'Fontanella', 2200],
    ['furniture.planter', 'Fioriera', 900], ['furniture.planter_linear', 'Fioriera lineare', 1600], ['furniture.fountain', 'Fontana urbana', 30000],
    ['furniture.info_board', 'Pannello informativo', 1500], ['furniture.kiosk', 'Chiosco', 25000], ['furniture.play', 'Gioco bimbi', 6000],
    ['ztl.gate', 'Varco ZTL con PMV', 35000], ['ztl.led_panel', 'Pannello LED ZTL', 6000], ['ztl.camera', 'Telecamera di controllo varco', 12000],
    ['traffic.vms', 'Pannello a messaggio variabile su palo', 30000],
  ] as const).map(([t, d, p], i) => D(`DRIP.ARR.${String(i + 10).padStart(2, '0')}`, d, 'cad', p, { chapter: ARR, assetType: t })),
  D('DRIP.SEM.01', 'Lanterna semaforica veicolare a LED con staffe', 'cad', 650, { chapter: SEM, kind: 'signal_head' }),
  D('DRIP.SEM.02', 'Lanterna semaforica pedonale/ciclabile a LED', 'cad', 450, { chapter: SEM, assetType: 'signal.pedestrian' }),
  D('DRIP.SEM.03', 'Lanterna semaforica pedonale/ciclabile a LED', 'cad', 450, { chapter: SEM, assetType: 'signal.cycle' }),
  D('DRIP.SEM.10', 'Impianto semaforico: regolatore, quadro, cavidotti, pali e cablaggi', 'cad', 18000, { chapter: SEM, kind: 'signal_plan' }),
];

export const EMPTY_PRICELIST: PriceList = { name: 'Prezzi indicativi DRIP', source: DEFAULT_PRICES_NOTE, items: [], useDefaults: true, vatPct: 10, safetyPct: 3 };

const ORIGIN_RANK: Record<PriceOrigin, number> = { default: 0, import: 1, user: 2 };

/** Specificity of a match: assetType > material > kind > chapter (lexicographic). */
export function specificity(m: PriceMatch): number {
  return (m.assetType ? 8 : 0) + (m.material ? 4 : 0) + (m.kind ? 2 : 0) + (m.chapter ? 1 : 0);
}

const matches = (m: PriceMatch, row: Pick<QtyItem, 'chapter' | 'kind' | 'material' | 'assetType'>) =>
  specificity(m) > 0
  && (!m.chapter || m.chapter === row.chapter) && (!m.kind || m.kind === row.kind)
  && (!m.material || m.material === row.material) && (!m.assetType || m.assetType === row.assetType);

/** Most specific matching entry (ties: user > import > default, then the later entry); units must agree. */
export function matchPrice(row: Pick<QtyItem, 'chapter' | 'kind' | 'material' | 'assetType' | 'unit'>, items: readonly PriceItem[]): PriceItem | null {
  let best: PriceItem | null = null, bestScore = -1;
  items.forEach((it, i) => {
    if (it.unit !== row.unit || !matches(it.match, row)) return;
    const score = specificity(it.match) * 10_000 + ORIGIN_RANK[it.origin ?? 'import'] * 1_000 + i;
    if (score > bestScore) { best = it; bestScore = score; }
  });
  return best;
}

/** Entries actually used for matching: list items, then the DRIP defaults if enabled. */
export function effectivePrices(list: PriceList): PriceItem[] {
  return [...(list.useDefaults !== false ? DEFAULT_PRICES : []), ...list.items];
}

export function priceItems(rows: readonly QtyItem[], list: PriceList): QtyItem[] {
  const items = effectivePrices(list);
  return rows.map((r) => {
    const p = matchPrice(r, items);
    if (!p) return r;
    return { ...r, unitPrice: p.price, amount: round(r.quantity * p.price, 2), priceCode: p.code, priceOrigin: p.origin ?? 'import' };
  });
}

/** Price list entry that pins a price on exactly one row (most specific possible match). */
export function overrideFor(row: QtyItem, price: number, base?: PriceItem | null): PriceItem {
  const match: PriceMatch = { chapter: row.chapter, ...(row.kind ? { kind: row.kind } : {}), ...(row.material ? { material: row.material } : {}), ...(row.assetType ? { assetType: row.assetType } : {}) };
  return { code: base?.code ?? `U.${row.code}`, description: base?.description ?? row.description, unit: row.unit, price, match, origin: 'user' };
}

const sameMatch = (a: PriceMatch, b: PriceMatch) => a.chapter === b.chapter && a.kind === b.kind && a.material === b.material && a.assetType === b.assetType;

/** Replaces any user entry with the same match, then appends the new one. */
export function withOverride(list: PriceList, item: PriceItem): PriceList {
  return { ...list, items: [...list.items.filter((i) => !(i.origin === 'user' && sameMatch(i.match, item.match))), item] };
}

/** Drops the user entry pinned on a row, if any. */
export function withoutOverride(list: PriceList, row: QtyItem): PriceList {
  const m = overrideFor(row, 0).match;
  return { ...list, items: list.items.filter((i) => !(i.origin === 'user' && sameMatch(i.match, m))) };
}

// ---------------------------------------------------------------- totals

export interface Totals { works: number; safety: number; taxable: number; vat: number; total: number; byChapter: Record<string, number>; unpriced: number }

/** Lavori + oneri della sicurezza (on works) = imponibile; IVA on the imponibile. */
export function computeTotals(rows: readonly QtyItem[], vatPct: number, safetyPct: number): Totals {
  const byChapter: Record<string, number> = {};
  let works = 0, unpriced = 0;
  for (const r of rows) {
    if (r.amount === undefined) { unpriced++; continue; }
    byChapter[r.chapter] = (byChapter[r.chapter] ?? 0) + r.amount;
    works += r.amount;
  }
  works = round(works, 2);
  const safety = round(works * safetyPct / 100, 2);
  const taxable = round(works + safety, 2);
  const vat = round(taxable * vatPct / 100, 2);
  return { works, safety, taxable, vat, total: round(taxable + vat, 2), byChapter, unpriced };
}

// ---------------------------------------------------------------- CSV

/** Italian number: decimal comma, no thousands separator (spreadsheet friendly). */
export const itNum = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

const cell = (c: string | number | null | undefined) => {
  const s = c === null || c === undefined ? '' : String(c);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export function computoCsv(rows: readonly QtyItem[], t: Totals, meta: { project: string; scenario: string; priceList: string; priceSource: string; vatPct: number; safetyPct: number; date: string }): string {
  const usesDefaults = rows.some((r) => r.priceOrigin === 'default');
  const out: (string | number | null)[][] = [
    ['Computo metrico estimativo'], ['Progetto', meta.project], ['Scenario', meta.scenario], ['Data', meta.date],
    ['Prezziario', meta.priceList], ['Fonte dei prezzi', meta.priceSource],
  ];
  if (usesDefaults) out.push(['ATTENZIONE', DEFAULT_PRICES_NOTE]);
  out.push(['Quantità misurate da DRIP Urban sul modello fisico dello scenario: stima da verificare in sede di progetto.'], []);
  out.push(['Capitolo', 'Codice', 'Descrizione', 'U.M.', 'Quantità', 'Prezzo unitario (€)', 'Importo (€)', 'Voce di prezziario', 'Origine prezzo', 'Fonte quantità']);
  const ORIGIN: Record<PriceOrigin, string> = { default: 'Prezzo indicativo DRIP', import: 'Prezziario importato', user: 'Prezzo inserito' };
  for (const ch of CHAPTERS) {
    const rs = rows.filter((r) => r.chapter === ch);
    if (!rs.length) continue;
    for (const r of rs) out.push([ch, r.code, r.description, r.unit, itNum(r.quantity, r.unit === 'cad' ? 0 : 2), r.unitPrice !== undefined ? itNum(r.unitPrice) : '', r.amount !== undefined ? itNum(r.amount) : '', r.priceCode ?? '', r.priceOrigin ? ORIGIN[r.priceOrigin] : 'Senza prezzo', r.source]);
    out.push([ch, '', `Totale ${ch}`, '', '', '', itNum(t.byChapter[ch] ?? 0)]);
  }
  out.push([]);
  out.push(['', '', 'Totale lavori', '', '', '', itNum(t.works)]);
  out.push(['', '', `Oneri della sicurezza (${itNum(meta.safetyPct, 1)}%)`, '', '', '', itNum(t.safety)]);
  out.push(['', '', 'Imponibile', '', '', '', itNum(t.taxable)]);
  out.push(['', '', `IVA (${itNum(meta.vatPct, 1)}%)`, '', '', '', itNum(t.vat)]);
  out.push(['', '', 'Totale complessivo', '', '', '', itNum(t.total)]);
  if (t.unpriced) out.push(['', '', `${t.unpriced} voci senza prezzo non incluse nei totali`]);
  return toCsv(out);
}

export interface CsvImport { items: PriceItem[]; errors: string[]; separator: ';' | ','; rows: number }

/** Splits CSV text honouring quotes ("" escapes) and CR/LF line ends. */
export function parseCsv(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], f = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(f); f = ''; out.push(row); row = [];
    } else f += c;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
}

/** Separator of the header line: the one (; or ,) appearing more often outside quotes. */
export function detectSeparator(text: string): ';' | ',' {
  const line = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  let semi = 0, comma = 0, q = false;
  for (const c of line) { if (c === '"') q = !q; else if (!q && c === ';') semi++; else if (!q && c === ',') comma++; }
  return semi >= comma && semi > 0 ? ';' : comma > 0 ? ',' : ';';
}

/** "1.234,56" / "1234,56" / "1234.56" / "€ 12" → number (NaN when not a number). */
export function parseItNumber(raw: string): number {
  let s = raw.replace(/[€\s ]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

export function normalizeUnit(raw: string): Unit | null {
  const u = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/\.$/, '');
  if (['m²', 'm2', 'mq', 'm^2', 'metriquadri'].includes(u)) return 'm²';
  if (['m', 'ml', 'metri', 'metrilineari'].includes(u)) return 'm';
  if (['m³', 'm3', 'mc', 'm^3'].includes(u)) return 'm³';
  if (['cad', 'cad.', 'n', 'nr', 'n.', 'num', 'pz', 'cadauno', 'a corpo', 'acorpo'].includes(u)) return 'cad';
  return null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADERS: Record<string, readonly string[]> = {
  code: ['codice', 'code', 'cod', 'codicevoce', 'articolo'],
  description: ['descrizione', 'description', 'desc', 'descrizionevoce'],
  unit: ['unita', 'unitadimisura', 'um', 'unit', 'udm'],
  price: ['prezzo', 'price', 'prezzounitario', 'euro', 'importo', 'prezzoeuro'],
  chapter: ['chapter', 'capitolo'],
  kind: ['kind', 'tipo', 'elemento'],
  material: ['material', 'materiale'],
  assetType: ['assettype', 'oggetto', 'asset'],
};

/** Imports a price list CSV (codice; descrizione; unità; prezzo; [chapter; kind; material; assetType]). */
export function importPriceCsv(text: string): CsvImport {
  const separator = detectSeparator(text);
  const all = parseCsv(text, separator);
  const errors: string[] = [];
  const blank = (r: string[]) => !r.some((c) => c.trim());
  const h = all.findIndex((r) => !blank(r));
  if (h < 0) return { items: [], errors: ['File vuoto'], separator, rows: 0 };
  const table = all.slice(h);
  const head = table[0]!.map(norm);
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (const [k, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[k as keyof typeof HEADERS] = i;
  }
  const missing = (['code', 'description', 'unit', 'price'] as const).filter((k) => col[k] === undefined);
  if (missing.length) {
    const it: Record<string, string> = { code: 'codice', description: 'descrizione', unit: 'unità', price: 'prezzo' };
    return { items: [], errors: [`Colonne obbligatorie mancanti: ${missing.map((m) => it[m]).join(', ')}`], separator, rows: table.slice(1).filter((r) => !blank(r)).length };
  }
  const chapterOf = (s: string) => CHAPTERS.find((c) => norm(c) === norm(s));
  const items: PriceItem[] = [];
  let rows = 0;
  table.slice(1).forEach((r, i) => {
    if (blank(r)) return;
    rows++;
    const line = h + i + 2;
    const get = (k: keyof typeof HEADERS) => (col[k] === undefined ? '' : (r[col[k]!] ?? '').trim());
    const code = get('code'), description = get('description'), unit = normalizeUnit(get('unit')), price = parseItNumber(get('price'));
    if (!code) { errors.push(`Riga ${line}: codice mancante`); return; }
    if (!unit) { errors.push(`Riga ${line} (${code}): unità «${get('unit')}» non riconosciuta (usa m², m, m³, cad)`); return; }
    if (!Number.isFinite(price) || price < 0) { errors.push(`Riga ${line} (${code}): prezzo «${get('price')}» non valido`); return; }
    const chRaw = get('chapter');
    const chapter = chRaw ? chapterOf(chRaw) : undefined;
    if (chRaw && !chapter) { errors.push(`Riga ${line} (${code}): capitolo «${chRaw}» sconosciuto`); return; }
    const match: PriceMatch = {
      ...(chapter ? { chapter } : {}), ...(get('kind') ? { kind: get('kind') } : {}),
      ...(get('material') ? { material: get('material') } : {}), ...(get('assetType') ? { assetType: get('assetType') } : {}),
    };
    items.push({ code, description: description || code, unit, price: round(price, 4), match, origin: 'import' });
  });
  return { items, errors, separator, rows };
}
