import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireWriteAccess } from './session';
import { writeAuditLog } from './audit';
import { VendorCreateSchema, VendorUpdateSchema } from '../../shared/schemas';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { sessionDepartment } from './department';

export function registerVendorHandlers(): void {
  const db = getDatabase();

  // Department users may only mutate vendors owned by their own department.
  const assertVendorInDepartment = (event: any, id: string): void => {
    const dept = sessionDepartment(event);
    if (!dept) return;
    const vendor: any = db.prepare('SELECT department FROM vendors WHERE id = ?').get(id);
    if (!vendor) throw new Error('Vendor not found');
    if (vendor.department !== dept) {
      throw new Error('This vendor belongs to another department.');
    }
  };

  ipcMain.handle('db:vendors:getAll', (event: any) => {
    const dept = sessionDepartment(event);
    if (dept) {
      return db.prepare('SELECT * FROM vendors WHERE is_active = 1 AND (department = ? OR department IS NULL) ORDER BY name').all(dept);
    }
    return db.prepare('SELECT * FROM vendors WHERE is_active = 1 ORDER BY name').all();
  });

  ipcMain.handle('db:vendors:getById', (_e: any, id: string) => {
    return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  });

  ipcMain.handle('db:vendors:create', (event: any, data: unknown) => {
    requireWriteAccess(event);
    const input = VendorCreateSchema.parse(data);
    const dept = sessionDepartment(event);
    // A department user can only create vendors within their own department.
    if (dept && input.department !== dept) {
      throw new Error('You can only create vendors for your own department.');
    }
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO vendors (id, name, contact_person, phone, email, address, payment_terms, notes, department, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, input.name, input.contact_person || null, input.phone || null, input.email || null, input.address || null, input.payment_terms || null, input.notes || null, input.department || null, now, now);
    const vendor: any = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    void pushOperationalToCloud('vendors', 'INSERT', vendor);
    return vendor;
  });

  ipcMain.handle('db:vendors:update', (event: any, id: string, data: unknown) => {
    requireWriteAccess(event);
    assertVendorInDepartment(event, id);
    const input = VendorUpdateSchema.parse(data);
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) { fields.push(`${key} = ?`); values.push(key === 'is_active' ? (value ? 1 : 0) : value); }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE vendors SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const vendor: any = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    void pushOperationalToCloud('vendors', 'UPDATE', vendor);
    return vendor;
  });

  ipcMain.handle('db:vendors:delete', (event: any, id: string) => {
    requireWriteAccess(event);
    assertVendorInDepartment(event, id);
    const before: any = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    db.prepare("UPDATE vendors SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    writeAuditLog(event, { action: 'vendor_deactivate', entityType: 'vendor', entityId: id, oldValues: before });
    return { success: true };
  });
}
