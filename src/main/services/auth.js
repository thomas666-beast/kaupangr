import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { AuthError, ForbiddenError, ValidationError } from '../../shared/errors.js';

const MAX_FAILS_PER_WINDOW = 5;      // attempts
const WINDOW_MINUTES       = 5;      // look-back window
const COOLDOWN_SECONDS     = 60;     // lockout after the window is full

// Module-level: the one logged-in session in this desktop app.
let current = null;   // { sessionId, userId, login, role }

// ---------- bootstrapping ----------
export function ensureBootstrapAdmin() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const login = 'admin';
  const pw = process.env.KAUPANGR_ADMIN_PASSWORD || 'admin';
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES (?, ?, 'administrator')`
  ).run(login, hashPassword(pw));
  console.log(`[auth] bootstrapped admin (login=${login})`);
}

// ---------- login / logout ----------
export function login(loginName, password) {
  if (!loginName || !password) throw new ValidationError('login and password required');

  const db = getDb();

  // 1. Remove attempts older than the window.
  db.prepare(
    `DELETE FROM login_attempts
      WHERE datetime(attempted_at) <= datetime('now', ?)`
  ).run(`-${WINDOW_MINUTES} minutes`);

  // 2. Are we in cooldown for this login?
  const recentCount = db.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE login = ?`
  ).get(loginName).n;

  if (recentCount >= MAX_FAILS_PER_WINDOW) {
    const lastAttempt = db.prepare(
      `SELECT attempted_at FROM login_attempts
        WHERE login = ?
        ORDER BY id DESC LIMIT 1`
    ).get(loginName)?.attempted_at;
    if (lastAttempt) {
      const secondsSince = db.prepare(
        `SELECT (julianday('now') - julianday(?)) * 86400 AS s`
      ).get(lastAttempt).s;
      if (secondsSince < COOLDOWN_SECONDS) {
        throw new AuthError('Too many attempts. Wait a moment and try again.');
      }
    }
  }

  // 3. Look up the user + verify the password.
  const user = db.prepare(
    `SELECT id, login, password_hash, role, is_active FROM users WHERE login = ?`
  ).get(loginName);

  const credentialsOk = user && user.is_active && verifyPassword(password, user.password_hash);

  if (!credentialsOk) {
    db.prepare(`INSERT INTO login_attempts (login) VALUES (?)`).run(loginName);
    throw new AuthError('Invalid credentials');
  }

  // 4. Success: clear the counter for this login.
  db.prepare(`DELETE FROM login_attempts WHERE login = ?`).run(loginName);

  // 5. Open the session (kills any previous one).
  const tx = db.transaction(() => {
    db.prepare(`UPDATE sessions SET ended_at = datetime('now')
                WHERE user_id = ? AND ended_at IS NULL`).run(user.id);
    const info = db.prepare(`INSERT INTO sessions (user_id) VALUES (?)`).run(user.id);
    return info.lastInsertRowid;
  });
  const sessionId = tx();

  current = {
    sessionId: Number(sessionId),
    userId: user.id,
    login: user.login,
    role: user.role,
  };
  return { userId: current.userId, login: current.login, role: current.role };
}

export function logout() {
  if (!current) return;
  const db = getDb();
  db.prepare(`UPDATE sessions SET ended_at = datetime('now')
              WHERE id = ? AND ended_at IS NULL`).run(current.sessionId);
  current = null;
}

export function whoami() {
  return current
    ? { userId: current.userId, login: current.login, role: current.role }
    : null;
}

// ---------- guard used by every service / IPC handler ----------
export function requireSession(...allowedRoles) {
  if (!current) throw new AuthError();
  if (allowedRoles.length && !allowedRoles.includes(current.role)) {
    throw new ForbiddenError(`Role ${current.role} not allowed`);
  }
  return current;
}
