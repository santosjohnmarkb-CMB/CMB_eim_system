// Development launcher for the Electron main process.
//
// Responsibilities:
//   1. Wait for the Vite dev server to be ready before launching Electron, so the
//      window never loads a blank/failed page on a cold start.
//   2. Clear ELECTRON_RUN_AS_NODE. Editors like Cursor/VS Code set this in their
//      integrated terminal; if left set, Electron boots as a plain Node process and
//      no app window appears.
//   3. Spawn Electron and forward termination signals so nodemon can cleanly restart
//      the process whenever the compiled main output (dist-main) changes.
//
// nodemon re-runs this script on every dist-main change, which is what gives us
// reliable main-process hot-restart in development (Vite only hot-reloads the
// renderer, never the main process).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import waitOn from 'wait-on';

const require = createRequire(import.meta.url);
// When required outside of an Electron runtime, the `electron` package resolves to
// the absolute path of the Electron binary.
const electronPath = require('electron');

const DEV_SERVER_URL = process.env.RENDERER_DEV_URL || 'http://localhost:5174';

async function main() {
  try {
    await waitOn({ resources: [DEV_SERVER_URL], timeout: 60_000, interval: 200 });
  } catch {
    console.warn(`[start-electron] Timed out waiting for ${DEV_SERVER_URL}; launching Electron anyway.`);
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

  const forward = (signal) => () => {
    if (!child.killed) {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
