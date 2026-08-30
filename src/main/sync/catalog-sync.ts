import { getDatabase } from '../database/index';
import { getSupabase } from './supabase';
import { cloudService } from './cloud-service';
import { coerceForCloud, offlineQueue } from './offline-queue';
import { recordSchemaError } from './schema-health';
import {
  remapCameraDepartmentTaxonomy,
  regenerateEquipmentCodes,
  seedEquipmentHierarchy,
} from '../database/migrate';
import { EIM_RECOGNIZED_ROLES, isEimAppRole, normalizeEimRole } from '../../shared/constants';

const CATALOG_TABLES = ['departments', 'categories', 'subcategories', 'equipment_items', 'package_definitions', 'package_items', 'users'] as const;

type CatalogTable = typeof CATALOG_TABLES[number];

/**
 * Columns 1 Take reads on catalog pull (and that the shared cloud tables accept).
 * Extra local-only keys (must_change_password, retired display_name, etc.) must
 * never go in an upsert — PostgREST rejects unknown columns (PGRST204).
 */
const CATALOG_CLOUD_COLUMNS: Record<CatalogTable, readonly string[]> = {
  departments: ['id', 'name', 'display_order', 'is_active', 'created_at', 'updated_at'],
  categories: ['id', 'department_id', 'name', 'display_order', 'is_active', 'created_at', 'updated_at'],
  subcategories: ['id', 'category_id', 'name', 'display_order', 'is_active', 'created_at', 'updated_at'],
  equipment_items: [
    'id', 'equipment_code', 'name', 'department_id', 'category_id', 'subcategory_id',
    'sub_subcategory', 'item_type', 'brand', 'model', 'pricing_type', 'base_price',
    'notes', 'quantity', 'available_qty', 'is_active', 'version', 'created_at', 'updated_at',
  ],
  package_definitions: [
    'id', 'main_item_id', 'name', 'description', 'is_active', 'version', 'created_at', 'updated_at',
  ],
  package_items: [
    'id', 'package_id', 'component_id', 'included_qty', 'is_required', 'display_order',
    'created_at', 'updated_at',
  ],
  users: [
    'id', 'username', 'password_hash', 'full_name', 'email', 'role', 'department',
    'is_active', 'version', 'created_at', 'updated_at',
  ],
};

function coerceForSqlite(value: unknown): string | number | bigint | Buffer | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (Buffer.isBuffer(value)) return value;
  return String(value);
}

function hasDepartmentId(row: any): boolean {
  return Boolean(row && row.department_id);
}

/** 1 Take crew-rate catalog. EIM must not ingest or deactivate it. */
export function isPersonnelCatalogName(name: unknown): boolean {
  return typeof name === 'string' && name.trim().toLowerCase().startsWith('personnel');
}

function pickCatalogColumns(table: CatalogTable, row: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(CATALOG_CLOUD_COLUMNS[table]);
  const rec: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in row) rec[key] = row[key];
  }
  if (table === 'equipment_items') {
    const legacyDisplay = typeof row.display_name === 'string' ? row.display_name.trim() : '';
    if (legacyDisplay && (typeof rec.name !== 'string' || !rec.name.trim())) rec.name = legacyDisplay;
  }
  return rec;
}

function toCatalogCloudRecord(table: CatalogTable, row: Record<string, unknown>): Record<string, unknown> {
  return coerceForCloud(pickCatalogColumns(table, row));
}

/** Cloud rows that would violate local NOT NULL / FK constraints after an incomplete departments migration. */
function filterCatalogPullRows(table: CatalogTable, cloudRows: any[], db: any): any[] {
  if (table === 'users') {
    return cloudRows
      .filter((r: any) => isEimAppRole(r.role))
      .map((r: any) => ({ ...r, role: normalizeEimRole(r.role) }));
  }
  if (table === 'departments') {
    return cloudRows.filter((r: any) => r && !isPersonnelCatalogName(r.name));
  }
  if (table === 'categories') {
    const keepDepts = new Set(
      (db.prepare(
        `SELECT id FROM departments WHERE name NOT LIKE 'Personnel%'`,
      ).all() as { id: string }[]).map((r) => r.id),
    );
    return cloudRows.filter((r: any) => hasDepartmentId(r) && keepDepts.has(r.department_id));
  }
  if (table === 'equipment_items') {
    const keepDepts = new Set(
      (db.prepare(
        `SELECT id FROM departments WHERE is_active = 1 AND name NOT LIKE 'Personnel%'`,
      ).all() as { id: string }[]).map((r) => r.id),
    );
    return cloudRows.filter((r: any) => hasDepartmentId(r) && keepDepts.has(r.department_id));
  }
  if (table === 'subcategories') {
    const validParents = new Set(
      (db.prepare(
        `SELECT c.id FROM categories c
         JOIN departments d ON d.id = c.department_id
         WHERE c.department_id IS NOT NULL AND TRIM(COALESCE(c.department_id, '')) <> ''
           AND d.name NOT LIKE 'Personnel%'`,
      ).all() as { id: string }[]).map((r) => r.id),
    );
    return cloudRows.filter((r: any) => r && validParents.has(r.category_id));
  }
  return cloudRows;
}

function canApplyCatalogRow(table: CatalogTable, row: any, db: any): boolean {
  if (!row) return false;
  if (table === 'departments') return !isPersonnelCatalogName(row.name);
  if (table === 'equipment_items' || table === 'categories') {
    if (!hasDepartmentId(row)) return false;
    return Boolean(
      db.prepare(
        `SELECT 1 AS ok FROM departments
         WHERE id = ? AND name NOT LIKE 'Personnel%' LIMIT 1`,
      ).get(row.department_id),
    );
  }
  if (table === 'subcategories') {
    if (!row.category_id) return false;
    return Boolean(
      db.prepare(
        `SELECT 1 AS ok FROM categories c
         JOIN departments d ON d.id = c.department_id
         WHERE c.id = ? AND c.department_id IS NOT NULL AND TRIM(COALESCE(c.department_id, '')) <> ''
           AND d.name NOT LIKE 'Personnel%'
         LIMIT 1`,
      ).get(row.category_id),
    );
  }
  return true;
}

function upsertLocalRow(db: any, table: CatalogTable, row: Record<string, unknown>): void {
  const rec = pickCatalogColumns(table, row);
  const keys = Object.keys(rec);
  if (keys.length === 0 || !rec.id) return;
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
  ).run(...keys.map(k => coerceForSqlite(rec[k])));
}

/** Local rows safe to upsert (parents must already exist). 1 Take is pull-only so this is what it receives. */
function localRowsForCatalogPush(db: any, table: CatalogTable): any[] {
  switch (table) {
    case 'package_items':
      return db.prepare(`
        SELECT pi.* FROM package_items pi
        JOIN package_definitions pd ON pd.id = pi.package_id AND pd.is_active = 1
        JOIN equipment_items e ON e.id = pi.component_id AND e.is_active = 1
      `).all();
    case 'package_definitions':
      return db.prepare(`
        SELECT p.* FROM package_definitions p
        JOIN equipment_items e ON e.id = p.main_item_id AND e.is_active = 1
        WHERE p.is_active = 1
      `).all();
    case 'subcategories':
      return db.prepare(`
        SELECT s.* FROM subcategories s
        JOIN categories c ON c.id = s.category_id AND c.is_active = 1
        JOIN departments d ON d.id = c.department_id AND d.is_active = 1 AND d.name NOT LIKE 'Personnel%'
        WHERE s.is_active = 1
      `).all();
    case 'categories':
      return db.prepare(`
        SELECT c.* FROM categories c
        JOIN departments d ON d.id = c.department_id AND d.is_active = 1 AND d.name NOT LIKE 'Personnel%'
        WHERE c.is_active = 1
      `).all();
    case 'departments':
      return db.prepare(`
        SELECT * FROM departments WHERE is_active = 1 AND name NOT LIKE 'Personnel%'
      `).all();
    case 'equipment_items':
      return db.prepare(`
        SELECT e.* FROM equipment_items e
        JOIN departments d ON d.id = e.department_id AND d.name NOT LIKE 'Personnel%'
        JOIN categories c ON c.id = e.category_id AND c.is_active = 1
        LEFT JOIN subcategories s ON s.id = e.subcategory_id
        WHERE e.is_active = 1
          AND e.equipment_code NOT LIKE '__tmp__%'
          AND (e.subcategory_id IS NULL OR (s.id IS NOT NULL AND s.is_active = 1 AND s.category_id = c.id))
      `).all();
    default:
      return db.prepare(`SELECT * FROM ${table} WHERE is_active = 1`).all();
  }
}

/**
 * Point local seed UUIDs at the cloud's canonical rows (same name, different id)
 * so a later push does not violate unique (department name) / (category, name)
 * indexes 1 Take's 041 contract created.
 */
function adoptCloudCatalogIds(db: any, cloudIds: Map<CatalogTable, Set<string>>): void {
  const deptCloud = cloudIds.get('departments') ?? new Set<string>();
  const catCloud = cloudIds.get('categories') ?? new Set<string>();
  const subCloud = cloudIds.get('subcategories') ?? new Set<string>();

  db.pragma('foreign_keys = OFF');
  try {
    const depts = db.prepare(
      `SELECT id, name FROM departments WHERE name NOT LIKE 'Personnel%' ORDER BY is_active DESC, display_order, id`,
    ).all() as Array<{ id: string; name: string }>;
    const byDeptName = new Map<string, string[]>();
    for (const d of depts) {
      const list = byDeptName.get(d.name) ?? [];
      list.push(d.id);
      byDeptName.set(d.name, list);
    }
    const remapDept = db.prepare('UPDATE categories SET department_id = ? WHERE department_id = ?');
    const remapItemDept = db.prepare('UPDATE equipment_items SET department_id = ? WHERE department_id = ?');
    const deleteDept = db.prepare('DELETE FROM departments WHERE id = ?');
    for (const ids of byDeptName.values()) {
      const keeper = ids.find((id) => deptCloud.has(id)) ?? ids[0];
      if (!keeper) continue;
      for (const dupe of ids) {
        if (dupe === keeper) continue;
        remapDept.run(keeper, dupe);
        remapItemDept.run(keeper, dupe);
        deleteDept.run(dupe);
      }
    }

    const cats = db.prepare(
      `SELECT id, department_id, name FROM categories ORDER BY is_active DESC, display_order, id`,
    ).all() as Array<{ id: string; department_id: string; name: string }>;
    const byCatKey = new Map<string, string[]>();
    for (const c of cats) {
      const key = `${c.department_id}::${c.name}`;
      const list = byCatKey.get(key) ?? [];
      list.push(c.id);
      byCatKey.set(key, list);
    }
    const remapSubCat = db.prepare('UPDATE subcategories SET category_id = ? WHERE category_id = ?');
    const remapItemCat = db.prepare('UPDATE equipment_items SET category_id = ? WHERE category_id = ?');
    const deleteCat = db.prepare('DELETE FROM categories WHERE id = ?');
    for (const ids of byCatKey.values()) {
      const keeper = ids.find((id) => catCloud.has(id)) ?? ids[0];
      if (!keeper) continue;
      for (const dupe of ids) {
        if (dupe === keeper) continue;
        remapSubCat.run(keeper, dupe);
        remapItemCat.run(keeper, dupe);
        deleteCat.run(dupe);
      }
    }

    const subs = db.prepare(
      `SELECT id, category_id, name FROM subcategories ORDER BY is_active DESC, display_order, id`,
    ).all() as Array<{ id: string; category_id: string; name: string }>;
    const bySubKey = new Map<string, string[]>();
    for (const s of subs) {
      const key = `${s.category_id}::${s.name}`;
      const list = bySubKey.get(key) ?? [];
      list.push(s.id);
      bySubKey.set(key, list);
    }
    const remapItemSub = db.prepare('UPDATE equipment_items SET subcategory_id = ? WHERE subcategory_id = ?');
    const deleteSub = db.prepare('DELETE FROM subcategories WHERE id = ?');
    for (const ids of bySubKey.values()) {
      const keeper = ids.find((id) => subCloud.has(id)) ?? ids[0];
      if (!keeper) continue;
      for (const dupe of ids) {
        if (dupe === keeper) continue;
        remapItemSub.run(keeper, dupe);
        deleteSub.run(dupe);
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

async function upsertManyResilient(table: CatalogTable, rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => toCatalogCloudRecord(table, r));
  try {
    await cloudService.upsertMany(table, payload);
    return;
  } catch (err: any) {
    console.warn(
      `[CatalogSync] Bulk upsert "${table}" failed (${err?.code ?? err?.message}); retrying row-by-row`,
    );
  }
  let ok = 0;
  for (const rec of payload) {
    try {
      await cloudService.upsert(table, rec);
      ok += 1;
    } catch (rowErr: any) {
      console.warn(
        `[CatalogSync] Skip ${table}/${String(rec.id)}: ${rowErr?.message ?? rowErr}`,
      );
    }
  }
  console.log(`[CatalogSync] Row-by-row "${table}": ${ok}/${payload.length}`);
}

export async function syncCatalogWithCloud(): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  const db = getDatabase();
  const cloudIds = new Map<CatalogTable, Set<string>>();

  // Pull first so this machine learns other EIM installs' ids, then rewrite
  // taxonomy/codes locally and push the full catalog. 1 Take is pull-only and
  // skips the whole catalog if any equipment_item lacks department_id.
  for (const table of CATALOG_TABLES) {
    try {
      const cloudRows = await cloudService.getAll(table);
      cloudIds.set(table, new Set(cloudRows.map((r: any) => r.id).filter(Boolean)));

      const rowsToApply = filterCatalogPullRows(table, cloudRows, db);

      if (
        (table === 'equipment_items' || table === 'categories' || table === 'subcategories')
        && cloudRows.length > 0 && rowsToApply.length === 0
      ) {
        console.warn(`[CatalogSync] Cloud ${table} is pre-department schema — skipping pull`);
        continue;
      }

      if (rowsToApply.length > 0) {
        const tx = db.transaction(() => {
          for (const row of rowsToApply) {
            upsertLocalRow(db, table, row);
          }
        });
        tx();
      }

      if (table === 'users') {
        try {
          const placeholders = EIM_RECOGNIZED_ROLES.map(() => '?').join(', ');
          db.prepare(`DELETE FROM users WHERE role NOT IN (${placeholders})`).run(...EIM_RECOGNIZED_ROLES);
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

  try {
    adoptCloudCatalogIds(db, cloudIds);
    seedEquipmentHierarchy(db);
    remapCameraDepartmentTaxonomy(db);
    regenerateEquipmentCodes(db);
  } catch (err) {
    console.warn('[CatalogSync] Catalog canonicalize failed:', err);
  }

  // EIM is the catalog source of truth. Push every valid local row — not just
  // ids the cloud is missing — so 1 Take receives taxonomy remaps, SKU prefixes,
  // quantity snapshots, and package edits.
  for (const table of CATALOG_TABLES) {
    try {
      const localRows = localRowsForCatalogPush(db, table);
      if (localRows.length > 0) await upsertManyResilient(table, localRows);
    } catch (err) {
      recordSchemaError(table, err);
      console.error(`[CatalogSync] Failed to push ${table}:`, err);
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
      await cloudService.upsert(table, toCatalogCloudRecord(table, record));
    }
  } catch {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, record.id as string, toCatalogCloudRecord(table, record));
  }
}

export function applyCatalogRealtimeChange(table: string, event: string, newRecord: any, oldRecord: any): void {
  const db = getDatabase();
  const catalogTable = table as CatalogTable;

  if (!CATALOG_TABLES.includes(catalogTable as any)) return;

  // Ignore realtime changes for rental-only user accounts (shared users table).
  if (catalogTable === 'users' && event !== 'DELETE' && !isEimAppRole(newRecord?.role)) return;
  if (event !== 'DELETE' && !canApplyCatalogRow(catalogTable, newRecord, db)) return;

  if (event === 'DELETE' && oldRecord?.id) {
    if (catalogTable === 'package_items') {
      db.prepare(`DELETE FROM package_items WHERE id = ?`).run(oldRecord.id);
    } else {
      db.prepare(`UPDATE ${catalogTable} SET is_active = 0 WHERE id = ?`).run(oldRecord.id);
    }
  } else if (newRecord?.id) {
    const row = catalogTable === 'users'
      ? { ...newRecord, role: normalizeEimRole(newRecord.role) }
      : newRecord;
    upsertLocalRow(db, catalogTable, row);
  }
}

export function deduplicateCatalog(): void {
  // Stub — implement if duplicate detection becomes necessary
}
