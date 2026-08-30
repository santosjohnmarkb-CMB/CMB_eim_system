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
  const loadAssetsByEquipment = (equipmentIds: string[]): Map<string, any[]> => {
    const grouped = new Map<string, any[]>();
    if (equipmentIds.length === 0) return grouped;
    const placeholders = equipmentIds.map(() => '?').join(', ');
    const rows: any[] = db.prepare(
      `SELECT * FROM equipment_assets WHERE equipment_id IN (${placeholders})`,
    ).all(...equipmentIds);
    rows.sort((a, b) => (trailingUnitCount(a.equipment_code) ?? 0) - (trailingUnitCount(b.equipment_code) ?? 0)
      || String(a.created_at).localeCompare(String(b.created_at))
      || String(a.id).localeCompare(String(b.id)));
    attachUnitActions(rows);
    for (const a of rows) {
      const list = grouped.get(a.equipment_id) || [];
      list.push(a);
      grouped.set(a.equipment_id, list);
    }
    return grouped;
  };

  ipcMain.handle('db:equipment:getAll', (event: any) => {
    const cats = categoriesForDepartment(sessionDepartment(event));
    const catWhere = cats ? `AND d.name IN (${cats.map(() => '?').join(', ')})` : '';
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
    const grouped = loadAssetsByEquipment(items.map((i) => i.id));
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
    const categoryId = ensureCategoryId(departmentId, input.category_id);
    const subcategoryId = ensureSubcategoryId(categoryId, input.subcategory_id);
    assertCategoryInDepartment(event, categoryId);
    const basePrice = user.role === 'admin' ? input.base_price : 0;
    const now = new Date().toISOString();
    if (!departmentId) throw new Error('Department is required');
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

  ipcMain.handle('db:equipment:importCsv', (event: any, csvContent: string) => {
    const user = requireInventoryAccess(event);
    const canPrice = user.role === 'admin';
    const sessionDept = sessionDepartment(event);
    const lines = csvContent.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
    const headers = parseCsvRow(lines[0]!).map((h) => h.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/\s+/g, '_'));
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    const now = new Date().toISOString();
    const createdAssetIds: string[] = [];
    const touchedItemIds = new Set<string>();

    const findDept = db.prepare('SELECT id, name FROM departments WHERE name = ? AND is_active = 1');
    const findCat = db.prepare('SELECT id FROM categories WHERE name = ? AND department_id = ? AND is_active = 1');
    const findSub = db.prepare('SELECT id FROM subcategories WHERE name = ? AND category_id = ? AND is_active = 1');

    const tx = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = parseCsvRow(lines[i]!);
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });

          const name = row.name;
          const departmentName = row.department || row.department_name;
          let categoryName = row.category;
          let subName = row.sub_category || row.subcategory || '';
          let subSub = row.sub_sub_category || row.sub_subcategory || '';
          if (!name || !departmentName || !categoryName) {
            errors.push({ row: i + 1, message: 'Missing required fields: name, department, category' });
            continue;
          }

          // Accept the previous Camera taxonomy in CSVs (Camera Body as a category,
          // Power as a Peripherals subcategory, 3K–12K as subcategories).
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

          const deptRow: any = findDept.get(departmentName);
          if (!deptRow) {
            errors.push({ row: i + 1, message: `Unknown department "${departmentName}"` });
            continue;
          }
          if (sessionDept && opsDepartmentOf(deptRow.name, null) !== sessionDept) {
            errors.push({ row: i + 1, message: `Department "${departmentName}" is outside your scope` });
            continue;
          }

          const cat: any = findCat.get(categoryName, deptRow.id);
          if (!cat) {
            errors.push({ row: i + 1, message: `Unknown category "${categoryName}" in ${departmentName}` });
            continue;
          }

          let subId: string | null = null;
          if (subName) {
            const subcat: any = findSub.get(subName, cat.id);
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
          const existing = findSku(deptRow.id, cat.id, row.brand || '', row.model || '');
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
          } else {
            eqId = uuidv4();
            db.prepare(`
              INSERT INTO equipment_items (id, equipment_code, name, department_id, category_id, subcategory_id, sub_subcategory, item_type, brand, model, pricing_type, base_price, notes, quantity, available_qty, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).run(eqId, skuPrefix, name, deptRow.id, cat.id, subId, subSub || null, itemType, row.brand || '', row.model || '',
              pricingType, price, row.notes || null, unitQty, unitQty, now, now);
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
    return { imported, errors };
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
}
