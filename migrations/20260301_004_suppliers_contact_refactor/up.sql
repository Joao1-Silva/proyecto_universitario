ALTER TABLE suppliers ADD COLUMN rif VARCHAR(32) NULL;
ALTER TABLE suppliers ADD COLUMN phone_country_code VARCHAR(8) NULL;
ALTER TABLE suppliers ADD COLUMN phone_number VARCHAR(32) NULL;
ALTER TABLE suppliers ADD COLUMN phone_e164 VARCHAR(32) NULL;
ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1;

UPDATE suppliers
SET rif = COALESCE(NULLIF(rif, ''), NULLIF(rfc, ''))
WHERE rif IS NULL OR rif = '';

UPDATE suppliers
SET is_active = CASE
  WHEN LOWER(COALESCE(status, 'active')) IN ('inactive', 'inactivo', '0', 'false') THEN 0
  ELSE 1
END;
