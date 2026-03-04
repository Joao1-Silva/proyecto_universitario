-- Normaliza registros históricos a USD para cumplir con la política de moneda única.
UPDATE price_lists
SET currency = 'USD'
WHERE currency IS NULL OR UPPER(currency) <> 'USD';

UPDATE finance_payments
SET currency = 'USD'
WHERE currency IS NULL OR UPPER(currency) <> 'USD';

UPDATE finance_installments
SET currency = 'USD'
WHERE currency IS NULL OR UPPER(currency) <> 'USD';

UPDATE finance_receipts
SET currency = 'USD'
WHERE currency IS NULL OR UPPER(currency) <> 'USD';

-- Ajuste de copy consistente en catálogos base.
UPDATE departments
SET name = 'Almacén'
WHERE LOWER(name) = 'almacen';
