ALTER TABLE stock_movements ADD COLUMN client_uuid TEXT;

-- Existing rows (if any) keep NULL client_uuid; UNIQUE allows multiple NULLs.
CREATE UNIQUE INDEX ux_stock_movements_client_uuid
  ON stock_movements(client_uuid)
  WHERE client_uuid IS NOT NULL;
  