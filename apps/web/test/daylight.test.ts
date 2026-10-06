import { describe, expect, it } from 'vitest';
import { solarElevation, zonedInstant } from '../src/twin/daylight';

describe('twin daylight', () => {
  it('local time in Europe/Rome follows daylight saving', () => {
    expect(zonedInstant('2026-07-01', 12, 'Europe/Rome').toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(zonedInstant('2026-01-15', 12.5, 'Europe/Rome').toISOString()).toBe('2026-01-15T11:30:00.000Z');
  });
  it('sun over Frattamaggiore: high at summer noon, low in winter, below the horizon at night', () => {
    const [lon, lat] = [14.27, 40.94];
    expect(solarElevation(lon, lat, zonedInstant('2026-06-21', 13, 'Europe/Rome'))).toBeGreaterThan(70);
    const winter = solarElevation(lon, lat, zonedInstant('2026-12-21', 12, 'Europe/Rome'));
    expect(winter).toBeGreaterThan(23); expect(winter).toBeLessThan(27);
    expect(solarElevation(lon, lat, zonedInstant('2026-10-06', 22.5, 'Europe/Rome'))).toBeLessThan(-20);
  });
});
