import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { ValidationError } from '../../shared/errors.js';

const MAX_IDS = 2000;

/**
 * Compute what a bulk price update would do, without writing.
 * Same function as bulkApply — one flag controls the write. So the preview
 * cannot lie about what apply will do.
 */
export function bulkPricePreview({ supplierId, operation, value } = {}) {
  requireSession('administrator', 'product_manager');
  return runBulk({ supplierId, operation, value, dryRun: true });
}

export function bulkPriceApply({ supplierId, operation, value } = {}) {
  requireSession('administrator', 'product_manager');
  return runBulk({ supplierId, operation, value, dryRun: false });
}

function runBulk({ supplierId, operation, value, dryRun }) {
  if (supplierId !== null && supplierId !== undefined && !Number.isInteger(supplierId))
    throw new ValidationError('supplierId must be an integer or null');
  if (!['pct', 'add', 'set'].includes(operation))
    throw new ValidationError('operation must be pct, add, or set');
  if (!Number.isFinite(value))
    throw new ValidationError('value must be a finite number');

  const db = getDb();

  const where = [];
  const args = [];
  if (Number.isInteger(supplierId)) {
    where.push('supplier_id = ?');
    args.push(supplierId);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db.prepare(
    `SELECT id, sku, name, price_cents, supplier_id
       FROM products
       ${whereSql}
      ORDER BY name COLLATE NOCASE
      LIMIT ?`
  ).all(...args, MAX_IDS + 1);

  if (rows.length > MAX_IDS) {
    throw new ValidationError(`refusing to affect more than ${MAX_IDS} products at once`);
  }

  const items = rows.map(r => {
    const current = r.price_cents;
    let next;
    if (operation === 'pct')      next = Math.round(current * (1 + value / 100));
    else if (operation === 'add') next = current + Math.round(value * 100);
    else if (operation === 'set') next = Math.round(value * 100);

    if (!Number.isFinite(next) || next < 0)
      throw new ValidationError(`product ${r.sku}: computed price would be negative`);

    return {
      id: r.id,
      sku: r.sku,
      name: r.name,
      supplier_id: r.supplier_id,
      old_price_cents: current,
      new_price_cents: next,
      changed: next !== current,
    };
  });

  const affected = items.filter(i => i.changed);
  const beforeTotal = items.reduce((s, i) => s + i.old_price_cents, 0);
  const afterTotal  = items.reduce((s, i) => s + i.new_price_cents, 0);

  const result = {
    total_matched: items.length,
    total_affected: affected.length,
    delta_cents: afterTotal - beforeTotal,
    items,   // full list so the preview shows everything
    applied: false,
  };

  if (dryRun) return result;
  if (affected.length === 0) return { ...result, applied: false };

  const tx = db.transaction(() => {
    const upd = db.prepare(`UPDATE products SET price_cents = ? WHERE id = ?`);
    for (const item of affected) {
      upd.run(item.new_price_cents, item.id);
      const row = db.prepare(
        `SELECT p.id, p.sku, p.name, p.price_cents, p.supplier_id, p.is_active,
                p.created_at, s.name AS supplier_name
           FROM products p
           LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE p.id = ?`
      ).get(item.id);
      enqueue(db, 'product', item.id, 'upsert', row);
    }
  });
  tx();

  return { ...result, applied: true };
}
