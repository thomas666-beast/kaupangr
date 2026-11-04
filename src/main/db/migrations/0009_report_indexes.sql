-- Speed up date-range filters on the two biggest tables.
CREATE INDEX IF NOT EXISTS ix_sales_created_at      ON sales(created_at);
CREATE INDEX IF NOT EXISTS ix_returns_created_at    ON returns(created_at);

-- Speed up per-store and per-seller grouping.
CREATE INDEX IF NOT EXISTS ix_sales_store_id        ON sales(store_id);
CREATE INDEX IF NOT EXISTS ix_sales_seller_id       ON sales(seller_id);
CREATE INDEX IF NOT EXISTS ix_returns_store_id      ON returns(store_id);
CREATE INDEX IF NOT EXISTS ix_returns_user_id       ON returns(user_id);
