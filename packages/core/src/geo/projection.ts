import type { LngLat } from '../model/types';

/** Local metric frame: [east, north] in metres from a project origin. */
export type Metric = readonly [east: number, north: number];

const A = 6378137.0; // WGS84 semi-major axis
const E2 = 6.69437999014e-3; // WGS84 first eccentricity squared
const DEG = Math.PI / 180;

/**
 * Local tangent-plane projection around an origin, using the WGS84 radii of
 * curvature at the origin latitude. Error is < 1 cm per km within a municipality,
 * which is below survey accuracy of the source data.
 */
export class LocalFrame {
  readonly origin: LngLat;
  private readonly mPerDegLon: number;
  private readonly mPerDegLat: number;

  constructor(origin: LngLat) {
    this.origin = origin;
    const phi = origin[1] * DEG;
    const s = Math.sin(phi);
    const w = Math.sqrt(1 - E2 * s * s);
    const n = A / w; // prime vertical radius
    const m = (A * (1 - E2)) / (w * w * w); // meridional radius
    this.mPerDegLon = n * Math.cos(phi) * DEG;
    this.mPerDegLat = m * DEG;
  }

  toMetric(p: LngLat): Metric {
    return [(p[0] - this.origin[0]) * this.mPerDegLon, (p[1] - this.origin[1]) * this.mPerDegLat];
  }

  toLngLat(m: Metric): LngLat {
    return [this.origin[0] + m[0] / this.mPerDegLon, this.origin[1] + m[1] / this.mPerDegLat];
  }

  /** Metres per degree, exposed for screen-adaptive tolerances. */
  get scale(): { lon: number; lat: number } {
    return { lon: this.mPerDegLon, lat: this.mPerDegLat };
  }
}

/** Distance in metres between two WGS84 points (local frame at the first point). */
export function distanceM(a: LngLat, b: LngLat): number {
  const f = new LocalFrame(a);
  const [e, n] = f.toMetric(b);
  return Math.hypot(e, n);
}

export function polylineLengthM(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return total;
}

/** Bearing in degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [e, n] = new LocalFrame(a).toMetric(b);
  const deg = Math.atan2(e, n) / DEG;
  return (deg + 360) % 360;
}
