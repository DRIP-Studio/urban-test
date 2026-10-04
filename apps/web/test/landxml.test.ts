// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildLandXml } from '../src/export/landxml';
import { toUtm } from '../src/export/dxf';
import { network, origin, terrain } from './exportFixture';

describe('LandXML export', () => {
  const xml = buildLandXml({ network, origin, title: 'Prova · Scenario', terrain });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const NS = 'http://www.landxml.org/schema/LandXML-1.2';
  const all = (tag: string) => Array.from(doc.getElementsByTagNameNS(NS, tag));

  it('is well-formed LandXML 1.2 with metric units and UTM 33N', () => {
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.documentElement.localName).toBe('LandXML');
    expect(doc.documentElement.namespaceURI).toBe(NS);
    expect(all('Metric')[0]?.getAttribute('linearUnit')).toBe('meter');
    expect(all('CoordinateSystem')[0]?.getAttribute('epsgCode')).toBe('32633');
    expect(all('Project')[0]?.getAttribute('name')).toBe('Prova · Scenario');
  });

  it('writes the alignment with escaped name, N E point order and the profile', () => {
    const al = all('Alignment');
    expect(al.length).toBe(1);
    expect(al[0]!.getAttribute('name')).toBe("Via dell'Unità & <Italia>");
    expect(xml).toContain('Via dell&apos;Unità &amp; &lt;Italia&gt;');
    const lines = all('Line');
    expect(lines.length).toBe(2);
    const p0 = network.roads.r1!.axis[0]!;
    const [e, n] = toUtm(p0[0], p0[1], 33);
    const start = lines[0]!.getElementsByTagNameNS(NS, 'Start')[0]!.textContent!.split(' ').map(Number);
    expect(start[0]).toBeCloseTo(n, 2); // northing first
    expect(start[1]).toBeCloseTo(e, 2);
    const len = Number(al[0]!.getAttribute('length'));
    expect(len).toBeGreaterThan(100); expect(len).toBeLessThan(104);
    const pvi = all('PVI');
    expect(pvi.length).toBe(2);
    // Profile rescaled from ground chainage (102 m) to the grid alignment length.
    expect(pvi[1]!.textContent).toBe(`${len.toFixed(3)} 21.000`);
    const pc = all('ParaCurve');
    expect(pc.length).toBe(1);
    expect(Number(pc[0]!.getAttribute('length'))).toBeCloseTo(30, 0);
    const [st, z] = pc[0]!.textContent!.split(' ').map(Number);
    expect(st).toBeCloseTo(50 * (len / 102), 2);
    expect(z).toBe(22.5);
  });

  it('triangulates the terrain grid as a TIN', () => {
    expect(all('Surface')[0]?.getAttribute('name')).toBe('DTM');
    const pts = all('P');
    expect(pts.length).toBe(9);
    expect(all('F').length).toBe(8);
    const ids = new Set(pts.map((p) => p.getAttribute('id')));
    for (const f of all('F')) for (const i of f.textContent!.split(' ')) expect(ids.has(i)).toBe(true);
    expect(pts[4]!.textContent!.split(' ').length).toBe(3);
    expect(pts[4]!.textContent!.endsWith(' 14.000')).toBe(true);
  });

  it('omits surfaces without terrain', () => {
    expect(buildLandXml({ network, origin, title: 'x', terrain: null })).not.toContain('<Surfaces>');
  });
});
