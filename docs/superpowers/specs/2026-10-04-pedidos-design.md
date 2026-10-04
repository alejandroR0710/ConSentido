# Módulo Pedidos — diseño

Fecha: 2026-10-04
Estado: aprobado para plan de implementación

## Contexto y objetivo

El sistema tiene una tabla `pedidos` (y `pedido_items`, `pedido_abonos`) en el esquema desde hace tiempo, pero nunca se conectó a nada: no hay ruta, controlador, ni pantalla. El enlace "Pedidos" del menú lateral no lleva a ningún lado, y el bloque "Pedidos / Encargos" del Dashboard General siempre muestra $0 porque no hay forma de crear un pedido.

El objetivo es construir el módulo completo: registrar lo que pide una persona (del catálogo o a mano), capturar sus datos de envío, llevar el pedido por un flujo de estados (Pendiente → Alistado → Enviado → Entregado, o Cancelado), y — el requisito más importante — avisarle a Root/Super Root con una alarma que se repite cada cierto tiempo mientras un pedido se queda estancado sin avanzar.

## Alcance

Dentro de esta spec:
- CRUD de pedidos con ítems de catálogo o texto libre
- Cliente opcional (se puede crear al vuelo, como en Con Sentido)
- Datos de envío/destinatario
- Flujo de 5 estados con descuento de inventario al alistar
- Abonos parciales, cada uno generando su ingreso en Caja General
- Historial de cambios por pedido
- Alarma recurrente (push + ventana emergente con sonido) para Root/Super Root
- Intervalo de la alarma configurable
- Pantallas: listado, nuevo pedido, detalle, componente global de alarma
- Permisos nuevos para Cajero/Administrador/Root/Super Root

Fuera de alcance (explícitamente, para no desviarnos):
- Integración con transportadoras reales (solo se guarda el nombre y número de guía a mano, sin API de tracking)
- Edición de un pedido ya Entregado o Cancelado
- Alarma durante el estado "Enviado" (ese tiempo depende de la transportadora, no de una tarea interna atrasada)
- Descuento/recargo por envío, impuestos, o cualquier cálculo de precios nuevo — se usa el mismo criterio simple que ya tiene Con Sentido (precio acordado por línea, sin IVA aparte)

## Modelo de datos

### `pedidos` (ALTER sobre la tabla existente)

```sql
ALTER TABLE pedidos MODIFY cliente_id CHAR(36) NULL;

ALTER TABLE pedidos
  ADD COLUMN destinatario_nombre     VARCHAR(150),
  ADD COLUMN destinatario_documento  VARCHAR(30),
  ADD COLUMN destinatario_telefono   VARCHAR(30),
  ADD COLUMN direccion_envio         VARCHAR(250),
  ADD COLUMN ciudad_envio            VARCHAR(100),
  ADD COLUMN transportadora          VARCHAR(100),
  ADD COLUMN numero_guia             VARCHAR(100),
  ADD COLUMN notas_entrega           TEXT,
  ADD COLUMN creado_por_id           CHAR(36),
  ADD COLUMN alistado_en             DATETIME(6),
  ADD COLUMN enviado_en              DATETIME(6),
  ADD COLUMN entregado_en            DATETIME(6),
  ADD COLUMN proxima_alarma_en       DATETIME(6),
  ADD FOREIGN KEY (creado_por_id) REFERENCES usuarios(id);

-- El enum de estado nunca tuvo datos reales (el módulo no existía) — se
-- redefine limpio en vez de mapear los valores viejos. El nombre del CHECK
-- inline lo pone MySQL solo (ej. pedidos_chk_1); en vez de adivinarlo, se
-- busca por catálogo para que la migración no dependa de ese nombre exacto:
SET @chk := (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_NAME = 'pedidos' AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1);
SET @sql := CONCAT('ALTER TABLE pedidos DROP CHECK ', @chk);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE pedidos MODIFY estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
  CHECK (estado IN ('pendiente','alistado','enviado','entregado','cancelado'));
```

`fecha_entrega` se mantiene obligatoria (todo pedido necesita una fecha comprometida).

### `pedido_items` (rediseño — hoy solo admitía catálogo, sin precio)

```sql
DROP TABLE pedido_items; -- nunca tuvo filas reales, se recrea limpio

CREATE TABLE pedido_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id       CHAR(36) NOT NULL,
  producto_id     CHAR(36),              -- opcional: viene del autocompletar
  sku             VARCHAR(50),           -- copiado del producto si está enlazado
  nombre          VARCHAR(150) NOT NULL, -- del producto, o escrito a mano
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
```

Se elimina `insumo_id`: no hay patrón de "insumo suelto" en ningún otro flujo de venta del sistema (Con Sentido/Migao venden `productos`, nunca `insumos` directo) — mantenerlo habría sido una rama sin usar.

### `pedido_historial` (nueva — mismo patrón que `orden_historial` de Migao)

```sql
CREATE TABLE pedido_historial (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id   CHAR(36) NOT NULL,
  accion      VARCHAR(30) NOT NULL, -- creado | cambio_estado | edicion | abono | cancelado
  detalle     JSON,
  usuario_id  CHAR(36),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
```

### `pedido_abonos` (existente, sin cambios de esquema)

Ya tiene `monto`, `metodo_pago`, `usuario_id`. Se le suma, al registrar un abono, una llamada a `cajaService.registrarIngreso` (mismo patrón que `con_sentido.service.ts::registrarVenta`) con `referenciaEntidad='pedido_abonos'`, `referenciaId=abono.id`.

### `pedidos_parametros` (nueva — fila única, mismo patrón que `velas_parametros`/`concreto_parametros`)

```sql
CREATE TABLE pedidos_parametros (
  id                     BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  intervalo_alarma_minutos INT NOT NULL DEFAULT 30,
  updated_at             DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
INSERT INTO pedidos_parametros (id) VALUES (true);
```

## Flujo de estados

```
pendiente --[alistar]--> alistado --[enviar]--> enviado --[entregar]--> entregado
    |                        |
    +------[cancelar]--------+-----------------[cancelar]--------------+
```

- **crear pedido** → estado `pendiente`, `proxima_alarma_en = NOW() + intervalo`
- **pendiente → alistado**: descuenta stock de cada ítem con `producto_id` (mismo `descontarStock` que ya usa Con Sentido — no baja de 0), guarda `alistado_en`, reprograma `proxima_alarma_en = NOW() + intervalo`
- **alistado → enviado**: guarda `enviado_en`, limpia `proxima_alarma_en` (NULL — ya no alarma)
- **enviado → entregado**: guarda `entregado_en`
- **cancelar** (desde pendiente o alistado): si ya estaba alistado, devuelve el stock descontado (sumar de vuelta, mismo criterio que la anulación de ventas de Con Sentido); limpia `proxima_alarma_en`
- Cada transición agrega una fila a `pedido_historial`

## Backend

Nuevo módulo `backend/src/modules/pedidos/` (mismo patrón de 4 archivos que `con_sentido`: `.routes.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`, más `.schema.ts` para los validadores Zod).

### Endpoints

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/pedidos` | `pedidos.ver` | Lista con filtro `?estado=` y `?vencidos=true` |
| GET | `/pedidos/:id` | `pedidos.ver` | Detalle + ítems + abonos + historial |
| POST | `/pedidos` | `pedidos.crear` | Crea pedido (cliente opcional, ítems, envío, abono inicial opcional) |
| PATCH | `/pedidos/:id` | `pedidos.crear` | Edita datos generales (no ítems ni estado) — bloqueado si `entregado`/`cancelado` |
| POST | `/pedidos/:id/estado` | `pedidos.cambiar_estado` | `{ estado: 'alistado'\|'enviado'\|'entregado'\|'cancelado' }` |
| POST | `/pedidos/:id/abonos` | `pedidos.crear` | `{ monto, metodoPago }` → crea ingreso en Caja + fila en `pedido_abonos` |
| GET | `/pedidos/:id/factura` | `pedidos.ver` | Reusa el mismo formato de `FacturaOrden`/`FacturaVentaManual` |
| GET | `/pedidos/alarma` | `pedidos.ver` | Pedidos con `proxima_alarma_en <= NOW()` — lo consume el polling del frontend |
| GET | `/pedidos/parametros` | `pedidos.ver` | `{ intervaloAlarmaMinutos }` |
| PUT | `/pedidos/parametros` | `pedidos.administrar_parametros` | Actualiza el intervalo |

### Proceso de alarma (backend)

Nuevo archivo `backend/src/modules/pedidos/alarma.ts`, mismo patrón `setInterval` que `integracion_ecommerce/salida.ts::iniciarEnvioPeriodico`:

```ts
const INTERVALO_REVISION_MS = 60 * 1000;

export function iniciarRevisionAlarmas() {
  setInterval(() => void revisarPedidosVencidos().catch(console.error), INTERVALO_REVISION_MS).unref?.();
}

async function revisarPedidosVencidos() {
  const vencidos = await repo.listPedidosVencidos(); // estado IN (pendiente, alistado) AND proxima_alarma_en <= NOW()
  const { intervalo_alarma_minutos } = await repo.getParametros();
  for (const pedido of vencidos) {
    await notificacionesService.enviarATodosDeRol('Root', payloadAlarma(pedido));
    await notificacionesService.enviarATodosDeRol('Super Root', payloadAlarma(pedido));
    await repo.reprogramarAlarma(pedido.id, intervalo_alarma_minutos);
  }
}
```

Se registra en `server.ts` junto a `iniciarEnvioPeriodico()` (misma línea donde ya arranca la sincronización del e-commerce).

## Frontend

Nuevo módulo `frontend/src/modules/pedidos/` (api.ts + pages/ + components/), mismo patrón que `con_sentido`/`concreto`.

- **`PedidosPage.tsx`**: tabs de estado + filtro "Vencidos", tabla de pedidos, botón "+ Nuevo pedido"
- **`NuevoPedidoModal.tsx`**: buscador/creador de cliente (opcional), líneas de ítems reusando `SugerenciasProducto` (ya construido para Caja) + opción de línea manual, campos de envío, fecha de entrega, abono inicial opcional
- **`DetallePedidoPage.tsx`**: ítems, botones de avance de estado (según permiso), historial, abonos + botón de agregar, datos de envío, botón de factura
- **`ComponenteAlarmaPedidos.tsx`**: vive en `AppShell.tsx`, solo se monta si el rol es Root/Super Root; hace `setInterval` cada 60 s a `GET /pedidos/alarma`; si hay resultados, abre un modal con la lista + reproduce un sonido (`<audio>` con un archivo corto, mismo criterio que las notificaciones push ya usadas en Cocina)
- Se conecta la ruta `/pedidos` en `App.tsx` (hoy el link del menú no tiene adónde ir) y la entrada de `modules-meta.ts`

## Permisos

```sql
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'pedidos'), x.accion, x.codigo
FROM (VALUES
  ('ver', 'pedidos.ver'),
  ('crear', 'pedidos.crear'),
  ('cambiar_estado', 'pedidos.cambiar_estado'),
  ('administrar_parametros', 'pedidos.administrar_parametros')
) AS x(accion, codigo);
```

Asignados a Cajero, Administrador, Root, Super Root — excepto `pedidos.administrar_parametros`, exclusivo de Root/Super Root.

## Verificación

- `npx tsc --noEmit` (backend) y `tsc -b` (frontend) sin errores
- Crear un pedido con cliente opcional + 1 ítem de catálogo + 1 manual, confirmar que aparece en el listado
- Pasarlo a Alistado, confirmar que el stock del ítem de catálogo bajó
- Cancelarlo después de Alistado, confirmar que el stock vuelve
- Confirmar que `proxima_alarma_en` se actualiza al crear/alistar, y se limpia al Enviar/Cancelar
- Confirmar `GET /pedidos/alarma` devuelve el pedido pasados los minutos configurados (se puede bajar el intervalo a 1 minuto para probar)
- Registrar un abono y confirmar que aparece como ingreso en Caja General
