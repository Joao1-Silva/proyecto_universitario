# RBAC MATRIX

## Roles

- `admin` (superusuario): acceso total.
- `finance`: enfocado en facturas y pagos.
- `procura`: enfocado en proveedores y ordenes de compra.

## Permisos por accion

| Permiso | admin | finance | procura |
|---|---|---|---|
| `SUPPLIER_VIEW` | Si | Si | Si |
| `SUPPLIER_CREATE` | Si | No | Si |
| `SUPPLIER_UPDATE` | Si | No | Si |
| `SUPPLIER_DELETE` | Si | No | No |
| `PURCHASE_ORDER_VIEW` | Si | Si | Si |
| `PURCHASE_ORDER_CREATE` | Si | No | Si |
| `PURCHASE_ORDER_STATUS_UPDATE` | Si | No | No |
| `INVOICE_VIEW` | Si | Si | No |
| `INVOICE_CREATE` | Si | Si | No |
| `PAYMENT_VIEW` | Si | Si | No |
| `PAYMENT_CREATE` | Si | Si | No |
| `CATEGORY_VIEW` | Si | Si | Si |
| `CATEGORY_CREATE` | Si | No | Si |
| `USER_MANAGE` | Si | No | No |
| `SETTINGS_MANAGE` | Si | No | No |
| `AUDIT_VIEW` | Si | No | No |
| `REPORT_VIEW` | Si | Si | Si |

## Reglas clave

- `finance` no puede crear/editar/eliminar proveedores ni crear/cancelar ordenes.
- `procura` no puede registrar facturas ni pagos.
- `admin` no tiene restricciones.
