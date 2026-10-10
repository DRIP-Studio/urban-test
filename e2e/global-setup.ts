import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Starts the API (isolated data folder) and Vite for the run, and stops both afterwards.
 * Servers are spawned without a shell and killed as a process tree: Playwright's own webServer
 * teardown hangs on Windows behind the cmd/npx wrappers and the venv launcher's child process.
 */
const root = join(__dirname, '..');
export const API_PORT = 8790;
export const WEB_PORT = 5190;

function killTree(p: ChildProcess): void {
  if (p.pid === undefined || p.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill('SIGTERM');
}

async function waitFor(url: string, child: ChildProcess, label: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} è terminato (codice ${child.exitCode})`);
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} non risponde su ${url}`);
}

export default async function globalSetup(): Promise<() => void> {
  // Remove data of previous runs; this run gets its own folder.
  const dataRoot = join(__dirname, '.data');
  try { for (const e of readdirSync(dataRoot)) if (e !== process.env.DRIP_E2E_RUN) rmSync(join(dataRoot, e), { recursive: true, force: true }); } catch { /* first run */ }
  const data = join(dataRoot, process.env.DRIP_E2E_RUN!);
  mkdirSync(data, { recursive: true });

  const py = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const log = process.env.DRIP_E2E_VERBOSE ? 'inherit' : 'ignore';
  const api = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(API_PORT)], {
    cwd: join(root, 'services', 'api'), stdio: log,
    env: { ...process.env, DRIP_URBAN_AUTH: process.env.DRIP_E2E_AUTH ?? 'open', DRIP_PLATFORM_URL: 'http://127.0.0.1:9', DRIP_URBAN_DATA: data, DRIP_URBAN_LEGACY_DATA: join(__dirname, '.no-legacy') },
  });
  const web = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: join(root, 'apps', 'web'), stdio: log,
    env: { ...process.env, DRIP_URBAN_API: `http://127.0.0.1:${API_PORT}` },
  });
  const stop = () => { killTree(web); killTree(api); };
  process.once('exit', stop);
  try {
    await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, api, 'API');
    await waitFor(`http://127.0.0.1:${WEB_PORT}/`, web, 'Vite');
  } catch (e) { stop(); throw e; }
  return stop;
}
