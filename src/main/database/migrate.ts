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
}
