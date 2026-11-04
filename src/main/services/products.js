import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { ValidationError } from '../../shared/errors.js';

export function listProducts({ q = '', supplierId, activeOnly, offset = 0, limit = 50 } = {}) {
  requireSession();

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];

  const trimmed = String(q || '').trim();
  if (trimmed) {
    const like = `%${trimmed}%`;
    where.push('(p.sku LIKE ? COLLATE NOCASE OR p.name LIKE ? COLLATE NOCASE)');
    args.push(like, like);
  }
  if (Number.isInteger(supplierId)) {
    where.push('p.supplier_id = ?');
    args.push(supplierId);
  }
  if (activeOnly === true) {
    where.push('p.is_active = 1');
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(`SELECT COUNT(*) AS n FROM products p ${whereSql}`)
    .get(...args).n;

  const rows = db.prepare(
    `SELECT p.id, p.sku, p.name, p.price_cents, p.supplier_id, p.is_active,
            p.reorder_at, p.created_at, s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${whereSql}
      ORDER BY p.is_active DESC, p.name COLLATE NOCASE
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

export function createProduct({ sku, name, price_cents, supplier_id = null, reorder_at = 0 }) {
  requireSession('administrator', 'product_manager');
  if (!sku?.trim())         throw new ValidationError('sku required');
  if (!name?.trim())        throw new ValidationError('name required');
  if (!Number.isInteger(price_cents) || price_cents < 0)
    throw new ValidationError('price_cents must be a non-negative integer');
  if (!Number.isInteger(reorder_at) || reorder_at < 0)
    throw new ValidationError('reorder_at must be a non-negative integer');
  const db = getDb();
  if (supplier_id != null &&
      !db.prepare(`SELECT id FROM suppliers WHERE id = ?`).get(supplier_id))
    throw new ValidationError('supplier not found');

  try {
    const tx = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO products (sku, name, price_cents, supplier_id, reorder_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(sku.trim(), name.trim(), price_cents, supplier_id, reorder_at);
      const id = Number(info.lastInsertRowid);
      const row = getProduct(id);
      enqueue(db, 'product', id, 'upsert', row);
      return row;
    });
    return tx();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ValidationError('sku already exists');
    throw e;
  }
}

export function updateProduct(id, { sku, name, price_cents, supplier_id, reorder_at }) {
  requireSession('administrator', 'product_manager');
  const db = getDb();
  if (!db.prepare(`SELECT id FROM products WHERE id = ?`).get(id))
    throw new ValidationError('product not found');

  try {
    const tx = db.transaction(() => {
      if (sku !== undefined) {
        if (!sku.trim()) throw new ValidationError('sku required');
        db.prepare(`UPDATE products SET sku = ? WHERE id = ?`).run(sku.trim(), id);
      }
      if (name !== undefined) {
        if (!name.trim()) throw new ValidationError('name required');
        db.prepare(`UPDATE products SET name = ? WHERE id = ?`).run(name.trim(), id);
      }
      if (price_cents !== undefined) {
        if (!Number.isInteger(price_cents) || price_cents < 0)
          throw new ValidationError('price_cents must be a non-negative integer');
        db.prepare(`UPDATE products SET price_cents = ? WHERE id = ?`).run(price_cents, id);
      }
      if (supplier_id !== undefined) {
        if (supplier_id != null &&
            !db.prepare(`SELECT id FROM suppliers WHERE id = ?`).get(supplier_id))
          throw new ValidationError('supplier not found');
        db.prepare(`UPDATE products SET supplier_id = ? WHERE id = ?`).run(supplier_id, id);
      }
      if (reorder_at !== undefined) {
        if (!Number.isInteger(reorder_at) || reorder_at < 0)
          throw new ValidationError('reorder_at must be a non-negative integer');
        db.prepare(`UPDATE products SET reorder_at = ? WHERE id = ?`).run(reorder_at, id);
      }
      const row = getProduct(id);
      enqueue(db, 'product', id, 'upsert', row);
      return row;
    });
    return tx();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ValidationError('sku already exists');
    throw e;
  }
}

export function setProductActive(id, active) {
  requireSession('administrator', 'product_manager');
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE products SET is_active = ? WHERE id = ?`)
      .run(active ? 1 : 0, id);
    const row = getProduct(id);
    enqueue(db, 'product', id, 'upsert', row);
    return row;
  });
  return tx();
}

export function findBySku(sku) {
  requireSession();
  if (!sku?.trim()) throw new ValidationError('sku required');
  const row = getDb().prepare(
    `SELECT p.id, p.sku, p.name, p.price_cents, p.supplier_id, p.is_active,
            p.reorder_at, s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.sku = ? COLLATE NOCASE`
  ).get(sku.trim());
  return row || null;
}

export function searchProducts(query, { limit = 20 } = {}) {
  requireSession();
  const q = (query || '').trim();
  if (!q) return [];
  const like = `%${q}%`;
  return getDb().prepare(
    `SELECT p.id, p.sku, p.name, p.price_cents, p.supplier_id, p.is_active,
            p.reorder_at, s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.is_active = 1
        AND (p.sku LIKE ? COLLATE NOCASE OR p.name LIKE ? COLLATE NOCASE)
      ORDER BY
        CASE WHEN p.sku LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
        p.name COLLATE NOCASE
      LIMIT ?`
  ).all(like, like, `${q}%`, limit);
}

export { bulkPricePreview, bulkPriceApply } from './products-bulk.js';

function getProduct(id) {
  return getDb().prepare(
    `SELECT p.id, p.sku, p.name, p.price_cents, p.supplier_id, p.is_active,
            p.reorder_at, p.created_at, s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?`
  ).get(id);
}
