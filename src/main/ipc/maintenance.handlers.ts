import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireSession, requireWriteAccess } from './session';
import { MaintenanceTicketCreateSchema, MaintenanceTicketUpdateSchema, MaintenanceNoteSchema, TicketActionSchema, TicketActionUpdateSchema, AttachmentDataSchema } from '../../shared/schemas';
import { pushOperationalToCloud } from '../sync/operational-sync';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { sessionDepartment, categoriesForDepartment, departmentForCategory, assertEquipmentInDepartment } from './department';
import { recomputeAvailability, pickAvailableAsset } from './availability';
import { archiveMaintenanceTicket } from '../sync/archive-eim';

const DEPT_PREFIX: Record<string, string> = {
  'Camera': 'CD',
  'Lights and Grips': 'LG',
  'Dollies Mounts & Cranes': 'LG',
  'Special Equipment': 'LG',
};

const MTYPE_CODE: Record<string, string> = {
  update: 'UP',
  routine_maintenance: 'RM',
  repair: 'RPR',
  corrective: 'RPR',
  preventive: 'RM',
  predictive: 'RM',
};

function generateTicketNumber(db: any, equipmentId: string, maintenanceType: string): string {
  const eq: any = db.prepare(`
    SELECT c.name as category_name FROM equipment_items e
    JOIN categories c ON c.id = e.category_id
    WHERE e.id = ?
  `).get(equipmentId);

  const deptCode = (eq && DEPT_PREFIX[eq.category_name]) || 'CD';
  const typeCode = MTYPE_CODE[maintenanceType] || 'RPR';
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const dateStr = `${mm}${dd}${yy}`;

  const prefix = `CMB-${deptCode}-${typeCode}-${dateStr}-`;
  const last: any = db.prepare(`SELECT ticket_number FROM maintenance_tickets WHERE ticket_number LIKE ? ORDER BY ticket_number DESC LIMIT 1`).get(`${prefix}%`);
  let seq = 1;
  if (last) {
    const parts = last.ticket_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export function registerMaintenanceHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('db:maintenance:getAll', (event: any) => {
    const cats = categoriesForDepartment(sessionDepartment(event));
    const catWhere = cats ? `WHERE c.name IN (${cats.map(() => '?').join(', ')})` : '';
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
      ${catWhere}
      ORDER BY
        CASE mt.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        mt.created_at DESC
    `).all(...(cats || []));
  });

  ipcMain.handle('db:maintenance:getById', (event: any, id: string) => {
    const row: any = db.prepare(`
      SELECT mt.*, e.name as equipment_name, e.equipment_code, c.name as category_name
      FROM maintenance_tickets mt
      JOIN equipment_items e ON e.id = mt.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE mt.id = ?
    `).get(id);
    if (!row) return null;
    const dept = sessionDepartment(event);
    if (dept && departmentForCategory(row.category_name) !== dept) return null;
    return row;
  });

  ipcMain.handle('db:maintenance:create', (event: any, data: unknown) => {
    const user = requireWriteAccess(event);
    const input = MaintenanceTicketCreateSchema.parse(data);
    assertEquipmentInDepartment(db, event, input.equipment_id);
    const id = uuidv4();
    const docType = input.document_type || 'repair';
    const ticketNumber = generateTicketNumber(db, input.equipment_id, input.maintenance_type);
    const now = new Date().toISOString();
    // Opening a ticket is strictly dependent on availability: it takes one AVAILABLE
    // unit out of service. A ticket cannot be opened for a unit that is deployed,
    // already under maintenance, retired, or missing.
    let asset: any;
    if (input.asset_id) {
      asset = db.prepare('SELECT id, current_status FROM equipment_assets WHERE id = ? AND equipment_id = ?').get(input.asset_id, input.equipment_id);
      if (!asset) throw new Error('Selected unit was not found for this equipment.');
      if (asset.current_status !== 'AVAILABLE') {
        throw new Error('That unit is not available. A ticket can only be opened for an available unit.');
      }
    } else {
      asset = pickAvailableAsset(db, input.equipment_id);
      if (!asset) {
        throw new Error('No available unit for this equipment. A ticket can only be opened when at least one unit is available.');
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO maintenance_tickets (id, ticket_number, equipment_id, asset_id, reported_by, reported_date, issue_description, severity, repair_status, maintenance_type, project_name, production_name, project_date, verified_by, document_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ticketNumber, input.equipment_id, asset?.id || null, input.reported_by, now,
        input.issue_description, input.severity, input.maintenance_type,
        input.project_name || null, input.production_name || null,
        input.project_date || null, input.verified_by || null, docType, now, now);

      if (asset) {
        // Capture the prior status before mutating it (log first, then update).
        const prev: any = db.prepare('SELECT current_status FROM equipment_assets WHERE id = ?').get(asset.id);
        db.prepare("UPDATE equipment_assets SET current_status = 'FOR_INSPECTION', updated_at = datetime('now') WHERE id = ?").run(asset.id);
        db.prepare(`INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id) VALUES (?, ?, ?, ?, 'FOR_INSPECTION', ?, ?, ?)`)
          .run(uuidv4(), asset.id, input.equipment_id, prev?.current_status || '', user.full_name, docType === 'loss' ? 'Loss ticket created' : 'Maintenance ticket created', id);
      }
      // Availability is derived from per-unit statuses; the affected unit is now FOR_INSPECTION.
      recomputeAvailability(db, input.equipment_id);
    });
    tx();

    const ticket: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    void pushOperationalToCloud('maintenance_tickets', 'INSERT', ticket);
    // Propagate availability change to the shared catalog (and asset) for the rental system.
    const eqItem: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(input.equipment_id);
    if (eqItem) void pushCatalogToCloud('equipment_items', 'UPDATE', eqItem);
    if (asset) {
      const a: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(asset.id);
      if (a) void pushOperationalToCloud('equipment_assets', 'UPDATE', a);
    }
    return ticket;
  });

  ipcMain.handle('db:maintenance:update', (event: any, id: string, data: unknown) => {
    requireWriteAccess(event);
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

  // Attach the service completion document (repair receipt / service invoice) required
  // before a non-loss ticket can be completed.
  ipcMain.handle('db:maintenance:uploadServiceDoc', (event: any, id: string, dataUrl: unknown) => {
    requireWriteAccess(event);
    const ticket: any = db.prepare('SELECT id FROM maintenance_tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error('Ticket not found');
    const parsed = AttachmentDataSchema.parse(dataUrl);
    db.prepare("UPDATE maintenance_tickets SET service_doc_data = ?, updated_at = datetime('now') WHERE id = ?").run(parsed, id);
    return { success: true };
  });

  ipcMain.handle('db:maintenance:clearServiceDoc', (event: any, id: string) => {
    requireWriteAccess(event);
    const ticket: any = db.prepare('SELECT id FROM maintenance_tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error('Ticket not found');
    db.prepare("UPDATE maintenance_tickets SET service_doc_data = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  ipcMain.handle('db:maintenance:updateStatus', (event: any, id: string, newStatus: string, outcome?: string | null) => {
    const user = requireWriteAccess(event);
    const ticket: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error('Ticket not found');

    const isLoss = ticket.document_type === 'loss';

    // A non-loss ticket can only be completed once its service completion document
    // (repair receipt / service invoice) is on file. Loss tickets have no such
    // document, so they are exempt.
    if (newStatus === 'COMPLETED' && !isLoss && !ticket.service_doc_data) {
      throw new Error('Upload the service completion document before completing this ticket.');
    }

    // Resolve the completion outcome (only relevant when completing a ticket).
    // Defaults: repair tickets -> 'repaired', loss tickets -> 'found'.
    let finalOutcome: string | null = null;
    if (newStatus === 'COMPLETED') {
      finalOutcome = outcome || (isLoss ? 'found' : 'repaired');
    }

    const tx = db.transaction(() => {
      const updates: string[] = [`repair_status = ?`, "updated_at = datetime('now')"];
      const vals: any[] = [newStatus];
      if (newStatus === 'COMPLETED') {
        updates.push('completion_date = ?', 'completion_outcome = ?');
        vals.push(new Date().toISOString(), finalOutcome);
      }
      vals.push(id);
      db.prepare(`UPDATE maintenance_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

      const noteSuffix = finalOutcome ? ` (outcome: ${finalOutcome})` : '';
      db.prepare(`INSERT INTO maintenance_notes (id, ticket_id, author, note_text, note_type) VALUES (?, ?, ?, ?, 'status_change')`)
        .run(uuidv4(), id, user.full_name, `Status changed from ${ticket.repair_status} to ${newStatus}${noteSuffix}`);

      // Asset status transitions for the single unit this ticket targets. Availability
      // (and total quantity for write-offs/losses) is derived from the unit statuses below.
      if (ticket.asset_id) {
        let assetStatus: string | null = null;
        let reason = '';
        if (newStatus === 'COMPLETED') {
          switch (finalOutcome) {
            case 'unrepairable': assetStatus = 'RETIRED'; reason = 'Repair completed — unrepairable'; break;
            case 'total_loss':   assetStatus = 'RETIRED'; reason = 'Repair completed — total loss'; break;
            case 'not_found':    assetStatus = 'MISSING'; reason = 'Search completed — not found'; break;
            case 'found':        assetStatus = 'AVAILABLE'; reason = 'Search completed — found'; break;
            default:             assetStatus = 'AVAILABLE'; reason = 'Repair completed'; break;
          }
        } else if (newStatus === 'IN_PROGRESS') {
          assetStatus = 'IN_REPAIR';
          reason = isLoss ? 'Search in progress' : 'Repair in progress';
        } else if (newStatus === 'CANCELLED') {
          // Ticket dropped: return the unit to service.
          assetStatus = 'AVAILABLE';
          reason = 'Ticket cancelled';
        }

        if (assetStatus) {
          const prev: any = db.prepare('SELECT current_status FROM equipment_assets WHERE id = ?').get(ticket.asset_id);
          if (assetStatus === 'RETIRED') {
            db.prepare("UPDATE equipment_assets SET current_status = 'RETIRED', retirement_date = ?, retirement_reason = ?, updated_at = datetime('now') WHERE id = ?")
              .run(new Date().toISOString(), reason, ticket.asset_id);
          } else {
            db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE id = ?")
              .run(assetStatus, ticket.asset_id);
          }
          db.prepare(`INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), ticket.asset_id, ticket.equipment_id, prev?.current_status || '', assetStatus, user.full_name, reason, id);
        }
      }

      if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
        recomputeAvailability(db, ticket.equipment_id);
      }
    });
    tx();

    const updated: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    void pushOperationalToCloud('maintenance_tickets', 'UPDATE', updated);
    // Propagate inventory/asset changes to the shared catalog so the rental system sees them.
    if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
      const eq: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(ticket.equipment_id);
      if (eq) void pushCatalogToCloud('equipment_items', 'UPDATE', eq);
    }
    if (ticket.asset_id && (newStatus === 'COMPLETED' || newStatus === 'IN_PROGRESS')) {
      const asset: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(ticket.asset_id);
      if (asset) void pushOperationalToCloud('equipment_assets', 'UPDATE', asset);
    }
    // Auto-archive the closed ticket's document to Google Drive (fire-and-forget;
    // never blocks or fails the status change).
    if (newStatus === 'COMPLETED') {
      void archiveMaintenanceTicket(id);
    }
    return { success: true };
  });

  ipcMain.handle('db:maintenance:delete', (event: any, id: string) => {
    const user = requireSession(event);
    if (user.role !== 'admin') throw new Error('Only admins can delete tickets');
    const ticket: any = db.prepare('SELECT * FROM maintenance_tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error('Ticket not found');

    const wasOpen = ticket.repair_status !== 'COMPLETED' && ticket.repair_status !== 'CANCELLED';

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM maintenance_notes WHERE ticket_id = ?').run(id);
      db.prepare('DELETE FROM ticket_actions WHERE ticket_id = ?').run(id);
      db.prepare('DELETE FROM maintenance_tickets WHERE id = ?').run(id);

      // Only an open ticket holds the unit out of service — restore it on delete.
      // A completed ticket already settled inventory (incl. write-offs); leave it alone.
      if (wasOpen) {
        if (ticket.asset_id) {
          db.prepare("UPDATE equipment_assets SET current_status = 'AVAILABLE', updated_at = datetime('now') WHERE id = ?")
            .run(ticket.asset_id);
        }
        recomputeAvailability(db, ticket.equipment_id);
      }
    });
    tx();

    void pushOperationalToCloud('maintenance_tickets', 'DELETE', { id });
    if (wasOpen) {
      const eq: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(ticket.equipment_id);
      if (eq) void pushCatalogToCloud('equipment_items', 'UPDATE', eq);
      if (ticket.asset_id) {
        const a: any = db.prepare('SELECT * FROM equipment_assets WHERE id = ?').get(ticket.asset_id);
        if (a) void pushOperationalToCloud('equipment_assets', 'UPDATE', a);
      }
    }
    return { success: true };
  });

  ipcMain.handle('db:maintenance:addNote', (event: any, data: unknown) => {
    requireWriteAccess(event);
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
    const user = requireWriteAccess(event);
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
    requireWriteAccess(event);
    const id = uuidv4();
    const input = data as any;
    const now = new Date().toISOString();
    const asset: any = db.prepare('SELECT id FROM equipment_assets WHERE equipment_id = ?').get(input.equipment_id);
    db.prepare(`INSERT INTO preventive_schedules (id, equipment_id, asset_id, schedule_type, interval_days, interval_rentals, description, next_due_date, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, input.equipment_id, asset?.id || null, input.schedule_type || 'calendar', input.interval_days || null, input.interval_rentals || null, input.description || '', input.next_due_date || null, now, now);
    return db.prepare('SELECT * FROM preventive_schedules WHERE id = ?').get(id);
  });

  ipcMain.handle('db:maintenance:updateSchedule', (event: any, id: string, data: any) => {
    requireWriteAccess(event);
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
    requireWriteAccess(event);
    db.prepare("UPDATE preventive_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  // ── Equipment Maintenance History (completed jobs) ──

  ipcMain.handle('db:maintenance:getCompletedHistory', () => {
    return db.prepare(`
      SELECT mt.id, mt.ticket_number, mt.equipment_id, mt.reported_date, mt.completion_date,
        mt.issue_description, mt.severity, mt.maintenance_type, mt.document_type, mt.completion_outcome,
        e.name as equipment_name, e.equipment_code,
        c.name as category_name,
        (SELECT ta.remarks FROM ticket_actions ta WHERE ta.ticket_id = mt.id ORDER BY ta.action_date DESC, ta.created_at DESC LIMIT 1) as last_remarks
      FROM maintenance_tickets mt
      JOIN equipment_items e ON e.id = mt.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE mt.repair_status = 'COMPLETED'
      ORDER BY mt.completion_date DESC
    `).all();
  });

  ipcMain.handle('db:maintenance:getEquipmentHistory', (_e: any, equipmentId: string) => {
    return db.prepare(`
      SELECT mt.id, mt.ticket_number, mt.equipment_id, mt.reported_date, mt.completion_date,
        mt.issue_description, mt.severity, mt.repair_status, mt.maintenance_type, mt.document_type, mt.completion_outcome,
        e.name as equipment_name, e.equipment_code,
        c.name as category_name,
        (SELECT ta.remarks FROM ticket_actions ta WHERE ta.ticket_id = mt.id ORDER BY ta.action_date DESC, ta.created_at DESC LIMIT 1) as last_remarks
      FROM maintenance_tickets mt
      JOIN equipment_items e ON e.id = mt.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE mt.equipment_id = ? AND mt.repair_status = 'COMPLETED'
      ORDER BY mt.completion_date DESC
    `).all(equipmentId);
  });

  // ── Ticket Actions CRUD ──

  ipcMain.handle('db:maintenance:getActions', (_e: any, ticketId: string) => {
    return db.prepare('SELECT * FROM ticket_actions WHERE ticket_id = ? ORDER BY action_date ASC, created_at ASC').all(ticketId);
  });

  ipcMain.handle('db:maintenance:addAction', (event: any, data: unknown) => {
    requireWriteAccess(event);
    const input = TicketActionSchema.parse(data);
    const id = uuidv4();
    db.prepare(`INSERT INTO ticket_actions (id, ticket_id, action_date, action_taken, remarks, personnel) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, input.ticket_id, input.action_date, input.action_taken, input.remarks, input.personnel);
    const action: any = db.prepare('SELECT * FROM ticket_actions WHERE id = ?').get(id);
    void pushOperationalToCloud('ticket_actions', 'INSERT', action);
    return action;
  });

  ipcMain.handle('db:maintenance:updateAction', (event: any, id: string, data: unknown) => {
    requireWriteAccess(event);
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
    requireWriteAccess(event);
    db.prepare('DELETE FROM ticket_actions WHERE id = ?').run(id);
    return { success: true };
  });
}
