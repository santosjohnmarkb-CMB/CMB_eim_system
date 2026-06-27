import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession, requireWriteAccess } from './session';
import { PurchaseRequestCreateSchema, PurchaseRequestUpdateSchema, AttachmentDataSchema } from '../../shared/schemas';
import { PURCHASE_REQUEST_DEPT_PREFIX } from '../../shared/constants';
import { sessionDepartment } from './department';
import { archivePurchaseRequest } from '../sync/archive-eim';
import { pushOperationalToCloud } from '../sync/operational-sync';

// Sync a request and all its line items to the cloud so other privileged users see it.
// The requested-equipment photo (photo_data) syncs as part of the row; only the
// purchase invoice (invoice_data) is stripped by coerceForCloud and stays local.
// Call after any insert/update of the request or items.
function pushRequestToCloud(db: any, requestId: string): void {
  const request: any = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(requestId);
  if (!request) return;
  void pushOperationalToCloud('purchase_requests', 'UPDATE', request);
  const items: any[] = db.prepare('SELECT * FROM purchase_request_items WHERE request_id = ?').all(requestId);
  for (const it of items) void pushOperationalToCloud('purchase_request_items', 'UPDATE', it);
}

// Build a sequential request number: CMB-PR-{deptCode}-{mmddyy}-{seq}.
function generateRequestNumber(db: any, department: 'camera' | 'lights_grips'): string {
  const deptCode = PURCHASE_REQUEST_DEPT_PREFIX[department] || 'CD';
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `CMB-PR-${deptCode}-${mm}${dd}${yy}-`;
  const last: any = db
    .prepare('SELECT request_number FROM purchase_requests WHERE request_number LIKE ? ORDER BY request_number DESC LIMIT 1')
    .get(`${prefix}%`);
  let seq = 1;
  if (last) {
    const parts = last.request_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export function registerPurchaseRequestHandlers(): void {
  const db = getDatabase();

  // Loads a request and rejects access if it belongs to another department.
  const getRequestInDept = (event: any, id: string): any => {
    const request: any = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
    if (!request) throw new Error('Purchase request not found');
    const dept = sessionDepartment(event);
    if (dept && request.department !== dept) throw new Error('This request belongs to another department.');
    return request;
  };

  // Inserts the line items for a request and mirrors the first item onto the parent
  // row so single-item displays, list columns, and legacy code keep working.
  const insertItems = (requestId: string, items: any[]): void => {
    items.forEach((item, idx) => {
      db.prepare(`
        INSERT INTO purchase_request_items (
          id, request_id, requested_asset, request_type, current_quantity,
          requested_quantity, supplier, amount, photo_data, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        uuidv4(), requestId, item.requested_asset, item.request_type, item.current_quantity,
        item.requested_quantity, item.supplier, item.amount, item.photo_data ?? null, idx,
      );
    });
  };

  // Returns the column values that the parent row mirrors from the first line item.
  const firstItemMirror = (items: any[]) => {
    const first = items[0];
    return [
      first.requested_asset, first.request_type, first.current_quantity,
      first.requested_quantity, first.supplier, first.amount, first.photo_data ?? null,
    ];
  };

  ipcMain.handle('db:purchaseRequests:getAll', (event: any) => {
    const dept = sessionDepartment(event);
    const where = dept ? 'WHERE department = ?' : '';
    return db
      .prepare(`
        SELECT *,
          (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = purchase_requests.id) AS item_count,
          (SELECT COALESCE(SUM(i.amount * i.requested_quantity), 0) FROM purchase_request_items i WHERE i.request_id = purchase_requests.id) AS total_amount
        FROM purchase_requests
        ${where}
        ORDER BY
          CASE status WHEN 'PENDING' THEN 0 WHEN 'FULFILLED' THEN 1 ELSE 2 END,
          request_date DESC, created_at DESC
      `)
      .all(...(dept ? [dept] : []));
  });

  ipcMain.handle('db:purchaseRequests:getById', (event: any, id: string) => {
    const request: any = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
    if (!request) return null;
    const dept = sessionDepartment(event);
    if (dept && request.department !== dept) return null;
    const items = db
      .prepare('SELECT * FROM purchase_request_items WHERE request_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(id);
    return { ...request, items };
  });

  ipcMain.handle('db:purchaseRequests:create', (event: any, data: unknown) => {
    const user = requireWriteAccess(event);
    const input = PurchaseRequestCreateSchema.parse(data);
    const sessDept = sessionDepartment(event);
    if (sessDept && input.department !== sessDept) {
      throw new Error('You can only create purchase requests for your own department.');
    }
    const id = uuidv4();
    const requestNumber = generateRequestNumber(db, input.department);
    const now = new Date().toISOString();
    const [reqAsset, reqType, curQty, reqQty, supplier, amount, photo] = firstItemMirror(input.items);

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_requests (
          id, request_number, department, request_date, requested_asset, request_type,
          current_quantity, requested_quantity, reason, supplier, amount, photo_data, status,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
      `).run(
        id, requestNumber, input.department, input.request_date, reqAsset, reqType,
        curQty, reqQty, input.reason, supplier, amount, photo, user.full_name, now, now,
      );
      insertItems(id, input.items);
    });
    tx();

    const request: any = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
    const items = db.prepare('SELECT * FROM purchase_request_items WHERE request_id = ? ORDER BY sort_order ASC').all(id);
    pushRequestToCloud(db, id);
    return { ...request, items };
  });

  ipcMain.handle('db:purchaseRequests:update', (event: any, id: string, data: unknown) => {
    const user = requireSession(event);
    const request = getRequestInDept(event, id);
    if (user.role !== 'admin' && !['equipment_manager', 'inventory_manager'].includes(user.role)) {
      throw new Error('You do not have permission to edit purchase requests.');
    }
    if (request.status !== 'PENDING') {
      throw new Error('Only pending requests can be edited.');
    }
    const input = PurchaseRequestUpdateSchema.parse(data);
    const [reqAsset, reqType, curQty, reqQty, supplier, amount, photo] = firstItemMirror(input.items);

    // The edit replaces the whole line-item set with freshly-generated ids. Capture the
    // old ids so we can tell the cloud to delete the rows that no longer exist locally —
    // the additive full-reconcile never deletes on its own, so without this the replaced
    // items would linger in the cloud and resurrect on the next pull.
    const oldItemIds: string[] = db
      .prepare('SELECT id FROM purchase_request_items WHERE request_id = ?')
      .all(id)
      .map((r: any) => r.id);

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE purchase_requests
        SET request_date = ?, requested_asset = ?, request_type = ?, current_quantity = ?,
            requested_quantity = ?, reason = ?, supplier = ?, amount = ?, photo_data = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        input.request_date, reqAsset, reqType, curQty, reqQty, input.reason, supplier, amount, photo, id,
      );
      // Replace the full line-item set: simplest correct approach for an edit.
      db.prepare('DELETE FROM purchase_request_items WHERE request_id = ?').run(id);
      insertItems(id, input.items);
    });
    tx();

    const updated: any = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
    const items = db.prepare('SELECT * FROM purchase_request_items WHERE request_id = ? ORDER BY sort_order ASC').all(id);
    const newItemIds = new Set(items.map((r: any) => r.id));
    for (const oldId of oldItemIds) {
      if (!newItemIds.has(oldId)) void pushOperationalToCloud('purchase_request_items', 'DELETE', { id: oldId });
    }
    pushRequestToCloud(db, id);
    return { ...updated, items };
  });

  // Attach the purchase invoice / receipt (image or PDF) required before fulfillment.
  // Editors (admin or managers) may upload, mirroring the edit permission.
  ipcMain.handle('db:purchaseRequests:uploadInvoice', (event: any, id: string, dataUrl: unknown) => {
    const user = requireSession(event);
    getRequestInDept(event, id);
    if (user.role !== 'admin' && !['equipment_manager', 'inventory_manager'].includes(user.role)) {
      throw new Error('You do not have permission to upload an invoice.');
    }
    const parsed = AttachmentDataSchema.parse(dataUrl);
    db.prepare("UPDATE purchase_requests SET invoice_data = ?, updated_at = datetime('now') WHERE id = ?").run(parsed, id);
    // The invoice blob itself stays local (stripped on push); sync the bumped updated_at.
    pushRequestToCloud(db, id);
    return { success: true };
  });

  ipcMain.handle('db:purchaseRequests:clearInvoice', (event: any, id: string) => {
    const user = requireSession(event);
    getRequestInDept(event, id);
    if (user.role !== 'admin' && !['equipment_manager', 'inventory_manager'].includes(user.role)) {
      throw new Error('You do not have permission to remove an invoice.');
    }
    db.prepare("UPDATE purchase_requests SET invoice_data = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
    pushRequestToCloud(db, id);
    return { success: true };
  });

  // Mark a request fulfilled (admin only): moves it to the completed list.
  ipcMain.handle('db:purchaseRequests:fulfill', (event: any, id: string) => {
    const user = requireSession(event);
    if (user.role !== 'admin') throw new Error('Only admins can mark a request as fulfilled.');
    const request = getRequestInDept(event, id);
    if (!request.invoice_data) {
      throw new Error('Upload the purchase invoice before marking this request fulfilled.');
    }
    db.prepare(`
      UPDATE purchase_requests
      SET status = 'FULFILLED', fulfilled_at = ?, fulfilled_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(new Date().toISOString(), user.full_name, id);
    pushRequestToCloud(db, id);
    // Auto-archive the fulfilled request's document to Google Drive (fire-and-forget;
    // never blocks or fails the fulfillment action).
    void archivePurchaseRequest(id);
    return db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
  });

  // Cancel a pending request (manager or admin).
  ipcMain.handle('db:purchaseRequests:cancel', (event: any, id: string) => {
    const user = requireSession(event);
    const request = getRequestInDept(event, id);
    if (user.role !== 'admin' && !['equipment_manager', 'inventory_manager'].includes(user.role)) {
      throw new Error('You do not have permission to cancel purchase requests.');
    }
    if (request.status === 'FULFILLED') throw new Error('Fulfilled requests cannot be cancelled.');
    db.prepare("UPDATE purchase_requests SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?").run(id);
    pushRequestToCloud(db, id);
    return db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
  });

  ipcMain.handle('db:purchaseRequests:delete', (event: any, id: string) => {
    const user = requireSession(event);
    if (user.role !== 'admin') throw new Error('Only admins can delete purchase requests.');
    getRequestInDept(event, id);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM purchase_request_items WHERE request_id = ?').run(id);
      db.prepare('DELETE FROM purchase_requests WHERE id = ?').run(id);
    });
    tx();
    // Propagate the delete; item rows cascade-delete via the Supabase foreign key.
    void pushOperationalToCloud('purchase_requests', 'DELETE', { id });
    return { success: true };
  });
}
