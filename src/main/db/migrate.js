import fs from 'node:fs';
import path from 'node:path';

/**
 * Apply pending migrations from `dir` to `db`.
 * Creates `schema_migrations` if missing. Idempotent.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} dir  absolute path to a folder of *.sql files
 */
export function runMigrations(db, dir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name)
  );

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  const insert = db.prepare(
    'INSERT INTO schema_migrations (name) VALUES (?)'
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    });
    tx();
  }
}
