import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import '@fontsource-variable/manrope';
import '@fontsource/playfair-display/600-italic.css';
import '@fontsource/playfair-display/600.css';
import './ui/tokens.css';
import './ui/app.css';
import { App } from './App';

// Cesium reads its static runtime (workers, assets) from here; copied locally by scripts/copy-cesium.mjs.
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium';
// MapLibre worker served as a static module (see scripts/copy-maplibre.mjs).
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
