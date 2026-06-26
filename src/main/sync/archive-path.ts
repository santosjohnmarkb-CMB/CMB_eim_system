import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Archive folder structure for every EIM completion document that lands on
 * Google Drive (and the local fallback copy).
 *
 * Everything lives under a single top-level `EIM` folder. Inside it each
 * workflow gets its OWN subfolder, and documents are then filed by the calendar
 * Year then Month of the date the work was completed:
 *
 *   EIM / Maintenance - Service Tickets / <year> / <month> / <ticket>.pdf
 *   EIM / Loaned Equipment              / <year> / <month> / <loan>.pdf
 *   EIM / Purchase Request              / <year> / <month> / <request>.pdf
 *
 * The EIM parent and its section subfolders are created on first use by the app
 * itself, which is required because the OAuth `drive.file` scope can only see
 * and manage files this app created.
 */

export type ArchiveKind = 'ticket' | 'loan' | 'purchase';

// Single top-level Drive folder that contains every EIM archive.
export const ARCHIVE_PARENT = 'EIM';

// Per-workflow subfolder created inside the EIM parent folder.
export const ARCHIVE_SECTIONS: Record<ArchiveKind, string> = {
  ticket: 'Maintenance - Service Tickets',
  loan: 'Loaned Equipment',
  purchase: 'Purchase Request',
};

// Local mirror lives under the OS Documents folder so operators always have an
// offline copy even when Drive is not connected.
const LOCAL_ARCHIVE_ROOT = 'CMB-EIM-Archives';

export interface ArchivePathParts {
  parentName: string;
  sectionName: string;
  year: string;
  month: string;
}

/**
 * Resolve the { parentName, sectionName, year, month } target for a document,
 * derived from the date the work was completed (ticket completion_date, loan
 * return time, purchase fulfilled_at). Falls back to "now" if the date is
 * missing/invalid so archiving never hard-fails on a bad timestamp.
 */
export function resolveEimArchivePath(
  kind: ArchiveKind,
  completedAt: string | Date | null | undefined,
): ArchivePathParts {
  const d = parseDate(completedAt);
  return {
    parentName: ARCHIVE_PARENT,
    sectionName: ARCHIVE_SECTIONS[kind],
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, '0'),
  };
}

/**
 * Parse the many shapes a timestamp comes in from this app's storage layers:
 *
 *   - `null`/`undefined` → now
 *   - Native `Date`      → as-is
 *   - ISO 8601 with `Z` or `±HH:MM` offset → parsed correctly
 *   - SQLite `datetime('now')` → "YYYY-MM-DD HH:MM:SS" in UTC but WITHOUT a
 *     timezone designator. V8 interprets that space-separated format as *local*
 *     time, which silently shifts archive folders across timezone boundaries.
 *     We rewrite it to `YYYY-MM-DDTHH:MM:SSZ` so the Date represents the stored
 *     UTC instant; local-day derivation then happens through getFullYear/etc.
 */
function parseDate(value: string | Date | null | undefined): Date {
  if (value == null) return new Date();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date() : value;
  const raw = String(value).trim();
  if (!raw) return new Date();
  const naiveSqliteMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(raw);
  const parsed = naiveSqliteMatch
    ? new Date(`${naiveSqliteMatch[1]}T${naiveSqliteMatch[2]}Z`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Strip filesystem-hostile characters while preserving readability. Keeps names
 * portable across Drive and the local fallback.
 */
export function sanitizeFileName(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ArchiveFile {
  filename: string;
  buffer: Buffer;
}

export interface ArchiveResult {
  savedLocally: boolean;
  uploadedToDrive: boolean;
  driveFileId: string | null;
}

/**
 * Upload or save a set of PDFs into the canonical archive folder for a workflow.
 * Always writes a local copy under `~/Documents/CMB-EIM-Archives/...`; if Google
 * Drive is connected, also nests <root>/<year>/<month> on Drive and uploads each
 * file (replacing a same-named file rather than duplicating).
 *
 * Idempotent at the folder level: `ensureFolder` and `mkdirSync({recursive:true})`
 * both reuse existing folders so re-archiving drops new documents alongside
 * whatever is already there.
 */
export async function uploadOrSaveArchive(
  parts: ArchivePathParts,
  files: ArchiveFile[],
): Promise<ArchiveResult> {
  if (files.length === 0) return { savedLocally: false, uploadedToDrive: false, driveFileId: null };

  const { googleDriveService } = await import('./google-drive');
  const driveConnected = await googleDriveService.isConnected();

  // Always save a local copy (for offline access / verification).
  const localDir = path.join(
    app.getPath('documents'),
    LOCAL_ARCHIVE_ROOT,
    parts.parentName,
    parts.sectionName,
    parts.year,
    parts.month,
  );
  fs.mkdirSync(localDir, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(localDir, f.filename), f.buffer);
  }

  if (driveConnected) {
    // Nest each section inside the single EIM parent: EIM / <section> / <year> / <month>.
    const parentId = await googleDriveService.ensureFolder(null, parts.parentName);
    const sectionId = await googleDriveService.ensureFolder(parentId, parts.sectionName);
    const yearId = await googleDriveService.ensureFolder(sectionId, parts.year);
    const monthId = await googleDriveService.ensureFolder(yearId, parts.month);
    let lastFileId: string | null = null;
    for (const f of files) {
      lastFileId = await googleDriveService.uploadFile(monthId, f.filename, f.buffer);
    }
    return { savedLocally: true, uploadedToDrive: true, driveFileId: lastFileId };
  }

  return { savedLocally: true, uploadedToDrive: false, driveFileId: null };
}
