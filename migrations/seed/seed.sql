-- Seed base departments
INSERT INTO departments (id, name, is_active, created_at)
SELECT 'dept_operaciones', 'Operaciones', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = 'dept_operaciones');
INSERT INTO departments (id, name, is_active, created_at)
SELECT 'dept_mantenimiento', 'Mantenimiento', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = 'dept_mantenimiento');
INSERT INTO departments (id, name, is_active, created_at)
SELECT 'dept_procura', 'Compras/Procura', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = 'dept_procura');
INSERT INTO departments (id, name, is_active, created_at)
SELECT 'dept_finanzas', 'Finanzas', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = 'dept_finanzas');
INSERT INTO departments (id, name, is_active, created_at)
SELECT 'dept_almacen', 'Almacen', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = 'dept_almacen');
INSERT INTO departments (id, name, is_active, created_at)
SELECT 'dept_hse', 'HSE', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = 'dept_hse');

-- Seed suppliers
INSERT INTO suppliers (
  id, name, rfc, rif, email, phone_country_code, phone_number, phone_e164, phone, category_ids, responsible, status, is_active, credit_days, balance, created_at
)
SELECT 'supplier_seed_001', 'Aguilera Industrial Supply C.A.', 'J-41234567-8', 'J-41234567-8', 'contacto@aguilera-supply.com', '+58', '4121234567', '+584121234567', '+58 4121234567', '[]', 'Luis Aguilera', 'active', 1, 30, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE rif = 'J-41234567-8');

INSERT INTO suppliers (
  id, name, rfc, rif, email, phone_country_code, phone_number, phone_e164, phone, category_ids, responsible, status, is_active, credit_days, balance, created_at
)
SELECT 'supplier_seed_002', 'Andes Safety Tools S.A.', 'J-42345678-9', 'J-42345678-9', 'ventas@andessafety.com', '+58', '4149876543', '+584149876543', '+58 4149876543', '[]', 'Mariana Toro', 'active', 1, 15, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE rif = 'J-42345678-9');

INSERT INTO suppliers (
  id, name, rfc, rif, email, phone_country_code, phone_number, phone_e164, phone, category_ids, responsible, status, is_active, credit_days, balance, created_at
)
SELECT 'supplier_seed_003', 'Procura Global Equipments', 'J-43456789-0', 'J-43456789-0', 'info@procuraglobal.com', '+57', '3015557788', '+573015557788', '+57 3015557788', '[]', 'Carlos Londoño', 'active', 1, 45, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE rif = 'J-43456789-0');

INSERT INTO suppliers (
  id, name, rfc, rif, email, phone_country_code, phone_number, phone_e164, phone, category_ids, responsible, status, is_active, credit_days, balance, created_at
)
SELECT 'supplier_seed_004', 'Latam MRO Solutions', 'J-44567890-1', 'J-44567890-1', 'mro@latamsolutions.com', '+51', '987654321', '+51987654321', '+51 987654321', '[]', 'Gabriela Paredes', 'active', 1, 20, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE rif = 'J-44567890-1');

INSERT INTO suppliers (
  id, name, rfc, rif, email, phone_country_code, phone_number, phone_e164, phone, category_ids, responsible, status, is_active, credit_days, balance, created_at
)
SELECT 'supplier_seed_005', 'Tecno Industrial del Caribe', 'J-45678901-2', 'J-45678901-2', 'soporte@tecnocaribe.com', '+58', '4244567890', '+584244567890', '+58 4244567890', '[]', 'Josefina Mendez', 'active', 1, 10, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE rif = 'J-45678901-2');

-- Supplier categories links
INSERT INTO supplier_category_links (supplier_id, category_id, created_at)
SELECT 'supplier_seed_001', 'cat-epp-cabeza-cuerpo', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM supplier_category_links WHERE supplier_id='supplier_seed_001' AND category_id='cat-epp-cabeza-cuerpo');
INSERT INTO supplier_category_links (supplier_id, category_id, created_at)
SELECT 'supplier_seed_002', 'cat-extremidades', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM supplier_category_links WHERE supplier_id='supplier_seed_002' AND category_id='cat-extremidades');
INSERT INTO supplier_category_links (supplier_id, category_id, created_at)
SELECT 'supplier_seed_003', 'cat-senalizacion-vial', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM supplier_category_links WHERE supplier_id='supplier_seed_003' AND category_id='cat-senalizacion-vial');
INSERT INTO supplier_category_links (supplier_id, category_id, created_at)
SELECT 'supplier_seed_004', 'cat-escritura-papeleria', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM supplier_category_links WHERE supplier_id='supplier_seed_004' AND category_id='cat-escritura-papeleria');
INSERT INTO supplier_category_links (supplier_id, category_id, created_at)
SELECT 'supplier_seed_005', 'cat-impresion-tecnologia', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM supplier_category_links WHERE supplier_id='supplier_seed_005' AND category_id='cat-impresion-tecnologia');

-- Typical products by category (25 items)
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_001', 'cat-epp-cabeza-cuerpo', 'Casco de seguridad industrial', 'Casco dieléctrico clase E', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_001');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_002', 'cat-epp-cabeza-cuerpo', 'Lentes antiempañantes', 'Protección visual transparente', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_002');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_003', 'cat-epp-cabeza-cuerpo', 'Respirador media cara', 'Filtro para partículas y vapores', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_003');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_004', 'cat-epp-cabeza-cuerpo', 'Chaleco reflectivo clase 2', 'Alta visibilidad', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_004');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_005', 'cat-epp-cabeza-cuerpo', 'Arnés de seguridad 4 puntos', 'Trabajo en altura', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_005');

INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_006', 'cat-extremidades', 'Guantes anticorte nivel 5', 'Fibra de alto desempeño', 'par', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_006');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_007', 'cat-extremidades', 'Guantes de nitrilo industrial', 'Desechables reforzados', 'caja', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_007');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_008', 'cat-extremidades', 'Botas de seguridad punta de acero', 'Suela antideslizante', 'par', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_008');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_009', 'cat-extremidades', 'Rodilleras reforzadas', 'Protección de impacto', 'par', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_009');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_010', 'cat-extremidades', 'Mangas antiabrasión', 'Protección ante fricción', 'par', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_010');

INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_011', 'cat-senalizacion-vial', 'Cono de seguridad 75cm', 'PVC reflectivo', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_011');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_012', 'cat-senalizacion-vial', 'Cinta de demarcación amarilla', 'Uso industrial', 'rollo', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_012');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_013', 'cat-senalizacion-vial', 'Señal piso mojado', 'Polipropileno', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_013');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_014', 'cat-senalizacion-vial', 'Baliza LED recargable', 'Señalización nocturna', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_014');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_015', 'cat-senalizacion-vial', 'Tope de estacionamiento', 'Caucho reciclado', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_015');

INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_016', 'cat-escritura-papeleria', 'Resma carta 75g', 'Papel multipropósito', 'paquete', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_016');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_017', 'cat-escritura-papeleria', 'Bolígrafos azules', 'Caja x 12', 'caja', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_017');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_018', 'cat-escritura-papeleria', 'Marcadores permanentes', 'Punta fina', 'caja', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_018');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_019', 'cat-escritura-papeleria', 'Archivador tamaño carta', 'Lomo ancho', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_019');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_020', 'cat-escritura-papeleria', 'Etiquetas adhesivas', 'A4 multiuso', 'paquete', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_020');

INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_021', 'cat-impresion-tecnologia', 'Toner láser negro', 'Compatible HP/Canon', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_021');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_022', 'cat-impresion-tecnologia', 'Cartucho tinta color', 'Tricolor', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_022');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_023', 'cat-impresion-tecnologia', 'Memoria USB 32GB', 'USB 3.0', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_023');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_024', 'cat-impresion-tecnologia', 'Disco SSD 480GB', 'SATA III', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_024');
INSERT INTO products (id, category_id, name, description, unit, is_typical, is_active, created_by, created_at)
SELECT 'prod_025', 'cat-impresion-tecnologia', 'Cable de red Cat6', '1 metro', 'unidad', 1, 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='prod_025');

-- Seed one active price list
INSERT INTO price_lists (id, name, valid_from, valid_to, supplier_id, currency, is_active, created_by, created_at)
SELECT 'pl_20260301_base', 'Lista Base Marzo 2026', CURRENT_TIMESTAMP, NULL, NULL, 'VES', 1, 'seed', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM price_lists WHERE id='pl_20260301_base');

-- 25 price list items
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_001','pl_20260301_base','prod_001','unidad',65,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_001');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_002','pl_20260301_base','prod_002','unidad',18,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_002');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_003','pl_20260301_base','prod_003','unidad',95,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_003');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_004','pl_20260301_base','prod_004','unidad',22,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_004');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_005','pl_20260301_base','prod_005','unidad',120,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_005');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_006','pl_20260301_base','prod_006','par',28,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_006');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_007','pl_20260301_base','prod_007','caja',15,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_007');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_008','pl_20260301_base','prod_008','par',88,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_008');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_009','pl_20260301_base','prod_009','par',30,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_009');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_010','pl_20260301_base','prod_010','par',24,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_010');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_011','pl_20260301_base','prod_011','unidad',16,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_011');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_012','pl_20260301_base','prod_012','rollo',8,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_012');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_013','pl_20260301_base','prod_013','unidad',12,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_013');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_014','pl_20260301_base','prod_014','unidad',42,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_014');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_015','pl_20260301_base','prod_015','unidad',35,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_015');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_016','pl_20260301_base','prod_016','paquete',7,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_016');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_017','pl_20260301_base','prod_017','caja',6,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_017');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_018','pl_20260301_base','prod_018','caja',9,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_018');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_019','pl_20260301_base','prod_019','unidad',11,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_019');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_020','pl_20260301_base','prod_020','paquete',5,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_020');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_021','pl_20260301_base','prod_021','unidad',45,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_021');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_022','pl_20260301_base','prod_022','unidad',38,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_022');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_023','pl_20260301_base','prod_023','unidad',10,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_023');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_024','pl_20260301_base','prod_024','unidad',75,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_024');
INSERT INTO price_list_items (id, price_list_id, product_id, unit, price, created_at)
SELECT 'pli_025','pl_20260301_base','prod_025','unidad',3,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE id='pli_025');

-- Inventory initial load for 12 products
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_001','prod_001',20,'Rack A1','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_001');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_002','prod_002',50,'Rack A1','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_002');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_003','prod_003',15,'Rack A2','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_003');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_004','prod_006',30,'Rack B1','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_004');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_005','prod_008',18,'Rack B2','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_005');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_006','prod_011',40,'Rack C1','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_006');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_007','prod_012',35,'Rack C2','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_007');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_008','prod_016',60,'Rack D1','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_008');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_009','prod_017',80,'Rack D2','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_009');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_010','prod_021',22,'Rack E1','activo',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_010');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_011','prod_023',26,'Rack E2','activo',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_011');
INSERT INTO inventory_items (id, product_id, stock, location, asset_type, updated_at)
SELECT 'inv_item_012','prod_025',100,'Rack E3','material',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id='inv_item_012');

INSERT INTO inventory_movements (id, type, product_id, qty, department_id, reason, purchase_order_id, created_by, created_at)
SELECT 'inv_mov_seed_001','IN','prod_001',20,NULL,'Carga inicial seed',NULL,'seed',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id='inv_mov_seed_001');
INSERT INTO inventory_movements (id, type, product_id, qty, department_id, reason, purchase_order_id, created_by, created_at)
SELECT 'inv_mov_seed_002','IN','prod_002',50,NULL,'Carga inicial seed',NULL,'seed',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id='inv_mov_seed_002');
INSERT INTO inventory_movements (id, type, product_id, qty, department_id, reason, purchase_order_id, created_by, created_at)
SELECT 'inv_mov_seed_003','IN','prod_003',15,NULL,'Carga inicial seed',NULL,'seed',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id='inv_mov_seed_003');
INSERT INTO inventory_movements (id, type, product_id, qty, department_id, reason, purchase_order_id, created_by, created_at)
SELECT 'inv_mov_seed_004','IN','prod_006',30,NULL,'Carga inicial seed',NULL,'seed',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id='inv_mov_seed_004');
INSERT INTO inventory_movements (id, type, product_id, qty, department_id, reason, purchase_order_id, created_by, created_at)
SELECT 'inv_mov_seed_005','IN','prod_008',18,NULL,'Carga inicial seed',NULL,'seed',CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id='inv_mov_seed_005');
