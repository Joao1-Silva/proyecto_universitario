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

CREATE INDEX IF NOT EXISTS idx_finance_payments_po ON finance_payments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_finance_installments_po ON finance_installments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_finance_late_fees_po ON finance_late_fees(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_finance_receipts_po ON finance_receipts(purchase_order_id);

INSERT INTO finance_payments (
  id, purchase_order_id, amount, currency, payment_type, payment_mode, reference, concept, created_by, created_at
)
SELECT
  payments.id,
  invoices.purchase_order_id,
  payments.amount,
  'VES',
  'contado',
  COALESCE(payments.method, 'transferencia'),
  payments.reference,
  payments.notes,
  COALESCE(payments.created_by, 'sistema'),
  COALESCE(payments.created_at, CURRENT_TIMESTAMP)
FROM payments
JOIN invoices ON invoices.id = payments.invoice_id
WHERE NOT EXISTS (SELECT 1 FROM finance_payments fp WHERE fp.id = payments.id);
