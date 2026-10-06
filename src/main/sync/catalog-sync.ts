import { getDatabase } from '../database/index';
import { getSupabase } from './supabase';
import { cloudService } from './cloud-service';
import { coerceForCloud, offlineQueue } from './offline-queue';
import { recordSchemaError } from './schema-health';
import {
  deactivateLegacyLightsGripsTaxonomy,
  pruneUnusedObsoleteCatalog,
  remapCameraDepartmentTaxonomy,
  remapGripsTaxonomy,
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
  if (table === 'categories') {
    const keepDepts = new Set(
      (db.prepare(
        `SELECT id FROM departments`,
      ).all() as { id: string }[]).map((r) => r.id),
    );
    return cloudRows.filter((r: any) => hasDepartmentId(r) && keepDepts.has(r.department_id));
  }
  if (table === 'equipment_items') {
    const keepDepts = new Set(
      (db.prepare(
        `SELECT id FROM departments WHERE is_active = 1`,
      ).all() as { id: string }[]).map((r) => r.id),
    );
    return cloudRows.filter((r: any) => hasDepartmentId(r) && keepDepts.has(r.department_id));
  }
  if (table === 'subcategories') {
    const validParents = new Set(
      (db.prepare(
        `SELECT c.id FROM categories c
         JOIN departments d ON d.id = c.department_id
         WHERE c.department_id IS NOT NULL AND TRIM(COALESCE(c.department_id, '')) <> ''`,
      ).all() as { id: string }[]).map((r) => r.id),
    );
    return cloudRows.filter((r: any) => r && validParents.has(r.category_id));
  }
  return cloudRows;
}

function canApplyCatalogRow(table: CatalogTable, row: any, db: any): boolean {
  if (!row) return false;
  if (table === 'equipment_items' || table === 'categories') {
    if (!hasDepartmentId(row)) return false;
    return Boolean(
      db.prepare(
        `SELECT 1 AS ok FROM departments WHERE id = ? LIMIT 1`,
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
         LIMIT 1`,
      ).get(row.category_id),
    );
  }
  return true;
}

const VERSIONED_TABLES = new Set<CatalogTable>(['equipment_items', 'package_definitions', 'users']);

function upsertLocalRow(db: any, table: CatalogTable, row: Record<string, unknown>): void {
  const rec = pickCatalogColumns(table, row);
  const keys = Object.keys(rec);
  if (keys.length === 0 || !rec.id) return;
  const placeholders = keys.map(() => '?').join(', ');
  const updates = keys
    .filter(k => k !== 'id')
    .map(k => {
      if (k === 'password_hash') {
        // EIM stores scrypt as 32-hex-salt : 128-hex-digest (161 chars). 1 Take
        // hashes also contain a colon but are a different scheme — applying them
        // makes auth:login fail for every EIM user.
        return `password_hash = CASE WHEN length(excluded.password_hash) = 161 AND substr(excluded.password_hash, 33, 1) = ':' THEN excluded.password_hash ELSE ${table}.password_hash END`;
      }
      return `${k} = excluded.${k}`;
    })
    .join(', ');

  // For versioned tables, only overwrite when cloud version >= local version.
  // This prevents a stale cloud pull from reverting a recent local import/edit
  // whose push hasn't landed in the cloud yet.
  const versionGuard = VERSIONED_TABLES.has(table) && keys.includes('version')
    ? ` WHERE excluded.version >= ${table}.version`
    : '';

  db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}${versionGuard}`
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
      // Inactive rows are included so a local hide/rename reaches the cloud.
      // Pushing only active rows left the old cloud name in place.
      return db.prepare(`
        SELECT s.* FROM subcategories s
        JOIN categories c ON c.id = s.category_id
        JOIN departments d ON d.id = c.department_id
      `).all();
    case 'categories':
      return db.prepare(`
        SELECT c.* FROM categories c
        JOIN departments d ON d.id = c.department_id
      `).all();
    case 'departments':
      return db.prepare(`
        SELECT * FROM departments WHERE is_active = 1
      `).all();
    case 'equipment_items':
      return db.prepare(`
        SELECT e.* FROM equipment_items e
        JOIN departments d ON d.id = e.department_id
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
      `SELECT id, name FROM departments ORDER BY is_active DESC, display_order, id`,
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

/**
 * After a rename, two local rows can share a department+name (one inactive).
 * The cloud unique (department, name) / (category, name) indexes reject that.
 * Keep a row the cloud already has when possible, move children onto it, and
 * drop the duplicate so the later push can update that one id.
 */
function collapseDuplicateTaxonomy(
  db: any,
  preferCategoryIds: Set<string>,
  preferSubcategoryIds: Set<string>,
): void {
  const collapse = (
    rows: Array<{ id: string; is_active: number }>,
    keyOf: (row: any) => string,
    prefer: Set<string>,
    onDupe: (keeper: string, dupe: string) => void,
    activate: (id: string) => void,
  ) => {
    const groups = new Map<string, Array<{ id: string; is_active: number }>>();
    for (const row of rows) {
      const list = groups.get(keyOf(row)) ?? [];
      list.push(row);
      groups.set(keyOf(row), list);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const keeper = group.find((row) => prefer.has(row.id))?.id ?? group[0]!.id;
      if (group.some((row) => row.is_active)) activate(keeper);
      for (const row of group) {
        if (row.id === keeper) continue;
        onDupe(keeper, row.id);
      }
    }
  };

  db.pragma('foreign_keys = OFF');
  try {
    const cats = db.prepare(
      `SELECT id, department_id, name, is_active FROM categories ORDER BY is_active DESC, display_order, id`,
    ).all() as Array<{ id: string; department_id: string; name: string; is_active: number }>;
    const remapSubCat = db.prepare('UPDATE subcategories SET category_id = ? WHERE category_id = ?');
    const remapItemCat = db.prepare('UPDATE equipment_items SET category_id = ? WHERE category_id = ?');
    const deleteCat = db.prepare('DELETE FROM categories WHERE id = ?');
    const activateCat = db.prepare('UPDATE categories SET is_active = 1 WHERE id = ?');
    collapse(
      cats,
      (c) => `${c.department_id}::${c.name}`,
      preferCategoryIds,
      (keeper, dupe) => {
        remapSubCat.run(keeper, dupe);
        remapItemCat.run(keeper, dupe);
        deleteCat.run(dupe);
      },
      (id) => activateCat.run(id),
    );

    const subs = db.prepare(
      `SELECT id, category_id, name, is_active FROM subcategories ORDER BY is_active DESC, display_order, id`,
    ).all() as Array<{ id: string; category_id: string; name: string; is_active: number }>;
    const remapItemSub = db.prepare('UPDATE equipment_items SET subcategory_id = ? WHERE subcategory_id = ?');
    const deleteSub = db.prepare('DELETE FROM subcategories WHERE id = ?');
    const activateSub = db.prepare('UPDATE subcategories SET is_active = 1 WHERE id = ?');
    collapse(
      subs,
      (s) => `${s.category_id}::${s.name}`,
      preferSubcategoryIds,
      (keeper, dupe) => {
        remapItemSub.run(keeper, dupe);
        deleteSub.run(dupe);
      },
      (id) => activateSub.run(id),
    );
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function planNamedPush(
  localRows: any[],
  pulledById: Map<string, any>,
  keyOf: (row: any) => string,
): { first: any[]; last: any[]; removeIds: string[] } {
  const localIds = new Set(localRows.map((row) => String(row.id)));
  const removeIds = [...pulledById.keys()].filter((id) => !localIds.has(id));
  const blocking = new Set(removeIds.map((id) => keyOf(pulledById.get(id))));
  const first: any[] = [];
  const last: any[] = [];
  for (const row of localRows) {
    if (blocking.has(keyOf(row))) last.push(row);
    else first.push(row);
  }
  return { first, last, removeIds };
}

async function upsertCatalogRows(table: CatalogTable, rows: any[]): Promise<void> {
  if (rows.length > 0) await upsertManyResilient(table, rows);
}

async function removeCatalogIds(table: 'categories' | 'subcategories', ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await cloudService.remove(table, id);
    } catch (err: any) {
      console.warn(`[CatalogSync] Could not remove ${table}/${id}: ${err?.message ?? err}`);
    }
  }
}

function equipmentRowsForPush(
  db: any,
  pulled: Map<string, { category_id: string | null; subcategory_id: string | null }>,
): any[] {
  const active = localRowsForCatalogPush(db, 'equipment_items');
  const seen = new Set(active.map((row: any) => String(row.id)));
  if (pulled.size === 0) return active;
  const extras = db.prepare(
    `SELECT * FROM equipment_items WHERE equipment_code NOT LIKE '__tmp__%'`,
  ).all() as any[];
  const moved = extras.filter((row) => {
    if (seen.has(String(row.id))) return false;
    const prev = pulled.get(String(row.id));
    if (!prev) return false;
    return prev.category_id !== row.category_id
      || (prev.subcategory_id ?? null) !== (row.subcategory_id ?? null);
  });
  return [...active, ...moved];
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
  const pulledCategoryById = new Map<string, any>();
  const pulledSubcategoryById = new Map<string, any>();
  const pulledEquipmentTaxonomy = new Map<string, { category_id: string | null; subcategory_id: string | null }>();

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

      if (table === 'categories') {
        for (const row of rowsToApply) if (row?.id) pulledCategoryById.set(String(row.id), row);
      } else if (table === 'subcategories') {
        for (const row of rowsToApply) if (row?.id) pulledSubcategoryById.set(String(row.id), row);
      } else if (table === 'equipment_items') {
        for (const row of rowsToApply) {
          if (!row?.id) continue;
          pulledEquipmentTaxonomy.set(String(row.id), {
            category_id: row.category_id ?? null,
            subcategory_id: row.subcategory_id ?? null,
          });
        }
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
    remapGripsTaxonomy(db);
    regenerateEquipmentCodes(db);
    pruneUnusedObsoleteCatalog(db);
    deactivateLegacyLightsGripsTaxonomy(db);
  } catch (err) {
    console.warn('[CatalogSync] Catalog canonicalize failed:', err);
  }

  try {
    collapseDuplicateTaxonomy(
      db,
      new Set(pulledCategoryById.keys()),
      new Set(pulledSubcategoryById.keys()),
    );
  } catch (err) {
    console.warn('[CatalogSync] Catalog name collapse failed:', err);
  }

  // EIM is the catalog source of truth. Categories and subcategories are pushed
  // active and inactive. A renamed row can share its new name with a cloud row
  // we just folded away, so that cloud id is removed before the rename upsert.
  const catKey = (row: any) => `${row?.department_id}::${row?.name}`;
  const subKey = (row: any) => `${row?.category_id}::${row?.name}`;
  const categories = planNamedPush(localRowsForCatalogPush(db, 'categories'), pulledCategoryById, catKey);
  const subcategories = planNamedPush(localRowsForCatalogPush(db, 'subcategories'), pulledSubcategoryById, subKey);

  const pushSteps: Array<{ table: CatalogTable; run: () => Promise<void> }> = [
    { table: 'departments', run: () => upsertCatalogRows('departments', localRowsForCatalogPush(db, 'departments')) },
    { table: 'categories', run: () => upsertCatalogRows('categories', categories.first) },
    { table: 'subcategories', run: () => upsertCatalogRows('subcategories', subcategories.first) },
    { table: 'equipment_items', run: () => upsertCatalogRows('equipment_items', equipmentRowsForPush(db, pulledEquipmentTaxonomy)) },
    { table: 'subcategories', run: () => removeCatalogIds('subcategories', subcategories.removeIds) },
    { table: 'subcategories', run: () => upsertCatalogRows('subcategories', subcategories.last) },
    { table: 'categories', run: () => removeCatalogIds('categories', categories.removeIds) },
    { table: 'categories', run: () => upsertCatalogRows('categories', categories.last) },
    { table: 'package_definitions', run: () => upsertCatalogRows('package_definitions', localRowsForCatalogPush(db, 'package_definitions')) },
    { table: 'package_items', run: () => upsertCatalogRows('package_items', localRowsForCatalogPush(db, 'package_items')) },
    { table: 'users', run: () => upsertCatalogRows('users', localRowsForCatalogPush(db, 'users')) },
  ];
  for (const step of pushSteps) {
    try {
      await step.run();
    } catch (err) {
      recordSchemaError(step.table, err);
      console.error(`[CatalogSync] Failed to push ${step.table}:`, err);
    }
  }
}

export async function pushCatalogToCloud(table: CatalogTable, action: string, record: Record<string, unknown>): Promise<void> {
  if (!getSupabase()) {
    offlineQueue.enqueue(action === 'DELETE' ? 'DELETE' : 'UPDATE', table, record.id as string, toCatalogCloudRecord(table, record));
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
