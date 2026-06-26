import { randomUUID } from 'node:crypto';

interface Migration {
  id: string;
  up: (db: any) => void;
}

function indexExists(db: any, index: string): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name=?"
  ).get(index);
  return row.count > 0;
}

function columnExists(db: any, table: string, column: string): boolean {
  const cols: any[] = db.pragma(`table_info(${table})`);
  return cols.some((c: any) => c.name === column);
}

function tableExists(db: any, table: string): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table);
  return row.count > 0;
}

const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_eim_setup',
    up: (_db: any) => {
      // schema.sql handles initial table creation
    },
  },
  {
    id: '002_version_columns',
    up: (db: any) => {
      for (const table of ['equipment_items', 'package_definitions', 'users']) {
        if (!columnExists(db, table, 'version')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
        }
      }
    },
  },
  {
    id: '003_equipment_quantity',
    up: (db: any) => {
      if (!columnExists(db, 'equipment_items', 'quantity')) {
        db.exec(`ALTER TABLE equipment_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`);
      }
      if (!columnExists(db, 'equipment_items', 'available_qty')) {
        db.exec(`ALTER TABLE equipment_items ADD COLUMN available_qty INTEGER NOT NULL DEFAULT 1`);
      }
    },
  },
  {
    id: '004_incident_report_fields',
    up: (db: any) => {
      for (const col of ['project_name', 'production_name', 'project_date', 'verified_by']) {
        if (!columnExists(db, 'maintenance_tickets', col)) {
          db.exec(`ALTER TABLE maintenance_tickets ADD COLUMN ${col} TEXT`);
        }
      }
      if (!columnExists(db, 'maintenance_tickets', 'document_type')) {
        db.exec(`ALTER TABLE maintenance_tickets ADD COLUMN document_type TEXT NOT NULL DEFAULT 'repair'`);
      }
      if (!tableExists(db, 'ticket_actions')) {
        db.exec(`CREATE TABLE ticket_actions (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
          action_date TEXT NOT NULL DEFAULT (date('now')),
          action_taken TEXT NOT NULL DEFAULT '',
          remarks TEXT NOT NULL DEFAULT '',
          personnel TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec(`CREATE INDEX idx_ticket_actions_ticket ON ticket_actions(ticket_id)`);
      }
    },
  },
  {
    id: '005_department_field',
    up: (db: any) => {
      for (const table of ['users', 'parts_catalog', 'vendors']) {
        if (!columnExists(db, table, 'department')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN department TEXT`);
        }
      }
    },
  },
  {
    id: '006_expand_maintenance_type_check',
    up: (db: any) => {
      // Check if the constraint is already correct by testing an insert
      const needsFix = (() => {
        try {
          const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='maintenance_tickets'").get();
          if (sql && sql.sql && sql.sql.includes("'routine_maintenance'")) return false;
          return true;
        } catch { return true; }
      })();
      if (!needsFix) return;

      db.pragma('foreign_keys = OFF');

      // Get actual columns from existing table
      const cols: any[] = db.pragma('table_info(maintenance_tickets)');
      const colNames = cols.map((c: any) => c.name);

      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_tickets_new (
          id TEXT PRIMARY KEY,
          ticket_number TEXT NOT NULL UNIQUE,
          equipment_id TEXT NOT NULL REFERENCES equipment_items(id),
          asset_id TEXT REFERENCES equipment_assets(id),
          reported_by TEXT NOT NULL,
          reported_date TEXT NOT NULL DEFAULT (datetime('now')),
          issue_description TEXT NOT NULL,
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
          post_repair_grade TEXT,
          project_name TEXT,
          production_name TEXT,
          project_date TEXT,
          verified_by TEXT,
          document_type TEXT NOT NULL DEFAULT 'repair',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Only copy columns that exist in both tables
      const targetCols = ['id','ticket_number','equipment_id','asset_id','reported_by','reported_date',
        'issue_description','severity','repair_status','maintenance_type','assigned_technician',
        'diagnosis','estimated_cost','actual_cost','labor_hours','parts_consumed','priority_order',
        'completion_date','post_repair_grade','project_name','production_name','project_date',
        'verified_by','document_type','created_at','updated_at'];
      const safeCols = targetCols.filter(c => colNames.includes(c));
      const colList = safeCols.join(', ');

      db.exec(`INSERT INTO maintenance_tickets_new (${colList}) SELECT ${colList} FROM maintenance_tickets`);
      db.exec(`DROP TABLE maintenance_tickets`);
      db.exec(`ALTER TABLE maintenance_tickets_new RENAME TO maintenance_tickets`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment ON maintenance_tickets(equipment_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(repair_status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_severity ON maintenance_tickets(severity)`);
      db.pragma('foreign_keys = ON');
    },
  },
  {
    id: '007_add_equipment_manager_role',
    up: (db: any) => {
      const tableSql: any = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!tableSql || tableSql.sql.includes("'equipment_manager'")) return;

      db.pragma('foreign_keys = OFF');
      const colsInfo: any[] = db.pragma('table_info(users)');
      const colNames = colsInfo.map((c: any) => c.name);

      db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK (role IN ('admin', 'equipment_manager', 'accounts_manager', 'billing_user', 'payroll_user', 'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk', 'viewer')),
          department TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      const targetCols = ['id','username','password_hash','full_name','email','role','department','is_active','version','created_at','updated_at'];
      const safeCols = targetCols.filter(c => colNames.includes(c));
      const colList = safeCols.join(', ');

      db.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`);
      db.exec(`DROP TABLE users`);
      db.exec(`ALTER TABLE users_new RENAME TO users`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active)`);
      db.pragma('foreign_keys = ON');
    },
  },
  {
    id: '008_add_dept_personnel_roles',
    up: (db: any) => {
      const tableSql: any = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!tableSql || tableSql.sql.includes("'camera_personnel'")) return;

      db.pragma('foreign_keys = OFF');
      const colsInfo: any[] = db.pragma('table_info(users)');
      const colNames = colsInfo.map((c: any) => c.name);

      db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK (role IN ('admin', 'equipment_manager', 'accounts_manager', 'billing_user', 'payroll_user', 'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk', 'camera_personnel', 'lighting_personnel', 'viewer')),
          department TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      const targetCols = ['id','username','password_hash','full_name','email','role','department','is_active','version','created_at','updated_at'];
      const safeCols = targetCols.filter(c => colNames.includes(c));
      const colList = safeCols.join(', ');

      db.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`);
      db.exec(`DROP TABLE users`);
      db.exec(`ALTER TABLE users_new RENAME TO users`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active)`);
      db.pragma('foreign_keys = ON');
    },
  },
  {
    id: '009_completion_outcome',
    up: (db: any) => {
      if (!columnExists(db, 'maintenance_tickets', 'completion_outcome')) {
        db.exec(`ALTER TABLE maintenance_tickets ADD COLUMN completion_outcome TEXT`);
      }
    },
  },
  {
    id: '010_completion_outcome_constraints',
    up: (db: any) => {
      // Rebuild maintenance_tickets so the CHECK constraints for completion_outcome
      // and the widened document_type ('loss') match a fresh schema.sql install.
      const tableSql: any = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='maintenance_tickets'").get();
      if (!tableSql || tableSql.sql.includes("'loss'")) return;

      db.pragma('foreign_keys = OFF');
      const cols: any[] = db.pragma('table_info(maintenance_tickets)');
      const colNames = cols.map((c: any) => c.name);

      db.exec(`
        CREATE TABLE maintenance_tickets_new (
          id TEXT PRIMARY KEY,
          ticket_number TEXT NOT NULL UNIQUE,
          equipment_id TEXT NOT NULL REFERENCES equipment_items(id),
          asset_id TEXT REFERENCES equipment_assets(id),
          reported_by TEXT NOT NULL,
          reported_date TEXT NOT NULL DEFAULT (datetime('now')),
          issue_description TEXT NOT NULL,
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
          completion_outcome TEXT CHECK (completion_outcome IN ('repaired', 'unrepairable', 'total_loss', 'found', 'not_found') OR completion_outcome IS NULL),
          post_repair_grade TEXT CHECK (post_repair_grade IN ('A', 'B', 'C', 'D') OR post_repair_grade IS NULL),
          project_name TEXT,
          production_name TEXT,
          project_date TEXT,
          verified_by TEXT,
          document_type TEXT NOT NULL DEFAULT 'repair' CHECK (document_type IN ('maintenance', 'repair', 'update', 'loss')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      const targetCols = ['id','ticket_number','equipment_id','asset_id','reported_by','reported_date',
        'issue_description','severity','repair_status','maintenance_type','assigned_technician',
        'diagnosis','estimated_cost','actual_cost','labor_hours','parts_consumed','priority_order',
        'completion_date','completion_outcome','post_repair_grade','project_name','production_name',
        'project_date','verified_by','document_type','created_at','updated_at'];
      const safeCols = targetCols.filter(c => colNames.includes(c));
      const colList = safeCols.join(', ');

      db.exec(`INSERT INTO maintenance_tickets_new (${colList}) SELECT ${colList} FROM maintenance_tickets`);
      db.exec(`DROP TABLE maintenance_tickets`);
      db.exec(`ALTER TABLE maintenance_tickets_new RENAME TO maintenance_tickets`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment ON maintenance_tickets(equipment_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(repair_status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_severity ON maintenance_tickets(severity)`);
      db.pragma('foreign_keys = ON');
    },
  },
  {
    id: '011_equipment_loans',
    up: (db: any) => {
      if (!tableExists(db, 'equipment_loans')) {
        db.exec(`CREATE TABLE equipment_loans (
          id TEXT PRIMARY KEY,
          loan_number TEXT UNIQUE NOT NULL,
          department TEXT NOT NULL CHECK (department IN ('camera', 'lights_grips')),
          person_or_org TEXT NOT NULL DEFAULT '',
          purpose TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          loaned_date TEXT NOT NULL DEFAULT (date('now')),
          duration TEXT NOT NULL DEFAULT '',
          tentative_return_date TEXT,
          remarks TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PARTIAL', 'RETURNED')),
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_loans_department ON equipment_loans(department)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_loans_status ON equipment_loans(status)`);
      }
      if (!tableExists(db, 'equipment_loan_items')) {
        db.exec(`CREATE TABLE equipment_loan_items (
          id TEXT PRIMARY KEY,
          loan_id TEXT NOT NULL REFERENCES equipment_loans(id) ON DELETE CASCADE,
          equipment_id TEXT NOT NULL REFERENCES equipment_items(id),
          asset_id TEXT REFERENCES equipment_assets(id),
          status TEXT NOT NULL DEFAULT 'OUT' CHECK (status IN ('OUT', 'RETURNED')),
          returned_date TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_loan_items_loan ON equipment_loan_items(loan_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_loan_items_equipment ON equipment_loan_items(equipment_id)`);
      }
    },
  },
  {
    // Add inward/outward loan direction and support free-text (external) loan items.
    id: '012_loan_inward_outward',
    up: (db: any) => {
      if (tableExists(db, 'equipment_loans') && !columnExists(db, 'equipment_loans', 'direction')) {
        db.exec(`ALTER TABLE equipment_loans ADD COLUMN direction TEXT NOT NULL DEFAULT 'OUTWARD' CHECK (direction IN ('OUTWARD', 'INWARD'))`);
      }
      // INWARD items have no catalog reference, so equipment_id must become nullable and
      // a free-text item_name column is added. SQLite can't relax NOT NULL in place, so the
      // table is rebuilt with the relaxed schema while preserving existing rows.
      if (tableExists(db, 'equipment_loan_items')) {
        const needsRebuild = !columnExists(db, 'equipment_loan_items', 'item_name');
        if (needsRebuild) {
          db.pragma('foreign_keys = OFF');
          db.exec(`CREATE TABLE equipment_loan_items_new (
            id TEXT PRIMARY KEY,
            loan_id TEXT NOT NULL REFERENCES equipment_loans(id) ON DELETE CASCADE,
            equipment_id TEXT REFERENCES equipment_items(id),
            asset_id TEXT REFERENCES equipment_assets(id),
            item_name TEXT,
            status TEXT NOT NULL DEFAULT 'OUT' CHECK (status IN ('OUT', 'RETURNED')),
            returned_date TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`);
          db.exec(`INSERT INTO equipment_loan_items_new (id, loan_id, equipment_id, asset_id, item_name, status, returned_date, notes, created_at)
            SELECT id, loan_id, equipment_id, asset_id, NULL, status, returned_date, notes, created_at FROM equipment_loan_items`);
          db.exec(`DROP TABLE equipment_loan_items`);
          db.exec(`ALTER TABLE equipment_loan_items_new RENAME TO equipment_loan_items`);
          db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_loan_items_loan ON equipment_loan_items(loan_id)`);
          db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_loan_items_equipment ON equipment_loan_items(equipment_id)`);
          db.pragma('foreign_keys = ON');
        }
      }
    },
  },
  {
    // Optional delivery date for assets (when the equipment was actually delivered/received).
    id: '013_asset_delivered_date',
    up: (db: any) => {
      if (tableExists(db, 'equipment_assets') && !columnExists(db, 'equipment_assets', 'delivered_date')) {
        db.exec(`ALTER TABLE equipment_assets ADD COLUMN delivered_date TEXT`);
      }
    },
  },
  {
    // Internal-only monitoring notes on a loan. Never printed on the release form.
    id: '014_loan_internal_notes',
    up: (db: any) => {
      if (tableExists(db, 'equipment_loans') && !columnExists(db, 'equipment_loans', 'internal_notes')) {
        db.exec(`ALTER TABLE equipment_loans ADD COLUMN internal_notes TEXT NOT NULL DEFAULT ''`);
      }
    },
  },
  {
    // Move from one asset row per equipment to one asset row per unit of quantity.
    // The old unique index enforced a strict 1:1 relationship; drop it and recreate
    // as a plain (non-unique) index so each unit can have its own asset record.
    // Backfill: top up each item to `quantity` unit rows (cloning the original asset's
    // supplier/dates but blanking the per-unit serial), then derive available_qty from
    // the per-unit AVAILABLE status counts.
    id: '015_multi_unit_assets',
    up: (db: any) => {
      if (!tableExists(db, 'equipment_assets')) return;

      if (indexExists(db, 'idx_equipment_assets_equipment_id')) {
        db.exec(`DROP INDEX idx_equipment_assets_equipment_id`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_assets_equipment_id ON equipment_assets(equipment_id)`);

      const now = new Date().toISOString();
      const items: any[] = db.prepare('SELECT id, quantity FROM equipment_items').all();
      for (const item of items) {
        const targetQty = Math.max(1, item.quantity || 1);
        const assets: any[] = db.prepare('SELECT * FROM equipment_assets WHERE equipment_id = ? ORDER BY created_at').all(item.id);
        const template = assets[0];
        const toCreate = targetQty - assets.length;
        for (let i = 0; i < toCreate; i++) {
          db.prepare(`
            INSERT INTO equipment_assets (id, equipment_id, serial_number, asset_tag, purchase_date, delivered_date, purchase_price, vendor_name, warranty_expiry, current_location, current_status, created_at, updated_at)
            VALUES (?, ?, '', NULL, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
          `).run(
            randomUUID(), item.id,
            template?.purchase_date ?? null,
            template?.delivered_date ?? null,
            template?.purchase_price ?? 0,
            template?.vendor_name ?? null,
            template?.warranty_expiry ?? null,
            template?.current_location ?? 'Warehouse',
            now, now,
          );
        }
        const avail: any = db.prepare(
          "SELECT COUNT(*) as count FROM equipment_assets WHERE equipment_id = ? AND current_status = 'AVAILABLE'"
        ).get(item.id);
        const totalUnits: any = db.prepare(
          'SELECT COUNT(*) as count FROM equipment_assets WHERE equipment_id = ?'
        ).get(item.id);
        db.prepare("UPDATE equipment_items SET quantity = ?, available_qty = ?, updated_at = datetime('now') WHERE id = ?")
          .run(totalUnits.count, avail.count, item.id);
      }
    },
  },
  {
    // Reconcile legacy open tickets (created before per-unit assets) so they hold a
    // unit out of service. Without this, an open ticket whose asset_id is NULL no
    // longer reduces availability after the multi-unit backfill. For each such ticket,
    // claim one AVAILABLE unit, set it to the matching status, link it, and recompute.
    id: '016_link_open_tickets_to_units',
    up: (db: any) => {
      if (!tableExists(db, 'maintenance_tickets') || !tableExists(db, 'equipment_assets')) return;

      const openTickets: any[] = db.prepare(`
        SELECT id, equipment_id, repair_status, document_type
        FROM maintenance_tickets
        WHERE repair_status NOT IN ('COMPLETED', 'CANCELLED') AND (asset_id IS NULL OR asset_id = '')
      `).all();

      const affected = new Set<string>();
      for (const ticket of openTickets) {
        const unit: any = db.prepare(
          "SELECT id, current_status FROM equipment_assets WHERE equipment_id = ? AND current_status = 'AVAILABLE' ORDER BY created_at, id LIMIT 1",
        ).get(ticket.equipment_id);
        if (!unit) continue; // nothing available to reserve; leave as-is

        const newStatus = ticket.repair_status === 'IN_PROGRESS' ? 'IN_REPAIR' : 'FOR_INSPECTION';
        db.prepare("UPDATE equipment_assets SET current_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newStatus, unit.id);
        db.prepare('UPDATE maintenance_tickets SET asset_id = ? WHERE id = ?').run(unit.id, ticket.id);
        db.prepare(`
          INSERT INTO asset_status_log (id, asset_id, equipment_id, previous_status, new_status, changed_by, reason, related_ticket_id)
          VALUES (?, ?, ?, 'AVAILABLE', ?, 'System (migration)', 'Reserved for existing open ticket', ?)
        `).run(randomUUID(), unit.id, ticket.equipment_id, newStatus, ticket.id);
        affected.add(ticket.equipment_id);
      }

      for (const equipmentId of affected) {
        const avail: any = db.prepare(
          "SELECT COUNT(*) as count FROM equipment_assets WHERE equipment_id = ? AND current_status = 'AVAILABLE'",
        ).get(equipmentId);
        const total: any = db.prepare(
          "SELECT COUNT(*) as count FROM equipment_assets WHERE equipment_id = ? AND current_status NOT IN ('RETIRED', 'MISSING')",
        ).get(equipmentId);
        db.prepare("UPDATE equipment_items SET quantity = ?, available_qty = ?, updated_at = datetime('now') WHERE id = ?")
          .run(total.count, avail.count, equipmentId);
      }
    },
  },
  {
    // Standalone purchase-request tracking table. Existing installs do not re-run
    // schema.sql for brand-new tables, so create it here as well (idempotent).
    id: '017_purchase_requests',
    up: (db: any) => {
      if (tableExists(db, 'purchase_requests')) return;
      db.exec(`
        CREATE TABLE IF NOT EXISTS purchase_requests (
          id TEXT PRIMARY KEY,
          request_number TEXT UNIQUE NOT NULL,
          department TEXT NOT NULL CHECK (department IN ('camera', 'lights_grips')),
          request_date TEXT NOT NULL DEFAULT (date('now')),
          requested_asset TEXT NOT NULL DEFAULT '',
          request_type TEXT NOT NULL DEFAULT 'NEW_EQUIPMENT' CHECK (request_type IN ('NEW_EQUIPMENT', 'ACCESSORY', 'SPARE_PART', 'REPLACEMENT', 'ADDITIONAL_INVENTORY')),
          current_quantity INTEGER NOT NULL DEFAULT 0,
          requested_quantity INTEGER NOT NULL DEFAULT 1,
          reason TEXT NOT NULL DEFAULT '',
          supplier TEXT NOT NULL DEFAULT '',
          amount REAL NOT NULL DEFAULT 0,
          photo_data TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'CANCELLED')),
          fulfilled_at TEXT,
          fulfilled_by TEXT,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_purchase_requests_department ON purchase_requests(department);
        CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
      `);
    },
  },
  {
    // Add an optional equipment photo to purchase requests. Stored as a base64 data
    // URL so it embeds directly into the printed request document. Installs that
    // created the table via migration 017 before this column existed need the ALTER.
    id: '018_purchase_requests_photo',
    up: (db: any) => {
      if (!tableExists(db, 'purchase_requests')) return;
      if (!columnExists(db, 'purchase_requests', 'photo_data')) {
        db.exec('ALTER TABLE purchase_requests ADD COLUMN photo_data TEXT');
      }
    },
  },
  {
    // Support multiple equipment line items per purchase request (1–5 per request).
    // The parent purchase_requests row keeps mirroring the first item for backward
    // compatibility. Existing single-item requests are backfilled as one line item.
    id: '019_purchase_request_items',
    up: (db: any) => {
      if (!tableExists(db, 'purchase_request_items')) {
        db.exec(`
          CREATE TABLE purchase_request_items (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
            requested_asset TEXT NOT NULL DEFAULT '',
            request_type TEXT NOT NULL DEFAULT 'NEW_EQUIPMENT' CHECK (request_type IN ('NEW_EQUIPMENT', 'ACCESSORY', 'SPARE_PART', 'REPLACEMENT', 'ADDITIONAL_INVENTORY')),
            current_quantity INTEGER NOT NULL DEFAULT 0,
            requested_quantity INTEGER NOT NULL DEFAULT 1,
            supplier TEXT NOT NULL DEFAULT '',
            amount REAL NOT NULL DEFAULT 0,
            photo_data TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_purchase_request_items_request ON purchase_request_items(request_id);
        `);
      }

      // Backfill: every existing request becomes a single line item mirroring its columns.
      if (tableExists(db, 'purchase_requests')) {
        const requests: any[] = db.prepare(`
          SELECT p.* FROM purchase_requests p
          WHERE NOT EXISTS (SELECT 1 FROM purchase_request_items i WHERE i.request_id = p.id)
        `).all();
        for (const r of requests) {
          db.prepare(`
            INSERT INTO purchase_request_items
              (id, request_id, requested_asset, request_type, current_quantity, requested_quantity, supplier, amount, photo_data, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
          `          ).run(
            randomUUID(), r.id, r.requested_asset || '', r.request_type || 'NEW_EQUIPMENT',
            r.current_quantity ?? 0, r.requested_quantity ?? 1, r.supplier || '', r.amount ?? 0,
            r.photo_data ?? null, r.created_at || new Date().toISOString(),
          );
        }
      }
    },
  },
  {
    // Google Drive auto-archive. Adds the config table (operator-visible fields only;
    // OAuth secrets live in the encrypted electron-store) and the archive bookkeeping
    // columns stamped when each workflow's completion document is uploaded to Drive.
    id: '020_drive_archive',
    up: (db: any) => {
      if (!tableExists(db, 'google_drive_config')) {
        db.exec(`
          CREATE TABLE google_drive_config (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL DEFAULT '',
            folder_id TEXT NOT NULL DEFAULT '',
            account_email TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
      }
      for (const table of ['maintenance_tickets', 'equipment_loans', 'purchase_requests']) {
        if (!tableExists(db, table)) continue;
        if (!columnExists(db, table, 'archived_at')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
        }
        if (!columnExists(db, table, 'drive_file_id')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN drive_file_id TEXT`);
        }
      }
    },
  },
  {
    // Operator-uploaded supporting document per workflow (image or PDF, stored as a
    // base64 data URL): the signed release form for loans, the purchase invoice for
    // purchase requests, and the service completion document for maintenance tickets.
    // Each is required before the workflow's closing action and is merged into the
    // archived Drive PDF. Kept local-only (not added to the cloud sync column lists).
    id: '021_workflow_attachments',
    up: (db: any) => {
      if (tableExists(db, 'equipment_loans') && !columnExists(db, 'equipment_loans', 'signed_form_data')) {
        db.exec('ALTER TABLE equipment_loans ADD COLUMN signed_form_data TEXT');
      }
      if (tableExists(db, 'purchase_requests') && !columnExists(db, 'purchase_requests', 'invoice_data')) {
        db.exec('ALTER TABLE purchase_requests ADD COLUMN invoice_data TEXT');
      }
      if (tableExists(db, 'maintenance_tickets') && !columnExists(db, 'maintenance_tickets', 'service_doc_data')) {
        db.exec('ALTER TABLE maintenance_tickets ADD COLUMN service_doc_data TEXT');
      }
    },
  },
];

export function runMigrations(db: any): void {
  if (!tableExists(db, 'schema_migrations')) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map(r => r.id)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
    } catch (err) {
      console.error(`[Migration] Failed to apply ${migration.id}:`, err);
      throw err;
    }
  }

  // Force-fix: if maintenance_type constraint is still the old one, re-run the fix
  try {
    const tableSql: any = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='maintenance_tickets'").get();
    if (tableSql && tableSql.sql && !tableSql.sql.includes("'routine_maintenance'")) {
      console.log('[Migration] Detected stale maintenance_type CHECK constraint, applying fix...');
      const fix = MIGRATIONS.find(m => m.id === '006_expand_maintenance_type_check');
      if (fix) fix.up(db);
    }
  } catch (err) {
    console.error('[Migration] Failed to force-fix maintenance_type constraint:', err);
  }
}
