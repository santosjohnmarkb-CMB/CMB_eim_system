import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { syncManager } from '../sync/sync-manager';
import { loadSyncConfig } from '../sync/supabase';
import { requireAdmin } from './session';

function getMigrationSqlPath(): string {
  if (app.isPackaged) {
    return path.join((process as any).resourcesPath, 'database', 'supabase-migration.sql');
  }
  return path.join(__dirname, '../../../database/supabase-migration.sql');
}

export function registerSyncHandlers(): void {
  ipcMain.handle('sync:status', () => {
    return syncManager.getState();
  });

  ipcMain.handle('sync:forceSync', async () => {
    await syncManager.forceSync();
    return syncManager.getState();
  });

  ipcMain.handle('sync:notifyAction', () => {
    syncManager.notifyAction();
  });

  ipcMain.handle('sync:config:get', () => {
    return loadSyncConfig();
  });

  ipcMain.handle('sync:config:set', async (event: any, url: string, anonKey: string) => {
    requireAdmin(event);
    const success = await syncManager.connect(url, anonKey);
    return { success, state: syncManager.getState() };
  });

  ipcMain.handle('sync:tableStatus', async () => {
    if (!syncManager.isOnline()) return [];
    return [];
  });

  // Returns the bundled Supabase migration script so an operator can copy it
  // straight from Settings (e.g. when the schema-mismatch banner appears) and
  // run it in the Supabase SQL Editor, without digging into the repo.
  ipcMain.handle('sync:getMigrationSql', () => {
    try {
      return fs.readFileSync(getMigrationSqlPath(), 'utf-8');
    } catch (err) {
      console.error('[Sync] Failed to read migration SQL:', err);
      throw new Error('Could not load the migration SQL file');
    }
  });
}
