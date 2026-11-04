import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { insertMovement } from './stock.js';
import { incSaleDay, incSaleProduct } from './daily-totals.js';
import { ValidationError } from '../../shared/errors.js';

export function createSale({ storeId, lines }) {
  const session = requireSession('seller', 'product_manager', 'administrator');

  if (!Number.isInteger(storeId)) throw new ValidationError('storeId required');
  if (!Array.isArray(lines) || lines.length === 0)
    throw new ValidationError('at least one line required');

  const db = getDb();
  const store = db.prepare(`SELECT id FROM stores WHERE id = ? AND is_active = 1`).get(storeId);
  if (!store) throw new ValidationError('store not found or inactive');

  const normalized = [];
  for (const [i, ln] of lines.entries()) {
    const { productId, quantity } = ln;
    if (!Number.isInteger(productId)) throw new ValidationError(`line ${i}: productId required`);
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new ValidationError(`line ${i}: quantity must be a positive integer`);

    const product = db.prepare(
      `SELECT id, price_cents, is_active FROM products WHERE id = ?`
    ).get(productId);
    if (!product || !product.is_active)
      throw new ValidationError(`line ${i}: product not found or inactive`);

    let unitPriceCents = ln.unitPriceCents;
    if (unitPriceCents === undefined) unitPriceCents = product.price_cents;
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0)
      throw new ValidationError(`line ${i}: unitPriceCents must be a non-negative integer`);

    normalized.push({ productId, quantity, unitPriceCents });
  }

  const totalCents = normalized.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  const clientUuid = randomUUID();

  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO sales (store_id, seller_id, total_cents, client_uuid)
       VALUES (?, ?, ?, ?)`
    ).run(storeId, session.userId, totalCents, clientUuid);
    const saleId = Number(info.lastInsertRowid);

    const saleDay = db.prepare(
      `SELECT substr(created_at, 1, 10) AS d FROM sales WHERE id = ?`
    ).get(saleId).d;

    const insLine = db.prepare(
      `INSERT INTO sales_lines (sale_id, product_id, quantity, unit_price_cents)
       VALUES (?, ?, ?, ?)`
    );
    for (let i = 0; i < normalized.length; i++) {
      const l = normalized[i];
      insLine.run(saleId, l.productId, l.quantity, l.unitPriceCents);
      insertMovement({
        productId: l.productId,
        storeId,
        kind: 'sale',
        quantity: -l.quantity,
        refType: 'sale',
        refId: saleId,
        clientUuid: `${clientUuid}:${i}`,
      });
      incSaleProduct(db, {
        day: saleDay,
        productId: l.productId,
        qty: l.quantity,
        cents: l.quantity * l.unitPriceCents,
      });
    }

    incSaleDay(db, {
      day: saleDay,
      storeId,
      sellerId: session.userId,
      cents: totalCents,
    });

    const payload = {
      id: saleId,
      store_id: storeId,
      seller_id: session.userId,
      total_cents: totalCents,
      client_uuid: clientUuid,
      lines: normalized.map(l => ({
        product_id: l.productId,
        quantity: l.quantity,
        unit_price_cents: l.unitPriceCents,
      })),
    };
    enqueue(db, 'sale', saleId, 'upsert', payload);
    return saleId;
  });

  return getSale(tx());
}

export function listSales({ q = '', offset = 0, limit = 50 } = {}) {
  requireSession();

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];
  const trimmed = String(q || '').trim();
  if (trimmed) {
    const asId = /^#(\d+)$/.exec(trimmed);
    if (asId) {
      where.push('s.id = ?');
      args.push(Number(asId[1]));
    } else {
      const like = `%${trimmed}%`;
      where.push(
        '(u.login LIKE ? COLLATE NOCASE OR st.name LIKE ? COLLATE NOCASE OR s.client_uuid LIKE ? COLLATE NOCASE)'
      );
      args.push(like, like, like);
    }
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(
    `SELECT COUNT(*) AS n
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users  u  ON u.id  = s.seller_id
      ${whereSql}`
  ).get(...args).n;

  const rows = db.prepare(
    `SELECT s.id, s.store_id, st.name AS store_name,
            s.seller_id, u.login AS seller_login,
            s.total_cents, s.created_at, s.client_uuid
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users  u  ON u.id  = s.seller_id
      ${whereSql}
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

export function getSale(id) {
  requireSession();
  const db = getDb();
  const sale = db.prepare(
    `SELECT s.id, s.store_id, st.name AS store_name,
            s.seller_id, u.login AS seller_login,
            s.total_cents, s.created_at, s.client_uuid
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users  u  ON u.id  = s.seller_id
      WHERE s.id = ?`
  ).get(id);
  if (!sale) throw new ValidationError('sale not found');

  sale.lines = db.prepare(
    `SELECT sl.id, sl.product_id, p.sku, p.name AS product_name,
            sl.quantity, sl.unit_price_cents
       FROM sales_lines sl
       JOIN products p ON p.id = sl.product_id
      WHERE sl.sale_id = ?
      ORDER BY sl.id`
  ).all(id);

  return sale;
}
