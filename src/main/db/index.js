import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db = null;
let userDataDirProvider = null;

/**
 * Called once by the Electron main process before getDb().
 * Not needed in tests.
 */
export function setUserDataDirProvider(fn) {
  userDataDirProvider = fn;
}

export function getDb() {
  if (db) return db;
  if (!userDataDirProvider) {
    throw new Error('getDb() called before setUserDataDirProvider(); call it in main.js');
  }

  const dataDir = userDataDirProvider();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'kaupangr.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

// -------- test-only --------
export function setDbForTesting(testDb) {
  if (db && db !== testDb) { try { db.close(); } catch {} }
  db = testDb;
}

export function resetDb() {
  if (db) { try { db.close(); } catch {} db = null; }
}
