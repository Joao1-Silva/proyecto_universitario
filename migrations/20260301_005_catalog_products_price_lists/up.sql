CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  category_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  unit VARCHAR(32) NOT NULL,
  is_typical BOOLEAN NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS price_lists (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  valid_from DATETIME NOT NULL,
  valid_to DATETIME NULL,
  supplier_id VARCHAR(64) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'VES',
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id VARCHAR(64) PRIMARY KEY,
  price_list_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  price FLOAT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_valid_from ON price_lists(valid_from);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON price_list_items(product_id);
