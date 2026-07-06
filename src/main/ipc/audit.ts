import type { IpcMainInvokeEvent } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { getSession } from './session';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  /** Override the actor when there is no session yet (e.g. login). */
  userId?: string | null;
}

/**
 * Append a row to the `audit_logs` table for security-sensitive actions
 * (authentication, user administration, destructive deletes).
 *
 * This is best-effort: an audit write must never break the primary operation,
 * so any failure is logged and swallowed. Callers should invoke it AFTER the
 * primary mutation has succeeded.
 */
export function writeAuditLog(event: IpcMainInvokeEvent, entry: AuditEntry): void {
  try {
    const db = getDatabase();
    const actorId = entry.userId !== undefined ? entry.userId : getSession(event)?.id ?? null;
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_values, new_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuidv4(),
      actorId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldValues !== undefined ? JSON.stringify(entry.oldValues) : null,
      entry.newValues !== undefined ? JSON.stringify(entry.newValues) : null,
    );
  } catch (err) {
    console.error('[audit] failed to write audit log:', err);
  }
}

/** Strip sensitive fields (password hashes, etc.) before persisting a snapshot. */
export function redactUser(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const { password_hash, ...rest } = row;
  void password_hash;
  return rest;
}
