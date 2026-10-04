# Módulo Pedidos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo Pedidos completo — registrar lo que pide una persona (catálogo o texto libre), capturar sus datos de envío, llevarlo por un flujo de 5 estados con descuento de inventario, abonos parciales, historial, y una alarma recurrente que avisa a Root/Super Root mientras un pedido queda estancado.

**Architecture:** Mismo patrón de 4+1 archivos por módulo que ya usa `con_sentido` (routes/controller/service/repository/schema) en el backend, y `api.ts` + `pages/` + `components/` en el frontend. Reusa al máximo lo que ya existe: `stock-venta.ts` (descontar/reponer stock con observación), `SugerenciasProducto.tsx` (autocompletar de catálogo), `beep.ts::reproducirAlerta` (sonido de alarma), `notificaciones.service.ts::enviarATodosDeRol` (push), y el patrón de polling + `setInterval` recurrente ya usado en `CocinaPage.tsx` e `integracion_ecommerce/salida.ts`.

**Tech Stack:** Node.js + Express + TypeScript (backend), React + TypeScript + Vite (frontend), MySQL 8 (capa de compatibilidad Postgres→MySQL en `shared/db/pool.ts` — se escribe SQL con `$1`, `RETURNING`, `ON CONFLICT` como el resto del repo, la capa lo traduce).

**Spec:** `docs/superpowers/specs/2026-10-04-pedidos-design.md`

## Nota sobre verificación (este repo no tiene framework de tests)

Este proyecto no usa Jest/Vitest/pytest — en ningún módulo existente hay archivos `*.test.ts`. La verificación establecida en todo el repo es: `tsc --noEmit`/`tsc -b` para corrección de tipos, más verificación manual contra la base de datos (SQL) y la UI. Cada tarea de este plan sigue ese mismo patrón en vez de inventar un framework de pruebas nuevo: "escribir código → compilar → verificar manualmente con un comando concreto → commit".

## Global Constraints

- SQL de repositorio se escribe estilo Postgres (`$1`, `RETURNING`, `ON CONFLICT ... DO UPDATE`) — la capa de compatibilidad en `shared/db/pool.ts` lo traduce a MySQL; nunca escribir `?` ni sintaxis MySQL nativa en los repositorios.
- Nunca se borra un pedido: se cancela (mismo criterio que ventas anuladas / mesas desactivadas en el resto del sistema).
- El stock de un ítem de catálogo se descuenta SOLO al pasar a `alistado` (no al crear el pedido) y se devuelve si se cancela después de alistado — reusar `descontarParaVenta`/`reponerStock`/`deltaEcommerce` de `con_sentido`, nunca reescribir esa lógica.
- Todo monto de pedido (`precio_acordado`, `costo_estimado`) se calcula en el servidor a partir de los ítems — nunca se confía en un total mandado por el cliente (mismo criterio que Cotizaciones).
- La alarma solo aplica en estados `pendiente` y `alistado` — nunca en `enviado` (el tiempo de tránsito depende de la transportadora, no de una tarea interna atrasada).
- Cada abono genera su propio ingreso real en Caja General vía `cajaService.registrarIngreso` con `moduloOrigenSlug: 'pedidos'` — nunca se inserta en `movimientos_caja` directo.
- Migraciones de MySQL van en `database/mysql/migraciones/YYYY-MM-DD_<nombre>.sql` (se corren a mano en phpMyAdmin) Y se reflejan también en `database/mysql/schema.sql` (para que una instalación nueva nazca ya con el esquema final) — mismo patrón dual que el resto de migraciones recientes del repo.

## Review Focus

- **Pedido sin ítems**: el Zod schema debe rechazar `items: []` con un mensaje claro — sin esto, se podría crear un pedido vacío que rompe la factura.
- **Cambiar de estado fuera de orden** (ej. de `pendiente` directo a `entregado`, o de `entregado` hacia atrás): el service debe rechazarlo con un mapa de transiciones válidas — sin esto, se podría saltar el descuento de stock de `alistado` y dejar el inventario descuadrado.
- **Cancelar un pedido que nunca llegó a `alistado`**: no debe intentar devolver stock que nunca se descontó (reponerStock de algo que nunca bajó duplicaría inventario) — el service debe distinguir "cancelar desde pendiente" (no toca stock) de "cancelar desde alistado" (sí devuelve).
- **Abono mayor al saldo pendiente del pedido**: debe rechazarse (no tiene sentido un pedido con saldo negativo) — se valida en el service antes de llamar a Caja.
- **Ítem de catálogo sin stock suficiente al alistar**: igual que Con Sentido, debe poder alistarse igual (queda en negativo) pero exigir una observación — reusar exactamente `descontarParaVenta`, nunca reimplementar la validación.
- **Abono por banco sin referencia de transferencia**: regla global del sistema (todo pago recibido con parte en banco exige los últimos 4 del ID de la transferencia, ver `pago-mixto.ts::exigirReferenciaBanco`) — sin esto, `cajaService.registrarIngreso` la rechaza igual, pero hay que exponer el campo en el schema y en el formulario para que el usuario pueda escribirla, no solo toparse con el error.

---

## Task 1: Base de datos — migración + esquema base + permisos

**Files:**
- Create: `database/mysql/migraciones/2026-10-04_modulo_pedidos.sql`
- Modify: `database/mysql/schema.sql` (reemplazar la definición de `pedidos`/`pedido_items`, agregar `pedido_historial` y `pedidos_parametros`)
- Modify: `database/seed.sql` (permisos nuevos + asignación a roles)

**Interfaces:**
- Produces: tablas `pedidos` (ampliada), `pedido_items` (rediseñada), `pedido_historial` (nueva), `pedidos_parametros` (nueva); permisos `pedidos.ver`, `pedidos.crear`, `pedidos.cambiar_estado`, `pedidos.administrar_parametros`; además se concede `con_sentido.clientes.ver` a Cajero y Administrador (lo necesitan para elegir cliente al crear un pedido).

- [ ] **Step 1: Escribir la migración**

Crear `database/mysql/migraciones/2026-10-04_modulo_pedidos.sql`:

```sql
-- ============================================================================
-- Módulo Pedidos — ampliación de pedidos, rediseño de pedido_items,
-- historial, parámetros de alarma y permisos.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL)
-- ANTES de desplegar el código que lo usa.
-- ============================================================================

-- --- pedidos: cliente opcional + datos de envío + timestamps de cada paso ---
ALTER TABLE pedidos MODIFY cliente_id CHAR(36) NULL;

ALTER TABLE pedidos
  ADD COLUMN destinatario_nombre    VARCHAR(150) NULL AFTER fecha_entrega,
  ADD COLUMN destinatario_documento VARCHAR(30)  NULL AFTER destinatario_nombre,
  ADD COLUMN destinatario_telefono  VARCHAR(30)  NULL AFTER destinatario_documento,
  ADD COLUMN direccion_envio        VARCHAR(250) NULL AFTER destinatario_telefono,
  ADD COLUMN ciudad_envio           VARCHAR(100) NULL AFTER direccion_envio,
  ADD COLUMN transportadora         VARCHAR(100) NULL AFTER ciudad_envio,
  ADD COLUMN numero_guia            VARCHAR(100) NULL AFTER transportadora,
  ADD COLUMN notas_entrega          TEXT NULL AFTER numero_guia,
  ADD COLUMN creado_por_id          CHAR(36) NULL AFTER responsable_id,
  ADD COLUMN alistado_en            DATETIME(6) NULL AFTER creado_por_id,
  ADD COLUMN enviado_en             DATETIME(6) NULL AFTER alistado_en,
  ADD COLUMN entregado_en           DATETIME(6) NULL AFTER enviado_en,
  ADD COLUMN proxima_alarma_en      DATETIME(6) NULL AFTER entregado_en,
  ADD CONSTRAINT fk_pedidos_creado_por FOREIGN KEY (creado_por_id) REFERENCES usuarios(id);

-- El enum de estado nunca tuvo datos reales (el módulo no existía) — se
-- redefine limpio. El nombre del CHECK inline lo pone MySQL solo: se busca
-- por catálogo en vez de adivinarlo.
SET @chk := (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos'
               AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1);
SET @sql := CONCAT('ALTER TABLE pedidos DROP CHECK ', @chk);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE pedidos MODIFY estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
  CHECK (estado IN ('pendiente','alistado','enviado','entregado','cancelado'));

CREATE INDEX idx_pedidos_proxima_alarma ON pedidos(proxima_alarma_en);

-- facturas.pedido_id no tenía índice único (a diferencia de venta_id y
-- con_sentido_venta_id) — hace falta para el get-or-create idempotente de
-- la factura del pedido (Task 13): sin esto, un doble clic en "Factura"
-- podría crear dos facturas para el mismo pedido.
CREATE UNIQUE INDEX idx_facturas_pedido_unica ON facturas(pedido_id);

-- --- pedido_items: rediseño (admite texto libre + precio por línea) ---
DROP TABLE pedido_items; -- nunca tuvo filas reales (el módulo no existía)

CREATE TABLE pedido_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id       CHAR(36) NOT NULL,
  producto_id     CHAR(36) NULL,
  sku             VARCHAR(50) NULL,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);

-- --- pedido_historial: nueva, mismo patrón que orden_historial de Migao ---
CREATE TABLE pedido_historial (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id   CHAR(36) NOT NULL,
  accion      VARCHAR(30) NOT NULL,
  detalle     JSON NULL,
  usuario_id  CHAR(36) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_historial_pedido ON pedido_historial(pedido_id);

-- --- pedido_abonos: el metodo_pago existente no coincide con Caja General
-- (efectivo/banco) — se acota para poder generar un ingreso real.
SET @chk2 := (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedido_abonos'
                AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1);
SET @sql2 := CONCAT('ALTER TABLE pedido_abonos DROP CHECK ', @chk2);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

ALTER TABLE pedido_abonos MODIFY metodo_pago VARCHAR(20) NOT NULL
  CHECK (metodo_pago IN ('efectivo','banco'));

-- --- pedidos_parametros: fila única, mismo patrón que velas_parametros ---
CREATE TABLE pedidos_parametros (
  id                        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  intervalo_alarma_minutos  INT NOT NULL DEFAULT 30,
  updated_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
INSERT INTO pedidos_parametros (id) VALUES (true);

-- --- Permisos ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'pedidos'), x.accion, x.codigo
FROM (SELECT 'ver' AS accion, 'pedidos.ver' AS codigo
      UNION ALL SELECT 'crear', 'pedidos.crear'
      UNION ALL SELECT 'cambiar_estado', 'pedidos.cambiar_estado'
      UNION ALL SELECT 'administrar_parametros', 'pedidos.administrar_parametros') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Cajero', 'Administrador', 'Root', 'Super Root')
  AND p.codigo IN ('pedidos.ver', 'pedidos.crear', 'pedidos.cambiar_estado')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'pedidos.administrar_parametros'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- Cajero/Administrador necesitan ver clientes para elegir uno al crear un
-- pedido (hoy ese permiso es exclusivo de Super Root/Root).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Cajero', 'Administrador')
  AND p.codigo = 'con_sentido.clientes.ver'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
```

- [ ] **Step 2: Correr la migración en la base local**

```bash
mysql -u root -p sistemapos < database/mysql/migraciones/2026-10-04_modulo_pedidos.sql
```

(o pegar el contenido en phpMyAdmin si no hay cliente `mysql` instalado localmente)

- [ ] **Step 3: Verificar manualmente**

```sql
DESCRIBE pedidos;        -- confirma las columnas nuevas
DESCRIBE pedido_items;   -- confirma producto_id/sku/nombre/precio_unitario
SELECT * FROM pedidos_parametros;  -- debe traer 1 fila con intervalo_alarma_minutos=30
SELECT codigo FROM permisos WHERE codigo LIKE 'pedidos.%';  -- 4 filas
```

- [ ] **Step 4: Actualizar `database/mysql/schema.sql` para instalaciones nuevas**

Buscar el bloque `CREATE TABLE pedidos (` (sección "PEDIDOS / ENCARGOS") y reemplazar `pedidos`/`pedido_items` completas por su versión final (las mismas columnas que la migración deja), agregar `pedido_historial` y `pedidos_parametros` justo después, y agregar el `CHECK` de `pedido_abonos.metodo_pago` ya acotado a `('efectivo','banco')`. El contenido final de esa sección debe quedar así:

```sql
CREATE TABLE pedidos (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cliente_id              CHAR(36) NULL,
  descripcion             TEXT NOT NULL,
  fecha_entrega           DATE NOT NULL,
  destinatario_nombre     VARCHAR(150) NULL,
  destinatario_documento  VARCHAR(30) NULL,
  destinatario_telefono   VARCHAR(30) NULL,
  direccion_envio         VARCHAR(250) NULL,
  ciudad_envio            VARCHAR(100) NULL,
  transportadora          VARCHAR(100) NULL,
  numero_guia             VARCHAR(100) NULL,
  notas_entrega           TEXT NULL,
  costo_estimado          DECIMAL(12,2) NOT NULL DEFAULT 0,
  precio_acordado         DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado                  VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                           CHECK (estado IN ('pendiente','alistado','enviado','entregado','cancelado')),
  responsable_id          CHAR(36) NULL,
  creado_por_id           CHAR(36) NULL,
  alistado_en             DATETIME(6) NULL,
  enviado_en              DATETIME(6) NULL,
  entregado_en            DATETIME(6) NULL,
  proxima_alarma_en       DATETIME(6) NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  INDEX idx_pedidos_cliente (cliente_id),
  INDEX idx_pedidos_estado_fecha (estado, fecha_entrega),
  INDEX idx_pedidos_proxima_alarma (proxima_alarma_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

ALTER TABLE facturas ADD CONSTRAINT fk_facturas_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
CREATE UNIQUE INDEX idx_facturas_pedido_unica ON facturas(pedido_id);

CREATE TABLE pedido_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id       CHAR(36) NOT NULL,
  producto_id     CHAR(36) NULL,
  sku             VARCHAR(50) NULL,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);

CREATE TABLE pedido_abonos (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  pedido_id   CHAR(36) NOT NULL,
  monto       DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  usuario_id  CHAR(36) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE pedido_historial (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id   CHAR(36) NOT NULL,
  accion      VARCHAR(30) NOT NULL,
  detalle     JSON NULL,
  usuario_id  CHAR(36) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_historial_pedido ON pedido_historial(pedido_id);

CREATE TABLE pedidos_parametros (
  id                        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  intervalo_alarma_minutos  INT NOT NULL DEFAULT 30,
  updated_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
INSERT INTO pedidos_parametros (id) VALUES (true);
```

- [ ] **Step 5: Agregar los permisos al `database/seed.sql`** (para instalaciones nuevas)

Buscar el bloque de `INSERT INTO permisos` que incluye `'con_sentido.ventas.crear'` y agregar, en la misma sentencia `VALUES`, las 4 filas de pedidos:

```sql
  ((SELECT id FROM modulos WHERE slug = 'pedidos'), 'ver', 'pedidos.ver'),
  ((SELECT id FROM modulos WHERE slug = 'pedidos'), 'crear', 'pedidos.crear'),
  ((SELECT id FROM modulos WHERE slug = 'pedidos'), 'cambiar_estado', 'pedidos.cambiar_estado'),
  ((SELECT id FROM modulos WHERE slug = 'pedidos'), 'administrar_parametros', 'pedidos.administrar_parametros'),
```

(Super Root recibe automáticamente todos los permisos vía el `INSERT INTO roles_permisos SELECT ... FROM permisos` genérico que ya existe al final de `seed.sql`; Root recibe todos excepto los de reinicio, también automático. Para Cajero/Administrador, agregar después del bloque existente de permisos de Cajero:)

```sql
-- Cajero: además de lo que ya tiene, Pedidos.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cajero'), p.id
FROM permisos p
WHERE p.codigo IN ('pedidos.ver', 'pedidos.crear', 'pedidos.cambiar_estado', 'con_sentido.clientes.ver');

-- Administrador: además de lo que ya tiene, Pedidos.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Administrador'), p.id
FROM permisos p
WHERE p.codigo IN ('pedidos.ver', 'pedidos.crear', 'pedidos.cambiar_estado', 'con_sentido.clientes.ver');
```

- [ ] **Step 6: Commit**

```bash
git add database/mysql/migraciones/2026-10-04_modulo_pedidos.sql database/mysql/schema.sql database/seed.sql
git commit -m "feat(pedidos): migración de base de datos — tablas, permisos"
```

---

## Task 2: Backend — `pedidos.schema.ts` (validadores Zod)

**Files:**
- Create: `backend/src/modules/pedidos/pedidos.schema.ts`

**Interfaces:**
- Consumes: nada (es la base)
- Produces: `crearPedidoSchema`/`CrearPedidoInput`, `editarPedidoSchema`/`EditarPedidoInput`, `cambiarEstadoPedidoSchema`/`CambiarEstadoPedidoInput`, `registrarAbonoPedidoSchema`/`RegistrarAbonoPedidoInput`, `actualizarParametrosPedidosSchema`/`ActualizarParametrosPedidosInput` — los usan Task 4 (service) y Task 5 (controller)

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { z } from "zod";
import { referenciaBancoSchema } from "../../shared/utils/pago-mixto";

// Un ítem viene del autocompletar de catálogo (trae productoId) o se escribe
// a mano (sin productoId) — mismo patrón que con_sentido.schema.ts.
const itemPedidoSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre del ítem es obligatorio").max(150),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().nonnegative(),
  productoId: z.string().uuid().optional(),
});

const ESTADOS_DESTINO = ["alistado", "enviado", "entregado", "cancelado"] as const;
export type EstadoPedido = "pendiente" | (typeof ESTADOS_DESTINO)[number];

const camposEnvio = {
  destinatarioNombre: z.string().trim().max(150).optional(),
  destinatarioDocumento: z.string().trim().max(30).optional(),
  destinatarioTelefono: z.string().trim().max(30).optional(),
  direccionEnvio: z.string().trim().max(250).optional(),
  ciudadEnvio: z.string().trim().max(100).optional(),
  transportadora: z.string().trim().max(100).optional(),
  numeroGuia: z.string().trim().max(100).optional(),
  notasEntrega: z.string().trim().optional(),
};

export const crearPedidoSchema = z.object({
  clienteId: z.string().uuid().optional(),
  // Si no la escriben, el service la arma sola a partir de los nombres de
  // los ítems (mismo criterio que con_sentido.service.ts para el "motivo").
  descripcion: z.string().trim().max(500).optional(),
  fechaEntrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  responsableId: z.string().uuid().optional(),
  items: z.array(itemPedidoSchema).min(1, "Agrega al menos un ítem al pedido"),
  abonoInicial: z
    .object({
      monto: z.number().positive(),
      metodoPago: z.enum(["efectivo", "banco"]),
      // Obligatoria si metodoPago es "banco" — se valida en el service con
      // exigirReferenciaBanco (regla global: todo pago recibido por banco
      // necesita los últimos 4 del ID de la transferencia).
      ...referenciaBancoSchema,
    })
    .optional(),
  ...camposEnvio,
});
export type CrearPedidoInput = z.infer<typeof crearPedidoSchema>;

// Edición de datos generales — nunca ítems ni estado (eso tiene su propio
// endpoint, con su propia lógica de stock/alarma).
export const editarPedidoSchema = z.object({
  descripcion: z.string().trim().min(1).max(500).optional(),
  fechaEntrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional(),
  responsableId: z.string().uuid().optional(),
  ...camposEnvio,
});
export type EditarPedidoInput = z.infer<typeof editarPedidoSchema>;

export const cambiarEstadoPedidoSchema = z.object({
  estado: z.enum(ESTADOS_DESTINO),
  // Obligatoria solo si el producto queda en negativo al alistar — el
  // service la exige puntualmente (mismo criterio que Con Sentido).
  observacionInventario: z.string().trim().optional(),
});
export type CambiarEstadoPedidoInput = z.infer<typeof cambiarEstadoPedidoSchema>;

export const registrarAbonoPedidoSchema = z.object({
  monto: z.number().positive(),
  metodoPago: z.enum(["efectivo", "banco"]),
  ...referenciaBancoSchema,
});
export type RegistrarAbonoPedidoInput = z.infer<typeof registrarAbonoPedidoSchema>;

export const actualizarParametrosPedidosSchema = z.object({
  intervaloAlarmaMinutos: z.number().int().positive(),
});
export type ActualizarParametrosPedidosInput = z.infer<typeof actualizarParametrosPedidosSchema>;
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores (el archivo no se usa todavía en ningún lado, así que no puede fallar por referencias rotas — solo valida su propia sintaxis).

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/pedidos/pedidos.schema.ts
git commit -m "feat(pedidos): validadores Zod"
```

---

## Task 3: Backend — `pedidos.repository.ts` (consultas SQL)

**Files:**
- Create: `backend/src/modules/pedidos/pedidos.repository.ts`

**Interfaces:**
- Consumes: tipos de `pedidos.schema.ts` (Task 2)
- Produces: todas las funciones de acceso a datos que usa `pedidos.service.ts` (Task 4) — firmas exactas abajo

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { Pool, PoolClient, pool } from "../../shared/db/pool";
import { CrearPedidoInput, EditarPedidoInput } from "./pedidos.schema";

type Executor = Pool | PoolClient;

const SELECT_PEDIDO = `
  SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
         resp.nombre AS responsable_nombre, creador.nombre AS creado_por_nombre
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN usuarios resp ON resp.id = p.responsable_id
    LEFT JOIN usuarios creador ON creador.id = p.creado_por_id
`;

export interface FiltrosListarPedidos {
  estado?: string;
  vencidos?: boolean;
}

export async function listPedidos(filtros: FiltrosListarPedidos) {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtros.estado) {
    condiciones.push(`p.estado = $${params.length + 1}`);
    params.push(filtros.estado);
  }
  if (filtros.vencidos) {
    condiciones.push(`p.proxima_alarma_en IS NOT NULL AND p.proxima_alarma_en <= NOW()`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(`${SELECT_PEDIDO} ${where} ORDER BY p.created_at DESC`, params);
  return result.rows;
}

export async function getPedidoById(id: string, executor: Executor = pool) {
  const result = await executor.query(`${SELECT_PEDIDO} WHERE p.id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

/** Misma fila, bloqueada (FOR UPDATE) hasta el COMMIT — para cambiar estado
 *  sin que dos requests simultáneos lean el mismo estado de partida. */
export async function getPedidoParaCambiarEstado(client: PoolClient, id: string) {
  const result = await client.query(`SELECT * FROM pedidos WHERE id = $1 FOR UPDATE`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function getItemsPorPedido(pedidoId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT id, pedido_id, producto_id, sku, nombre, cantidad, precio_unitario,
            (cantidad * precio_unitario) AS subtotal
       FROM pedido_items WHERE pedido_id = $1 ORDER BY id`,
    [pedidoId],
  );
  return result.rows;
}

export async function getAbonosPorPedido(pedidoId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT a.id, a.monto, a.metodo_pago, a.created_at, u.nombre AS usuario_nombre
       FROM pedido_abonos a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.pedido_id = $1 ORDER BY a.created_at`,
    [pedidoId],
  );
  return result.rows;
}

export async function sumAbonosPorPedido(pedidoId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM pedido_abonos WHERE pedido_id = $1`,
    [pedidoId],
  );
  return Number(result.rows[0].total);
}

export async function getHistorialPorPedido(pedidoId: string) {
  const result = await pool.query(
    `SELECT h.id, h.accion, h.detalle, h.created_at, u.nombre AS usuario_nombre
       FROM pedido_historial h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.pedido_id = $1 ORDER BY h.created_at`,
    [pedidoId],
  );
  return result.rows;
}

export async function insertHistorial(
  executor: Executor,
  params: { pedidoId: string; accion: string; detalle?: Record<string, unknown>; usuarioId: string | null },
) {
  await executor.query(
    `INSERT INTO pedido_historial (pedido_id, accion, detalle, usuario_id) VALUES ($1, $2, $3, $4)`,
    [params.pedidoId, params.accion, params.detalle ? JSON.stringify(params.detalle) : null, params.usuarioId],
  );
}

export async function crearPedido(
  client: PoolClient,
  params: {
    clienteId: string | null;
    descripcion: string;
    fechaEntrega: string;
    costoEstimado: number;
    precioAcordado: number;
    responsableId: string | null;
    creadoPorId: string;
    proximaAlarmaEn: Date;
  } & Omit<EditarPedidoInput, "descripcion" | "fechaEntrega" | "responsableId">,
) {
  const result = await client.query(
    `INSERT INTO pedidos (
       cliente_id, descripcion, fecha_entrega, destinatario_nombre, destinatario_documento,
       destinatario_telefono, direccion_envio, ciudad_envio, transportadora, numero_guia,
       notas_entrega, costo_estimado, precio_acordado, responsable_id, creado_por_id,
       proxima_alarma_en
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      params.clienteId,
      params.descripcion,
      params.fechaEntrega,
      params.destinatarioNombre ?? null,
      params.destinatarioDocumento ?? null,
      params.destinatarioTelefono ?? null,
      params.direccionEnvio ?? null,
      params.ciudadEnvio ?? null,
      params.transportadora ?? null,
      params.numeroGuia ?? null,
      params.notasEntrega ?? null,
      params.costoEstimado,
      params.precioAcordado,
      params.responsableId,
      params.creadoPorId,
      params.proximaAlarmaEn,
    ],
  );
  return result.rows[0];
}

export async function crearPedidoItems(
  client: PoolClient,
  pedidoId: string,
  items: { productoId: string | null; sku: string | null; nombre: string; cantidad: number; precioUnitario: number }[],
) {
  for (const item of items) {
    await client.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, sku, nombre, cantidad, precio_unitario)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [pedidoId, item.productoId, item.sku, item.nombre, item.cantidad, item.precioUnitario],
    );
  }
}

export async function actualizarPedido(id: string, input: EditarPedidoInput) {
  const result = await pool.query(
    `UPDATE pedidos SET
       descripcion = COALESCE($2, descripcion),
       fecha_entrega = COALESCE($3, fecha_entrega),
       destinatario_nombre = COALESCE($4, destinatario_nombre),
       destinatario_documento = COALESCE($5, destinatario_documento),
       destinatario_telefono = COALESCE($6, destinatario_telefono),
       direccion_envio = COALESCE($7, direccion_envio),
       ciudad_envio = COALESCE($8, ciudad_envio),
       transportadora = COALESCE($9, transportadora),
       numero_guia = COALESCE($10, numero_guia),
       notas_entrega = COALESCE($11, notas_entrega),
       responsable_id = COALESCE($12, responsable_id)
     WHERE id = $1
     RETURNING id`,
    [
      id,
      input.descripcion ?? null,
      input.fechaEntrega ?? null,
      input.destinatarioNombre ?? null,
      input.destinatarioDocumento ?? null,
      input.destinatarioTelefono ?? null,
      input.direccionEnvio ?? null,
      input.ciudadEnvio ?? null,
      input.transportadora ?? null,
      input.numeroGuia ?? null,
      input.notasEntrega ?? null,
      input.responsableId ?? null,
    ],
  );
  return result.rowCount ? result.rows[0].id : null;
}

/** `timestampCampo` es el nombre de columna literal (alistado_en/enviado_en/
 *  entregado_en) — siempre uno de esos 3 valores fijos, nunca entrada del
 *  usuario, así que interpolarlo en el SQL es seguro. */
export async function actualizarEstadoPedido(
  client: PoolClient,
  id: string,
  params: { estado: string; timestampCampo?: "alistado_en" | "enviado_en" | "entregado_en"; proximaAlarmaEn: Date | null },
) {
  const campoTimestamp = params.timestampCampo ? `, ${params.timestampCampo} = NOW()` : "";
  await client.query(`UPDATE pedidos SET estado = $1, proxima_alarma_en = $2${campoTimestamp} WHERE id = $3`, [
    params.estado,
    params.proximaAlarmaEn,
    id,
  ]);
}

export async function crearAbono(
  client: PoolClient,
  params: { pedidoId: string; monto: number; metodoPago: "efectivo" | "banco"; usuarioId: string },
) {
  const result = await client.query(
    `INSERT INTO pedido_abonos (pedido_id, monto, metodo_pago, usuario_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [params.pedidoId, params.monto, params.metodoPago, params.usuarioId],
  );
  return result.rows[0];
}

/** Info de un producto del catálogo de Con Sentido para armar un ítem de
 *  pedido (nombre/sku/costo de referencia) — de solo lectura, sin bloquear
 *  fila: el stock de verdad se descuenta recién al alistar (ver stock-venta.ts). */
export async function getProductoInfo(id: string) {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.sku, p.costo
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
      WHERE p.id = $1 AND m.slug = 'con_sentido'`,
    [id],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function getParametros() {
  const result = await pool.query(`SELECT * FROM pedidos_parametros WHERE id = true`);
  return result.rows[0];
}

export async function actualizarParametros(intervaloAlarmaMinutos: number) {
  const result = await pool.query(
    `UPDATE pedidos_parametros SET intervalo_alarma_minutos = $1, updated_at = NOW() WHERE id = true RETURNING *`,
    [intervaloAlarmaMinutos],
  );
  return result.rows[0];
}

export async function listPedidosVencidos() {
  const result = await pool.query(
    `SELECT id, descripcion, estado, destinatario_nombre
       FROM pedidos
      WHERE estado IN ('pendiente', 'alistado') AND proxima_alarma_en IS NOT NULL AND proxima_alarma_en <= NOW()`,
  );
  return result.rows;
}

export async function reprogramarAlarma(id: string, minutos: number) {
  await pool.query(
    `UPDATE pedidos SET proxima_alarma_en = DATE_ADD(NOW(), INTERVAL $2 MINUTE) WHERE id = $1`,
    [id, minutos],
  );
}
```

**Nota sobre `CrearPedidoInput` no usado directamente:** el import se deja por si una revisión futura lo necesita; si `tsc` marca el import de `CrearPedidoInput` como no usado en este archivo, quitarlo del `import` (el archivo solo necesita `EditarPedidoInput` para las firmas de arriba).

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores. Si marca `CrearPedidoInput` como import no usado, quitarlo de la línea de import.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/pedidos/pedidos.repository.ts
git commit -m "feat(pedidos): repositorio (consultas SQL)"
```

---

## Task 4: Backend — `pedidos.service.ts` (lógica de negocio)

**Files:**
- Create: `backend/src/modules/pedidos/pedidos.service.ts`

**Interfaces:**
- Consumes: `pedidos.repository.ts` (Task 3), `pedidos.schema.ts` (Task 2), `con_sentido.repository.ts::{getProductoParaVenta, reponerStock, deltaEcommerce}`, `con_sentido/stock-venta.ts::{descontarParaVenta, motivoVenta}`, `integracion_ecommerce/salida.ts::{encolarDeltaStock, programarEnvio}`, `general/caja/caja.service.ts::registrarIngreso`
- Produces: `listarPedidos`, `obtenerPedido`, `crearPedido`, `editarPedido`, `cambiarEstadoPedido`, `registrarAbono`, `obtenerParametros`, `actualizarParametros`, `listarPedidosVencidos` (usada por Task 6)

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { deltaEcommerce, getProductoParaVenta, reponerStock } from "../con_sentido/con_sentido.repository";
import { descontarParaVenta, motivoVenta } from "../con_sentido/stock-venta";
import { encolarDeltaStock, programarEnvio } from "../integracion_ecommerce/salida";
import { exigirReferenciaBanco } from "../../shared/utils/pago-mixto";
import * as repo from "./pedidos.repository";
import {
  CambiarEstadoPedidoInput,
  CrearPedidoInput,
  EditarPedidoInput,
  RegistrarAbonoPedidoInput,
} from "./pedidos.schema";

// Transiciones válidas — nunca se salta un paso ni se retrocede (salvo
// cancelar, posible desde cualquier estado no terminal).
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  pendiente: ["alistado", "cancelado"],
  alistado: ["enviado", "cancelado"],
  enviado: ["entregado"],
  entregado: [],
  cancelado: [],
};

const TIMESTAMP_POR_ESTADO: Record<string, "alistado_en" | "enviado_en" | "entregado_en" | undefined> = {
  alistado: "alistado_en",
  enviado: "enviado_en",
  entregado: "entregado_en",
};

async function calcularProximaAlarma(): Promise<Date> {
  const { intervalo_alarma_minutos } = await repo.getParametros();
  return new Date(Date.now() + Number(intervalo_alarma_minutos) * 60_000);
}

async function construirDetallePedido(pedidoId: string) {
  const [pedido, items, abonos, historial] = await Promise.all([
    repo.getPedidoById(pedidoId),
    repo.getItemsPorPedido(pedidoId),
    repo.getAbonosPorPedido(pedidoId),
    repo.getHistorialPorPedido(pedidoId),
  ]);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");
  const totalAbonado = abonos.reduce((acc, a) => acc + Number(a.monto), 0);
  return {
    ...pedido,
    items,
    abonos,
    historial,
    totalAbonado,
    saldoPendiente: Number(pedido.precio_acordado) - totalAbonado,
  };
}

export async function listarPedidos(filtros: repo.FiltrosListarPedidos) {
  return repo.listPedidos(filtros);
}

export async function obtenerPedido(id: string) {
  return construirDetallePedido(id);
}

/**
 * Crea el pedido con sus ítems, en una sola transacción. Si trae abono
 * inicial, también se registra su ingreso en Caja General en la MISMA
 * transacción — si no hay turno abierto, se revierte todo el pedido (mismo
 * criterio que con_sentido.service.ts::registrarVenta).
 */
export async function crearPedido(input: CrearPedidoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Cada ítem de catálogo trae su nombre/sku/costo de referencia — el
    // precioUnitario que cobra lo decide quien registra el pedido (puede
    // diferir del precio de catálogo, igual que en Con Sentido).
    const itemsResueltos = [];
    let costoEstimado = 0;
    let precioAcordado = 0;
    for (const item of input.items) {
      let productoId: string | null = null;
      let sku: string | null = null;
      if (item.productoId) {
        const producto = await repo.getProductoInfo(item.productoId);
        if (!producto) throw Errors.badRequest(`El producto "${item.nombre}" ya no está en el catálogo`);
        productoId = producto.id;
        sku = producto.sku ?? null;
        costoEstimado += Number(producto.costo ?? 0) * item.cantidad;
      }
      precioAcordado += item.precioUnitario * item.cantidad;
      itemsResueltos.push({ productoId, sku, nombre: item.nombre, cantidad: item.cantidad, precioUnitario: item.precioUnitario });
    }

    const descripcion = input.descripcion?.trim() || input.items.map((i) => i.nombre).join(", ");
    const proximaAlarmaEn = await calcularProximaAlarma();

    const pedido = await repo.crearPedido(client, {
      clienteId: input.clienteId ?? null,
      descripcion,
      fechaEntrega: input.fechaEntrega,
      destinatarioNombre: input.destinatarioNombre,
      destinatarioDocumento: input.destinatarioDocumento,
      destinatarioTelefono: input.destinatarioTelefono,
      direccionEnvio: input.direccionEnvio,
      ciudadEnvio: input.ciudadEnvio,
      transportadora: input.transportadora,
      numeroGuia: input.numeroGuia,
      notasEntrega: input.notasEntrega,
      costoEstimado,
      precioAcordado,
      responsableId: input.responsableId ?? null,
      creadoPorId: usuarioId,
      proximaAlarmaEn,
    });

    await repo.crearPedidoItems(client, pedido.id, itemsResueltos);
    await repo.insertHistorial(client, { pedidoId: pedido.id, accion: "creado", usuarioId });

    if (input.abonoInicial) {
      if (input.abonoInicial.monto > precioAcordado) {
        throw Errors.badRequest("El abono inicial no puede ser mayor al total del pedido");
      }
      const referenciaBanco = exigirReferenciaBanco(
        input.abonoInicial.metodoPago === "banco" ? input.abonoInicial.monto : 0,
        input.abonoInicial.referenciaBanco,
      );
      const abono = await repo.crearAbono(client, {
        pedidoId: pedido.id,
        monto: input.abonoInicial.monto,
        metodoPago: input.abonoInicial.metodoPago,
        usuarioId,
      });
      await cajaService.registrarIngreso(
        {
          moduloOrigenSlug: "pedidos",
          motivo: `Abono pedido — ${descripcion}`,
          referenciaEntidad: "pedido_abonos",
          referenciaId: abono.id,
          metodoPago: input.abonoInicial.metodoPago,
          monto: input.abonoInicial.monto,
          referenciaBanco,
        },
        usuarioId,
        client,
      );
      await repo.insertHistorial(client, {
        pedidoId: pedido.id,
        accion: "abono",
        detalle: { monto: input.abonoInicial.monto, metodoPago: input.abonoInicial.metodoPago },
        usuarioId,
      });
    }

    await client.query("COMMIT");
    return construirDetallePedido(pedido.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function editarPedido(id: string, input: EditarPedidoInput, usuarioId: string) {
  const pedido = await repo.getPedidoById(id);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");
  if (pedido.estado === "entregado" || pedido.estado === "cancelado") {
    throw Errors.conflict("No se puede editar un pedido ya entregado o cancelado");
  }
  const actualizadoId = await repo.actualizarPedido(id, input);
  if (!actualizadoId) throw Errors.notFound("Pedido no encontrado");
  await repo.insertHistorial(pool, { pedidoId: id, accion: "edicion", usuarioId });
  return construirDetallePedido(id);
}

/**
 * Cambia el estado del pedido. Al pasar a `alistado` descuenta el stock de
 * cada ítem de catálogo (reusando exactamente la misma lógica de Con
 * Sentido: si queda en negativo, exige observación). Al cancelar un pedido
 * que ya estaba `alistado`, devuelve ese stock. La alarma se reprograma o se
 * apaga según el estado destino (ver TIMESTAMP_POR_ESTADO y la lista de
 * estados "en alarma" en pedidos.repository.ts::listPedidosVencidos).
 */
export async function cambiarEstadoPedido(id: string, input: CambiarEstadoPedidoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pedido = await repo.getPedidoParaCambiarEstado(client, id);
    if (!pedido) throw Errors.notFound("Pedido no encontrado");

    const destinosValidos = TRANSICIONES_VALIDAS[pedido.estado] ?? [];
    if (!destinosValidos.includes(input.estado)) {
      throw Errors.conflict(`No se puede pasar de "${pedido.estado}" a "${input.estado}"`);
    }

    if (input.estado === "alistado") {
      const items = await repo.getItemsPorPedido(id, client);
      for (const item of items) {
        if (!item.producto_id) continue;
        const descontado = await descontarParaVenta(client, {
          productoId: item.producto_id,
          cantidad: Number(item.cantidad),
          nombre: item.nombre,
          observacion: input.observacionInventario,
        });
        if (!descontado) continue; // ya no está en el catálogo — no bloquea el alistamiento
        if (descontado.producto.ecommerce_product_id && descontado.deltaEcommerce !== 0) {
          await encolarDeltaStock(client, {
            productId: descontado.producto.ecommerce_product_id,
            variantId: descontado.producto.ecommerce_variant_id ?? null,
            sku: descontado.producto.sku,
            delta: descontado.deltaEcommerce,
            kind: "SALE",
            reason: motivoVenta(`Pedido alistado — ${pedido.descripcion}`, descontado.observacion),
          });
          programarEnvio();
        }
      }
    }

    if (input.estado === "cancelado" && pedido.estado === "alistado") {
      const items = await repo.getItemsPorPedido(id, client);
      for (const item of items) {
        if (!item.producto_id) continue;
        const producto = await getProductoParaVenta(client, item.producto_id);
        if (!producto) continue;
        await reponerStock(client, producto.id, Number(item.cantidad));
        const delta = deltaEcommerce(producto.stock, producto.stock + Number(item.cantidad));
        if (producto.ecommerce_product_id && delta !== 0) {
          await encolarDeltaStock(client, {
            productId: producto.ecommerce_product_id,
            variantId: producto.ecommerce_variant_id ?? null,
            sku: producto.sku,
            delta,
            kind: "RETURN",
            reason: `Pedido cancelado — ${pedido.descripcion}`,
          });
          programarEnvio();
        }
      }
    }

    // La alarma solo sigue activa en pendiente/alistado (ver Global Constraints).
    const siguienteAlarma =
      input.estado === "alistado" ? await calcularProximaAlarma() : null;

    await repo.actualizarEstadoPedido(client, id, {
      estado: input.estado,
      timestampCampo: TIMESTAMP_POR_ESTADO[input.estado],
      proximaAlarmaEn: siguienteAlarma,
    });
    await repo.insertHistorial(client, {
      pedidoId: id,
      accion: "cambio_estado",
      detalle: { de: pedido.estado, a: input.estado },
      usuarioId,
    });

    await client.query("COMMIT");
    return construirDetallePedido(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function registrarAbono(id: string, input: RegistrarAbonoPedidoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pedido = await repo.getPedidoById(id, client);
    if (!pedido) throw Errors.notFound("Pedido no encontrado");
    if (pedido.estado === "cancelado") throw Errors.conflict("Este pedido está cancelado");

    const totalAbonado = await repo.sumAbonosPorPedido(id, client);
    const saldoPendiente = Number(pedido.precio_acordado) - totalAbonado;
    if (input.monto > saldoPendiente) {
      throw Errors.badRequest(`El abono (${input.monto}) es mayor al saldo pendiente (${saldoPendiente})`);
    }

    const referenciaBanco = exigirReferenciaBanco(
      input.metodoPago === "banco" ? input.monto : 0,
      input.referenciaBanco,
    );
    const abono = await repo.crearAbono(client, {
      pedidoId: id,
      monto: input.monto,
      metodoPago: input.metodoPago,
      usuarioId,
    });
    await cajaService.registrarIngreso(
      {
        moduloOrigenSlug: "pedidos",
        motivo: `Abono pedido — ${pedido.descripcion}`,
        referenciaEntidad: "pedido_abonos",
        referenciaId: abono.id,
        metodoPago: input.metodoPago,
        monto: input.monto,
        referenciaBanco,
      },
      usuarioId,
      client,
    );
    await repo.insertHistorial(client, {
      pedidoId: id,
      accion: "abono",
      detalle: { monto: input.monto, metodoPago: input.metodoPago },
      usuarioId,
    });

    await client.query("COMMIT");
    return construirDetallePedido(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const obtenerParametros = () => repo.getParametros();
export const actualizarParametros = (intervaloAlarmaMinutos: number) => repo.actualizarParametros(intervaloAlarmaMinutos);

/** Usada por el chequeo periódico de alarmas (Task 6) — nunca por una ruta HTTP. */
export const listarPedidosVencidos = () => repo.listPedidosVencidos();
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores. Si `cajaService.registrarIngreso` marca el tercer parámetro (`client`) con un tipo incompatible, revisar la firma real en `caja.service.ts::registrarIngreso` (acepta `executor: Pool | PoolClient = pool` como tercer argumento posicional, después de `input` y `usuarioId`).

- [ ] **Step 3: Verificación manual de las reglas de transición**

Sin servidor corriendo todavía (eso es Task 5) — esta verificación se retoma en el Review Focus del Task 5, una vez haya endpoint para probarla de punta a punta.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/pedidos/pedidos.service.ts
git commit -m "feat(pedidos): lógica de negocio (crear, cambiar estado, abonos)"
```

---

## Task 5: Backend — controller, routes, y registro en `app.ts`

**Files:**
- Create: `backend/src/modules/pedidos/pedidos.controller.ts`
- Create: `backend/src/modules/pedidos/pedidos.routes.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `pedidos.service.ts` (Task 4), `pedidos.schema.ts` (Task 2)
- Produces: rutas HTTP bajo `/api/v1/pedidos`

- [ ] **Step 1: Escribir `pedidos.controller.ts`**

```typescript
import { Request, Response } from "express";
import { ok, created } from "../../shared/utils/response";
import * as service from "./pedidos.service";
import {
  actualizarParametrosPedidosSchema,
  cambiarEstadoPedidoSchema,
  crearPedidoSchema,
  editarPedidoSchema,
  registrarAbonoPedidoSchema,
} from "./pedidos.schema";

export async function listarPedidosController(req: Request, res: Response) {
  const estado = req.query.estado as string | undefined;
  const vencidos = req.query.vencidos === "true";
  return ok(res, await service.listarPedidos({ estado, vencidos }));
}

export async function obtenerPedidoController(req: Request, res: Response) {
  return ok(res, await service.obtenerPedido(req.params.id));
}

export async function crearPedidoController(req: Request, res: Response) {
  const data = crearPedidoSchema.parse(req.body);
  return created(res, await service.crearPedido(data, req.auth!.usuarioId));
}

export async function editarPedidoController(req: Request, res: Response) {
  const data = editarPedidoSchema.parse(req.body);
  return ok(res, await service.editarPedido(req.params.id, data, req.auth!.usuarioId));
}

export async function cambiarEstadoPedidoController(req: Request, res: Response) {
  const data = cambiarEstadoPedidoSchema.parse(req.body);
  return ok(res, await service.cambiarEstadoPedido(req.params.id, data, req.auth!.usuarioId));
}

export async function registrarAbonoPedidoController(req: Request, res: Response) {
  const data = registrarAbonoPedidoSchema.parse(req.body);
  return created(res, await service.registrarAbono(req.params.id, data, req.auth!.usuarioId));
}

export async function obtenerParametrosPedidosController(_req: Request, res: Response) {
  return ok(res, await service.obtenerParametros());
}

export async function actualizarParametrosPedidosController(req: Request, res: Response) {
  const data = actualizarParametrosPedidosSchema.parse(req.body);
  return ok(res, await service.actualizarParametros(data.intervaloAlarmaMinutos));
}
```

- [ ] **Step 2: Escribir `pedidos.routes.ts`**

```typescript
import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  actualizarParametrosPedidosController,
  cambiarEstadoPedidoController,
  crearPedidoController,
  editarPedidoController,
  listarPedidosController,
  obtenerParametrosPedidosController,
  obtenerPedidoController,
  registrarAbonoPedidoController,
} from "./pedidos.controller";

export const pedidosRouter = Router();

pedidosRouter.use(authMiddleware);
pedidosRouter.use(requirePermission("pedidos.ver"));

// Registrada antes de /:id para que "parametros" no se interprete como un id.
pedidosRouter.get("/parametros", asyncHandler(obtenerParametrosPedidosController));
pedidosRouter.put(
  "/parametros",
  requirePermission("pedidos.administrar_parametros"),
  asyncHandler(actualizarParametrosPedidosController),
);

pedidosRouter.get("/", asyncHandler(listarPedidosController));
pedidosRouter.post("/", requirePermission("pedidos.crear"), asyncHandler(crearPedidoController));
pedidosRouter.get("/:id", asyncHandler(obtenerPedidoController));
pedidosRouter.patch("/:id", requirePermission("pedidos.crear"), asyncHandler(editarPedidoController));
pedidosRouter.post(
  "/:id/estado",
  requirePermission("pedidos.cambiar_estado"),
  asyncHandler(cambiarEstadoPedidoController),
);
pedidosRouter.post("/:id/abonos", requirePermission("pedidos.crear"), asyncHandler(registrarAbonoPedidoController));
```

- [ ] **Step 3: Registrar el router en `backend/src/app.ts`**

Agregar el import junto a los demás módulos (orden alfabético, como ya están):

```typescript
import { pedidosRouter } from "./modules/pedidos/pedidos.routes";
```

Y la línea de montaje junto a las demás `app.use("/api/v1/...")`:

```typescript
app.use("/api/v1/pedidos", pedidosRouter);
```

- [ ] **Step 4: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 5: Verificación manual end-to-end (levantar el backend)**

```bash
cd backend && npm run dev
```

En otra terminal, con un token válido (`TOKEN`) de un usuario Cajero/Administrador/Root:

```bash
# Crear un pedido con un ítem manual (sin catálogo)
curl -s -X POST http://localhost:4000/api/v1/pedidos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fechaEntrega":"2026-12-24","items":[{"nombre":"Vela personalizada","cantidad":1,"precioUnitario":50000}]}' | jq
```

Esperado: `201`, cuerpo con `data.id`, `data.estado = "pendiente"`, `data.items` con 1 fila.

```bash
# Intentar saltar directo a "entregado" (debe rechazarlo)
curl -s -X POST http://localhost:4000/api/v1/pedidos/<ID>/estado \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"estado":"entregado"}' | jq
```

Esperado: `409` con mensaje `No se puede pasar de "pendiente" a "entregado"`.

```bash
# Alistar (sí es válido desde pendiente)
curl -s -X POST http://localhost:4000/api/v1/pedidos/<ID>/estado \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"estado":"alistado"}' | jq
```

Esperado: `200`, `data.estado = "alistado"`, `data.alistado_en` con fecha.

```bash
# Abonar por banco SIN referencia (debe rechazarlo)
curl -s -X POST http://localhost:4000/api/v1/pedidos/<ID>/abonos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"monto":10000,"metodoPago":"banco"}' | jq
```

Esperado: `400` con mensaje pidiendo los últimos 4 dígitos de la transferencia.

```bash
# Con referencia, sí debe pasar
curl -s -X POST http://localhost:4000/api/v1/pedidos/<ID>/abonos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"monto":10000,"metodoPago":"banco","referenciaBanco":"AB12"}' | jq
```

Esperado: `201`, `data.totalAbonado = 10000`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/pedidos/pedidos.controller.ts backend/src/modules/pedidos/pedidos.routes.ts backend/src/app.ts
git commit -m "feat(pedidos): endpoints HTTP"
```

---

## Task 6: Backend — alarma recurrente (scheduler)

**Files:**
- Create: `backend/src/modules/pedidos/alarma.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `pedidos.service.ts::listarPedidosVencidos` (Task 4), `pedidos.repository.ts::reprogramarAlarma` (Task 3), `general/notificaciones/notificaciones.service.ts::enviarATodosDeRol`
- Produces: `iniciarRevisionAlarmasPedidos()` — se llama una vez al arrancar el servidor

- [ ] **Step 1: Escribir `alarma.ts`**

```typescript
import * as notificacionesService from "../general/notificaciones/notificaciones.service";
import * as repo from "./pedidos.repository";

// Mismo patrón que integracion_ecommerce/salida.ts::iniciarEnvioPeriodico:
// un chequeo liviano cada minuto, nunca en paralelo consigo mismo.
const INTERVALO_REVISION_MS = 60 * 1000;

export function iniciarRevisionAlarmasPedidos(): void {
  setInterval(() => void revisarPedidosVencidos().catch((err) => console.error("[alarma pedidos]", err)), INTERVALO_REVISION_MS).unref?.();
}

async function revisarPedidosVencidos() {
  const vencidos = await repo.listPedidosVencidos();
  if (vencidos.length === 0) return;

  const parametros = await repo.getParametros();
  const intervaloMinutos = Number(parametros.intervalo_alarma_minutos);

  for (const pedido of vencidos) {
    const titulo = pedido.estado === "pendiente" ? "Pedido sin alistar" : "Pedido sin enviar";
    const cuerpo = `${pedido.destinatario_nombre ?? pedido.descripcion} lleva esperando — revisa el pedido.`;
    const payload = { titulo, cuerpo, url: `/pedidos/${pedido.id}` };
    await notificacionesService.enviarATodosDeRol("Root", payload);
    await notificacionesService.enviarATodosDeRol("Super Root", payload);
    // Se reprograma siempre, haya o no suscripción push activa — así la
    // ventana emergente del frontend (que no depende del push) también
    // sigue encontrando este pedido como "vencido" en el próximo ciclo.
    await repo.reprogramarAlarma(pedido.id, intervaloMinutos);
  }
}
```

- [ ] **Step 2: Registrar en `backend/src/server.ts`**

Agregar el import junto al de `iniciarEnvioPeriodico`:

```typescript
import { iniciarRevisionAlarmasPedidos } from "./modules/pedidos/alarma";
```

Y la llamada, junto a `iniciarEnvioPeriodico()`:

```typescript
// Alarma de pedidos estancados: se revisa cada minuto.
iniciarRevisionAlarmasPedidos();
```

- [ ] **Step 3: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Verificación manual (bajar el intervalo a 1 minuto para probar rápido)**

```sql
UPDATE pedidos_parametros SET intervalo_alarma_minutos = 1 WHERE id = true;
```

Crear un pedido (como en Task 5, Step 5) y esperar ~90 segundos con el backend corriendo (`npm run dev`), revisando la consola:

```bash
# En otra terminal, confirmar que proxima_alarma_en se actualizó solo:
mysql -u root -p sistemapos -e "SELECT id, estado, proxima_alarma_en FROM pedidos ORDER BY created_at DESC LIMIT 1;"
```

Esperado: `proxima_alarma_en` cambió a un valor ~1 minuto en el futuro respecto al que tenía antes, sin que nadie llamara a la API — confirma que el scheduler corrió y reprogramó solo. (Si no hay claves VAPID configuradas, el push no se manda pero igual se reprograma — confirmar leyendo el código de `notificaciones.service.ts::enviarATodosDeRol`, que retorna temprano sin lanzar si faltan las claves.)

Volver el intervalo a 30 minutos después de probar:

```sql
UPDATE pedidos_parametros SET intervalo_alarma_minutos = 30 WHERE id = true;
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/pedidos/alarma.ts backend/src/server.ts
git commit -m "feat(pedidos): alarma recurrente para Root/Super Root"
```

---

## Task 7: Frontend — `api.ts` (tipos y llamadas HTTP)

**Files:**
- Create: `frontend/src/modules/pedidos/api.ts`

**Interfaces:**
- Consumes: `shared/api/client.ts::apiFetch`
- Produces: `pedidosApi` y los tipos `Pedido`, `PedidoDetalle`, `ItemPedidoInput`, `ParametrosPedidos` — los usan las Tasks 8-11

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { apiFetch } from "../../shared/api/client";

export type EstadoPedido = "pendiente" | "alistado" | "enviado" | "entregado" | "cancelado";

export interface ItemPedidoInput {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  productoId?: string;
}

export interface ItemPedido {
  id: number;
  pedido_id: string;
  producto_id: string | null;
  sku: string | null;
  nombre: string;
  cantidad: string;
  precio_unitario: string;
  subtotal: string;
}

export interface AbonoPedido {
  id: string;
  monto: string;
  metodo_pago: "efectivo" | "banco";
  created_at: string;
  usuario_nombre: string | null;
}

export interface HistorialPedido {
  id: number;
  accion: string;
  detalle: Record<string, unknown> | null;
  created_at: string;
  usuario_nombre: string | null;
}

export interface Pedido {
  id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  descripcion: string;
  fecha_entrega: string;
  destinatario_nombre: string | null;
  destinatario_documento: string | null;
  destinatario_telefono: string | null;
  direccion_envio: string | null;
  ciudad_envio: string | null;
  transportadora: string | null;
  numero_guia: string | null;
  notas_entrega: string | null;
  costo_estimado: string;
  precio_acordado: string;
  estado: EstadoPedido;
  responsable_id: string | null;
  responsable_nombre: string | null;
  creado_por_nombre: string | null;
  alistado_en: string | null;
  enviado_en: string | null;
  entregado_en: string | null;
  proxima_alarma_en: string | null;
  created_at: string;
}

export interface PedidoDetalle extends Pedido {
  items: ItemPedido[];
  abonos: AbonoPedido[];
  historial: HistorialPedido[];
  totalAbonado: number;
  saldoPendiente: number;
}

export interface ParametrosPedidos {
  intervalo_alarma_minutos: number;
}

export interface CrearPedidoInput {
  clienteId?: string;
  descripcion?: string;
  fechaEntrega: string;
  destinatarioNombre?: string;
  destinatarioDocumento?: string;
  destinatarioTelefono?: string;
  direccionEnvio?: string;
  ciudadEnvio?: string;
  transportadora?: string;
  numeroGuia?: string;
  notasEntrega?: string;
  responsableId?: string;
  items: ItemPedidoInput[];
  abonoInicial?: { monto: number; metodoPago: "efectivo" | "banco"; referenciaBanco?: string };
}

export interface RegistrarAbonoInput {
  monto: number;
  metodoPago: "efectivo" | "banco";
  // Obligatoria si metodoPago es "banco" — últimos 4 del ID de la
  // transferencia (regla global, ver SelectorMetodoPago.tsx).
  referenciaBanco?: string;
}

export const pedidosApi = {
  listar: (filtros?: { estado?: EstadoPedido; vencidos?: boolean }) => {
    const params = new URLSearchParams();
    if (filtros?.estado) params.set("estado", filtros.estado);
    if (filtros?.vencidos) params.set("vencidos", "true");
    const qs = params.toString();
    return apiFetch<Pedido[]>(`/pedidos${qs ? `?${qs}` : ""}`);
  },
  obtener: (id: string) => apiFetch<PedidoDetalle>(`/pedidos/${id}`),
  crear: (input: CrearPedidoInput) => apiFetch<PedidoDetalle>("/pedidos", { method: "POST", body: input }),
  editar: (id: string, input: Partial<Omit<CrearPedidoInput, "items" | "abonoInicial">>) =>
    apiFetch<PedidoDetalle>(`/pedidos/${id}`, { method: "PATCH", body: input }),
  cambiarEstado: (id: string, estado: Exclude<EstadoPedido, "pendiente">, observacionInventario?: string) =>
    apiFetch<PedidoDetalle>(`/pedidos/${id}/estado`, { method: "POST", body: { estado, observacionInventario } }),
  registrarAbono: (id: string, input: RegistrarAbonoInput) =>
    apiFetch<PedidoDetalle>(`/pedidos/${id}/abonos`, { method: "POST", body: input }),
  obtenerParametros: () => apiFetch<ParametrosPedidos>("/pedidos/parametros"),
  actualizarParametros: (intervaloAlarmaMinutos: number) =>
    apiFetch<ParametrosPedidos>("/pedidos/parametros", { method: "PUT", body: { intervaloAlarmaMinutos } }),
};
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/pedidos/api.ts
git commit -m "feat(pedidos): cliente API del frontend"
```

---

## Task 8: Frontend — `PedidosPage.tsx` (listado)

**Files:**
- Create: `frontend/src/modules/pedidos/pages/PedidosPage.tsx`

**Interfaces:**
- Consumes: `pedidosApi` (Task 7), `shared/components/BotonVolver`, `shared/format/money::formatMoney`, `shared/refresh/RefrescoContext::useRegistrarRefresco`
- Produces: la pantalla que se monta en `/pedidos` (ruta la agrega Task 12)

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { pedidosApi, type EstadoPedido, type Pedido } from "../api";
import { NuevoPedidoModal } from "../components/NuevoPedidoModal";

const POLL_MS = 15000;

const TABS: { valor: EstadoPedido | "todos" | "vencidos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "alistado", etiqueta: "Alistado" },
  { valor: "enviado", etiqueta: "Enviado" },
  { valor: "entregado", etiqueta: "Entregado" },
  { valor: "cancelado", etiqueta: "Cancelado" },
  { valor: "vencidos", etiqueta: "⚠ Vencidos" },
];

const ESTILO_ESTADO: Record<EstadoPedido, string> = {
  pendiente: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  alistado: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  enviado: "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400",
  entregado: "bg-brand-green-100 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla",
  cancelado: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

function formatearFecha(fechaIso: string) {
  return new Date(fechaIso).toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["valor"]>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  async function cargar() {
    try {
      const filtros =
        tab === "todos" ? undefined : tab === "vencidos" ? { vencidos: true } : { estado: tab as EstadoPedido };
      setPedidos(await pedidosApi.listar(filtros));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Pedidos / Encargos</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Lo que piden tus clientes, su envío y en qué va cada uno.
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo pedido
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b-2 border-brand-vanilla-dark pb-2 dark:border-brand-green-700">
        {TABS.map((t) => (
          <button
            key={t.valor}
            onClick={() => setTab(t.valor)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : pedidos.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          No hay pedidos en este filtro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Destinatario</th>
                <th className="px-3 py-2">Entrega</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => {
                const vencido = p.proxima_alarma_en && new Date(p.proxima_alarma_en) <= new Date();
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                      vencido ? "bg-red-50 dark:bg-red-950/20" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <Link to={`/pedidos/${p.id}`} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                        {p.descripcion.length > 60 ? `${p.descripcion.slice(0, 60)}...` : p.descripcion}
                      </Link>
                      {p.cliente_nombre && (
                        <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{p.cliente_nombre}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.destinatario_nombre ?? "—"}</td>
                    <td className="px-3 py-2">{formatearFecha(p.fecha_entrega)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[p.estado]}`}>
                        {p.estado}
                        {vencido ? " ⚠" : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(p.precio_acordado)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevoPedidoModal
          onCerrar={() => setModalAbierto(false)}
          onCreado={async () => {
            setModalAbierto(false);
            await cargar();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

Esperado: falla porque `NuevoPedidoModal` todavía no existe (Task 9) y `DetallePedidoPage` (ruta `/pedidos/:id`, Task 10/12) tampoco — esto es esperado en este punto del plan, no es un error a corregir acá. Seguir a la Task 9.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/pedidos/pages/PedidosPage.tsx
git commit -m "feat(pedidos): listado de pedidos (WIP — falta NuevoPedidoModal)"
```

---

## Task 9: Frontend — `NuevoPedidoModal.tsx` (crear pedido)

**Files:**
- Create: `frontend/src/modules/pedidos/components/NuevoPedidoModal.tsx`

**Interfaces:**
- Consumes: `pedidosApi.crear` (Task 7), `con_sentido/api.ts::{conSentidoApi, ClienteConSentido, ProductoConSentido}`, `general/api.ts::{usuariosApi, Usuario}`, `caja/components/SugerenciasProducto.tsx` (ya existe), `shared/components/{Modal, MoneyInput, NumeroInput}`
- Produces: el modal que usa `PedidosPage.tsx` (Task 8)

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { formatMoney } from "../../../shared/format/money";
import { usuariosApi, type Usuario } from "../../general/api";
import { conSentidoApi, type ClienteConSentido, type ProductoConSentido } from "../../con_sentido/api";
import { SugerenciasProducto } from "../../caja/components/SugerenciasProducto";
import { pedidosApi } from "../api";

interface NuevoPedidoModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

interface LineaPedido {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  productoId?: string;
}

let siguienteKeyLinea = 1;
function lineaVacia(): LineaPedido {
  return { key: siguienteKeyLinea++, nombre: "", cantidad: 1, precioUnitario: 0 };
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

export function NuevoPedidoModal({ onCerrar, onCreado }: NuevoPedidoModalProps) {
  const [clientes, setClientes] = useState<ClienteConSentido[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [productos, setProductos] = useState<ProductoConSentido[]>([]);
  const [filaEnfocada, setFilaEnfocada] = useState<number | null>(null);

  const [clienteId, setClienteId] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState("");
  const [lineas, setLineas] = useState<LineaPedido[]>([lineaVacia()]);

  const [destinatarioNombre, setDestinatarioNombre] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [destinatarioTelefono, setDestinatarioTelefono] = useState("");
  const [direccionEnvio, setDireccionEnvio] = useState("");
  const [ciudadEnvio, setCiudadEnvio] = useState("");
  const [transportadora, setTransportadora] = useState("");
  const [numeroGuia, setNumeroGuia] = useState("");
  const [notasEntrega, setNotasEntrega] = useState("");

  const [conAbono, setConAbono] = useState(false);
  const [montoAbono, setMontoAbono] = useState(0);
  const [metodoAbono, setMetodoAbono] = useState<"efectivo" | "banco">("efectivo");
  const [referenciaBancoAbono, setReferenciaBancoAbono] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    conSentidoApi.listarClientes().then(setClientes).catch(() => {});
    usuariosApi.listar().then(setUsuarios).catch(() => {});
    conSentidoApi.listarProductos().then(setProductos).catch(() => {});
  }, []);

  const lineasValidas = lineas.filter((l) => l.nombre.trim().length > 0 && l.cantidad > 0);
  const total = lineasValidas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
  const faltaReferenciaAbono = conAbono && metodoAbono === "banco" && !/^[A-Za-z0-9]{4}$/.test(referenciaBancoAbono);
  const puedeGuardar =
    lineasValidas.length > 0 &&
    fechaEntrega.length > 0 &&
    (!conAbono || (montoAbono > 0 && montoAbono <= total && !faltaReferenciaAbono));

  function actualizarLinea(key: number, cambios: Partial<LineaPedido>) {
    setLineas((actual) => actual.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }
  function quitarLinea(key: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.key !== key) : actual));
  }

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await pedidosApi.crear({
        clienteId: clienteId || undefined,
        responsableId: responsableId || undefined,
        descripcion: descripcion.trim() || undefined,
        fechaEntrega,
        destinatarioNombre: destinatarioNombre.trim() || undefined,
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        destinatarioTelefono: destinatarioTelefono.trim() || undefined,
        direccionEnvio: direccionEnvio.trim() || undefined,
        ciudadEnvio: ciudadEnvio.trim() || undefined,
        transportadora: transportadora.trim() || undefined,
        numeroGuia: numeroGuia.trim() || undefined,
        notasEntrega: notasEntrega.trim() || undefined,
        items: lineasValidas.map((l) => ({
          nombre: l.nombre.trim(),
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          productoId: l.productoId,
        })),
        abonoInicial: conAbono
          ? {
              monto: montoAbono,
              metodoPago: metodoAbono,
              referenciaBanco: metodoAbono === "banco" ? referenciaBancoAbono.trim().toUpperCase() : undefined,
            }
          : undefined,
      });
      await onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el pedido");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo pedido" onCerrar={onCerrar} maxWidth="sm:max-w-3xl">
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Cliente (opcional)</label>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin cliente registrado</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Responsable (opcional)</label>
            <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Fecha de entrega</label>
            <input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} className={INPUT_CLASE} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Descripción (opcional — se arma sola si la dejas vacía)</label>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={INPUT_CLASE} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Ítems del pedido
          </p>
          <div className="flex flex-col gap-2">
            {lineas.map((linea) => (
              <div key={linea.key} className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    value={linea.nombre}
                    onChange={(e) => actualizarLinea(linea.key, { nombre: e.target.value, productoId: undefined })}
                    onFocus={() => setFilaEnfocada(linea.key)}
                    onBlur={() => setFilaEnfocada((actual) => (actual === linea.key ? null : actual))}
                    placeholder="Producto o servicio"
                    autoComplete="off"
                    className={INPUT_CLASE}
                  />
                  {filaEnfocada === linea.key && (
                    <SugerenciasProducto
                      productos={productos}
                      texto={linea.nombre}
                      onSeleccionar={(producto) => {
                        actualizarLinea(linea.key, {
                          nombre: producto.nombre,
                          precioUnitario: producto.precio,
                          productoId: producto.id,
                        });
                        setFilaEnfocada(null);
                      }}
                    />
                  )}
                </div>
                <NumeroInput
                  value={linea.cantidad}
                  onChange={(v) => actualizarLinea(linea.key, { cantidad: Math.max(0.001, v) })}
                  className={`${INPUT_CLASE} w-20`}
                />
                <MoneyInput
                  value={linea.precioUnitario}
                  onChange={(v) => actualizarLinea(linea.key, { precioUnitario: v })}
                  placeholder="Precio"
                  className={`${INPUT_CLASE} w-28`}
                />
                <span className="w-24 text-right text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                  {formatMoney(linea.cantidad * linea.precioUnitario)}
                </span>
                <button
                  type="button"
                  onClick={() => quitarLinea(linea.key)}
                  disabled={lineas.length === 1}
                  className="rounded-md px-2 py-1 text-lg text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLineas((actual) => [...actual, lineaVacia()])}
            className="mt-2 text-sm text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            + Agregar ítem
          </button>
          <div className="mt-2 flex items-center justify-between rounded-md bg-brand-green-50 px-3 py-2 text-base font-bold text-brand-green-700 dark:bg-brand-green-700/20 dark:text-brand-vanilla">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Datos de envío
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={destinatarioNombre} onChange={(e) => setDestinatarioNombre(e.target.value)} placeholder="Nombre de quien recibe" className={INPUT_CLASE} />
            <input value={destinatarioDocumento} onChange={(e) => setDestinatarioDocumento(e.target.value)} placeholder="Documento" className={INPUT_CLASE} />
            <input value={destinatarioTelefono} onChange={(e) => setDestinatarioTelefono(e.target.value)} placeholder="Teléfono de contacto" className={INPUT_CLASE} />
            <input value={ciudadEnvio} onChange={(e) => setCiudadEnvio(e.target.value)} placeholder="Ciudad" className={INPUT_CLASE} />
            <input value={direccionEnvio} onChange={(e) => setDireccionEnvio(e.target.value)} placeholder="Dirección" className={`${INPUT_CLASE} sm:col-span-2`} />
            <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Transportadora" className={INPUT_CLASE} />
            <input value={numeroGuia} onChange={(e) => setNumeroGuia(e.target.value)} placeholder="Número de guía" className={INPUT_CLASE} />
            <textarea
              value={notasEntrega}
              onChange={(e) => setNotasEntrega(e.target.value)}
              placeholder="Notas de entrega (opcional)"
              rows={2}
              className={`${INPUT_CLASE} sm:col-span-2 resize-y`}
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={conAbono} onChange={(e) => setConAbono(e.target.checked)} />
            Registrar un abono ahora
          </label>
          {conAbono && (
            <div className="mt-2 flex flex-wrap gap-2">
              <MoneyInput value={montoAbono} onChange={setMontoAbono} placeholder="Monto del abono" className={`${INPUT_CLASE} w-40`} />
              <select value={metodoAbono} onChange={(e) => setMetodoAbono(e.target.value as "efectivo" | "banco")} className={`${INPUT_CLASE} w-32`}>
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco</option>
              </select>
              {metodoAbono === "banco" && (
                <input
                  value={referenciaBancoAbono}
                  onChange={(e) => setReferenciaBancoAbono(e.target.value)}
                  placeholder="Últimos 4 de la transferencia"
                  maxLength={4}
                  className={`${INPUT_CLASE} w-48`}
                />
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando || !puedeGuardar}
          className="rounded-md bg-brand-green-700 px-4 py-3 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : "Crear pedido"}
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

Esperado: solo debe faltar `DetallePedidoPage` (el `Link to="/pedidos/:id"` de `PedidosPage.tsx` no requiere que el archivo exista para compilar, `react-router-dom` no valida rutas en tiempo de compilación — el error pendiente real es que `/pedidos/:id` no tiene ruta registrada todavía, eso es Task 12). Si aparece un error de tipos en `SugerenciasProducto` o `MoneyInput`/`NumeroInput`, confirmar las props exactas leyendo esos archivos (ya existen en el repo, no se tocan en este plan).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/pedidos/components/NuevoPedidoModal.tsx
git commit -m "feat(pedidos): modal de nuevo pedido con autocompletar de catálogo"
```

---

## Task 10: Frontend — `DetallePedidoPage.tsx`

**Files:**
- Create: `frontend/src/modules/pedidos/pages/DetallePedidoPage.tsx`

**Interfaces:**
- Consumes: `pedidosApi` (Task 7), `shared/components/{Modal, MoneyInput, BotonVolver}`, `shared/auth/useAuth`
- Produces: la pantalla que se monta en `/pedidos/:id` (ruta la agrega Task 12)

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { pedidosApi, type EstadoPedido, type PedidoDetalle } from "../api";

const SIGUIENTE_ESTADO: Partial<Record<EstadoPedido, { estado: EstadoPedido; etiqueta: string }>> = {
  pendiente: { estado: "alistado", etiqueta: "Marcar como Alistado" },
  alistado: { estado: "enviado", etiqueta: "Marcar como Enviado" },
  enviado: { estado: "entregado", etiqueta: "Marcar como Entregado" },
};

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DetallePedidoPage() {
  const { id } = useParams<{ id: string }>();
  const [pedido, setPedido] = useState<PedidoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [observacionInventario, setObservacionInventario] = useState("");
  const [pidiendoObservacion, setPidiendoObservacion] = useState(false);

  const [modalAbonoAbierto, setModalAbonoAbierto] = useState(false);
  const [montoAbono, setMontoAbono] = useState(0);
  const [metodoAbono, setMetodoAbono] = useState<"efectivo" | "banco">("efectivo");
  const [referenciaBancoAbono, setReferenciaBancoAbono] = useState("");
  const [guardandoAbono, setGuardandoAbono] = useState(false);
  const [errorAbono, setErrorAbono] = useState<string | null>(null);

  const faltaReferenciaAbono = metodoAbono === "banco" && !/^[A-Za-z0-9]{4}$/.test(referenciaBancoAbono);

  async function cargar() {
    if (!id) return;
    try {
      setPedido(await pedidosApi.obtener(id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el pedido");
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRegistrarRefresco(cargar);

  async function avanzarEstado(destino: EstadoPedido, observacion?: string) {
    if (!id) return;
    setCambiandoEstado(true);
    setError(null);
    try {
      await pedidosApi.cambiarEstado(id, destino, observacion);
      setPidiendoObservacion(false);
      setObservacionInventario("");
      await cargar();
    } catch (err) {
      const mensaje = err instanceof ApiError ? err.message : "No se pudo cambiar el estado";
      // Si el backend pide observación de inventario (stock negativo), se
      // muestra el campo en vez de un simple mensaje de error.
      if (mensaje.toLowerCase().includes("observación")) {
        setPidiendoObservacion(true);
      }
      setError(mensaje);
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function registrarAbono() {
    if (!id || montoAbono <= 0 || faltaReferenciaAbono) return;
    setGuardandoAbono(true);
    setErrorAbono(null);
    try {
      await pedidosApi.registrarAbono(id, {
        monto: montoAbono,
        metodoPago: metodoAbono,
        referenciaBanco: metodoAbono === "banco" ? referenciaBancoAbono.trim().toUpperCase() : undefined,
      });
      setModalAbonoAbierto(false);
      setMontoAbono(0);
      setReferenciaBancoAbono("");
      await cargar();
    } catch (err) {
      setErrorAbono(err instanceof ApiError ? err.message : "No se pudo registrar el abono");
    } finally {
      setGuardandoAbono(false);
    }
  }

  if (error && !pedido) return <p className="text-sm text-red-600">{error}</p>;
  if (!pedido) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const siguiente = SIGUIENTE_ESTADO[pedido.estado];
  const puedeCancelar = pedido.estado === "pendiente" || pedido.estado === "alistado";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/pedidos" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">{pedido.descripcion}</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Estado actual: <span className="font-semibold capitalize">{pedido.estado}</span>
          {pedido.cliente_nombre ? ` · Cliente: ${pedido.cliente_nombre}` : ""}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {siguiente && (
          <button
            onClick={() => avanzarEstado(siguiente.estado)}
            disabled={cambiandoEstado}
            className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {siguiente.etiqueta}
          </button>
        )}
        {puedeCancelar && (
          <button
            onClick={() => avanzarEstado("cancelado")}
            disabled={cambiandoEstado}
            className="rounded-md border border-red-400 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/30"
          >
            Cancelar pedido
          </button>
        )}
      </div>

      {pidiendoObservacion && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="mb-2 text-sm">Alguno de los productos queda sin stock suficiente — escribe por qué:</p>
          <input
            value={observacionInventario}
            onChange={(e) => setObservacionInventario(e.target.value)}
            placeholder="Ej. llegó mercancía nueva que aún no se registra"
            className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <button
            onClick={() => siguiente && avanzarEstado(siguiente.estado, observacionInventario)}
            disabled={!observacionInventario.trim()}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Confirmar con observación
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Ítems</h2>
          <div className="overflow-hidden rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pedido.items.map((item) => (
                  <tr key={item.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">{item.nombre}</td>
                    <td className="px-3 py-2 text-right">{item.cantidad}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-6 text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Envío</h2>
          <div className="rounded-lg border border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700">
            <p>{pedido.destinatario_nombre ?? "Sin destinatario registrado"}</p>
            {pedido.destinatario_documento && <p>Doc: {pedido.destinatario_documento}</p>}
            {pedido.destinatario_telefono && <p>Tel: {pedido.destinatario_telefono}</p>}
            {pedido.direccion_envio && <p>{pedido.direccion_envio}{pedido.ciudad_envio ? `, ${pedido.ciudad_envio}` : ""}</p>}
            {pedido.transportadora && <p>{pedido.transportadora} — Guía: {pedido.numero_guia ?? "—"}</p>}
            {pedido.notas_entrega && <p className="mt-1 italic">{pedido.notas_entrega}</p>}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Pagos</h2>
            {pedido.saldoPendiente > 0 && pedido.estado !== "cancelado" && (
              <button
                onClick={() => setModalAbonoAbierto(true)}
                className="rounded-md border border-brand-green-600 px-3 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                + Agregar abono
              </button>
            )}
          </div>
          <div className="rounded-lg border border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700">
            <div className="flex justify-between"><span>Total</span><span>{formatMoney(pedido.precio_acordado)}</span></div>
            <div className="flex justify-between"><span>Abonado</span><span>{formatMoney(pedido.totalAbonado)}</span></div>
            <div className="flex justify-between font-bold"><span>Saldo</span><span>{formatMoney(pedido.saldoPendiente)}</span></div>
          </div>
          {pedido.abonos.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
              {pedido.abonos.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>{formatearFechaHora(a.created_at)} · {a.metodo_pago}</span>
                  <span>{formatMoney(a.monto)}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-2 mt-6 text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial</h2>
          <ul className="flex flex-col gap-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
            {pedido.historial.map((h) => (
              <li key={h.id}>
                {formatearFechaHora(h.created_at)} — {h.accion} {h.usuario_nombre ? `(${h.usuario_nombre})` : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {modalAbonoAbierto && (
        <Modal titulo="Registrar abono" onCerrar={() => setModalAbonoAbierto(false)}>
          <p className="mb-3 text-sm">Saldo pendiente: <span className="font-bold">{formatMoney(pedido.saldoPendiente)}</span></p>
          <label className="mb-1 block text-xs font-medium">Monto</label>
          <MoneyInput
            value={montoAbono}
            onChange={setMontoAbono}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <label className="mb-1 block text-xs font-medium">Método</label>
          <select
            value={metodoAbono}
            onChange={(e) => setMetodoAbono(e.target.value as "efectivo" | "banco")}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            <option value="efectivo">Efectivo</option>
            <option value="banco">Banco</option>
          </select>
          {metodoAbono === "banco" && (
            <>
              <label className="mb-1 block text-xs font-medium">Últimos 4 de la transferencia</label>
              <input
                value={referenciaBancoAbono}
                onChange={(e) => setReferenciaBancoAbono(e.target.value)}
                maxLength={4}
                className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
            </>
          )}
          {errorAbono && <p className="mb-3 text-sm text-red-600">{errorAbono}</p>}
          <button
            onClick={registrarAbono}
            disabled={guardandoAbono || montoAbono <= 0 || faltaReferenciaAbono}
            className="w-full rounded-md bg-brand-green-700 px-4 py-2.5 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {guardandoAbono ? "Guardando..." : "Registrar abono"}
          </button>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

Esperado: sin errores nuevos propios de este archivo (el router sigue sin tener la ruta `/pedidos/:id`, eso se resuelve en Task 12).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/pedidos/pages/DetallePedidoPage.tsx
git commit -m "feat(pedidos): pantalla de detalle (estado, pagos, historial)"
```

---

## Task 11: Frontend — alarma global (ventana emergente + sonido)

**Files:**
- Create: `frontend/src/modules/pedidos/components/ComponenteAlarmaPedidos.tsx`
- Modify: `frontend/src/shared/layout/AppShell.tsx`

**Interfaces:**
- Consumes: `pedidosApi.listar` (Task 7), `shared/auth/useAuth`, `shared/auth/roles::tieneAccesoTotal`, `modules/migao/beep::reproducirAlerta`
- Produces: el componente que se monta siempre activo (mientras la sesión dure) para Root/Super Root

- [ ] **Step 1: Escribir `ComponenteAlarmaPedidos.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { reproducirAlerta } from "../../migao/beep";
import { pedidosApi, type Pedido } from "../api";

const POLL_MS = 60000;

/**
 * Vive montado en el layout general (ver AppShell.tsx), solo para Root/Super
 * Root. Consulta cada minuto si hay pedidos vencidos (mismo intervalo que el
 * scheduler del backend, que reprograma `proxima_alarma_en` cada vez que
 * avisa) — si hay alguno, suena la alerta y muestra la ventana. Si se
 * cierra sin cambiar el estado del pedido, vuelve a aparecer en el
 * siguiente ciclo porque el pedido sigue contando como "vencido".
 */
export function ComponenteAlarmaPedidos() {
  const [vencidos, setVencidos] = useState<Pedido[]>([]);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function revisar() {
      try {
        const resultado = await pedidosApi.listar({ vencidos: true });
        if (cancelado) return;
        if (resultado.length > 0) {
          reproducirAlerta();
          setCerrado(false);
        }
        setVencidos(resultado);
      } catch {
        /* no bloquear la app si falla el chequeo — se reintenta en el próximo ciclo */
      }
    }
    revisar();
    const intervalo = setInterval(revisar, POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, []);

  if (vencidos.length === 0 || cerrado) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-brand-green-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-red-600">⚠ Pedidos estancados</h2>
          <button onClick={() => setCerrado(true)} className="text-xl text-brand-ink/60 hover:text-brand-ink dark:text-brand-vanilla/60">
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {vencidos.map((p) => (
            <li key={p.id} className="rounded-md border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
              <Link to={`/pedidos/${p.id}`} onClick={() => setCerrado(true)} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                {p.descripcion}
              </Link>
              <p className="text-xs capitalize text-brand-ink/60 dark:text-brand-vanilla/60">
                {p.estado} — {p.destinatario_nombre ?? "sin destinatario"}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          Esta alerta vuelve a aparecer hasta que cambies el estado de cada pedido.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Montarlo en `AppShell.tsx`**

Agregar el import junto a los demás:

```tsx
import { tieneAccesoTotal } from "../auth/roles";
import { ComponenteAlarmaPedidos } from "../../modules/pedidos/components/ComponenteAlarmaPedidos";
```

(si `tieneAccesoTotal` ya está importado en este archivo, no duplicar el import — solo agregar el de `ComponenteAlarmaPedidos`). Dentro del componente `AppShell`, justo después de `if (!usuario) return null;`, y dentro del `return (...)`, agregar la condición de montaje — buscar la línea `<RefrescoProvider>` y agregar el componente inmediatamente después de abrirla:

```tsx
return (
  <RefrescoProvider>
    {tieneAccesoTotal(usuario.rol) && <ComponenteAlarmaPedidos />}
    <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
```

- [ ] **Step 3: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/pedidos/components/ComponenteAlarmaPedidos.tsx frontend/src/shared/layout/AppShell.tsx
git commit -m "feat(pedidos): ventana emergente con sonido para Root/Super Root"
```

---

## Task 12: Wiring final — rutas y verificación end-to-end

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `PedidosPage` (Task 8), `DetallePedidoPage` (Task 10)
- Produces: la app completa y navegable

- [ ] **Step 1: Agregar las rutas en `frontend/src/App.tsx`**

Agregar los imports junto a los demás (orden alfabético con el resto):

```tsx
import { DetallePedidoPage } from "./modules/pedidos/pages/DetallePedidoPage";
import { PedidosPage } from "./modules/pedidos/pages/PedidosPage";
```

Y las rutas, junto a las demás dentro del `<Route element={<RequireAuth>...}>`:

```tsx
<Route path="/pedidos" element={<PedidosPage />} />
<Route path="/pedidos/:id" element={<DetallePedidoPage />} />
```

(El enlace "Pedidos" del menú lateral en `modules-meta.ts` ya apunta a `/pedidos` desde antes — no requiere cambios.)

- [ ] **Step 2: Verificar que compila todo el frontend**

```bash
cd frontend && npx tsc -b && npm run build
```

Esperado: build exitoso, sin errores.

- [ ] **Step 3: Verificar que compila todo el backend**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: Verificación manual end-to-end completa**

Con ambos servidores corriendo (`npm run dev` en backend y frontend), logueado como Cajero, Administrador o Root:

1. Ir a "Pedidos" en el menú — debe cargar el listado vacío (o con lo que se haya creado en pruebas anteriores).
2. "+ Nuevo pedido" → elegir un ítem del catálogo escribiendo en el buscador (debe aparecer el desplegable con imagen/nombre/precio/SKU) + agregar una línea manual con texto libre → llenar fecha de entrega y datos de envío → guardar.
3. Confirmar que el pedido aparece en el listado con estado "pendiente".
4. Abrir el detalle, click en "Marcar como Alistado".
5. Verificar en la base de datos que el stock del producto de catálogo bajó:
   ```sql
   SELECT ip.cantidad_actual FROM inventario_productos ip
     JOIN pedido_items pi ON pi.producto_id = ip.producto_id
    WHERE pi.pedido_id = '<ID_DEL_PEDIDO>';
   ```
6. Desde el detalle, "Cancelar pedido" — confirmar que el stock vuelve a su valor original con la misma consulta.
7. Crear otro pedido, alistarlo, marcarlo "Enviado", luego "Entregado" — confirmar que cada paso queda en el historial de la pantalla de detalle.
8. Registrar un abono parcial desde el detalle — confirmar en Caja General → Historial que aparece el ingreso con motivo "Abono pedido — ...".
9. Confirmar que el Dashboard General → "Pedidos / Encargos" ya no muestra $0 (ahora refleja los pedidos reales creados).
10. Crear un pedido nuevo con 1 ítem de catálogo, **cancelarlo directo desde "pendiente"** (sin alistar) — confirmar con la misma consulta del paso 5 que el stock del producto **no cambió en absoluto** (a diferencia del paso 6, acá nunca se descontó nada que haya que devolver).
11. En un pedido con saldo pendiente, intentar registrar un abono por un monto mayor al saldo — debe rechazarlo con un mensaje claro (`El abono (...) es mayor al saldo pendiente (...)`).
12. Dejar un producto de prueba en 0 de stock (`UPDATE inventario_productos SET cantidad_actual = 0 WHERE producto_id = '<ID>'`), crear un pedido con ese producto y alistarlo sin escribir observación — la pantalla debe pedir la observación (campo que aparece automático, ver `pidiendoObservacion` en `DetallePedidoPage.tsx`); al escribirla y confirmar, debe alistarse igual con el stock en negativo.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(pedidos): conecta las rutas — módulo completo y navegable"
```

(El `git push` final queda en la Task 13, que agrega la factura imprimible — última pieza prometida en la spec.)

---

## Task 13: Factura imprimible del pedido

**Files:**
- Modify: `backend/src/modules/pedidos/pedidos.repository.ts` (Task 3)
- Modify: `backend/src/modules/pedidos/pedidos.service.ts` (Task 4)
- Modify: `backend/src/modules/pedidos/pedidos.controller.ts` (Task 5)
- Modify: `backend/src/modules/pedidos/pedidos.routes.ts` (Task 5)
- Modify: `frontend/src/modules/pedidos/api.ts` (Task 7)
- Modify: `frontend/src/modules/migao/components/BotonFactura.tsx` (ya existe, no se creó en este plan)
- Modify: `frontend/src/modules/pedidos/pages/DetallePedidoPage.tsx` (Task 10)

**Interfaces:**
- Consumes: `migao/api.ts::FacturaOrden` (tipo ya existente, reusado tal cual — mismo patrón que `con_sentido/api.ts::obtenerFactura`), `migao/factura.ts::facturaAReciboProps` (ya existe)
- Produces: `GET /pedidos/:id/factura`, botón "Factura" en el detalle del pedido

Reusa el `facturas_numero_seq`/get-or-create idempotente ya establecido (ver `con_sentido.repository.ts::getOrCrearFactura`) y el índice único `idx_facturas_pedido_unica` agregado en la Task 1 — sin ese índice, el `ON CONFLICT` de abajo no detecta duplicados.

- [ ] **Step 1: Agregar a `pedidos.repository.ts`**

Agregar al final del archivo:

```typescript
/** Get-or-create idempotente — mismo patrón que con_sentido.repository.ts::
 *  getOrCrearFactura, comparte la misma facturas_numero_seq. El índice único
 *  en pedido_id (ver migración 2026-10-04) blinda contra doble clic. */
export async function getOrCrearFacturaPedido(
  params: { pedidoId: string; subtotal: number; total: number },
  executor: Executor = pool,
) {
  const insert = await executor.query(
    `INSERT INTO facturas (pedido_id, numero, tipo, subtotal, total)
     VALUES ($1, 'F-' || lpad(nextval('facturas_numero_seq'), 6, '0'), 'factura', $2, $3)
     ON CONFLICT (pedido_id) WHERE pedido_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [params.pedidoId, params.subtotal, params.total],
  );
  if (insert.rowCount) return insert.rows[0];
  const existente = await executor.query(`SELECT * FROM facturas WHERE pedido_id = $1`, [params.pedidoId]);
  return existente.rows[0];
}
```

- [ ] **Step 2: Agregar a `pedidos.service.ts`**

Agregar el import de `Executor` no hace falta (ya usa `pool` directo); agregar al final del archivo:

```typescript
/**
 * Factura imprimible del pedido — mismo formato normalizado que
 * con_sentido.service.ts::obtenerFacturaVenta (mesa/mesero/comensal/propina
 * quedan null, acá no aplican) para reusar el mismo componente de impresión
 * del frontend. Sin descuento en este flujo: subtotal y total son iguales.
 */
export async function obtenerFacturaPedido(id: string) {
  const pedido = await repo.getPedidoById(id);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");

  const [items, abonos] = await Promise.all([repo.getItemsPorPedido(id), repo.getAbonosPorPedido(id)]);
  const monto = Number(pedido.precio_acordado);
  const factura = await repo.getOrCrearFacturaPedido({ pedidoId: id, subtotal: monto, total: monto });

  return {
    numeroFactura: factura.numero as string,
    fecha: pedido.created_at as string,
    mesaNumero: null,
    mesaPiso: null,
    meseroNombre: null,
    comensalNumero: null,
    items: items.map((i) => ({
      productoNombre: i.nombre as string,
      sku: i.sku as string | null,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
    })),
    subtotal: monto,
    descuentoPorcentaje: 0,
    descuentoMonto: 0,
    total: monto,
    pagos: abonos.map((a) => ({ metodoPago: a.metodo_pago as string, monto: Number(a.monto), referencia: null as string | null })),
    propina: null,
  };
}
```

- [ ] **Step 3: Agregar a `pedidos.controller.ts`**

```typescript
export async function obtenerFacturaPedidoController(req: Request, res: Response) {
  return ok(res, await service.obtenerFacturaPedido(req.params.id));
}
```

- [ ] **Step 4: Agregar la ruta en `pedidos.routes.ts`**

Agregar el import de `obtenerFacturaPedidoController` junto a los demás, y la ruta (gated solo por `pedidos.ver`, que ya aplica a todo el router):

```typescript
pedidosRouter.get("/:id/factura", asyncHandler(obtenerFacturaPedidoController));
```

- [ ] **Step 5: Verificar que el backend compila**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 6: Agregar a `frontend/src/modules/pedidos/api.ts`**

Agregar el import al principio del archivo:

```typescript
import type { FacturaOrden } from "../migao/api";
```

Y la función en `pedidosApi` (mismo patrón que `conSentidoApi.obtenerFactura`):

```typescript
obtenerFactura: (id: string) => apiFetch<FacturaOrden>(`/pedidos/${id}/factura`),
```

- [ ] **Step 7: Extender `BotonFactura.tsx` con el origen "pedido"**

Modificar el tipo `OrigenFactura` agregando la nueva variante:

```typescript
type OrigenFactura =
  | { tipo: "orden"; id: string }
  | { tipo: "venta"; id: string }
  | { tipo: "venta_con_sentido"; id: string }
  | { tipo: "venta_caja"; id: string }
  | { tipo: "pedido"; id: string };
```

Y agregar el import de `pedidosApi` junto a los demás:

```typescript
import { pedidosApi } from "../../pedidos/api";
```

Y dentro de `abrir()`, agregar el caso antes del `return` genérico — reemplazar:

```typescript
      const factura =
        origen.tipo === "orden"
          ? await migaoApi.obtenerFactura(origen.id)
          : origen.tipo === "venta"
            ? await migaoApi.obtenerFacturaPorVenta(origen.id)
            : await conSentidoApi.obtenerFactura(origen.id);
```

por:

```typescript
      const factura =
        origen.tipo === "orden"
          ? await migaoApi.obtenerFactura(origen.id)
          : origen.tipo === "venta"
            ? await migaoApi.obtenerFacturaPorVenta(origen.id)
            : origen.tipo === "pedido"
              ? await pedidosApi.obtenerFactura(origen.id)
              : await conSentidoApi.obtenerFactura(origen.id);
```

- [ ] **Step 8: Agregar el botón en `DetallePedidoPage.tsx`**

Agregar el import junto a los demás:

```tsx
import { BotonFactura } from "../../migao/components/BotonFactura";
```

Y, dentro del header del componente (justo debajo del párrafo de "Estado actual..."), agregar:

```tsx
<BotonFactura
  origen={{ tipo: "pedido", id: pedido.id }}
  className="mt-2 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
/>
```

- [ ] **Step 9: Verificar que el frontend compila**

```bash
cd frontend && npx tsc -b
```

Esperado: sin errores.

- [ ] **Step 10: Verificación manual**

Con ambos servidores corriendo, abrir el detalle de un pedido ya creado y hacer clic en "Factura" — debe abrir el modal de impresión con el número de factura (`F-00XXXX`), los ítems (con su SKU si vienen de catálogo), y los abonos registrados como "pagos". Hacer clic dos veces seguidas y confirmar que el número de factura es el mismo las dos veces (get-or-create funcionando).

```sql
SELECT COUNT(*) FROM facturas WHERE pedido_id = '<ID_DEL_PEDIDO>';
```

Esperado: `1` (nunca más de una, sin importar cuántas veces se haya pedido la factura).

- [ ] **Step 11: Commit y push final**

```bash
git add backend/src/modules/pedidos/pedidos.repository.ts backend/src/modules/pedidos/pedidos.service.ts \
        backend/src/modules/pedidos/pedidos.controller.ts backend/src/modules/pedidos/pedidos.routes.ts \
        frontend/src/modules/pedidos/api.ts frontend/src/modules/migao/components/BotonFactura.tsx \
        frontend/src/modules/pedidos/pages/DetallePedidoPage.tsx
git commit -m "feat(pedidos): factura imprimible, reusando el componente compartido"
git push
```
