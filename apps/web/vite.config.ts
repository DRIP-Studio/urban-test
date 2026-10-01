import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = process.env.DRIP_URBAN_API ?? 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@drip-urban/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': API, '/signs': API, '/brand': API, '/catalog': API },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000, sourcemap: false },
});
