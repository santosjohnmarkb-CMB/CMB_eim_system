/**
 * Cloud schema-health tracker.
 *
 * The Supabase (cloud) Postgres schema can drift behind the local SQLite schema
 * when database/supabase-migration.sql hasn't been (re)run after the app added
 * new columns/tables. When that happens, pushes fail with recognisable
 * PostgREST/Postgres error codes and the offline queue can never clear.
 *
 * The catalog/operational sync passes report every such error here. The sync
 * manager resets the tracker before a full reconcile, lets the passes record,
 * then reads back a deduped, human-readable list to surface in Settings so the
 * operator knows to run the migration instead of staring at a stuck "Pending
 * Changes" count.
 */

interface CloudError {
  code?: string | number;
  message?: string;
  details?: string;
}

// Deduped issue descriptions for the current reconcile pass, keyed by a stable
// signature so the same missing column reported across many rows collapses to one.
const issues = new Map<string, string>();

function asCloudError(err: unknown): CloudError {
  if (!err || typeof err !== 'object') return {};
  return err as CloudError;
}

/**
 * True for errors that mean "the cloud schema is missing something the app
 * needs" (as opposed to transient network/auth failures). These are the only
 * errors that should light up the "database needs migration" banner.
 */
export function isSchemaMismatchError(err: unknown): boolean {
  const e = asCloudError(err);
  const code = String(e.code ?? '');
  // PGRST204: column not found in schema cache. PGRST205: table not found.
  if (code === 'PGRST204' || code === 'PGRST205') return true;
  // 23505 against a legacy unique constraint the app has since dropped locally
  // (e.g. equipment_assets_equipment_id_key from the old 1:1 asset model).
  if (code === '23505' && /_key"?$/.test(String(e.message ?? ''))) return true;
  return false;
}

/** Classify and record a single failing table's error, if it's schema-related. */
export function recordSchemaError(table: string, err: unknown): void {
  if (!isSchemaMismatchError(err)) return;
  const e = asCloudError(err);
  const code = String(e.code ?? '');
  const message = String(e.message ?? '');

  let description: string;
  let key: string;

  if (code === 'PGRST205') {
    description = `Table "${table}" is missing in the cloud database`;
    key = `table:${table}`;
  } else if (code === 'PGRST204') {
    const col = message.match(/'([^']+)' column/)?.[1];
    description = col
      ? `Table "${table}" is missing column "${col}"`
      : `Table "${table}" has a missing column`;
    key = `column:${table}:${col ?? message}`;
  } else {
    const constraint = message.match(/constraint "([^"]+)"/)?.[1];
    description = constraint
      ? `Table "${table}" has an outdated constraint "${constraint}" that must be dropped`
      : `Table "${table}" has an outdated constraint`;
    key = `constraint:${table}:${constraint ?? message}`;
  }

  issues.set(key, description);
}

/** Reset the tracker at the start of a full reconcile pass. */
export function resetSchemaIssues(): void {
  issues.clear();
}

/** Snapshot of the deduped issues detected since the last reset. */
export function getSchemaIssues(): string[] {
  return Array.from(issues.values());
}
