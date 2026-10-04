import { describe, expect, it } from 'vitest';
import { buildIfc, compressGuid, stepString, triangulate } from '../src/export/ifc';
import { furniture, network, origin, physical, terrain } from './exportFixture';

describe('IFC export', () => {
  const title = 'Comune di Prova · Scenario «A»';
  const ifc = buildIfc({ network, physical, origin, title, terrain, furniture });
  const data = ifc.slice(ifc.indexOf('DATA;') + 5, ifc.lastIndexOf('ENDSEC;'));
  const entities = data.split('\n').filter((l) => l.startsWith('#'));

  it('has a valid ISO-10303-21 envelope for IFC4X3_ADD2', () => {
    expect(ifc.startsWith('ISO-10303-21;\nHEADER;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4X3_ADD2'));");
    expect(ifc.trim().endsWith('ENDSEC;\nEND-ISO-10303-21;')).toBe(true);
    expect((ifc.match(/^ENDSEC;$/gm) ?? []).length).toBe(2);
    for (const l of entities) expect(l).toMatch(/^#\d+=IFC[A-Z0-9]+\(.*\);$/);
    expect(/[^\x20-\x7E\n]/.test(ifc)).toBe(false); // pure ASCII
  });

  it('references only defined entities', () => {
    const defined = new Set(entities.map((l) => Number(l.slice(1, l.indexOf('=')))));
    expect(defined.size).toBe(entities.length);
    // Strip string literals before looking for references.
    for (const l of entities) {
      for (const m of l.slice(l.indexOf('=')).replace(/'(?:[^']|'')*'/g, "''").matchAll(/#(\d+)/g)) expect(defined.has(Number(m[1]))).toBe(true);
    }
  });

  it('writes unique, stable 22-character GlobalIds', () => {
    const rooted = entities.filter((l) => /=IFC(PROJECT|SITE|ROAD|COURSE|GEOGRAPHICELEMENT|FURNITURE|SIGN|REL[A-Z]+)\(/.test(l));
    const ids = rooted.map((l) => /\('([^']*)'/.exec(l)![1]!);
    expect(ids.length).toBeGreaterThan(8);
    for (const g of ids) expect(g).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(new Set(ids).size).toBe(ids.length);
    const again = buildIfc({ network, physical, origin, title, terrain, furniture });
    expect(/IFCPROJECT\('([^']*)'/.exec(again)![1]).toBe(/IFCPROJECT\('([^']*)'/.exec(ifc)![1]);
  });

  it('georeferences with IfcMapConversion to UTM 33N and SI units', () => {
    expect(ifc).toMatch(/IFCPROJECTEDCRS\('EPSG:32633'/);
    expect(ifc).toMatch(/IFCMAPCONVERSION\(#\d+,#\d+,4\d{5}\.\d+,45\d{5}\.\d+,0\.,1\.,0\.,1\.,\$,\$\)/);
    for (const u of ['.METRE.', '.SQUARE_METRE.', '.CUBIC_METRE.', '.RADIAN.']) expect(ifc).toContain(u);
  });

  it('contains the spatial structure and the elements', () => {
    expect(ifc).toMatch(/IFCSITE\(.*\(40,56,24,0\),\(14,16,12,0\),/); // RefLatitude / RefLongitude of 40.94 N, 14.27 E
    expect(ifc).toMatch(/IFCROAD\('[^']{22}',\$,'Rete stradale'/);
    expect((ifc.match(/IFCRELAGGREGATES\(/g) ?? []).length).toBe(2);
    expect(ifc).toContain("'Marciapiede \\X2\\00B7\\X0\\ Via dell''Unit\\X2\\00E0\\X0\\ & <Italia>'");
    expect(ifc).toMatch(/IFCCOURSE\(.*\.PAVEMENT\.\);/);
    expect(ifc).toMatch(/IFCGEOGRAPHICELEMENT\(.*\.TERRAIN\.\);/);
    expect(ifc).toMatch(/IFCFURNITURE\(.*'Panchina lineare'/);
    expect(ifc).toMatch(/IFCRECTANGLEPROFILEDEF\(\.AREA\.,\$,\$,1\.8,0\.6\)/);
    expect(ifc).toMatch(/IFCSIGN\(.*\.PICTORAL\.\);/);
    expect(ifc).not.toContain('furniture.bin'); // removed asset
    expect(ifc).toMatch(/IFCRELCONTAINEDINSPATIALSTRUCTURE\(/);
    // Sidewalk square: 4 vertices, 2 triangles, draped on the terrain + 0.15 m.
    const fs = /IFCCARTESIANPOINTLIST3D\(\((.*)\),\$\)/.exec(ifc)!;
    const pts = fs[1]!.slice(1, -1).split('),(').map((s) => s.split(',').map(Number));
    expect(pts.length).toBe(4);
    for (const p of pts) { expect(p[2]).toBeGreaterThan(10); expect(p[2]).toBeLessThan(19); }
    expect(ifc).toMatch(/IFCTRIANGULATEDFACESET\(#\d+,\$,\$,\(\(\d,\d,\d\),\(\d,\d,\d\)\),\$\)/);
  });
});

describe('IFC helpers', () => {
  it('compresses a GUID to 22 IFC base64 characters', () => {
    expect(compressGuid(new Uint8Array(16))).toBe('0000000000000000000000');
    expect(compressGuid(new Uint8Array(16).fill(255))).toBe('3$$$$$$$$$$$$$$$$$$$$$');
  });

  it('encodes STEP strings', () => {
    expect(stepString("dell'arte")).toBe("'dell''arte'");
    expect(stepString('Città')).toBe("'Citt\\X2\\00E0\\X0\\'");
    expect(stepString('a\\b')).toBe("'a\\\\b'");
  });

  it('ear-clips concave polygons in either orientation', () => {
    const L: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    const area = (pts: [number, number][], t: [number, number, number][]) => t.reduce((s, [a, b, c]) =>
      s + ((pts[b]![0] - pts[a]![0]) * (pts[c]![1] - pts[a]![1]) - (pts[b]![1] - pts[a]![1]) * (pts[c]![0] - pts[a]![0])) / 2, 0);
    const t = triangulate(L);
    expect(t.length).toBe(4);
    expect(area(L, t)).toBeCloseTo(3, 9);
    const R = [...L].reverse();
    const t2 = triangulate(R);
    expect(t2.length).toBe(4);
    expect(area(R, t2)).toBeCloseTo(3, 9); // triangles always CCW
  });
});
