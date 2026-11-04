------------------------------------------------------------
-- users
------------------------------------------------------------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  login         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('administrator','product_manager','seller')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- sessions: single active session per user (partial unique index)
------------------------------------------------------------
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);

CREATE UNIQUE INDEX ux_sessions_one_active_per_user
  ON sessions(user_id)
  WHERE ended_at IS NULL;

------------------------------------------------------------
-- stores / suppliers / products
------------------------------------------------------------
CREATE TABLE stores (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  address    TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  contact    TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id          INTEGER PRIMARY KEY,
  sku         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  supplier_id INTEGER REFERENCES suppliers(id),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- sales (append-only)
------------------------------------------------------------
CREATE TABLE sales (
  id            INTEGER PRIMARY KEY,
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  seller_id     INTEGER NOT NULL REFERENCES users(id),
  total_cents   INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  client_uuid   TEXT    NOT NULL UNIQUE   -- idempotency for sync
);

CREATE TABLE sales_lines (
  id             INTEGER PRIMARY KEY,
  sale_id        INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE INDEX ix_sales_lines_sale ON sales_lines(sale_id);
CREATE INDEX ix_sales_created_at ON sales(created_at);

------------------------------------------------------------
-- returns (append-only, reference original sale lines)
------------------------------------------------------------
CREATE TABLE returns (
  id            INTEGER PRIMARY KEY,
  sale_id       INTEGER NOT NULL REFERENCES sales(id),
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  total_cents   INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  client_uuid   TEXT    NOT NULL UNIQUE
);

CREATE TABLE return_lines (
  id              INTEGER PRIMARY KEY,
  return_id       INTEGER NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
  sale_line_id    INTEGER NOT NULL REFERENCES sales_lines(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE INDEX ix_return_lines_return ON return_lines(return_id);
CREATE INDEX ix_return_lines_sale_line ON return_lines(sale_line_id);

------------------------------------------------------------
-- append-only enforcement (DB-level)
------------------------------------------------------------
CREATE TRIGGER trg_sales_no_update BEFORE UPDATE ON sales
BEGIN SELECT RAISE(ABORT, 'sales are append-only'); END;
CREATE TRIGGER trg_sales_no_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT, 'sales are append-only'); END;

CREATE TRIGGER trg_sales_lines_no_update BEFORE UPDATE ON sales_lines
BEGIN SELECT RAISE(ABORT, 'sales_lines are append-only'); END;
CREATE TRIGGER trg_sales_lines_no_delete BEFORE DELETE ON sales_lines
BEGIN SELECT RAISE(ABORT, 'sales_lines are append-only'); END;

CREATE TRIGGER trg_returns_no_update BEFORE UPDATE ON returns
BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TRIGGER trg_returns_no_delete BEFORE DELETE ON returns
BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;

CREATE TRIGGER trg_return_lines_no_update BEFORE UPDATE ON return_lines
BEGIN SELECT RAISE(ABORT, 'return_lines are append-only'); END;
CREATE TRIGGER trg_return_lines_no_delete BEFORE DELETE ON return_lines
BEGIN SELECT RAISE(ABORT, 'return_lines are append-only'); END;

------------------------------------------------------------
-- return qty cannot exceed sold qty (across all prior returns)
------------------------------------------------------------
CREATE TRIGGER trg_return_lines_qty_check
BEFORE INSERT ON return_lines
BEGIN
  SELECT RAISE(ABORT, 'return qty exceeds sold qty')
  WHERE NEW.quantity >
    (SELECT sl.quantity
       FROM sales_lines sl
      WHERE sl.id = NEW.sale_line_id)
    -
    (SELECT COALESCE(SUM(rl.quantity),0)
       FROM return_lines rl
      WHERE rl.sale_line_id = NEW.sale_line_id);
END;

------------------------------------------------------------
-- sync outbox (used in Task 9)
------------------------------------------------------------
CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY,
  entity      TEXT    NOT NULL,          -- 'sale' | 'return' | 'product' | 'store' | 'supplier'
  entity_id   INTEGER NOT NULL,
  op          TEXT    NOT NULL CHECK (op IN ('upsert','delete')),
  payload     TEXT    NOT NULL,          -- JSON snapshot
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

CREATE INDEX ix_sync_queue_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;
