import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { createReturn } from '../src/main/services/returns.js';
import { backfillIfNeeded } from '../src/main/services/daily-totals.js';

let db, storeId, productId;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  storeId   = createStore({ name: 'Shop' }).id;
  productId = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 }).id;
});

afterEach(() => {
  logout();
  teardown();
});

test('createSale populates daily_totals and daily_product_totals', () => {
  createSale({ storeId, lines: [{ productId, quantity: 3 }] });
  const row = db.prepare(`SELECT * FROM daily_totals`).get();
  assert.ok(row);
  assert.equal(row.sales_count, 1);
  assert.equal(row.sales_cents, 300);
  assert.equal(row.store_id, storeId);

  const prod = db.prepare(`SELECT * FROM daily_product_totals`).get();
  assert.ok(prod);
  assert.equal(prod.sold_qty, 3);
  assert.equal(prod.sold_cents, 300);
});

test('createReturn populates returns columns', () => {
  const sale = createSale({ storeId, lines: [{ productId, quantity: 5 }] });
  createReturn({ saleId: sale.id, lines: [{ saleLineId: sale.lines[0].id, quantity: 2 }] });

  const row = db.prepare(`SELECT * FROM daily_totals`).get();
  assert.equal(row.returns_count, 1);
  assert.equal(row.returns_cents, 200);

  const prod = db.prepare(`SELECT * FROM daily_product_totals`).get();
  assert.equal(prod.returned_qty, 2);
  assert.equal(prod.returned_cents, 200);
});

test('backfillIfNeeded skips when already done', () => {
  createSale({ storeId, lines: [{ productId, quantity: 1 }] });
  const r1 = backfillIfNeeded();
  assert.equal(r1.skipped, undefined);   // first time = backfilled
  const r2 = backfillIfNeeded();
  assert.equal(r2.skipped, true);
});

test('backfill repopulates from raw tables', () => {
  createSale({ storeId, lines: [{ productId, quantity: 4 }] });
  db.exec(`DELETE FROM daily_totals; DELETE FROM daily_product_totals;`);
  db.prepare(`UPDATE app_meta SET value = '0' WHERE key = 'daily_totals_backfilled'`).run();

  backfillIfNeeded();
  const row = db.prepare(`SELECT * FROM daily_totals`).get();
  assert.equal(row.sales_count, 1);
  assert.equal(row.sales_cents, 400);
});
