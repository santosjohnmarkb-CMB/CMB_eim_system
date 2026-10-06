import { BrowserWindow } from 'electron';
import { getDatabase } from '../database/index';
import { getSupabase } from './supabase';
import { cloudService } from './cloud-service';

/**
 * Read-only mirror of the 1 Take tables that schedule shoots.
 * EIM never writes these rows back. Use count is distinct shoot days.
 */
const RENTAL_USAGE_TABLES = ['rental_requests', 'rental_shoot_days', 'rental_line_items'] as const;
type RentalUsageTable = typeof RENTAL_USAGE_TABLES[number];

const COLUMNS: Record<RentalUsageTable, readonly string[]> = {
  rental_requests: ['id', 'request_number', 'project_name', 'client_name', 'status', 'archived_at', 'updated_at'],
  rental_shoot_days: ['id', 'request_id', 'shoot_date', 'day_label', 'updated_at'],
  rental_line_items: ['id', 'request_id', 'day_id', 'description', 'updated_at'],
};

function isRentalUsageTable(table: string): table is RentalUsageTable {
  return (RENTAL_USAGE_TABLES as readonly string[]).includes(table);
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function pick(table: RentalUsageTable, row: Record<string, unknown>): Record<string, unknown> | null {
  const id = text(row.id);
  if (!id) return null;
  const rec: Record<string, unknown> = { id };
  for (const key of COLUMNS[table]) {
    if (key === 'id') continue;
    if (key === 'archived_at') {
      rec.archived_at = row.archived_at == null || row.archived_at === '' ? null : String(row.archived_at);
      continue;
    }
    rec[key] = text(row[key]);
  }
  return rec;
}

function upsert(db: any, table: RentalUsageTable, rec: Record<string, unknown>): void {
  const keys = Object.keys(rec);
  const placeholders = keys.map(() => '?').join(', ');
  const updates = keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ');
  db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
  ).run(...keys.map((k) => rec[k]));
}

function deleteMissing(db: any, table: RentalUsageTable, keep: Set<string>): void {
  const local = db.prepare(`SELECT id FROM ${table}`).all() as { id: string }[];
  const del = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const row of local) {
    if (!keep.has(row.id)) del.run(row.id);
  }
}

function notifyChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('sync:dataChanged', { table: 'rental_line_items', event: 'UPDATE' });
    }
  }
}

/** Pull 1 Take requests, shoot days, and line items. Cloud is the source of truth. */
export async function syncRentalUsageFromCloud(): Promise<void> {
  if (!getSupabase()) return;
  const db = getDatabase();

  let requests: any[] = [];
  let days: any[] = [];
  let items: any[] = [];
  try {
    [requests, days, items] = await Promise.all([
      cloudService.getAll('rental_requests'),
      cloudService.getAll('rental_shoot_days'),
      cloudService.getAll('rental_line_items'),
    ]);
  } catch (err: any) {
    console.warn('[RentalUsage] Pull failed; keeping the local shoot mirror:', err?.message ?? err);
    return;
  }

  const requestRows = requests.map((row) => pick('rental_requests', row)).filter(Boolean) as Record<string, unknown>[];
  const requestIds = new Set(requestRows.map((row) => String(row.id)));
  const dayRows = days
    .map((row) => pick('rental_shoot_days', row))
    .filter((row): row is Record<string, unknown> => !!row && requestIds.has(String(row.request_id)));
  const dayIds = new Set(dayRows.map((row) => String(row.id)));
  const itemRows = items
    .map((row) => pick('rental_line_items', row))
    .filter((row): row is Record<string, unknown> => (
      !!row && requestIds.has(String(row.request_id)) && dayIds.has(String(row.day_id))
    ));

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const row of requestRows) upsert(db, 'rental_requests', row);
      for (const row of dayRows) upsert(db, 'rental_shoot_days', row);
      for (const row of itemRows) upsert(db, 'rental_line_items', row);
      deleteMissing(db, 'rental_line_items', new Set(itemRows.map((row) => String(row.id))));
      deleteMissing(db, 'rental_shoot_days', dayIds);
      deleteMissing(db, 'rental_requests', requestIds);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  console.log(`[RentalUsage] Mirrored ${requestRows.length} requests, ${dayRows.length} shoot days, ${itemRows.length} line items`);
  notifyChanged();
}

export function applyRentalUsageRealtimeChange(table: string, event: string, newRecord: any, oldRecord: any): void {
  if (!isRentalUsageTable(table)) return;
  const db = getDatabase();

  if (event === 'DELETE') {
    const id = oldRecord?.id;
    if (!id) return;
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return;
  }

  const rec = newRecord ? pick(table, newRecord) : null;
  if (!rec) return;
  db.pragma('foreign_keys = OFF');
  try {
    upsert(db, table, rec);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
