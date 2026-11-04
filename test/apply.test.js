
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin } from '../src/main/services/auth.js';
import { applyItem } from '../src/main/services/apply.js';
import { onHand } from '../src/main/services/stock.js';
import { login, logout } from '../src/main/services/auth.js';
import { ValidationError } from '../src/shared/errors.js';

let db;
let storeId;
let productId;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');

  db.prepare(`INSERT INTO stores (id, name) VALUES (1, 'Local Shop')`).run();
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (1, 'Acme')`).run();
  db.prepare(
    `INSERT INTO products (id, sku, name, price_cents, supplier_id)
     VALUES (1, 'SKU-1', 'Alpha', 100, 1)`
  ).run();

  storeId = 1;
  productId = 1;
  logout();
});

afterEach(() => {
  logout();
  teardown();
});

function salePayload(overrides = {}) {
  return {
    id: 1000,
    store_id: storeId,
    seller_id: 1,
    total_cents: 300,
    client_uuid: 'uuid-sale-1',
    created_at: '2026-01-01T10:00:00Z',
    lines: [
      { product_id: productId, quantity: 2, unit_price_cents: 100 },
      { product_id: productId, quantity: 1, unit_price_cents: 100 },
    ],
    ...overrides,
  };
}

test('sale apply also writes stock movements', () => {
  login('admin', 'admin');
  const r = applyItem({ entity: 'sale', op: 'upsert', payload: salePayload() });
  assert.equal(r.applied, true);

  const movs = db.prepare(
    `SELECT * FROM stock_movements WHERE ref_type='sale' ORDER BY id`
  ).all();
  assert.equal(movs.length, 2);
  assert.deepEqual(movs.map(m => m.quantity).sort((a,b)=>a-b), [-2, -1]);
  assert.equal(onHand(productId, storeId), -3);
});

test('re-applying a sale does not create duplicate movements', () => {
  login('admin', 'admin');
  applyItem({ entity: 'sale', op: 'upsert', payload: salePayload() });
  const r = applyItem({ entity: 'sale', op: 'upsert', payload: salePayload({ id: 9999 }) });
  assert.equal(r.applied, false);

  const n = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements`).get().n;
  assert.equal(n, 2);
});

test('stock_movement apply inserts idempotently', () => {
  login('admin', 'admin');
  const payload = {
    product_id: productId,
    store_id: storeId,
    kind: 'purchase',
    quantity: 5,
    client_uuid: 'uuid-purchase-1',
  };
  const r1 = applyItem({ entity: 'stock_movement', op: 'upsert', payload });
  assert.equal(r1.applied, true);

  const r2 = applyItem({ entity: 'stock_movement', op: 'upsert', payload });
  assert.equal(r2.applied, false);
  assert.equal(r2.reason, 'already applied');

  assert.equal(onHand(productId, storeId), 5);
});

test('stock_movement apply rejects sale/return kinds', () => {
  login('admin', 'admin');
  assert.throws(
    () => applyItem({
      entity: 'stock_movement', op: 'upsert',
      payload: { product_id: productId, kind: 'sale', quantity: -1, client_uuid: 'x' },
    }),
    ValidationError
  );
});
