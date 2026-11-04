import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { createReturn } from '../src/main/services/returns.js';
import { AuthError, ValidationError } from '../src/shared/errors.js';
import {
  salesByDay, salesByStore, salesBySeller, salesByProduct, hourlyHeatmap,
} from '../src/main/services/reports.js';

let db, storeId, baseProductId;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  storeId       = createStore({ name: 'Main' }).id;
  baseProductId = createProduct({ sku: 'BASE', name: 'Base', price_cents: 100 }).id;
});

afterEach(() => {
  logout();
  teardown();
});

// Helper: change created_at on append-only tables for test purposes.
function rewriteCreatedAt(table, id, ymd) {
  const triggerName = `trg_${table}_no_update`;
  const sql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?`
  ).get(triggerName)?.sql;
  if (!sql) throw new Error(`missing trigger ${triggerName}`);
  db.exec(`DROP TRIGGER ${triggerName}`);
  try {
    db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(`${ymd} 12:00:00`, id);
    // Also update the daily_totals row so reports (which read the daily
    // tables) reflect the new date.
    db.prepare(
      `UPDATE ${table === 'sales' ? 'daily_totals' : 'daily_totals'}
          SET day = ? WHERE day = ?`
    );
  } finally {
    db.exec(sql);
  }
}

// NOTE: because reports now read from daily_totals, we must keep the daily
// table in sync with any test-forced created_at changes. The easiest way is
// to force the date BEFORE creating the sale, which we can't (append-only),
// OR to also rewrite the daily_totals key. Simpler: force via a helper that
// updates both.
async function withSaleDay(ymd, fn) {
  const s = fn();
  const oldDay = db.prepare(`SELECT substr(created_at,1,10) AS d FROM sales WHERE id = ?`).get(s.id).d;
  // Drop the trigger, update created_at, update daily_totals day.
  const triggerSql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='trigger' AND name = 'trg_sales_no_update'`
  ).get().sql;
  db.exec(`DROP TRIGGER trg_sales_no_update`);
  try {
    db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(`${ymd} 12:00:00`, s.id);
    db.prepare(`UPDATE daily_totals SET day = ? WHERE day = ?`).run(ymd, oldDay);
  } finally {
    db.exec(triggerSql);
  }
  return s;
}

test('reports require a signed-in user', () => {
  logout();
  assert.throws(() => salesByDay({}), AuthError);
  assert.throws(() => salesByStore({}), AuthError);
  assert.throws(() => salesBySeller({}), AuthError);
  assert.throws(() => salesByProduct({}), AuthError);
});

test('reports reject bad dates and reversed ranges', () => {
  login('admin', 'admin');
  assert.throws(() => salesByDay({ from: 'yesterday' }), ValidationError);
  assert.throws(() => salesByDay({ to: '2026/01/01' }), ValidationError);
  assert.throws(() => salesByDay({ from: '2026-02-01', to: '2026-01-01' }), ValidationError);
});

test('salesByDay groups by day and computes net', () => {
  createSale({ storeId, lines: [{ productId: baseProductId, quantity: 3 }] });
  createSale({ storeId, lines: [{ productId: baseProductId, quantity: 5 }] });
  const days = salesByDay({});
  assert.equal(days.length, 1);
  assert.equal(days[0].sales_count, 2);
  assert.equal(days[0].sales_cents, 800);
  assert.equal(days[0].net_cents, 800);
  assert.ok(days[0].day);   // not undefined, not `date`
});

test('salesByDay respects from/to inclusive range', () => {
  // Create then move each sale to distinct days.
  const s1 = createSale({ storeId, lines: [{ productId: baseProductId, quantity: 1 }] });
  const s2 = createSale({ storeId, lines: [{ productId: baseProductId, quantity: 1 }] });

  // Force both to specific days by direct daily_totals + sales update.
  db.exec(`DELETE FROM daily_totals`);
  db.prepare(`INSERT INTO daily_totals (day, store_id, seller_id, sales_count, sales_cents)
              VALUES ('2026-03-01', ?, 1, 1, 100)`).run(storeId);
  db.prepare(`INSERT INTO daily_totals (day, store_id, seller_id, sales_count, sales_cents)
              VALUES ('2026-03-05', ?, 1, 1, 100)`).run(storeId);

  assert.equal(salesByDay({ from: '2026-03-01', to: '2026-03-01' }).length, 1);
  assert.equal(salesByDay({ from: '2026-03-01', to: '2026-03-05' }).length, 2);
});

test('salesByStore groups by store', () => {
  const storeB = createStore({ name: 'Second' }).id;
  createSale({ storeId, lines: [{ productId: baseProductId, quantity: 4 }] });
  createSale({ storeId: storeB, lines: [{ productId: baseProductId, quantity: 2 }] });

  const rows = salesByStore({});
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.store_id === storeId);
  const b = rows.find(r => r.store_id === storeB);
  assert.equal(a.sales_cents, 400);
  assert.equal(b.sales_cents, 200);
});

test('salesByStore with storeId filter', () => {
  const storeB = createStore({ name: 'Second' }).id;
  createSale({ storeId, lines: [{ productId: baseProductId, quantity: 4 }] });
  createSale({ storeId: storeB, lines: [{ productId: baseProductId, quantity: 2 }] });

  const rows = salesByStore({ storeId: storeB });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].store_id, storeB);
});

test('salesBySeller groups by user', () => {
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES ('seller1', ?, 'seller')`
  ).run(db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash);

  createSale({ storeId, lines: [{ productId: baseProductId, quantity: 2 }] });
  logout();
  login('seller1', 'admin');
  createSale({ storeId, lines: [{ productId: baseProductId, quantity: 9 }] });
  logout();
  login('admin', 'admin');

  const rows = salesBySeller({});
  const admin = rows.find(r => r.user_login === 'admin');
  const seller = rows.find(r => r.user_login === 'seller1');
  assert.equal(admin.sales_cents, 200);
  assert.equal(seller.sales_cents, 900);
});

test('salesByProduct aggregates sold and returned per product', () => {
  const p1 = createProduct({ sku: 'PROD-A', name: 'Alpha', price_cents: 100 }).id;
  const p2 = createProduct({ sku: 'PROD-B', name: 'Bravo', price_cents: 250 }).id;

  const s1 = createSale({ storeId, lines: [
    { productId: p1, quantity: 3 },
    { productId: p2, quantity: 2 },
  ]});
  createSale({ storeId, lines: [{ productId: p1, quantity: 1 }] });
  createReturn({ saleId: s1.id, lines: [{ saleLineId: s1.lines[0].id, quantity: 1 }] });

  const rows = salesByProduct({});
  const a = rows.find(r => r.sku === 'PROD-A');
  const b = rows.find(r => r.sku === 'PROD-B');
  assert.equal(a.sold_qty, 4);
  assert.equal(a.returned_qty, 1);
  assert.equal(a.net_qty, 3);
  assert.equal(b.net_qty, 2);
  assert.equal(rows[0].sku, 'PROD-B');   // highest net first
});

test('salesByProduct respects limit', () => {
  for (let i = 0; i < 3; i++) {
    const p = createProduct({ sku: `PR-${i}`, name: `Item ${i}`, price_cents: 100 }).id;
    createSale({ storeId, lines: [{ productId: p, quantity: 1 }] });
  }
  assert.equal(salesByProduct({}).length, 3);
  assert.equal(salesByProduct({ limit: 2 }).length, 2);
});

test('hourlyHeatmap returns (dow, hour, count, cents) buckets', () => {
  login('admin', 'admin');
  const p = createProduct({ sku: 'PROD-H', name: 'Heat', price_cents: 100 }).id;
  const s1 = createSale({ storeId, lines: [{ productId: p, quantity: 2 }] });    // 200
  const s2 = createSale({ storeId, lines: [{ productId: p, quantity: 3 }] });    // 300

  const rows = hourlyHeatmap({});
  assert.ok(rows.length >= 1);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const totalCents = rows.reduce((s, r) => s + r.cents, 0);
  assert.equal(totalCount, 2);
  assert.equal(totalCents, 500);
  // Each row has integer dow 0..6 and hour 0..23
  for (const r of rows) {
    assert.ok(r.dow >= 0 && r.dow <= 6);
    assert.ok(r.hour >= 0 && r.hour <= 23);
  }
});

test('hourlyHeatmap respects store filter', () => {
  login('admin', 'admin');
  const storeB = createStore({ name: 'Second' }).id;
  const p = createProduct({ sku: 'PROD-H2', name: 'Heat2', price_cents: 100 }).id;
  createSale({ storeId,  lines: [{ productId: p, quantity: 1 }] });
  createSale({ storeId: storeB, lines: [{ productId: p, quantity: 1 }] });

  const a = hourlyHeatmap({ storeId });
  const b = hourlyHeatmap({ storeId: storeB });
  assert.equal(a.reduce((s, r) => s + r.count, 0), 1);
  assert.equal(b.reduce((s, r) => s + r.count, 0), 1);
});
