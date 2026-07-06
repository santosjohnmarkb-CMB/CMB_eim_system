/**
 * On-disk store for large operator-uploaded attachments (signed release forms,
 * purchase invoices, service completion documents).
 *
 * These used to be persisted as multi-MB base64 data URLs directly in SQLite rows,
 * which bloated the database file, every `SELECT *`, backups, and the local
 * reconcile write path. They are already excluded from cloud sync
 * (`LOCAL_ONLY_COLUMNS` in sync/offline-queue.ts), so moving them out of the row
 * to files-on-disk is a purely local change with no effect on the shared Supabase
 * project or the other apps that use it.
 *
 * The DB now stores a compact pointer (`attachment:<uuid>.<ext>`); the actual bytes
 * live under `<userData>/attachments/`. The renderer and PDF pipeline still work in
 * terms of data URLs — pointers are resolved back to data URLs at the read boundary
 * (single-record IPC handlers and the Drive-archive step), so no renderer change is
 * needed. `resolveBlob` also passes through any legacy inline data URL unchanged, so
 * the migration is safe even before the backfill has run.
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

const POINTER_PREFIX = 'attachment:';

// Only the MIME types accepted by AttachmentDataSchema are expected here.
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function attachmentsDir(): string {
  const dir = path.join(app.getPath('userData'), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isBlobPointer(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(POINTER_PREFIX);
}

export function isDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:');
}

/** Resolve a pointer to its absolute file path, guarding against path traversal. */
function pointerToPath(pointer: string): string | null {
  const name = pointer.slice(POINTER_PREFIX.length);
  // We only ever generate `<uuid>.<ext>` names; reject anything with separators.
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return path.join(attachmentsDir(), name);
}

/** Persist a base64 data URL to disk; returns the compact pointer to store in the DB. */
export function saveBlob(dataUrl: string): string {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  const mime = match?.[1];
  const data = match?.[2];
  if (!mime || data == null) {
    throw new Error('saveBlob expects a base64 data URL');
  }
  const ext = MIME_TO_EXT[mime] ?? 'bin';
  const filename = `${uuidv4()}.${ext}`;
  fs.writeFileSync(path.join(attachmentsDir(), filename), Buffer.from(data, 'base64'));
  return `${POINTER_PREFIX}${filename}`;
}

/**
 * Resolve a stored column value to a data URL for the renderer / PDF pipeline.
 * - pointer  -> read the file and rebuild the data URL
 * - data URL -> returned unchanged (legacy value not yet backfilled)
 * - null/other -> returned unchanged
 */
export function resolveBlob(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isDataUrl(value)) return value;
  if (isBlobPointer(value)) {
    try {
      const p = pointerToPath(value);
      if (!p || !fs.existsSync(p)) return null;
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream';
      const b64 = fs.readFileSync(p).toString('base64');
      return `data:${mime};base64,${b64}`;
    } catch (err) {
      console.error('[blob] failed to read blob file:', err instanceof Error ? err.message : err);
      return null;
    }
  }
  return value;
}

/** Delete the backing file for a pointer (best-effort; no-op for data URLs / null). */
export function deleteBlob(value: string | null | undefined): void {
  if (!isBlobPointer(value)) return;
  try {
    const p = pointerToPath(value);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    console.error('[blob] failed to delete blob file:', err instanceof Error ? err.message : err);
  }
}

const BLOB_COLUMNS: { table: string; column: string }[] = [
  { table: 'equipment_loans', column: 'signed_form_data' },
  { table: 'purchase_requests', column: 'invoice_data' },
  { table: 'maintenance_tickets', column: 'service_doc_data' },
];

/**
 * One-time, idempotent backfill: drain any in-row base64 data URLs into files and
 * replace them with pointers. Selects only rows whose column still holds a
 * `data:` value, so it is safe to run on every startup. Best-effort per row — a
 * failure leaves the inline value in place (which `resolveBlob` still handles).
 */
export function migrateInRowBlobsToFiles(db: any): void {
  for (const { table, column } of BLOB_COLUMNS) {
    let rows: any[];
    try {
      rows = db.prepare(`SELECT id, ${column} AS val FROM ${table} WHERE ${column} LIKE 'data:%'`).all();
    } catch {
      // Column/table may not exist on an older schema — nothing to migrate.
      continue;
    }
    if (rows.length === 0) continue;
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    let migrated = 0;
    for (const row of rows) {
      try {
        const pointer = saveBlob(row.val);
        update.run(pointer, row.id);
        migrated++;
      } catch (err) {
        console.error(`[blob] backfill failed for ${table} ${row.id}:`, err instanceof Error ? err.message : err);
      }
    }
    if (migrated > 0) console.log(`[blob] migrated ${migrated} ${column} blob(s) from ${table} to files`);
  }
}
