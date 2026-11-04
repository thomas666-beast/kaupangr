CREATE TABLE stock_movements (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  store_id    INTEGER REFERENCES stores(id),
  kind        TEXT    NOT NULL CHECK (kind IN ('purchase','sale','return','adjust')),
  quantity    INTEGER NOT NULL,
  ref_type    TEXT    CHECK (ref_type IN ('sale','return') OR ref_type IS NULL),
  ref_id      INTEGER,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_stock_movements_product ON stock_movements(product_id);
CREATE INDEX ix_stock_movements_store   ON stock_movements(store_id);
CREATE INDEX ix_stock_movements_ref     ON stock_movements(ref_type, ref_id);

CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements are append-only'); END;
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements are append-only'); END;
