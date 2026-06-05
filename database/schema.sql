-- CMB Equipment Inventory Management System
-- SQLite Schema (shared + EIM-specific tables)

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════
-- SHARED TABLES (compatible with Rental Request System)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment_items (
  id TEXT PRIMARY KEY,
  equipment_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  subcategory_id TEXT NOT NULL REFERENCES subcategories(id),
  sub_subcategory TEXT,
  item_type TEXT NOT NULL CHECK (item_type IN ('standalone', 'package_main', 'package_component', 'add_on')),
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('per_day', 'per_project', 'package_rate')),
  base_price REAL NOT NULL DEFAULT 0,
  notes TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  available_qty INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS package_definitions (
  id TEXT PRIMARY KEY,
  main_item_id TEXT NOT NULL REFERENCES equipment_items(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS package_items (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES package_definitions(id),
  component_id TEXT NOT NULL REFERENCES equipment_items(id),
  included_qty INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'accounts_manager', 'billing_user', 'payroll_user', 'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk', 'viewer')),
  department TEXT CHECK (department IN ('camera', 'lights_grips') OR department IS NULL),
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════
-- EIM-SPECIFIC TABLES
-- ═══════════════════════════════════════════════════════════════════

-- Extended asset data beyond the rental catalog
CREATE TABLE IF NOT EXISTS equipment_assets (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL DEFAULT '',
  asset_tag TEXT,
  purchase_date TEXT,
  purchase_price REAL NOT NULL DEFAULT 0,
  vendor_name TEXT,
  warranty_expiry TEXT,
  condition_grade TEXT NOT NULL DEFAULT 'A' CHECK (condition_grade IN ('A', 'B', 'C', 'D')),
  current_location TEXT NOT NULL DEFAULT 'Warehouse',
  current_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (current_status IN ('AVAILABLE', 'DEPLOYED', 'IN_REPAIR', 'ON_HOLD', 'IN_TRANSIT', 'RETIRED', 'MISSING', 'FOR_INSPECTION')),
  last_inspection_date TEXT,
  retirement_date TEXT,
  retirement_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_assets_equipment_id ON equipment_assets(equipment_id);

-- Audit trail of every status change
CREATE TABLE IF NOT EXISTS asset_status_log (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT NOT NULL DEFAULT '',
  related_ticket_id TEXT,
  related_project TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_asset_status_log_asset ON asset_status_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_status_log_equipment ON asset_status_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_asset_status_log_changed_at ON asset_status_log(changed_at);

-- Repair and maintenance work orders
CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id TEXT PRIMARY KEY,
  ticket_number TEXT UNIQUE NOT NULL,
  equipment_id TEXT NOT NULL REFERENCES equipment_items(id),
  asset_id TEXT REFERENCES equipment_assets(id),
  reported_by TEXT NOT NULL,
  reported_date TEXT NOT NULL DEFAULT (datetime('now')),
  issue_description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  repair_status TEXT NOT NULL DEFAULT 'REPORTED' CHECK (repair_status IN ('REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  maintenance_type TEXT NOT NULL DEFAULT 'repair' CHECK (maintenance_type IN ('routine_maintenance', 'update', 'repair', 'corrective', 'preventive', 'predictive')),
  assigned_technician TEXT,
  diagnosis TEXT,
  estimated_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  labor_hours REAL NOT NULL DEFAULT 0,
  parts_consumed TEXT NOT NULL DEFAULT '[]',
  priority_order INTEGER NOT NULL DEFAULT 0,
  completion_date TEXT,
  post_repair_grade TEXT CHECK (post_repair_grade IN ('A', 'B', 'C', 'D') OR post_repair_grade IS NULL),
  project_name TEXT,
  production_name TEXT,
  project_date TEXT,
  verified_by TEXT,
  document_type TEXT NOT NULL DEFAULT 'repair' CHECK (document_type IN ('maintenance', 'repair', 'update')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment ON maintenance_tickets(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(repair_status);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_severity ON maintenance_tickets(severity);

-- Time-stamped notes on repair tickets
CREATE TABLE IF NOT EXISTS maintenance_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  note_text TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'update' CHECK (note_type IN ('update', 'escalation', 'resolution', 'parts', 'status_change')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_maintenance_notes_ticket ON maintenance_notes(ticket_id);

-- Formal action log entries on tickets
CREATE TABLE IF NOT EXISTS ticket_actions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  action_date TEXT NOT NULL DEFAULT (date('now')),
  action_taken TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  personnel TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_actions_ticket ON ticket_actions(ticket_id);

-- Vendor/supplier records (must come before parts_catalog which references it)
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  notes TEXT,
  department TEXT CHECK (department IN ('camera', 'lights_grips') OR department IS NULL),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Master parts catalog
CREATE TABLE IF NOT EXISTS parts_catalog (
  id TEXT PRIMARY KEY,
  part_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'spare' CHECK (category IN ('spare', 'expendable', 'consumable', 'accessory')),
  unit_of_measure TEXT NOT NULL DEFAULT 'unit',
  unit_cost REAL NOT NULL DEFAULT 0,
  vendor_id TEXT REFERENCES vendors(id),
  department TEXT CHECK (department IN ('camera', 'lights_grips') OR department IS NULL),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Current stock levels
CREATE TABLE IF NOT EXISTS parts_inventory (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 5,
  reorder_qty INTEGER NOT NULL DEFAULT 10,
  location TEXT NOT NULL DEFAULT 'Main Warehouse',
  last_count_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_inventory_part ON parts_inventory(part_id);

-- All stock movements
CREATE TABLE IF NOT EXISTS parts_transactions (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts_catalog(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('receive', 'consume', 'adjust', 'return')),
  quantity INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  performed_by TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_parts_transactions_part ON parts_transactions(part_id);
CREATE INDEX IF NOT EXISTS idx_parts_transactions_type ON parts_transactions(transaction_type);

-- Maps parts to compatible equipment
CREATE TABLE IF NOT EXISTS parts_compatibility (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_compat_unique ON parts_compatibility(part_id, equipment_id);

-- Recurring maintenance schedules
CREATE TABLE IF NOT EXISTS preventive_schedules (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES equipment_assets(id),
  schedule_type TEXT NOT NULL DEFAULT 'calendar' CHECK (schedule_type IN ('calendar', 'usage')),
  interval_days INTEGER,
  interval_rentals INTEGER,
  description TEXT NOT NULL DEFAULT '',
  next_due_date TEXT,
  last_performed TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_preventive_schedules_equipment ON preventive_schedules(equipment_id);
CREATE INDEX IF NOT EXISTS idx_preventive_schedules_due ON preventive_schedules(next_due_date);

-- Offline sync queue
CREATE TABLE IF NOT EXISTS offline_queue (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  applied_to_cloud INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_metadata (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  last_sync_at TEXT,
  last_sync_version TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error'))
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_values TEXT,
  new_values TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- ═══════════════════════════════════════════════════════════════════
-- PERFORMANCE INDEXES
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_equipment_items_category ON equipment_items(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_items_subcategory ON equipment_items(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_equipment_items_code ON equipment_items(equipment_code);
CREATE INDEX IF NOT EXISTS idx_equipment_items_active ON equipment_items(is_active);
CREATE INDEX IF NOT EXISTS idx_equipment_items_active_category ON equipment_items(is_active, category_id);
CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active);
CREATE INDEX IF NOT EXISTS idx_package_items_package ON package_items(package_id);
CREATE INDEX IF NOT EXISTS idx_package_items_component ON package_items(component_id);
