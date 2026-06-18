import { pushCatalogToCloud } from '../sync/catalog-sync';

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
