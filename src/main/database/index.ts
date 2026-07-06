import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { runMigrations } from './migrate';
import { migrateInRowBlobsToFiles } from '../blob-store';

let db: any = null;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored || typeof stored !== 'string' || stored.length === 0) return false;
  if (!stored.includes(':')) {
    const legacy = crypto.createHash('sha256').update(password).digest('hex');
    return legacy === stored;
  }
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    const storedBuf = Buffer.from(hash, 'hex');
    const derivedBuf = Buffer.from(derived, 'hex');
    if (storedBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(storedBuf, derivedBuf);
  } catch {
    return false;
  }
}

function getSchemaPath(): string {
  if (app.isPackaged) {
    return path.join((process as any).resourcesPath, 'database', 'schema.sql');
  }
  return path.join(__dirname, '../../../database/schema.sql');
}

function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'cmb-eim.db');
}

function getDatabaseFilePath(): string {
  return getDatabasePath();
}

function initializeDatabase(): void {
  const dbPath = getDatabasePath();
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const schemaPath = getSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  runMigrations(db);
  // Drain any legacy in-row base64 attachments to on-disk files (idempotent).
  migrateInRowBlobsToFiles(db);
  seedDataIfEmpty();
  ensureAdminRecoverable();
  // Pre-seeded department manager/crew accounts use well-known default passwords and
  // are development conveniences only. They must NEVER be created in a packaged
  // (production) build, where they would be a standing credential backdoor.
  if (!app.isPackaged) {
    ensureDepartmentManagers();
    ensureDepartmentCrew();
  }
  warnIfDefaultAdminPassword();
}

// Surface a loud warning when a packaged build is still running on the default
// bootstrap admin password. The account must exist for first login, but leaving
// it on the shipped default in production is a security risk the operator needs
// to resolve by changing it in Settings → Users.
function warnIfDefaultAdminPassword(): void {
  if (!app.isPackaged) return;
  try {
    const admin: any = db.prepare("SELECT password_hash FROM users WHERE username = 'admin' AND is_active = 1").get();
    if (admin && verifyPassword('admin123', admin.password_hash)) {
      console.warn(
        '[SECURITY] The default administrator password is still in use. ' +
        'Change it immediately in Settings → Users before deploying to users.',
      );
    }
  } catch { /* non-fatal */ }
}

function seedDataIfEmpty(): void {
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (categoryCount.count > 0 || userCount.count > 0) return;

  const insertCategory = db.prepare(
    'INSERT INTO categories (id, name, display_order, is_active) VALUES (?, ?, ?, 1)'
  );
  const insertSubcategory = db.prepare(
    'INSERT INTO subcategories (id, category_id, name, display_order, is_active) VALUES (?, ?, ?, ?, 1)'
  );
  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, full_name, email, role, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  );

  const seed = db.transaction(() => {
    const catCamera = uuidv4();
    const catDollies = uuidv4();
    const catLightsGrips = uuidv4();
    const catPowerTransport = uuidv4();
    const catSpecial = uuidv4();

    insertCategory.run(catCamera, 'Camera', 1);
    insertCategory.run(catDollies, 'Dollies Mounts & Cranes', 2);
    insertCategory.run(catLightsGrips, 'Lights and Grips', 3);
    insertCategory.run(catPowerTransport, 'Power & Transport', 4);
    insertCategory.run(catSpecial, 'Special Equipment', 5);

    // Camera subcategories
    insertSubcategory.run(uuidv4(), catCamera, 'Camera Body', 1);
    insertSubcategory.run(uuidv4(), catCamera, 'Camera Support', 2);
    insertSubcategory.run(uuidv4(), catCamera, 'Filters', 3);
    insertSubcategory.run(uuidv4(), catCamera, 'Lens', 4);
    insertSubcategory.run(uuidv4(), catCamera, 'Special Rig', 5);
    insertSubcategory.run(uuidv4(), catCamera, 'Video Peripherals', 6);
    insertSubcategory.run(uuidv4(), catCamera, 'Camera Package Components', 7);
    insertSubcategory.run(uuidv4(), catCamera, 'Cables', 8);
    insertSubcategory.run(uuidv4(), catCamera, 'Power Supply & Battery', 9);

    // Lights and Grips subcategories
    insertSubcategory.run(uuidv4(), catLightsGrips, 'Grip', 1);
    insertSubcategory.run(uuidv4(), catLightsGrips, 'Lighting', 2);

    // Dollies subcategories
    insertSubcategory.run(uuidv4(), catDollies, 'Crane', 1);
    insertSubcategory.run(uuidv4(), catDollies, 'Dolly', 2);
    insertSubcategory.run(uuidv4(), catDollies, 'Motorized Dolly', 3);
    insertSubcategory.run(uuidv4(), catDollies, 'Mounts', 4);
    insertSubcategory.run(uuidv4(), catDollies, 'Tracks', 5);
    insertSubcategory.run(uuidv4(), catDollies, 'Slider/Table Top Dolly', 6);

    // Power & Transport subcategories
    insertSubcategory.run(uuidv4(), catPowerTransport, 'Power', 1);
    insertSubcategory.run(uuidv4(), catPowerTransport, 'Transport', 2);

    // Special Equipment subcategories
    insertSubcategory.run(uuidv4(), catSpecial, 'SFX & Others', 1);

    // Admin user
    insertUser.run(uuidv4(), 'admin', hashPassword('admin123'), 'System Administrator', 'admin@cmbfilmservices.com', 'admin');
  });

  seed();
}

function ensureAdminRecoverable(): void {
  try {
    const admin: any = db.prepare("SELECT id, password_hash FROM users WHERE username = 'admin'").get();
    if (!admin) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, email, role, is_active, created_at, updated_at)
         VALUES (?, 'admin', ?, 'System Administrator', 'admin@cmbfilmservices.com', 'admin', 1, ?, ?)`
      ).run(uuidv4(), hashPassword('admin123'), now, now);
      return;
    }

    const hash = admin.password_hash;
    const isValid = typeof hash === 'string'
      && hash.length > 0
      && hash.includes(':')
      && hash.split(':')[0]!.length === 32
      && hash.split(':')[1]!.length === 128;

    if (!isValid) {
      db.prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE username = 'admin'")
        .run(hashPassword('admin123'));
    }
  } catch (err) {
    console.error('[DB] ensureAdminRecoverable failed:', err);
  }
}

function ensureDepartmentManagers(): void {
  try {
    const now = new Date().toISOString();
    const camMgr: any = db.prepare("SELECT id FROM users WHERE username = 'camera_mgr'").get();
    if (!camMgr) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, email, role, department, is_active, created_at, updated_at)
         VALUES (?, 'camera_mgr', ?, 'Camera Equipment Manager', 'camera@cmbfilmservices.com', 'equipment_manager', 'camera', 1, ?, ?)`
      ).run(uuidv4(), hashPassword('camera123'), now, now);
    }
    const lgMgr: any = db.prepare("SELECT id FROM users WHERE username = 'lighting_mgr'").get();
    if (!lgMgr) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, email, role, department, is_active, created_at, updated_at)
         VALUES (?, 'lighting_mgr', ?, 'Lighting Equipment Manager', 'lighting@cmbfilmservices.com', 'equipment_manager', 'lights_grips', 1, ?, ?)`
      ).run(uuidv4(), hashPassword('lighting123'), now, now);
    }
  } catch (err) {
    console.error('[DB] ensureDepartmentManagers failed:', err);
  }
}

// Department crew test users — each scoped to a single department so they can
// run their department's workflow (tickets, loans, parts, vendors) but never
// see or act on the other department's data.
function ensureDepartmentCrew(): void {
  try {
    const now = new Date().toISOString();
    const camCrew: any = db.prepare("SELECT id FROM users WHERE username = 'camcrew'").get();
    if (!camCrew) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, email, role, department, is_active, created_at, updated_at)
         VALUES (?, 'camcrew', ?, 'Camera Department Crew', 'camcrew@cmbfilmservices.com', 'equipment_manager', 'camera', 1, ?, ?)`
      ).run(uuidv4(), hashPassword('camcrew123'), now, now);
    }
    const lgCrew: any = db.prepare("SELECT id FROM users WHERE username = 'lgcrew'").get();
    if (!lgCrew) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, email, role, department, is_active, created_at, updated_at)
         VALUES (?, 'lgcrew', ?, 'Lights & Grips Department Crew', 'lgcrew@cmbfilmservices.com', 'equipment_manager', 'lights_grips', 1, ?, ?)`
      ).run(uuidv4(), hashPassword('lgcrew123'), now, now);
    }
  } catch (err) {
    console.error('[DB] ensureDepartmentCrew failed:', err);
  }
}

function getDatabase(): any {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export { initializeDatabase, getDatabase, getDatabaseFilePath, hashPassword, verifyPassword };
