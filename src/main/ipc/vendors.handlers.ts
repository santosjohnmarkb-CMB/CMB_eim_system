import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession } from './session';
import { VendorCreateSchema, VendorUpdateSchema } from '../../shared/schemas';
import { pushOperationalToCloud } from '../sync/operational-sync';

export function registerVendorHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('db:vendors:getAll', () => {
    return db.prepare('SELECT * FROM vendors WHERE is_active = 1 ORDER BY name').all();
  });

  ipcMain.handle('db:vendors:getById', (_e: any, id: string) => {
    return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  });

  ipcMain.handle('db:vendors:create', (event: any, data: unknown) => {
    requireSession(event);
    const input = VendorCreateSchema.parse(data);
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO vendors (id, name, contact_person, phone, email, address, payment_terms, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, input.name, input.contact_person || null, input.phone || null, input.email || null, input.address || null, input.payment_terms || null, input.notes || null, now, now);
    const vendor: any = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    void pushOperationalToCloud('vendors', 'INSERT', vendor);
    return vendor;
  });

  ipcMain.handle('db:vendors:update', (event: any, id: string, data: unknown) => {
    requireSession(event);
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
    requireSession(event);
    db.prepare("UPDATE vendors SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });
}
