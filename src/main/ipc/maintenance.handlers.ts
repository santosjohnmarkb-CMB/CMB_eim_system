import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession } from './session';
import { MaintenanceTicketCreateSchema, MaintenanceTicketUpdateSchema, MaintenanceNoteSchema, TicketActionSchema, TicketActionUpdateSchema } from '../../shared/schemas';
import { pushOperationalToCloud } from '../sync/operational-sync';

function generateTicketNumber(db: any, documentType: 'maintenance' | 'repair' = 'repair'): string {
  const year = new Date().getFullYear();
  const tag = documentType === 'maintenance' ? 'MNT' : 'RPR';
  const prefix = `${tag}-${year}-`;
  const last: any = db.prepare(`SELECT ticket_number FROM maintenance_tickets WHERE ticket_number LIKE ? ORDER BY ticket_number DESC LIMIT 1`).get(`${prefix}%`);
  let seq = 1;
  if (last) { seq = parseInt(last.ticket_number.replace(prefix, ''), 10) + 1; }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function registerMaintenanceHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('db:maintenance:getAll', () => {
    return db.prepare(`
      SELECT mt.*, e.name as equipment_name, e.equipment_code, e.category_id,
        c.name as category_name,
        (SELECT COUNT(*) FROM maintenance_notes mn WHERE mn.ticket_id = mt.id) as notes_count,
        ta.action_date as last_action_date,
        ta.action_taken as last_action_taken,
        ta.personnel as last_action_personnel
      FROM maintenance_tickets mt
      JOIN equipment_items e ON e.id = mt.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN ticket_actions ta ON ta.id = (
        SELECT ta2.id FROM ticket_actions ta2
        WHERE ta2.ticket_id = mt.id
        ORDER BY ta2.action_date DESC, ta2.created_at DESC LIMIT 1
      )
      ORDER BY
        CASE mt.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        mt.created_at DESC
    `).all();
  });

  ipcMain.handle('db:maintenance:getById', (_e: any, id: string) => {
    return db.prepare(`
      SELECT mt.*, e.name as equipment_name, e.equipment_code
      FROM maintenance_tickets mt
      JOIN equipment_items e ON e.id = mt.equipment_id
      WHERE mt.id = ?
    `).get(id);
  });

  ipcMain.handle('db:maintenance:create', (event: any, data: unknown) => {
    const user = requireSession(event);
    const input = MaintenanceTicketCreateSchema.parse(data);
    const id = uuidv4();
    const docType = input.document_type || 'repair';
    const ticketNumber = generateTicketNumber(db, docType);
    const now = new Date().toISOString();
    const asset: any = db.prepare('SELECT id FROM equipment_assets WHERE equipment_id = ?').get(input.equipment_id);

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO maintenance_tickets (id, ticket_number, equipment_id, asset_id, reported_by, reported_date, issue_description, severity, repair_status, maintenance_type, project_name, production_name, project_date, verified_by, document_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ticketNumber, input.equipment_id, asset?.id || null, input.reported_by, now,
        input.issue_description, input.severity, input.maintenance_type,
        input.project_name || null, input.production_name || null,
        input.project_date || null, input.verified_by || null, docType, now, now);

      // Auto-decrement available_qty
      db.prepare("UPDATE equipment_items SET available_qty = MAX(available_qty - 1, 0), updated_at = datetime('now') WHERE id = ?")
        .run(input.equipment_id);

      if (asset) {
        db.prepare("UPDATE equipment_assets SET current_status = 'FOR_INSPECTION', updated_at = datetime('now') WHERE equipment_id = ?").run(input.equipment_id);
        db.prepare(`INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id) VALUES (?, ?, ?, (SELECT current_status FROM equipment_assets WHERE equipment_id = ?), 'FOR_INSPECTION', ?, 'Maintenance ticket created', ?)`)
          .run(uuidv4(), asset.id, input.equipment_id, input.equipment_id, user.full_name, id);
      }
    });
    tx();

    const ticket: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    void pushOperationalToCloud('maintenance_tickets', 'INSERT', ticket);
    return ticket;
  });

  ipcMain.handle('db:maintenance:update', (event: any, id: string, data: unknown) => {
    requireSession(event);
    const input = MaintenanceTicketUpdateSchema.parse(data);
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) { fields.push(`${key} = ?`); values.push(value); }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE maintenance_tickets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const ticket: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    void pushOperationalToCloud('maintenance_tickets', 'UPDATE', ticket);
    return ticket;
  });

  ipcMain.handle('db:maintenance:updateStatus', (event: any, id: string, newStatus: string) => {
    const user = requireSession(event);
    const ticket: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error('Ticket not found');

    const tx = db.transaction(() => {
      const updates: string[] = [`repair_status = ?`, "updated_at = datetime('now')"];
      const vals: any[] = [newStatus];
      if (newStatus === 'COMPLETED') { updates.push('completion_date = ?'); vals.push(new Date().toISOString()); }
      vals.push(id);
      db.prepare(`UPDATE maintenance_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

      db.prepare(`INSERT INTO maintenance_notes (id, ticket_id, author, note_text, note_type) VALUES (?, ?, ?, ?, 'status_change')`)
        .run(uuidv4(), id, user.full_name, `Status changed from ${ticket.repair_status} to ${newStatus}`);

      // Auto-increment available_qty when ticket is completed or cancelled
      if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
        db.prepare("UPDATE equipment_items SET available_qty = MIN(available_qty + 1, quantity), updated_at = datetime('now') WHERE id = ?")
          .run(ticket.equipment_id);
      }

      if (newStatus === 'COMPLETED' && ticket.asset_id) {
        const grade = ticket.post_repair_grade || 'B';
        db.prepare("UPDATE equipment_assets SET current_status = 'AVAILABLE', condition_grade = ?, updated_at = datetime('now') WHERE id = ?")
          .run(grade, ticket.asset_id);
        db.prepare(`INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id) VALUES (?, ?, ?, 'IN_REPAIR', 'AVAILABLE', ?, 'Repair completed', ?)`)
          .run(uuidv4(), ticket.asset_id, ticket.equipment_id, user.full_name, id);
      } else if (newStatus === 'IN_PROGRESS' && ticket.asset_id) {
        db.prepare("UPDATE equipment_assets SET current_status = 'IN_REPAIR', updated_at = datetime('now') WHERE id = ?").run(ticket.asset_id);
      }
    });
    tx();

    const updated: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    void pushOperationalToCloud('maintenance_tickets', 'UPDATE', updated);
    return { success: true };
  });

  ipcMain.handle('db:maintenance:addNote', (event: any, data: unknown) => {
    requireSession(event);
    const input = MaintenanceNoteSchema.parse(data);
    const id = uuidv4();
    db.prepare(`INSERT INTO maintenance_notes (id, ticket_id, author, note_text, note_type) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.ticket_id, input.author, input.note_text, input.note_type);
    const note: any = db.prepare('SELECT * FROM maintenance_notes WHERE id = ?').get(id);
    void pushOperationalToCloud('maintenance_notes', 'INSERT', note);
    return note;
  });

  ipcMain.handle('db:maintenance:getNotes', (_e: any, ticketId: string) => {
    return db.prepare('SELECT * FROM maintenance_notes WHERE ticket_id = ? ORDER BY created_at DESC').all(ticketId);
  });

  ipcMain.handle('db:maintenance:consumeParts', (event: any, ticketId: string, parts: { part_id: string; qty: number }[]) => {
    const user = requireSession(event);
    const tx = db.transaction(() => {
      let totalCost = 0;
      for (const part of parts) {
        const catalogItem: any = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(part.part_id);
        if (!catalogItem) continue;
        db.prepare("UPDATE parts_inventory SET qty_on_hand = qty_on_hand - ?, updated_at = datetime('now') WHERE part_id = ?").run(part.qty, part.part_id);
        db.prepare(`INSERT INTO parts_transactions (id, part_id, transaction_type, quantity, reference_type, reference_id, performed_by, notes) VALUES (?, ?, 'consume', ?, 'maintenance_ticket', ?, ?, ?)`)
          .run(uuidv4(), part.part_id, -part.qty, ticketId, user.full_name, `Consumed for ticket`);
        totalCost += catalogItem.unit_cost * part.qty;
      }
      db.prepare("UPDATE maintenance_tickets SET actual_cost = actual_cost + ?, parts_consumed = ?, updated_at = datetime('now') WHERE id = ?")
        .run(totalCost, JSON.stringify(parts), ticketId);
    });
    tx();
    return { success: true };
  });

  ipcMain.handle('db:maintenance:getSchedules', () => {
    return db.prepare(`
      SELECT ps.*, e.name as equipment_name, e.equipment_code
      FROM preventive_schedules ps
      JOIN equipment_items e ON e.id = ps.equipment_id
      WHERE ps.is_active = 1
      ORDER BY ps.next_due_date
    `).all();
  });

  ipcMain.handle('db:maintenance:createSchedule', (event: any, data: unknown) => {
    requireSession(event);
    const id = uuidv4();
    const input = data as any;
    const now = new Date().toISOString();
    const asset: any = db.prepare('SELECT id FROM equipment_assets WHERE equipment_id = ?').get(input.equipment_id);
    db.prepare(`INSERT INTO preventive_schedules (id, equipment_id, asset_id, schedule_type, interval_days, interval_rentals, description, next_due_date, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, input.equipment_id, asset?.id || null, input.schedule_type || 'calendar', input.interval_days || null, input.interval_rentals || null, input.description || '', input.next_due_date || null, now, now);
    return db.prepare('SELECT * FROM preventive_schedules WHERE id = ?').get(id);
  });

  ipcMain.handle('db:maintenance:updateSchedule', (event: any, id: string, data: any) => {
    requireSession(event);
    const fields: string[] = [];
    const values: any[] = [];
    for (const key of ['schedule_type', 'interval_days', 'interval_rentals', 'description', 'next_due_date', 'is_active']) {
      if (data[key] !== undefined) { fields.push(`${key} = ?`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE preventive_schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return db.prepare('SELECT * FROM preventive_schedules WHERE id = ?').get(id);
  });

  ipcMain.handle('db:maintenance:deleteSchedule', (event: any, id: string) => {
    requireSession(event);
    db.prepare("UPDATE preventive_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  // ── Ticket Actions CRUD ──

  ipcMain.handle('db:maintenance:getActions', (_e: any, ticketId: string) => {
    return db.prepare('SELECT * FROM ticket_actions WHERE ticket_id = ? ORDER BY action_date ASC, created_at ASC').all(ticketId);
  });

  ipcMain.handle('db:maintenance:addAction', (event: any, data: unknown) => {
    requireSession(event);
    const input = TicketActionSchema.parse(data);
    const id = uuidv4();
    db.prepare(`INSERT INTO ticket_actions (id, ticket_id, action_date, action_taken, remarks, personnel) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, input.ticket_id, input.action_date, input.action_taken, input.remarks, input.personnel);
    const action: any = db.prepare('SELECT * FROM ticket_actions WHERE id = ?').get(id);
    void pushOperationalToCloud('ticket_actions', 'INSERT', action);
    return action;
  });

  ipcMain.handle('db:maintenance:updateAction', (event: any, id: string, data: unknown) => {
    requireSession(event);
    const input = TicketActionUpdateSchema.parse(data);
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) { fields.push(`${key} = ?`); values.push(value); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    db.prepare(`UPDATE ticket_actions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const action: any = db.prepare('SELECT * FROM ticket_actions WHERE id = ?').get(id);
    void pushOperationalToCloud('ticket_actions', 'UPDATE', action);
    return action;
  });

  ipcMain.handle('db:maintenance:deleteAction', (event: any, id: string) => {
    requireSession(event);
    db.prepare('DELETE FROM ticket_actions WHERE id = ?').run(id);
    return { success: true };
  });
}
