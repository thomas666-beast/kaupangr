import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { ValidationError } from '../../shared/errors.js';

export function listStores({ q = '', activeOnly, offset = 0, limit = 50 } = {}) {
  requireSession();

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];

  const trimmed = String(q || '').trim();
  if (trimmed) {
    const like = `%${trimmed}%`;
    where.push('(name LIKE ? COLLATE NOCASE OR address LIKE ? COLLATE NOCASE)');
    args.push(like, like);
  }
  if (activeOnly === true) {
    where.push('is_active = 1');
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM stores ${whereSql}`
  ).get(...args).n;

  const rows = db.prepare(
    `SELECT id, name, address, is_active, created_at
       FROM stores
       ${whereSql}
      ORDER BY is_active DESC, name COLLATE NOCASE
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

export function createStore({ name, address = null }) {
  requireSession('administrator', 'product_manager');
  if (!name?.trim()) throw new ValidationError('name required');
  const db = getDb();
  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO stores (name, address) VALUES (?, ?)`
    ).run(name.trim(), address);
    const id = Number(info.lastInsertRowid);
    const row = getStore(id);
    enqueue(db, 'store', id, 'upsert', row);
    return row;
  });
  return tx();
}

export function updateStore(id, { name, address }) {
  requireSession('administrator', 'product_manager');
  const db = getDb();
  if (!db.prepare(`SELECT id FROM stores WHERE id = ?`).get(id))
    throw new ValidationError('store not found');

  const tx = db.transaction(() => {
    if (name !== undefined) {
      if (!name.trim()) throw new ValidationError('name required');
      db.prepare(`UPDATE stores SET name = ? WHERE id = ?`).run(name.trim(), id);
    }
    if (address !== undefined) {
      db.prepare(`UPDATE stores SET address = ? WHERE id = ?`).run(address, id);
    }
    const row = getStore(id);
    enqueue(db, 'store', id, 'upsert', row);
    return row;
  });
  return tx();
}

export function setStoreActive(id, active) {
  requireSession('administrator', 'product_manager');
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE stores SET is_active = ? WHERE id = ?`)
      .run(active ? 1 : 0, id);
    const row = getStore(id);
    enqueue(db, 'store', id, 'upsert', row);
    return row;
  });
  return tx();
}

function getStore(id) {
  return getDb().prepare(
    `SELECT id, name, address, is_active, created_at FROM stores WHERE id = ?`
  ).get(id);
}
