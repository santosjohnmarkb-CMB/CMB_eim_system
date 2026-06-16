import { ipcMain } from 'electron';
import { getDatabase, hashPassword, verifyPassword } from '../database/index';
import { setSession, clearSession, getSession } from './session';
import { LoginSchema } from '../../shared/schemas';

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
    if (!user) return null;

    if (!verifyPassword(password, user.password_hash)) return null;

    if (!user.password_hash.includes(':')) {
      const upgraded = hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
    }

    const { password_hash, ...safeUser } = user;
    setSession(event, {
      id: safeUser.id,
      username: safeUser.username,
      full_name: safeUser.full_name,
      role: safeUser.role,
      email: safeUser.email,
      department: safeUser.department ?? null,
    });
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
    clearSession(event);
    return { success: true };
  });
}
