import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession, requireWriteAccess } from './session';
import { LoanCreateSchema, LoanUpdateSchema, LoanReturnSchema, AttachmentDataSchema } from '../../shared/schemas';
import { LOAN_DEPT_PREFIX, LOAN_DIRECTION_CONFIG } from '../../shared/constants';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { sessionDepartment, assertEquipmentInDepartment } from './department';
import { recomputeAvailability, pickAvailableAsset } from './availability';
import { archiveLoan } from '../sync/archive-eim';
import { saveBlob, deleteBlob, resolveBlob } from '../blob-store';

// Auto-archive the loan's release document once the whole loan is returned
// (fire-and-forget; never blocks or fails the return action).
function maybeArchiveReturnedLoan(db: any, loanId: string): void {
  const loan: any = db.prepare('SELECT status, archived_at FROM equipment_loans WHERE id = ?').get(loanId);
  if (loan && loan.status === 'RETURNED' && !loan.archived_at) {
    void archiveLoan(loanId);
  }
}

function generateLoanNumber(db: any, department: 'camera' | 'lights_grips', direction: 'OUTWARD' | 'INWARD'): string {
  const deptCode = LOAN_DEPT_PREFIX[department] || 'CD';
  const dirCode = LOAN_DIRECTION_CONFIG[direction]?.numberCode || 'OUT';
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `CMB-LOAN-${dirCode}-${deptCode}-${mm}${dd}${yy}-`;
  const last: any = db.prepare(`SELECT loan_number FROM equipment_loans WHERE loan_number LIKE ? ORDER BY loan_number DESC LIMIT 1`).get(`${prefix}%`);
  let seq = 1;
  if (last) {
    const parts = last.loan_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// Recompute the order status from its line items: all returned -> RETURNED,
// some returned -> PARTIAL, none returned -> ACTIVE.
function recomputeLoanStatus(db: any, loanId: string): void {
  const counts: any = db.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'RETURNED' THEN 1 ELSE 0 END) as returned
     FROM equipment_loan_items WHERE loan_id = ?`,
  ).get(loanId);
  const total = counts?.total || 0;
  const returned = counts?.returned || 0;
  let status = 'ACTIVE';
  if (total > 0 && returned === total) status = 'RETURNED';
  else if (returned > 0) status = 'PARTIAL';
  db.prepare("UPDATE equipment_loans SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, loanId);
}

// Mark a single loan item returned. For OUTWARD items (which reference our catalog) this
// also restores availability and asset status; INWARD items have no equipment_id and only
// flip to RETURNED (the item belonged to an external party, never our inventory).
function returnSingleItem(db: any, item: any, changedBy: string): void {
  db.prepare("UPDATE equipment_loan_items SET status = 'RETURNED', returned_date = ? WHERE id = ?")
    .run(new Date().toISOString().slice(0, 10), item.id);

  if (!item.equipment_id) return;

  if (item.asset_id) {
    const prev: any = db.prepare('SELECT current_status FROM equipment_assets WHERE id = ?').get(item.asset_id);
    db.prepare("UPDATE equipment_assets SET current_status = 'AVAILABLE', updated_at = datetime('now') WHERE id = ?")
      .run(item.asset_id);
    db.prepare(`INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id) VALUES (?, ?, ?, ?, 'AVAILABLE', ?, ?, ?)`)
      .run(uuidv4(), item.asset_id, item.equipment_id, prev?.current_status || '', changedBy, 'Returned from loan', null);
  }
  // Availability is derived from the per-unit statuses of this equipment.
  recomputeAvailability(db, item.equipment_id);
}

// Push the post-mutation equipment_items/equipment_assets rows to the cloud so the
// shared rental catalog reflects the availability change.
function pushItemAvailabilityToCloud(db: any, equipmentId: string, assetId: string | null): void {
  const eq: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(equipmentId);
  if (eq) void pushCatalogToCloud('equipment_items', 'UPDATE', eq);
  if (assetId) {
    const a: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(assetId);
    if (a) void pushOperationalToCloud('equipment_assets', 'UPDATE', a);
  }
}

// Sync a loan and all its line items to the cloud so other privileged users see it.
// The signed release form (signed_form_data) is stripped by coerceForCloud and stays
// local. Call after any insert/update of the loan or its items.
function pushLoanToCloud(db: any, loanId: string): void {
  const loan: any = db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(loanId);
  if (!loan) return;
  void pushOperationalToCloud('equipment_loans', 'UPDATE', loan);
  const items: any[] = db.prepare('SELECT * FROM equipment_loan_items WHERE loan_id = ?').all(loanId);
  for (const it of items) void pushOperationalToCloud('equipment_loan_items', 'UPDATE', it);
}

export function registerLoanHandlers(): void {
  const db = getDatabase();

  // Loads a loan and rejects access if it belongs to another department.
  const getLoanInDept = (event: any, loanId: string): any => {
    const loan: any = db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(loanId);
    if (!loan) throw new Error('Loan not found');
    const dept = sessionDepartment(event);
    if (dept && loan.department !== dept) throw new Error('This loan belongs to another department.');
    return loan;
  };

  ipcMain.handle('db:loans:getAll', (event: any) => {
    const dept = sessionDepartment(event);
    const where = dept ? 'WHERE l.department = ?' : '';
    return db.prepare(`
      SELECT l.*,
        (SELECT COUNT(*) FROM equipment_loan_items li WHERE li.loan_id = l.id) as item_count,
        (SELECT COUNT(*) FROM equipment_loan_items li WHERE li.loan_id = l.id AND li.status = 'OUT') as out_count,
        (SELECT GROUP_CONCAT(COALESCE(e.name, li.item_name), ', ')
           FROM equipment_loan_items li
           LEFT JOIN equipment_items e ON e.id = li.equipment_id
           WHERE li.loan_id = l.id) as equipment_names
      FROM equipment_loans l
      ${where}
      ORDER BY
        CASE l.status WHEN 'ACTIVE' THEN 0 WHEN 'PARTIAL' THEN 1 ELSE 2 END,
        l.loaned_date DESC, l.created_at DESC
    `).all(...(dept ? [dept] : []));
  });

  ipcMain.handle('db:loans:getById', (event: any, id: string) => {
    const loan: any = db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(id);
    if (!loan) return null;
    const dept = sessionDepartment(event);
    if (dept && loan.department !== dept) return null;
    const items: any[] = db.prepare(`
      SELECT li.*,
        COALESCE(e.name, li.item_name) as equipment_name,
        e.equipment_code,
        c.name as category_name
      FROM equipment_loan_items li
      LEFT JOIN equipment_items e ON e.id = li.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE li.loan_id = ?
      ORDER BY li.created_at ASC
    `).all(id);
    // Detail view may display/re-upload the form, so hand back a real data URL.
    return { ...loan, signed_form_data: resolveBlob(loan.signed_form_data), items };
  });

  ipcMain.handle('db:loans:create', (event: any, data: unknown) => {
    const user = requireWriteAccess(event);
    const input = LoanCreateSchema.parse(data);
    const sessDept = sessionDepartment(event);
    if (sessDept && input.department !== sessDept) {
      throw new Error('You can only create loans for your own department.');
    }
    const isOutward = input.direction === 'OUTWARD';
    // Outward loans draw from our catalog, so each item must be a department-owned equipment.
    if (isOutward) {
      for (const item of input.items) assertEquipmentInDepartment(db, event, item.equipment_id as string);
    }
    const id = uuidv4();
    const loanNumber = generateLoanNumber(db, input.department, input.direction);
    const now = new Date().toISOString();

    const affected: { equipment_id: string; asset_id: string | null }[] = [];
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO equipment_loans (id, loan_number, direction, department, person_or_org, purpose, location, loaned_date, duration, tentative_return_date, remarks, internal_notes, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      `).run(id, loanNumber, input.direction, input.department, input.person_or_org, input.purpose || '', input.location || '',
        input.loaned_date, input.duration || '', input.tentative_return_date || null, input.remarks || '', input.internal_notes || '',
        user.full_name, now, now);

      // Track units already claimed in this loan so the same equipment added twice
      // draws two distinct units instead of double-booking one.
      const claimed: string[] = [];
      for (const item of input.items) {
        const itemId = uuidv4();

        if (!isOutward) {
          // Inward item: external equipment, recorded by free-text name, no inventory impact.
          db.prepare(`INSERT INTO equipment_loan_items (id, loan_id, equipment_id, asset_id, item_name, status, notes, created_at) VALUES (?, ?, NULL, NULL, ?, 'OUT', ?, ?)`)
            .run(itemId, id, (item.item_name || '').trim(), item.notes || null, now);
          continue;
        }

        const asset: any = pickAvailableAsset(db, item.equipment_id as string, claimed);
        if (asset) claimed.push(asset.id);
        db.prepare(`INSERT INTO equipment_loan_items (id, loan_id, equipment_id, asset_id, item_name, status, notes, created_at) VALUES (?, ?, ?, ?, NULL, 'OUT', ?, ?)`)
          .run(itemId, id, item.equipment_id, asset?.id || null, item.notes || null, now);

        if (asset) {
          db.prepare("UPDATE equipment_assets SET current_status = 'DEPLOYED', updated_at = datetime('now') WHERE id = ?").run(asset.id);
          db.prepare(`INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id) VALUES (?, ?, ?, ?, 'DEPLOYED', ?, ?, ?)`)
            .run(uuidv4(), asset.id, item.equipment_id, asset.current_status || '', user.full_name, `Loaned out (${loanNumber})`, null);
        }
        // Each loaned unit reduces availability by one (derived from per-unit statuses).
        recomputeAvailability(db, item.equipment_id as string);
        affected.push({ equipment_id: item.equipment_id as string, asset_id: asset?.id || null });
      }
    });
    tx();

    // Propagate availability/asset changes to the shared catalog after the transaction commits.
    // Inward loans never touch inventory, so there is nothing to sync.
    for (const a of affected) pushItemAvailabilityToCloud(db, a.equipment_id, a.asset_id);
    pushLoanToCloud(db, id);

    return db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(id);
  });

  ipcMain.handle('db:loans:update', (event: any, id: string, data: unknown) => {
    const user = requireSession(event);
    // Mirror purchase-request edit permissions: admins and equipment/inventory managers.
    if (user.role !== 'admin' && !['equipment_manager', 'inventory_manager'].includes(user.role)) {
      throw new Error('You do not have permission to edit loans.');
    }
    getLoanInDept(event, id);
    const input = LoanUpdateSchema.parse(data);
    db.prepare(`
      UPDATE equipment_loans
      SET person_or_org = ?, purpose = ?, location = ?, loaned_date = ?, duration = ?,
          tentative_return_date = ?, remarks = ?, internal_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.person_or_org, input.purpose || '', input.location || '', input.loaned_date,
      input.duration || '', input.tentative_return_date || null, input.remarks || '', input.internal_notes || '', id,
    );
    pushLoanToCloud(db, id);
    return db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(id);
  });

  // Whether returning `itemIds` would leave no OUT items, i.e. close the loan.
  const wouldCloseLoan = (loanId: string, itemIds: string[]): boolean => {
    const currentOut: any = db.prepare(
      "SELECT COUNT(*) as c FROM equipment_loan_items WHERE loan_id = ? AND status = 'OUT'",
    ).get(loanId);
    if ((currentOut?.c || 0) === 0) return false;
    if (itemIds.length === 0) return false;
    const placeholders = itemIds.map(() => '?').join(',');
    const remaining: any = db.prepare(
      `SELECT COUNT(*) as c FROM equipment_loan_items WHERE loan_id = ? AND status = 'OUT' AND id NOT IN (${placeholders})`,
    ).get(loanId, ...itemIds);
    return (remaining?.c || 0) === 0;
  };

  // An OUTWARD loan can only be closed once its signed release form is on file.
  const assertSignedFormBeforeClose = (loan: any): void => {
    if (loan.direction === 'OUTWARD' && !loan.signed_form_data) {
      throw new Error('Upload the signed release form before closing this loan.');
    }
  };

  ipcMain.handle('db:loans:uploadSignedForm', (event: any, id: string, dataUrl: unknown) => {
    requireWriteAccess(event);
    const existing = getLoanInDept(event, id);
    const parsed = AttachmentDataSchema.parse(dataUrl);
    const pointer = saveBlob(parsed);
    db.prepare("UPDATE equipment_loans SET signed_form_data = ?, updated_at = datetime('now') WHERE id = ?").run(pointer, id);
    deleteBlob(existing?.signed_form_data);
    // The form blob itself stays local (stripped on push), but sync the bumped
    // updated_at so this machine's clock stays ahead of other edits in the cloud.
    pushLoanToCloud(db, id);
    return { success: true };
  });

  ipcMain.handle('db:loans:clearSignedForm', (event: any, id: string) => {
    requireWriteAccess(event);
    const existing = getLoanInDept(event, id);
    db.prepare("UPDATE equipment_loans SET signed_form_data = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
    deleteBlob(existing?.signed_form_data);
    pushLoanToCloud(db, id);
    return { success: true };
  });

  ipcMain.handle('db:loans:returnItems', (event: any, loanId: string, data: unknown) => {
    const user = requireWriteAccess(event);
    const loan = getLoanInDept(event, loanId);
    const input = LoanReturnSchema.parse(data);

    if (wouldCloseLoan(loanId, input.item_ids)) assertSignedFormBeforeClose(loan);

    const affected: { equipment_id: string; asset_id: string | null }[] = [];
    const tx = db.transaction(() => {
      for (const itemId of input.item_ids) {
        const item: any = db.prepare("SELECT * FROM equipment_loan_items WHERE id = ? AND loan_id = ? AND status = 'OUT'").get(itemId, loanId);
        if (!item) continue;
        returnSingleItem(db, item, user.full_name);
        affected.push({ equipment_id: item.equipment_id, asset_id: item.asset_id });
      }
      recomputeLoanStatus(db, loanId);
    });
    tx();

    for (const a of affected) pushItemAvailabilityToCloud(db, a.equipment_id, a.asset_id);
    pushLoanToCloud(db, loanId);
    maybeArchiveReturnedLoan(db, loanId);
    return { success: true };
  });

  ipcMain.handle('db:loans:returnOrder', (event: any, loanId: string) => {
    const user = requireWriteAccess(event);
    const loan = getLoanInDept(event, loanId);

    // Returning all items closes the loan, so the signed form must already be on file.
    const outCount: any = db.prepare(
      "SELECT COUNT(*) as c FROM equipment_loan_items WHERE loan_id = ? AND status = 'OUT'",
    ).get(loanId);
    if ((outCount?.c || 0) > 0) assertSignedFormBeforeClose(loan);

    const affected: { equipment_id: string; asset_id: string | null }[] = [];
    const tx = db.transaction(() => {
      const outItems: any[] = db.prepare("SELECT * FROM equipment_loan_items WHERE loan_id = ? AND status = 'OUT'").all(loanId);
      for (const item of outItems) {
        returnSingleItem(db, item, user.full_name);
        affected.push({ equipment_id: item.equipment_id, asset_id: item.asset_id });
      }
      recomputeLoanStatus(db, loanId);
    });
    tx();

    for (const a of affected) pushItemAvailabilityToCloud(db, a.equipment_id, a.asset_id);
    pushLoanToCloud(db, loanId);
    maybeArchiveReturnedLoan(db, loanId);
    return { success: true };
  });

  ipcMain.handle('db:loans:delete', (event: any, id: string) => {
    const user = requireSession(event);
    if (user.role !== 'admin') throw new Error('Only admins can delete loans');
    const existing = getLoanInDept(event, id);

    const affected: { equipment_id: string; asset_id: string | null }[] = [];
    const tx = db.transaction(() => {
      // Restore availability for any units still out before removing the record.
      const outItems: any[] = db.prepare("SELECT * FROM equipment_loan_items WHERE loan_id = ? AND status = 'OUT'").all(id);
      for (const item of outItems) {
        returnSingleItem(db, item, user.full_name);
        affected.push({ equipment_id: item.equipment_id, asset_id: item.asset_id });
      }
      db.prepare('DELETE FROM equipment_loan_items WHERE loan_id = ?').run(id);
      db.prepare('DELETE FROM equipment_loans WHERE id = ?').run(id);
    });
    tx();

    deleteBlob(existing?.signed_form_data);
    for (const a of affected) pushItemAvailabilityToCloud(db, a.equipment_id, a.asset_id);
    // Propagate the delete; item rows cascade-delete via the Supabase foreign key.
    void pushOperationalToCloud('equipment_loans', 'DELETE', { id });
    return { success: true };
  });
}
