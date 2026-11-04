import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { ValidationError } from '../../shared/errors.js';

export function listSuppliers({ q = '', activeOnly, offset = 0, limit = 50 } = {}) {
  requireSession();

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];

  const trimmed = String(q || '').trim();
  if (trimmed) {
    const like = `%${trimmed}%`;
    where.push('(name LIKE ? COLLATE NOCASE OR contact LIKE ? COLLATE NOCASE OR address LIKE ? COLLATE NOCASE)');
    args.push(like, like, like);
  }
  if (activeOnly === true) {
    where.push('is_active = 1');
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM suppliers ${whereSql}`
  ).get(...args).n;

  const rows = db.prepare(
    `SELECT id, name, contact, address, is_active, created_at
       FROM suppliers
       ${whereSql}
      ORDER BY is_active DESC, name COLLATE NOCASE
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

export function createSupplier({ name, contact = null, address = null }) {
  requireSession('administrator', 'product_manager');
  if (!name?.trim()) throw new ValidationError('name required');
  const db = getDb();
  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO suppliers (name, contact, address) VALUES (?, ?, ?)`
    ).run(name.trim(), contact, address);
    const id = Number(info.lastInsertRowid);
    const row = getSupplier(id);
    enqueue(db, 'supplier', id, 'upsert', row);
    return row;
  });
  return tx();
}

export function updateSupplier(id, { name, contact, address }) {
  requireSession('administrator', 'product_manager');
  const db = getDb();
  if (!db.prepare(`SELECT id FROM suppliers WHERE id = ?`).get(id))
    throw new ValidationError('supplier not found');

  const tx = db.transaction(() => {
    if (name !== undefined) {
      if (!name.trim()) throw new ValidationError('name required');
      db.prepare(`UPDATE suppliers SET name = ? WHERE id = ?`).run(name.trim(), id);
    }
    if (contact !== undefined)
      db.prepare(`UPDATE suppliers SET contact = ? WHERE id = ?`).run(contact, id);
    if (address !== undefined)
      db.prepare(`UPDATE suppliers SET address = ? WHERE id = ?`).run(address, id);
    const row = getSupplier(id);
    enqueue(db, 'supplier', id, 'upsert', row);
    return row;
  });
  return tx();
}

export function setSupplierActive(id, active) {
  requireSession('administrator', 'product_manager');
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE suppliers SET is_active = ? WHERE id = ?`)
      .run(active ? 1 : 0, id);
    const row = getSupplier(id);
    enqueue(db, 'supplier', id, 'upsert', row);
    return row;
  });
  return tx();
}

function getSupplier(id) {
  return getDb().prepare(
    `SELECT id, name, contact, address, is_active, created_at
       FROM suppliers WHERE id = ?`
  ).get(id);
}
