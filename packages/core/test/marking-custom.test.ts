import { expect, it } from 'vitest';
import { customHatchGeometry, geom } from '../src/index';
it('clips rotated stripes to a concave polygon without painting the notch', () => {
  const polygon: geom.V[] = [[0,0],[8,0],[8,8],[5,8],[5,3],[3,3],[3,8],[0,8]];
  const stripes = customHatchGeometry(polygon,[0,1],1.1,37,.35,0);
  expect(stripes.length).toBeGreaterThan(5);
  for (const stripe of stripes) {
    const area = Math.abs(geom.ringArea(stripe));
    expect(area).toBeGreaterThan(0);
    expect(geom.polygonIntersectionArea(stripe, polygon)).toBeCloseTo(area,5);
  }
  const dense = customHatchGeometry(polygon,[0,1],.6,37,.35,0);
  expect(dense.length).toBeGreaterThan(stripes.length);
});
