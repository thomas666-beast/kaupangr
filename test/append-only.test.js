import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { createReturn } from '../src/main/services/returns.js';

let db;
let saleId;
let saleLineId;
let returnId;
let returnLineId;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  const storeId   = createStore({ name: 'Shop' }).id;
  const productId = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 }).id;
  const sale = createSale({ storeId, lines: [{ productId, quantity: 2 }] });
  saleId = sale.id;
  saleLineId = sale.lines[0].id;
  const ret = createReturn({ saleId, lines: [{ saleLineId, quantity: 1 }] });
  returnId = ret.id;
  returnLineId = ret.lines[0].id;
});

afterEach(() => {
  logout();
  teardown();
});

function expectAbort(stmt, ...args) {
  assert.throws(() => db.prepare(stmt).run(...args), /append-only/);
}

test('sales: UPDATE and DELETE are blocked by DB triggers', () => {
  expectAbort(`UPDATE sales SET total_cents = 0 WHERE id = ?`, saleId);
  expectAbort(`DELETE FROM sales WHERE id = ?`, saleId);
});

test('sales_lines: UPDATE and DELETE are blocked', () => {
  expectAbort(`UPDATE sales_lines SET quantity = 99 WHERE id = ?`, saleLineId);
  expectAbort(`DELETE FROM sales_lines WHERE id = ?`, saleLineId);
});

test('returns: UPDATE and DELETE are blocked', () => {
  expectAbort(`UPDATE returns SET total_cents = 0 WHERE id = ?`, returnId);
  expectAbort(`DELETE FROM returns WHERE id = ?`, returnId);
});

test('return_lines: UPDATE and DELETE are blocked', () => {
  expectAbort(`UPDATE return_lines SET quantity = 99 WHERE id = ?`, returnLineId);
  expectAbort(`DELETE FROM return_lines WHERE id = ?`, returnLineId);
});

test('return qty cannot exceed the sold qty — enforced at DB level too', () => {
  // Service would refuse, but this proves the trigger catches it even if a
  // future code path bypasses the service.
  assert.throws(
    () => db.prepare(
      `INSERT INTO return_lines (return_id, sale_line_id, quantity, unit_price_cents)
       VALUES (?, ?, 999, 100)`
    ).run(returnId, saleLineId),
    /return qty exceeds sold qty/
  );
});
