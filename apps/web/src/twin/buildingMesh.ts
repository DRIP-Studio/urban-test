import type { BuildingStyle } from '@drip-urban/core';
import * as Cesium from 'cesium';
import earcut from 'earcut';
import { buildingLook } from '../models/buildings';

/**
 * Buildings for the Twin: walls and roofs as one geometry with metric texture coordinates
 * (st = metres along the wall, metres above the base; roofs st.y < 0), so the shader can draw
 * floors, windows, shutters and roof tiles at real scale. Colours are the same plaster/tile tones
 * of the 2D map (buildingLook).
 */
export interface TwinBuilding extends BuildingStyle { readonly id: string; readonly footprint: readonly (readonly [number, number])[]; readonly heightM: number; readonly minHeightM: number }

const hash = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; };
const rgb = (c: string) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const; };

export function buildingGeometry(buildings: readonly TwinBuilding[], baseOf: (b: TwinBuilding) => number, translucent = false, surface: 'all' | 'facade' | 'roof' = 'all', detailed = true): Cesium.Geometry | null {
  const A = translucent ? 140 : 255;
  const pos: number[] = [], nrm: number[] = [], st: number[] = [], col: number[] = [], vari: number[] = [], params: number[] = [], idx: number[] = [];
  const scratchUp = new Cesium.Cartesian3(), e = new Cesium.Cartesian3(), n = new Cesium.Cartesian3();
  for (const b of buildings) {
    const ring = b.footprint[0]![0] === b.footprint[b.footprint.length - 1]![0] && b.footprint[0]![1] === b.footprint[b.footprint.length - 1]![1] ? b.footprint.slice(0, -1) : b.footprint;
    if (ring.length < 3) continue;
    const look = buildingLook(b.id, b.heightM, b);
    const fc = rgb(look.facade), rc = rgb(look.roof);
    const v = hash(b.id) % 251;
    const g = baseOf(b), z0 = g + b.minHeightM, z1 = g + b.heightM;
    // Orientation in a planar approximation (lon scaled by cos lat): outward normals for CCW rings.
    const k = Math.cos((ring[0]![1] * Math.PI) / 180);
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i]!, c = ring[(i + 1) % ring.length]!; area += a[0] * k * c[1] - c[0] * k * a[1]; }
    const ccw = area > 0;
    const data = [Math.max(1.8, (b.heightM - b.minHeightM) / (b.levels ?? Math.max(1, Math.round(b.heightM / 3.1)))), b.use === 'commercial' ? 1 : b.use === 'industrial' ? 2 : 0, b.balconies ? 1 : 0, 0];
    let along = 0;
    if (surface !== 'roof') for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!;
      const pa0 = Cesium.Cartesian3.fromDegrees(a[0], a[1], z0), pa1 = Cesium.Cartesian3.fromDegrees(a[0], a[1], z1);
      const pc0 = Cesium.Cartesian3.fromDegrees(c[0], c[1], z0), pc1 = Cesium.Cartesian3.fromDegrees(c[0], c[1], z1);
      const len = Cesium.Cartesian3.distance(pa0, pc0);
      if (len < 0.05) continue;
      Cesium.Cartesian3.normalize(pa0, scratchUp);
      Cesium.Cartesian3.subtract(pc0, pa0, e);
      Cesium.Cartesian3.cross(e, scratchUp, n);
      Cesium.Cartesian3.normalize(n, n);
      if (!ccw) Cesium.Cartesian3.negate(n, n);
      const base = pos.length / 3;
      for (const [p, s, t] of [[pa0, along, 0], [pc0, along + len, 0], [pc1, along + len, z1 - z0], [pa1, along, z1 - z0]] as const) {
        pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); st.push(s, t + b.minHeightM); col.push(fc[0], fc[1], fc[2], A); vari.push(v); params.push(...data);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      if (detailed && b.balconies && len > 4) {
        const tangent = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(pc0, pa0, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const up = Cesium.Cartesian3.normalize(pa0, new Cesium.Cartesian3());
        const floorH = data[0]!;
        for (let floor = 1; floor < Math.min(10, Math.floor((z1-z0)/floorH)); floor++) {
          const center = Cesium.Cartesian3.lerp(pa0, pc0, .5, new Cesium.Cartesian3());
          Cesium.Cartesian3.add(center, Cesium.Cartesian3.multiplyByScalar(up, floor*floorH, new Cesium.Cartesian3()), center);
          const point = (x: number, depth: number, height: number) => {
            const q = Cesium.Cartesian3.clone(center);
            for (const [axis, amount] of [[tangent,x],[n,depth],[up,height]] as const) Cesium.Cartesian3.add(q,Cesium.Cartesian3.multiplyByScalar(axis,amount,new Cesium.Cartesian3()),q);
            return q;
          };
          const face = (corners: Cesium.Cartesian3[], normal: Cesium.Cartesian3, shade: number) => {
            const base=pos.length/3;
            corners.forEach((q) => { pos.push(q.x,q.y,q.z); nrm.push(normal.x,normal.y,normal.z); st.push(0,-.5); col.push(fc[0]*shade,fc[1]*shade,fc[2]*shade,A); vari.push(253); params.push(...data); });
            idx.push(base,base+1,base+2,base,base+2,base+3);
          };
          face([point(-1,0,0),point(1,0,0),point(1,.85,0),point(-1,.85,0)],up,.9);
          face([point(-1,.85,-.14),point(1,.85,-.14),point(1,.85,0),point(-1,.85,0)],n,.6);
          // Front balustrade has thin uprights and a top rail rather than an opaque wall.
          for (let bar=-1; bar<=1.001; bar+=.2) face([point(bar-.015,.85,0),point(bar+.015,.85,0),point(bar+.015,.85,.9),point(bar-.015,.85,.9)],n,.4);
          face([point(-1,.85,.87),point(1,.85,.87),point(1,.85,.93),point(-1,.85,.93)],n,.4);
        }
      }
      along += len;
    }
    if (surface === 'facade') continue;
    // Roof: the footprint triangulated at the top; st.y < 0 marks it, st.x carries the tile direction.
    const origin = ring[0]!, local = ring.map((p) => [(p[0]-origin[0])*k*111320,(p[1]-origin[1])*110540] as [number,number]);
    const xs=local.map((p) => p[0]), lo=Math.min(...xs), hi=Math.max(...xs), mid=(lo+hi)/2;
    const pitched = b.roofShape ? b.roofShape !== 'flat' : look.roofH > .5;
    const ys=local.map((p)=>p[1]), lowY=Math.min(...ys), highY=Math.max(...ys), midY=(lowY+highY)/2;
    const roofZ = (x: number,y: number) => z1 + .15 + (pitched ? Math.max(0,Math.min(1-Math.abs(x-mid)/Math.max(.1,(hi-lo)/2), b.roofShape === 'hipped' ? 1-Math.abs(y-midY)/Math.max(.1,(highY-lowY)/2) : 1))*look.roofH : .2);
    const clip = (points: readonly [number,number][], axis: 0 | 1, positive: boolean) => {
      const out: [number,number][]=[];
      const split=axis===0?mid:midY;
      for(let i=0;i<points.length;i++) {
        const a=points[i]!, c=points[(i+1)%points.length]!, inside=(p: readonly number[]) => positive ? p[axis]! >= split : p[axis]! <= split;
        if(inside(a))out.push(a);
        if(inside(a)!==inside(c)) { const t=(split-a[axis])/(c[axis]-a[axis]);out.push([a[0]+t*(c[0]-a[0]),a[1]+t*(c[1]-a[1])]); }
      }
      return out;
    };
    let roofRings = pitched ? [clip(local,0,false),clip(local,0,true)] : [local];
    if(b.roofShape === 'hipped')roofRings=roofRings.flatMap((r)=>[clip(r,1,false),clip(r,1,true)]);
    for(const roofRing of roofRings) {
      if(roofRing.length<3)continue;
      const tris=earcut(roofRing.flat()), base=pos.length/3;
      for(const [x,y] of roofRing) {
        const q=Cesium.Cartesian3.fromDegrees(origin[0]+x/(k*111320),origin[1]+y/110540,roofZ(x,y));
        Cesium.Cartesian3.normalize(q,scratchUp);pos.push(q.x,q.y,q.z);nrm.push(scratchUp.x,scratchUp.y,scratchUp.z);
        st.push(x,-1000+y);col.push(rc[0],rc[1],rc[2],A);vari.push(pitched?v:252);params.push(...data);
      }
      for(let i=0;i<tris.length;i+=3) ccw ? idx.push(base+tris[i]!,base+tris[i+1]!,base+tris[i+2]!) : idx.push(base+tris[i]!,base+tris[i+2]!,base+tris[i+1]!);
    }
    // Roof edge band (the slab thickness) so the roof does not float.
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!;
      const pa0 = Cesium.Cartesian3.fromDegrees(a[0], a[1], z1), pa1 = Cesium.Cartesian3.fromDegrees(a[0], a[1], roofZ((a[0]-origin[0])*k*111320,(a[1]-origin[1])*110540));
      const pc0 = Cesium.Cartesian3.fromDegrees(c[0], c[1], z1), pc1 = Cesium.Cartesian3.fromDegrees(c[0], c[1], roofZ((c[0]-origin[0])*k*111320,(c[1]-origin[1])*110540));
      const len = Cesium.Cartesian3.distance(pa0, pc0);
      if (len < 0.05) continue;
      Cesium.Cartesian3.normalize(pa0, scratchUp);
      Cesium.Cartesian3.cross(Cesium.Cartesian3.subtract(pc0, pa0, e), scratchUp, n);
      Cesium.Cartesian3.normalize(n, n);
      if (!ccw) Cesium.Cartesian3.negate(n, n);
      const b0 = pos.length / 3;
      for (const p of [pa0, pc0, pc1, pa1]) { pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); st.push(s, -0.5); col.push(rc[0] * 0.8, rc[1] * 0.8, rc[2] * 0.8, A); vari.push(253); params.push(...data); }
      idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
      s += len;
    }
  }
  if (!idx.length) return null;
  const n3 = pos.length / 3;
  return new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
      normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nrm) }),
      st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
      color: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(col) }),
      buildingParams: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 4, values: new Float32Array(params) }),
      variant: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: new Float32Array(vari) }),
    } as unknown as Cesium.GeometryAttributes,
    indices: n3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(pos),
  });
}

const VS = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec4 color;
in float variant;
in vec4 buildingParams;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;
out vec4 v_color;
out float v_variant;
out vec4 v_buildingParams;
out vec3 v_groundUp;
void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_st = st;
  v_color = color;
  v_variant = variant;
  v_buildingParams = buildingParams;
  v_groundUp = normalize(czm_normal * normalize(position3DHigh + position3DLow));
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`;

/**
 * Facades: 3,1 m floors (ground floor 3,6 m with doors and shop fronts), 3,2 m bays, windows with
 * shutters (green, brown or grey per building), plinth, cornice; roofs: coppi rows or a flat terrace.
 * At night (dim scene light) a share of the windows lights up, different per building.
 */
const FS = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec2 v_st;
in vec4 v_color;
in float v_variant;
in vec4 v_buildingParams;
in vec3 v_groundUp;
// Stable hash (no sin of large arguments: GPU sin loses precision and speckles).
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 toEye = normalize(-v_positionEC);
  vec3 normalEC = normalize(v_normalEC);
  vec3 base = v_color.rgb;
  vec3 diffuse = base;
  vec3 emission = vec3(0.0);
  float light = clamp(max(max(czm_lightColorHdr.r, czm_lightColorHdr.g), czm_lightColorHdr.b), 0.0, 2.0);
  float night = 1.0 - smoothstep(-0.08,0.05,dot(normalize(czm_sunDirectionEC),normalize(v_groundUp)));
  float var = floor(v_variant + 0.5); // interpolated constant: snap to the integer id
  if (length(v_positionEC) < 2500.0 && v_st.y >= 0.0 && var < 251.5) {
    float z = v_st.y, x = v_st.x;
    float fl = v_buildingParams.x, ground = fl, bay = 3.2 + mod(var, 3.0) * 0.2;
    float bx = fract(x / bay), bi = floor(x / bay);
    // Plinth and ground-floor band.
    if (z < 0.6) diffuse = base * 0.72;
    if (z < ground) {
      float door = step(0.28, bx) * step(bx, 0.72) * step(z, 2.7);
      vec3 shop = mix(vec3(0.16, 0.18, 0.2), vec3(0.32, 0.25, 0.18), step(0.5, h21(vec2(bi, var))));
      float commercial = step(0.5, v_buildingParams.y);
      door *= commercial > 0.5 ? 1.0 : step(0.7, h21(vec2(bi,var)));
      diffuse = mix(diffuse, shop, door);
      emission += door * night * step(0.55, h21(vec2(bi, var + 7.0))) * vec3(0.9, 0.75, 0.45);
    } else {
      float fz = fract((z - ground) / fl), fi = floor((z - ground) / fl);
      float win = step(0.3, bx) * step(bx, 0.7) * step(0.22, fz) * step(fz, 0.78);
      float shutterSide = (step(0.18, bx) * step(bx, 0.3) + step(0.7, bx) * step(bx, 0.82)) * step(0.22, fz) * step(fz, 0.78);
      float kind = mod(var, 3.0);
      vec3 shutter = kind < 1.0 ? vec3(0.27, 0.36, 0.26) : kind < 2.0 ? vec3(0.42, 0.29, 0.2) : vec3(0.55, 0.55, 0.52);
      float sill = step(0.3, bx) * step(bx, 0.7) * step(0.18, fz) * step(fz, 0.22);
      vec3 glass = vec3(0.17, 0.2, 0.24) + 0.08 * pow(1.0 - abs(dot(normalEC, toEye)), 2.0);
      diffuse = mix(diffuse, shutter, shutterSide);
      diffuse = mix(diffuse, base * 1.12, sill);
      float frame = step(0.28, bx) * step(bx,0.72) * step(0.20,fz) * step(fz,0.80);
      diffuse = mix(diffuse,base*0.60,frame);
      diffuse = mix(diffuse, glass, win);
      float floorBand = step(0.96, fz); diffuse *= 1.0 - floorBand * 0.15;
      float lit = step(0.52, h21(vec2(bi * 1.7 + fi * 13.1, var)));
      emission += win * night * lit * vec3(1.0, 0.82, 0.52) * (0.65 + 0.35 * h21(vec2(fi, bi + var)));
    }
  } else if (length(v_positionEC) < 2500.0 && v_st.y < 0.0 && var < 251.5) {
    // Coppi: rows every 0,3 m with a curved highlight, slight colour jitter per row.
    float r = fract(v_st.y * 3.3);
    float row = floor(v_st.y * 3.3);
    diffuse = base * (0.82 + 0.25 * sin(r * 3.14159)) * (0.94 + 0.12 * h21(vec2(row, var)));
  } else if (length(v_positionEC) < 2500.0 && var > 251.5 && var < 252.5) {
    // Flat terrace: cement with a light grid of joints.
    vec2 g = fract(v_st / vec2(1.0, 1.0));
    diffuse = base * (0.95 - 0.12 * step(0.96, max(g.x, g.y)));
  }
  czm_materialInput mi;
  mi.normalEC = normalEC;
  mi.positionToEyeEC = -v_positionEC;
  czm_material m = czm_getDefaultMaterial(mi);
  m.diffuse = czm_gammaCorrect(vec4(diffuse, 1.0)).rgb * mix(1.0, 0.22, night) * clamp(light, 0.35, 1.0);
  m.emission = emission;
  m.alpha = v_color.a;
  out_FragColor = czm_phong(toEye, m, czm_lightDirectionEC);
}`;

export function buildingAppearance(translucent: boolean): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent,
    closed: false,
    vertexShaderSource: VS,
    fragmentShaderSource: FS,
    renderState: translucent
      ? { depthTest: { enabled: true }, depthMask: false, blending: Cesium.BlendingState.ALPHA_BLEND }
      : { depthTest: { enabled: true }, depthMask: true },
  });
}
