import { BrowserWindow } from 'electron';
import { loadSyncConfig, initSupabase, getSupabase, disconnectSupabase, saveSyncConfig } from './supabase';
import { cloudService } from './cloud-service';
import { offlineQueue } from './offline-queue';
import { syncCatalogWithCloud, applyCatalogRealtimeChange } from './catalog-sync';
import { syncOperationalWithCloud, applyOperationalRealtimeChange } from './operational-sync';

const REALTIME_TABLES = [
  'categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items', 'users',
  'equipment_assets', 'asset_status_log',
  'maintenance_tickets', 'maintenance_notes',
  'parts_catalog', 'parts_inventory', 'parts_transactions',
  'vendors', 'preventive_schedules',
];

const CATALOG_TABLES = new Set(['categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items', 'users']);

const ACTION_SYNC_THRESHOLD = 10;
const HEALTH_CHECK_INTERVAL = 30_000;

interface SyncState {
  status: 'online' | 'offline' | 'syncing' | 'error';
  lastSyncAt: string | null;
  pendingChanges: number;
  lastError?: string;
}

class SyncManager {
  private state: SyncState = {
    status: 'offline',
    lastSyncAt: null,
    pendingChanges: 0,
  };

  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private actionCount = 0;
  private channels: any[] = [];

  getState(): SyncState {
    return { ...this.state };
  }

  isOnline(): boolean {
    return this.state.status === 'online' || this.state.status === 'syncing';
  }

  async initialize(): Promise<void> {
    const config = loadSyncConfig();
    if (!config) {
      this.setState({ status: 'offline' });
      return;
    }

    const client = initSupabase(config);
    if (!client) {
      this.setState({ status: 'offline' });
      return;
    }

    await this.checkConnectivity();
    this.healthInterval = setInterval(() => this.checkConnectivity(), HEALTH_CHECK_INTERVAL);
  }

  async connect(url: string, anonKey: string): Promise<boolean> {
    const urlRegex = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/;
    if (!urlRegex.test(url)) {
      throw new Error('Invalid Supabase URL format');
    }

    saveSyncConfig({ supabaseUrl: url, supabaseAnonKey: anonKey });
    disconnectSupabase();

    const client = initSupabase({ supabaseUrl: url, supabaseAnonKey: anonKey });
    if (!client) {
      this.setState({ status: 'error', lastError: 'Failed to create Supabase client' });
      return false;
    }

    const healthy = await this.runHealthCheck();
    if (!healthy) {
      this.setState({ status: 'error', lastError: 'Could not reach Supabase' });
      return false;
    }

    this.subscribeToRealtime();
    await offlineQueue.replay();
    await this.forceSync();

    if (!this.healthInterval) {
      this.healthInterval = setInterval(() => this.checkConnectivity(), HEALTH_CHECK_INTERVAL);
    }

    return true;
  }

  async disconnect(): Promise<void> {
    this.unsubscribeAll();
    disconnectSupabase();
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    this.setState({ status: 'offline' });
  }

  async forceSync(): Promise<void> {
    if (!getSupabase()) return;

    this.setState({ status: 'syncing' });
    try {
      // Drain any locally-queued mutations first; otherwise "Force Sync" pulls
      // and pushes the catalog/operational tables but leaves the offline queue
      // untouched, so the "Pending Changes" count never clears.
      await offlineQueue.replay();
      await syncCatalogWithCloud();
      await syncOperationalWithCloud();
      this.setState({
        status: 'online',
        lastSyncAt: new Date().toISOString(),
        pendingChanges: offlineQueue.count(),
      });
    } catch (err) {
      console.error('[SyncManager] Force sync failed:', err);
      this.setState({ status: 'online', lastError: String(err) });
    }
    this.actionCount = 0;
  }

  async syncOnStartup(): Promise<void> {
    if (!getSupabase()) return;
    await this.forceSync();
  }

  async syncBeforeQuit(): Promise<void> {
    if (!getSupabase()) return;
    try {
      await offlineQueue.replay();
    } catch (err) {
      console.error('[SyncManager] Pre-quit sync failed:', err);
    }
  }

  notifyAction(): void {
    this.actionCount++;
    this.state.pendingChanges = offlineQueue.count();
    if (this.actionCount >= ACTION_SYNC_THRESHOLD) {
      this.forceSync().catch(() => {});
    }
  }

  private async checkConnectivity(): Promise<void> {
    if (!getSupabase()) return;

    const healthy = await this.runHealthCheck();
    if (healthy && this.state.status === 'offline') {
      this.subscribeToRealtime();
      await offlineQueue.replay();
      await this.forceSync();
    } else if (!healthy && this.state.status !== 'offline') {
      this.unsubscribeAll();
      this.setState({ status: 'offline' });
    }
  }

  private async runHealthCheck(): Promise<boolean> {
    try {
      const client = getSupabase();
      if (!client) return false;
      const { error } = await client.from('sync_metadata').select('id').limit(1);
      if (error) {
        const code = error?.code;
        if (code === 'PGRST205') return true; // table doesn't exist but connection works
        if (code === '42501' || code === 'PGRST301') return false;
        return false;
      }
      this.setState({ status: 'online' });
      return true;
    } catch {
      return false;
    }
  }

  private subscribeToRealtime(): void {
    const client = getSupabase();
    if (!client) return;
    this.unsubscribeAll();

    for (const table of REALTIME_TABLES) {
      try {
        const channel = client.channel(`realtime:${table}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, (payload: any) => {
            const { eventType, new: newRecord, old: oldRecord } = payload;

            if (CATALOG_TABLES.has(table)) {
              applyCatalogRealtimeChange(table, eventType, newRecord, oldRecord);
            } else {
              applyOperationalRealtimeChange(table, eventType, newRecord, oldRecord);
            }

            this.broadcastChange(table, eventType, newRecord, oldRecord);
          })
          .subscribe();

        this.channels.push(channel);
      } catch (err) {
        console.error(`[SyncManager] Failed to subscribe to ${table}:`, err);
      }
    }
  }

  private unsubscribeAll(): void {
    const client = getSupabase();
    if (client) {
      client.removeAllChannels();
    }
    this.channels = [];
  }

  private broadcastChange(table: string, event: string, newRecord: any, oldRecord: any): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sync:dataChanged', { table, event, new: newRecord, old: oldRecord });
      }
    }
  }

  private setState(update: Partial<SyncState>): void {
    Object.assign(this.state, update);
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sync:status', this.getState());
      }
    }
  }
}

export const syncManager = new SyncManager();
