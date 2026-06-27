import { getDatabase } from '../database/index';
import { getSupabase } from './supabase';
import { cloudService } from './cloud-service';
import { offlineQueue, coerceForCloud } from './offline-queue';
import { recordSchemaError } from './schema-health';

// Parent tables MUST precede their child/item tables so the per-table push loop
// inserts a parent in the cloud before any row that references it (the item tables
// carry a foreign key onto their parent).
const EIM_TABLES = [
  'equipment_assets', 'asset_status_log',
  'maintenance_tickets', 'maintenance_notes', 'ticket_actions',
  'equipment_loans', 'equipment_loan_items',
  'purchase_requests', 'purchase_request_items',
  'parts_catalog', 'parts_inventory', 'parts_transactions',
  'parts_compatibility', 'preventive_schedules', 'vendors',
] as const;

type EimTable = typeof EIM_TABLES[number];

function normalizeTimestamp(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val);
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  } catch {
    return str;
  }
}

function upsertOperationalRow(db: any, table: string, row: Record<string, unknown>): void {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(k => {
    const v = row[k];
    if (k === 'updated_at' || k === 'created_at' || k === 'changed_at' ||
        k === 'reported_date' || k === 'completion_date' || k === 'last_performed') {
      return normalizeTimestamp(v);
    }
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    return v;
  });

  const updates = keys
    .filter(k => k !== 'id')
    .map(k => `${k} = excluded.${k}`)
    .join(', ');

  const hasUpdatedAt = keys.includes('updated_at');
  const whereClause = hasUpdatedAt
    ? `WHERE excluded.updated_at >= ${table}.updated_at`
    : '';

  db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates} ${whereClause}`
  ).run(...values);
}

export async function syncOperationalWithCloud(): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  const db = getDatabase();

  for (const table of EIM_TABLES) {
    try {
      const cloudRows = await cloudService.getAll(table);

      if (cloudRows.length > 0) {
        db.pragma('foreign_keys = OFF');
        const tx = db.transaction(() => {
          for (const row of cloudRows) {
            upsertOperationalRow(db, table, row);
          }
        });
        tx();
        db.pragma('foreign_keys = ON');
      }

      const localRows: any[] = db.prepare(`SELECT * FROM ${table}`).all();
      const cloudIds = new Set(cloudRows.map((r: any) => r.id));
      const toPush = localRows.filter(r => !cloudIds.has(r.id));

      if (toPush.length > 0) {
        await cloudService.upsertMany(table, toPush.map(r => coerceForCloud(r)));
      }
    } catch (err: any) {
      recordSchemaError(table, err);
      if (err?.code === 'PGRST205') {
        console.warn(`[OperationalSync] Table '${table}' not found in Supabase — run the migration SQL to create EIM tables.`);
      } else {
        console.error(`[OperationalSync] Failed to sync ${table}:`, err);
      }
    }
  }
}

export async function pushOperationalToCloud(table: string, action: string, record: Record<string, unknown>): Promise<void> {
  if (!getSupabase()) {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, record.id as string, record);
    return;
  }

  try {
    if (action === 'DELETE') {
      await cloudService.remove(table as any, record.id as string);
    } else {
      await cloudService.upsert(table as any, coerceForCloud(record));
    }
  } catch {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, record.id as string, record);
  }
}

export function applyOperationalRealtimeChange(table: string, event: string, newRecord: any, oldRecord: any): void {
  const db = getDatabase();

  if (!EIM_TABLES.includes(table as any)) return;

  if (event === 'DELETE' && oldRecord?.id) {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(oldRecord.id);
  } else if (newRecord?.id) {
    upsertOperationalRow(db, table, newRecord);
  }
}

export { coerceForCloud };
