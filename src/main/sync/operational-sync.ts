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

// Parent → child relationships. The cloud enforces these with ON DELETE CASCADE
// foreign keys; we mirror that locally when a parent tombstone is applied so an
// orphaned child on another machine can't be re-pushed after its parent is gone.
const CHILD_TABLES: Record<string, { table: string; fk: string }[]> = {
  maintenance_tickets: [
    { table: 'maintenance_notes', fk: 'ticket_id' },
    { table: 'ticket_actions', fk: 'ticket_id' },
  ],
  equipment_loans: [{ table: 'equipment_loan_items', fk: 'loan_id' }],
  purchase_requests: [{ table: 'purchase_request_items', fk: 'request_id' }],
};

// How long a delete tombstone is kept before pruning. Must comfortably exceed the
// longest realistic gap between a machine syncing, so a straggler that was offline
// can still learn about deletes before their tombstones are removed.
const TOMBSTONE_RETENTION_DAYS = 90;

// Record locally that a row was deleted. This is the source of truth that the
// reconcile uses to (a) delete the row on other machines and (b) never re-push it.
export function recordLocalTombstone(table: string, id: string): void {
  if (!id) return;
  try {
    getDatabase()
      .prepare(
        `INSERT INTO sync_tombstones (id, table_name, deleted_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET table_name = excluded.table_name, deleted_at = excluded.deleted_at`,
      )
      .run(id, table, new Date().toISOString());
  } catch (err) {
    console.warn(`[Tombstone] Failed to record local tombstone for ${table}/${id}:`, err);
  }
}

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

// Reconciles delete tombstones across machines. Pulls remote tombstones, publishes
// local ones, then APPLIES them: deletes each tombstoned row (and its children) from
// the local DB so the per-table reconcile below can never re-push a deleted record.
// Returns the set of tombstoned ids for the push-exclusion. Best-effort: if the cloud
// `sync_tombstones` table isn't there yet (migration not run), it degrades to
// local-only tombstones so a single machine still won't self-resurrect its deletes.
async function reconcileTombstones(db: any): Promise<Set<string>> {
  let cloudTombstones: any[] = [];
  try {
    cloudTombstones = await cloudService.getAll('sync_tombstones' as any);
  } catch (err: any) {
    if (err?.code !== 'PGRST205') {
      console.warn('[Tombstone] Cloud fetch failed (continuing local-only):', err?.message ?? err);
    }
  }

  // Merge remote tombstones into the local ledger.
  if (cloudTombstones.length > 0) {
    const insert = db.prepare(
      `INSERT INTO sync_tombstones (id, table_name, deleted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET table_name = excluded.table_name, deleted_at = excluded.deleted_at`,
    );
    db.transaction(() => {
      for (const t of cloudTombstones) insert.run(t.id, t.table_name, t.deleted_at);
    })();
  }

  // Publish any local tombstones the cloud is missing.
  const cloudTombstoneIds = new Set(cloudTombstones.map((t: any) => t.id));
  const toPush: any[] = db
    .prepare('SELECT id, table_name, deleted_at FROM sync_tombstones')
    .all()
    .filter((t: any) => !cloudTombstoneIds.has(t.id));
  if (toPush.length > 0) {
    try {
      await cloudService.upsertMany('sync_tombstones' as any, toPush);
    } catch (err: any) {
      if (err?.code !== 'PGRST205') console.warn('[Tombstone] Push failed:', err?.message ?? err);
    }
  }

  const tombstones: any[] = db.prepare('SELECT id, table_name FROM sync_tombstones').all();
  const ids = new Set<string>(tombstones.map((t) => t.id));

  // Apply: delete tombstoned rows (and their children) locally.
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const t of tombstones) {
      if (!(EIM_TABLES as readonly string[]).includes(t.table_name)) continue;
      try {
        db.prepare(`DELETE FROM ${t.table_name} WHERE id = ?`).run(t.id);
        for (const child of CHILD_TABLES[t.table_name] ?? []) {
          db.prepare(`DELETE FROM ${child.table} WHERE ${child.fk} = ?`).run(t.id);
        }
      } catch {
        /* table may be absent on partial deployments */
      }
    }
  })();
  db.pragma('foreign_keys = ON');

  // Prune tombstones past the retention window so the ledger stays bounded.
  try {
    db.prepare(
      `DELETE FROM sync_tombstones WHERE deleted_at < datetime('now', '-' || ? || ' days')`,
    ).run(TOMBSTONE_RETENTION_DAYS);
  } catch {
    /* non-fatal */
  }

  return ids;
}

export async function syncOperationalWithCloud(): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  const db = getDatabase();

  // Reconcile delete tombstones FIRST so the per-table push below can never
  // resurrect a row that was deleted on another machine.
  const tombstoned = await reconcileTombstones(db);

  for (const table of EIM_TABLES) {
    try {
      const cloudRows = await cloudService.getAll(table);

      if (cloudRows.length > 0) {
        const resurrected: string[] = [];
        db.pragma('foreign_keys = OFF');
        db.transaction(() => {
          for (const row of cloudRows) {
            // A cloud row for a tombstoned id is a stale/resurrected copy — don't
            // re-add it locally; clean it out of the cloud afterwards.
            if (tombstoned.has(row.id)) {
              resurrected.push(row.id);
              continue;
            }
            upsertOperationalRow(db, table, row);
          }
        })();
        db.pragma('foreign_keys = ON');

        for (const id of resurrected) {
          try {
            await cloudService.remove(table, id);
          } catch {
            /* best-effort cleanup; the tombstone still prevents local resurrection */
          }
        }
      }

      const localRows: any[] = db.prepare(`SELECT * FROM ${table}`).all();
      const cloudIds = new Set(cloudRows.map((r: any) => r.id));
      const toPush = localRows.filter((r) => !cloudIds.has(r.id) && !tombstoned.has(r.id));

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
  const recordId = record.id as string;

  // A delete must leave a tombstone locally FIRST, so it survives even if the cloud
  // push below fails/queues — the full reconcile then propagates it and no machine
  // can resurrect the row.
  if (action === 'DELETE') recordLocalTombstone(table, recordId);

  if (!getSupabase()) {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, recordId, record);
    return;
  }

  try {
    if (action === 'DELETE') {
      await cloudService.remove(table as any, recordId);
      // Publish the tombstone so other machines learn of the delete even if they
      // miss the realtime event. Best-effort — reconcileTombstones() also pushes it.
      try {
        const row: any = getDatabase()
          .prepare('SELECT id, table_name, deleted_at FROM sync_tombstones WHERE id = ?')
          .get(recordId);
        if (row) await cloudService.upsert('sync_tombstones' as any, row);
      } catch {
        /* reconcile will retry the tombstone push */
      }
    } else {
      await cloudService.upsert(table as any, coerceForCloud(record));
    }
  } catch {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, recordId, record);
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
