/** Road signs in the Twin: plate sizes and SVG rasters. */
/** Formato normale (art. 80 Reg. CdS) by sign family, metres. */
export const SIGN_SIZE: Record<string, number> = { warning: 0.9, priority: 0.9, temporary: 0.9, prohibition: 0.6, mandatory: 0.6, parking: 0.6, information: 0.6, ztl: 0.6, direction: 0.9 };
const signRasters = new Map<string, Promise<{ canvas: HTMLCanvasElement; aspect: number } | null>>();
/**
 * Sign SVGs rasterised once (WebGL cannot upload an SVG without intrinsic size): 512 px on the long
 * side, with the drawing's own proportions so rectangular plates are not squeezed into a square.
 */
export function signRaster(url: string): Promise<{ canvas: HTMLCanvasElement; aspect: number } | null> {
  let p = signRasters.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        const canvas = document.createElement('canvas');
        canvas.width = aspect >= 1 ? 512 : Math.round(512 * aspect);
        canvas.height = aspect >= 1 ? Math.round(512 / aspect) : 512;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ canvas, aspect });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    signRasters.set(url, p);
  }
  return p;
}

