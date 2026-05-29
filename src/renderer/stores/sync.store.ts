import { create } from 'zustand';
import { ipcInvoke, ipcOn, ipcRemoveListener } from '../lib/ipc';
import type { SyncStatus, SyncStatusInfo, SyncConfig } from '../../shared/types';

interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingChanges: number;
  config: SyncConfig | null;
  initialize: () => void;
  cleanup: () => void;
  fetchStatus: () => Promise<void>;
  fetchConfig: () => Promise<void>;
  setConfig: (url: string, anonKey: string) => Promise<boolean>;
  forceSync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => {
  const statusHandler = (...args: unknown[]) => {
    const info = args[0] as SyncStatusInfo;
    if (info) {
      set({ status: info.status, lastSyncAt: info.lastSyncAt, pendingChanges: info.pendingChanges });
    }
  };

  return {
    status: 'offline',
    lastSyncAt: null,
    pendingChanges: 0,
    config: null,

    initialize: () => {
      ipcOn('sync:status', statusHandler);
      get().fetchStatus();
      get().fetchConfig();
    },

    cleanup: () => {
      ipcRemoveListener('sync:status', statusHandler);
    },

    fetchStatus: async () => {
      try {
        const info = await ipcInvoke<SyncStatusInfo>('sync:status');
        set({ status: info.status, lastSyncAt: info.lastSyncAt, pendingChanges: info.pendingChanges });
      } catch { /* offline */ }
    },

    fetchConfig: async () => {
      try {
        const config = await ipcInvoke<SyncConfig | null>('sync:config:get');
        set({ config });
      } catch { /* ignore */ }
    },

    setConfig: async (url: string, anonKey: string) => {
      try {
        const result = await ipcInvoke<{ success: boolean }>('sync:config:set', url, anonKey);
        if (result.success) {
          set({ config: { supabaseUrl: url, supabaseAnonKey: anonKey } });
          await get().fetchStatus();
        }
        return result.success;
      } catch {
        return false;
      }
    },

    forceSync: async () => {
      try {
        await ipcInvoke('sync:forceSync');
        await get().fetchStatus();
      } catch { /* ignore */ }
    },
  };
});
