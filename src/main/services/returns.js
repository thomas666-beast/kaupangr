import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { insertMovement } from './stock.js';
import { incReturnDay, incReturnProduct } from './daily-totals.js';
import { ValidationError } from '../../shared/errors.js';

export function createReturn({ saleId, lines }) {
  const session = requireSession('seller', 'product_manager', 'administrator');

  if (!Number.isInteger(saleId)) throw new ValidationError('saleId required');
  if (!Array.isArray(lines) || lines.length === 0)
    throw new ValidationError('at least one line required');

  const db = getDb();
  const sale = db.prepare(`SELECT id, store_id FROM sales WHERE id = ?`).get(saleId);
  if (!sale) throw new ValidationError('sale not found');

  const saleLines = db.prepare(
    `SELECT id, product_id, quantity, unit_price_cents
       FROM sales_lines WHERE sale_id = ? ORDER BY id`
  ).all(saleId);
  const saleLineById = new Map(saleLines.map((l, i) => [l.id, { ...l, position: i }]));

  const normalized = [];
  let totalCents = 0;

  for (const [i, ln] of lines.entries()) {
    const { saleLineId, quantity } = ln;
    if (!Number.isInteger(saleLineId)) throw new ValidationError(`line ${i}: saleLineId required`);
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new ValidationError(`line ${i}: quantity must be a positive integer`);

    const saleLine = saleLineById.get(saleLineId);
    if (!saleLine)
      throw new ValidationError(`line ${i}: sale line ${saleLineId} not part of sale ${saleId}`);

    const alreadyReturned = db.prepare(
      `SELECT COALESCE(SUM(quantity),0) AS n FROM return_lines WHERE sale_line_id = ?`
    ).get(saleLineId).n;

    if (alreadyReturned + quantity > saleLine.quantity) {
      throw new ValidationError(
        `line ${i}: return qty ${alreadyReturned + quantity} exceeds sold qty ${saleLine.quantity}`
      );
    }

    const unitPriceCents = saleLine.unit_price_cents;
    totalCents += quantity * unitPriceCents;
    normalized.push({
      saleLineId,
      productId: saleLine.product_id,
      position: saleLine.position,
      quantity,
      unitPriceCents,
    });
  }

  const clientUuid = randomUUID();

  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO returns (sale_id, store_id, user_id, total_cents, client_uuid)
       VALUES (?, ?, ?, ?, ?)`
    ).run(saleId, sale.store_id, session.userId, totalCents, clientUuid);
    const returnId = Number(info.lastInsertRowid);

    const returnDay = db.prepare(
      `SELECT substr(created_at, 1, 10) AS d FROM returns WHERE id = ?`
    ).get(returnId).d;

    const insLine = db.prepare(
      `INSERT INTO return_lines (return_id, sale_line_id, quantity, unit_price_cents)
       VALUES (?, ?, ?, ?)`
    );
    for (let i = 0; i < normalized.length; i++) {
      const l = normalized[i];
      insLine.run(returnId, l.saleLineId, l.quantity, l.unitPriceCents);
      insertMovement({
        productId: l.productId,
        storeId: sale.store_id,
        kind: 'return',
        quantity: l.quantity,
        refType: 'return',
        refId: returnId,
        clientUuid: `${clientUuid}:${i}`,
      });
      incReturnProduct(db, {
        day: returnDay,
        productId: l.productId,
        qty: l.quantity,
        cents: l.quantity * l.unitPriceCents,
      });
    }

    incReturnDay(db, {
      day: returnDay,
      storeId: sale.store_id,
      userId: session.userId,
      cents: totalCents,
    });

    const payload = {
      id: returnId,
      sale_id: saleId,
      store_id: sale.store_id,
      user_id: session.userId,
      total_cents: totalCents,
      client_uuid: clientUuid,
      lines: normalized.map(l => ({
        sale_line_id: l.saleLineId,
        product_id: l.productId,
        position: l.position,
        quantity: l.quantity,
        unit_price_cents: l.unitPriceCents,
      })),
    };
    enqueue(db, 'return', returnId, 'upsert', payload);
    return returnId;
  });

  return getReturn(tx());
}

export function listReturnsBySale(saleId) {
  requireSession();
  return getDb().prepare(
    `SELECT r.id, r.sale_id, r.store_id, r.user_id, u.login AS user_login,
            r.total_cents, r.created_at, r.client_uuid
       FROM returns r
       JOIN users u ON u.id = r.user_id
      WHERE r.sale_id = ?
      ORDER BY r.id DESC`
  ).all(saleId);
}

export function listAll({ q = '', offset = 0, limit = 50 } = {}) {
  requireSession();

  const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;

  const where = [];
  const args = [];
  const trimmed = String(q || '').trim();

  if (trimmed) {
    const asId = /^#(\d+)$/.exec(trimmed);
    if (asId) {
      where.push('r.sale_id = ?');
      args.push(Number(asId[1]));
    } else {
      const like = `%${trimmed}%`;
      where.push(
        '(u.login LIKE ? COLLATE NOCASE OR st.name LIKE ? COLLATE NOCASE OR r.client_uuid LIKE ? COLLATE NOCASE)'
      );
      args.push(like, like, like);
    }
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const total = db.prepare(
    `SELECT COUNT(*) AS n
       FROM returns r
       JOIN users  u  ON u.id  = r.user_id
       JOIN stores st ON st.id = r.store_id
      ${whereSql}`
  ).get(...args).n;

  const rows = db.prepare(
    `SELECT r.id, r.sale_id, r.store_id, st.name AS store_name,
            r.user_id, u.login AS user_login,
            r.total_cents, r.created_at, r.client_uuid
       FROM returns r
       JOIN users  u  ON u.id  = r.user_id
       JOIN stores st ON st.id = r.store_id
      ${whereSql}
      ORDER BY r.id DESC
      LIMIT ? OFFSET ?`
  ).all(...args, lim, off);

  return { rows, total };
}

export function getReturn(id) {
  requireSession();
  const db = getDb();
  const ret = db.prepare(
    `SELECT r.id, r.sale_id, r.store_id, r.user_id, u.login AS user_login,
            r.total_cents, r.created_at, r.client_uuid
       FROM returns r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = ?`
  ).get(id);
  if (!ret) throw new ValidationError('return not found');

  ret.lines = db.prepare(
    `SELECT rl.id, rl.sale_line_id, rl.quantity, rl.unit_price_cents,
            sl.product_id, p.sku, p.name AS product_name
       FROM return_lines rl
       JOIN sales_lines sl ON sl.id = rl.sale_line_id
       JOIN products p     ON p.id  = sl.product_id
      WHERE rl.return_id = ?
      ORDER BY rl.id`
  ).all(id);

  return ret;
}
