import { ipcMain } from 'electron';
import { getDatabase } from '../database/index';
import { requireAdmin } from './session';

interface AuditQuery {
  limit?: number;
  action?: string;
  entityType?: string;
}

export function registerAuditHandlers(): void {
  const db = getDatabase();

  // Recent audit-trail entries, newest first, joined with the actor's name.
  // Admin-only: the trail records security-sensitive activity.
  ipcMain.handle('db:audit:getRecent', (event: any, options?: AuditQuery) => {
    requireAdmin(event);
    const limit = Math.min(Math.max(Number(options?.limit) || 200, 1), 1000);
    const where: string[] = [];
    const params: any[] = [];
    if (options?.action) { where.push('a.action = ?'); params.push(options.action); }
    if (options?.entityType) { where.push('a.entity_type = ?'); params.push(options.entityType); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`
      SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id,
             a.old_values, a.new_values, a.created_at,
             u.username, u.full_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(...params, limit);
  });

  // Distinct action names for the filter dropdown.
  ipcMain.handle('db:audit:getActions', (event: any) => {
    requireAdmin(event);
    return db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action')
      .all()
      .map((r: any) => r.action);
  });
}
