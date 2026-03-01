CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  rfc VARCHAR(32) NULL,
  rif VARCHAR(32) NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NULL,
  phone_country_code VARCHAR(8) NULL,
  phone_number VARCHAR(32) NULL,
  phone_e164 VARCHAR(32) NULL,
  category_ids JSON NULL,
  responsible VARCHAR(255) NOT NULL,
  status VARCHAR(32) NULL,
  is_active BOOLEAN NOT NULL DEFAULT 1,
  credit_days INTEGER NOT NULL DEFAULT 0,
  balance FLOAT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_category_links (
  supplier_id VARCHAR(64) NOT NULL,
  category_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (supplier_id, category_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(64) NOT NULL UNIQUE,
  supplier_id VARCHAR(64) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  date DATETIME NOT NULL,
  status VARCHAR(32) NOT NULL,
  items JSON NULL,
  subtotal FLOAT NOT NULL DEFAULT 0,
  tax FLOAT NOT NULL DEFAULT 0,
  total FLOAT NOT NULL DEFAULT 0,
  reason TEXT NULL,
  rejection_reason TEXT NULL,
  approved_by VARCHAR(64) NULL,
  approved_at DATETIME NULL,
  rejected_by VARCHAR(64) NULL,
  rejected_at DATETIME NULL,
  submitted_at DATETIME NULL,
  certified_at DATETIME NULL,
  received_at DATETIME NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'system',
  action VARCHAR(64) NOT NULL,
  entity VARCHAR(128) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  changes JSON NULL,
  timestamp DATETIME NOT NULL,
  ip_address VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS movement_history (
  id VARCHAR(64) PRIMARY KEY,
  created_at DATETIME NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(128) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  detail_json JSON NULL,
  result VARCHAR(16) NOT NULL,
  error_message TEXT NULL
);

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

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  stock FLOAT NOT NULL DEFAULT 0,
  location VARCHAR(255) NULL,
  asset_type VARCHAR(64) NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(8) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  qty FLOAT NOT NULL,
  department_id VARCHAR(64) NULL,
  reason TEXT NULL,
  purchase_order_id VARCHAR(64) NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_payments (
  id VARCHAR(64) PRIMARY KEY,
  purchase_order_id VARCHAR(64) NOT NULL,
  amount FLOAT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'VES',
  payment_type VARCHAR(16) NOT NULL,
  payment_mode VARCHAR(32) NOT NULL,
  reference VARCHAR(255) NULL,
  concept TEXT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_installments (
  id VARCHAR(64) PRIMARY KEY,
  purchase_order_id VARCHAR(64) NOT NULL,
  finance_payment_id VARCHAR(64) NULL,
  amount FLOAT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'VES',
  concept TEXT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_late_fees (
  id VARCHAR(64) PRIMARY KEY,
  purchase_order_id VARCHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL,
  percentage_monthly FLOAT NULL,
  fixed_amount FLOAT NULL,
  calculated_amount FLOAT NOT NULL,
  concept TEXT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_receipts (
  id VARCHAR(64) PRIMARY KEY,
  receipt_number VARCHAR(64) NOT NULL UNIQUE,
  purchase_order_id VARCHAR(64) NOT NULL,
  finance_payment_id VARCHAR(64) NULL,
  amount FLOAT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'VES',
  generated_pdf_path TEXT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  purchase_order_id VARCHAR(64) NOT NULL,
  supplier_id VARCHAR(64) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  issue_date DATETIME NOT NULL,
  due_date DATETIME NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount FLOAT NOT NULL,
  paid_amount FLOAT NOT NULL DEFAULT 0,
  balance FLOAT NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NOT NULL DEFAULT 'Sistema',
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  payment_number VARCHAR(64) NOT NULL UNIQUE,
  invoice_id VARCHAR(64) NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  supplier_id VARCHAR(64) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  date DATETIME NOT NULL,
  amount FLOAT NOT NULL,
  method VARCHAR(32) NOT NULL,
  reference VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  proof_url TEXT NULL,
  notes TEXT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS security_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_text VARCHAR(255) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_security_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id VARCHAR(64) NOT NULL,
  question_id INTEGER NOT NULL,
  answer_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS password_recovery_attempts (
  id VARCHAR(64) PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  user_id VARCHAR(64) NULL,
  ip_address VARCHAR(64) NOT NULL,
  successful BOOLEAN NOT NULL DEFAULT 0,
  attempted_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS company_settings (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  rfc VARCHAR(64) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  logo TEXT NULL
);

CREATE TABLE IF NOT EXISTS late_fees (
  id VARCHAR(64) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT 0,
  percentage FLOAT NOT NULL DEFAULT 0,
  grace_days INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_movement_history_created_at ON movement_history(created_at);
CREATE INDEX IF NOT EXISTS idx_movement_history_event_type ON movement_history(event_type);
CREATE INDEX IF NOT EXISTS idx_movement_history_user_id ON movement_history(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created ON inventory_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_product ON inventory_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_pl ON price_list_items(price_list_id);
