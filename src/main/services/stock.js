import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { ValidationError } from '../../shared/errors.js';

const MANUAL_KINDS = new Set(['purchase', 'adjust']);

export function addMovement({ productId, storeId = null, kind, quantity, note = null }) {
  const session = requireSession('administrator', 'product_manager');
  if (!MANUAL_KINDS.has(kind))
    throw new ValidationError(`kind must be purchase or adjust (got ${kind})`);
  const clientUuid = randomUUID();
  return insertMovement({
    productId, storeId, kind, quantity,
    refType: null, refId: null, note,
    clientUuid, fromManualApi: true, sessionUserId: session.userId,
  });
}

export function insertMovement({
  productId, storeId = null, kind, quantity,
  refType = null, refId = null, note = null,
  clientUuid = null, fromManualApi = false, sessionUserId = null,
}) {
  if (fromManualApi && !MANUAL_KINDS.has(kind))
    throw new ValidationError(`kind must be purchase or adjust (got ${kind})`);

  if (!Number.isInteger(productId)) throw new ValidationError('productId required');
  if (!Number.isInteger(quantity) || quantity === 0)
    throw new ValidationError('quantity must be a non-zero integer');
  if (storeId != null && !Number.isInteger(storeId))
    throw new ValidationError('storeId must be an integer or null');
  if (!['purchase','sale','return','adjust'].includes(kind))
    throw new ValidationError(`unknown kind: ${kind}`);

  if (kind === 'sale'    && quantity >= 0) throw new ValidationError('sale movement must be negative');
  if (kind === 'return'  && quantity <= 0) throw new ValidationError('return movement must be positive');
  if (kind === 'purchase'&& quantity <= 0) throw new ValidationError('purchase movement must be positive');

  const db = getDb();
  if (clientUuid) {
    const existing = db.prepare(`SELECT * FROM stock_movements WHERE client_uuid = ?`).get(clientUuid);
    if (existing) return existing;
  }

  if (!db.prepare(`SELECT id FROM products WHERE id = ?`).get(productId))
    throw new ValidationError('product not found');
  if (storeId != null && !db.prepare(`SELECT id FROM stores WHERE id = ?`).get(storeId))
    throw new ValidationError('store not found');

  const info = db.prepare(
    `INSERT INTO stock_movements
     (product_id, store_id, kind, quantity, ref_type, ref_id, note, client_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, storeId, kind, quantity, refType, refId, note, clientUuid);

  const id = Number(info.lastInsertRowid);
  const row = getMovement(id);

  if (fromManualApi && clientUuid) {
    enqueue(db, 'stock_movement', id, 'upsert', { ...row, user_id: sessionUserId });
  }
  return row;
}

export function onHand(productId, storeId = null) {
  requireSession();
  if (!Number.isInteger(productId)) throw new ValidationError('productId required');
  const db = getDb();
  const sql = storeId == null
    ? `SELECT COALESCE(SUM(quantity),0) AS n FROM stock_movements WHERE product_id = ?`
    : `SELECT COALESCE(SUM(quantity),0) AS n FROM stock_movements WHERE product_id = ? AND store_id = ?`;
  const row = storeId == null
    ? db.prepare(sql).get(productId)
    : db.prepare(sql).get(productId, storeId);
  return row.n;
}

export function onHandBulk(productIds, storeId = null) {
  requireSession();
  if (!Array.isArray(productIds)) throw new ValidationError('productIds must be an array');
  const ids = productIds.filter(Number.isInteger);
  if (ids.length === 0) return {};
  if (ids.length > 1000) throw new ValidationError('too many productIds (max 1000)');
  if (storeId != null && !Number.isInteger(storeId))
    throw new ValidationError('storeId must be an integer or null');

  const placeholders = ids.map(() => '?').join(',');
  const args = storeId == null ? ids : [...ids, storeId];
  const whereStore = storeId == null ? '' : 'AND store_id = ?';

  const rows = getDb().prepare(
    `SELECT product_id, COALESCE(SUM(quantity),0) AS n
       FROM stock_movements
      WHERE product_id IN (${placeholders}) ${whereStore}
      GROUP BY product_id`
  ).all(...args);

  const out = {};
  for (const r of rows) out[r.product_id] = r.n;
  return out;
}

// ------------------------------------------------------------------
// lowStock — the Restock view reads from this
// ------------------------------------------------------------------
export function lowStock({ limit = 500, storeId = null } = {}) {
  requireSession();
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 2000) : 500;
  const db = getDb();

  // Products with a positive reorder_at AND an on-hand strictly below it.
  // on-hand is computed as the sum of all movements for that product,
  // optionally filtered per store.
  const storeFilter = Number.isInteger(storeId) ? 'AND sm.store_id = ?' : '';
  const args = Number.isInteger(storeId) ? [storeId, lim] : [lim];

  return db.prepare(
    `SELECT p.id, p.sku, p.name, p.reorder_at,
            COALESCE(SUM(sm.quantity), 0) AS on_hand,
            s.name AS supplier_name
       FROM products p
       LEFT JOIN stock_movements sm
              ON sm.product_id = p.id ${storeFilter}
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.is_active = 1
        AND p.reorder_at > 0
      GROUP BY p.id
      HAVING COALESCE(SUM(sm.quantity), 0) < p.reorder_at
      ORDER BY (p.reorder_at - COALESCE(SUM(sm.quantity), 0)) DESC, p.name COLLATE NOCASE
      LIMIT ?`
  ).all(...args);
}

export function listMovements({ productId, storeId, kind, q = '', offset = 0, limit = 50 } = {}) {
  requireSession();

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];

  if (Number.isInteger(productId)) { where.push('m.product_id = ?'); args.push(productId); }
  if (Number.isInteger(storeId))   { where.push('m.store_id = ?');   args.push(storeId); }
  if (kind && ['purchase','sale','return','adjust'].includes(kind)) {
    where.push('m.kind = ?'); args.push(kind);
  }

  const trimmed = String(q || '').trim();
  if (trimmed) {
    const asRef = /^#(\d+)$/.exec(trimmed);
    if (asRef) {
      where.push('m.ref_id = ?');
      args.push(Number(asRef[1]));
    } else {
      const like = `%${trimmed}%`;
      where.push(
        '(m.note LIKE ? COLLATE NOCASE OR p.sku LIKE ? COLLATE NOCASE OR p.name LIKE ? COLLATE NOCASE)'
      );
      args.push(like, like, like);
    }
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(
    `SELECT COUNT(*) AS n
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
      ${whereSql}`
  ).get(...args).n;

  const rows = db.prepare(
    `SELECT m.id, m.product_id, p.sku, p.name AS product_name,
            m.store_id, s.name AS store_name,
            m.kind, m.quantity, m.ref_type, m.ref_id, m.note,
            m.client_uuid, m.created_at
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN stores s ON s.id = m.store_id
      ${whereSql}
      ORDER BY m.id DESC
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

function getMovement(id) {
  return getDb().prepare(
    `SELECT id, product_id, store_id, kind, quantity, ref_type, ref_id,
            note, client_uuid, created_at
       FROM stock_movements WHERE id = ?`
  ).get(id);
}
