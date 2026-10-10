import { create } from 'zustand';
import type { ProjectMaterial } from '@drip-urban/core';
import { useApp } from '../state/store';
import { patternImage } from '../map/patterns';

const cache = new Map<string, Promise<HTMLCanvasElement>>();
export const textureUrl = (id: string) => `/api/projects/${encodeURIComponent(useApp.getState().project!.id)}/textures/${encodeURIComponent(id)}`;
export function materialCanvas(m: ProjectMaterial, z = 21): Promise<HTMLCanvasElement> {
  const key = `${useApp.getState().project?.id}:${z}:${JSON.stringify(m)}`;
  const hit = cache.get(key); if (hit) return hit;
  const result = (async () => {
    const source = document.createElement('canvas');
    if (m.texture) {
      const image = new Image(); image.src = textureUrl(m.texture); await image.decode();
      const [x, y, w, h] = m.crop ?? [0, 0, 1, 1];
      source.width = Math.min(1024, Math.max(1, Math.round(image.width * w))); source.height = Math.min(1024, Math.max(1, Math.round(image.height * h)));
      source.getContext('2d')!.drawImage(image, image.width * x, image.height * y, image.width * w, image.height * h, 0, 0, source.width, source.height);
    } else {
      const pattern = patternImage(m, z); source.width = pattern?.width ?? 128; source.height = pattern?.height ?? 128;
      const g = source.getContext('2d')!; if (pattern) g.putImageData(pattern, 0, 0); else { g.fillStyle = m.color; g.fillRect(0, 0, source.width, source.height); }
    }
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const g = canvas.getContext('2d')!;
    g.filter = `brightness(${m.brightness ?? 1}) contrast(${m.contrast ?? 1})`;
    g.translate(canvas.width / 2, canvas.height / 2); g.rotate((m.rotationDeg ?? 0) * Math.PI / 180);
    const pattern = g.createPattern(source, 'repeat')!;
    const [dx, dy] = m.offset ?? [0, 0]; pattern.setTransform(new DOMMatrix().translate(dx / m.scaleM * canvas.width, dy / m.scaleM * canvas.height));
    g.fillStyle = pattern; g.fillRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2);
    if (m.texture && m.color !== '#ffffff') { g.globalCompositeOperation = 'multiply'; g.fillStyle = m.color; g.fillRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2); }
    return canvas;
  })();
  cache.set(key, result); if (cache.size > 64) cache.delete(cache.keys().next().value!);
  result.catch(() => cache.delete(key)); return result;
}

export const useMaterialUi = create<{ selectedId: string | null }>(() => ({ selectedId: null }));
