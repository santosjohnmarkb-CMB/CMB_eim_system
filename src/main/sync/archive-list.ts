/**
 * On-demand "Archive List" snapshots.
 *
 * Unlike the per-document auto-archive in archive-eim.ts (which files one PDF per
 * closed ticket/loan/request), this captures a whole section's *list* of closed
 * records — the table an admin sees on screen — into a single PDF, filed under
 * EIM / Archived Lists / <section> / <department>. The list HTML is built by the
 * renderer (so the PDF matches exactly what was on screen) and wrapped here with the
 * shared company letterhead.
 *
 * On a successful save, the included records are soft-cleared (list_archived_at
 * stamped) so they drop out of the on-screen list without being deleted.
 */

import { getDatabase } from '../database/index';
import { renderDocumentToPdf } from '../pdf/html-to-pdf';
import { pushOperationalToCloud } from './operational-sync';
import {
  sanitizeFileName,
  uploadOrSaveArchiveSegments,
  ARCHIVE_PARENT,
  ARCHIVE_LISTS_SECTION,
  ARCHIVE_LIST_FOLDERS,
  type ArchiveKind,
} from './archive-path';

export type ListSection = 'maintenance' | 'loan' | 'purchase';

// The completed-list section maps onto the same ArchiveKind used for folders, and
// onto the table whose rows get soft-cleared after archiving.
const SECTION_KIND: Record<ListSection, ArchiveKind> = {
  maintenance: 'ticket',
  loan: 'loan',
  purchase: 'purchase',
};

const SECTION_TABLE: Record<ListSection, 'maintenance_tickets' | 'equipment_loans' | 'purchase_requests'> = {
  maintenance: 'maintenance_tickets',
  loan: 'equipment_loans',
  purchase: 'purchase_requests',
};

export interface ArchiveListInput {
  section: ListSection;
  departmentLabel: string;
  title: string;
  bodyHtml: string;
  filenameBase: string;
  recordIds: string[];
}

export interface ArchiveListResult {
  success: boolean;
  savedLocally: boolean;
  uploadedToDrive: boolean;
  driveFileId: string | null;
  localPath: string | null;
  filename: string | null;
  clearedCount: number;
  message?: string;
}

// "2026-06-26 1830" — readable, filesystem-safe, and sortable enough for snapshots.
function timestampLabel(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Render a section's closed list to a PDF, save it to Drive (+ local mirror), and on
 * success soft-clear the archived records. Never throws to the caller — failures come
 * back as `{ success: false, message }` so the renderer can surface them in a toast
 * and (crucially) nothing is cleared when the save did not complete.
 */
export async function renderAndArchiveList(input: ArchiveListInput): Promise<ArchiveListResult> {
  const base: ArchiveListResult = {
    success: false,
    savedLocally: false,
    uploadedToDrive: false,
    driveFileId: null,
    localPath: null,
    filename: null,
    clearedCount: 0,
  };

  try {
    if (!input.recordIds || input.recordIds.length === 0) {
      return { ...base, message: 'There are no records to archive.' };
    }

    const kind = SECTION_KIND[input.section];
    const sectionFolder = ARCHIVE_LIST_FOLDERS[kind];
    const filename = `${sanitizeFileName(`${input.filenameBase} - ${timestampLabel(new Date())}`)}.pdf`;

    const pdf = await renderDocumentToPdf(input.title, input.bodyHtml);

    const result = await uploadOrSaveArchiveSegments(
      [ARCHIVE_PARENT, ARCHIVE_LISTS_SECTION, sectionFolder, sanitizeFileName(input.departmentLabel)],
      [{ filename, buffer: pdf }],
    );

    if (!result.savedLocally) {
      return { ...base, message: 'Failed to save the archive file.' };
    }

    // Soft-clear only the rows that were actually included in this snapshot, and only
    // ones not already cleared. Done after a confirmed save so a PDF/Drive failure can
    // never make records vanish from the list with nothing archived.
    const db = getDatabase();
    const table = SECTION_TABLE[input.section];
    const placeholders = input.recordIds.map(() => '?').join(', ');
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `UPDATE ${table} SET list_archived_at = ?, updated_at = datetime('now')
         WHERE id IN (${placeholders}) AND list_archived_at IS NULL`,
      )
      .run(now, ...input.recordIds);

    // Propagate the soft-clear so other users' completed lists hide the same rows.
    // All three section tables (maintenance_tickets, equipment_loans, purchase_requests)
    // sync to the cloud, so push each newly-cleared row's updated list_archived_at stamp.
    if (info.changes > 0) {
      for (const recordId of input.recordIds) {
        const row: any = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
        if (row && row.list_archived_at) {
          void pushOperationalToCloud(table, 'UPDATE', row);
        }
      }
    }

    console.log(
      `[ArchiveList] ${input.section} (${input.departmentLabel}): ` +
      `saved locally=${result.savedLocally}, drive=${result.uploadedToDrive}, cleared=${info.changes}`,
    );

    return {
      success: true,
      savedLocally: result.savedLocally,
      uploadedToDrive: result.uploadedToDrive,
      driveFileId: result.driveFileId,
      localPath: result.localPath,
      filename,
      clearedCount: info.changes ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Archiving failed.';
    console.error('[ArchiveList] failed:', message);
    return { ...base, message };
  }
}
