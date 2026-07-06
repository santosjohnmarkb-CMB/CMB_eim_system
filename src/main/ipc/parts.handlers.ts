import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireWriteAccess } from './session';
import { writeAuditLog } from './audit';
import { PartCreateSchema, PartUpdateSchema, StockAdjustmentSchema } from '../../shared/schemas';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { sessionDepartment } from './department';

function generatePartCode(db: any, category: string): string {
  const prefixMap: Record<string, string> = { spare: 'SPR', expendable: 'EXP', consumable: 'CON', accessory: 'ACC' };
  const prefix = prefixMap[category] || 'PRT';
  const last: any = db.prepare(`SELECT part_code FROM parts_catalog WHERE part_code LIKE ? ORDER BY part_code DESC LIMIT 1`).get(`${prefix}-%`);
  let seq = 1;
  if (last) { seq = parseInt(last.part_code.split('-')[1] || '0', 10) + 1; }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export function registerPartsHandlers(): void {
  const db = getDatabase();

  // Department users may only mutate parts owned by their own department.
  const assertPartInDepartment = (event: any, id: string): void => {
    const dept = sessionDepartment(event);
    if (!dept) return;
    const part: any = db.prepare('SELECT department FROM parts_catalog WHERE id = ?').get(id);
    if (!part) throw new Error('Part not found');
    if (part.department !== dept) {
      throw new Error('This part belongs to another department.');
    }
  };

  ipcMain.handle('db:parts:getAll', (event: any) => {
    const dept = sessionDepartment(event);
    const deptWhere = dept ? 'AND (pc.department = ? OR pc.department IS NULL)' : '';
    return db.prepare(`
      SELECT pc.*, pi.qty_on_hand, pi.qty_reserved, pi.reorder_point, pi.reorder_qty, pi.location,
             v.name as vendor_name
      FROM parts_catalog pc
      LEFT JOIN parts_inventory pi ON pi.part_id = pc.id
      LEFT JOIN vendors v ON v.id = pc.vendor_id
      WHERE pc.is_active = 1
      ${deptWhere}
      ORDER BY pc.part_code
    `).all(...(dept ? [dept] : []));
  });

  ipcMain.handle('db:parts:getById', (_e: any, id: string) => {
    return db.prepare(`
      SELECT pc.*, pi.qty_on_hand, pi.qty_reserved, pi.reorder_point, pi.reorder_qty, pi.location, pi.last_count_date,
             v.name as vendor_name
      FROM parts_catalog pc
      LEFT JOIN parts_inventory pi ON pi.part_id = pc.id
      LEFT JOIN vendors v ON v.id = pc.vendor_id
      WHERE pc.id = ?
    `).get(id);
  });

  ipcMain.handle('db:parts:create', (event: any, data: unknown) => {
    requireWriteAccess(event);
    const input = PartCreateSchema.parse(data);
    const dept = sessionDepartment(event);
    if (dept && input.department !== dept) {
      throw new Error('You can only create parts for your own department.');
    }
    const id = uuidv4();
    const invId = uuidv4();
    const partCode = generatePartCode(db, input.category);
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO parts_catalog (id, part_code, name, description, category, unit_of_measure, unit_cost, vendor_id, department, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, partCode, input.name, input.description, input.category, input.unit_of_measure, input.unit_cost, input.vendor_id || null, input.department || null, now, now);
      db.prepare(`INSERT INTO parts_inventory (id, part_id, qty_on_hand, qty_reserved, reorder_point, reorder_qty, location, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`)
        .run(invId, id, input.initial_stock || 0, input.reorder_point, input.reorder_qty, input.location, now, now);
      if (input.initial_stock && input.initial_stock > 0) {
        db.prepare(`INSERT INTO parts_transactions (id, part_id, transaction_type, quantity, performed_by, notes) VALUES (?, ?, 'receive', ?, 'System', 'Initial stock')`)
          .run(uuidv4(), id, input.initial_stock);
      }
    });
    tx();

    const part: any = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(id);
    void pushOperationalToCloud('parts_catalog', 'INSERT', part);
    return part;
  });

  ipcMain.handle('db:parts:update', (event: any, id: string, data: unknown) => {
    requireWriteAccess(event);
    assertPartInDepartment(event, id);
    const input = PartUpdateSchema.parse(data);
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'is_active' ? (value ? 1 : 0) : value);
      }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE parts_catalog SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const part: any = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(id);
    void pushOperationalToCloud('parts_catalog', 'UPDATE', part);
    return part;
  });

  ipcMain.handle('db:parts:delete', (event: any, id: string) => {
    requireWriteAccess(event);
    assertPartInDepartment(event, id);
    const before: any = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(id);
    db.prepare("UPDATE parts_catalog SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    writeAuditLog(event, { action: 'part_deactivate', entityType: 'part', entityId: id, oldValues: before });
    return { success: true };
  });

  ipcMain.handle('db:parts:adjustStock', (event: any, data: unknown) => {
    const user = requireWriteAccess(event);
    const input = StockAdjustmentSchema.parse(data);
    assertPartInDepartment(event, input.part_id);
    const txType = input.quantity > 0 ? 'receive' : 'adjust';
    // Attribute the movement to the authenticated operator, never a client-supplied
    // name — the transaction log is an audit trail and must not be spoofable.
    const actor = user.full_name;

    const tx = db.transaction(() => {
      // Never let on-hand stock go negative; a reduction is clamped at zero.
      db.prepare("UPDATE parts_inventory SET qty_on_hand = MAX(0, qty_on_hand + ?), updated_at = datetime('now') WHERE part_id = ?")
        .run(input.quantity, input.part_id);
      db.prepare(`INSERT INTO parts_transactions (id, part_id, transaction_type, quantity, performed_by, notes) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), input.part_id, txType, input.quantity, actor, `${input.reason}: ${input.notes}`);
    });
    tx();

    const inv: any = db.prepare('SELECT * FROM parts_inventory WHERE part_id = ?').get(input.part_id);
    if (inv) void pushOperationalToCloud('parts_inventory', 'UPDATE', inv);
    return { success: true };
  });

  ipcMain.handle('db:parts:getTransactions', (_e: any, partId: string) => {
    return db.prepare(`
      SELECT pt.*, pc.name as part_name, pc.part_code
      FROM parts_transactions pt
      JOIN parts_catalog pc ON pc.id = pt.part_id
      WHERE pt.part_id = ? ORDER BY pt.created_at DESC LIMIT 100
    `).all(partId);
  });

  ipcMain.handle('db:parts:getLowStock', () => {
    return db.prepare(`
      SELECT pc.*, pi.qty_on_hand, pi.reorder_point, v.name as vendor_name
      FROM parts_catalog pc
      JOIN parts_inventory pi ON pi.part_id = pc.id
      LEFT JOIN vendors v ON v.id = pc.vendor_id
      WHERE pc.is_active = 1 AND pi.qty_on_hand <= pi.reorder_point
      ORDER BY (pi.qty_on_hand * 1.0 / CASE WHEN pi.reorder_point = 0 THEN 1 ELSE pi.reorder_point END)
    `).all();
  });

  ipcMain.handle('db:parts:getCompatibility', (_e: any, partId: string) => {
    return db.prepare(`
      SELECT pco.*, e.name as equipment_name, e.equipment_code
      FROM parts_compatibility pco
      JOIN equipment_items e ON e.id = pco.equipment_id
      WHERE pco.part_id = ?
    `).all(partId);
  });

  ipcMain.handle('db:parts:setCompatibility', (event: any, partId: string, equipmentIds: string[]) => {
    requireWriteAccess(event);
    assertPartInDepartment(event, partId);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM parts_compatibility WHERE part_id = ?').run(partId);
      for (const eqId of equipmentIds) {
        db.prepare('INSERT INTO parts_compatibility (id, part_id, equipment_id) VALUES (?, ?, ?)').run(uuidv4(), partId, eqId);
      }
    });
    tx();
    return { success: true };
  });
}
