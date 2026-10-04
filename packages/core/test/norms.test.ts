import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NORMS, RULES, ScenarioHistory, checkCompliance, dmCategory, normById, searchNorms, summarizeFindings,
  type Asset, type CityBaseline, type Network, type Road, type Scenario,
} from '../src';

const baseline = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../../../services/api/seed/frattamaggiore.baseline.json.gz'))).toString('utf8')) as CityBaseline;
const scenario = (): Scenario => ({ id: 's', name: 'S', isBaseline: false, locked: false, archived: false, createdAt: '2026-01-01', operations: [] });
let n = 0;
const ids = () => `t${++n}`;

const PROJECT = { kind: 'project' as const, source: 'test' };
const O = baseline.origin;
const at = (dx: number, dy: number) => [O[0] + dx / 84_000, O[1] + dy / 111_000] as const;

function road(id: string, elements: Road['section']['elements'], extra: Partial<Road> = {}): Road {
  return {
    id, from: `${id}a`, to: `${id}b`, name: `Via ${id}`, roadClass: 'residential', axis: [at(0, 0), at(100, 0)], oneway: 'no', speedKmh: 30,
    lanes: [
      { id: `${id}f`, index: 0, direction: 'forward', widthM: 3, modes: ['car'], turns: ['through'] },
      { id: `${id}b`, index: 1, direction: 'backward', widthM: 3, modes: ['car'], turns: ['through'] },
    ],
    section: { elements }, provenance: { geometry: PROJECT, width: PROJECT }, ...extra,
  };
}

function net(roads: Road[], assets: Asset[] = []): Network {
  const nodes: Network['nodes'] = Object.fromEntries(roads.flatMap((r) => [[r.from, { id: r.from, at: r.axis[0]! }], [r.to, { id: r.to, at: r.axis[r.axis.length - 1]! }]]));
  return { nodes, roads: Object.fromEntries(roads.map((r) => [r.id, r])), assets: Object.fromEntries(assets.map((a) => [a.id, a])), junctions: {}, roundabouts: {}, signalPlans: {}, zones: {}, areas: {} };
}

const lanes = (id: string): Road['section']['elements'] => [
  { id: `${id}l1`, kind: 'lane', widthM: 3, laneId: `${id}f` }, { id: `${id}l2`, kind: 'lane', widthM: 3, laneId: `${id}b` },
];

describe('normative library', () => {
  it('has unique ids, complete entries and https sources', () => {
    const idSet = new Set(NORMS.map((x) => x.id));
    expect(idSet.size).toBe(NORMS.length);
    for (const x of NORMS) {
      expect(x.short && x.title && x.issuer && x.scope).toBeTruthy();
      expect(x.articles.length).toBeGreaterThan(0);
      expect(x.date).toMatch(/^\d{4}(-\d{2}-\d{2})?$/);
      if (x.url) expect(x.url).toMatch(/^https:\/\/(www\.normattiva\.it|eur-lex\.europa\.eu)\//);
    }
    expect(normById('cds')?.url).toBe('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285');
  });

  it('every rule cites a library entry', () => {
    for (const r of RULES) expect(normById(r.normId), r.id).toBeDefined();
  });

  it('searches by keyword, accents and article', () => {
    expect(searchNorms('ciclabili')[0]?.id).toBe('dm-557-1999');
    expect(searchNorms('rotatorie').map((x) => x.id)).toContain('dm-2006');
    expect(searchNorms('accessibilità parcheggi').map((x) => x.id)).toContain('dpr-503-1996');
    expect(searchNorms('').length).toBe(NORMS.length);
  });
});

describe('compliance checks', () => {
  it('runs on the seed network quickly and every finding references the library', () => {
    const h = new ScenarioHistory(baseline, scenario(), 't', ids);
    const t0 = performance.now();
    const findings = checkCompliance(h.network, baseline);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(findings.length).toBeGreaterThan(0);
    const fids = new Set<string>();
    for (const f of findings) {
      expect(normById(f.normId), f.id).toBeDefined();
      expect(RULES.some((r) => r.id === f.rule)).toBe(true);
      expect(f.article).toBeTruthy();
      expect(fids.has(f.id)).toBe(false);
      fids.add(f.id);
    }
    // Existing city: DM 5/11/2001 is a reference only, so nothing is an error.
    expect(findings.every((f) => f.existing && f.severity !== 'error')).toBe(true);
    const s = summarizeFindings(findings);
    expect(s.total).toBe(findings.length);
    // Project scope on an untouched baseline: nothing to report.
    expect(checkCompliance(h.network, baseline, { scope: 'project' })).toEqual([]);
  });

  it('flags a 1,20 m sidewalk as an error citing DM 5/11/2001', () => {
    const r = road('s1', [{ id: 'sw', kind: 'sidewalk', widthM: 1.2 }, ...lanes('s1'), { id: 'sw2', kind: 'sidewalk', widthM: 2 }]);
    const f = checkCompliance(net([r]), baseline).find((x) => x.rule === 'sidewalk.width');
    expect(f).toMatchObject({ severity: 'error', normId: 'dm-2001', roadId: 's1', value: 1.2, limit: 1.5 });
    // A 0,80 m sidewalk breaks the accessible path minimum (DM 236/1989).
    const g = checkCompliance(net([road('s2', [{ id: 'sw', kind: 'sidewalk', widthM: 0.8 }, ...lanes('s2')])]), baseline).find((x) => x.rule === 'sidewalk.accessible');
    expect(g).toMatchObject({ severity: 'error', normId: 'dm-236-1989' });
  });

  it('flags a 1,00 m one-way cycle lane as an error citing DM 557/1999', () => {
    const r = road('c1', [{ id: 'sw', kind: 'sidewalk', widthM: 1.5 }, { id: 'cy', kind: 'cycle', widthM: 1.0 }, ...lanes('c1')]);
    const f = checkCompliance(net([r]), baseline).find((x) => x.rule === 'cycle.width');
    expect(f).toMatchObject({ severity: 'error', normId: 'dm-557-1999', article: 'art. 7', value: 1, limit: 1.5 });
    const ok = road('c2', [{ id: 'cy1', kind: 'cycle', widthM: 1.25 }, { id: 'cy2', kind: 'cycle', widthM: 1.25 }, ...lanes('c2')]);
    expect(checkCompliance(net([ok]), baseline).some((x) => x.rule === 'cycle.width')).toBe(false);
  });

  it('warns about three main signs on one pole (art. 81 Reg. CdS) but not about plates', () => {
    const sign = (id: string, type: string, k: number): Asset => ({ id, type, at: at(10, 5), rotationDeg: 0, state: 'project', properties: { poleId: 'p1', stackOrder: k }, provenance: PROJECT });
    const assets = [sign('a1', 'it.sign.divieto_di_sosta', 0), sign('a2', 'it.sign.senso_unico', 1), sign('a3', 'it.sign.dare_precedenza', 2)];
    const f = checkCompliance(net([], assets), baseline).find((x) => x.rule === 'sign.pole');
    expect(f).toMatchObject({ severity: 'warning', normId: 'reg-cds', article: 'art. 81', value: 3 });
    const plates = [sign('b1', 'it.sign.divieto_di_sosta', 0), sign('b2', 'it.sign.senso_unico', 1), sign('b3', 'it.sign.pannello_integrativo_rimozione', 2)];
    expect(checkCompliance(net([], plates), baseline).some((x) => x.rule === 'sign.pole')).toBe(false);
  });

  it('checks lane widths by DM category and speed limits', () => {
    const narrow = road('l1', lanes('l1'), { roadClass: 'tertiary', lanes: [{ id: 'x', index: 0, direction: 'forward', widthM: 2.6, modes: ['car'], turns: [] }] });
    expect(dmCategory(narrow)?.code).toBe('E');
    const f = checkCompliance(net([narrow]), baseline).find((x) => x.rule === 'lane.width');
    expect(f).toMatchObject({ severity: 'error', limit: 3, normId: 'dm-2001' });
    const fast = road('v1', lanes('v1'), { speedKmh: 60 });
    expect(checkCompliance(net([fast]), baseline).find((x) => x.rule === 'speed.urban')?.normId).toBe('cds');
  });

  it('checks roundabout diameter classes (DM 19/4/2006)', () => {
    const base = net([]);
    const rb = { id: 'rb1', name: 'Rotatoria', type: 'mini' as const, center: at(0, 0), outerDiameterM: 32, aspect: 1, orientationDeg: 0, circulatoryWidthM: 6, lanes: 1 as const, apronWidthM: 1, islandMaterial: 'grass', control: 'yield' as const, speedKmh: 30, arms: [] };
    const f = checkCompliance({ ...base, roundabouts: { rb1: rb } }, baseline).filter((x) => x.roundaboutId === 'rb1').map((x) => x.rule);
    expect(f).toContain('roundabout.diameter');
    expect(f).toContain('roundabout.ring');
  });
});
