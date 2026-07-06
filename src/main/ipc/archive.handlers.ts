/**
 * Admin "Archive List" IPC handlers.
 *
 * Channels (all admin-only):
 *   - archive:list:create      Render a section's closed list to a PDF, save to Drive
 *                              (+ local mirror), and soft-clear the included records.
 *   - archive:openLocation     Reveal a saved archive file in the OS file manager.
 *   - archive:list:getCleared  List every soft-cleared record across the three sections,
 *                              normalized for the Department > Year > Month > Section tree.
 */

import { ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { getDatabase } from '../database/index';
import { requireAdmin, requireSession } from './session';
import { renderAndArchiveList, type ArchiveListInput } from '../sync/archive-list';
import { getLocalArchiveRoot } from '../sync/archive-path';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { CATEGORY_TO_DEPARTMENT } from '../../shared/constants';

export interface ClearedArchiveEntry {
  section: 'maintenance' | 'loan' | 'purchase';
  department: 'camera' | 'lights_grips' | null;
  closedDate: string | null;
  archivedAt: string | null;
  id: string;
  number: string;
  title: string;
  subtitle: string;
}

export function registerArchiveHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('archive:list:create', async (event: any, payload: ArchiveListInput) => {
    requireAdmin(event);
    return renderAndArchiveList(payload);
  });

  ipcMain.handle('archive:openLocation', (event: any, targetPath: string) => {
    requireAdmin(event);
    if (!targetPath || typeof targetPath !== 'string') {
      return { success: false, message: 'No file path provided.' };
    }
    // Only ever reveal files that live inside our own archive root.
    const root = path.resolve(getLocalArchiveRoot());
    const resolved = path.resolve(targetPath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { success: false, message: 'Refusing to open a path outside the archive folder.' };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, message: 'The archived file no longer exists at its saved location.' };
    }
    shell.showItemInFolder(resolved);
    return { success: true };
  });

  // Permanently delete a single archived line entry. Guarded so it can ONLY remove a
  // record that has already been archived to a list (list_archived_at IS NOT NULL) and
  // is in its closed state — so it can never touch a live/open record. Because the
  // record is closed, the delete has no inventory/availability side effects; child
  // rows are removed in the same transaction. The saved PDF snapshot is left intact.
  ipcMain.handle('archive:list:deleteEntry', (event: any, section: ClearedArchiveEntry['section'], id: string) => {
    requireAdmin(event);
    if (!id || typeof id !== 'string') return { success: false, message: 'No record id provided.' };

    if (section === 'maintenance') {
      const t: any = db.prepare('SELECT id, repair_status, list_archived_at FROM maintenance_tickets WHERE id = ?').get(id);
      if (!t) return { success: false, message: 'Ticket not found.' };
      if (!t.list_archived_at) return { success: false, message: 'Only archived tickets can be deleted here.' };
      if (t.repair_status !== 'COMPLETED') return { success: false, message: 'Only completed tickets can be deleted here.' };
      db.transaction(() => {
        db.prepare('DELETE FROM maintenance_notes WHERE ticket_id = ?').run(id);
        db.prepare('DELETE FROM ticket_actions WHERE ticket_id = ?').run(id);
        db.prepare('DELETE FROM maintenance_tickets WHERE id = ?').run(id);
      })();
      // Propagate the delete to the cloud; otherwise the next full reconcile would pull
      // the still-present cloud row back (resurrecting it here and leaving it visible to
      // other users). Notes/actions cascade-delete via the Supabase foreign keys.
      void pushOperationalToCloud('maintenance_tickets', 'DELETE', { id });
      return { success: true };
    }

    if (section === 'loan') {
      const l: any = db.prepare('SELECT id, status, list_archived_at FROM equipment_loans WHERE id = ?').get(id);
      if (!l) return { success: false, message: 'Loan not found.' };
      if (!l.list_archived_at) return { success: false, message: 'Only archived loans can be deleted here.' };
      if (l.status !== 'RETURNED') return { success: false, message: 'Only fully returned loans can be deleted here.' };
      db.transaction(() => {
        db.prepare('DELETE FROM equipment_loan_items WHERE loan_id = ?').run(id);
        db.prepare('DELETE FROM equipment_loans WHERE id = ?').run(id);
      })();
      void pushOperationalToCloud('equipment_loans', 'DELETE', { id });
      return { success: true };
    }

    if (section === 'purchase') {
      const r: any = db.prepare('SELECT id, status, list_archived_at FROM purchase_requests WHERE id = ?').get(id);
      if (!r) return { success: false, message: 'Purchase request not found.' };
      if (!r.list_archived_at) return { success: false, message: 'Only archived requests can be deleted here.' };
      if (r.status !== 'FULFILLED') return { success: false, message: 'Only fulfilled requests can be deleted here.' };
      db.transaction(() => {
        db.prepare('DELETE FROM purchase_request_items WHERE request_id = ?').run(id);
        db.prepare('DELETE FROM purchase_requests WHERE id = ?').run(id);
      })();
      void pushOperationalToCloud('purchase_requests', 'DELETE', { id });
      return { success: true };
    }

    return { success: false, message: 'Unknown section.' };
  });

  ipcMain.handle('archive:list:getCleared', (event: any): ClearedArchiveEntry[] => {
    // Readable by any signed-in user so they can print archived records. Deleting
    // is still admin-only (see archive:list:deleteEntry). Department users are
    // scoped to their own department; admins and viewers see every department.
    const user = requireSession(event);
    const entries: ClearedArchiveEntry[] = [];

    // Maintenance — department derived from the equipment's category.
    const tickets: any[] = db.prepare(`
      SELECT mt.id, mt.ticket_number, mt.completion_date, mt.list_archived_at,
        mt.issue_description, mt.document_type,
        e.name AS equipment_name, e.equipment_code,
        c.name AS category_name
      FROM maintenance_tickets mt
      JOIN equipment_items e ON e.id = mt.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE mt.list_archived_at IS NOT NULL
      ORDER BY mt.completion_date DESC
    `).all();
    for (const t of tickets) {
      entries.push({
        section: 'maintenance',
        department: (t.category_name ? CATEGORY_TO_DEPARTMENT[t.category_name] : null) ?? null,
        closedDate: t.completion_date ?? null,
        archivedAt: t.list_archived_at ?? null,
        id: t.id,
        number: t.ticket_number,
        title: t.equipment_name || '—',
        subtitle: t.equipment_code || t.issue_description || '',
      });
    }

    // Loans — closed date is the latest item return date, falling back to updated_at.
    const loans: any[] = db.prepare(`
      SELECT l.id, l.loan_number, l.department, l.person_or_org, l.purpose,
        l.updated_at, l.list_archived_at,
        (SELECT MAX(li.returned_date) FROM equipment_loan_items li WHERE li.loan_id = l.id) AS last_returned,
        (SELECT GROUP_CONCAT(COALESCE(e.name, li.item_name), ', ')
           FROM equipment_loan_items li
           LEFT JOIN equipment_items e ON e.id = li.equipment_id
           WHERE li.loan_id = l.id) AS equipment_names
      FROM equipment_loans l
      WHERE l.list_archived_at IS NOT NULL
      ORDER BY l.updated_at DESC
    `).all();
    for (const l of loans) {
      entries.push({
        section: 'loan',
        department: l.department ?? null,
        closedDate: l.last_returned || l.updated_at || null,
        archivedAt: l.list_archived_at ?? null,
        id: l.id,
        number: l.loan_number,
        title: l.person_or_org || '—',
        subtitle: l.purpose || l.equipment_names || '',
      });
    }

    // Purchase requests — closed date is the fulfilled timestamp.
    const requests: any[] = db.prepare(`
      SELECT id, request_number, department, requested_asset, supplier,
        fulfilled_at, updated_at, list_archived_at
      FROM purchase_requests
      WHERE list_archived_at IS NOT NULL
      ORDER BY fulfilled_at DESC
    `).all();
    for (const r of requests) {
      entries.push({
        section: 'purchase',
        department: r.department ?? null,
        closedDate: r.fulfilled_at || r.updated_at || null,
        archivedAt: r.list_archived_at ?? null,
        id: r.id,
        number: r.request_number,
        title: r.requested_asset || '—',
        subtitle: r.supplier || '',
      });
    }

    // Department users only see their own department's archives.
    const scopeDept = (user.role !== 'admin' && user.role !== 'viewer') ? (user.department ?? null) : null;
    return scopeDept ? entries.filter((e) => e.department === scopeDept) : entries;
  });
}
