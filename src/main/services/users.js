import { getDb } from '../db/index.js';
import { hashPassword } from './passwords.js';
import { requireSession } from './auth.js';
import { ValidationError } from '../../shared/errors.js';

const ROLES = new Set(['administrator', 'product_manager', 'seller']);

export function listUsers({ q = '', role, activeOnly, offset = 0, limit = 50 } = {}) {
  requireSession('administrator');

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];

  const trimmed = String(q || '').trim();
  if (trimmed) {
    where.push('login LIKE ? COLLATE NOCASE');
    args.push(`%${trimmed}%`);
  }
  if (role && ROLES.has(role)) {
    where.push('role = ?');
    args.push(role);
  }
  if (activeOnly === true) {
    where.push('is_active = 1');
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM users ${whereSql}`
  ).get(...args).n;

  const rows = db.prepare(
    `SELECT id, login, role, is_active, created_at
       FROM users
       ${whereSql}
      ORDER BY is_active DESC, login COLLATE NOCASE
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

export function createUser({ login, password, role }) {
  requireSession('administrator');
  if (!login?.trim())  throw new ValidationError('login required');
  if (!password)       throw new ValidationError('password required');
  if (!ROLES.has(role)) throw new ValidationError('bad role');

  try {
    const info = getDb().prepare(
      `INSERT INTO users (login, password_hash, role) VALUES (?, ?, ?)`
    ).run(login.trim(), hashPassword(password), role);
    return getUser(Number(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ValidationError('login already exists');
    throw e;
  }
}

export function updateUser(id, { login, password, role, is_active }) {
  requireSession('administrator');
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM users WHERE id = ?`).get(id);
  if (!existing) throw new ValidationError('user not found');

  const demotingOrDeactivating =
    (role !== undefined && role !== 'administrator') ||
    (is_active !== undefined && is_active === false);
  if (demotingOrDeactivating) {
    const admins = db.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role='administrator' AND is_active=1`
    ).get().n;
    const wasAdmin = db.prepare(
      `SELECT role, is_active FROM users WHERE id = ?`
    ).get(id);
    if (wasAdmin.role === 'administrator' && wasAdmin.is_active === 1 && admins <= 1) {
      throw new ValidationError('cannot demote or deactivate the last administrator');
    }
  }

  try {
    if (login !== undefined) {
      if (!login.trim()) throw new ValidationError('login required');
      db.prepare(`UPDATE users SET login = ? WHERE id = ?`).run(login.trim(), id);
    }
    if (password !== undefined) {
      if (!password) throw new ValidationError('password required');
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
        .run(hashPassword(password), id);
    }
    if (role !== undefined) {
      if (!ROLES.has(role)) throw new ValidationError('bad role');
      db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, id);
    }
    if (is_active !== undefined) {
      db.prepare(`UPDATE users SET is_active = ? WHERE id = ?`)
        .run(is_active ? 1 : 0, id);
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ValidationError('login already exists');
    throw e;
  }

  return getUser(id);
}

export function setActive(userId, isActive) {
  requireSession('administrator');
  return updateUser(userId, { is_active: !!isActive });
}

function getUser(id) {
  return getDb().prepare(
    `SELECT id, login, role, is_active, created_at FROM users WHERE id = ?`
  ).get(id);
}
