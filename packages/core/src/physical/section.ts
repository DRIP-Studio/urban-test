import type { CrossSectionElement, CrossSectionElementKind, Road } from '../model/types';

/** Elements that form the carriageway (centred on the road axis). */
const CARRIAGEWAY: ReadonlySet<CrossSectionElementKind> = new Set(['lane', 'bus', 'median']);

export interface PlacedElement {
  readonly el: CrossSectionElement;
  /** Offsets from the axis in metres, positive = left of the axis direction. */
  readonly left: number;
  readonly right: number;
}

export interface SectionLayout {
  readonly elements: readonly PlacedElement[];
  /** Carriageway edges (left > right). */
  readonly cwLeft: number;
  readonly cwRight: number;
  /** Outermost edges of the whole section. */
  readonly outerLeft: number;
  readonly outerRight: number;
  readonly pedestrianOnly: boolean;
}

const cache = new WeakMap<Road, SectionLayout>();

export function isPedestrianRoad(road: Road): boolean {
  return road.lanes.length > 0 && road.lanes.every((l) => l.modes.every((m) => m === 'walk' || m === 'bike'))
    && !road.section.elements.some((e) => e.kind === 'lane' || e.kind === 'bus');
}

/**
 * Places the cross-section across the axis. The carriageway (lanes, bus lanes,
 * median) is centred on the axis — OSM axes are carriageway centrelines — and the
 * remaining elements stack outwards on their side.
 */
export function layoutSection(road: Road): SectionLayout {
  const hit = cache.get(road);
  if (hit) return hit;
  const els = road.section.elements;
  const pedestrianOnly = isPedestrianRoad(road);
  let cw = 0;
  for (const e of els) if (CARRIAGEWAY.has(e.kind)) cw += e.widthM;
  if (cw === 0 && !pedestrianOnly) cw = road.lanes.reduce((s, l) => s + l.widthM, 0) || 3;

  let firstCw = els.findIndex((e) => CARRIAGEWAY.has(e.kind));
  let lastCw = els.length - 1 - [...els].reverse().findIndex((e) => CARRIAGEWAY.has(e.kind));
  if (firstCw < 0) { firstCw = els.length; lastCw = els.length - 1; }

  let start: number;
  if (pedestrianOnly) {
    const total = els.reduce((s, e) => s + e.widthM, 0);
    start = total / 2;
  } else {
    let leftOuter = 0;
    for (let i = 0; i < firstCw; i++) leftOuter += els[i]!.widthM;
    start = cw / 2 + leftOuter;
  }
  const placed: PlacedElement[] = [];
  let cursor = start;
  for (const el of els) {
    placed.push({ el, left: cursor, right: cursor - el.widthM });
    cursor -= el.widthM;
  }
  const layout: SectionLayout = {
    elements: placed,
    cwLeft: pedestrianOnly ? start : cw / 2,
    cwRight: pedestrianOnly ? cursor : -cw / 2,
    outerLeft: start,
    outerRight: cursor,
    pedestrianOnly,
  };
  cache.set(road, layout);
  return layout;
}

/** Total section width in metres. */
export function sectionWidth(road: Road): number {
  const l = layoutSection(road);
  return l.outerLeft - l.outerRight;
}
