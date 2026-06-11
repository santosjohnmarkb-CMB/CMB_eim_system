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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(equipment_id)
);

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_equipment_assets_status ON equipment_assets(current_status);
CREATE INDEX IF NOT EXISTS idx_asset_status_log_asset ON asset_status_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_status_log_equipment ON asset_status_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment ON maintenance_tickets(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(repair_status);
CREATE INDEX IF NOT EXISTS idx_parts_transactions_part ON parts_transactions(part_id);
CREATE INDEX IF NOT EXISTS idx_preventive_schedules_due ON preventive_schedules(next_due_date);

-- Enable Realtime for EIM tables
ALTER PUBLICATION supabase_realtime ADD TABLE equipment_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE asset_status_log;
ALTER PUBLICATION supabase_realtime ADD TABLE maintenance_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE maintenance_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE parts_catalog;
ALTER PUBLICATION supabase_realtime ADD TABLE parts_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE parts_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE vendors;

-- RLS policies (permissive for EIM app — tighten per deployment)
ALTER TABLE equipment_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for equipment_assets" ON equipment_assets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE asset_status_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for asset_status_log" ON asset_status_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE maintenance_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for maintenance_tickets" ON maintenance_tickets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE maintenance_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for maintenance_notes" ON maintenance_notes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for parts_catalog" ON parts_catalog FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for parts_inventory" ON parts_inventory FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for parts_transactions" ON parts_transactions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts_compatibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for parts_compatibility" ON parts_compatibility FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE preventive_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for preventive_schedules" ON preventive_schedules FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
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
CREATE POLICY "Allow all for ticket_actions" ON ticket_actions FOR ALL USING (true) WITH CHECK (true);

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
