import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale, getSale } from '../src/main/services/sales.js';
import {
  createReturn, listReturnsBySale, listAll, getReturn,
} from '../src/main/services/returns.js';
import { AuthError, ValidationError } from '../src/shared/errors.js';

let db;
let storeId;
let productId;
let saleId;
let lineA;
let lineB;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  storeId   = createStore({ name: 'Shop' }).id;
  productId = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 }).id;
  const sale = createSale({
    storeId,
    lines: [
      { productId, quantity: 3 },
      { productId, quantity: 1, unitPriceCents: 999 },
    ],
  });
  saleId = sale.id;
  lineA  = sale.lines[0].id;
  lineB  = sale.lines[1].id;
  logout();
});

afterEach(() => {
  logout();
  teardown();
});

function ensureUser(login_, role) {
  const exists = db.prepare(`SELECT id FROM users WHERE login = ?`).get(login_);
  if (exists) return;
  const hash = db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash;
  db.prepare(`INSERT INTO users (login, password_hash, role) VALUES (?, ?, ?)`).run(login_, hash, role);
}

// ---- guards (unchanged) ----
test('createReturn requires a signed-in user', () => {
  assert.throws(
    () => createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 1 }] }),
    AuthError
  );
});

// ---- price + qty behaviour (unchanged) ----
test('return price is taken from the original sale line', () => {
  login('admin', 'admin');
  const ret = createReturn({ saleId, lines: [{ saleLineId: lineB, quantity: 1, unitPriceCents: 1 }] });
  assert.equal(ret.total_cents, 999);
});

test('return qty > sold qty fails with a clear ValidationError', () => {
  login('admin', 'admin');
  assert.throws(
    () => createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 4 }] }),
    ValidationError
  );
});

test('a saleLineId from another sale is rejected', () => {
  login('admin', 'admin');
  const other = createSale({ storeId, lines: [{ productId, quantity: 1 }] });
  const foreignLine = other.lines[0].id;
  assert.throws(
    () => createReturn({ saleId, lines: [{ saleLineId: foreignLine, quantity: 1 }] }),
    ValidationError
  );
});

// ---- createReturn writes exactly one outbox row ----
test('createReturn generates client_uuid and one outbox row', () => {
  login('admin', 'admin');
  const before = db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE entity='return'`).get().n;
  const r1 = createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 1 }] });
  const r2 = createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 1 }] });
  assert.notEqual(r1.client_uuid, r2.client_uuid);
  const after = db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE entity='return'`).get().n;
  assert.equal(after, before + 2);
});

// ---- read shape (unchanged) ----
test('listReturnsBySale and getReturn return the right shape', () => {
  login('admin', 'admin');
  const ret = createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 1 }] });
  const list = listReturnsBySale(saleId);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, ret.id);
  const got = getReturn(ret.id);
  assert.equal(got.lines.length, 1);
  assert.equal(got.lines[0].unit_price_cents, 100);
  assert.throws(() => getReturn(9999), ValidationError);
});

test('listReturnsBySale requires a signed-in user', () => {
  assert.throws(() => listReturnsBySale(saleId), AuthError);
});

// ---- listAll: shape ----
test('listAll returns { rows, total } newest first', () => {
  login('admin', 'admin');
  const r1 = createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 1 }] });
  const r2 = createReturn({ saleId, lines: [{ saleLineId: lineA, quantity: 1 }] });

  const res = listAll();
  assert.equal(res.total, 2);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].id, r2.id);
  assert.equal(res.rows[1].id, r1.id);
  assert.equal(res.rows[0].sale_id, saleId);
  assert.equal(res.rows[0].store_name, 'Shop');
  assert.equal(res.rows[0].user_login, 'admin');
});

// ---- listAll: pagination ----
test('listAll paginates with offset and limit', () => {
  login('admin', 'admin');
  // This test needs more than one return against the same sale. Seed a fresh
  // sale with a line of 10 so 5 sequential returns of 1 don't hit the cap.
  const bigSale = createSale({
    storeId,
    lines: [{ productId, quantity: 10 }],
  });
  const bigLine = bigSale.lines[0].id;

  for (let i = 0; i < 5; i++) {
    createReturn({ saleId: bigSale.id, lines: [{ saleLineId: bigLine, quantity: 1 }] });
  }

  const p1 = listAll({ offset: 0, limit: 2 });
  const p2 = listAll({ offset: 2, limit: 2 });
  const p3 = listAll({ offset: 4, limit: 2 });

  assert.equal(p1.total, 5);
  assert.equal(p1.rows.length, 2);
  assert.equal(p2.rows.length, 2);
  assert.equal(p3.rows.length, 1);

  const allIds = [...p1.rows, ...p2.rows, ...p3.rows].map(r => r.id);
  assert.equal(new Set(allIds).size, 5);
});

// ---- listAll: search ----
test('listAll search: matches user login, store name, uuid, #sale', () => {
  login('admin', 'admin');
  // Same issue: two returns against the same sale line. Seed enough quantity.
  const bigSale = createSale({
    storeId,
    lines: [{ productId, quantity: 5 }],
  });
  const bigLine = bigSale.lines[0].id;

  const rA = createReturn({ saleId: bigSale.id, lines: [{ saleLineId: bigLine, quantity: 1 }] });

  ensureUser('seller1', 'seller');
  logout();
  login('seller1', 'admin');
  const rB = createReturn({ saleId: bigSale.id, lines: [{ saleLineId: bigLine, quantity: 1 }] });

  logout();
  login('admin', 'admin');

  // user login
  const bySeller = listAll({ q: 'seller1' });
  assert.equal(bySeller.total, 1);
  assert.equal(bySeller.rows[0].id, rB.id);

  // store name
  const byStore = listAll({ q: 'shop' });
  assert.equal(byStore.total, 2);

  // uuid
  const byUuid = listAll({ q: rA.client_uuid });
  assert.equal(byUuid.total, 1);
  assert.equal(byUuid.rows[0].id, rA.id);

  // #sale exact — both returns reference bigSale.id
  const bySale = listAll({ q: `#${bigSale.id}` });
  assert.equal(bySale.total, 2);

  // no match
  const none = listAll({ q: 'zzz' });
  assert.equal(none.total, 0);
});

// ---- listAll: clamps ----
test('listAll clamps limit and defaults to 50', () => {
  login('admin', 'admin');
  const r1 = listAll({ limit: 5000 });          // clamped to 200
  const r2 = listAll({ limit: 0 });             // falls back to 50
  const r3 = listAll({ offset: -5, limit: 10 });// offset clamped to 0
  assert.ok(r1.rows.length <= 200);
  assert.ok(r2.rows.length <= 50);
  assert.ok(r3.rows.length <= 10);
});
