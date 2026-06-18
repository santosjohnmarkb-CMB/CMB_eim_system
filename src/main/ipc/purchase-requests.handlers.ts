import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession } from './session';
import { PurchaseRequestCreateSchema, PurchaseRequestUpdateSchema } from '../../shared/schemas';
import { PURCHASE_REQUEST_DEPT_PREFIX } from '../../shared/constants';
import { sessionDepartment } from './department';

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

  ipcMain.handle('db:purchaseRequests:getAll', (event: any) => {
    const dept = sessionDepartment(event);
    const where = dept ? 'WHERE department = ?' : '';
    return db
      .prepare(`
        SELECT * FROM purchase_requests
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
    return request;
  });

  ipcMain.handle('db:purchaseRequests:create', (event: any, data: unknown) => {
    const user = requireSession(event);
    const input = PurchaseRequestCreateSchema.parse(data);
    const sessDept = sessionDepartment(event);
    if (sessDept && input.department !== sessDept) {
      throw new Error('You can only create purchase requests for your own department.');
    }
    const id = uuidv4();
    const requestNumber = generateRequestNumber(db, input.department);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO purchase_requests (
        id, request_number, department, request_date, requested_asset, request_type,
        current_quantity, requested_quantity, reason, supplier, amount, status,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(
      id, requestNumber, input.department, input.request_date, input.requested_asset, input.request_type,
      input.current_quantity, input.requested_quantity, input.reason, input.supplier, input.amount,
      user.full_name, now, now,
    );
    return db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
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
    db.prepare(`
      UPDATE purchase_requests
      SET request_date = ?, requested_asset = ?, request_type = ?, current_quantity = ?,
          requested_quantity = ?, reason = ?, supplier = ?, amount = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.request_date, input.requested_asset, input.request_type, input.current_quantity,
      input.requested_quantity, input.reason, input.supplier, input.amount, id,
    );
    return db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
  });

  // Mark a request fulfilled (admin only): moves it to the completed list.
  ipcMain.handle('db:purchaseRequests:fulfill', (event: any, id: string) => {
    const user = requireSession(event);
    if (user.role !== 'admin') throw new Error('Only admins can mark a request as fulfilled.');
    getRequestInDept(event, id);
    db.prepare(`
      UPDATE purchase_requests
      SET status = 'FULFILLED', fulfilled_at = ?, fulfilled_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(new Date().toISOString(), user.full_name, id);
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
    return db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
  });

  ipcMain.handle('db:purchaseRequests:delete', (event: any, id: string) => {
    const user = requireSession(event);
    if (user.role !== 'admin') throw new Error('Only admins can delete purchase requests.');
    getRequestInDept(event, id);
    db.prepare('DELETE FROM purchase_requests WHERE id = ?').run(id);
    return { success: true };
  });
}
