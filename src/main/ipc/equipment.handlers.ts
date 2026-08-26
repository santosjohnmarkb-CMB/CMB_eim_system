import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireInventoryAccess } from './session';
import { writeAuditLog } from './audit';
import { EquipmentCreateSchema, EquipmentUpdateSchema, AssetUpdateSchema, AssetStatusUpdateSchema } from '../../shared/schemas';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { CATEGORY_PREFIXES, opsDepartmentOf } from '../../shared/constants';
import { sessionDepartment, categoriesForDepartment, assertEquipmentInDepartment } from './department';
import { recomputeAvailability } from './availability';
import { parseCsvRow } from './utils/csv';

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

  // Generate the next unused equipment code for a category prefix. Orders by the
  // numeric suffix (not lexicographically, so CAM-1000 beats CAM-999) and skips any
  // code that already exists to avoid UNIQUE constraint failures on equipment_code.
  const nextEquipmentCode = (prefix: string): string => {
    const last: any = db.prepare(
      `SELECT equipment_code FROM equipment_items WHERE equipment_code LIKE ?
       ORDER BY CAST(substr(equipment_code, instr(equipment_code, '-') + 1) AS INTEGER) DESC LIMIT 1`,
    ).get(`${prefix}-%`);
    let seq = 1;
    if (last) {
      const num = parseInt(last.equipment_code.split('-')[1] || '0', 10);
      seq = (Number.isFinite(num) ? num : 0) + 1;
    }
    const exists = db.prepare('SELECT 1 FROM equipment_items WHERE equipment_code = ?');
    let code = `${prefix}-${String(seq).padStart(3, '0')}`;
    while (exists.get(code)) {
      seq += 1;
      code = `${prefix}-${String(seq).padStart(3, '0')}`;
    }
    return code;
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

  // Load every unit (asset) for the given equipment ids, grouped by equipment_id.
  // Each unit of quantity has its own equipment_assets row, so an item can have many.
  const loadAssetsByEquipment = (equipmentIds: string[]): Map<string, any[]> => {
    const grouped = new Map<string, any[]>();
    if (equipmentIds.length === 0) return grouped;
    const placeholders = equipmentIds.map(() => '?').join(', ');
    const rows: any[] = db.prepare(
      `SELECT * FROM equipment_assets WHERE equipment_id IN (${placeholders}) ORDER BY created_at, id`,
    ).all(...equipmentIds);
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

  ipcMain.handle('db:equipment:generateCode', (_e: any, categoryId: string) => {
    const cat: any = db.prepare(`
      SELECT d.name as department_name FROM categories c
      JOIN departments d ON d.id = c.department_id WHERE c.id = ?
    `).get(categoryId);
    if (!cat) throw new Error('Category not found');
    const prefix = CATEGORY_PREFIXES[cat.department_name] || 'EQP';
    return nextEquipmentCode(prefix);
  });

  ipcMain.handle('db:equipment:create', (event: any, data: unknown) => {
    const user = requireInventoryAccess(event);
    const input = EquipmentCreateSchema.parse(data);
    assertCategoryInDepartment(event, input.category_id);
    // Admin-only pricing: managers create equipment at 0 price; only admins set a price.
    const basePrice = user.role === 'admin' ? input.base_price : 0;
    const equipmentId = uuidv4();
    const assetId = uuidv4();
    const now = new Date().toISOString();

    const cat: any = db.prepare(`
      SELECT c.department_id, d.name as department_name
      FROM categories c JOIN departments d ON d.id = c.department_id WHERE c.id = ?
    `).get(input.category_id);
    const departmentId = input.department_id || cat?.department_id;
    if (!departmentId) throw new Error('Department is required');
    const prefix = cat ? (CATEGORY_PREFIXES[cat.department_name] || 'EQP') : 'EQP';
    const equipmentCode = nextEquipmentCode(prefix);
    const pricingType = input.item_type === 'package_main' ? 'package_rate' : input.pricing_type;

    // Build the per-unit list. When explicit `units` are provided, one asset row is
    // created per entry; otherwise `quantity` units are created with the first unit
    // carrying the form's serial/asset tag and the rest sharing supplier/dates.
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

    const assetIds: string[] = [];
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO equipment_items (id, equipment_code, name, department_id, category_id, subcategory_id, sub_subcategory, item_type, brand, model, pricing_type, base_price, notes, quantity, available_qty, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(equipmentId, equipmentCode, input.name, departmentId, input.category_id, input.subcategory_id || null,
        input.sub_subcategory || null, input.item_type, input.brand, input.model,
        pricingType, basePrice, input.notes || null, qty, qty, now, now);

      for (let i = 0; i < units.length; i++) {
        const unit = units[i]!;
        const unitId = i === 0 ? assetId : uuidv4();
        assetIds.push(unitId);
        db.prepare(`
          INSERT INTO equipment_assets (id, equipment_id, serial_number, asset_tag, purchase_date, delivered_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Warehouse', 'AVAILABLE', ?, ?)
        `).run(unitId, equipmentId, unit.serial_number, unit.asset_tag,
          input.purchase_date || null, unit.delivered_date, input.purchase_price || 0, unit.vendor_name,
          input.warranty_expiry || null, now, now);
      }
    });
    tx();

    const equipmentRow: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(equipmentId);
    void pushCatalogToCloud('equipment_items', 'INSERT', equipmentRow);

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
  const reconcileUnits = (equipmentId: string, desiredQty: number): void => {
    const desired = Math.max(0, Math.floor(desiredQty));
    const liveUnits: any[] = db.prepare(
      "SELECT * FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN ('RETIRED', 'MISSING') ORDER BY created_at, id",
    ).all(equipmentId);

    if (desired > liveUnits.length) {
      const template = liveUnits[0];
      const now = new Date().toISOString();
      for (let i = 0; i < desired - liveUnits.length; i++) {
        const newId = uuidv4();
        db.prepare(`
          INSERT INTO equipment_assets (id, equipment_id, serial_number, asset_tag, purchase_date, delivered_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
          VALUES (?, ?, '', NULL, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
        `).run(newId, equipmentId,
          template?.purchase_date ?? null, template?.delivered_date ?? null, template?.purchase_price ?? 0,
          template?.vendor_name ?? null, template?.warranty_expiry ?? null, template?.current_location ?? 'Warehouse', now, now);
        const created: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(newId);
        if (created) void pushOperationalToCloud('equipment_assets', 'INSERT', created);
      }
    } else if (desired < liveUnits.length) {
      // Only remove spare AVAILABLE units with no references, to preserve history/availability.
      const removable = liveUnits.filter((u) => u.current_status === 'AVAILABLE' && !hasAssetReferences(u.id));
      const toRemove = Math.min(liveUnits.length - desired, removable.length);
      for (let i = 0; i < toRemove; i++) {
        const unit = removable[i]!;
        db.prepare('DELETE FROM equipment_assets WHERE id = ?').run(unit.id);
        void pushOperationalToCloud('equipment_assets', 'DELETE', { id: unit.id });
      }
    }
  };

  ipcMain.handle('db:equipment:update', (event: any, id: string, data: unknown) => {
    const user = requireInventoryAccess(event);
    assertEquipmentInDepartment(db, event, id);
    const input = EquipmentUpdateSchema.parse(data);
    // If the item is being moved to a different category, that target must also
    // belong to the session's department.
    if (input.category_id !== undefined) assertCategoryInDepartment(event, input.category_id);
    // Admin-only pricing: managers may edit every field except base_price, which is
    // dropped from the allow-list so their submission can't change the stored price.
    const allowedFields = ['name', 'department_id', 'category_id', 'subcategory_id', 'sub_subcategory',
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

    // Quantity changes add/remove unit rows; availability is then derived from units.
    if (input.quantity !== undefined) {
      reconcileUnits(id, input.quantity);
    }
    recomputeAvailability(db, id);

    return db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
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

    const tx = db.transaction(() => {
      if (input.status === 'RETIRED') {
        db.prepare("UPDATE equipment_assets SET current_status = 'RETIRED', retirement_date = ?, retirement_reason = ?, updated_at = datetime('now') WHERE id = ?")
          .run(new Date().toISOString(), input.reason || 'Retired', input.asset_id);
      } else {
        db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.status, input.asset_id);
      }
      db.prepare(`
        INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), input.asset_id, asset.equipment_id, previousStatus, input.status, user.full_name, input.reason || '');
      recomputeAvailability(db, asset.equipment_id);
    });
    tx();

    const updatedAsset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(input.asset_id);
    if (updatedAsset) void pushOperationalToCloud('equipment_assets', 'UPDATE', updatedAsset);
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
      SELECT * FROM equipment_items WHERE is_active = 1 AND (
        name LIKE ? OR equipment_code LIKE ? OR brand LIKE ? OR model LIKE ?
      ) ORDER BY equipment_code LIMIT 50
    `).all(pattern, pattern, pattern, pattern);
  });

  // Apply a status to every live unit of an equipment (bulk). Per-unit changes use
  // db:equipment:updateAssetStatus instead. Availability is recomputed from the units.
  const setStatusForAllUnits = (equipmentId: string, newStatus: string, reason: string, changedBy: string): string[] => {
    const assets: any[] = db.prepare(
      "SELECT * FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN ('RETIRED', 'MISSING')",
    ).all(equipmentId);
    for (const asset of assets) {
      if (newStatus === 'RETIRED') {
        db.prepare("UPDATE equipment_assets SET current_status = 'RETIRED', retirement_date = ?, retirement_reason = ?, updated_at = datetime('now') WHERE id = ?")
          .run(new Date().toISOString(), reason || 'Retired', asset.id);
      } else {
        db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newStatus, asset.id);
      }
      db.prepare(`
        INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), asset.id, equipmentId, asset.current_status, newStatus, changedBy, reason || '');
    }
    recomputeAvailability(db, equipmentId);
    return assets.map((a) => a.id);
  };

  ipcMain.handle('db:equipment:updateStatus', (event: any, equipmentId: string, newStatus: string, reason: string) => {
    const user = requireInventoryAccess(event);
    assertEquipmentInDepartment(db, event, equipmentId);
    let assetIds: string[] = [];
    const tx = db.transaction(() => {
      assetIds = setStatusForAllUnits(equipmentId, newStatus, reason, user.full_name);
      if (newStatus === 'RETIRED') {
        db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(equipmentId);
      }
    });
    tx();

    for (const aid of assetIds) {
      const updatedAsset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(aid);
      if (updatedAsset) void pushOperationalToCloud('equipment_assets', 'UPDATE', updatedAsset);
    }
    return { success: true };
  });

  ipcMain.handle('db:equipment:batchUpdateStatus', (event: any, ids: string[], newStatus: string, reason: string) => {
    const user = requireInventoryAccess(event);
    for (const equipmentId of ids) assertEquipmentInDepartment(db, event, equipmentId);
    const tx = db.transaction(() => {
      for (const equipmentId of ids) {
        setStatusForAllUnits(equipmentId, newStatus, reason, user.full_name);
        if (newStatus === 'RETIRED') {
          db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(equipmentId);
        }
      }
    });
    tx();
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
      ? `SELECT COUNT(*) as count FROM parts_inventory pi JOIN parts_catalog pc ON pc.id = pi.part_id WHERE pc.is_active = 1 AND pi.qty_on_hand <= pi.reorder_point AND (pc.department IS NULL OR pc.department IN (SELECT CASE WHEN c2.name = 'Camera' THEN 'camera' ELSE 'lights_grips' END FROM categories c2 WHERE c2.name IN (${catPlaceholders})))`
      : `SELECT COUNT(*) as count FROM parts_inventory pi JOIN parts_catalog pc ON pc.id = pi.part_id WHERE pc.is_active = 1 AND pi.qty_on_hand <= pi.reorder_point`;
    const lowStock: any = db.prepare(lowStockQuery).get(...catParams);

    const overdueSchedules: any = db.prepare(`
      SELECT COUNT(*) as count FROM preventive_schedules ps
      ${catFilter ? 'JOIN equipment_items e ON e.id = ps.equipment_id ' + catJoin : ''}
      WHERE ps.is_active = 1 AND ps.next_due_date IS NOT NULL AND ps.next_due_date < date('now')
      ${catFilter ? catWhere : ''}
    `).get(...catParams);

    const activityQuery = catFilter
      ? `SELECT asl.* FROM asset_status_log asl JOIN equipment_items e ON e.id = asl.equipment_id JOIN categories c ON c.id = e.category_id WHERE c.name IN (${catPlaceholders}) ORDER BY asl.changed_at DESC LIMIT 10`
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
    const lines = csvContent.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
    const headers = parseCsvRow(lines[0]!).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    const now = new Date().toISOString();

    const findDept = db.prepare('SELECT id, name FROM departments WHERE name = ? AND is_active = 1');
    const findCat = db.prepare('SELECT id FROM categories WHERE name = ? AND department_id = ? AND is_active = 1');
    const findSub = db.prepare('SELECT id FROM subcategories WHERE name = ? AND category_id = ? AND is_active = 1');
    const findByCode = db.prepare('SELECT id FROM equipment_items WHERE equipment_code = ?');

    const tx = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = parseCsvRow(lines[i]!);
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });

          const name = row.name;
          const departmentName = row.department || row.department_name;
          const categoryName = row.category;
          const subName = row.sub_category || row.subcategory;
          const subSub = row.sub_sub_category || row.sub_subcategory || '';
          if (!name || !departmentName || !categoryName) {
            errors.push({ row: i + 1, message: 'Missing required fields: name, department, category' });
            continue;
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

          const code = row.equipment_code || nextEquipmentCode(CATEGORY_PREFIXES[deptRow.name] || 'EQP');
          const existing: any = findByCode.get(code);
          const price = canPrice ? (parseFloat(row.base_price || '0') || 0) : 0;

          let eqId = existing?.id as string | undefined;
          if (existing) {
            db.prepare(`
              UPDATE equipment_items SET name = ?, department_id = ?, category_id = ?, subcategory_id = ?,
                sub_subcategory = ?, item_type = ?, brand = ?, model = ?, pricing_type = ?,
                base_price = CASE WHEN ? = 1 THEN ? ELSE base_price END,
                notes = ?, updated_at = ?, version = version + 1
              WHERE id = ?
            `).run(name, deptRow.id, cat.id, subId, subSub || null, itemType, row.brand || '', row.model || '',
              pricingType, canPrice ? 1 : 0, price, row.notes || null, now, existing.id);
            eqId = existing.id;
          } else {
            eqId = uuidv4();
            db.prepare(`
              INSERT INTO equipment_items (id, equipment_code, name, department_id, category_id, subcategory_id, sub_subcategory, item_type, brand, model, pricing_type, base_price, notes, quantity, available_qty, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)
            `).run(eqId, code, name, deptRow.id, cat.id, subId, subSub || null, itemType, row.brand || '', row.model || '',
              pricingType, price, row.notes || null, now, now);
            db.prepare(`
              INSERT INTO equipment_assets (id, equipment_id, serial_number, asset_tag, purchase_date, delivered_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Warehouse', 'AVAILABLE', ?, ?)
            `).run(uuidv4(), eqId, row.serial_number || '', row.asset_tag || null,
              row.purchase_date || null, row.delivered_date || row.delivery_date || null,
              parseFloat(row.purchase_price || '0') || 0,
              row.vendor_name || row.supplier || null, row.warranty_expiry || null, now, now);
          }
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || 'Unknown error' });
        }
      }
    });
    tx();
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
        -- Exclude zero-priced "CAM-CAMPKG" package components: they are only billed as part
        -- of the camera package, so only the priced package main should appear in use counts
        -- (mirrors the equipment list's isZeroPricedPackageComponent filter).
        AND NOT (LOWER(e.equipment_code) LIKE '%campkg%' AND e.base_price = 0)
      GROUP BY e.id
      ORDER BY use_count DESC, e.name ASC
    `).all();
  });
}
