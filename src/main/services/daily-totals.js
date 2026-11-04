import { getDb } from '../db/index.js';

// ------------------------------------------------------------------
// Increment helpers — called INSIDE sales/returns transactions.
// ------------------------------------------------------------------
export function incSaleDay(db, { day, storeId, sellerId, cents }) {
  db.prepare(
    `INSERT INTO daily_totals (day, store_id, seller_id, sales_count, sales_cents)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(day, store_id, seller_id)
     DO UPDATE SET
       sales_count = sales_count + 1,
       sales_cents = sales_cents + excluded.sales_cents`
  ).run(day, storeId, sellerId, cents);
}

export function incReturnDay(db, { day, storeId, userId, cents }) {
  db.prepare(
    `INSERT INTO daily_totals (day, store_id, seller_id, returns_count, returns_cents)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(day, store_id, seller_id)
     DO UPDATE SET
       returns_count = returns_count + 1,
       returns_cents = returns_cents + excluded.returns_cents`
  ).run(day, storeId, userId, cents);
}

export function incSaleProduct(db, { day, productId, qty, cents }) {
  db.prepare(
    `INSERT INTO daily_product_totals (day, product_id, sold_qty, sold_cents)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day, product_id)
     DO UPDATE SET
       sold_qty   = sold_qty   + excluded.sold_qty,
       sold_cents = sold_cents + excluded.sold_cents`
  ).run(day, productId, qty, cents);
}

export function incReturnProduct(db, { day, productId, qty, cents }) {
  db.prepare(
    `INSERT INTO daily_product_totals (day, product_id, returned_qty, returned_cents)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day, product_id)
     DO UPDATE SET
       returned_qty   = returned_qty   + excluded.returned_qty,
       returned_cents = returned_cents + excluded.returned_cents`
  ).run(day, productId, qty, cents);
}

// ------------------------------------------------------------------
// One-time backfill from existing sales/returns.
// Guarded by app_meta.daily_totals_backfilled.
// ------------------------------------------------------------------
export function backfillIfNeeded() {
  const db = getDb();
  const flag = db.prepare(
    `SELECT value FROM app_meta WHERE key = 'daily_totals_backfilled'`
  ).get();

  if (flag && flag.value === '1') return { skipped: true };

  const backTx = db.transaction(() => {
    db.exec(`DELETE FROM daily_totals; DELETE FROM daily_product_totals;`);

    const upSales = db.prepare(`
      INSERT INTO daily_totals (day, store_id, seller_id, sales_count, sales_cents)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, store_id, seller_id)
      DO UPDATE SET
        sales_count = sales_count + excluded.sales_count,
        sales_cents = sales_cents + excluded.sales_cents
    `);
    const upReturns = db.prepare(`
      INSERT INTO daily_totals (day, store_id, seller_id, returns_count, returns_cents)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, store_id, seller_id)
      DO UPDATE SET
        returns_count = returns_count + excluded.returns_count,
        returns_cents = returns_cents + excluded.returns_cents
    `);

    for (const r of db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, store_id, seller_id,
              COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS c
         FROM sales
        GROUP BY day, store_id, seller_id`
    ).all()) {
      upSales.run(r.day, r.store_id, r.seller_id, r.n, r.c);
    }

    for (const r of db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, store_id, user_id AS seller_id,
              COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS c
         FROM returns
        GROUP BY day, store_id, seller_id`
    ).all()) {
      upReturns.run(r.day, r.store_id, r.seller_id, r.n, r.c);
    }

    const upSold = db.prepare(`
      INSERT INTO daily_product_totals (day, product_id, sold_qty, sold_cents)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(day, product_id)
      DO UPDATE SET
        sold_qty   = sold_qty   + excluded.sold_qty,
        sold_cents = sold_cents + excluded.sold_cents
    `);
    for (const r of db.prepare(
      `SELECT substr(s.created_at, 1, 10) AS day, sl.product_id,
              SUM(sl.quantity) AS q,
              SUM(sl.quantity * sl.unit_price_cents) AS c
         FROM sales_lines sl
         JOIN sales s ON s.id = sl.sale_id
        GROUP BY day, sl.product_id`
    ).all()) {
      upSold.run(r.day, r.product_id, r.q, r.c);
    }

    const upRet = db.prepare(`
      INSERT INTO daily_product_totals (day, product_id, returned_qty, returned_cents)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(day, product_id)
      DO UPDATE SET
        returned_qty   = returned_qty   + excluded.returned_qty,
        returned_cents = returned_cents + excluded.returned_cents
    `);
    for (const r of db.prepare(
      `SELECT substr(r.created_at, 1, 10) AS day, sl.product_id,
              SUM(rl.quantity) AS q,
              SUM(rl.quantity * rl.unit_price_cents) AS c
         FROM return_lines rl
         JOIN returns r      ON r.id = rl.return_id
         JOIN sales_lines sl ON sl.id = rl.sale_line_id
        GROUP BY day, sl.product_id`
    ).all()) {
      upRet.run(r.day, r.product_id, r.q, r.c);
    }

    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('daily_totals_backfilled', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`
    ).run();
  });
  backTx();

  return { backfilled: true };
}
