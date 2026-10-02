export interface Basemap {
  readonly id: string;
  readonly label: string;
  /** Raster tile template; null = drawn from project data only. */
  readonly tiles: string | null;
  readonly attribution: string;
  readonly maxzoom: number;
  readonly theme: 'light' | 'dark';
  readonly background: string;
  readonly requires?: 'google';
  readonly overlay?: string;
}

export const BASEMAPS: readonly Basemap[] = [
  { id: 'technical', label: 'Tecnica', tiles: null, attribution: '© OpenStreetMap contributors (dati del progetto)', maxzoom: 22, theme: 'light', background: '#e9e6df' },
  { id: 'osm', label: 'OSM', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxzoom: 19, theme: 'light', background: '#f2efe9' },
  { id: 'satellite', label: 'Satellite', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, Maxar, Earthstar Geographics', maxzoom: 19, theme: 'dark', background: '#1b1d1c' },
  { id: 'hybrid', label: 'Ibrida', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, Maxar, Earthstar Geographics', maxzoom: 19, theme: 'dark', background: '#1b1d1c' },
  { id: 'terrain', label: 'Terreno', tiles: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors', maxzoom: 17, theme: 'light', background: '#eef0e6' },
  { id: 'dark', label: 'Scura', tiles: null, attribution: '© OpenStreetMap contributors (dati del progetto)', maxzoom: 22, theme: 'dark', background: '#16181b' },
  { id: 'cad', label: 'Nessuna · CAD', tiles: null, attribution: '', maxzoom: 22, theme: 'light', background: '#fbfaf8' },
  { id: 'google_satellite', label: 'Google Satellite', tiles: '/api/tiles/google/satellite/{z}/{x}/{y}', attribution: 'Google', maxzoom: 21, theme: 'dark', background: '#1b1d1c', requires: 'google' },
];

/** Slippy-map tile covering a point, for real thumbnails. */
export function tileFor(lon: number, lat: number, z: number): { x: number; y: number; z: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y, z };
}

export function thumbUrl(b: Basemap, lon: number, lat: number): string | null {
  if (!b.tiles) return null;
  const t = tileFor(lon, lat, Math.min(16, b.maxzoom));
  return b.tiles.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}
