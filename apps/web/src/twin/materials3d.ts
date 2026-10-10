import * as C from 'cesium';
import type { ProjectMaterial, LngLat } from '@drip-urban/core';
import { materialCanvas, textureUrl } from '../models/materials';
const images = new Map<string, { canvas: HTMLCanvasElement; normal: HTMLImageElement | null }>();
export async function prepareMaterials(materials: readonly ProjectMaterial[]) {
  await Promise.all(materials.filter((m) => m.id.startsWith('custom.')).map(async (m) => {
    const canvas = await materialCanvas(m), normal = m.normalMap ? new Image() : null;
    if (normal) { normal.src = textureUrl(m.normalMap!); await normal.decode(); }
    images.set(m.id, { canvas, normal });
  }));
  const live = new Set(materials.map((m) => m.id)); for (const id of images.keys()) if (!live.has(id)) images.delete(id);
}
/** Metric UV coordinates on local planes, independent of polygon bounds and tessellation. */
export function texturedPolygon(polygon: C.PolygonGeometry, material: ProjectMaterial, origin: LngLat) {
  const geometry = C.PolygonGeometry.createGeometry(polygon);
  if (!geometry) return null;
  const positions = geometry.attributes.position!.values, uv = new Float32Array(positions.length / 3 * 2);
  const inverse = C.Matrix4.inverseTransformation(C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(origin[0], origin[1])), new C.Matrix4());
  for (let i = 0; i < positions.length; i += 3) {
    const p = C.Matrix4.multiplyByPoint(inverse, new C.Cartesian3(positions[i], positions[i + 1], positions[i + 2]), new C.Cartesian3());
    uv[i / 3 * 2] = p.x / material.scaleM; uv[i / 3 * 2 + 1] = p.y / material.scaleM;
  }
  geometry.attributes.st = new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: uv });
  return geometry;
}
export function materialAppearance(m: ProjectMaterial | undefined): C.MaterialAppearance | null {
  if (!m) return null;
  const image = images.get(m.id); if (!image) return null;
  const fabric = { type: 'DripProjectMaterial', uniforms: { image: image.canvas, normalImage: image.normal ?? image.canvas, hasNormal: image.normal ? 1 : 0, roughness: m.roughness, metallic: m.metallic ?? 0, opacity: m.opacity ?? 1, emission: m.emissive ?? 0, bump: m.bump ?? 0 }, source: `
    czm_material czm_getMaterial(czm_materialInput materialInput) {
      czm_material m = czm_getDefaultMaterial(materialInput);
      vec4 c = texture(image, fract(materialInput.st));
      m.diffuse = c.rgb; m.alpha = c.a * opacity;
      m.specular = mix(0.04, 0.95, metallic); m.shininess = mix(128.0, 1.0, roughness);
      m.emission = c.rgb * emission;
      if (hasNormal > 0.5) { vec3 n = texture(normalImage, fract(materialInput.st)).rgb * 2.0 - 1.0; m.normal = normalize(materialInput.normalEC + vec3(n.xy * max(bump, 1.0), 0.0) * 0.2); }
      else if (bump > 0.0) { float b = dot(c.rgb, vec3(0.2126,0.7152,0.0722)); m.normal = normalize(materialInput.normalEC + vec3(dFdx(b),dFdy(b),0.0) * bump); }
      return m;
    }` };
  return new C.MaterialAppearance({ material: new C.Material({ fabric, translucent: (m.opacity ?? 1) < 1 }), materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, faceForward: true, translucent: (m.opacity ?? 1) < 1 });
}
