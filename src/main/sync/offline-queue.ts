import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { getDatabase } from '../database/index';
import { cloudService } from './cloud-service';

const REFRESHABLE_TABLES = new Set([
  'equipment_assets', 'asset_status_log',
  'maintenance_tickets', 'maintenance_notes',
  'parts_catalog', 'parts_inventory', 'parts_transactions',
  'vendors', 'preventive_schedules',
]);

const MAX_QUEUE_SIZE = 200;
const MAX_AGE_DAYS = 7;

export interface QueuedAction {
  id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  table_name: string;
  record_id: string;
  payload: string | Record<string, unknown> | null;
  created_at: string;
}

export function coerceForCloud(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'is_active' || key === 'is_required') {
      result[key] = value === 1 || value === true;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class OfflineQueue {
  private get db() {
    return getDatabase();
  }

  private parsePayload(payload: QueuedAction['payload']): Record<string, unknown> {
    if (payload === null || payload === undefined) return {};
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
      return {};
    }
    if (typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    return {};
  }

  enqueue(action: 'INSERT' | 'UPDATE' | 'DELETE', tableName: string, recordId: string, payload: Record<string, unknown> = {}): void {
    if (!isUuid(recordId)) {
      console.warn(`[OfflineQueue] Skipping enqueue — record ID "${recordId}" is not a valid UUID (table=${tableName})`);
      return;
    }

    const existing = this.db.prepare(
      `SELECT id FROM offline_queue WHERE table_name = ? AND record_id = ? AND action = ? LIMIT 1`
    ).get(tableName, recordId, action) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(
        `UPDATE offline_queue SET payload = ?, created_at = datetime('now') WHERE id = ?`
      ).run(JSON.stringify(payload), existing.id);
      return;
    }

    if (this.count() >= MAX_QUEUE_SIZE) {
      this.db.prepare(
        `DELETE FROM offline_queue WHERE id IN (SELECT id FROM offline_queue ORDER BY created_at ASC LIMIT 10)`
      ).run();
    }

    this.db.prepare(
      `INSERT INTO offline_queue (id, action, table_name, record_id, payload) VALUES (?, ?, ?, ?, ?)`
    ).run(uuidv4(), action, tableName, recordId, JSON.stringify(payload));
  }

  getAll(): QueuedAction[] {
    return this.db.prepare('SELECT * FROM offline_queue ORDER BY created_at ASC').all() as QueuedAction[];
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM offline_queue').get() as { count: number };
    return row.count;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM offline_queue WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.prepare('DELETE FROM offline_queue').run();
  }

  pruneStale(): number {
    const result = this.db.prepare(
      `DELETE FROM offline_queue WHERE created_at < datetime('now', '-' || ? || ' days')`
    ).run(MAX_AGE_DAYS);
    if (result.changes > 0) {
      console.warn(`[OfflineQueue] Pruned ${result.changes} stale entries older than ${MAX_AGE_DAYS} days`);
    }
    return result.changes;
  }

  async replay(): Promise<{ succeeded: number; failed: number }> {
    this.pruneStale();
    const pending = this.getAll();
    let succeeded = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        let payload = this.parsePayload(item.payload);
        const table = item.table_name as Parameters<typeof cloudService.upsert>[0];

        switch (item.action) {
          case 'INSERT':
          case 'UPDATE': {
            if (REFRESHABLE_TABLES.has(table)) {
              try {
                const fresh: any = this.db.prepare(
                  `SELECT * FROM ${table} WHERE id = ?`
                ).get(item.record_id);
                if (fresh) payload = fresh;
              } catch { /* use original payload */ }
            }
            await cloudService.upsert(table, coerceForCloud(payload));
            break;
          }
          case 'DELETE':
            await cloudService.remove(table, item.record_id);
            break;
        }

        try { this.remove(item.id); } catch { /* best-effort */ }
        succeeded++;
      } catch (err: any) {
        const code = err?.code ?? '';
        const isUnrecoverable = code === '22P02' || code === '23503';

        if (isUnrecoverable) {
          console.warn(`[OfflineQueue] Permanently removing unrecoverable entry: ${item.table_name} ${item.action} (record=${item.record_id})`);
          try { this.remove(item.id); } catch { /* best-effort */ }
        }
        failed++;
      }
    }

    return { succeeded, failed };
  }
}

export const offlineQueue = new OfflineQueue();
