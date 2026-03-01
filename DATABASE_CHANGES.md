# DATABASE_CHANGES.md

## Contexto
Este proyecto migro de un esquema runtime ad-hoc a migraciones SQL versionadas con control en `schema_migrations`, manteniendo tablas legacy para rollback y trazabilidad.

## Convencion
- Ruta: `migrations/<version>/up.sql` y `migrations/<version>/down.sql`
- Runner: `backend/app/migration_runner.py`
- Comandos: `npm run db:migrate`, `npm run db:migrate:down`, `npm run db:migrate:status`, `npm run db:seed`

---

## 2026-03-01 - 20260301_001_schema_migrations
- Proposito: base transaccional de migraciones + bootstrap de tablas core.
- Tablas afectadas:
  - nuevas: `schema_migrations`, `users`, `categories`, `suppliers`, `supplier_category_links`, `purchase_orders`, `purchase_order_items`, `audit_logs`, `movement_history`, `products`, `price_lists`, `price_list_items`, `departments`, `inventory_items`, `inventory_movements`, `finance_payments`, `finance_installments`, `finance_late_fees`, `finance_receipts`, `invoices`, `payments`, `bank_transactions`, `security_questions`, `user_security_questions`, `password_recovery_attempts`, `company_settings`, `late_fees`.
- Columnas clave:
  - proveedores: `rif`, `phone_country_code`, `phone_number`, `phone_e164`, `is_active`.
  - OC: `rejection_reason`, `approved_by`, `approved_at`, `rejected_by`, `rejected_at`, `submitted_at`, `certified_at`, `received_at`.
- Indices/constraints:
  - PK por tabla + `UNIQUE` en `users.email`, `categories.name`, `purchase_orders.order_number`, `finance_receipts.receipt_number`, etc.
- Scripts:
  - `migrations/20260301_001_schema_migrations/up.sql`
  - rollback: `migrations/20260301_001_schema_migrations/down.sql`

## 2026-03-01 - 20260301_002_roles_rbac_canonical
- Proposito: canonizar roles RBAC a `superadmin`, `finanzas`, `procura`.
- Tablas afectadas: `users`.
- Columnas cambiadas: `users.role` (normalizacion de valores legacy `admin/finance/viewer`).
- Scripts:
  - `migrations/20260301_002_roles_rbac_canonical/up.sql`
  - rollback: `migrations/20260301_002_roles_rbac_canonical/down.sql`

## 2026-03-01 - 20260301_003_movement_history
- Proposito: historico persistente de movimientos para modulo Monitoreo.
- Tablas afectadas: `movement_history`, lectura de `audit_logs` para backfill.
- Columnas nuevas: `created_at`, `event_type`, `user_id`, `detail_json`, `result`, `error_message`.
- Indices:
  - `idx_movement_history_created_at`
  - `idx_movement_history_event_type`
  - `idx_movement_history_user_id`
- Scripts:
  - `migrations/20260301_003_movement_history/up.sql`
  - rollback: `migrations/20260301_003_movement_history/down.sql`

## 2026-03-01 - 20260301_004_suppliers_contact_refactor
- Proposito: normalizacion de contacto de proveedores (RIF + telefono internacional + activacion).
- Tablas afectadas: `suppliers`.
- Columnas nuevas/cambiadas:
  - `rif`, `phone_country_code`, `phone_number`, `phone_e164`, `is_active`.
  - backfill: `rif` desde `rfc`, `is_active` desde `status`.
- Scripts:
  - `migrations/20260301_004_suppliers_contact_refactor/up.sql`
  - rollback: `migrations/20260301_004_suppliers_contact_refactor/down.sql`

## 2026-03-01 - 20260301_005_catalog_products_price_lists
- Proposito: catalogo de materiales tipicos por categoria y listas de precio vigentes.
- Tablas afectadas:
  - nuevas: `products`, `price_lists`, `price_list_items`.
- Indices:
  - `idx_products_category`
  - `idx_price_lists_valid_from`
  - `idx_price_list_items_product`
- Scripts:
  - `migrations/20260301_005_catalog_products_price_lists/up.sql`
  - rollback: `migrations/20260301_005_catalog_products_price_lists/down.sql`

## 2026-03-01 - 20260301_006_purchase_orders_v2
- Proposito: flujo OC v2 y normalizacion de items de OC.
- Tablas afectadas:
  - `purchase_orders` (campos de aprobacion/rechazo/certificacion/recepcion)
  - nueva/normalizada: `purchase_order_items`.
- Columnas nuevas:
  - `rejection_reason`, `approved_by`, `approved_at`, `rejected_by`, `rejected_at`, `submitted_at`, `certified_at`, `received_at`, `updated_at`.
  - `purchase_order_items.removed_by_superadmin_reason` (+ trazabilidad de remocion).
- Indices:
  - `idx_po_items_po`
- Scripts:
  - `migrations/20260301_006_purchase_orders_v2/up.sql`
  - rollback: `migrations/20260301_006_purchase_orders_v2/down.sql`

## 2026-03-01 - 20260301_007_inventory_core
- Proposito: almacen interno con entradas/salidas y departamentos.
- Tablas afectadas:
  - nuevas: `departments`, `inventory_items`, `inventory_movements`.
- Columnas clave:
  - `inventory_movements.type` (`IN`/`OUT`), `department_id`, `purchase_order_id`.
- Indices:
  - `idx_inventory_items_product`
  - `idx_inventory_movements_product`
  - `idx_inventory_movements_created`
- Scripts:
  - `migrations/20260301_007_inventory_core/up.sql`
  - rollback: `migrations/20260301_007_inventory_core/down.sql`

## 2026-03-01 - 20260301_008_finance_module
- Proposito: modulo Finanzas acoplado a OC (pagos/abonos/mora/recibo).
- Tablas afectadas:
  - nuevas: `finance_payments`, `finance_installments`, `finance_late_fees`, `finance_receipts`.
- Indices:
  - `idx_finance_payments_po`
  - `idx_finance_installments_po`
  - `idx_finance_late_fees_po`
  - `idx_finance_receipts_po`
- Migracion de datos:
  - backfill de `payments + invoices` hacia `finance_payments`.
- Scripts:
  - `migrations/20260301_008_finance_module/up.sql`
  - rollback: `migrations/20260301_008_finance_module/down.sql`

## 2026-03-01 - 20260301_009_legacy_module_retirement
- Proposito: retiro tecnico de modulos legacy Facturas/Auditoria/Pagos del flujo activo conservando datos.
- Tablas afectadas:
  - nuevas de resguardo: `legacy_invoices`, `legacy_payments`, `legacy_audit_logs`.
- Migracion de datos:
  - copias `INSERT INTO legacy_* SELECT * FROM ...` idempotentes.
- Scripts:
  - `migrations/20260301_009_legacy_module_retirement/up.sql`
  - rollback: `migrations/20260301_009_legacy_module_retirement/down.sql`

---

## Seed Data - 2026-03-01
- Script: `migrations/seed/seed.sql`
- Objetivo: dataset reproducible para QA/manual testing.
- Cobertura:
  - 6 departamentos (`Operaciones`, `Mantenimiento`, `Compras/Procura`, `Finanzas`, `Almacen`, `HSE`).
  - >=5 proveedores con RIF/email/telefono/is_active.
  - materiales tipicos por categoria.
  - lista de precios vigente con items.
  - stock inicial y movimientos de entrada.
- Estrategia anti-duplicados:
  - `INSERT ... WHERE NOT EXISTS` / `ON CONFLICT` equivalente por motor cuando aplica en script actual.

---

## Ejecucion de scripts
1. Migrar schema: `npm run db:migrate`
2. Ver estado: `npm run db:migrate:status`
3. Seed dev: `npm run db:seed`
4. Rollback 1 paso: `npm run db:migrate:down`
