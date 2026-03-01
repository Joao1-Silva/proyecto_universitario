CREATE TABLE IF NOT EXISTS legacy_invoices AS SELECT * FROM invoices WHERE 1=0;
CREATE TABLE IF NOT EXISTS legacy_payments AS SELECT * FROM payments WHERE 1=0;
CREATE TABLE IF NOT EXISTS legacy_audit_logs AS SELECT * FROM audit_logs WHERE 1=0;

INSERT INTO legacy_invoices SELECT * FROM invoices WHERE id NOT IN (SELECT id FROM legacy_invoices);
INSERT INTO legacy_payments SELECT * FROM payments WHERE id NOT IN (SELECT id FROM legacy_payments);
INSERT INTO legacy_audit_logs SELECT * FROM audit_logs WHERE id NOT IN (SELECT id FROM legacy_audit_logs);
