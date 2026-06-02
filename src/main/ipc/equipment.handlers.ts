import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession } from './session';
import { EquipmentCreateSchema } from '../../shared/schemas';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { CATEGORY_PREFIXES } from '../../shared/constants';

export function registerEquipmentHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('db:categories:getAll', () => {
    return db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY display_order').all();
  });

  ipcMain.handle('db:subcategories:getAll', () => {
    return db.prepare('SELECT * FROM subcategories WHERE is_active = 1 ORDER BY display_order').all();
  });

  ipcMain.handle('db:subcategories:getByCategory', (_e: any, categoryId: string) => {
    return db.prepare('SELECT * FROM subcategories WHERE category_id = ? AND is_active = 1 ORDER BY display_order').all(categoryId);
  });

  ipcMain.handle('db:equipment:getAll', () => {
    return db.prepare(`
      SELECT e.*, ea.id as asset_db_id, ea.serial_number, ea.asset_tag, ea.purchase_date,
             ea.purchase_price, ea.vendor_name as asset_vendor, ea.warranty_expiry,
             ea.current_location, ea.current_status,
             ea.last_inspection_date, ea.notes as asset_notes,
             c.name as category_name, sc.name as subcategory_name
      FROM equipment_items e
      LEFT JOIN equipment_assets ea ON ea.equipment_id = e.id
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN subcategories sc ON sc.id = e.subcategory_id
      WHERE e.is_active = 1
      ORDER BY e.equipment_code
    `).all().map((row: any) => ({
      ...row,
      is_active: !!row.is_active,
      asset: row.asset_db_id ? {
        id: row.asset_db_id, equipment_id: row.id, serial_number: row.serial_number,
        asset_tag: row.asset_tag, purchase_date: row.purchase_date,
        purchase_price: row.purchase_price, vendor_name: row.asset_vendor,
        warranty_expiry: row.warranty_expiry,
        current_location: row.current_location, current_status: row.current_status,
        last_inspection_date: row.last_inspection_date, notes: row.asset_notes,
      } : undefined,
    }));
  });

  ipcMain.handle('db:equipment:getById', (_e: any, id: string) => {
    const row: any = db.prepare(`
      SELECT e.*, ea.id as asset_db_id, ea.serial_number, ea.asset_tag, ea.purchase_date,
             ea.purchase_price, ea.vendor_name as asset_vendor, ea.warranty_expiry,
             ea.current_location, ea.current_status,
             ea.last_inspection_date, ea.retirement_date, ea.retirement_reason, ea.notes as asset_notes,
             c.name as category_name, sc.name as subcategory_name
      FROM equipment_items e
      LEFT JOIN equipment_assets ea ON ea.equipment_id = e.id
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN subcategories sc ON sc.id = e.subcategory_id
      WHERE e.id = ?
    `).get(id);
    if (!row) return null;
    return {
      ...row,
      is_active: !!row.is_active,
      asset: row.asset_db_id ? {
        id: row.asset_db_id, equipment_id: row.id, serial_number: row.serial_number,
        asset_tag: row.asset_tag, purchase_date: row.purchase_date,
        purchase_price: row.purchase_price, vendor_name: row.asset_vendor,
        warranty_expiry: row.warranty_expiry,
        current_location: row.current_location, current_status: row.current_status,
        last_inspection_date: row.last_inspection_date, retirement_date: row.retirement_date,
        retirement_reason: row.retirement_reason, notes: row.asset_notes,
      } : undefined,
    };
  });

  ipcMain.handle('db:equipment:generateCode', (_e: any, categoryId: string) => {
    const cat: any = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId);
    if (!cat) throw new Error('Category not found');
    const prefix = CATEGORY_PREFIXES[cat.name] || 'EQP';
    const last: any = db.prepare(
      `SELECT equipment_code FROM equipment_items WHERE equipment_code LIKE ? ORDER BY equipment_code DESC LIMIT 1`
    ).get(`${prefix}-%`);
    let seq = 1;
    if (last) {
      const num = parseInt(last.equipment_code.split('-')[1] || '0', 10);
      seq = num + 1;
    }
    return `${prefix}-${String(seq).padStart(3, '0')}`;
  });

  ipcMain.handle('db:equipment:create', (event: any, data: unknown) => {
    requireSession(event);
    const input = EquipmentCreateSchema.parse(data);
    const equipmentId = uuidv4();
    const assetId = uuidv4();
    const now = new Date().toISOString();

    const cat: any = db.prepare('SELECT name FROM categories WHERE id = ?').get(input.category_id);
    const prefix = cat ? (CATEGORY_PREFIXES[cat.name] || 'EQP') : 'EQP';
    const last: any = db.prepare(
      `SELECT equipment_code FROM equipment_items WHERE equipment_code LIKE ? ORDER BY equipment_code DESC LIMIT 1`
    ).get(`${prefix}-%`);
    let seq = 1;
    if (last) {
      const num = parseInt(last.equipment_code.split('-')[1] || '0', 10);
      seq = num + 1;
    }
    const equipmentCode = `${prefix}-${String(seq).padStart(3, '0')}`;

    const qty = input.quantity ?? 1;

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO equipment_items (id, equipment_code, name, display_name, category_id, subcategory_id, sub_subcategory, item_type, brand, model, description, pricing_type, base_price, notes, quantity, available_qty, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(equipmentId, equipmentCode, input.name, input.display_name, input.category_id, input.subcategory_id,
        input.sub_subcategory || null, input.item_type, input.brand, input.model, input.description,
        input.pricing_type, input.base_price, input.notes || null, qty, qty, now, now);

      db.prepare(`
        INSERT INTO equipment_assets (id, equipment_id, serial_number, asset_tag, purchase_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Warehouse', 'AVAILABLE', ?, ?)
      `).run(assetId, equipmentId, input.serial_number || '', input.asset_tag || null,
        input.purchase_date || null, input.purchase_price || 0, input.vendor_name || null,
        input.warranty_expiry || null, now, now);
    });
    tx();

    const equipmentRow: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(equipmentId);
    void pushCatalogToCloud('equipment_items', 'INSERT', equipmentRow);

    const assetRow: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(assetId);
    void pushOperationalToCloud('equipment_assets', 'INSERT', assetRow);

    return { ...equipmentRow, is_active: true };
  });

  ipcMain.handle('db:equipment:update', (event: any, id: string, data: unknown) => {
    requireSession(event);
    const allowedFields = ['name', 'display_name', 'category_id', 'subcategory_id', 'sub_subcategory',
      'item_type', 'brand', 'model', 'description', 'pricing_type', 'base_price', 'notes', 'quantity', 'available_qty'];
    const assetFields = ['serial_number', 'asset_tag', 'purchase_date', 'purchase_price',
      'vendor_name', 'warranty_expiry', 'current_location'];
    const updates: string[] = [];
    const values: any[] = [];
    const assetUpdates: string[] = [];
    const assetValues: any[] = [];
    const input = data as Record<string, any>;

    for (const field of allowedFields) {
      if (input[field] !== undefined) { updates.push(`${field} = ?`); values.push(input[field]); }
    }
    for (const field of assetFields) {
      if (input[field] !== undefined) { assetUpdates.push(`${field} = ?`); assetValues.push(input[field]); }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE equipment_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      const row: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
      void pushCatalogToCloud('equipment_items', 'UPDATE', row);
    }

    if (assetUpdates.length > 0) {
      assetUpdates.push("updated_at = datetime('now')");
      assetValues.push(id);
      db.prepare(`UPDATE equipment_assets SET ${assetUpdates.join(', ')} WHERE equipment_id = ?`).run(...assetValues);
      const assetRow: any = db.prepare('SELECT * FROM equipment_assets WHERE equipment_id = ?').get(id);
      if (assetRow) void pushOperationalToCloud('equipment_assets', 'UPDATE', assetRow);
    }

    return db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
  });

  ipcMain.handle('db:equipment:delete', (event: any, id: string) => {
    requireSession(event);
    db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    const row: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(id);
    void pushCatalogToCloud('equipment_items', 'UPDATE', row);
    return { ok: true };
  });

  ipcMain.handle('db:equipment:search', (_e: any, query: string) => {
    const pattern = `%${query}%`;
    return db.prepare(`
      SELECT * FROM equipment_items WHERE is_active = 1 AND (
        name LIKE ? OR display_name LIKE ? OR equipment_code LIKE ? OR brand LIKE ? OR model LIKE ?
      ) ORDER BY equipment_code LIMIT 50
    `).all(pattern, pattern, pattern, pattern, pattern);
  });

  ipcMain.handle('db:equipment:updateStatus', (event: any, equipmentId: string, newStatus: string, reason: string) => {
    const user = requireSession(event);
    const asset: any = db.prepare('SELECT * FROM equipment_assets WHERE equipment_id = ?').get(equipmentId);
    if (!asset) throw new Error('Equipment asset not found');
    const previousStatus = asset.current_status;

    const tx = db.transaction(() => {
      db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE equipment_id = ?")
        .run(newStatus, equipmentId);

      db.prepare(`
        INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), asset.id, equipmentId, previousStatus, newStatus, user.full_name, reason || '');

      if (newStatus === 'RETIRED') {
        db.prepare("UPDATE equipment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(equipmentId);
      }
    });
    tx();

    const updatedAsset: any = db.prepare('SELECT * FROM equipment_assets WHERE equipment_id = ?').get(equipmentId);
    void pushOperationalToCloud('equipment_assets', 'UPDATE', updatedAsset);
    return { success: true };
  });

  ipcMain.handle('db:equipment:batchUpdateStatus', (event: any, ids: string[], newStatus: string, reason: string) => {
    const user = requireSession(event);
    const tx = db.transaction(() => {
      for (const equipmentId of ids) {
        const asset: any = db.prepare('SELECT * FROM equipment_assets WHERE equipment_id = ?').get(equipmentId);
        if (!asset) continue;
        const previousStatus = asset.current_status;
        db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE equipment_id = ?")
          .run(newStatus, equipmentId);
        db.prepare(`
          INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), asset.id, equipmentId, previousStatus, newStatus, user.full_name, reason || '');
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
    const catJoin = catFilter ? 'JOIN categories c ON c.id = e.category_id' : '';
    const catWhere = catFilter ? `AND c.name IN (${catPlaceholders})` : '';
    const catParams = catFilter ? categoryNames! : [];

    const total: any = db.prepare(`SELECT COUNT(*) as count FROM equipment_items e ${catJoin} WHERE e.is_active = 1 ${catWhere}`).get(...catParams);
    const statusCounts: any[] = db.prepare(`
      SELECT ea.current_status as status, COUNT(*) as count
      FROM equipment_assets ea JOIN equipment_items e ON e.id = ea.equipment_id ${catJoin}
      WHERE e.is_active = 1 ${catWhere} GROUP BY ea.current_status
    `).all(...catParams);

    const ticketQuery = catFilter
      ? `SELECT COUNT(*) as count FROM maintenance_tickets mt JOIN equipment_items e ON e.id = mt.equipment_id JOIN categories c ON c.id = e.category_id WHERE mt.repair_status NOT IN ('COMPLETED', 'CANCELLED') AND c.name IN (${catPlaceholders})`
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
    requireSession(event);
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
    const headers = lines[0]!.split(',').map(h => h.trim().toLowerCase());
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i]!.split(',').map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

          const name = row['name'];
          const categoryName = row['category'];
          const subcategoryName = row['subcategory'];
          if (!name || !categoryName || !subcategoryName) {
            errors.push({ row: i + 1, message: 'Missing required fields: name, category, subcategory' });
            continue;
          }

          let cat: any = db.prepare('SELECT id FROM categories WHERE name = ? AND is_active = 1').get(categoryName);
          if (!cat) {
            const catId = uuidv4();
            db.prepare('INSERT INTO categories (id, name, display_order, is_active) VALUES (?, ?, 99, 1)').run(catId, categoryName);
            cat = { id: catId };
          }

          let subcat: any = db.prepare('SELECT id FROM subcategories WHERE name = ? AND category_id = ? AND is_active = 1').get(subcategoryName, cat.id);
          if (!subcat) {
            const subId = uuidv4();
            db.prepare('INSERT INTO subcategories (id, category_id, name, display_order, is_active) VALUES (?, ?, ?, 99, 1)').run(subId, cat.id, subcategoryName);
            subcat = { id: subId };
          }

          const prefix = CATEGORY_PREFIXES[categoryName] || 'EQP';
          const last: any = db.prepare('SELECT equipment_code FROM equipment_items WHERE equipment_code LIKE ? ORDER BY equipment_code DESC LIMIT 1').get(`${prefix}-%`);
          let seq = 1;
          if (last) { seq = parseInt(last.equipment_code.split('-')[1] || '0', 10) + 1; }
          const code = `${prefix}-${String(seq).padStart(3, '0')}`;

          const eqId = uuidv4();
          const assetId = uuidv4();

          db.prepare(`
            INSERT INTO equipment_items (id, equipment_code, name, display_name, category_id, subcategory_id, sub_subcategory, item_type, brand, model, description, pricing_type, base_price, notes, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'standalone', ?, ?, ?, 'per_day', ?, ?, 1, ?, ?)
          `).run(eqId, code, name, row['display_name'] || name, cat.id, subcat.id, row['sub_subcategory'] || null,
            row['brand'] || '', row['model'] || '', row['description'] || '', parseFloat(row['base_price'] || '0'),
            row['notes'] || null, now, now);

          db.prepare(`
            INSERT INTO equipment_assets (id, equipment_id, serial_number, asset_tag, purchase_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Warehouse', 'AVAILABLE', ?, ?)
          `).run(assetId, eqId, row['serial_number'] || '', row['asset_tag'] || null,
            row['purchase_date'] || null, parseFloat(row['purchase_price'] || '0'),
            row['vendor_name'] || null, row['warranty_expiry'] || null, now, now);

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
        COUNT(asl.id) as use_count
      FROM equipment_items e
      JOIN categories c ON c.id = e.category_id
      JOIN subcategories s ON s.id = e.subcategory_id
      LEFT JOIN asset_status_log asl
        ON asl.equipment_id = e.id AND asl.new_status = 'DEPLOYED'
      WHERE e.is_active = 1
      GROUP BY e.id
      ORDER BY use_count DESC, e.name ASC
    `).all();
  });
}
