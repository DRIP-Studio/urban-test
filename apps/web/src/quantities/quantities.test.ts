import { describe, expect, it } from 'vitest';
import {
  computeQuantities, computeTotals, computoCsv, DEFAULT_PRICES, importPriceCsv, lineLengthM, matchPrice, overrideFor, polygonAreaM2,
  priceItems, ringAreaM2, withOverride, EMPTY_PRICELIST, type FeatureLike, type PriceItem, type QtyItem,
} from './quantities';

// Metres per degree near lat 41° (WGS84), for building test rectangles.
const LAT = 41, LON = 14.27;
const MLAT = 111_052.0, MLON = 84_137.0;
const rect = (x0: number, y0: number, w: number, h: number) => {
  const p = (x: number, y: number) => [LON + x / MLON, LAT + y / MLAT];
  return [p(x0, y0), p(x0 + w, y0), p(x0 + w, y0 + h), p(x0, y0 + h), p(x0, y0)];
};
const poly = (props: Record<string, unknown>, ...rings: number[][][]): FeatureLike => ({ geometry: { type: 'Polygon', coordinates: rings }, properties: props });

describe('geodesic measures', () => {
  it('measures a 10 m × 20 m rectangle near lat 41° as 200 m² (±0.5%)', () => {
    expect(ringAreaM2(rect(0, 0, 10, 20))).toBeGreaterThan(199);
    expect(ringAreaM2(rect(0, 0, 10, 20))).toBeLessThan(201);
    // Open ring and reversed orientation give the same value.
    expect(ringAreaM2(rect(0, 0, 10, 20).slice(0, 4).reverse())).toBeCloseTo(ringAreaM2(rect(0, 0, 10, 20)), 6);
  });

  it('subtracts holes', () => {
    const a = polygonAreaM2([rect(0, 0, 20, 20), rect(5, 5, 10, 10)]);
    expect(a).toBeGreaterThan(300 * 0.995);
    expect(a).toBeLessThan(300 * 1.005);
  });

  it('measures line length', () => {
    expect(lineLengthM([[LON, LAT], [LON + 100 / MLON, LAT]])).toBeCloseTo(100, 0);
  });
});

describe('computeQuantities', () => {
  const q = computeQuantities({
    surfaces: [
      poly({ kind: 'carriageway', material: 'asphalt', state: 'project', roadId: 'r1' }, rect(0, 0, 10, 20)),
      poly({ kind: 'sidewalk', material: 'concrete_pavers', state: 'project', roadId: 'r1' }, rect(0, 20, 10, 2)),
      poly({ kind: 'carriageway', material: 'asphalt', state: 'existing', roadId: 'r2' }, rect(50, 0, 10, 20)),
    ],
    markings: [poly({ kind: 'zebra', material: 'road_marking_white', state: 'project' }, rect(0, 0, 4, 2.5))],
    lines: [{ geometry: { type: 'LineString', coordinates: [[LON, LAT], [LON + 30 / MLON, LAT]] }, properties: { kind: 'kerb', state: 'project' } }],
    baselineSurfaces: [
      poly({ kind: 'carriageway', material: 'asphalt', state: 'existing', roadId: 'r1' }, rect(0, 0, 8, 20)),
      poly({ kind: 'carriageway', material: 'asphalt', state: 'existing', roadId: 'r2' }, rect(50, 0, 10, 20)),
    ],
    assets: [
      { id: 'a1', type: 'it.sign.II.1', state: 'project', properties: { poleId: 'p1' } },
      { id: 'a2', type: 'it.sign.II.2', state: 'project', properties: { poleId: 'p1' } },
      { id: 'a3', type: 'it.sign.II.1', state: 'project', properties: {} },
      { id: 'a4', type: 'vegetation.tree', state: 'project', properties: {} },
      { id: 'a5', type: 'furniture.bench', state: 'project', properties: {} },
      { id: 'a6', type: 'furniture.bench', state: 'existing', properties: {} },
      { id: 'a7', type: 'furniture.bin', state: 'removed', properties: {} },
      { id: 'a8', type: 'signal.vehicle', state: 'project', properties: {} },
    ],
    signalPlanIds: ['sp1', 'sp2'], baselineSignalPlanIds: ['sp1'],
  });
  const by = (key: string) => q.find((r) => r.key === key);

  it('measures paving, demolition, kerbs and markings on project state only', () => {
    expect(by('pav|carriageway||asphalt')!.quantity).toBeCloseTo(200, -1);
    expect(by('pav|sidewalk||concrete_pavers')!.quantity).toBeCloseTo(20, 0);
    expect(by('demo|stradale')!.quantity).toBeCloseTo(160, -1); // r2 untouched
    expect(by('kerb')!.quantity).toBeCloseTo(30, 0);
    expect(by('mark|zebra|road_marking_white')!.quantity).toBeCloseTo(10, 0);
  });

  it('counts assets, poles and new signal plans', () => {
    expect(by('sign|it.sign.II.1')!.quantity).toBe(2);
    expect(by('pole')!.quantity).toBe(2);
    expect(by('asset|vegetation.tree')!.kind).toBe('tree');
    expect(by('asset|furniture.bench')!.quantity).toBe(1);
    expect(by('rem|furniture.bin')!.chapter).toBe('Demolizioni e rimozioni');
    expect(by('head|signal.vehicle')!.quantity).toBe(1);
    expect(by('plan')!.quantity).toBe(1);
    expect(q[0]!.code).toBe('02.001'); // chapter numbers are fixed (01 = Movimenti terra)
  });

  it('prices every row with the default list', () => {
    const priced = priceItems(q, EMPTY_PRICELIST);
    expect(priced.every((r) => r.unitPrice !== undefined)).toBe(true);
    expect(priced.find((r) => r.key === 'asset|furniture.bench')!.unitPrice).toBe(900);
    expect(priced.find((r) => r.key === 'asset|vegetation.tree')!.unitPrice).toBe(650);
  });
});

describe('price matching', () => {
  const row: Pick<QtyItem, 'chapter' | 'kind' | 'material' | 'assetType' | 'unit'> = { chapter: 'Pavimentazioni', kind: 'sidewalk', material: 'porphyry', unit: 'm²' };
  const P = (code: string, match: PriceItem['match'], unit: PriceItem['unit'] = 'm²'): PriceItem => ({ code, description: code, unit, price: 1, match, origin: 'import' });

  it('picks the most specific entry: assetType > material > kind > chapter', () => {
    const items = [P('ch', { chapter: 'Pavimentazioni' }), P('kind', { kind: 'sidewalk' }), P('mat', { material: 'porphyry' })];
    expect(matchPrice(row, items)!.code).toBe('mat');
    expect(matchPrice(row, items.slice(0, 2))!.code).toBe('kind');
    expect(matchPrice(row, items.slice(0, 1))!.code).toBe('ch');
    expect(matchPrice({ ...row, assetType: 'x' }, [...items, P('asset', { assetType: 'x' })])!.code).toBe('asset');
  });

  it('ignores entries with other units or conflicting fields', () => {
    expect(matchPrice(row, [P('m', { material: 'porphyry' }, 'm'), P('other', { material: 'granite' })])).toBeNull();
  });

  it('lets a row override beat imported and default entries', () => {
    const q = { ...row, code: '01.001', description: 'x', quantity: 10, source: '', key: 'k' } as QtyItem;
    const list = withOverride({ ...EMPTY_PRICELIST, items: [P('mat', { chapter: 'Pavimentazioni', kind: 'sidewalk', material: 'porphyry' })] }, overrideFor(q, 123));
    expect(priceItems([q], list)[0]!.unitPrice).toBe(123);
    expect(priceItems([q], list)[0]!.amount).toBe(1230);
    expect(DEFAULT_PRICES.length).toBeGreaterThan(30);
  });
});

describe('CSV price list import', () => {
  it('reads ; separated files with decimal comma, quotes and mapping columns', () => {
    const csv = '﻿Codice;Descrizione;Unità;Prezzo;Capitolo;Materiale\r\n'
      + 'CAM.U05.010;"Cubetti di porfido; posa a ventaglio";mq;"1.234,50";Pavimentazioni;porphyry\r\n'
      + 'CAM.U05.020;Cordolo;ml;45,8;Cordoli;\r\n'
      + '\r\n'
      + 'X1;Voce errata;kg;10;;\r\n'
      + 'X2;Prezzo errato;cad;abc;;\r\n';
    const r = importPriceCsv(csv);
    expect(r.separator).toBe(';');
    expect(r.rows).toBe(4);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ code: 'CAM.U05.010', description: 'Cubetti di porfido; posa a ventaglio', unit: 'm²', price: 1234.5, match: { chapter: 'Pavimentazioni', material: 'porphyry' } });
    expect(r.items[1]).toMatchObject({ unit: 'm', price: 45.8, match: { chapter: 'Cordoli' } });
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/Riga 5/);
  });

  it('auto-detects comma separators and reports missing columns', () => {
    const r = importPriceCsv('code,description,unit,price\nA,Asfalto,m2,25.5\n');
    expect(r.separator).toBe(',');
    expect(r.items[0]!.price).toBe(25.5);
    expect(importPriceCsv('codice;descrizione\nA;B').errors[0]).toMatch(/unità, prezzo/);
  });
});

describe('totals and export', () => {
  const rows: QtyItem[] = [
    { chapter: 'Pavimentazioni', code: '01.001', description: 'A', unit: 'm²', quantity: 100, unitPrice: 25, amount: 2500, source: '', key: 'a', priceOrigin: 'default' },
    { chapter: 'Cordoli', code: '03.001', description: 'B', unit: 'm', quantity: 10, unitPrice: 50, amount: 500, source: '', key: 'b', priceOrigin: 'import' },
    { chapter: 'Cordoli', code: '03.002', description: 'C', unit: 'm', quantity: 5, source: '', key: 'c' },
  ];

  it('adds safety charges on works and VAT on works + safety', () => {
    const t = computeTotals(rows, 10, 3);
    expect(t.works).toBe(3000);
    expect(t.safety).toBe(90);
    expect(t.taxable).toBe(3090);
    expect(t.vat).toBe(309);
    expect(t.total).toBe(3399);
    expect(t.byChapter.Cordoli).toBe(500);
    expect(t.unpriced).toBe(1);
  });

  it('writes an Italian CSV with BOM, ; separator, decimal comma and the default price notice', () => {
    const t = computeTotals(rows, 10, 3);
    const s = computoCsv(rows, t, { project: 'P', scenario: 'S', priceList: 'L', priceSource: 'F', vatPct: 10, safetyPct: 3, date: '04/10/2026' });
    expect(s.startsWith('﻿')).toBe(true);
    expect(s).toContain('Prezzi indicativi DRIP — sostituire con il prezziario regionale vigente');
    expect(s).toContain('Pavimentazioni;01.001;A;m²;100,00;25,00;2500,00');
    expect(s).toContain(';;Totale complessivo;;;;3399,00');
  });
});

describe('movimenti terra', () => {
  it('turns profile earthworks into cut, fill and surplus rows priced per m³', () => {
    const q = computeQuantities({
      surfaces: [], markings: [], lines: [], baselineSurfaces: [], assets: [], signalPlanIds: [], baselineSignalPlanIds: [],
      earthworks: [{ roadName: 'Via A', cutM3: 1200, fillM3: 300 }, { roadName: 'Via B', cutM3: 100, fillM3: 200 }],
    });
    const by = (k: string) => q.find((r) => r.key === k)!;
    expect(by('ew|cut').quantity).toBe(1300);
    expect(by('ew|fill').quantity).toBe(500);
    expect(by('ew|surplus').quantity).toBe(800);
    expect(q.every((r) => r.chapter === 'Movimenti terra' && r.code.startsWith('01.'))).toBe(true);
    const priced = priceItems(q, { name: '', source: '', items: [], useDefaults: true });
    expect(priced.find((r) => r.key === 'ew|cut')!.unitPrice).toBeGreaterThan(0);
  });
});
