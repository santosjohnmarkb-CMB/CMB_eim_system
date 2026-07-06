-- ─────────────────────────────────────────────────────────────────────────────
-- Purge test / transactional data for a clean delivery build.
--
-- KEEPS the equipment catalog and its taxonomy:
--   categories, subcategories, equipment_items, equipment_assets,
--   package_definitions, package_items
-- KEEPS the bootstrap `admin` account and schema bookkeeping
--   (schema_migrations, google_drive_config).
--
-- DELETES all transactional / test data:
--   loans, maintenance tickets, purchase requests, parts, vendors,
--   status logs, audit logs, the offline queue, sync watermarks, and every
--   non-admin user.
--
-- It also returns any unit left DEPLOYED / IN_REPAIR by a now-deleted loan or
-- ticket back to AVAILABLE and recomputes per-item availability, so the retained
-- equipment is internally consistent.
--
-- Usage (with the app closed):
--   sqlite3 "<userData>/cmb-eim.db" < scripts/purge-test-data.sql
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = OFF;

BEGIN;

-- Maintenance
DELETE FROM ticket_actions;
DELETE FROM maintenance_notes;
DELETE FROM maintenance_tickets;
DELETE FROM preventive_schedules;

-- Loans
DELETE FROM equipment_loan_items;
DELETE FROM equipment_loans;

-- Purchasing
DELETE FROM purchase_request_items;
DELETE FROM purchase_requests;

-- Parts / vendors
DELETE FROM parts_transactions;
DELETE FROM parts_compatibility;
DELETE FROM parts_inventory;
DELETE FROM parts_catalog;
DELETE FROM vendors;

-- Logs / queues / sync state
DELETE FROM asset_status_log;
DELETE FROM audit_logs;
DELETE FROM offline_queue;
DELETE FROM sync_metadata;

-- Users: keep only the bootstrap administrator
DELETE FROM users WHERE username <> 'admin';

-- Undo transactional side effects on retained equipment: nothing can be on loan
-- or in repair once those records are gone.
UPDATE equipment_assets
   SET current_status = 'AVAILABLE', updated_at = datetime('now')
 WHERE current_status IN ('DEPLOYED', 'IN_REPAIR');

-- Recompute availability for every item that tracks per-unit assets.
UPDATE equipment_items
   SET available_qty = (
         SELECT COUNT(*) FROM equipment_assets ea
          WHERE ea.equipment_id = equipment_items.id
            AND ea.current_status = 'AVAILABLE'
       ),
       updated_at = datetime('now')
 WHERE id IN (SELECT DISTINCT equipment_id FROM equipment_assets);

COMMIT;

PRAGMA foreign_keys = ON;

VACUUM;
