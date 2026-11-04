import { getDb } from '../db/index.js';
import { insertMovement } from './stock.js';
import { ValidationError } from '../../shared/errors.js';

const MUTABLE     = new Set(['store', 'supplier', 'product']);
const APPEND_ONLY = new Set(['sale', 'return']);
const MOVEMENT    = 'stock_movement';

export function applyItem({ entity, op, payload }) {
  if (!entity) throw new ValidationError('entity required');
  if (!op)     throw new ValidationError('op required');
  if (op !== 'upsert' && op !== 'delete') throw new ValidationError('op must be upsert or delete');
  if (!payload || typeof payload !== 'object') throw new ValidationError('payload required');

  if (MUTABLE.has(entity))     return applyMutable(entity, op, payload);
  if (APPEND_ONLY.has(entity)) return applyAppendOnly(entity, op, payload);
  if (entity === MOVEMENT)     return applyMovement(op, payload);
  throw new ValidationError(`unknown entity: ${entity}`);
}

// ------------------------------------------------------------------
// MUTABLE (unchanged)
// ------------------------------------------------------------------
function applyMutable(entity, op, payload) {
  const table = tableFor(entity);
  const db = getDb();
  if (!Number.isInteger(payload.id)) throw new ValidationError(`${entity}.id required`);
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(payload.id);

  if (op === 'delete') {
    if (!existing) return { applied: false, reason: 'not present' };
    if (existing.is_active === 0) return { applied: false, reason: 'no-op' };
    db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(payload.id);
    return { applied: true };
  }

  const row = normalizeMutable(entity, payload);
  if (!existing) {
    if (Object.keys(row).length === 0)
      throw new ValidationError(`${entity} upsert with no columns`);
    db.prepare(
      `INSERT INTO ${table} (id, ${Object.keys(row).join(', ')})
       VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`
    ).run(payload.id, ...Object.values(row));
    return { applied: true };
  }

  const setCols = Object.keys(row).filter(c => existing[c] !== row[c]);
  if (setCols.length === 0) return { applied: false, reason: 'no-op' };
  db.prepare(
    `UPDATE ${table} SET ${setCols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`
  ).run(...setCols.map(c => row[c]), payload.id);
  return { applied: true };
}

// ------------------------------------------------------------------
// APPEND-ONLY (sale / return) — now also writes stock movements
// ------------------------------------------------------------------
function applyAppendOnly(entity, op, payload) {
  if (op === 'delete') return { applied: false, reason: 'append-only entity, delete ignored' };

  const db = getDb();
  if (!payload.client_uuid) throw new ValidationError(`${entity}.client_uuid required`);
  if (!Number.isInteger(payload.id)) throw new ValidationError(`${entity}.id required`);
  if (!Array.isArray(payload.lines) || payload.lines.length === 0)
    throw new ValidationError(`${entity}.lines required`);

  const table = entity === 'sale' ? 'sales' : 'returns';

  const byUuid = db.prepare(`SELECT id FROM ${table} WHERE client_uuid = ?`).get(payload.client_uuid);
  if (byUuid) return { applied: false, reason: 'already applied' };

  const byId = db.prepare(`SELECT client_uuid FROM ${table} WHERE id = ?`).get(payload.id);
  if (byId && byId.client_uuid !== payload.client_uuid)
    throw new ValidationError(`${entity}.id ${payload.id} collides with a different client_uuid`);

  const tx = db.transaction(() => {
    if (entity === 'sale') insertSale(db, payload);
    else                   insertReturn(db, payload);
  });
  tx();
  return { applied: true };
}

function insertSale(db, payload) {
  db.prepare(
    `INSERT INTO sales (id, store_id, seller_id, total_cents, client_uuid, created_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(
    payload.id, payload.store_id, payload.seller_id,
    payload.total_cents, payload.client_uuid, payload.created_at ?? null
  );
  const insLine = db.prepare(
    `INSERT INTO sales_lines (sale_id, product_id, quantity, unit_price_cents)
     VALUES (?, ?, ?, ?)`
  );
  for (let i = 0; i < payload.lines.length; i++) {
    const l = payload.lines[i];
    insLine.run(payload.id, l.product_id, l.quantity, l.unit_price_cents);
    insertMovement({
      productId: l.product_id,
      storeId: payload.store_id,
      kind: 'sale',
      quantity: -l.quantity,
      refType: 'sale',
      refId: payload.id,
      clientUuid: `${payload.client_uuid}:${i}`,
    });
  }
}

function insertReturn(db, payload) {
  const sale = db.prepare(`SELECT id FROM sales WHERE id = ?`).get(payload.sale_id);
  if (!sale) throw new ValidationError(`return ${payload.id}: sale ${payload.sale_id} not present locally`);

  const localIds = resolveLocalSaleLineIds(db, sale.id, payload.lines);

  db.prepare(
    `INSERT INTO returns (id, sale_id, store_id, user_id, total_cents, client_uuid, created_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(
    payload.id, sale.id, payload.store_id, payload.user_id,
    payload.total_cents, payload.client_uuid, payload.created_at ?? null
  );

  const insLine = db.prepare(
    `INSERT INTO return_lines (return_id, sale_line_id, quantity, unit_price_cents)
     VALUES (?, ?, ?, ?)`
  );
  for (let i = 0; i < payload.lines.length; i++) {
    const l = payload.lines[i];
    insLine.run(payload.id, localIds[i], l.quantity, l.unit_price_cents);
    // product_id is present in the payload thanks to step 19.
    insertMovement({
      productId: l.product_id,
      storeId: payload.store_id,
      kind: 'return',
      quantity: l.quantity,
      refType: 'return',
      refId: payload.id,
      clientUuid: `${payload.client_uuid}:${i}`,
    });
  }
}

function resolveLocalSaleLineIds(db, localSaleId, pulledLines) {
  const localLines = db.prepare(
    `SELECT id, product_id, quantity, unit_price_cents
       FROM sales_lines WHERE sale_id = ? ORDER BY id`
  ).all(localSaleId);
  const used = new Set();
  const result = [];
  for (const pulled of pulledLines) {
    if (Number.isInteger(pulled.product_id) && Number.isInteger(pulled.position)) {
      const byPos = localLines[pulled.position];
      if (byPos && byPos.product_id === pulled.product_id && !used.has(byPos.id)) {
        used.add(byPos.id); result.push(byPos.id); continue;
      }
      throw new ValidationError(
        `return line cannot be mapped: position ${pulled.position} in sale ${localSaleId} ` +
        `is not product ${pulled.product_id}`
      );
    }
    const direct = localLines.find(l => l.id === pulled.sale_line_id && !used.has(l.id));
    if (direct) { used.add(direct.id); result.push(direct.id); continue; }
    const guess = localLines.find(l =>
      !used.has(l.id) &&
      l.quantity >= pulled.quantity &&
      l.unit_price_cents === pulled.unit_price_cents
    );
    if (!guess)
      throw new ValidationError(`return line cannot be mapped to any local sale line of sale ${localSaleId}`);
    used.add(guess.id); result.push(guess.id);
  }
  return result;
}

// ------------------------------------------------------------------
// stock_movement (manual, sync)
// ------------------------------------------------------------------
function applyMovement(op, payload) {
  if (op === 'delete') return { applied: false, reason: 'append-only entity, delete ignored' };

  const db = getDb();
  if (!payload.client_uuid) throw new ValidationError('stock_movement.client_uuid required');
  if (!Number.isInteger(payload.product_id)) throw new ValidationError('stock_movement.product_id required');
  if (!Number.isInteger(payload.quantity) || payload.quantity === 0)
    throw new ValidationError('stock_movement.quantity required');
  if (!['purchase','adjust'].includes(payload.kind))
    throw new ValidationError('stock_movement.kind must be purchase or adjust (sale/return come via their own payloads)');

  const existing = db.prepare(
    `SELECT id FROM stock_movements WHERE client_uuid = ?`
  ).get(payload.client_uuid);
  if (existing) return { applied: false, reason: 'already applied' };

  insertMovement({
    productId: payload.product_id,
    storeId:   Number.isInteger(payload.store_id) ? payload.store_id : null,
    kind:      payload.kind,
    quantity:  payload.quantity,
    refType:   null,
    refId:     null,
    note:      payload.note ?? null,
    clientUuid: payload.client_uuid,
    fromManualApi: false,   // apply is not a "manual" API; sign rules still enforce
  });
  return { applied: true };
}

// ------------------------------------------------------------------
// helpers (unchanged)
// ------------------------------------------------------------------
function tableFor(entity) {
  return entity === 'store' ? 'stores'
       : entity === 'supplier' ? 'suppliers'
       : 'products';
}

const COLUMNS = {
  store:    ['name', 'address', 'is_active'],
  supplier: ['name', 'contact', 'address', 'is_active'],
  product:  ['sku', 'name', 'price_cents', 'supplier_id', 'is_active'],
};

function normalizeMutable(entity, payload) {
  const out = {};
  for (const col of COLUMNS[entity]) {
    if (payload[col] !== undefined) out[col] = payload[col];
  }
  return out;
}
