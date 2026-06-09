interface Migration {
  id: string;
  up: (db: any) => void;
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
