CREATE TABLE IF NOT EXISTS daily_totals (
  day            TEXT    NOT NULL,
  store_id       INTEGER NOT NULL,
  seller_id      INTEGER NOT NULL,
  sales_count    INTEGER NOT NULL DEFAULT 0,
  sales_cents    INTEGER NOT NULL DEFAULT 0,
  returns_count  INTEGER NOT NULL DEFAULT 0,
  returns_cents  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, store_id, seller_id)
);

CREATE INDEX IF NOT EXISTS ix_daily_totals_day    ON daily_totals(day);
CREATE INDEX IF NOT EXISTS ix_daily_totals_store  ON daily_totals(store_id);
CREATE INDEX IF NOT EXISTS ix_daily_totals_seller ON daily_totals(seller_id);

CREATE TABLE IF NOT EXISTS daily_product_totals (
  day             TEXT    NOT NULL,
  product_id      INTEGER NOT NULL,
  sold_qty        INTEGER NOT NULL DEFAULT 0,
  sold_cents      INTEGER NOT NULL DEFAULT 0,
  returned_qty    INTEGER NOT NULL DEFAULT 0,
  returned_cents  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, product_id)
);

CREATE INDEX IF NOT EXISTS ix_daily_product_totals_day ON daily_product_totals(day);
CREATE INDEX IF NOT EXISTS ix_daily_product_totals_pid ON daily_product_totals(product_id);

INSERT INTO app_meta (key, value) VALUES ('daily_totals_backfilled', '0')
ON CONFLICT(key) DO NOTHING;
