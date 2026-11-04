import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { createReturn } from '../src/main/services/returns.js';
import {
  addMovement, onHand, onHandBulk, listMovements,
} from '../src/main/services/stock.js';
import { AuthError, ForbiddenError, ValidationError } from '../src/shared/errors.js';

let db;
let storeId;
let productId;

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

function loginAsSeller() {
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES (?, ?, 'seller')`
  ).run('seller1', db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash);
  login('seller1', 'admin');
}

// ---- schema ----
test('stock_movements table exists with append-only triggers', () => {
  const cols = db.prepare(`PRAGMA table_info(stock_movements)`).all().map(c => c.name);
  for (const c of ['id','product_id','store_id','kind','quantity',
                   'ref_type','ref_id','note','client_uuid','created_at']) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  login('admin', 'admin');
  addMovement({ productId, storeId, kind: 'purchase', quantity: 5 });
  assert.throws(
    () => db.prepare(`UPDATE stock_movements SET quantity = 0`).run(),
    /append-only/
  );
  assert.throws(
    () => db.prepare(`DELETE FROM stock_movements`).run(),
    /append-only/
  );
});

// ---- addMovement ----
test('addMovement requires a signed-in user with a write role', () => {
  logout();
  assert.throws(
    () => addMovement({ productId, storeId, kind: 'purchase', quantity: 5 }),
    AuthError
  );
  loginAsSeller();
  assert.throws(
    () => addMovement({ productId, storeId, kind: 'purchase', quantity: 5 }),
    ForbiddenError
  );
});

test('addMovement rejects sale/return (use the sale/return services)', () => {
  login('admin', 'admin');
  assert.throws(
    () => addMovement({ productId, storeId, kind: 'sale', quantity: -1 }),
    ValidationError
  );
  assert.throws(
    () => addMovement({ productId, storeId, kind: 'return', quantity: 1 }),
    ValidationError
  );
});

test('addMovement validates sign and quantity', () => {
  login('admin', 'admin');
  assert.throws(
    () => addMovement({ productId, storeId, kind: 'purchase', quantity: 0 }),
    ValidationError
  );
  assert.throws(
    () => addMovement({ productId, storeId, kind: 'purchase', quantity: -5 }),
    ValidationError
  );
  assert.throws(
    () => addMovement({ productId: 9999, storeId, kind: 'purchase', quantity: 5 }),
    ValidationError
  );
});

test('purchase adds positive on-hand; onHand sums correctly', () => {
  login('admin', 'admin');
  addMovement({ productId, storeId, kind: 'purchase', quantity: 10 });
  addMovement({ productId, storeId, kind: 'purchase', quantity: 5 });
  assert.equal(onHand(productId), 15);
  assert.equal(onHand(productId, storeId), 15);
});

test('adjust can be positive or negative', () => {
  login('admin', 'admin');
  addMovement({ productId, storeId, kind: 'adjust', quantity: 3, note: 'found' });
  addMovement({ productId, storeId, kind: 'adjust', quantity: -1, note: 'broke' });
  assert.equal(onHand(productId), 2);
});

// ---- sale/return integration ----
test('createSale writes one negative movement per line', () => {
  addMovement({ productId, storeId, kind: 'purchase', quantity: 20 });
  const sale = createSale({
    storeId,
    lines: [{ productId, quantity: 3 }, { productId, quantity: 2 }],
  });
  const movements = db.prepare(
    `SELECT * FROM stock_movements WHERE ref_type='sale' AND ref_id = ? ORDER BY id`
  ).all(sale.id);
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map(m => m.quantity).sort((a,b)=>a-b), [-3, -2]);
  assert.equal(onHand(productId), 15);
});

test('createReturn writes one positive movement per line', () => {
  addMovement({ productId, storeId, kind: 'purchase', quantity: 20 });
  const sale = createSale({ storeId, lines: [{ productId, quantity: 5 }] });
  const saleLineId = sale.lines[0].id;
  const ret = createReturn({ saleId: sale.id, lines: [{ saleLineId, quantity: 2 }] });
  const movements = db.prepare(
    `SELECT * FROM stock_movements WHERE ref_type='return' AND ref_id = ?`
  ).all(ret.id);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].kind, 'return');
  assert.equal(movements[0].quantity, 2);
  assert.equal(onHand(productId), 17);
});

// ---- outbox ----
test('addMovement enqueues exactly one outbox row', () => {
  login('admin', 'admin');
  const before = db.prepare(`SELECT COUNT(*) AS n FROM sync_queue`).get().n;
  const row = addMovement({ productId, storeId, kind: 'purchase', quantity: 7 });

  const rows = db.prepare(`SELECT * FROM sync_queue WHERE entity='stock_movement'`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, row.id);
  const payload = JSON.parse(rows[0].payload);
  assert.equal(payload.client_uuid, row.client_uuid);
  assert.equal(payload.quantity, 7);
  assert.equal(payload.kind, 'purchase');

  const totalAfter = db.prepare(`SELECT COUNT(*) AS n FROM sync_queue`).get().n;
  assert.equal(totalAfter, before + 1);
});

// ---- reads ----
test('onHand requires a signed-in user; storeId filters per store', () => {
  const storeB = createStore({ name: 'Other' }).id;
  addMovement({ productId, storeId, kind: 'purchase', quantity: 10 });
  addMovement({ productId, storeId: storeB, kind: 'purchase', quantity: 4 });
  assert.equal(onHand(productId), 14);
  assert.equal(onHand(productId, storeId), 10);
  assert.equal(onHand(productId, storeB), 4);
  logout();
  assert.throws(() => onHand(productId), AuthError);
});

test('listMovements returns { rows, total }, newest first with joins', () => {
  addMovement({ productId, storeId, kind: 'purchase', quantity: 10 });
  addMovement({ productId, storeId, kind: 'adjust', quantity: -2 });
  const res = listMovements({ productId });
  assert.equal(res.total, 2);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].kind, 'adjust');
  assert.equal(res.rows[0].product_name, 'Alpha');
  assert.equal(res.rows[0].store_name, 'Shop');
});

test('listMovements supports productId / storeId / kind / limit filters', () => {
  const storeB = createStore({ name: 'Other' }).id;
  addMovement({ productId, storeId, kind: 'purchase', quantity: 1 });
  addMovement({ productId, storeId: storeB, kind: 'purchase', quantity: 1 });
  addMovement({ productId, storeId, kind: 'adjust',   quantity: -1 });

  assert.equal(listMovements({ productId }).total, 3);
  assert.equal(listMovements({ productId, storeId }).total, 2);
  assert.equal(listMovements({ productId, storeId: storeB }).total, 1);
  assert.equal(listMovements({ productId, kind: 'adjust' }).total, 1);
  assert.equal(listMovements({ productId, limit: 1 }).rows.length, 1);
});

// ---- onHandBulk ----
test('onHandBulk returns a map of productId → signed sum', () => {
  login('admin', 'admin');
  const p2 = createProduct({ sku: 'B', name: 'Bravo', price_cents: 200 }).id;
  const p3 = createProduct({ sku: 'C', name: 'Charlie', price_cents: 300 }).id;

  addMovement({ productId, storeId, kind: 'purchase', quantity: 10 });
  addMovement({ productId: p2, storeId, kind: 'purchase', quantity: 4 });

  const map = onHandBulk([productId, p2, p3]);
  assert.equal(map[productId], 10);
  assert.equal(map[p2], 4);
  assert.equal(map[p3], undefined);

  assert.deepEqual(onHandBulk([]), {});

  const storeB = createStore({ name: 'Other' }).id;
  addMovement({ productId, storeId: storeB, kind: 'purchase', quantity: 7 });
  assert.equal(onHandBulk([productId], storeId)[productId], 10);
  assert.equal(onHandBulk([productId], storeB)[productId], 7);

  logout();
  assert.throws(() => onHandBulk([productId]), AuthError);
});

// ---- new: listMovements pagination ----
test('listMovements paginates with offset and limit', () => {
  login('admin', 'admin');
  for (let i = 0; i < 5; i++) {
    addMovement({ productId, storeId, kind: 'purchase', quantity: 1 });
  }

  const p1 = listMovements({ offset: 0, limit: 2 });
  const p2 = listMovements({ offset: 2, limit: 2 });
  const p3 = listMovements({ offset: 4, limit: 2 });

  assert.equal(p1.total, 5);
  assert.equal(p1.rows.length, 2);
  assert.equal(p2.rows.length, 2);
  assert.equal(p3.rows.length, 1);

  const allIds = [...p1.rows, ...p2.rows, ...p3.rows].map(r => r.id);
  assert.equal(new Set(allIds).size, 5);
});

// ---- new: listMovements search ----
test('listMovements search matches note, sku, name, and #ref', () => {
  login('admin', 'admin');
  addMovement({ productId, storeId, kind: 'purchase', quantity: 1, note: 'restock monday' });
  const sale = createSale({ storeId, lines: [{ productId, quantity: 1 }] });
  // Sale writes a 'sale' movement with ref_id = sale.id

  // by note
  assert.equal(listMovements({ q: 'monday' }).total, 1);

  // by sku
  assert.equal(listMovements({ q: 'A' }).total >= 2, true);

  // by product name
  assert.equal(listMovements({ q: 'Alpha' }).total >= 2, true);

  // by #ref (sale id)
  const byRef = listMovements({ q: `#${sale.id}` });
  assert.equal(byRef.total >= 1, true);
  assert.ok(byRef.rows.every(r => r.ref_id === sale.id));
});
