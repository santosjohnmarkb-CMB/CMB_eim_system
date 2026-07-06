import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { syncManager } from '../sync/sync-manager';
import { loadSyncConfig, isAuthenticated } from '../sync/supabase';
import {
  saveSupabaseServiceCredentials,
  loadSupabaseServiceCredentials,
  clearSupabaseServiceCredentials,
} from '../sync/secrets-store';
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

  // ── CRIT-2: Supabase Auth service-account credential (admin only) ──────────
  // The password is write-only from the renderer's perspective: we never return
  // it, only whether a credential is configured and whether the client is
  // currently signed in as `authenticated`.
  ipcMain.handle('sync:serviceAccount:status', (event: any) => {
    requireAdmin(event);
    const creds = loadSupabaseServiceCredentials();
    return {
      configured: !!creds,
      email: creds?.email ?? '',
      authenticated: isAuthenticated(),
    };
  });

  ipcMain.handle('sync:serviceAccount:set', async (event: any, email: string, password: string) => {
    requireAdmin(event);
    if (!email || !password) throw new Error('Email and password are required');
    saveSupabaseServiceCredentials({ email: email.trim(), password });
    // Reconnect so the new credential takes effect immediately (signs in).
    const cfg = loadSyncConfig();
    if (cfg) await syncManager.connect(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return { configured: true, authenticated: isAuthenticated(), state: syncManager.getState() };
  });

  ipcMain.handle('sync:serviceAccount:clear', async (event: any) => {
    requireAdmin(event);
    clearSupabaseServiceCredentials();
    // Reconnect so the client reverts to anon.
    const cfg = loadSyncConfig();
    if (cfg) await syncManager.connect(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return { configured: false, authenticated: isAuthenticated(), state: syncManager.getState() };
  });

  // Returns the bundled Supabase migration script so an operator can copy it
  // straight from Settings (e.g. when the schema-mismatch banner appears) and
  // run it in the Supabase SQL Editor, without digging into the repo.
  ipcMain.handle('sync:getMigrationSql', () => {
    try {
      return fs.readFileSync(getMigrationSqlPath(), 'utf-8');
    } catch (err) {
      console.error('[Sync] Failed to read migration SQL:', err);
      throw new Error('Could not load the migration SQL file', { cause: err });
    }
  });
}
