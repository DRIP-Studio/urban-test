import { defineConfig } from '@playwright/test';

/**
 * End-to-end + visual regression. Global setup runs the real API on an isolated data folder
 * (e2e/.data/<run>) and the Vite dev server proxied to it; the user's data folder is never touched.
 */
// Workers inherit the environment, so the whole run agrees on one folder.
process.env.DRIP_E2E_RUN ??= String(Date.now());
const WEB_PORT = 5190; // servers: e2e/global-setup.ts

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', stylePath: './e2e/screenshot.css' } },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    // PW_CHROMIUM_PATH: use a preinstalled Chromium when the pinned browser build is not available.
    launchOptions: { args: process.env.DRIP_E2E_GPU==='hardware'?['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) },
  },
});
