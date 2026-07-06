import { app, BrowserWindow, session } from 'electron';
import path from 'path';

function isBrokenPipeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'EPIPE' || code === 'EBADF' || code === 'ERR_STREAM_DESTROYED';
}

function guardStreamWrite(stream: NodeJS.WriteStream): void {
  const s = stream as unknown as { __epipeWriteGuarded__?: boolean };
  if (s.__epipeWriteGuarded__) return;
  s.__epipeWriteGuarded__ = true;

  const originalWrite = stream.write.bind(stream) as NodeJS.WriteStream['write'];
  stream.write = function (
    this: NodeJS.WriteStream,
    chunk: any,
    encoding?: any,
    callback?: any,
  ): boolean {
    try {
      return originalWrite(chunk, encoding, callback);
    } catch (err) {
      if (isBrokenPipeError(err)) {
        if (typeof encoding === 'function') encoding(null as unknown as Error);
        else if (typeof callback === 'function') callback(null as unknown as Error);
        return true;
      }
      throw err;
    }
  } as typeof stream.write;
}
guardStreamWrite(process.stdout);
guardStreamWrite(process.stderr);

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (isBrokenPipeError(err)) return;
    try {
      if (stream !== process.stderr) {
        process.stderr.write(`[main:stdio] ${String(err)}\n`);
      }
    } catch { /* nothing else we can do */ }
  });
}

process.on('uncaughtException', (err) => {
  if (isBrokenPipeError(err)) return;
  setImmediate(() => { throw err; });
});
process.on('unhandledRejection', (reason) => {
  if (isBrokenPipeError(reason)) return;
  setImmediate(() => {
    throw reason instanceof Error ? reason : new Error(String(reason));
  });
});

const isDev = !app.isPackaged;

// Main-process hot-restart is handled in development by nodemon (see nodemon.json +
// scripts/start-electron.mjs), which watches the compiled dist-main output and
// relaunches Electron. We intentionally do not use electron-reload here, since two
// independent restart mechanisms race and leave a stale main process running.

let mainWindow: any = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'CMB EIM',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (_e: any, level: number, message: string, line: number, sourceId: string) => {
      console.log(`[Renderer ${level}] ${message} (${sourceId}:${line})`);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_e: any, errorCode: number, errorDescription: string) => {
    console.error(`[did-fail-load] ${errorCode}: ${errorDescription}`);
  });

  if (isDev) {
    await mainWindow.webContents.session.clearCache();
    await mainWindow.webContents.session.clearStorageData({ storages: ['cachestorage'] });
    mainWindow.loadURL('http://localhost:5174', { extraHeaders: 'pragma: no-cache\nCache-Control: no-cache\n' });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (isDev) {
    await session.defaultSession.clearCache();
  }
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co;",
          ],
        },
      });
    });
  }

  try {
    const { initializeDatabase } = await import('./database/index');
    initializeDatabase();
  } catch (err) {
    console.error('[BOOT] Database initialization failed:', err);
  }

  try {
    const { registerAllHandlers } = await import('./ipc/index');
    registerAllHandlers();
  } catch (err) {
    console.error('[BOOT] IPC handler registration failed:', err);
  }

  let syncRef: typeof import('./sync/sync-manager') | null = null;
  try {
    syncRef = await import('./sync/sync-manager');
    await syncRef.syncManager.initialize();
    await syncRef.syncManager.syncOnStartup();
  } catch (err) {
    console.error('[BOOT] Sync initialization failed:', err);
  }

  createWindow();

  app.on('before-quit', (e) => {
    if (!syncRef) return;
    e.preventDefault();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
    Promise.race([syncRef.syncManager.syncBeforeQuit(), timeout])
      .finally(() => {
        syncRef = null;
        app.quit();
      });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
