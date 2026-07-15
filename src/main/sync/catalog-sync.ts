import { getDatabase } from '../database/index';
import { getSupabase } from './supabase';
import { cloudService } from './cloud-service';
import { offlineQueue } from './offline-queue';
import { recordSchemaError } from './schema-health';
import { EIM_RECOGNIZED_ROLES, isEimAppRole, normalizeEimRole } from '../../shared/constants';

const CATALOG_TABLES = ['categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items', 'users'] as const;

type CatalogTable = typeof CATALOG_TABLES[number];

function coerceForSqlite(value: unknown): string | number | bigint | Buffer | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (Buffer.isBuffer(value)) return value;
  return String(value);
}

function upsertLocalRow(db: any, table: CatalogTable, row: Record<string, unknown>): void {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => '?').join(', ');
  const updates = keys
    .filter(k => k !== 'id')
    .map(k => {
      if (k === 'password_hash') {
        return `password_hash = CASE WHEN length(excluded.password_hash) > 0 AND excluded.password_hash LIKE '%:%' THEN excluded.password_hash ELSE ${table}.password_hash END`;
      }
      return `${k} = excluded.${k}`;
    })
    .join(', ');

  db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`
  ).run(...keys.map(k => coerceForSqlite(row[k])));
}

export async function syncCatalogWithCloud(): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  const db = getDatabase();

  for (const table of CATALOG_TABLES) {
    try {
      const cloudRows = await cloudService.getAll(table);

      // The users table is shared with the Rental (1Take) app, so the cloud
      // table holds both apps' accounts. Only ingest users whose role belongs
      // to EIM; rental-only accounts stay in the cloud but never touch EIM's DB.
      // Legacy operational roles are collapsed into equipment_manager on the way in.
      const rowsToApply = table === 'users'
        ? cloudRows
            .filter((r: any) => isEimAppRole(r.role))
            .map((r: any) => ({ ...r, role: normalizeEimRole(r.role) }))
        : cloudRows;

      if (cloudRows.length > 0) {
        const tx = db.transaction(() => {
          for (const row of rowsToApply) {
            upsertLocalRow(db, table, row);
          }
        });
        tx();
      } else {
        const localRows: any[] = db.prepare(`SELECT * FROM ${table} WHERE is_active = 1`).all();
        if (localRows.length > 0) {
          await cloudService.upsertMany(table, localRows);
        }
      }

      if (table === 'users') {
        try {
          // Purge any rental-only users a prior sync may have pulled into the
          // local DB, so EIM's list and login stay EIM-only.
          const placeholders = EIM_RECOGNIZED_ROLES.map(() => '?').join(', ');
          db.prepare(`DELETE FROM users WHERE role NOT IN (${placeholders})`).run(...EIM_RECOGNIZED_ROLES);
          // Collapse any lingering legacy operational roles into equipment_manager.
          db.prepare(
            `UPDATE users SET role = 'equipment_manager' WHERE role NOT IN ('admin', 'equipment_manager', 'viewer')`,
          ).run();
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      recordSchemaError(table, err);
      console.error(`[CatalogSync] Failed to sync ${table}:`, err);
    }
  }
}

export async function pushCatalogToCloud(table: CatalogTable, action: string, record: Record<string, unknown>): Promise<void> {
  if (!getSupabase()) {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, record.id as string, record);
    return;
  }

  try {
    if (action === 'DELETE') {
      await cloudService.remove(table, record.id as string);
    } else {
      await cloudService.upsert(table, record);
    }
  } catch {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, record.id as string, record);
  }
}

export function applyCatalogRealtimeChange(table: string, event: string, newRecord: any, oldRecord: any): void {
  const db = getDatabase();
  const catalogTable = table as CatalogTable;

  if (!CATALOG_TABLES.includes(catalogTable as any)) return;

  // Ignore realtime changes for rental-only user accounts (shared users table).
  if (catalogTable === 'users' && event !== 'DELETE' && !isEimAppRole(newRecord?.role)) return;

  if (event === 'DELETE' && oldRecord?.id) {
    if (catalogTable === 'package_items') {
      db.prepare(`DELETE FROM package_items WHERE id = ?`).run(oldRecord.id);
    } else {
      db.prepare(`UPDATE ${catalogTable} SET is_active = 0 WHERE id = ?`).run(oldRecord.id);
    }
  } else if (newRecord?.id) {
    // Collapse legacy operational roles into equipment_manager on the way in.
    const row = catalogTable === 'users'
      ? { ...newRecord, role: normalizeEimRole(newRecord.role) }
      : newRecord;
    upsertLocalRow(db, catalogTable, row);
  }
}

export function deduplicateCatalog(): void {
  // Stub — implement if duplicate detection becomes necessary
}
