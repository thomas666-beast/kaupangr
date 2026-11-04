import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { ValidationError } from '../../shared/errors.js';

function normDate(v, label) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ValidationError(`${label} must be YYYY-MM-DD`);
  return v;
}
function buildRange(from, to) {
  const f = normDate(from, 'from');
  const t = normDate(to, 'to');
  if (f && t && f > t) throw new ValidationError('from must be <= to');
  return { from: f, to: t };
}

// Always use the table's ALIAS in this function (e.g. 'dpt', 'dt').
function whereDayRange(alias, from, to, storeId) {
  const parts = [];
  const args = [];
  if (from) parts.push(`${alias}.day >= ?`), args.push(from);
  if (to)   parts.push(`${alias}.day <= ?`), args.push(to);
  if (Number.isInteger(storeId)) parts.push(`${alias}.store_id = ?`), args.push(storeId);
  return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', args };
}

// ------------------------------------------------------------------
export function salesByDay({ from, to, storeId } = {}) {
  requireSession();
  const { from: f, to: t } = buildRange(from, to);
  const where = whereDayRange('daily_totals', f, t, storeId);

  return getDb().prepare(
    `SELECT day,
            SUM(sales_count)   AS sales_count,
            SUM(sales_cents)   AS sales_cents,
            SUM(returns_count) AS returns_count,
            SUM(returns_cents) AS returns_cents,
            SUM(sales_cents) - SUM(returns_cents) AS net_cents
       FROM daily_totals
       ${where.sql}
      GROUP BY day
      ORDER BY day ASC`
  ).all(...where.args);
}

// ------------------------------------------------------------------
export function salesByStore({ from, to, storeId } = {}) {
  requireSession();
  const { from: f, to: t } = buildRange(from, to);
  const where = whereDayRange('dt', f, t, storeId);

  return getDb().prepare(
    `SELECT dt.store_id, st.name AS store_name,
            SUM(dt.sales_count)   AS sales_count,
            SUM(dt.sales_cents)   AS sales_cents,
            SUM(dt.returns_count) AS returns_count,
            SUM(dt.returns_cents) AS returns_cents,
            SUM(dt.sales_cents) - SUM(dt.returns_cents) AS net_cents
       FROM daily_totals dt
       JOIN stores st ON st.id = dt.store_id
       ${where.sql}
      GROUP BY dt.store_id
      ORDER BY net_cents DESC`
  ).all(...where.args);
}

// ------------------------------------------------------------------
export function salesBySeller({ from, to, storeId } = {}) {
  requireSession();
  const { from: f, to: t } = buildRange(from, to);
  const where = whereDayRange('dt', f, t, storeId);

  return getDb().prepare(
    `SELECT dt.seller_id AS user_id, u.login AS user_login,
            SUM(dt.sales_count)   AS sales_count,
            SUM(dt.sales_cents)   AS sales_cents,
            SUM(dt.returns_count) AS returns_count,
            SUM(dt.returns_cents) AS returns_cents,
            SUM(dt.sales_cents) - SUM(dt.returns_cents) AS net_cents
       FROM daily_totals dt
       JOIN users u ON u.id = dt.seller_id
       ${where.sql}
      GROUP BY dt.seller_id
      ORDER BY net_cents DESC`
  ).all(...where.args);
}

// ------------------------------------------------------------------
export function salesByProduct({ from, to, storeId, limit = 500 } = {}) {
  requireSession();
  const { from: f, to: t } = buildRange(from, to);
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 2000) : 500;

  // Store filter → fall back to raw sales/returns. Daily product totals
  // don't break down by store (would explode in size).
  if (Number.isInteger(storeId)) {
    return salesByProductFromRaw({ from: f, to: t, storeId, limit: lim });
  }

  const where = whereDayRange('dpt', f, t, null);

  return getDb().prepare(
    `SELECT dpt.product_id, p.sku, p.name,
            SUM(dpt.sold_qty)        AS sold_qty,
            SUM(dpt.sold_cents)      AS sold_cents,
            SUM(dpt.returned_qty)    AS returned_qty,
            SUM(dpt.returned_cents)  AS returned_cents,
            SUM(dpt.sold_qty)   - SUM(dpt.returned_qty)   AS net_qty,
            SUM(dpt.sold_cents) - SUM(dpt.returned_cents) AS net_cents
       FROM daily_product_totals dpt
       JOIN products p ON p.id = dpt.product_id
       ${where.sql}
      GROUP BY dpt.product_id
      ORDER BY net_cents DESC
      LIMIT ?`
  ).all(...where.args, lim);
}

function salesByProductFromRaw({ from, to, storeId, limit }) {
  const sw = ['s.store_id = ?'];
  const swArgs = [storeId];
  if (from) { sw.push('s.created_at >= ?'); swArgs.push(`${from} 00:00:00`); }
  if (to)   { sw.push('s.created_at <= ?'); swArgs.push(`${to} 23:59:59`); }

  const rw = ['r.store_id = ?'];
  const rwArgs = [storeId];
  if (from) { rw.push('r.created_at >= ?'); rwArgs.push(`${from} 00:00:00`); }
  if (to)   { rw.push('r.created_at <= ?'); rwArgs.push(`${to} 23:59:59`); }

  return getDb().prepare(
    `SELECT product_id, sku, name,
            SUM(sq) AS sold_qty, SUM(sc) AS sold_cents,
            SUM(rq) AS returned_qty, SUM(rc) AS returned_cents,
            SUM(sq) - SUM(rq) AS net_qty,
            SUM(sc) - SUM(rc) AS net_cents
       FROM (
         SELECT p.id AS product_id, p.sku, p.name,
                sl.quantity AS sq,
                sl.quantity * sl.unit_price_cents AS sc,
                0 AS rq, 0 AS rc
           FROM sales_lines sl
           JOIN sales s    ON s.id = sl.sale_id
           JOIN products p ON p.id = sl.product_id
           WHERE ${sw.join(' AND ')}
         UNION ALL
         SELECT p.id, p.sku, p.name, 0, 0,
                rl.quantity,
                rl.quantity * rl.unit_price_cents
           FROM return_lines rl
           JOIN returns r      ON r.id = rl.return_id
           JOIN sales_lines sl ON sl.id = rl.sale_line_id
           JOIN products p     ON p.id = sl.product_id
           WHERE ${rw.join(' AND ')}
       )
      GROUP BY product_id
      HAVING sold_qty > 0 OR returned_qty > 0
      ORDER BY net_cents DESC
      LIMIT ?`
  ).all(...swArgs, ...rwArgs, limit);
}

/**
 * Hourly heatmap: for each (weekday, hour) bucket, how many sales happened
 * and how much revenue they brought in.
 *
 * Returns: array of { dow, hour, count, cents } for every non-empty bucket.
 * dow is 0 = Sunday, 6 = Saturday (SQLite's strftime('%w') convention).
 * hour is 0..23.
 *
 * Bounded by (from, to) date range and optional storeId.
 * Reads from `sales` directly — indexed on created_at.
 */
export function hourlyHeatmap({ from, to, storeId } = {}) {
  requireSession();
  const { from: f, to: t } = buildRange(from, to);

  const where = [];
  const args = [];
  if (f) { where.push('created_at >= ?'); args.push(`${f} 00:00:00`); }
  if (t) { where.push('created_at <= ?'); args.push(`${t} 23:59:59`); }
  if (Number.isInteger(storeId)) { where.push('store_id = ?'); args.push(storeId); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  return getDb().prepare(
    `SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow,
            CAST(strftime('%H', created_at) AS INTEGER) AS hour,
            COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS cents
       FROM sales
       ${whereSql}
      GROUP BY dow, hour
      ORDER BY dow, hour`
  ).all(...args);
}
