# TECHNICAL MANUAL

## 1. Alcance

El repositorio soporta actualmente:

- Web mode (Next.js/React + store local)
- Desktop mode (Electron + renderer Next.js)
- Backend FastAPI + SQLAlchemy
- Persistencia MariaDB con fallback seguro

## 2. Arquitectura general (ASCII)

```text
+---------------------------+         IPC (contextBridge)         +---------------------------+
| Renderer (Next.js)        | <---------------------------------> | Electron Main             |
| - pages/components        |                                     | - lifecycle de ventana    |
| - selector de data source |                                     | - spawn/stop backend      |
+-------------+-------------+                                     +-------------+-------------+
              |                                                                 |
              | HTTP fetch (web) o IPC proxy (electron)                         | child_process
              v                                                                 v
+---------------------------+                                     +---------------------------+
| FastAPI backend           | -------- SQLAlchemy --------------> | DB runtime mode           |
| - settings/db/health/main |                                     | - MariaDB (primary)       |
| - crud + routes           |                                     | - SQLite in-memory        |
+---------------------------+                                     | - none (degradado)        |
                                                                  +---------------------------+
```

## 3. Flujo de seleccion de fuente de datos (ASCII)

```text
Frontend resolveDataSource(force?)
            |
            v
        GET /health
            |
            +-- status=ok y mode=api --> ApiDataSource (suppliers)
            |
            +-- error/timeout --------> LocalDataSource
```

## 4. Backend: contrato y componentes

Archivos clave:

- `backend/app/settings.py`
- `backend/app/db.py`
- `backend/app/health.py`
- `backend/app/main.py`
- `backend/app/models.py`
- `backend/app/schemas.py`
- `backend/app/crud.py`
- `backend/app/routes/*.py`

Contrato `GET /health` (campos obligatorios):

```json
{
  "status": "ok",
  "db": "connected | fallback",
  "mode": "api"
}
```

Comportamiento DB:

- MariaDB disponible: `db=connected`
- MariaDB no disponible: fallback automatico a SQLite in-memory
- Si SQLite tambien falla: modo `none` sin crash del backend

Defaults de desarrollo (requeridos):

- `DB_USER=root`
- `DB_PASSWORD=admin`
- `DB_HOST=localhost`
- `DB_PORT=3306`
- `DB_NAME=proyecto_universitario_db`

## 5. Estado de rutas backend

- `auth`: login/me/logout + recuperacion por preguntas de seguridad
- `users`: CRUD con preguntas de seguridad hash
- `suppliers`, `purchase-orders`, `invoices`, `payments`: protegidas por RBAC backend
- `audit-logs`: consulta persistida con filtros
- `reports`: 4 reportes con exportacion PDF (audit log, pagos, facturas, OC)

## 6. Electron: orquestacion backend

`electron/main.ts` implementa:

- spawn backend Python (prioriza `.venv`, fallback a system python)
- espera de `/health` con timeout
- modo de bajo recurso en equipos de 4 GB RAM o menos (o via `ELECTRON_LOW_RESOURCE_MODE=1`)
- opcion de desactivar aceleracion GPU via `ELECTRON_DISABLE_GPU=1`
- IPC para renderer:
  - `backend:health`
  - `backend:request`
  - `backend:status`
- cierre del backend al salir de la app (SIGTERM y escalado forzado si no responde)

Configuracion de seguridad renderer:

- `contextIsolation: true`
- `nodeIntegration: false`

## 7. Frontend dual data source

Componentes relevantes:

- `lib/api-client.ts`
- `lib/data-source/LocalDataSource.ts`
- `lib/data-source/ApiDataSource.ts`
- `lib/data-source/index.ts`
- `app/(dashboard)/suppliers/page.tsx`

Comportamiento esperado:

- Suppliers usa API cuando `/health` esta disponible.
- Si API falla, cambia a modo local para no romper UX.

## 8. Pendientes y riesgos

- Integracion progresiva de todas las vistas para operar 100% API-first.
- `TODO[PENDING_DEPENDENCY]`: hardening de seguridad y pipeline de release desktop (packaging + signing).

## 9. Diagramas actualizados (estado real)

Referencia: `docs/DIAGRAMS_CURRENT_STATE.md`

- Incluye diagrama de secuencia (registro de pago actual).
- Incluye diagrama ER del backend (`backend/app/models.py`).
- Incluye diagrama de clases del backend (`backend/app/models.py`).
