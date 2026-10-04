import type { LngLat, Network, TerrainGrid } from '@drip-urban/core';
import { toUtm, utmZone } from './dxf';
import { gridLngLat, utmEpsg } from './terrain';

/**
 * LandXML 1.2 of the project for Civil 3D, InfraWorks, 12d, Trimble Business Center: road axes as
 * alignments (lines in WGS84 / UTM metres), vertical profiles (PVI and parabolic curves) and the
 * terrain grid as a TIN surface. LandXML writes points as "northing easting [elevation]".
 */

const n3 = (v: number) => (Number.isFinite(v) ? (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3) : '0.000');

/** Escapes text and attribute values; drops characters XML 1.0 does not allow. */
export function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildLandXml(opts: { network: Network; origin: LngLat; title: string; terrain?: TerrainGrid | null; now?: Date }): string {
  const zone = utmZone(opts.origin[0]);
  const epsg = utmEpsg(zone, opts.origin[1]);
  const NE = (p: LngLat, z?: number) => { const [e, n] = toUtm(p[0], p[1], zone); return z === undefined ? `${n3(n)} ${n3(e)}` : `${n3(n)} ${n3(e)} ${n3(z)}`; };
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd" version="1.2" date="${iso.slice(0, 10)}" time="${iso.slice(11, 19)}" language="Italian" readOnly="false">`);
  out.push('  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>');
  const hemi = opts.origin[1] < 0 ? 'S' : 'N';
  out.push(`  <CoordinateSystem name="WGS 84 / UTM zone ${zone}${hemi}" epsgCode="${epsg}" ogcWktCode="" horizontalDatum="WGS84" horizontalCoordinateSystemName="WGS 84 / UTM zone ${zone}${hemi}" fileLocation=""/>`);
  out.push(`  <Project name="${xmlEscape(opts.title)}" desc="Esportato da DRIP Urban"/>`);
  out.push('  <Application name="DRIP Urban" desc="Progettazione urbana e stradale" manufacturer="DRIP" version="2.0"/>');

  // Alignments: one per road with a polyline axis; names must be unique for Civil 3D.
  const roads = Object.values(opts.network.roads).filter((r) => r.axis.length >= 2);
  if (roads.length) {
    out.push('  <Alignments name="Assi stradali">');
    const used = new Map<string, number>();
    for (const r of roads) {
      const baseName = (r.name || r.id).trim() || r.id;
      const k = (used.get(baseName) ?? 0) + 1;
      used.set(baseName, k);
      const name = k > 1 ? `${baseName} (${k})` : baseName;
      const pts = r.axis.map((p) => toUtm(p[0], p[1], zone));
      const segs: string[] = [];
      let sta = 0;
      for (let i = 1; i < pts.length; i++) {
        const [e0, n0] = pts[i - 1]!, [e1, n1] = pts[i]!;
        const len = Math.hypot(e1 - e0, n1 - n0);
        if (len < 1e-4) continue;
        segs.push(`        <Line staStart="${n3(sta)}" length="${n3(len)}"><Start>${n3(n0)} ${n3(e0)}</Start><End>${n3(n1)} ${n3(e1)}</End></Line>`);
        sta += len;
      }
      if (!segs.length) continue;
      out.push(`    <Alignment name="${xmlEscape(name)}" length="${n3(sta)}" staStart="0" desc="${xmlEscape(`${r.roadClass} · ${r.id}`)}">`);
      out.push('      <CoordGeom>', ...segs, '      </CoordGeom>');
      const pvis = r.vertical?.pvis ?? [];
      if (pvis.length >= 2) {
        // Stations are ground chainage; the alignment is measured on the UTM grid (scale ≈ 0.9996).
        // Rescale so the profile ends exactly at the alignment end (only for small discrepancies).
        const last = pvis[pvis.length - 1]!.station;
        const k = last > 0 && Math.abs(sta / last - 1) < 0.01 ? sta / last : 1;
        out.push(`      <Profile name="${xmlEscape(name)}">`);
        out.push(`        <ProfAlign name="${xmlEscape(`Profilo di progetto · ${name}`)}">`);
        pvis.forEach((v, i) => {
          const inner = i > 0 && i < pvis.length - 1;
          out.push(inner && v.curveLength && v.curveLength > 0
            ? `          <ParaCurve length="${n3(v.curveLength * k)}">${n3(v.station * k)} ${n3(v.elevation)}</ParaCurve>`
            : `          <PVI>${n3(v.station * k)} ${n3(v.elevation)}</PVI>`);
        });
        out.push('        </ProfAlign>', '      </Profile>');
      }
      out.push('    </Alignment>');
    }
    out.push('  </Alignments>');
  }

  // Terrain: regular grid as TIN, two triangles per cell, counter-clockwise in plan.
  const g = opts.terrain;
  if (g && g.nx >= 2 && g.ny >= 2 && g.z.length >= g.nx * g.ny) {
    out.push('  <Surfaces>');
    out.push(`    <Surface name="DTM" desc="${xmlEscape(`Modello del terreno · ${g.source} · ${g.resolutionM} m`)}">`);
    out.push('      <Definition surfType="TIN">');
    out.push('        <Pnts>');
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) out.push(`          <P id="${j * g.nx + i + 1}">${NE(gridLngLat(g, i, j), g.z[j * g.nx + i]!)}</P>`);
    out.push('        </Pnts>');
    out.push('        <Faces>');
    for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
      const a = j * g.nx + i + 1, b = a + 1, c = a + g.nx + 1, d = a + g.nx;
      out.push(`          <F>${a} ${b} ${c}</F>`, `          <F>${a} ${c} ${d}</F>`);
    }
    out.push('        </Faces>');
    out.push('      </Definition>');
    out.push('    </Surface>');
    out.push('  </Surfaces>');
  }
  out.push('</LandXML>');
  return out.join('\n') + '\n';
}
