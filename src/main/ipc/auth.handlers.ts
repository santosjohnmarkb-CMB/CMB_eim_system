import { ipcMain } from 'electron';
import { getDatabase, hashPassword, verifyPassword } from '../database/index';
import { setSession, clearSession, getSession } from './session';
import { writeAuditLog } from './audit';
import { LoginSchema } from '../../shared/schemas';
import { isEimAppRole, normalizeEimRole } from '../../shared/constants';

export function registerAuthHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('auth:login', (event: any, rawUsername: unknown, rawPassword: unknown) => {
    const { username, password } = LoginSchema.parse({
      username: rawUsername,
      password: rawPassword,
    });
    const user: any = db
      .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
      .get(username);
    if (!user) {
      writeAuditLog(event, { action: 'login_failed', entityType: 'user', entityId: null, userId: null, newValues: { username } });
      return null;
    }

    // The users table is shared with the Rental (1Take) app; reject accounts
    // whose role does not belong to EIM so rental-only users can't sign in here.
    if (!isEimAppRole(user.role)) {
      writeAuditLog(event, { action: 'login_failed', entityType: 'user', entityId: user.id, userId: null, newValues: { username, reason: 'non_eim_role' } });
      return null;
    }

    if (!verifyPassword(password, user.password_hash)) {
      writeAuditLog(event, { action: 'login_failed', entityType: 'user', entityId: user.id, userId: null, newValues: { username } });
      return null;
    }

    if (!user.password_hash.includes(':')) {
      const upgraded = hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
    }

    // Collapse any legacy operational role (inventory_manager, technician, …)
    // into equipment_manager so the app only ever deals with the 3 EIM roles.
    const { password_hash, ...rest } = user;
    const safeUser = { ...rest, role: normalizeEimRole(user.role) };
    setSession(event, {
      id: safeUser.id,
      username: safeUser.username,
      full_name: safeUser.full_name,
      role: safeUser.role as string,
      email: safeUser.email,
      department: safeUser.department ?? null,
    });
    writeAuditLog(event, { action: 'login', entityType: 'user', entityId: safeUser.id });
    return safeUser;
  });

  ipcMain.handle('auth:verifyAdmin', (event: any, username: string, password: string) => {
    const user: any = db
      .prepare("SELECT * FROM users WHERE username = ? AND is_active = 1 AND role = 'admin'")
      .get(username);
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;
    const { password_hash, ...safeUser } = user;
    if (!getSession(event)) {
      setSession(event, {
        id: safeUser.id,
        username: safeUser.username,
        full_name: safeUser.full_name,
        role: safeUser.role,
        email: safeUser.email,
        department: safeUser.department ?? null,
      });
    }
    return safeUser;
  });

  ipcMain.handle('auth:logout', (event: any) => {
    writeAuditLog(event, { action: 'logout', entityType: 'user', entityId: getSession(event)?.id ?? null });
    clearSession(event);
    return { success: true };
  });

  // Re-hydrate the renderer after a reload/relaunch. The main-process session is
  // keyed by webContents and survives a renderer reload, so we can return the
  // current user (fetched fresh from the DB so role/department changes apply)
  // without forcing the operator to log in again. Returns null when there is no
  // active session.
  ipcMain.handle('auth:getSession', (event: any) => {
    const session = getSession(event);
    if (!session) return null;
    const user: any = db
      .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
      .get(session.id);
    if (!user || !isEimAppRole(user.role)) {
      clearSession(event);
      return null;
    }
    const { password_hash: _ph, ...rest } = user;
    return { ...rest, role: normalizeEimRole(user.role) };
  });
}
