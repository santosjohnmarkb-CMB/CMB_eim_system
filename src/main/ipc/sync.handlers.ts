import { ipcMain } from 'electron';
import { syncManager } from '../sync/sync-manager';
import { loadSyncConfig } from '../sync/supabase';
import { requireAdmin } from './session';

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
}
