import { v4 as uuidv4 } from 'uuid';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { pushOperationalToCloud } from '../sync/operational-sync';

// Statuses that take a unit out of the owned fleet entirely (written off / lost).
// These do not count toward an item's total quantity.
const DEAD_STATUSES = ['RETIRED', 'MISSING'] as const;
const DEAD_LIST = DEAD_STATUSES.map((s) => `'${s}'`).join(', ');

// Derive equipment_items.quantity and available_qty from the per-unit asset rows.
// quantity = units still in the fleet (not retired/missing); available_qty = units
// currently AVAILABLE. This is the single source of truth for availability now that
// each unit of quantity has its own equipment_assets row. Pushes the refreshed
// catalog row to the cloud so the shared rental system stays in sync.
export function recomputeAvailability(db: any, equipmentId: string): void {
  const total: any = db.prepare(
    `SELECT COUNT(*) as count FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN (${DEAD_LIST})`,
  ).get(equipmentId);
  const avail: any = db.prepare(
    "SELECT COUNT(*) as count FROM equipment_assets WHERE equipment_id = ? AND current_status = 'AVAILABLE'",
  ).get(equipmentId);

  db.prepare("UPDATE equipment_items SET quantity = ?, available_qty = ?, updated_at = datetime('now') WHERE id = ?")
    .run(total.count, avail.count, equipmentId);

  const eq: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(equipmentId);
  if (eq) void pushCatalogToCloud('equipment_items', 'UPDATE', eq);
}

// Pick the next AVAILABLE unit for an equipment, skipping any asset ids already
// claimed within the same operation (e.g. adding the same equipment twice to a loan).
export function pickAvailableAsset(db: any, equipmentId: string, excludeIds: string[] = []): any {
  const placeholders = excludeIds.map(() => '?').join(', ');
  const exclude = excludeIds.length ? `AND id NOT IN (${placeholders})` : '';
  return db.prepare(
    `SELECT * FROM equipment_assets WHERE equipment_id = ? AND current_status = 'AVAILABLE' ${exclude} ORDER BY created_at LIMIT 1`,
  ).get(equipmentId, ...excludeIds);
}

// Write a per-unit status-history row. Callers must push the returned id to the
// cloud after the surrounding transaction commits (see pushStatusLogsToCloud).
export function insertAssetStatusLog(
  db: any,
  params: {
    assetId: string;
    equipmentId: string;
    previousStatus: string;
    newStatus: string;
    changedBy: string;
    reason: string;
    relatedTicketId?: string | null;
  },
): string {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO asset_status_log
      (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.assetId,
    params.equipmentId,
    params.previousStatus,
    params.newStatus,
    params.changedBy,
    params.reason,
    params.relatedTicketId ?? null,
  );
  return id;
}

export function pushStatusLogsToCloud(db: any, ids: string[]): void {
  for (const id of ids) {
    const row: any = db.prepare('SELECT * FROM asset_status_log WHERE id = ?').get(id);
    if (row) void pushOperationalToCloud('asset_status_log', 'INSERT', row);
  }
}
