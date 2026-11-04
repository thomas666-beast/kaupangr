import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { createReturn } from '../src/main/services/returns.js';
import { buildReceiptHtml } from '../src/main/services/receipts.js';
import { AuthError, ValidationError } from '../src/shared/errors.js';

let db;
let saleId;
let saleLineId;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  const storeId   = createStore({ name: 'Main Shop', address: '1 High Street' }).id;
  const productId = createProduct({ sku: 'COF-001', name: 'Coffee 250g', price_cents: 549 }).id;
  const sale = createSale({ storeId, lines: [{ productId, quantity: 2 }] });
  saleId = sale.id;
  saleLineId = sale.lines[0].id;
});

afterEach(() => {
  logout();
  teardown();
});

test('buildReceiptHtml requires a signed-in user', () => {
  logout();
  assert.throws(() => buildReceiptHtml(1), AuthError);
});

test('buildReceiptHtml throws for unknown sale', () => {
  assert.throws(() => buildReceiptHtml(9999), ValidationError);
});

test('receipt contains store, product, quantity, price, total', () => {
  const html = buildReceiptHtml(saleId);
  assert.ok(html.includes('Main Shop'));
  assert.ok(html.includes('1 High Street'));
  assert.ok(html.includes('Coffee 250g'));
  assert.ok(html.includes('COF-001'));
  assert.ok(html.includes('10.98'));    // 2 × 5.49
  assert.ok(html.includes('Thank you!'));
});

test('receipt shows the returned amount and net when returns exist', () => {
  createReturn({ saleId, lines: [{ saleLineId, quantity: 1 }] });
  const html = buildReceiptHtml(saleId);
  assert.ok(html.includes('Returned'));
  assert.ok(html.includes('-5.49'));
  assert.ok(html.includes('5.49'));     // net
});

test('receipt escapes HTML in product names (no injection)', () => {
  login('admin', 'admin');
  const storeId = db.prepare(`SELECT id FROM stores LIMIT 1`).get().id;
  const productId = createProduct({
    sku: 'EVIL',
    name: '<script>alert(1)</script>',
    price_cents: 100,
  }).id;
  const sale = createSale({ storeId, lines: [{ productId, quantity: 1 }] });
  const html = buildReceiptHtml(sale.id);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
