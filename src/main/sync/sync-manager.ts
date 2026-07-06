import { BrowserWindow } from 'electron';
import { loadSyncConfig, initSupabase, getSupabase, disconnectSupabase, saveSyncConfig, authenticateClient } from './supabase';
import { cloudService } from './cloud-service';
import { offlineQueue } from './offline-queue';
import { syncCatalogWithCloud, applyCatalogRealtimeChange } from './catalog-sync';
import { syncOperationalWithCloud, applyOperationalRealtimeChange } from './operational-sync';
import { resetSchemaIssues, getSchemaIssues } from './schema-health';

const REALTIME_TABLES = [
  'categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items', 'users',
  'equipment_assets', 'asset_status_log',
  'maintenance_tickets', 'maintenance_notes', 'ticket_actions',
  'equipment_loans', 'equipment_loan_items',
  'purchase_requests', 'purchase_request_items',
  'parts_catalog', 'parts_inventory', 'parts_transactions',
  'vendors', 'preventive_schedules',
];

const CATALOG_TABLES = new Set(['categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items', 'users']);

const ACTION_SYNC_THRESHOLD = 10;
const HEALTH_CHECK_INTERVAL = 30_000;
// How often the background loop pushes locally-queued (pending) changes to the
// cloud. Kept short so other users see edits quickly. The drain is cheap when
// the queue is empty (a single COUNT(*)) so a tight interval is fine.
const AUTO_SYNC_INTERVAL = 15_000;
// Every Nth auto-sync tick, run a full reconcile (pull + push + queue replay)
// instead of just draining the queue. This is the safety net that recovers
// from any missed realtime events. 20 ticks × 15s ≈ every 5 minutes.
const FULL_RECONCILE_EVERY = 20;

interface SyncState {
  status: 'online' | 'offline' | 'syncing' | 'error';
  lastSyncAt: string | null;
  pendingChanges: number;
  lastError?: string;
  schemaOutdated?: boolean;
  schemaIssues?: string[];
}

class SyncManager {
  private state: SyncState = {
    status: 'offline',
    lastSyncAt: null,
    pendingChanges: 0,
  };

  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private autoSyncInterval: ReturnType<typeof setInterval> | null = null;
  private autoSyncTicks = 0;
  private actionCount = 0;
  private channels: any[] = [];
  // Reentrancy guard: prevents the background loop, health check, manual Force
  // Sync, and per-action triggers from running overlapping syncs against the
  // same SQLite/cloud state at once.
  private syncing = false;

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

    // Opt-in CRIT-2 hardening: if a service-account credential is configured,
    // sign in so cloud traffic runs as `authenticated`. No-op (anon) otherwise.
    await authenticateClient();

    await this.checkConnectivity();
    this.startBackgroundLoops();
  }

  /**
   * Starts the two recurring background timers (idempotent):
   *   - health check: detects connectivity changes and re-subscribes on reconnect
   *   - auto-sync: continuously flushes pending changes to the cloud so edits
   *     made on this machine become available to other users without anyone
   *     pressing "Force Sync", plus a periodic full reconcile as a safety net.
   */
  private startBackgroundLoops(): void {
    if (!this.healthInterval) {
      this.healthInterval = setInterval(() => this.checkConnectivity(), HEALTH_CHECK_INTERVAL);
    }
    if (!this.autoSyncInterval) {
      this.autoSyncInterval = setInterval(() => {
        this.autoSyncTick().catch(() => { /* never let a tick crash the timer */ });
      }, AUTO_SYNC_INTERVAL);
    }
  }

  /**
   * One background auto-sync tick. Cheap and self-throttling:
   *   - skips entirely while another sync is in flight or while offline
   *   - most ticks just drain the offline queue (only does work when pending > 0)
   *   - every FULL_RECONCILE_EVERY ticks, runs a full reconcile instead
   */
  private async autoSyncTick(): Promise<void> {
    if (this.syncing || !this.isOnline()) return;

    this.autoSyncTicks++;
    if (this.autoSyncTicks >= FULL_RECONCILE_EVERY) {
      this.autoSyncTicks = 0;
      await this.forceSync();
      return;
    }

    if (offlineQueue.count() > 0) {
      await this.drainQueue();
    }
  }

  /**
   * Lightweight push-only sync: replays the offline queue so pending local
   * changes reach the cloud. Unlike forceSync() it does not pull/reconcile the
   * full catalog, and it deliberately does NOT flip the status to "syncing" so
   * the UI badge doesn't flicker every interval while there's a backlog.
   */
  private async drainQueue(): Promise<void> {
    // Bail while offline so we don't optimistically flip the status to "online"
    // on a connection that the health check has already marked down. Pending
    // items flush on reconnect via checkConnectivity() → forceSync().
    if (this.syncing || !getSupabase() || !this.isOnline()) return;
    if (offlineQueue.count() === 0) return;

    this.syncing = true;
    try {
      const result = await offlineQueue.replay();
      const pending = offlineQueue.count();
      this.setState({
        status: 'online',
        lastSyncAt: new Date().toISOString(),
        pendingChanges: pending,
        // Everything drained → whatever schema gap existed is resolved; clear the
        // banner immediately rather than waiting for the next full reconcile.
        ...(pending === 0 ? { schemaOutdated: false, schemaIssues: [] } : {}),
      });
      if (result.failed > 0) {
        console.warn(
          `[SyncManager] Auto-sync: pushed ${result.succeeded} change(s), ${result.failed} still pending`,
        );
      } else if (result.succeeded > 0) {
        console.log(`[SyncManager] Auto-sync: pushed ${result.succeeded} pending change(s) to cloud`);
      }
    } catch (err) {
      console.error('[SyncManager] Auto-sync queue drain failed:', err);
    } finally {
      this.syncing = false;
    }
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

    await authenticateClient();

    const healthy = await this.runHealthCheck();
    if (!healthy) {
      this.setState({ status: 'error', lastError: 'Could not reach Supabase' });
      return false;
    }

    this.subscribeToRealtime();
    await this.forceSync();
    this.startBackgroundLoops();

    return true;
  }

  async disconnect(): Promise<void> {
    this.unsubscribeAll();
    disconnectSupabase();
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
    this.autoSyncTicks = 0;
    this.setState({ status: 'offline' });
  }

  async forceSync(): Promise<void> {
    if (!getSupabase()) return;
    // Respect an in-flight sync so a manual Force Sync can't race the background
    // loop or health check.
    if (this.syncing) return;

    this.syncing = true;
    this.setState({ status: 'syncing' });
    try {
      // Fresh detection pass: the catalog/operational syncs below report any
      // cloud schema gaps into the tracker, which we read back afterwards.
      resetSchemaIssues();
      // Drain any locally-queued mutations first; otherwise "Force Sync" pulls
      // and pushes the catalog/operational tables but leaves the offline queue
      // untouched, so the "Pending Changes" count never clears.
      const result = await offlineQueue.replay();
      await syncCatalogWithCloud();
      await syncOperationalWithCloud();
      const schemaIssues = getSchemaIssues();
      this.setState({
        status: 'online',
        lastSyncAt: new Date().toISOString(),
        pendingChanges: offlineQueue.count(),
        schemaOutdated: schemaIssues.length > 0,
        schemaIssues,
      });
      if (schemaIssues.length > 0) {
        console.warn(
          `[SyncManager] Cloud schema is out of date — run database/supabase-migration.sql. Issues:\n  - ${schemaIssues.join('\n  - ')}`,
        );
      }
      if (result.failed > 0) {
        console.warn(
          `[SyncManager] Force sync: replayed ${result.succeeded} change(s), ${result.failed} still pending`,
        );
      }
    } catch (err) {
      console.error('[SyncManager] Force sync failed:', err);
      this.setState({ status: 'online', lastError: String(err) });
    } finally {
      this.syncing = false;
      this.actionCount = 0;
    }
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
    // Broadcast the new pending count so the Settings badge updates live.
    this.setState({ pendingChanges: offlineQueue.count() });

    // If this action left anything queued (an immediate push failed, or we're
    // catching up), kick a prompt queue drain instead of waiting for the next
    // background tick — the reentrancy guard makes this a no-op if a sync is
    // already running.
    if (this.state.pendingChanges > 0) {
      this.drainQueue().catch(() => {});
    }

    if (this.actionCount >= ACTION_SYNC_THRESHOLD) {
      this.forceSync().catch(() => {});
    }
  }

  private async checkConnectivity(): Promise<void> {
    if (!getSupabase()) return;

    const healthy = await this.runHealthCheck();
    if (healthy && this.state.status === 'offline') {
      // Reconnected: re-subscribe and run a full reconcile (forceSync replays
      // the offline queue internally, so pending changes flush automatically).
      this.subscribeToRealtime();
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
