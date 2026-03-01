ALTER TABLE purchase_orders ADD COLUMN rejection_reason TEXT NULL;
ALTER TABLE purchase_orders ADD COLUMN approved_by VARCHAR(64) NULL;
ALTER TABLE purchase_orders ADD COLUMN approved_at DATETIME NULL;
ALTER TABLE purchase_orders ADD COLUMN rejected_by VARCHAR(64) NULL;
ALTER TABLE purchase_orders ADD COLUMN rejected_at DATETIME NULL;
ALTER TABLE purchase_orders ADD COLUMN submitted_at DATETIME NULL;
ALTER TABLE purchase_orders ADD COLUMN certified_at DATETIME NULL;
ALTER TABLE purchase_orders ADD COLUMN received_at DATETIME NULL;
ALTER TABLE purchase_orders ADD COLUMN updated_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id VARCHAR(64) PRIMARY KEY,
  purchase_order_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NULL,
  description TEXT NOT NULL,
  quantity FLOAT NOT NULL,
  unit VARCHAR(32) NULL,
  unit_price FLOAT NOT NULL,
  total FLOAT NOT NULL,
  category_id VARCHAR(64) NULL,
  removed_by_superadmin BOOLEAN NOT NULL DEFAULT 0,
  removed_by_superadmin_reason TEXT NULL,
  removed_by VARCHAR(64) NULL,
  removed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
