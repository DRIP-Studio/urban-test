import type { CrossSectionElement, Lane, LaneDirection, LngLat, Oneway, Road, TravelMode } from '../model/types';

export function makeLanes(roadId: string, count: number, widthM: number, direction: LaneDirection | 'split', modes: readonly TravelMode[]): Lane[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${roadId}:l${i}`,
    index: i,
    direction: direction === 'split' ? (i < Math.ceil(count / 2) ? 'forward' : 'backward') : direction,
    widthM,
    modes,
    turns: ['through'],
  }));
}

export interface RoadTemplate {
  readonly id: string;
  readonly label: string;
  readonly roadClass: string;
  readonly speedKmh: number;
  readonly oneway: Oneway;
  readonly lanes: number;
  readonly laneWidthM: number;
  /** Elements outside the carriageway, ordered from the kerb outwards; mirrored on both sides. */
  readonly sides: readonly { readonly kind: CrossSectionElement['kind']; readonly widthM: number }[];
  readonly medianM?: number;
  readonly pedestrian?: boolean;
}

/** Street templates (widths per DM 05/11/2001 urban categories E/F and local practice). */
export const ROAD_TEMPLATES: readonly RoadTemplate[] = [
  { id: 'local', label: 'Locale F urbana', roadClass: 'residential', speedKmh: 30, oneway: 'no', lanes: 2, laneWidthM: 2.75, sides: [{ kind: 'sidewalk', widthM: 1.5 }] },
  { id: 'local_oneway', label: 'Locale a senso unico', roadClass: 'residential', speedKmh: 30, oneway: 'forward', lanes: 1, laneWidthM: 3.5, sides: [{ kind: 'parking', widthM: 2.0 }, { kind: 'sidewalk', widthM: 1.5 }] },
  { id: 'neighbourhood', label: 'Quartiere E', roadClass: 'tertiary', speedKmh: 50, oneway: 'no', lanes: 2, laneWidthM: 3.0, sides: [{ kind: 'parking', widthM: 2.0 }, { kind: 'sidewalk', widthM: 2.0 }] },
  { id: 'avenue', label: 'Viale con mediana', roadClass: 'secondary', speedKmh: 50, oneway: 'no', lanes: 4, laneWidthM: 3.25, medianM: 2.0, sides: [{ kind: 'furniture', widthM: 1.2 }, { kind: 'sidewalk', widthM: 3.0 }] },
  { id: 'complete_street', label: 'Strada completa (bus + bici)', roadClass: 'tertiary', speedKmh: 30, oneway: 'no', lanes: 2, laneWidthM: 3.25, sides: [{ kind: 'cycle', widthM: 1.5 }, { kind: 'green', widthM: 1.5 }, { kind: 'sidewalk', widthM: 2.5 }] },
  { id: 'pedestrian', label: 'Area pedonale', roadClass: 'pedestrian', speedKmh: 10, oneway: 'no', lanes: 1, laneWidthM: 6, sides: [], pedestrian: true },
  { id: 'cycle', label: 'Pista ciclabile bidirezionale', roadClass: 'cycleway', speedKmh: 20, oneway: 'no', lanes: 1, laneWidthM: 2.5, sides: [], pedestrian: true },
  { id: 'ramp', label: 'Rampa / svincolo', roadClass: 'trunk_link', speedKmh: 40, oneway: 'forward', lanes: 1, laneWidthM: 3.75, sides: [{ kind: 'shoulder', widthM: 1.0 }] },
];

const VEHICLES: readonly TravelMode[] = ['car', 'bus', 'truck', 'bike', 'emergency'];

export function roadFromTemplate(t: RoadTemplate, id: string, from: string, to: string, axis: readonly LngLat[], name: string): Road {
  const modes: readonly TravelMode[] = t.pedestrian ? (t.roadClass === 'cycleway' ? ['bike', 'walk'] : ['walk', 'bike']) : VEHICLES;
  const lanes = makeLanes(id, t.lanes, t.laneWidthM, t.oneway === 'no' ? 'split' : t.oneway === 'forward' ? 'forward' : 'backward', modes);
  const elements: CrossSectionElement[] = [];
  const left = [...t.sides].reverse();
  left.forEach((s, i) => elements.push({ id: `${id}:L${i}`, kind: s.kind, widthM: s.widthM }));
  // Lanes left → right: backward lanes (highest index) first.
  const byIndexDesc = [...lanes].sort((a, b) => b.index - a.index);
  let medianDone = false;
  for (const l of byIndexDesc) {
    if (t.medianM && !medianDone && l.direction === 'forward') {
      elements.push({ id: `${id}:M`, kind: 'median', widthM: t.medianM });
      medianDone = true;
    }
    elements.push({ id: `${l.id}:e`, kind: t.pedestrian ? 'sidewalk' : 'lane', widthM: l.widthM, laneId: l.id });
  }
  t.sides.forEach((s, i) => elements.push({ id: `${id}:R${i}`, kind: s.kind, widthM: s.widthM }));
  return {
    id, from, to, name, roadClass: t.roadClass, axis, oneway: t.oneway, speedKmh: t.speedKmh, lanes,
    section: { elements },
    provenance: { geometry: { kind: 'project', source: 'DRIP Urban scenario' }, width: { kind: 'project', source: 'DRIP Urban scenario' } },
  };
}
