-- CMB EIM System — Supabase PostgreSQL Migration
-- Run this in Supabase SQL Editor to add EIM tables alongside existing rental tables.

-- Widen users role constraint to include EIM roles
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('admin', 'accounts_manager', 'billing_user', 'payroll_user',
           'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk', 'viewer')
);

-- Extended asset data
CREATE TABLE IF NOT EXISTS equipment_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL DEFAULT '',
  asset_tag TEXT,
  purchase_date DATE,
  delivered_date DATE,
  purchase_price NUMERIC NOT NULL DEFAULT 0,
  vendor_name TEXT,
  warranty_expiry DATE,
  condition_grade TEXT NOT NULL DEFAULT 'A' CHECK (condition_grade IN ('A', 'B', 'C', 'D')),
  current_location TEXT NOT NULL DEFAULT 'Warehouse',
  current_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (current_status IN ('AVAILABLE', 'DEPLOYED', 'IN_REPAIR', 'ON_HOLD', 'IN_TRANSIT', 'RETIRED', 'MISSING', 'FOR_INSPECTION')),
  last_inspection_date TIMESTAMPTZ,
  retirement_date TIMESTAMPTZ,
  retirement_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- One asset row per unit of quantity; intentionally no UNIQUE(equipment_id).
);

-- Existing cloud databases: drop the legacy 1:1 constraint if present.
ALTER TABLE equipment_assets DROP CONSTRAINT IF EXISTS equipment_assets_equipment_id_key;

CREATE TABLE IF NOT EXISTS asset_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL DEFAULT '',
  related_ticket_id UUID,
  related_project TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  equipment_id UUID NOT NULL REFERENCES equipment_items(id),
  asset_id UUID REFERENCES equipment_assets(id),
  reported_by TEXT NOT NULL,
  reported_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  issue_description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  repair_status TEXT NOT NULL DEFAULT 'REPORTED' CHECK (repair_status IN ('REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  maintenance_type TEXT NOT NULL DEFAULT 'repair' CHECK (maintenance_type IN ('routine_maintenance', 'update', 'repair', 'corrective', 'preventive', 'predictive')),
  assigned_technician TEXT,
  diagnosis TEXT,
  estimated_cost NUMERIC NOT NULL DEFAULT 0,
  actual_cost NUMERIC NOT NULL DEFAULT 0,
  labor_hours NUMERIC NOT NULL DEFAULT 0,
  parts_consumed JSONB NOT NULL DEFAULT '[]',
  priority_order INTEGER NOT NULL DEFAULT 0,
  completion_date TIMESTAMPTZ,
  post_repair_grade TEXT CHECK (post_repair_grade IN ('A', 'B', 'C', 'D') OR post_repair_grade IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  note_text TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'update' CHECK (note_type IN ('update', 'escalation', 'resolution', 'parts', 'status_change')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'spare' CHECK (category IN ('spare', 'expendable', 'consumable', 'accessory')),
  unit_of_measure TEXT NOT NULL DEFAULT 'unit',
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  vendor_id UUID REFERENCES vendors(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 5,
  reorder_qty INTEGER NOT NULL DEFAULT 10,
  location TEXT NOT NULL DEFAULT 'Main Warehouse',
  last_count_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(part_id)
);

CREATE TABLE IF NOT EXISTS parts_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts_catalog(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('receive', 'consume', 'adjust', 'return')),
  quantity INTEGER NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  performed_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts_compatibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(part_id, equipment_id)
);

CREATE TABLE IF NOT EXISTS preventive_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES equipment_assets(id),
  schedule_type TEXT NOT NULL DEFAULT 'calendar' CHECK (schedule_type IN ('calendar', 'usage')),
  interval_days INTEGER,
  interval_rentals INTEGER,
  description TEXT NOT NULL DEFAULT '',
  next_due_date DATE,
  last_performed TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill columns for databases created before they were introduced
ALTER TABLE equipment_assets ADD COLUMN IF NOT EXISTS delivered_date DATE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_equipment_assets_status ON equipment_assets(current_status);
CREATE INDEX IF NOT EXISTS idx_asset_status_log_asset ON asset_status_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_status_log_equipment ON asset_status_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment ON maintenance_tickets(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(repair_status);
CREATE INDEX IF NOT EXISTS idx_parts_transactions_part ON parts_transactions(part_id);
CREATE INDEX IF NOT EXISTS idx_preventive_schedules_due ON preventive_schedules(next_due_date);

-- Enable Realtime for EIM tables. ALTER PUBLICATION throws if the table is
-- already a member, so each add is guarded to keep the whole script re-runnable.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'equipment_assets', 'asset_status_log', 'maintenance_tickets', 'maintenance_notes',
    'parts_catalog', 'parts_inventory', 'parts_transactions', 'vendors'
  ]) LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- already published
    END;
  END LOOP;
END $$;

-- RLS policies (permissive for EIM app — tighten per deployment). DROP ... IF
-- EXISTS before each CREATE keeps this idempotent (CREATE POLICY has no
-- IF NOT EXISTS form on older Postgres).
ALTER TABLE equipment_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for equipment_assets" ON equipment_assets;
CREATE POLICY "Allow all for equipment_assets" ON equipment_assets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE asset_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for asset_status_log" ON asset_status_log;
CREATE POLICY "Allow all for asset_status_log" ON asset_status_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE maintenance_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for maintenance_tickets" ON maintenance_tickets;
CREATE POLICY "Allow all for maintenance_tickets" ON maintenance_tickets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE maintenance_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for maintenance_notes" ON maintenance_notes;
CREATE POLICY "Allow all for maintenance_notes" ON maintenance_notes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for parts_catalog" ON parts_catalog;
CREATE POLICY "Allow all for parts_catalog" ON parts_catalog FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for parts_inventory" ON parts_inventory;
CREATE POLICY "Allow all for parts_inventory" ON parts_inventory FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for parts_transactions" ON parts_transactions;
CREATE POLICY "Allow all for parts_transactions" ON parts_transactions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_compatibility ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for parts_compatibility" ON parts_compatibility;
CREATE POLICY "Allow all for parts_compatibility" ON parts_compatibility FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE preventive_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for preventive_schedules" ON preventive_schedules;
CREATE POLICY "Allow all for preventive_schedules" ON preventive_schedules FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for vendors" ON vendors;
CREATE POLICY "Allow all for vendors" ON vendors FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════
-- Migration: Equipment quantity + Incident report
-- ═══════════════════════════════════════════════════

-- Equipment quantity tracking
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS available_qty INTEGER NOT NULL DEFAULT 1;

-- Incident report fields on maintenance_tickets
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS production_name TEXT;
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS project_date TEXT;
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'repair';

-- Formal action log table
CREATE TABLE IF NOT EXISTS ticket_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  action_date TEXT NOT NULL DEFAULT (CURRENT_DATE::TEXT),
  action_taken TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  personnel TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ticket_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for ticket_actions" ON ticket_actions;
CREATE POLICY "Allow all for ticket_actions" ON ticket_actions FOR ALL USING (true) WITH CHECK (true);

-- Publish ticket_actions for Realtime so action-log entries reach other users live.
-- Done here (not in the early publication block) because that block runs before this
-- table is created.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ticket_actions;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already published
END $$;

-- ═══════════════════════════════════════════════════
-- Migration: Department separation
-- ═══════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS department TEXT;

-- ═══════════════════════════════════════════════════
-- Migration: Department personnel roles
-- ═══════════════════════════════════════════════════

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('admin', 'equipment_manager', 'accounts_manager', 'billing_user', 'payroll_user',
           'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk',
           'camera_personnel', 'lighting_personnel', 'viewer')
);

-- ═══════════════════════════════════════════════════
-- Migration: Ticket completion outcomes + Equipment Loss tickets
-- ═══════════════════════════════════════════════════

ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS completion_outcome TEXT;

-- Refresh the maintenance_type CHECK to the current allowed values. Databases
-- created before the list was widened still carry the old/narrower constraint,
-- which rejects rows the app considers valid (error 23514). Mirrors local
-- migration 006_expand_maintenance_type_check.
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_maintenance_type_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_maintenance_type_check CHECK (
  maintenance_type IN ('routine_maintenance', 'update', 'repair', 'corrective', 'preventive', 'predictive')
);

-- ═══════════════════════════════════════════════════
-- Migration: Google Drive auto-archive bookkeeping
-- ═══════════════════════════════════════════════════
-- Mirrors local migration 020_drive_archive. Without these, every maintenance_tickets
-- upsert fails with PGRST204 ("Could not find the 'archived_at' column"), which in
-- turn fails its maintenance_notes children with a foreign-key violation. (The loan /
-- purchase request equivalents are defined on their own cloud tables further below.)

ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS drive_file_id TEXT;

-- ═══════════════════════════════════════════════════
-- Migration: Admin "Archive List" soft-clear bookkeeping
-- ═══════════════════════════════════════════════════
-- Mirrors local migration 022_list_archive_columns. When an admin archives a
-- section's closed list, every included record is stamped with list_archived_at
-- so it drops out of the on-screen completed list. Without it, every
-- maintenance_tickets upsert fails with PGRST204 ("Could not find the
-- 'list_archived_at' column"). (Loans / purchase requests get the same column on
-- their own cloud tables further below.)

ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS list_archived_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════
-- Migration: Loans + Purchase Requests cloud sync
-- ═══════════════════════════════════════════════════
-- These four tables were previously local-only. They now sync like the other
-- operational tables so every privileged user sees loans and purchase requests
-- regardless of which machine created them.
--
-- Deliberately NOT mirrored to the cloud (kept local-only and stripped from every
-- payload by coerceForCloud → LOCAL_ONLY_COLUMNS): the large base64 compliance-
-- attachment blobs `signed_form_data` (loans) and `invoice_data` (purchase requests).
-- Those are merged into the archived Drive PDF instead of synced, so these tables must
-- NOT declare those columns — otherwise a pull would overwrite the local copy with NULL.
--
-- `photo_data` (the requested-equipment photo) DOES sync: it is core request
-- documentation that every user should see on screen and in the generated PDF.

CREATE TABLE IF NOT EXISTS equipment_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_number TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL DEFAULT 'OUTWARD' CHECK (direction IN ('OUTWARD', 'INWARD')),
  department TEXT NOT NULL CHECK (department IN ('camera', 'lights_grips')),
  person_or_org TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  loaned_date TEXT NOT NULL DEFAULT (CURRENT_DATE::TEXT),
  duration TEXT NOT NULL DEFAULT '',
  tentative_return_date TEXT,
  remarks TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PARTIAL', 'RETURNED')),
  created_by TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  drive_file_id TEXT,
  list_archived_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- equipment_id / asset_id intentionally carry NO foreign key to the catalog/asset
-- tables: a FK violation (23503) is treated as unrecoverable by the offline queue
-- and would silently drop the item from sync. Integrity is enforced locally.
CREATE TABLE IF NOT EXISTS equipment_loan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES equipment_loans(id) ON DELETE CASCADE,
  equipment_id UUID,
  asset_id UUID,
  item_name TEXT,
  status TEXT NOT NULL DEFAULT 'OUT' CHECK (status IN ('OUT', 'RETURNED')),
  returned_date TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('camera', 'lights_grips')),
  request_date TEXT NOT NULL DEFAULT (CURRENT_DATE::TEXT),
  requested_asset TEXT NOT NULL DEFAULT '',
  request_type TEXT NOT NULL DEFAULT 'NEW_EQUIPMENT' CHECK (request_type IN ('NEW_EQUIPMENT', 'ACCESSORY', 'SPARE_PART', 'REPLACEMENT', 'ADDITIONAL_INVENTORY')),
  current_quantity INTEGER NOT NULL DEFAULT 0,
  requested_quantity INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  photo_data TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'CANCELLED')),
  fulfilled_at TEXT,
  fulfilled_by TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  drive_file_id TEXT,
  list_archived_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  requested_asset TEXT NOT NULL DEFAULT '',
  request_type TEXT NOT NULL DEFAULT 'NEW_EQUIPMENT' CHECK (request_type IN ('NEW_EQUIPMENT', 'ACCESSORY', 'SPARE_PART', 'REPLACEMENT', 'ADDITIONAL_INVENTORY')),
  current_quantity INTEGER NOT NULL DEFAULT 0,
  requested_quantity INTEGER NOT NULL DEFAULT 1,
  supplier TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  photo_data TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent backfill so re-running this script after the tables already exist (e.g.
-- created before photo_data was synced) adds the column without recreating the table.
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS photo_data TEXT;
ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS photo_data TEXT;

CREATE INDEX IF NOT EXISTS idx_equipment_loans_department ON equipment_loans(department);
CREATE INDEX IF NOT EXISTS idx_equipment_loans_status ON equipment_loans(status);
CREATE INDEX IF NOT EXISTS idx_equipment_loan_items_loan ON equipment_loan_items(loan_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_department ON purchase_requests(department);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_request ON purchase_request_items(request_id);

-- Enable Realtime so edits propagate live to other users.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'equipment_loans', 'equipment_loan_items', 'purchase_requests', 'purchase_request_items'
  ]) LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- already published
    END;
  END LOOP;
END $$;

ALTER TABLE equipment_loans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for equipment_loans" ON equipment_loans;
CREATE POLICY "Allow all for equipment_loans" ON equipment_loans FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE equipment_loan_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for equipment_loan_items" ON equipment_loan_items;
CREATE POLICY "Allow all for equipment_loan_items" ON equipment_loan_items FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for purchase_requests" ON purchase_requests;
CREATE POLICY "Allow all for purchase_requests" ON purchase_requests FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE purchase_request_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for purchase_request_items" ON purchase_request_items;
CREATE POLICY "Allow all for purchase_request_items" ON purchase_request_items FOR ALL USING (true) WITH CHECK (true);
