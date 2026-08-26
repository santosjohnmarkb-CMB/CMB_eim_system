import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { runMigrations, seedEquipmentHierarchy, pruneUnusedObsoleteCatalog } from './migrate';
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
  seedEquipmentHierarchy(db);
  pruneUnusedObsoleteCatalog(db);
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
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count > 0) return;

  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, full_name, email, role, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  );
  insertUser.run(uuidv4(), 'admin', hashPassword('admin123'), 'System Administrator', 'admin@cmbfilmservices.com', 'admin');
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
