UPDATE users SET role = 'admin' WHERE LOWER(TRIM(role)) = 'superadmin';
UPDATE users SET role = 'finance' WHERE LOWER(TRIM(role)) = 'finanzas';
UPDATE users SET role = 'procura' WHERE LOWER(TRIM(role)) = 'procura';
