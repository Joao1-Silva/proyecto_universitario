# USER MANUAL

## 1. Objetivo

Este manual explica como usar la app paso a paso para operacion diaria.

## 2. Inicio rapido (primera entrada)

1. Abre la aplicacion (web o escritorio).
2. En la pantalla de login, ingresa un usuario inicial:
   - `juan.perez@empresa.com` / `Admin123!`
   - `maria.lopez@empresa.com` / `Finance123!`
3. Pulsa **Iniciar Sesion**.
4. Verifica que aparezca el **Dashboard**.

## 3. Como esta organizada la pantalla

### Menu lateral

- Dashboard
- Monitoreo
- Proveedores
- Ordenes de Compra
- Facturas
- Pagos
- Auditoria
- Reportes
- Ajustes

### Barra superior

- Busqueda global (proveedores, OC, facturas, pagos)
- Notificaciones (vencidas y por vencer)
- Selector de tema
- Indicador de modo de datos: `LOCAL` o `API`
- Menu de usuario (perfil, configuracion, cerrar sesion)

## 4. Flujo recomendado de uso diario

### Paso 1. Revisar Dashboard

1. Entra a **Dashboard**.
2. Revisa KPIs: total adeudado, total vencido, pagos del mes, proveedores criticos.
3. Revisa alertas de facturas vencidas y proximas a vencer.

### Paso 2. Cargar o actualizar Proveedores

1. Entra a **Proveedores**.
2. Pulsa **Nuevo Proveedor**.
3. Completa datos obligatorios:
   - Nombre
   - RIF
   - Email
   - Telefono
   - Responsable
   - Categoria(s)
   - Dias de credito

Categorias disponibles:
- Proteccion Personal (EPP - Cabeza y Cuerpo)
- Proteccion de Extremidades (Manos y Pies)
- Senalizacion y Seguridad Vial
- Consumibles de Escritura y Papeleria
- Insumos de Impresion y Tecnologia

4. Pulsa **Crear Proveedor**.
5. Para editar: abre acciones de la fila y pulsa **Editar**.
6. Para eliminar: abre acciones de la fila y pulsa **Eliminar**.

Nota:
- La eliminacion se bloquea si el proveedor tiene ordenes, facturas o pagos asociados.

### Paso 3. Registrar Ordenes de Compra

1. Entra a **Ordenes de Compra**.
2. Pulsa **Nueva Orden**.
3. Selecciona proveedor y fecha.
4. Agrega items (producto o servicio), cantidad y precio.
5. Opcional: agrega motivo/razon.
6. Pulsa **Crear Orden**.
7. Para detalle y seguimiento, pulsa **Ver** en la fila de la orden.

### Paso 4. Registrar Facturas

1. Entra a **Facturas**.
2. Pulsa **Nueva Factura**.
3. Selecciona la orden de compra.
4. Ingresa numero de factura, monto, fecha de emision y vencimiento.
5. Pulsa **Registrar Factura**.
6. En **Ver** puedes revisar el detalle y el saldo pendiente.

### Paso 5. Registrar Pagos

1. Entra a **Pagos**.
2. Pulsa **Registrar Pago**.
3. Selecciona factura pendiente.
4. Captura fecha, monto, metodo, referencia y notas.
5. Opcional: adjunta comprobante.
6. Pulsa **Registrar Pago**.

Tambien puedes abonar desde:
- Detalle de factura (boton **Abonar**)
- Detalle de orden de compra (boton **Abonar** por factura asociada)

### Paso 6. Revisar Auditoria

1. Entra a **Auditoria**.
2. Filtra por usuario o entidad.
3. Revisa fecha, accion, entidad e IP de cada evento.

### Paso 7. Generar Reportes PDF

1. Entra a **Reportes**.
2. Selecciona el tipo de reporte:
   - Bitacora de actividad por usuario
   - Pagos
   - Facturas
   - Ordenes de compra
3. Aplica filtros (fechas y criterios adicionales por reporte).
4. Pulsa **Consultar datos** para previsualizar.
5. Pulsa **Exportar PDF** para descargar el reporte.

### Paso 8. Configurar Ajustes

1. Entra a **Ajustes**.
2. Pestana **Empresa**:
   - Actualiza razon social, RIF, direccion, telefono y email.
3. Pestana **Usuarios**:
   - Crear, editar o eliminar usuarios.

## 5. Modo de datos: que significa LOCAL y API

- `API`: el backend responde y los modulos de Login, Proveedores y Ajustes usan base de datos.
- `LOCAL`: sin API disponible; esos modulos no operan y debes levantar backend.

En Proveedores se requiere API activa.

```text
resolveDataSource()
   |
   +-- /health OK   -> ApiDataSource
   |
   +-- /health FAIL -> LocalDataSource
```

## 6. Diferencia entre Web y Escritorio

### Web mode

- Corre en navegador.
- Requiere backend activo para Login, Proveedores y Ajustes.

### Electron mode

- Corre como app de escritorio.
- Inicia backend automaticamente.
- Si MariaDB no esta disponible, continua en modo fallback sin caerse.

## 7. Buenas practicas para operacion

1. Crea primero proveedores, luego ordenes, luego facturas y al final pagos.
2. Usa referencias claras en pagos para facilitar el seguimiento.
3. Revisa Dashboard y Monitoreo al inicio del dia.
4. Usa Auditoria para revisar cambios de usuarios y datos sensibles.

## 8. Recuperacion de contrasena por preguntas

1. En login pulsa **Olvidaste tu contrasena?**
2. Ingresa usuario/email.
3. Responde las preguntas de seguridad.
4. Define nueva contrasena y confirmacion.

Notas:
- Las respuestas se almacenan con hash (no texto plano).
- Si superas intentos fallidos en una ventana de tiempo, se activa bloqueo temporal.
- Todos los intentos quedan en auditoria.

## 9. Limitaciones actuales conocidas

- Proveedores tiene integracion dual (`API`/`LOCAL`).
- Otros modulos operan principalmente con logica local actual.
- `TODO[PENDING_DEPENDENCY]`: migracion completa de todos los modulos a backend.
- Las operaciones dependen de backend activo para aplicar RBAC y auditoria persistida.

## 10. Requisitos recomendados para Windows 10/11

- Windows 10 o Windows 11 (64 bits).
- RAM minima: 4 GB (8 GB recomendada).
- Espacio libre sugerido: 2 GB.

Si el equipo tiene pocos recursos o presenta problemas graficos en escritorio:

```bat
set ELECTRON_LOW_RESOURCE_MODE=1
set ELECTRON_DISABLE_GPU=1
```
