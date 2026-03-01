UPDATE users SET role = 'superadmin' WHERE LOWER(TRIM(role)) IN ('admin', 'superadmin', 'gerente');
UPDATE users SET role = 'finanzas' WHERE LOWER(TRIM(role)) IN ('finance', 'finanzas', 'administradora');
UPDATE users SET role = 'procura' WHERE LOWER(TRIM(role)) IN ('procura', 'viewer', 'compras');
