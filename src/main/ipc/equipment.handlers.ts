import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireInventoryAccess } from './session';
import { writeAuditLog } from './audit';
import { EquipmentCreateSchema, EquipmentUpdateSchema, AssetUpdateSchema, AssetStatusUpdateSchema } from '../../shared/schemas';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { opsDepartmentOf } from '../../shared/constants';
import { seedEquipmentHierarchy } from '../database/migrate';
import { sessionDepartment, categoriesForDepartment, assertEquipmentInDepartment } from './department';
import { recomputeAvailability, insertAssetStatusLog, pushStatusLogsToCloud } from './availability';
import { parseCsvRow } from './utils/csv';
import {
  buildSkuPrefix, formatUnitCode, nextUnitCounts,
  parseUnitCount, trailingUnitCount, unitQtyFromCsvRow,
} from '../../shared/equipment-code';

export function registerEquipmentHandlers(): void {
  const db = getDatabase();

  // Reject creating equipment in a category outside the session's department.
  const assertCategoryInDepartment = (event: any, categoryId: string): void => {
    const dept = sessionDepartment(event);
    if (!dept) return;
    const cat: any = db.prepare(`
      SELECT d.name as department_name FROM categories c
      JOIN departments d ON d.id = c.department_id
      WHERE c.id = ?
    `).get(categoryId);
    if (!cat || opsDepartmentOf(cat.department_name, null) !== dept) {
      throw new Error('You can only manage equipment in your own department.');
    }
  };

  const ensureCategoryId = (departmentId: string, categoryIdOrName: string): string => {
    seedEquipmentHierarchy(db);
    const byId: any = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryIdOrName);
    if (byId) {
      db.prepare('UPDATE categories SET is_active = 1 WHERE id = ?').run(byId.id);
      return byId.id as string;
    }
    const byName: any = db.prepare(
      'SELECT id FROM categories WHERE department_id = ? AND name = ? LIMIT 1',
    ).get(departmentId, categoryIdOrName);
    if (byName) {
      db.prepare('UPDATE categories SET is_active = 1 WHERE id = ?').run(byName.id);
      return byName.id as string;
    }
    const id = uuidv4();
    db.prepare(
      'INSERT INTO categories (id, department_id, name, display_order, is_active) VALUES (?, ?, ?, 0, 1)',
    ).run(id, departmentId, categoryIdOrName);
    return id;
  };

  const ensureSubcategoryId = (categoryId: string, subcategoryIdOrName: string | null | undefined): string | null => {
    if (!subcategoryIdOrName) return null;
    seedEquipmentHierarchy(db);
    const byId: any = db.prepare('SELECT id FROM subcategories WHERE id = ?').get(subcategoryIdOrName);
    if (byId) {
      db.prepare('UPDATE subcategories SET is_active = 1 WHERE id = ?').run(byId.id);
      return byId.id as string;
    }
    const byName: any = db.prepare(
      'SELECT id FROM subcategories WHERE category_id = ? AND name = ? LIMIT 1',
    ).get(categoryId, subcategoryIdOrName);
    if (byName) {
      db.prepare('UPDATE subcategories SET is_active = 1 WHERE id = ?').run(byName.id);
      return byName.id as string;
    }
    const id = uuidv4();
    db.prepare(
      'INSERT INTO subcategories (id, category_id, name, display_order, is_active) VALUES (?, ?, ?, 0, 1)',
    ).run(id, categoryId, subcategoryIdOrName);
    return id;
  };

  const skuPrefixFor = (departmentId: string, categoryId: string, brand: string, model: string): string => {
    const row: any = db.prepare(`
      SELECT d.name as department_name, c.name as category_name
      FROM categories c JOIN departments d ON d.id = c.department_id
      WHERE c.id = ?
    `).get(categoryId);
    return buildSkuPrefix({
      departmentName: row?.department_name,
      categoryName: row?.category_name,
      brand,
      model,
    });
  };

  const usedCountsForPrefix = (prefix: string): number[] => {
    const rows: any[] = db.prepare(
      'SELECT equipment_code FROM equipment_assets WHERE equipment_code LIKE ?',
    ).all(`${prefix}-%`);
    return rows
      .map((r) => parseUnitCount(r.equipment_code, prefix))
      .filter((n: number | null): n is number => n != null);
  };

  const findSku = (departmentId: string, categoryId: string, brand: string, model: string): any => {
    return db.prepare(`
      SELECT * FROM equipment_items
      WHERE is_active = 1 AND department_id = ? AND category_id = ?
        AND LOWER(TRIM(COALESCE(brand, ''))) = LOWER(TRIM(?))
        AND LOWER(TRIM(COALESCE(model, ''))) = LOWER(TRIM(?))
      LIMIT 1
    `).get(departmentId, categoryId, brand || '', model || '');
  };

  const insertAsset = (params: {
    id: string;
    equipmentId: string;
    unitCode: string;
    serial_number: string;
    asset_tag?: string | null;
    purchase_date?: string | null;
    delivered_date?: string | null;
    purchase_price?: number;
    vendor_name?: string | null;
    warranty_expiry?: string | null;
    current_location?: string;
    now: string;
  }): void => {
    db.prepare(`
      INSERT INTO equipment_assets (id, equipment_id, equipment_code, serial_number, asset_tag, purchase_date, delivered_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
    `).run(
      params.id, params.equipmentId, params.unitCode, params.serial_number, params.asset_tag ?? null,
      params.purchase_date ?? null, params.delivered_date ?? null, params.purchase_price ?? 0,
      params.vendor_name ?? null, params.warranty_expiry ?? null,
      params.current_location ?? 'Warehouse', params.now, params.now,
    );
  };

  // Reject touching an asset (by asset_id) that belongs to another department.
  const assertAssetInDepartment = (event: any, assetId: string): void => {
    const dept = sessionDepartment(event);
    if (!dept) return;
    const asset: any = db.prepare('SELECT equipment_id FROM equipment_assets WHERE id = ?').get(assetId);
    if (!asset) throw new Error('Asset not found');
    assertEquipmentInDepartment(db, event, asset.equipment_id);
  };

  ipcMain.handle('db:departments:getAll', () => {
    return db.prepare('SELECT * FROM departments WHERE is_active = 1 ORDER BY display_order').all();
  });

  ipcMain.handle('db:categories:getAll', (event: any) => {
    const cats = categoriesForDepartment(sessionDepartment(event));
    const deptWhere = cats ? `AND d.name IN (${cats.map(() => '?').join(', ')})` : '';
    return db.prepare(`
      SELECT c.* FROM categories c
      JOIN departments d ON d.id = c.department_id
      WHERE c.is_active = 1 ${deptWhere}
      ORDER BY c.display_order
    `).all(...(cats || []));
  });

  ipcMain.handle('db:subcategories:getAll', () => {
    return db.prepare('SELECT * FROM subcategories WHERE is_active = 1 ORDER BY display_order').all();
  });

  ipcMain.handle('db:subcategories:getByCategory', (_e: any, categoryId: string) => {
    return db.prepare('SELECT * FROM subcategories WHERE category_id = ? AND is_active = 1 ORDER BY display_order').all(categoryId);
  });

  // Status/action on a unit come from open loans and maintenance tickets.
  const attachUnitActions = (rows: any[]): void => {
    if (rows.length === 0) return;
    const ticketByAsset = new Map<string, { ticket_number: string; document_type: string }>();
    const loanByAsset = new Map<string, { loan_number: string }>();
    const chunkSize = 400;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const ids = chunk.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(', ');
      const tickets: Array<{ asset_id: string; ticket_number: string; document_type: string }> = db.prepare(`
        SELECT asset_id, ticket_number, document_type FROM maintenance_tickets
        WHERE repair_status NOT IN ('COMPLETED', 'CANCELLED') AND asset_id IN (${placeholders})
      `).all(...ids);
      const loans: Array<{ asset_id: string; loan_number: string }> = db.prepare(`
        SELECT li.asset_id, l.loan_number
        FROM equipment_loan_items li
        JOIN equipment_loans l ON l.id = li.loan_id
        WHERE li.status = 'OUT' AND li.asset_id IN (${placeholders})
      `).all(...ids);
      for (const t of tickets) ticketByAsset.set(t.asset_id, t);
      for (const l of loans) loanByAsset.set(l.asset_id, l);
    }
    for (const a of rows) {
      a.open_loan_number = loanByAsset.get(a.id)?.loan_number ?? null;
      const ticket = ticketByAsset.get(a.id);
      a.open_ticket_number = ticket?.ticket_number ?? null;
      a.open_ticket_type = ticket?.document_type ?? null;
    }
  };

  // Load every unit (asset) for the given equipment ids, grouped by equipment_id.
  // Each unit of quantity has its own equipment_assets row, so an item can have many.
  // Chunked to avoid hitting SQLite's parameter limit on large inventories.
  const loadAssetsByEquipment = (equipmentIds: string[]): Map<string, any[]> => {
    const grouped = new Map<string, any[]>();
    if (equipmentIds.length === 0) return grouped;
    const chunkSize = 400;
    const allRows: any[] = [];
    for (let i = 0; i < equipmentIds.length; i += chunkSize) {
      const chunk = equipmentIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows: any[] = db.prepare(
        `SELECT * FROM equipment_assets WHERE equipment_id IN (${placeholders})`,
      ).all(...chunk);
      allRows.push(...rows);
    }
    allRows.sort((a, b) => (trailingUnitCount(a.equipment_code) ?? 0) - (trailingUnitCount(b.equipment_code) ?? 0)
      || String(a.created_at).localeCompare(String(b.created_at))
      || String(a.id).localeCompare(String(b.id)));
    attachUnitActions(allRows);
    for (const a of allRows) {
      const list = grouped.get(a.equipment_id) || [];
      list.push(a);
      grouped.set(a.equipment_id, list);
    }
    return grouped;
  };

  ipcMain.handle('db:equipment:getAll', (event: any) => {
    const cats = categoriesForDepartment(sessionDepartment(event));
    const catWhere = cats ? `AND d.name IN (${cats.map(() => '?').join(', ')})` : '';

    // Diagnostic: raw count of active items, with and without dept filter
    const rawTotal: any = db.prepare('SELECT COUNT(*) as c FROM equipment_items WHERE is_active = 1').get();
    const rawWithDept: any = cats
      ? db.prepare(`SELECT COUNT(*) as c FROM equipment_items e JOIN departments d ON d.id = e.department_id WHERE e.is_active = 1 AND d.name IN (${cats.map(() => '?').join(', ')})`).get(...cats)
      : null;
    const orphanCount: any = db.prepare(
      'SELECT COUNT(*) as c FROM equipment_items e LEFT JOIN departments d ON d.id = e.department_id WHERE e.is_active = 1 AND d.id IS NULL',
    ).get();

    const items: any[] = db.prepare(`
      SELECT e.*, c.name as category_name, sc.name as subcategory_name, d.name as department_name
      FROM equipment_items e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN subcategories sc ON sc.id = e.subcategory_id
      WHERE e.is_active = 1
      ${catWhere}
      ORDER BY e.equipment_code
    `).all(...(cats || []));

    console.log(`[getAll] rawActive=${rawTotal.c} deptFiltered=${rawWithDept?.c ?? 'ALL'} orphanItems=${orphanCount.c} returned=${items.length} cats=${JSON.stringify(cats)}`);

    let grouped: Map<string, any[]>;
    try {
      grouped = loadAssetsByEquipment(items.map((i) => i.id));
    } catch (err) {
      console.error('[getAll] Asset loading failed, returning items without assets:', err);
      grouped = new Map();
    }
    return items.map((row: any) => {
      const assets = grouped.get(row.id) || [];
      return { ...row, is_active: !!row.is_active, assets, asset: assets[0] };
    });
  });

  ipcMain.handle('db:equipment:getById', (event: any, id: string) => {
    const row: any = db.prepare(`
      SELECT e.*, c.name as category_name, sc.name as subcategory_name, d.name as department_name
      FROM equipment_items e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN subcategories sc ON sc.id = e.subcategory_id
      WHERE e.id = ?
    `).get(id);
    if (!row) return null;
    const dept = sessionDepartment(event);
    if (dept && opsDepartmentOf(row.department_name, row.category_name) !== dept) return null;
    const assets = loadAssetsByEquipment([id]).get(id) || [];
    return { ...row, is_active: !!row.is_active, assets, asset: assets[0] };
  });

  ipcMain.handle('db:equipment:generateCode', (_e: any, payload: {
    departmentName?: string;
    categoryName?: string;
    brand?: string;
    model?: string;
  }) => {
    return buildSkuPrefix(payload || {});
  });

  ipcMain.handle('db:equipment:create', (event: any, data: unknown) => {
    const user = requireInventoryAccess(event);
    const input = EquipmentCreateSchema.parse(data);
    const departmentId = input.department_id;
    if (!departmentId) throw new Error('Department is required');
    const categoryId = ensureCategoryId(departmentId, input.category_id);
    const subcategoryId = ensureSubcategoryId(categoryId, input.subcategory_id);
    assertCategoryInDepartment(event, categoryId);
    const basePrice = user.role === 'admin' ? input.base_price : 0;
    const now = new Date().toISOString();
    const skuPrefix = skuPrefixFor(departmentId, categoryId, input.brand, input.model);
    const pricingType = input.item_type === 'package_main' ? 'package_rate' : input.pricing_type;

    const units: { serial_number: string; vendor_name: string | null; delivered_date: string | null; asset_tag: string | null }[] =
      input.units && input.units.length > 0
        ? input.units.map((u) => ({
            serial_number: u.serial_number || '',
            vendor_name: (u.vendor_name ?? input.vendor_name) || null,
            delivered_date: (u.delivered_date ?? input.delivered_date) || null,
            asset_tag: null,
          }))
        : Array.from({ length: Math.max(1, input.quantity ?? 1) }, (_, i) => ({
            serial_number: i === 0 ? (input.serial_number || '') : '',
            vendor_name: input.vendor_name || null,
            delivered_date: input.delivered_date || null,
            asset_tag: i === 0 ? (input.asset_tag || null) : null,
          }));
    const qty = units.length;

    const existingSku = findSku(departmentId, categoryId, input.brand, input.model);
    const assetIds: string[] = [];
    const targetId = existingSku?.id || uuidv4();

    const tx = db.transaction(() => {
      if (existingSku) {
        db.prepare(`
          UPDATE equipment_items SET
            equipment_code = ?, quantity = quantity + ?, notes = COALESCE(?, notes),
            updated_at = ?, version = version + 1
          WHERE id = ?
        `).run(skuPrefix, qty, input.notes || null, now, existingSku.id);
      } else {
        db.prepare(`
          INSERT INTO equipment_items (id, equipment_code, name, department_id, category_id, subcategory_id, sub_subcategory, item_type, brand, model, pricing_type, base_price, notes, quantity, available_qty, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(targetId, skuPrefix, input.name, departmentId, categoryId, subcategoryId,
          input.sub_subcategory || null, input.item_type, input.brand, input.model,
          pricingType, basePrice, input.notes || null, qty, qty, now, now);
      }

      const counts = nextUnitCounts(usedCountsForPrefix(skuPrefix), qty);
      for (let i = 0; i < units.length; i++) {
        const unit = units[i]!;
        const unitId = uuidv4();
        assetIds.push(unitId);
        insertAsset({
          id: unitId,
          equipmentId: targetId,
          unitCode: formatUnitCode(skuPrefix, counts[i]!),
          serial_number: unit.serial_number,
          asset_tag: unit.asset_tag,
          purchase_date: input.purchase_date || null,
          delivered_date: unit.delivered_date,
          purchase_price: input.purchase_price || 0,
          vendor_name: unit.vendor_name,
          warranty_expiry: input.warranty_expiry || null,
          now,
        });
      }
    });
    tx();

    recomputeAvailability(db, targetId);
    const equipmentRow: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(targetId);
    void pushCatalogToCloud('equipment_items', existingSku ? 'UPDATE' : 'INSERT', equipmentRow);

    for (const aid of assetIds) {
      const assetRow: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(aid);
      if (assetRow) void pushOperationalToCloud('equipment_assets', 'INSERT', assetRow);
    }

    return { ...equipmentRow, is_active: true };
  });

  // True if a unit has maintenance/loan/schedule history, in which case it must not
  // be hard-deleted when shrinking quantity (it stays as part of the record).
  const hasAssetReferences = (assetId: string): boolean => {
    const t: any = db.prepare('SELECT COUNT(*) as c FROM maintenance_tickets WHERE asset_id = ?').get(assetId);
    if (t.c > 0) return true;
    const l: any = db.prepare('SELECT COUNT(*) as c FROM equipment_loan_items WHERE asset_id = ?').get(assetId);
    if (l.c > 0) return true;
    const p: any = db.prepare('SELECT COUNT(*) as c FROM preventive_schedules WHERE asset_id = ?').get(assetId);
    return p.c > 0;
  };

  // Reconcile the number of unit (asset) rows to match a desired quantity.
  // Growing adds blank AVAILABLE units (inheriting supplier/dates from an existing one).
  // Shrinking removes spare AVAILABLE units that have no maintenance/loan history.
  const reconcileUnits = (equipmentId: string, desiredQty: number, prefix: string): void => {
    const desired = Math.max(0, Math.floor(desiredQty));
    const liveUnits: any[] = db.prepare(
      "SELECT * FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN ('RETIRED', 'MISSING')",
    ).all(equipmentId);
    liveUnits.sort((a, b) => (trailingUnitCount(a.equipment_code) ?? 0) - (trailingUnitCount(b.equipment_code) ?? 0));

    if (desired > liveUnits.length) {
      const template = liveUnits[0];
      const now = new Date().toISOString();
      const counts = nextUnitCounts(usedCountsForPrefix(prefix), desired - liveUnits.length);
      for (let i = 0; i < counts.length; i++) {
        const newId = uuidv4();
        insertAsset({
          id: newId,
          equipmentId,
          unitCode: formatUnitCode(prefix, counts[i]!),
          serial_number: '',
          purchase_date: template?.purchase_date ?? null,
          delivered_date: template?.delivered_date ?? null,
          purchase_price: template?.purchase_price ?? 0,
          vendor_name: template?.vendor_name ?? null,
          warranty_expiry: template?.warranty_expiry ?? null,
          current_location: template?.current_location ?? 'Warehouse',
          now,
        });
        const created: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(newId);
        if (created) void pushOperationalToCloud('equipment_assets', 'INSERT', created);
      }
    } else if (desired < liveUnits.length) {
      const removable = liveUnits
        .filter((u) => u.current_status === 'AVAILABLE' && !hasAssetReferences(u.id))
        .sort((a, b) => {
          const ac = trailingUnitCount(a.equipment_code);
          const bc = trailingUnitCount(b.equipment_code);
          // Incomplete rows (null/malformed codes) must be dropped before numbered units.
          if (ac == null && bc == null) return 0;
          if (ac == null) return -1;
          if (bc == null) return 1;
          return bc - ac;
        });
      const toRemove = Math.min(liveUnits.length - desired, removable.length);
      for (let i = 0; i < toRemove; i++) {
        const unit = removable[i]!;
        db.prepare('DELETE FROM equipment_assets WHERE id = ?').run(unit.id);
        void pushOperationalToCloud('equipment_assets', 'DELETE', { id: unit.id });
      }
    }
  };

  // Apply serial/supplier/delivered edits, insert new units, and drop spare AVAILABLE
  // units the user removed. Status is never written here.
  const applyUnitEdits = (
    equipmentId: string,
    units: Array<{
      id?: string;
      serial_number?: string;
      vendor_name?: string | null;
      delivered_date?: string;
    }>,
    prefix: string,
  ): void => {
    const live: any[] = db.prepare(
      "SELECT * FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN ('RETIRED', 'MISSING')",
    ).all(equipmentId);
    const keepIds = new Set(units.map((u) => u.id).filter((id): id is string => Boolean(id)));

    for (const u of units) {
      if (!u.id) continue;
      const existing: any = db.prepare(
        'SELECT id FROM equipment_assets WHERE id = ? AND equipment_id = ?',
      ).get(u.id, equipmentId);
      if (!existing) throw new Error('Unit not found on this equipment.');
      db.prepare(`
        UPDATE equipment_assets
           SET serial_number = ?, vendor_name = ?, delivered_date = ?, updated_at = datetime('now')
         WHERE id = ?
      `).run(u.serial_number || '', u.vendor_name || null, u.delivered_date || null, u.id);
      const updated: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(u.id);
      if (updated) void pushOperationalToCloud('equipment_assets', 'UPDATE', updated);
    }

    const newUnits = units.filter((u) => !u.id);
    if (newUnits.length > 0) {
      const template = live[0];
      const now = new Date().toISOString();
      const counts = nextUnitCounts(usedCountsForPrefix(prefix), newUnits.length);
      for (let i = 0; i < newUnits.length; i++) {
        const unit = newUnits[i]!;
        const newId = uuidv4();
        insertAsset({
          id: newId,
          equipmentId,
          unitCode: formatUnitCode(prefix, counts[i]!),
          serial_number: unit.serial_number || '',
          purchase_date: template?.purchase_date ?? null,
          delivered_date: unit.delivered_date || null,
          purchase_price: template?.purchase_price ?? 0,
          vendor_name: unit.vendor_name || null,
          warranty_expiry: template?.warranty_expiry ?? null,
          current_location: template?.current_location ?? 'Warehouse',
          now,
        });
        const created: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(newId);
        if (created) void pushOperationalToCloud('equipment_assets', 'INSERT', created);
      }
    }

    for (const unit of live) {
      if (keepIds.has(unit.id)) continue;
      if (unit.current_status !== 'AVAILABLE' || hasAssetReferences(unit.id)) {
        throw new Error('Cannot remove a unit that is on loan, in maintenance, or has history.');
      }
      db.prepare('DELETE FROM equipment_assets WHERE id = ?').run(unit.id);
      void pushOperationalToCloud('equipment_assets', 'DELETE', { id: unit.id });
    }
  };

  ipcMain.handle('db:equipment:update', (event: any, id: string, data: unknown) => {
    const user = requireInventoryAccess(event);
    assertEquipmentInDepartment(db, event, id);
    const input = EquipmentUpdateSchema.parse(data);

    const tx = db.transaction(() => {
      const existing: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
      if (!existing) throw new Error('Equipment not found');
      const departmentId = existing.department_id;
      const categoryId = existing.category_id;
      if (input.subcategory_id !== undefined) {
        input.subcategory_id = ensureSubcategoryId(categoryId, input.subcategory_id);
      }
      const allowedFields = ['name', 'subcategory_id', 'sub_subcategory',
        'item_type', 'brand', 'model', 'pricing_type', 'notes',
        ...(user.role === 'admin' ? ['base_price'] : [])];
      const updates: string[] = [];
      const values: any[] = [];

      for (const field of allowedFields) {
        if ((input as Record<string, any>)[field] !== undefined) { updates.push(`${field} = ?`); values.push((input as Record<string, any>)[field]); }
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`UPDATE equipment_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }

      const after: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
      const prefix = skuPrefixFor(departmentId, categoryId, after.brand, after.model);
      if (prefix !== after.equipment_code) {
        db.prepare('UPDATE equipment_items SET equipment_code = ?, updated_at = datetime(\'now\') WHERE id = ?').run(prefix, id);
        const assets: any[] = db.prepare('SELECT id, equipment_code FROM equipment_assets WHERE equipment_id = ?').all(id);
        for (const a of assets) {
          const n = trailingUnitCount(a.equipment_code);
          if (n == null) continue;
          db.prepare('UPDATE equipment_assets SET equipment_code = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(formatUnitCode(prefix, n), a.id);
          const updated: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(a.id);
          if (updated) void pushOperationalToCloud('equipment_assets', 'UPDATE', updated);
        }
      }

      if (input.units !== undefined) {
        applyUnitEdits(id, input.units, prefix);
      } else if (input.quantity !== undefined) {
        reconcileUnits(id, input.quantity, prefix);
      }
      recomputeAvailability(db, id);

      const row: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
      void pushCatalogToCloud('equipment_items', 'UPDATE', row);
      return row;
    });

    return tx();
  });

  ipcMain.handle('db:equipment:updateAsset', (event: any, data: unknown) => {
    requireInventoryAccess(event);
    const input = AssetUpdateSchema.parse(data);
    assertAssetInDepartment(event, input.asset_id);
    const asset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(input.asset_id);
    if (!asset) throw new Error('Asset not found');

    const fields: string[] = [];
    const vals: any[] = [];
    if (input.serial_number !== undefined) { fields.push('serial_number = ?'); vals.push(input.serial_number); }
    if (input.vendor_name !== undefined) { fields.push('vendor_name = ?'); vals.push(input.vendor_name || null); }
    if (input.delivered_date !== undefined) { fields.push('delivered_date = ?'); vals.push(input.delivered_date || null); }
    if (fields.length === 0) return asset;

    fields.push("updated_at = datetime('now')");
    vals.push(input.asset_id);
    db.prepare(`UPDATE equipment_assets SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    const updated: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(input.asset_id);
    if (updated) void pushOperationalToCloud('equipment_assets', 'UPDATE', updated);
    return updated;
  });

  ipcMain.handle('db:equipment:updateAssetStatus', (event: any, data: unknown) => {
    const user = requireInventoryAccess(event);
    const input = AssetStatusUpdateSchema.parse(data);
    assertAssetInDepartment(event, input.asset_id);
    const asset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(input.asset_id);
    if (!asset) throw new Error('Asset not found');
    const previousStatus = asset.current_status;

    const statusLogIds: string[] = [];
    const tx = db.transaction(() => {
      if (input.status === 'RETIRED') {
        db.prepare("UPDATE equipment_assets SET current_status = 'RETIRED', retirement_date = ?, retirement_reason = ?, updated_at = datetime('now') WHERE id = ?")
          .run(new Date().toISOString(), input.reason || 'Retired', input.asset_id);
      } else {
        db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.status, input.asset_id);
      }
      statusLogIds.push(insertAssetStatusLog(db, {
        assetId: input.asset_id,
        equipmentId: asset.equipment_id,
        previousStatus,
        newStatus: input.status,
        changedBy: user.full_name,
        reason: input.reason || '',
      }));
      recomputeAvailability(db, asset.equipment_id);
    });
    tx();

    const updatedAsset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(input.asset_id);
    if (updatedAsset) void pushOperationalToCloud('equipment_assets', 'UPDATE', updatedAsset);
    pushStatusLogsToCloud(db, statusLogIds);
    return { success: true };
  });

  ipcMain.handle('db:equipment:delete', (event: any, id: string) => {
    requireInventoryAccess(event);
    assertEquipmentInDepartment(db, event, id);
    db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    const row: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
    writeAuditLog(event, { action: 'equipment_deactivate', entityType: 'equipment', entityId: id, newValues: row });
    void pushCatalogToCloud('equipment_items', 'UPDATE', row);
    return { ok: true };
  });

  ipcMain.handle('db:equipment:search', (_e: any, query: string) => {
    const pattern = `%${query}%`;
    return db.prepare(`
      SELECT DISTINCT e.* FROM equipment_items e
      LEFT JOIN equipment_assets a ON a.equipment_id = e.id
      WHERE e.is_active = 1 AND (
        e.name LIKE ? OR e.equipment_code LIKE ? OR e.brand LIKE ? OR e.model LIKE ?
        OR a.equipment_code LIKE ? OR a.serial_number LIKE ?
      ) ORDER BY e.equipment_code LIMIT 50
    `).all(pattern, pattern, pattern, pattern, pattern, pattern);
  });

  // Apply a status to every live unit of an equipment (bulk). Per-unit changes use
  // db:equipment:updateAssetStatus instead. Availability is recomputed from the units.
  const setStatusForAllUnits = (equipmentId: string, newStatus: string, reason: string, changedBy: string): { assetIds: string[]; logIds: string[] } => {
    const assets: any[] = db.prepare(
      "SELECT * FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN ('RETIRED', 'MISSING')",
    ).all(equipmentId);
    const logIds: string[] = [];
    for (const asset of assets) {
      if (newStatus === 'RETIRED') {
        db.prepare("UPDATE equipment_assets SET current_status = 'RETIRED', retirement_date = ?, retirement_reason = ?, updated_at = datetime('now') WHERE id = ?")
          .run(new Date().toISOString(), reason || 'Retired', asset.id);
      } else {
        db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newStatus, asset.id);
      }
      logIds.push(insertAssetStatusLog(db, {
        assetId: asset.id,
        equipmentId,
        previousStatus: asset.current_status,
        newStatus,
        changedBy,
        reason: reason || '',
      }));
    }
    recomputeAvailability(db, equipmentId);
    return { assetIds: assets.map((a) => a.id), logIds };
  };

  ipcMain.handle('db:equipment:updateStatus', (event: any, equipmentId: string, newStatus: string, reason: string) => {
    const user = requireInventoryAccess(event);
    assertEquipmentInDepartment(db, event, equipmentId);
    let result = { assetIds: [] as string[], logIds: [] as string[] };
    const tx = db.transaction(() => {
      result = setStatusForAllUnits(equipmentId, newStatus, reason, user.full_name);
      if (newStatus === 'RETIRED') {
        db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(equipmentId);
      }
    });
    tx();

    for (const aid of result.assetIds) {
      const updatedAsset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(aid);
      if (updatedAsset) void pushOperationalToCloud('equipment_assets', 'UPDATE', updatedAsset);
    }
    pushStatusLogsToCloud(db, result.logIds);
    if (newStatus === 'RETIRED') {
      const row: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(equipmentId);
      if (row) void pushCatalogToCloud('equipment_items', 'UPDATE', row);
    }
    return { success: true };
  });

  ipcMain.handle('db:equipment:batchUpdateStatus', (event: any, ids: string[], newStatus: string, reason: string) => {
    const user = requireInventoryAccess(event);
    for (const equipmentId of ids) assertEquipmentInDepartment(db, event, equipmentId);
    const allAssetIds: string[] = [];
    const allLogIds: string[] = [];
    const tx = db.transaction(() => {
      for (const equipmentId of ids) {
        const result = setStatusForAllUnits(equipmentId, newStatus, reason, user.full_name);
        allAssetIds.push(...result.assetIds);
        allLogIds.push(...result.logIds);
        if (newStatus === 'RETIRED') {
          db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(equipmentId);
        }
      }
    });
    tx();
    for (const aid of allAssetIds) {
      const updatedAsset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(aid);
      if (updatedAsset) void pushOperationalToCloud('equipment_assets', 'UPDATE', updatedAsset);
    }
    pushStatusLogsToCloud(db, allLogIds);
    if (newStatus === 'RETIRED') {
      for (const equipmentId of ids) {
        const row: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(equipmentId);
        if (row) void pushCatalogToCloud('equipment_items', 'UPDATE', row);
      }
    }
    return { success: true, count: ids.length };
  });

  ipcMain.handle('db:equipment:getStatusLog', (_e: any, equipmentId: string) => {
    return db.prepare(`
      SELECT * FROM asset_status_log WHERE equipment_id = ? ORDER BY changed_at DESC LIMIT 100
    `).all(equipmentId);
  });

  ipcMain.handle('db:equipment:getDashboardStats', (_e: any, categoryNames?: string[]) => {
    const catFilter = categoryNames && categoryNames.length > 0;
    const catPlaceholders = catFilter ? categoryNames!.map(() => '?').join(', ') : '';
    const catJoin = catFilter ? 'JOIN departments d ON d.id = e.department_id' : '';
    const catWhere = catFilter ? `AND d.name IN (${catPlaceholders})` : '';
    const catParams = catFilter ? categoryNames! : [];

    const total: any = db.prepare(`SELECT COUNT(*) as count FROM equipment_items e ${catJoin} WHERE e.is_active = 1 ${catWhere}`).get(...catParams);
    const statusCounts: any[] = db.prepare(`
      SELECT ea.current_status as status, COUNT(*) as count
      FROM equipment_assets ea JOIN equipment_items e ON e.id = ea.equipment_id ${catJoin}
      WHERE e.is_active = 1 ${catWhere} GROUP BY ea.current_status
    `).all(...catParams);

    const ticketQuery = catFilter
      ? `SELECT COUNT(*) as count FROM maintenance_tickets mt JOIN equipment_items e ON e.id = mt.equipment_id JOIN departments d ON d.id = e.department_id WHERE mt.repair_status NOT IN ('COMPLETED', 'CANCELLED') AND d.name IN (${catPlaceholders})`
      : "SELECT COUNT(*) as count FROM maintenance_tickets WHERE repair_status NOT IN ('COMPLETED', 'CANCELLED')";
    const activeTickets: any = db.prepare(ticketQuery).get(...catParams);

    const lowStockQuery = catFilter
      ? `SELECT COUNT(*) as count FROM parts_inventory pi JOIN parts_catalog pc ON pc.id = pi.part_id WHERE pc.is_active = 1 AND pi.qty_on_hand <= pi.reorder_point AND (pc.department IS NULL OR pc.department IN (SELECT CASE WHEN d2.name = 'Camera' THEN 'camera' ELSE 'lights_grips' END FROM departments d2 WHERE d2.name IN (${catPlaceholders})))`
      : `SELECT COUNT(*) as count FROM parts_inventory pi JOIN parts_catalog pc ON pc.id = pi.part_id WHERE pc.is_active = 1 AND pi.qty_on_hand <= pi.reorder_point`;
    const lowStock: any = db.prepare(lowStockQuery).get(...catParams);

    const overdueSchedules: any = db.prepare(`
      SELECT COUNT(*) as count FROM preventive_schedules ps
      ${catFilter ? 'JOIN equipment_items e ON e.id = ps.equipment_id ' + catJoin : ''}
      WHERE ps.is_active = 1 AND ps.next_due_date IS NOT NULL AND ps.next_due_date < date('now')
      ${catFilter ? catWhere : ''}
    `).get(...catParams);

    const activityQuery = catFilter
      ? `SELECT asl.* FROM asset_status_log asl JOIN equipment_items e ON e.id = asl.equipment_id JOIN departments d ON d.id = e.department_id WHERE d.name IN (${catPlaceholders}) ORDER BY asl.changed_at DESC LIMIT 10`
      : 'SELECT * FROM asset_status_log ORDER BY changed_at DESC LIMIT 10';
    const recentActivity: any[] = db.prepare(activityQuery).all(...catParams);

    const dist: Record<string, number> = {};
    for (const sc of statusCounts) dist[sc.status] = sc.count;

    return {
      totalEquipment: total.count,
      availableCount: dist['AVAILABLE'] || 0,
      deployedCount: dist['DEPLOYED'] || 0,
      inRepairCount: dist['IN_REPAIR'] || 0,
      onHoldCount: dist['ON_HOLD'] || 0,
      missingCount: dist['MISSING'] || 0,
      forInspectionCount: dist['FOR_INSPECTION'] || 0,
      activeTickets: activeTickets.count,
      lowStockParts: lowStock.count,
      overdueSchedules: overdueSchedules.count,
      recentActivity,
      statusDistribution: dist,
    };
  });

  /**
   * Normalize a parsed CSV row's taxonomy fields, applying legacy Camera remaps.
   * Returns null (with error pushed) if required fields are missing.
   */
  const normalizeCsvTaxonomy = (row: Record<string, string>): {
    name: string; departmentName: string; categoryName: string; subName: string; subSub: string;
  } | null => {
    const pick = (...keys: string[]): string => {
      for (const k of keys) { const v = row[k]; if (v) return v; }
      return '';
    };
    const name = pick('name', 'equipment_name', 'item_name', 'equipment');
    const departmentName = pick('department', 'department_name', 'dept');
    let categoryName = pick('category', 'category_name', 'cat');
    let subName = pick('sub_category', 'subcategory', 'sub_category_name');
    let subSub = pick('sub_sub_category', 'sub_subcategory', 'sub_sub');
    if (!name || !departmentName || !categoryName) return null;

    if (departmentName === 'Camera') {
      if (categoryName === 'Camera Body') {
        subSub = subSub || (subName === 'High Speed Camera' ? 'High Speed Camera' : subName);
        subName = subName === 'High Speed Camera' ? 'High Speed Camera' : 'Camera Body';
        categoryName = 'Camera';
      } else if (categoryName === 'Camera Peripherals' && subName === 'Power') {
        categoryName = 'Power';
        if (subSub === 'AC Power Supply') { subName = 'AC Power Supply'; subSub = ''; }
        else { subName = 'Battery and Charger'; }
      } else if (categoryName === 'Lens' && subName === 'Special Lens' && subSub === 'Lens Support') {
        subName = 'Lens Support';
        subSub = '';
      }
      if (subSub === 'Telephoto Prime') subSub = 'Telephoto';
    }
    return { name, departmentName, categoryName, subName, subSub };
  };

  /** Threshold: a new category/subcategory must appear in at least this many rows. */
  const NEW_CATEGORY_MIN_COUNT = 10;

  ipcMain.handle('db:equipment:previewCsvCategories', (event: any, csvContent: string) => {
    requireInventoryAccess(event);
    const dept = sessionDepartment(event);
    const lines = csvContent.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
    const headers = parseCsvRow(lines[0]!).map((h) => h.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/\s+/g, '_'));

    const findDept = db.prepare('SELECT id, name FROM departments WHERE name = ? AND is_active = 1');
    const findCat = db.prepare('SELECT id FROM categories WHERE name = ? AND department_id = ? AND is_active = 1');
    const findSub = db.prepare('SELECT id FROM subcategories WHERE name = ? AND category_id = ? AND is_active = 1');

    const unknownCats = new Map<string, { department: string; category: string; count: number }>();
    const unknownSubs = new Map<string, { department: string; category: string; subcategory: string; count: number }>();
    const unknownSubSubs = new Map<string, { department: string; category: string; subcategory: string; subSubcategory: string; count: number }>();

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvRow(lines[i]!);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });

      const tax = normalizeCsvTaxonomy(row);
      if (!tax) continue;

      const deptRow: any = findDept.get(tax.departmentName);
      if (!deptRow) continue;
      if (dept && opsDepartmentOf(deptRow.name, null) !== dept) continue;

      const cat: any = findCat.get(tax.categoryName, deptRow.id);
      if (!cat) {
        const key = `${tax.departmentName}::${tax.categoryName}`;
        const existing = unknownCats.get(key);
        if (existing) existing.count++;
        else unknownCats.set(key, { department: tax.departmentName, category: tax.categoryName, count: 1 });
        continue;
      }

      if (tax.subName) {
        const sub: any = findSub.get(tax.subName, cat.id);
        if (!sub) {
          const key = `${tax.departmentName}::${tax.categoryName}::${tax.subName}`;
          const existing = unknownSubs.get(key);
          if (existing) existing.count++;
          else unknownSubs.set(key, { department: tax.departmentName, category: tax.categoryName, subcategory: tax.subName, count: 1 });
          continue;
        }
      }
    }

    const newCategories = [...unknownCats.values()].filter((c) => c.count >= NEW_CATEGORY_MIN_COUNT);
    const newSubcategories = [...unknownSubs.values()].filter((s) => s.count >= NEW_CATEGORY_MIN_COUNT);

    return {
      newCategories,
      newSubcategories,
      totalRows: lines.length - 1,
    };
  });

  ipcMain.handle('db:equipment:importCsv', (event: any, csvContent: string, autoCreateCategories?: boolean) => {
    const user = requireInventoryAccess(event);
    const canPrice = user.role === 'admin';
    const sessionDept = sessionDepartment(event);
    let csvText = csvContent.replace(/^\uFEFF/, '').trim();
    // Auto-detect tab-separated files and convert to comma-delimited
    const probe = csvText.split(/\r?\n/)[0] || '';
    if (probe.includes('\t') && !probe.includes(',')) {
      csvText = csvText.replace(/\t/g, ',');
    }
    // Auto-detect semicolon-separated files
    if (!probe.includes(',') && probe.includes(';')) {
      csvText = csvText.replace(/;/g, ',');
    }
    let lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

    // Detect and skip a title/filename row: if line 1 has only 1 column but
    // line 2 has multiple columns (or looks like a header row with known names),
    // treat line 2 as the real header row.
    const KNOWN_HEADERS = new Set(['name', 'department', 'category', 'brand', 'model', 'item_type', 'qty_available', 'base_price', 'notes', 'equipment_name', 'dept', 'sub_category', 'subcategory', 'pricing_type']);
    const firstRowCols = parseCsvRow(lines[0]!);
    const secondRowCols = parseCsvRow(lines[1]!);
    const secondRowNorm = secondRowCols.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const secondRowLooksLikeHeaders = secondRowNorm.filter((h) => KNOWN_HEADERS.has(h)).length >= 2;

    if (firstRowCols.length <= 1 && secondRowCols.length > 1 && lines.length >= 3) {
      console.log(`[importCsv] Skipping title row "${lines[0]}" — line 2 has ${secondRowCols.length} columns`);
      lines = lines.slice(1);
    } else if (firstRowCols.length <= 1 && secondRowLooksLikeHeaders && lines.length >= 3) {
      console.log(`[importCsv] Skipping title row "${lines[0]}" — line 2 looks like headers: [${secondRowNorm.join(', ')}]`);
      lines = lines.slice(1);
    }

    const rawHeaders = parseCsvRow(lines[0]!).map((h) => h.trim().replace(/^\uFEFF/, ''));
    // Normalize: lowercase, collapse whitespace/special chars to underscores, strip edges
    const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));

    // Validate that required columns exist in the headers
    const hasName = headers.some((h) => ['name', 'equipment_name', 'item_name', 'equipment'].includes(h));
    const hasDept = headers.some((h) => ['department', 'department_name', 'dept'].includes(h));
    const hasCat = headers.some((h) => ['category', 'category_name', 'cat'].includes(h));
    if (!hasName || !hasDept || !hasCat) {
      const missing: string[] = [];
      if (!hasName) missing.push('name');
      if (!hasDept) missing.push('department');
      if (!hasCat) missing.push('category');
      throw new Error(
        `CSV is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        `Found columns: [${rawHeaders.join(', ')}]. ` +
        `Use the Template button to download a CSV with the correct format.`,
      );
    }

    console.log(`[importCsv] ${lines.length - 1} data rows, headers: [${headers.join(', ')}] raw: [${rawHeaders.join(', ')}]`);
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let created = 0;
    let updated = 0;
    const now = new Date().toISOString();
    const createdAssetIds: string[] = [];
    const touchedItemIds = new Set<string>();

    const findDept = db.prepare('SELECT id, name FROM departments WHERE name = ? AND is_active = 1');
    const findCat = db.prepare('SELECT id FROM categories WHERE name = ? AND department_id = ? AND is_active = 1');
    const findSub = db.prepare('SELECT id FROM subcategories WHERE name = ? AND category_id = ? AND is_active = 1');

    // Also look for soft-deleted (is_active = 0) SKUs so we can reactivate them
    // instead of hitting a UNIQUE constraint failure on equipment_code.
    const findInactiveSku = (departmentId: string, categoryId: string, brand: string, model: string): any => {
      return db.prepare(`
        SELECT * FROM equipment_items
        WHERE is_active = 0 AND department_id = ? AND category_id = ?
          AND LOWER(TRIM(COALESCE(brand, ''))) = LOWER(TRIM(?))
          AND LOWER(TRIM(COALESCE(model, ''))) = LOWER(TRIM(?))
        LIMIT 1
      `).get(departmentId, categoryId, brand || '', model || '');
    };

    const tx = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = parseCsvRow(lines[i]!);
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });

          const tax = normalizeCsvTaxonomy(row);
          if (!tax) {
            const missing: string[] = [];
            if (!row.name && !row.equipment_name && !row.item_name && !row.equipment) missing.push('name');
            if (!row.department && !row.department_name && !row.dept) missing.push('department');
            if (!row.category && !row.category_name && !row.cat) missing.push('category');
            const vals = headers.map((h) => `${h}="${row[h] || ''}"`).join(', ');
            errors.push({ row: i + 1, message: `Missing required fields: ${missing.join(', ')}. Row values: ${vals}` });
            continue;
          }
          const { name, departmentName, categoryName, subName, subSub } = tax;

          const deptRow: any = findDept.get(departmentName);
          if (!deptRow) {
            errors.push({ row: i + 1, message: `Unknown department "${departmentName}"` });
            continue;
          }
          if (sessionDept && opsDepartmentOf(deptRow.name, null) !== sessionDept) {
            errors.push({ row: i + 1, message: `Department "${departmentName}" is outside your scope` });
            continue;
          }

          let cat: any = findCat.get(categoryName, deptRow.id);
          if (!cat && autoCreateCategories) {
            const catId = uuidv4();
            db.prepare(
              'INSERT INTO categories (id, department_id, name, display_order, is_active) VALUES (?, ?, ?, 0, 1)',
            ).run(catId, deptRow.id, categoryName);
            cat = { id: catId };
          }
          if (!cat) {
            errors.push({ row: i + 1, message: `Unknown category "${categoryName}" in ${departmentName}` });
            continue;
          }

          let subId: string | null = null;
          if (subName) {
            let subcat: any = findSub.get(subName, cat.id);
            if (!subcat && autoCreateCategories) {
              const newSubId = uuidv4();
              db.prepare(
                'INSERT INTO subcategories (id, category_id, name, display_order, is_active) VALUES (?, ?, ?, 0, 1)',
              ).run(newSubId, cat.id, subName);
              subcat = { id: newSubId };
            }
            if (!subcat) {
              errors.push({ row: i + 1, message: `Unknown sub category "${subName}"` });
              continue;
            }
            subId = subcat.id;
          }

          const itemType = row.item_type || 'standalone';
          if (!['standalone', 'package_main', 'package_component', 'add_on'].includes(itemType)) {
            errors.push({ row: i + 1, message: `Invalid item_type "${itemType}"` });
            continue;
          }
          let pricingType = row.pricing_type || (itemType === 'package_main' ? 'package_rate' : 'per_day');
          if (itemType === 'package_main') pricingType = 'package_rate';
          if (!['per_day', 'per_project', 'package_rate'].includes(pricingType)) {
            errors.push({ row: i + 1, message: `Invalid pricing_type "${pricingType}"` });
            continue;
          }

          const skuPrefix = skuPrefixFor(deptRow.id, cat.id, row.brand || '', row.model || '');
          let existing = findSku(deptRow.id, cat.id, row.brand || '', row.model || '');
          // Reactivate a previously soft-deleted SKU so we don't collide with
          // the UNIQUE constraint on equipment_code.
          if (!existing) {
            const inactive = findInactiveSku(deptRow.id, cat.id, row.brand || '', row.model || '');
            if (inactive) {
              db.prepare(`
                UPDATE equipment_items SET is_active = 1, updated_at = ? WHERE id = ?
              `).run(now, inactive.id);
              existing = inactive;
            }
          }
          const price = canPrice ? (parseFloat(row.base_price || '0') || 0) : 0;
          const unitQty = unitQtyFromCsvRow(row);

          let eqId = existing?.id as string | undefined;
          if (existing) {
            db.prepare(`
              UPDATE equipment_items SET
                equipment_code = ?, quantity = quantity + ?,
                notes = COALESCE(?, notes),
                base_price = CASE WHEN ? = 1 THEN ? ELSE base_price END,
                is_active = 1, updated_at = ?, version = version + 1
              WHERE id = ?
            `).run(skuPrefix, unitQty, row.notes || null, canPrice ? 1 : 0, price, now, existing.id);
            eqId = existing.id;
            updated++;
          } else {
            eqId = uuidv4();
            db.prepare(`
              INSERT INTO equipment_items (id, equipment_code, name, department_id, category_id, subcategory_id, sub_subcategory, item_type, brand, model, pricing_type, base_price, notes, quantity, available_qty, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).run(eqId, skuPrefix, name, deptRow.id, cat.id, subId, subSub || null, itemType, row.brand || '', row.model || '',
              pricingType, price, row.notes || null, unitQty, unitQty, now, now);
            created++;
          }

          // N blank units with numbered codes (…-001, …-002). Serial, supplier, and
          // delivered date stay empty so they can be filled later from Edit Details.
          const counts = nextUnitCounts(usedCountsForPrefix(skuPrefix), unitQty);
          for (let u = 0; u < unitQty; u++) {
            const assetId = uuidv4();
            createdAssetIds.push(assetId);
            insertAsset({
              id: assetId,
              equipmentId: eqId!,
              unitCode: formatUnitCode(skuPrefix, counts[u]!),
              serial_number: '',
              now,
            });
          }
          if (eqId) {
            recomputeAvailability(db, eqId);
            touchedItemIds.add(eqId);
          }
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || 'Unknown error' });
        }
      }
    });
    tx();
    // SKUs must land before units (cloud FK). Create() already does this; import
    // used to push only assets, so a populated cloud never saw the new items.
    for (const itemId of touchedItemIds) {
      const equipmentRow: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(itemId);
      if (equipmentRow) void pushCatalogToCloud('equipment_items', 'UPDATE', equipmentRow);
    }
    for (const aid of createdAssetIds) {
      const assetRow: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(aid);
      if (assetRow) void pushOperationalToCloud('equipment_assets', 'INSERT', assetRow);
    }

    // Post-import verification: confirm the items actually exist and are active
    const verifyCount: any = db.prepare('SELECT COUNT(*) as c FROM equipment_items WHERE is_active = 1').get();
    const touchedActive = [...touchedItemIds].filter((id) => {
      const row: any = db.prepare('SELECT is_active FROM equipment_items WHERE id = ?').get(id);
      return row && row.is_active === 1;
    }).length;
    console.log(`[importCsv] imported=${imported} created=${created} updated=${updated} errors=${errors.length} touchedItems=${touchedItemIds.size} touchedStillActive=${touchedActive} totalActive=${verifyCount.c}`);

    return { imported, created, updated, errors };
  });

  ipcMain.handle('db:equipment:getUseCounts', () => {
    return db.prepare(`
      SELECT
        e.id as equipment_id,
        e.equipment_code,
        e.name,
        e.brand,
        e.model,
        c.name as category_name,
        s.name as subcategory_name,
        d.name as department_name,
        COUNT(asl.id) as use_count
      FROM equipment_items e
      JOIN departments d ON d.id = e.department_id
      JOIN categories c ON c.id = e.category_id
      LEFT JOIN subcategories s ON s.id = e.subcategory_id
      LEFT JOIN asset_status_log asl
        ON asl.equipment_id = e.id AND asl.new_status = 'DEPLOYED'
      WHERE e.is_active = 1
        -- Exclude zero-priced package components (billed only as part of a package).
        AND NOT (e.item_type = 'package_component' AND e.base_price = 0)
      GROUP BY e.id
      ORDER BY use_count DESC, e.name ASC
    `).all();
  });

  // ── Purge equipment list and packages only (local + cloud) ──
  ipcMain.handle('db:equipment:purgeAllInventory', async (event: any) => {
    const user = requireInventoryAccess(event);
    if (user.role !== 'admin') throw new Error('Only admins can purge inventory.');

    const { cloudService: cs } = await import('../sync/cloud-service');
    const { recordLocalTombstone } = await import('../sync/operational-sync');

    const results = {
      packageItems: 0, packageDefinitions: 0, assetStatusLogs: 0,
      equipmentAssets: 0, equipmentItems: 0,
      cloudErrors: [] as string[],
    };

    const tryCloudRemove = async (table: string, id: string) => {
      try { await cs.remove(table as any, id); } catch (err: any) {
        results.cloudErrors.push(`${table}/${id}: ${err.message}`);
      }
    };

    // 1. Package items → package definitions (catalog tables, no tombstones)
    const pkgItems: any[] = db.prepare('SELECT id FROM package_items').all();
    results.packageItems = pkgItems.length;
    for (const r of pkgItems) await tryCloudRemove('package_items', r.id);
    db.exec('DELETE FROM package_items');

    const pkgDefs: any[] = db.prepare('SELECT id FROM package_definitions').all();
    results.packageDefinitions = pkgDefs.length;
    for (const r of pkgDefs) await tryCloudRemove('package_definitions', r.id);
    db.exec('DELETE FROM package_definitions');

    // 2. Asset status logs → equipment assets (operational tables, use tombstones)
    const statusLogs: any[] = db.prepare('SELECT id FROM asset_status_log').all();
    results.assetStatusLogs = statusLogs.length;
    for (const r of statusLogs) { await tryCloudRemove('asset_status_log', r.id); recordLocalTombstone('asset_status_log', r.id); }
    db.exec('DELETE FROM asset_status_log');

    const assets: any[] = db.prepare('SELECT id FROM equipment_assets').all();
    results.equipmentAssets = assets.length;
    for (const r of assets) { await tryCloudRemove('equipment_assets', r.id); recordLocalTombstone('equipment_assets', r.id); }
    db.exec('DELETE FROM equipment_assets');

    // 3. Equipment items (catalog table, no tombstones)
    const items: any[] = db.prepare('SELECT id FROM equipment_items').all();
    results.equipmentItems = items.length;
    for (const r of items) await tryCloudRemove('equipment_items', r.id);
    db.exec('DELETE FROM equipment_items');

    // 4. Clear queued sync entries for purged tables
    db.exec('DELETE FROM offline_queue');

    console.log('[purgeAllInventory] Done:', JSON.stringify(results));
    return results;
  });
}
