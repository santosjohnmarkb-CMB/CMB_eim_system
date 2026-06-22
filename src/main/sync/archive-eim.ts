/**
 * EIM auto-archive orchestrator.
 *
 * Each workflow stamps a completion event (ticket COMPLETED, loan RETURNED,
 * purchase FULFILLED). The corresponding `archiveX()` helper here builds the
 * workflow's document, renders it to a PDF in the main process, uploads it to the
 * correct Google Drive folder (and a local mirror), then stamps `archived_at` /
 * `drive_file_id` on the row.
 *
 * These helpers are designed to be called fire-and-forget after the DB commit:
 * they never throw (failures are caught and logged) so a Drive/PDF problem can
 * never roll back or block the completion action that triggered them.
 */

import { getDatabase } from '../database/index';
import { DOCUMENT_TYPE_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { PurchaseRequest } from '../../shared/types';
import { buildMaintenanceForm } from '../../shared/forms/maintenanceForm';
import { buildLoanReleaseForm } from '../../shared/forms/loanForm';
import { buildPurchaseRequestForm } from '../../shared/forms/purchaseForm';
import { renderDocumentToPdf } from '../pdf/html-to-pdf';
import {
  resolveEimArchivePath,
  sanitizeFileName,
  uploadOrSaveArchive,
  type ArchiveKind,
} from './archive-path';

async function archiveAndStamp(
  kind: ArchiveKind,
  table: 'maintenance_tickets' | 'equipment_loans' | 'purchase_requests',
  id: string,
  completedAt: string | null | undefined,
  title: string,
  filenameBase: string,
  bodyHtml: string,
): Promise<void> {
  const db = getDatabase();
  const pdf = await renderDocumentToPdf(title, bodyHtml);
  const parts = resolveEimArchivePath(kind, completedAt);
  const filename = `${sanitizeFileName(filenameBase)}.pdf`;
  const result = await uploadOrSaveArchive(parts, [{ filename, buffer: pdf }]);
  db.prepare(
    `UPDATE ${table} SET archived_at = ?, drive_file_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(new Date().toISOString(), result.driveFileId, id);
  console.log(
    `[Archive] ${kind} ${id}: saved locally=${result.savedLocally}, drive=${result.uploadedToDrive}` +
    `${result.driveFileId ? ` (${result.driveFileId})` : ''}`,
  );
}

/** Archive a closed (COMPLETED) maintenance/repair/update/loss ticket. */
export async function archiveMaintenanceTicket(id: string): Promise<void> {
  try {
    const db = getDatabase();
    const ticket: any = db.prepare(
      `SELECT mt.*, e.name AS equipment_name, e.equipment_code
       FROM maintenance_tickets mt
       LEFT JOIN equipment_items e ON e.id = mt.equipment_id
       WHERE mt.id = ?`,
    ).get(id);
    if (!ticket) return;
    if (ticket.archived_at) return; // already archived — skip
    if (ticket.repair_status !== 'COMPLETED') return;

    const actions: any[] = db.prepare(
      'SELECT * FROM ticket_actions WHERE ticket_id = ? ORDER BY action_date ASC, created_at ASC',
    ).all(id);

    const docTypeLabel = DOCUMENT_TYPE_CONFIG[ticket.document_type]?.reportTitle ?? 'Repair Report';
    const body = buildMaintenanceForm(ticket, actions);
    await archiveAndStamp(
      'ticket',
      'maintenance_tickets',
      id,
      ticket.completion_date,
      `${docTypeLabel} ${ticket.ticket_number}`,
      `${ticket.ticket_number} - ${docTypeLabel}`,
      body,
    );
  } catch (err) {
    console.error('[Archive] maintenance ticket failed:', err instanceof Error ? err.message : err);
  }
}

/** Archive a fully-returned (RETURNED) equipment loan's release document. */
export async function archiveLoan(id: string): Promise<void> {
  try {
    const db = getDatabase();
    const loan: any = db.prepare('SELECT * FROM equipment_loans WHERE id = ?').get(id);
    if (!loan) return;
    if (loan.archived_at) return; // already archived — skip
    if (loan.status !== 'RETURNED') return;

    const items: any[] = db.prepare(
      `SELECT li.*, COALESCE(e.name, li.item_name) AS equipment_name, e.equipment_code
       FROM equipment_loan_items li
       LEFT JOIN equipment_items e ON e.id = li.equipment_id
       WHERE li.loan_id = ?
       ORDER BY li.created_at ASC`,
    ).all(id);

    // Use the most recent line-item return date as the completion date.
    const returnedDates = items
      .map((it) => it.returned_date)
      .filter((d): d is string => !!d)
      .sort();
    const completedAt = returnedDates[returnedDates.length - 1] || loan.updated_at;

    const body = buildLoanReleaseForm({
      loan_number: loan.loan_number,
      department: loan.department as Department,
      person_or_org: loan.person_or_org,
      purpose: loan.purpose,
      location: loan.location,
      loaned_date: loan.loaned_date,
      tentative_return_date: loan.tentative_return_date,
      duration: loan.duration,
      remarks: loan.remarks,
      released_by: loan.created_by,
      items: items.map((it) => ({ code: it.equipment_code, name: it.equipment_name || '' })),
    });

    await archiveAndStamp(
      'loan',
      'equipment_loans',
      id,
      completedAt,
      `Equipment Release Form ${loan.loan_number}`,
      `${loan.loan_number} - Equipment Release Form`,
      body,
    );
  } catch (err) {
    console.error('[Archive] loan failed:', err instanceof Error ? err.message : err);
  }
}

/** Archive a fulfilled (FULFILLED) purchase request document. */
export async function archivePurchaseRequest(id: string): Promise<void> {
  try {
    const db = getDatabase();
    const request: any = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
    if (!request) return;
    if (request.archived_at) return; // already archived — skip
    if (request.status !== 'FULFILLED') return;

    const items: any[] = db.prepare(
      'SELECT * FROM purchase_request_items WHERE request_id = ? ORDER BY sort_order ASC, created_at ASC',
    ).all(id);

    const body = buildPurchaseRequestForm({ ...request, items } as PurchaseRequest);
    await archiveAndStamp(
      'purchase',
      'purchase_requests',
      id,
      request.fulfilled_at,
      `Purchase Request ${request.request_number}`,
      `${request.request_number} - Purchase Request`,
      body,
    );
  } catch (err) {
    console.error('[Archive] purchase request failed:', err instanceof Error ? err.message : err);
  }
}
