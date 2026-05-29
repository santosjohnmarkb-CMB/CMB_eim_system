import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, hashPassword } from '../database/index';
import { requireAdmin } from './session';
import { UserCreateSchema, UserUpdateSchema } from '../../shared/schemas';

export function registerUserHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('db:users:getAll', (event: any) => {
    requireAdmin(event);
    const users: any[] = db.prepare(
      'SELECT id, username, full_name, email, role, department, is_active, created_at, updated_at FROM users ORDER BY created_at DESC'
    ).all();
    return users;
  });

  ipcMain.handle('db:users:create', (event: any, data: unknown) => {
    requireAdmin(event);
    const input = UserCreateSchema.parse(data);
    const id = uuidv4();
    const now = new Date().toISOString();
    const passwordHash = hashPassword(input.password);

    db.prepare(
      `INSERT INTO users (id, username, password_hash, full_name, email, role, department, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, input.username, passwordHash, input.full_name, input.email || '', input.role, input.department || null, now, now);

    const user: any = db.prepare(
      'SELECT id, username, full_name, email, role, department, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(id);
    return user;
  });

  ipcMain.handle('db:users:update', (event: any, id: string, data: unknown) => {
    requireAdmin(event);
    const input = UserUpdateSchema.parse(data);
    const updates: string[] = [];
    const values: any[] = [];

    if (input.username !== undefined) { updates.push('username = ?'); values.push(input.username); }
    if (input.full_name !== undefined) { updates.push('full_name = ?'); values.push(input.full_name); }
    if (input.email !== undefined) { updates.push('email = ?'); values.push(input.email); }
    if (input.role !== undefined) { updates.push('role = ?'); values.push(input.role); }
    if (input.department !== undefined) { updates.push('department = ?'); values.push(input.department); }
    if (input.is_active !== undefined) { updates.push('is_active = ?'); values.push(input.is_active ? 1 : 0); }
    if (input.password !== undefined) {
      updates.push('password_hash = ?');
      values.push(hashPassword(input.password));
    }

    if (updates.length === 0) return null;

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const user: any = db.prepare(
      'SELECT id, username, full_name, email, role, department, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(id);
    return user;
  });

  ipcMain.handle('db:users:delete', (event: any, id: string) => {
    requireAdmin(event);
    db.prepare("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });
}
