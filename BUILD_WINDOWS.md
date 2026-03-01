# BUILD_WINDOWS.md

## Objetivo
Generar instalable para Windows 10/11 x64 con frontend Electron+Next y backend Python empaquetado.

## Requisitos
- Windows 10/11 x64
- Node.js >= 20.9.0
- npm >= 10
- Python 3.11+
- Pip con dependencias de `backend/requirements.txt`
- MariaDB (si se usa modo mariadb en runtime) o fallback SQLite

## Preparacion
1. Instalar dependencias frontend:
   - `npm install`
2. Instalar dependencias backend:
   - `cd backend`
   - `python -m pip install -r requirements.txt`
   - `cd ..`
3. Ejecutar migraciones y seed (dev/local):
   - `npm run db:migrate`
   - `npm run db:seed`

## Verificacion previa
1. Compatibilidad Windows:
   - `npm run check:windows`
2. Compilar runtime backend (PyInstaller):
   - `npm run build:backend:runtime`
3. Compilar app (renderer + electron main/preload):
   - `npm run build:app`

## Generar instalable
- x64:
  - `npm run dist:win`
- arm64:
  - `npm run dist:win:arm64`
- ambos:
  - `npm run dist:win:all`

## Salida esperada
- Carpeta: `dist/`
- Artefacto principal x64:
  - `SGA-AGUILERA21-Setup-<version>.exe`

## Instalacion limpia (QA)
1. Ejecutar instalador `.exe` en una maquina sin build previa.
2. Abrir app instalada.
3. Verificar arranque de backend empaquetado (`backend-runtime`) sin errores.
4. Login con usuario seed:
   - superadmin: `juan.perez@empresa.com / Admin123!`
5. Validar flujo principal:
   - Proveedores -> OC -> Certificar/Recibir -> Inventario -> Finanzas -> Monitoreo historico.

## Configuracion de base de datos
- Por defecto backend intenta MariaDB segun `.env`.
- Si MariaDB no esta disponible y `DB_REQUIRE_MARIADB=false`, cae a SQLite local (`backend/portable.db`).
- Para forzar entorno local sin MariaDB:
  - `DB_DIALECT=sqlite`
  - `DB_REQUIRE_MARIADB=false`

## Troubleshooting rapido
- Error de backend runtime no encontrado:
  - ejecutar `npm run build:backend:runtime` antes de `dist:win`.
- Error de migraciones al iniciar:
  - validar `npm run db:migrate:status`.
- Error de conexion DB:
  - revisar variables en `backend/.env`.
