import { getDatabase } from '../database/index';
import { getSupabase } from './supabase';
import { cloudService } from './cloud-service';
import { offlineQueue } from './offline-queue';

const CATALOG_TABLES = ['categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items'] as const;

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

      if (cloudRows.length > 0) {
        const tx = db.transaction(() => {
          for (const row of cloudRows) {
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
    } catch (err) {
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

  if (event === 'DELETE' && oldRecord?.id) {
    if (catalogTable === 'package_items') {
      db.prepare(`DELETE FROM package_items WHERE id = ?`).run(oldRecord.id);
    } else {
      db.prepare(`UPDATE ${catalogTable} SET is_active = 0 WHERE id = ?`).run(oldRecord.id);
    }
  } else if (newRecord?.id) {
    upsertLocalRow(db, catalogTable, newRecord);
  }
}

export function deduplicateCatalog(): void {
  // Stub — implement if duplicate detection becomes necessary
}
