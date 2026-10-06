# Módulo Vales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo "Vales" (comprobantes de dinero ya entregado, con tres fuentes de fondos posibles y reversión completa) para el sistema POS Con Sentido / El Rinconcito del Migao.

**Architecture:** Backend Express+TypeScript con el patrón modular ya establecido (schema/repository/service/controller/routes), ampliando además dos funciones existentes de Caja General (`registrarEgreso`, `registrarEgresoAcumulado`) para que soporten referencia a otra entidad y pago mixto. Frontend React+TypeScript con el patrón api.ts + pages/ + components/, un botón nuevo en el header global, y un tipo nuevo en el componente de impresión ya compartido por toda la app.

**Tech Stack:** MySQL 8 (dialecto Postgres vía shim, ver `backend/src/shared/db/pool.ts`), Express, Zod, React, Vite.

**Spec:** `docs/superpowers/specs/2026-10-05-vales-design.md`

## Global Constraints

- Un vale documenta dinero que **ya salió** — nunca una promesa a futuro; no tiene estado "pendiente de cobro".
- Los vales **nunca** piden `referenciaBanco` (esa regla es solo para pagos recibidos/ingresos — ver `EgresoModal.tsx::pedirReferenciaBanco={false}`).
- Permisos (`vales.ver`, `vales.crear`, `vales.marcar_repuesto`, `vales.anular`) exclusivos de Root y Super Root — nunca Cajero/Administrador.
- `caja_egresos_acumulado` necesita sus propias columnas `referencia_entidad`/`referencia_id` (no las tiene, a diferencia de `movimientos_caja`) y su propio mecanismo de reversión — no es la misma tabla que usa el caso "turno".
- "Pagado a" es siempre texto libre; `destinatarioUsuarioId` es un enganche opcional aparte (futuro módulo de nóminas), nunca un reemplazo del texto.
- Anular un vale ya repuesto está permitido (revierte las dos cosas); anular uno ya anulado no.
- SQL escrito en dialecto Postgres (`$1`, `RETURNING`, `nextval('secuencia')`) — el shim lo traduce a MySQL.
- Verificación: `tsc --noEmit` (backend) / `tsc -b` (frontend) + verificación manual (no existe framework de tests en este repo).

## Review Focus

- **Anular un vale sourced desde "acumulado"**: si el código reusa por error `anularMovimientosPorReferencia` (que solo opera sobre `movimientos_caja`) para este caso, no revertiría nada y fallaría silenciosamente o lanzaría un error oscuro — la Task 4 prueba explícitamente que se borra de `caja_egresos_acumulado`, no de `movimientos_caja`.
- **Vale "dueño" sin turno abierto al reponer con fuente "turno"**: debe fallar con el mismo mensaje claro de siempre ("No hay un turno de caja abierto"), no con un error distinto o un vale a medio marcar.
- **`duenoId` que no es Root/Super Root**: un dueño inválido (ej. un Cajero) debe rechazarse en el backend, no solo ocultarse en el selector del frontend — alguien podría llamar la API directo.
- **Vale con pago 100% banco o 100% efectivo (no mixto) sourced desde "acumulado"**: `registrarEgresoAcumulado` hoy solo acepta un `metodoPago` suelto sin pasar por `descomponerPago` — confirmar que el caso NO mixto (un solo monto) sigue funcionando igual después de ampliarlo para mixto.
- **Anular un vale que generó egreso en un turno YA CERRADO**: sus totales deben recalcularse (`recalcularCierresSiEstanCerrados`), si no el cierre de ese turno queda con cifras viejas que no cuadran con `movimientos_caja`.

---

## Task 1: Base de datos — migración + esquema + permisos

**Files:**
- Create: `database/mysql/migraciones/2026-10-05_modulo_vales.sql`
- Modify: `database/mysql/schema.sql`
- Modify: `database/seed.sql`

**Interfaces:**
- Produces: tabla `vales`, secuencia `vales_numero_seq`, columnas nuevas en `caja_egresos_acumulado`, categoría de gasto "Vales", módulo "vales", permisos `vales.ver`/`vales.crear`/`vales.marcar_repuesto`/`vales.anular` (otorgados solo a Root y Super Root).

- [ ] **Step 1: Escribir la migración**

Crear `database/mysql/migraciones/2026-10-05_modulo_vales.sql`:

```sql
-- ============================================================================
-- Módulo Vales — comprobantes de dinero ya entregado (anticipo a un
-- empleado, pago puntual, etc.), con tres fuentes de fondos posibles
-- (turno abierto, acumulado total, o bolsillo de un dueño a reponer) y
-- reversión completa (anular).
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

CREATE TABLE vales (
  id                        CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  numero                    VARCHAR(20) NOT NULL UNIQUE,
  pagado_a                  VARCHAR(150) NOT NULL,
  -- Enganche opcional a futuro (módulo de nóminas) — "pagado_a" sigue siendo
  -- el dato real, esto nunca lo reemplaza.
  destinatario_usuario_id   CHAR(36) NULL,
  destinatario_documento    VARCHAR(30) NULL,
  concepto                  TEXT NOT NULL,
  monto_efectivo            DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_banco               DECIMAL(12,2) NOT NULL DEFAULT 0,
  fuente                    VARCHAR(20) NOT NULL
                             CHECK (fuente IN ('turno', 'acumulado', 'dueno')),
  dueno_id                  CHAR(36) NULL,
  repuesto_en               DATETIME(6) NULL,
  fuente_reposicion         VARCHAR(20) NULL,
  anulado_en                DATETIME(6) NULL,
  creado_por_id             CHAR(36) NOT NULL,
  created_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (destinatario_usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (dueno_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (monto_efectivo + monto_banco > 0),
  CHECK (fuente != 'dueno' OR dueno_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_vales_fuente ON vales(fuente);
CREATE INDEX idx_vales_dueno ON vales(dueno_id);

-- MySQL no tiene CREATE SEQUENCE — este repo lo reemplaza con la tabla
-- `secuencias` (nombre, valor), que el backend resuelve en cada
-- nextval('x') (ver backend/src/shared/db/pool.ts::resolverNextval). Por
-- eso una secuencia nueva se agrega con un INSERT, nunca con DDL de
-- secuencia — igual que 'comensal_seq'/'facturas_numero_seq' en schema.sql.
INSERT INTO secuencias (nombre, valor) VALUES ('vales_numero_seq', 0)
  ON DUPLICATE KEY UPDATE nombre = nombre;

-- `caja_egresos_acumulado` no tenía estas dos columnas (a diferencia de
-- `movimientos_caja`, que sí las usan los ingresos) — las necesita un vale
-- con fuente "acumulado" para poder anularse después.
ALTER TABLE caja_egresos_acumulado
  ADD COLUMN referencia_entidad VARCHAR(80) NULL AFTER usuario_id,
  ADD COLUMN referencia_id      VARCHAR(64) NULL AFTER referencia_entidad;

-- --- Módulo + categoría de gasto fija ---
INSERT INTO modulos (slug, nombre)
SELECT 'vales', 'Vales'
WHERE NOT EXISTS (SELECT 1 FROM modulos WHERE slug = 'vales');

INSERT INTO categorias_gasto (nombre, modulo_id)
SELECT 'Vales', (SELECT id FROM modulos WHERE slug = 'vales')
WHERE NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE nombre = 'Vales');

-- --- Permisos ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'vales'), x.accion, x.codigo
FROM (SELECT 'ver' AS accion, 'vales.ver' AS codigo
      UNION ALL SELECT 'crear', 'vales.crear'
      UNION ALL SELECT 'marcar_repuesto', 'vales.marcar_repuesto'
      UNION ALL SELECT 'anular', 'vales.anular') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo IN ('vales.ver', 'vales.crear', 'vales.marcar_repuesto', 'vales.anular')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
```

- [ ] **Step 2: Reflejar lo mismo en `database/mysql/schema.sql` (instalación nueva)**

Agregar `referencia_entidad`/`referencia_id` a la definición de `caja_egresos_acumulado` (buscar `CREATE TABLE caja_egresos_acumulado`):

```sql
CREATE TABLE caja_egresos_acumulado (
  id                 CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  categoria_gasto_id INT NOT NULL,
  proveedor_id       CHAR(36),
  monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago        VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  motivo             VARCHAR(200) NOT NULL,
  usuario_id         CHAR(36) NOT NULL,
  referencia_entidad VARCHAR(80) NULL,
  referencia_id      VARCHAR(64) NULL,
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
```

Cambiar la línea `INSERT INTO secuencias (nombre, valor) VALUES ('comensal_seq', 0), ('facturas_numero_seq', 0);` (sección "0. SECUENCIAS", cerca del inicio del archivo) por:

```sql
INSERT INTO secuencias (nombre, valor) VALUES ('comensal_seq', 0), ('facturas_numero_seq', 0), ('vales_numero_seq', 0);
```

Y agregar, después del bloque de `pedidos_parametros` (al final de esa sección de Pedidos), la tabla `vales` completa (mismo `CREATE TABLE` del Step 1, sin el `WHERE NOT EXISTS` que solo aplica a la migración incremental).

- [ ] **Step 3: Agregar el módulo, la categoría y los permisos a `database/seed.sql` (instalación nueva)**

Buscar el bloque de `INSERT INTO modulos` y agregar una fila para `vales` (mismo patrón que las demás filas de ese INSERT). Buscar el `INSERT INTO categorias_gasto` (o el bloque equivalente) y agregar la fila `'Vales'` con el `modulo_id` de `vales`. Buscar el bloque de `INSERT INTO permisos` (bulk VALUES) y agregar las 4 filas de vales, con el mismo formato que las filas de `pedidos` ya agregadas ahí (`((SELECT id FROM modulos WHERE slug = 'vales'), 'ver', 'vales.ver'), ...`). Por último, agregar un INSERT nuevo en `roles_permisos` que otorgue los 4 permisos de vales solo a `Root` y `Super Root` (mismo patrón que el INSERT de `pedidos.administrar_parametros`, que también es exclusivo de esos dos roles).

- [ ] **Step 4: Verificar consistencia**

```bash
cd /Users/alejandroramos/Desktop/sistemapos/ConSentido && for c in vales.ver vales.crear vales.marcar_repuesto vales.anular; do grep -q "$c" database/mysql/migraciones/2026-10-05_modulo_vales.sql && grep -q "$c" database/seed.sql || exit 1; done && grep -q "referencia_entidad VARCHAR(80) NULL" database/mysql/schema.sql && echo "consistencia SQL OK"
```

Esperado: `consistencia SQL OK`.

- [ ] **Step 5: Commit**

```bash
git add database/mysql/migraciones/2026-10-05_modulo_vales.sql database/mysql/schema.sql database/seed.sql
git commit -m "feat(vales): migración de base de datos — tabla, permisos, columnas de referencia en acumulado"
```

---

## Task 2: Backend — ampliar Caja General (referencia en egreso + mixto en acumulado)

**Files:**
- Modify: `backend/src/modules/general/caja/caja.schema.ts`
- Modify: `backend/src/modules/general/caja/caja.repository.ts`
- Modify: `backend/src/modules/general/caja/caja.service.ts`

**Interfaces:**
- Produces: `registrarEgreso(input, usuarioId, executor?)` con soporte de `referenciaEntidad`/`referenciaId` y `executor` opcional; `registrarEgresoAcumulado(input, usuarioId)` con soporte de pago mixto y de `referenciaEntidad`/`referenciaId`; `anularEgresoAcumuladoPorReferencia(client, referenciaEntidad, referenciaId)` — todas usadas por el módulo Vales (Task 5).

- [ ] **Step 1: Agregar `"vales"` a `MODULO_ORIGEN_VALUES` y los campos de referencia a `camposEgreso`**

En `backend/src/modules/general/caja/caja.schema.ts`, cambiar:

```typescript
const MODULO_ORIGEN_VALUES = ["insumos", "talleres", "con_sentido", "migao", "pedidos", "general"] as const;
```

por:

```typescript
const MODULO_ORIGEN_VALUES = ["insumos", "talleres", "con_sentido", "migao", "pedidos", "general", "vales"] as const;
```

Y en el bloque `camposEgreso` (busca `const camposEgreso = {`), agregar dos campos opcionales:

```typescript
const camposEgreso = {
  categoriaGastoId: z.number().int().positive(),
  motivo: z.string().max(200),
  proveedorId: z.string().uuid().optional(),
  moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional(),
  // Solo lo usan llamadas internas de otro módulo (ej. Vales) — nunca viene
  // del formulario de "Registrar egreso" de Caja General.
  referenciaEntidad: z.string().max(80).optional(),
  referenciaId: z.string().max(64).optional(),
};
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores (el campo nuevo es opcional, no rompe ningún llamador existente).

- [ ] **Step 3: Extender `insertEgreso` para aceptar `executor` y referencia**

En `backend/src/modules/general/caja/caja.repository.ts`, cambiar la función completa:

```typescript
export async function insertEgreso(
  executor: Executor,
  params: {
    turnoId: string;
    categoriaGastoId: number;
    monto: number;
    metodoPago: string;
    motivo: string;
    usuarioId: string;
    proveedorId?: string;
    moduloOrigenSlug?: string;
    referenciaEntidad?: string;
    referenciaId?: string;
  },
) {
  const result = await executor.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, categoria_gasto_id, monto, metodo_pago, motivo, usuario_id, proveedor_id, modulo_origen_id,
        referencia_entidad, referencia_id)
     VALUES ($1, 'egreso', $2, $3, $4, $5, $6, $7, (SELECT id FROM modulos WHERE slug = $8), $9, $10)
     RETURNING *`,
    [
      params.turnoId,
      params.categoriaGastoId,
      params.monto,
      params.metodoPago,
      params.motivo,
      params.usuarioId,
      params.proveedorId || null,
      params.moduloOrigenSlug ?? null,
      params.referenciaEntidad ?? null,
      params.referenciaId ?? null,
    ],
  );
  return result.rows[0];
}
```

- [ ] **Step 4: Agregar `anularEgresoAcumuladoPorReferencia` y extender `insertEgresoAcumulado` en `caja.repository.ts`**

Reemplazar la función `insertEgresoAcumulado` existente:

```typescript
export async function insertEgresoAcumulado(
  executor: Executor,
  params: {
    categoriaGastoId: number;
    proveedorId?: string;
    monto: number;
    metodoPago: string;
    motivo: string;
    usuarioId: string;
    referenciaEntidad?: string;
    referenciaId?: string;
  },
) {
  const result = await executor.query(
    `INSERT INTO caja_egresos_acumulado
       (categoria_gasto_id, proveedor_id, monto, metodo_pago, motivo, usuario_id, referencia_entidad, referencia_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      params.categoriaGastoId,
      params.proveedorId || null,
      params.monto,
      params.metodoPago,
      params.motivo,
      params.usuarioId,
      params.referenciaEntidad ?? null,
      params.referenciaId ?? null,
    ],
  );
  return result.rows[0];
}

/** Borra las filas de `caja_egresos_acumulado` con esa referencia — usado al
 *  anular un vale cuya fuente fue "acumulado" (esa tabla no tiene su propia
 *  auditoría de ediciones como sí tiene `movimientos_caja`, así que esto
 *  borra directo; el registro del vale mismo documenta qué pasó). */
export async function borrarEgresosAcumuladoPorReferencia(
  client: PoolClient,
  referenciaEntidad: string,
  referenciaId: string,
) {
  await client.query(
    `DELETE FROM caja_egresos_acumulado WHERE referencia_entidad = $1 AND referencia_id = $2`,
    [referenciaEntidad, referenciaId],
  );
}
```

- [ ] **Step 5: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: **falla** — `registrarEgreso`/`registrarEgresoAcumulado` en `caja.service.ts` todavía llaman a `repo.insertEgreso({...})` sin el nuevo primer argumento `executor`. Este error es esperado en este punto, se corrige en el siguiente step.

- [ ] **Step 6: Actualizar `registrarEgreso` y `registrarEgresoAcumulado` en `caja.service.ts`**

Reemplazar la función `registrarEgreso` completa:

```typescript
/**
 * Registra un egreso en el turno abierto. Acepta un `executor` (PoolClient)
 * opcional para que otros módulos (ej. Vales) lo incluyan en su misma
 * transacción — mismo criterio que `registrarIngreso`.
 */
export async function registrarEgreso(input: RegistrarEgresoInput, usuarioId: string, executor: Pool | PoolClient = pool) {
  const turno = await turnoAbiertoOrThrow(executor);
  const partes = descomponerPago(input);
  const movimientos = [];
  for (const parte of partes) {
    movimientos.push(
      await repo.insertEgreso(executor, {
        turnoId: turno.id,
        categoriaGastoId: input.categoriaGastoId,
        monto: parte.monto,
        metodoPago: parte.metodoPago,
        motivo: input.motivo,
        usuarioId,
        proveedorId: input.proveedorId,
        moduloOrigenSlug: input.moduloOrigenSlug,
        referenciaEntidad: input.referenciaEntidad,
        referenciaId: input.referenciaId,
      }),
    );
  }
  return movimientos;
}
```

Reemplazar la función `registrarEgresoAcumulado` completa:

```typescript
/** Egreso contra el ACUMULADO TOTAL histórico — a diferencia de
 *  registrarEgreso, no exige ningún turno abierto ni lo toca. Soporta pago
 *  mixto igual que registrarEgreso (se descompone en 1-2 filas puras).
 *  Acepta un `executor` opcional por el mismo motivo que registrarEgreso: un
 *  llamador (ej. Vales) puede necesitar que esto corra dentro de SU MISMA
 *  transacción, para que no quede un egreso huérfano si algo después falla
 *  y hace rollback de lo demás. */
export async function registrarEgresoAcumulado(
  input: RegistrarEgresoAcumuladoInput,
  usuarioId: string,
  executor: Pool | PoolClient = pool,
) {
  const partes = descomponerPago(input);
  const egresos = [];
  for (const parte of partes) {
    egresos.push(
      await repo.insertEgresoAcumulado(executor, {
        categoriaGastoId: input.categoriaGastoId,
        proveedorId: input.proveedorId,
        monto: parte.monto,
        metodoPago: parte.metodoPago,
        motivo: input.motivo,
        usuarioId,
        referenciaEntidad: input.referenciaEntidad,
        referenciaId: input.referenciaId,
      }),
    );
  }
  return egresos;
}

/** Reversa de un egreso acumulado por referencia — ver anularMovimientosPorReferencia
 *  para el caso equivalente de `movimientos_caja` (turno). Sin auditoría
 *  dedicada: `caja_egresos_acumulado` no tiene su propia tabla de ediciones,
 *  y el acumulado total se recalcula siempre en vivo (obtenerAcumuladoTotal),
 *  así que no hay nada más que recalcular después de borrar. */
export async function anularEgresoAcumuladoPorReferencia(
  client: PoolClient,
  referenciaEntidad: string,
  referenciaId: string,
) {
  await repo.borrarEgresosAcumuladoPorReferencia(client, referenciaEntidad, referenciaId);
}
```

- [ ] **Step 7: Actualizar `registrarEgresoAcumuladoSchema` para aceptar pago mixto**

En `caja.schema.ts`, reemplazar `registrarEgresoAcumuladoSchema`:

```typescript
export const registrarEgresoAcumuladoSchema = z.union([
  z.object({ ...camposEgreso, metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive() }),
  z
    .object({
      ...camposEgreso,
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type RegistrarEgresoAcumuladoInput = z.infer<typeof registrarEgresoAcumuladoSchema>;
```

- [ ] **Step 8: Verificar que compila**

```bash
cd backend && npx tsc --noEmit && echo "tsc OK"
```

Esperado: `tsc OK`.

- [ ] **Step 9: Verificación manual — egreso acumulado simple sigue funcionando**

Con el backend corriendo y un token válido de Root:

```bash
curl -s -X POST http://localhost:4000/api/v1/caja/egresos-acumulados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"categoriaGastoId": 1, "motivo": "prueba no mixta", "metodoPago": "efectivo", "monto": 1000}' | jq
```

Esperado: `201`/`200`, sin error — confirma que el caso NO mixto (una sola parte) sigue funcionando después de pasar por `descomponerPago`.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/general/caja/caja.schema.ts backend/src/modules/general/caja/caja.repository.ts backend/src/modules/general/caja/caja.service.ts
git commit -m "feat(caja): soporta referencia externa en egresos y pago mixto en egreso acumulado"
```

---

## Task 3: Backend — `vales.schema.ts`

**Files:**
- Create: `backend/src/modules/vales/vales.schema.ts`

**Interfaces:**
- Produces: `crearValeSchema`/`CrearValeInput`, `reponerValeSchema`/`ReponerValeInput` — los usan Task 5 (service) y Task 6 (controller).

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { z } from "zod";

const METODOS_PAGO = ["efectivo", "banco"] as const;
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";

// Mismo patrón que registrarEgresoSchema (caja.schema.ts) — "mixto" no es un
// método real en la base, se descompone en 1-2 líneas puras al guardar. Un
// vale nunca pide referenciaBanco (esa regla es solo para pagos recibidos).
const pagoValeSchema = z.union([
  z.object({ metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive() }),
  z
    .object({
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);

const FUENTES = ["turno", "acumulado", "dueno"] as const;
export type FuenteVale = (typeof FUENTES)[number];

export const crearValeSchema = z
  .object({
    pagadoA: z.string().trim().min(1, "Escribe a quién se le pagó").max(150),
    destinatarioUsuarioId: z.string().uuid().optional(),
    destinatarioDocumento: z.string().trim().max(30).optional(),
    concepto: z.string().trim().min(1, "Escribe el concepto del vale").max(500),
    fuente: z.enum(FUENTES),
    // Obligatorio solo si fuente==="dueno" — se valida en el service (ahí
    // también se confirma que ese usuario de verdad sea Root o Super Root).
    duenoId: z.string().uuid().optional(),
  })
  .and(pagoValeSchema)
  .refine((d) => d.fuente !== "dueno" || Boolean(d.duenoId), {
    message: "Elige de qué dueño salió el dinero",
    path: ["duenoId"],
  });
export type CrearValeInput = z.infer<typeof crearValeSchema>;

export const reponerValeSchema = z.object({
  fuenteReposicion: z.enum(["turno", "acumulado"]),
});
export type ReponerValeInput = z.infer<typeof reponerValeSchema>;
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit && echo "tsc OK"
```

Esperado: `tsc OK` (el archivo no se usa todavía en ningún lado, solo valida su propia sintaxis).

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/vales/vales.schema.ts
git commit -m "feat(vales): validadores Zod"
```

---

## Task 4: Backend — `vales.repository.ts`

**Files:**
- Create: `backend/src/modules/vales/vales.repository.ts`

**Interfaces:**
- Consumes: `CrearValeInput` de `vales.schema.ts` (Task 3)
- Produces: todas las funciones de acceso a datos que usa `vales.service.ts` (Task 5) — firmas exactas abajo.

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { Pool, PoolClient, pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

const SELECT_VALE = `
  SELECT v.*, d.nombre AS destinatario_usuario_nombre, du.nombre AS dueno_nombre, c.nombre AS creado_por_nombre
    FROM vales v
    LEFT JOIN usuarios d ON d.id = v.destinatario_usuario_id
    LEFT JOIN usuarios du ON du.id = v.dueno_id
    LEFT JOIN usuarios c ON c.id = v.creado_por_id
`;

export interface FiltrosListarVales {
  fuente?: string;
  estado?: "activo" | "repuesto" | "anulado";
}

export async function listVales(filtros: FiltrosListarVales) {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtros.fuente) {
    condiciones.push(`v.fuente = $${params.length + 1}`);
    params.push(filtros.fuente);
  }
  if (filtros.estado === "anulado") {
    condiciones.push(`v.anulado_en IS NOT NULL`);
  } else if (filtros.estado === "repuesto") {
    condiciones.push(`v.repuesto_en IS NOT NULL AND v.anulado_en IS NULL`);
  } else if (filtros.estado === "activo") {
    condiciones.push(`v.repuesto_en IS NULL AND v.anulado_en IS NULL`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(`${SELECT_VALE} ${where} ORDER BY v.created_at DESC`, params);
  return result.rows;
}

export async function getValeById(id: string, executor: Executor = pool) {
  const result = await executor.query(`${SELECT_VALE} WHERE v.id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

/** Misma fila, bloqueada (FOR UPDATE) hasta el COMMIT — para reponer/anular
 *  sin que dos requests simultáneos lean el mismo estado de partida. */
export async function getValeParaActualizar(client: PoolClient, id: string) {
  const result = await client.query(`SELECT * FROM vales WHERE id = $1 FOR UPDATE`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function getCategoriaGastoPorNombre(nombre: string, executor: Executor = pool) {
  const result = await executor.query(`SELECT id FROM categorias_gasto WHERE nombre = $1`, [nombre]);
  return result.rowCount ? (result.rows[0].id as number) : null;
}

export async function crearVale(
  client: PoolClient,
  params: {
    pagadoA: string;
    destinatarioUsuarioId: string | null;
    destinatarioDocumento: string | null;
    concepto: string;
    montoEfectivo: number;
    montoBanco: number;
    fuente: string;
    duenoId: string | null;
    creadoPorId: string;
  },
) {
  const result = await client.query(
    `INSERT INTO vales (
       numero, pagado_a, destinatario_usuario_id, destinatario_documento, concepto,
       monto_efectivo, monto_banco, fuente, dueno_id, creado_por_id
     ) VALUES (
       'V-' || lpad(nextval('vales_numero_seq'), 6, '0'),
       $1, $2, $3, $4, $5, $6, $7, $8, $9
     )
     RETURNING *`,
    [
      params.pagadoA,
      params.destinatarioUsuarioId,
      params.destinatarioDocumento,
      params.concepto,
      params.montoEfectivo,
      params.montoBanco,
      params.fuente,
      params.duenoId,
      params.creadoPorId,
    ],
  );
  return result.rows[0];
}

export async function marcarRepuesto(client: PoolClient, id: string, fuenteReposicion: string) {
  await client.query(`UPDATE vales SET repuesto_en = NOW(), fuente_reposicion = $2 WHERE id = $1`, [
    id,
    fuenteReposicion,
  ]);
}

export async function marcarAnulado(client: PoolClient, id: string) {
  await client.query(`UPDATE vales SET anulado_en = NOW() WHERE id = $1`, [id]);
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit && echo "tsc OK"
```

Esperado: `tsc OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/vales/vales.repository.ts
git commit -m "feat(vales): repositorio (consultas SQL)"
```

---

## Task 5: Backend — `vales.service.ts`

**Files:**
- Create: `backend/src/modules/vales/vales.service.ts`

**Interfaces:**
- Consumes: `vales.repository.ts` (Task 4), `vales.schema.ts` (Task 3), `caja.service.ts::{registrarEgreso, registrarEgresoAcumulado, anularMovimientosPorReferencia, anularEgresoAcumuladoPorReferencia, recalcularCierresSiEstanCerrados}` (Task 2), `usuarios.repository.ts::getUsuarioById`.
- Produces: `crearVale`, `listarVales`, `obtenerVale`, `marcarValeRepuesto`, `anularVale` — los usa Task 6 (controller).

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { getUsuarioById } from "../general/usuarios/usuarios.repository";
import * as repo from "./vales.repository";
import { CrearValeInput, ReponerValeInput } from "./vales.schema";

const ROLES_DUENO = new Set(["Root", "Super Root"]);
const CATEGORIA_GASTO_VALES = "Vales";

async function categoriaGastoValesId(): Promise<number> {
  const id = await repo.getCategoriaGastoPorNombre(CATEGORIA_GASTO_VALES);
  if (!id) throw Errors.conflict('No existe la categoría de gasto "Vales" — corre la migración del módulo de vales.');
  return id;
}

/** `monto`/`montoEfectivo`+`montoBanco` según el método — nunca los dos a la
 *  vez (mismo shape que descomponerPago espera). Solo se usa con el pago de
 *  un vale nuevo (CrearValeInput); la reposición construye su propio pago
 *  directo a partir de los montos ya guardados en el vale (ver abajo). */
function pagoDesdeInput(input: CrearValeInput) {
  if (input.metodoPago === "mixto") {
    return { metodoPago: "mixto" as const, montoEfectivo: input.montoEfectivo, montoBanco: input.montoBanco };
  }
  return { metodoPago: input.metodoPago, monto: input.monto };
}

export async function listarVales(filtros: repo.FiltrosListarVales) {
  return repo.listVales(filtros);
}

export async function obtenerVale(id: string) {
  const vale = await repo.getValeById(id);
  if (!vale) throw Errors.notFound("Vale no encontrado");
  return vale;
}

/**
 * Crea el vale y, según `fuente`, genera de inmediato el egreso real que
 * corresponde — todo en una sola transacción: si el egreso falla (ej. no
 * hay turno abierto), el vale no se crea.
 */
export async function crearVale(input: CrearValeInput, usuarioId: string) {
  let duenoId: string | null = null;
  if (input.fuente === "dueno") {
    // input.duenoId ya viene garantizado por el refine del schema (Task 3).
    const dueno = await getUsuarioById(input.duenoId!);
    if (!dueno || !ROLES_DUENO.has(dueno.rol_nombre)) {
      throw Errors.badRequest("El dueño elegido no es una cuenta Root o Super Root válida");
    }
    duenoId = dueno.id;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const montoEfectivo = input.metodoPago === "mixto" ? input.montoEfectivo : input.metodoPago === "efectivo" ? input.monto : 0;
    const montoBanco = input.metodoPago === "mixto" ? input.montoBanco : input.metodoPago === "banco" ? input.monto : 0;

    const vale = await repo.crearVale(client, {
      pagadoA: input.pagadoA,
      destinatarioUsuarioId: input.destinatarioUsuarioId ?? null,
      destinatarioDocumento: input.destinatarioDocumento ?? null,
      concepto: input.concepto,
      montoEfectivo,
      montoBanco,
      fuente: input.fuente,
      duenoId,
      creadoPorId: usuarioId,
    });

    if (input.fuente === "turno") {
      await cajaService.registrarEgreso(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Vale ${vale.numero} — ${input.concepto}`,
          moduloOrigenSlug: "vales",
          referenciaEntidad: "vales",
          referenciaId: vale.id,
          ...pagoDesdeInput(input),
        },
        usuarioId,
        client,
      );
    } else if (input.fuente === "acumulado") {
      await cajaService.registrarEgresoAcumulado(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Vale ${vale.numero} — ${input.concepto}`,
          referenciaEntidad: "vales",
          referenciaId: vale.id,
          ...pagoDesdeInput(input),
        },
        usuarioId,
        client,
      );
    }
    // fuente === "dueno": no se toca Caja.

    await client.query("COMMIT");
    return repo.getValeById(vale.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Marca un vale (fuente "dueno") como repuesto: genera el egreso real por
 *  el mismo monto/método del vale original, contra turno o acumulado a
 *  elegir en este momento. */
export async function marcarValeRepuesto(id: string, input: ReponerValeInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vale = await repo.getValeParaActualizar(client, id);
    if (!vale) throw Errors.notFound("Vale no encontrado");
    if (vale.fuente !== "dueno") throw Errors.conflict('Solo un vale con fuente "dueño" se puede marcar como repuesto');
    if (vale.repuesto_en) throw Errors.conflict("Este vale ya está repuesto");
    if (vale.anulado_en) throw Errors.conflict("Este vale está anulado");

    const montoEfectivo = Number(vale.monto_efectivo);
    const montoBanco = Number(vale.monto_banco);
    const pago =
      montoEfectivo > 0 && montoBanco > 0
        ? { metodoPago: "mixto" as const, montoEfectivo, montoBanco }
        : montoBanco > 0
          ? { metodoPago: "banco" as const, monto: montoBanco }
          : { metodoPago: "efectivo" as const, monto: montoEfectivo };

    if (input.fuenteReposicion === "turno") {
      await cajaService.registrarEgreso(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Reposición vale ${vale.numero} — ${vale.pagado_a}`,
          moduloOrigenSlug: "vales",
          referenciaEntidad: "vales_reposicion",
          referenciaId: vale.id,
          ...pago,
        },
        usuarioId,
        client,
      );
    } else {
      await cajaService.registrarEgresoAcumulado(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Reposición vale ${vale.numero} — ${vale.pagado_a}`,
          referenciaEntidad: "vales_reposicion",
          referenciaId: vale.id,
          ...pago,
        },
        usuarioId,
        client,
      );
    }

    await repo.marcarRepuesto(client, id, input.fuenteReposicion);

    await client.query("COMMIT");
    return repo.getValeById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Anula un vale: revierte el/los egreso(s) reales que haya generado (al
 *  crearse y/o al reponerse), cada uno en la tabla que le corresponde según
 *  su fuente — turno usa `movimientos_caja`, acumulado usa
 *  `caja_egresos_acumulado`, son mecanismos de reversión distintos. */
export async function anularVale(id: string, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vale = await repo.getValeParaActualizar(client, id);
    if (!vale) throw Errors.notFound("Vale no encontrado");
    if (vale.anulado_en) throw Errors.conflict("Este vale ya está anulado");

    const nota = `Anulación de vale ${vale.numero}`;
    let turnoIdsAfectados: string[] = [];

    if (vale.fuente === "turno") {
      turnoIdsAfectados = await cajaService.anularMovimientosPorReferencia(client, "vales", id, nota, usuarioId);
    } else if (vale.fuente === "acumulado") {
      await cajaService.anularEgresoAcumuladoPorReferencia(client, "vales", id);
    }

    if (vale.repuesto_en) {
      if (vale.fuente_reposicion === "turno") {
        const ids = await cajaService.anularMovimientosPorReferencia(client, "vales_reposicion", id, nota, usuarioId);
        turnoIdsAfectados.push(...ids);
      } else if (vale.fuente_reposicion === "acumulado") {
        await cajaService.anularEgresoAcumuladoPorReferencia(client, "vales_reposicion", id);
      }
    }

    await repo.marcarAnulado(client, id);

    await client.query("COMMIT");
    if (turnoIdsAfectados.length) {
      await cajaService.recalcularCierresSiEstanCerrados([...new Set(turnoIdsAfectados)]);
    }
    return repo.getValeById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sin errores. Si marca algo sobre el tipo de `pagoDesdeInput`, revisar que `CrearValeInput`/`ReponerValeInput` (Task 3) tengan exactamente los campos `metodoPago`/`monto`/`montoEfectivo`/`montoBanco` usados acá.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/vales/vales.service.ts
git commit -m "feat(vales): lógica de negocio (crear, reponer, anular)"
```

---

## Task 6: Backend — controller, routes, y registro en `app.ts`

**Files:**
- Create: `backend/src/modules/vales/vales.controller.ts`
- Create: `backend/src/modules/vales/vales.routes.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `vales.service.ts` (Task 5), `vales.schema.ts` (Task 3).
- Produces: rutas HTTP bajo `/api/v1/vales`.

- [ ] **Step 1: Escribir `vales.controller.ts`**

```typescript
import { Request, Response } from "express";
import { ok, created } from "../../shared/utils/response";
import * as service from "./vales.service";
import { crearValeSchema, reponerValeSchema } from "./vales.schema";

export async function listarValesController(req: Request, res: Response) {
  const fuente = req.query.fuente as string | undefined;
  const estado = req.query.estado as "activo" | "repuesto" | "anulado" | undefined;
  return ok(res, await service.listarVales({ fuente, estado }));
}

export async function obtenerValeController(req: Request, res: Response) {
  return ok(res, await service.obtenerVale(req.params.id));
}

export async function crearValeController(req: Request, res: Response) {
  const data = crearValeSchema.parse(req.body);
  return created(res, await service.crearVale(data, req.auth!.usuarioId));
}

export async function marcarValeRepuestoController(req: Request, res: Response) {
  const data = reponerValeSchema.parse(req.body);
  return ok(res, await service.marcarValeRepuesto(req.params.id, data, req.auth!.usuarioId));
}

export async function anularValeController(req: Request, res: Response) {
  return ok(res, await service.anularVale(req.params.id, req.auth!.usuarioId));
}
```

- [ ] **Step 2: Escribir `vales.routes.ts`**

```typescript
import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  anularValeController,
  crearValeController,
  listarValesController,
  marcarValeRepuestoController,
  obtenerValeController,
} from "./vales.controller";

export const valesRouter = Router();

valesRouter.use(authMiddleware);
valesRouter.use(requirePermission("vales.ver"));

valesRouter.get("/", asyncHandler(listarValesController));
valesRouter.post("/", requirePermission("vales.crear"), asyncHandler(crearValeController));
valesRouter.get("/:id", asyncHandler(obtenerValeController));
valesRouter.post(
  "/:id/reponer",
  requirePermission("vales.marcar_repuesto"),
  asyncHandler(marcarValeRepuestoController),
);
valesRouter.post("/:id/anular", requirePermission("vales.anular"), asyncHandler(anularValeController));
```

- [ ] **Step 3: Registrar el router en `backend/src/app.ts`**

Cambiar la línea `import { velasRouter } from "./modules/velas/velas.routes";` por:

```typescript
import { valesRouter } from "./modules/vales/vales.routes";
import { velasRouter } from "./modules/velas/velas.routes";
```

Y la línea `app.use("/api/v1/pedidos", pedidosRouter);` (la última del bloque de montajes) por:

```typescript
  app.use("/api/v1/pedidos", pedidosRouter);
  app.use("/api/v1/vales", valesRouter);
```

- [ ] **Step 4: Verificar que compila**

```bash
cd backend && npx tsc --noEmit && echo "tsc OK"
```

Esperado: `tsc OK`.

- [ ] **Step 5: Verificación manual end-to-end (levantar el backend)**

```bash
cd backend && npm run dev
```

Con un token de Root y, para la primera prueba, un turno de Caja ya abierto:

```bash
# Crear un vale con fuente "dueno" (no debe tocar Caja)
curl -s -X POST http://localhost:4000/api/v1/vales \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pagadoA":"Juan Pérez","concepto":"Anticipo","fuente":"dueno","duenoId":"<ID_DE_UN_ROOT>","metodoPago":"efectivo","monto":50000}' | jq
```

Esperado: `201`, `data.fuente = "dueno"`, `data.repuesto_en = null`.

```bash
# Marcar como repuesto contra el turno abierto
curl -s -X POST http://localhost:4000/api/v1/vales/<ID>/reponer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fuenteReposicion":"turno"}' | jq
```

Esperado: `200`, `data.repuesto_en` con fecha.

```bash
# Anular (debe revertir la reposición)
curl -s -X POST http://localhost:4000/api/v1/vales/<ID>/anular \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" | jq
```

Esperado: `200`, `data.anulado_en` con fecha. Confirmar en la base que la fila de `movimientos_caja` con `referencia_entidad='vales_reposicion'` y `referencia_id='<ID>'` ya no existe (se borró al anular).

```bash
# duenoId que no es Root/Super Root (ej. un Cajero) — llamando la API directo,
# sin pasar por el selector del frontend (que ya lo filtra, pero el backend
# tiene que rechazarlo igual si alguien llama la API a mano).
curl -s -X POST http://localhost:4000/api/v1/vales \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pagadoA":"Prueba","concepto":"Prueba","fuente":"dueno","duenoId":"<ID_DE_UN_CAJERO>","metodoPago":"efectivo","monto":1000}' | jq
```

Esperado: `400`, mensaje "El dueño elegido no es una cuenta Root o Super Root válida" — y ningún vale creado.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/vales/vales.controller.ts backend/src/modules/vales/vales.routes.ts backend/src/app.ts
git commit -m "feat(vales): endpoints HTTP"
```

---

## Task 7: Frontend — `api.ts`

**Files:**
- Create: `frontend/src/modules/vales/api.ts`

**Interfaces:**
- Consumes: `shared/api/client.ts::apiFetch`.
- Produces: `valesApi` y los tipos `Vale`, `CrearValeInput`, `ReponerValeInput` — los usan las Tasks 8-10.

- [ ] **Step 1: Escribir el archivo completo**

```typescript
import { apiFetch } from "../../shared/api/client";

export type FuenteVale = "turno" | "acumulado" | "dueno";

export interface Vale {
  id: string;
  numero: string;
  pagado_a: string;
  destinatario_usuario_id: string | null;
  destinatario_usuario_nombre: string | null;
  destinatario_documento: string | null;
  concepto: string;
  monto_efectivo: string;
  monto_banco: string;
  fuente: FuenteVale;
  dueno_id: string | null;
  dueno_nombre: string | null;
  repuesto_en: string | null;
  fuente_reposicion: FuenteVale | null;
  anulado_en: string | null;
  creado_por_nombre: string | null;
  created_at: string;
}

// Mismo shape que descomponerPago espera del lado del backend — nunca se
// manda referenciaBanco (esa regla es solo para pagos recibidos).
export type PagoValeInput =
  | { metodoPago: "efectivo" | "banco"; monto: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

export type CrearValeInput = {
  pagadoA: string;
  destinatarioUsuarioId?: string;
  destinatarioDocumento?: string;
  concepto: string;
  fuente: FuenteVale;
  duenoId?: string;
} & PagoValeInput;

export interface ReponerValeInput {
  fuenteReposicion: "turno" | "acumulado";
}

export const valesApi = {
  listar: (filtros?: { fuente?: FuenteVale; estado?: "activo" | "repuesto" | "anulado" }) => {
    const params = new URLSearchParams();
    if (filtros?.fuente) params.set("fuente", filtros.fuente);
    if (filtros?.estado) params.set("estado", filtros.estado);
    const qs = params.toString();
    return apiFetch<Vale[]>(`/vales${qs ? `?${qs}` : ""}`);
  },
  obtener: (id: string) => apiFetch<Vale>(`/vales/${id}`),
  crear: (input: CrearValeInput) => apiFetch<Vale>("/vales", { method: "POST", body: input }),
  marcarRepuesto: (id: string, input: ReponerValeInput) =>
    apiFetch<Vale>(`/vales/${id}/reponer`, { method: "POST", body: input }),
  anular: (id: string) => apiFetch<Vale>(`/vales/${id}/anular`, { method: "POST" }),
};
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b && echo "tsc OK"
```

Esperado: `tsc OK`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/api.ts
git commit -m "feat(vales): cliente API del frontend"
```

---

## Task 8: Frontend — `ValesPage.tsx` (listado)

**Files:**
- Create: `frontend/src/modules/vales/pages/ValesPage.tsx`

**Interfaces:**
- Consumes: `valesApi` (Task 7), `shared/format/money::formatMoney`, `shared/refresh/RefrescoContext::useRegistrarRefresco`.
- Produces: la pantalla que se monta en `/vales` (ruta la agrega Task 11).

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type FuenteVale, type Vale } from "../api";
import { NuevoValeModal } from "../components/NuevoValeModal";

const POLL_MS = 20000;

const LABEL_FUENTE: Record<FuenteVale, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

const FILTROS_FUENTE: { valor: FuenteVale | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas las fuentes" },
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Acumulado" },
  { valor: "dueno", etiqueta: "Bolsillo de dueño" },
];

const FILTROS_ESTADO: { valor: "todos" | "activo" | "repuesto" | "anulado"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activo", etiqueta: "Activos" },
  { valor: "repuesto", etiqueta: "Repuestos" },
  { valor: "anulado", etiqueta: "Anulados" },
];

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function estadoVale(v: Vale): "activo" | "repuesto" | "anulado" {
  if (v.anulado_en) return "anulado";
  if (v.repuesto_en) return "repuesto";
  return "activo";
}

const ESTILO_ESTADO: Record<"activo" | "repuesto" | "anulado", string> = {
  activo: "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla",
  repuesto: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  anulado: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

export function ValesPage() {
  const [vales, setVales] = useState<Vale[]>([]);
  const [filtroFuente, setFiltroFuente] = useState<FuenteVale | "todas">("todas");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "activo" | "repuesto" | "anulado">("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  async function cargar() {
    try {
      setVales(
        await valesApi.listar({
          fuente: filtroFuente === "todas" ? undefined : filtroFuente,
          estado: filtroEstado === "todos" ? undefined : filtroEstado,
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los vales");
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
  }, [filtroFuente, filtroEstado]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Vales</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Comprobantes de dinero ya entregado, con su fuente de fondos.
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo vale
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={filtroFuente}
          onChange={(e) => setFiltroFuente(e.target.value as FuenteVale | "todas")}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          {FILTROS_FUENTE.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </select>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as "todos" | "activo" | "repuesto" | "anulado")}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          {FILTROS_ESTADO.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : vales.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          No hay vales en este filtro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Pagado a</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Fuente</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {vales.map((v) => {
                const estado = estadoVale(v);
                const monto = Number(v.monto_efectivo) + Number(v.monto_banco);
                return (
                  <tr key={v.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">
                      <Link to={`/vales/${v.id}`} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                        {v.numero}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{v.pagado_a}</td>
                    <td className="px-3 py-2">{formatearFechaHora(v.created_at)}</td>
                    <td className="px-3 py-2">{LABEL_FUENTE[v.fuente]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[estado]}`}>{estado}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(monto)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevoValeModal
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

Esperado: falla porque `NuevoValeModal` todavía no existe (Task 9) — esto es esperado en este punto del plan, no es un error a corregir acá. Seguir a la Task 9.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/pages/ValesPage.tsx
git commit -m "feat(vales): listado de vales (WIP — falta NuevoValeModal)"
```

---

## Task 9: Frontend — `NuevoValeModal.tsx`

**Files:**
- Create: `frontend/src/modules/vales/components/NuevoValeModal.tsx`

**Interfaces:**
- Consumes: `valesApi.crear` (Task 7), `shared/components/{Modal, SelectorMetodoPago}`, `general/api.ts::{usuariosApi, Usuario}`.
- Produces: el modal que usa `ValesPage.tsx` (Task 8).

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { usuariosApi, type Usuario } from "../../general/api";
import { valesApi, type FuenteVale } from "../api";

interface NuevoValeModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

const ROLES_DUENO = new Set(["Root", "Super Root"]);

const FUENTES: { valor: FuenteVale; etiqueta: string }[] = [
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Cuenta general (acumulado)" },
  { valor: "dueno", etiqueta: "Bolsillo de un dueño" },
];

export function NuevoValeModal({ onCerrar, onCreado }: NuevoValeModalProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [pagadoA, setPagadoA] = useState("");
  const [destinatarioUsuarioId, setDestinatarioUsuarioId] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fuente, setFuente] = useState<FuenteVale>("turno");
  const [duenoId, setDuenoId] = useState("");
  // Como no hay referenciaBanco en un vale, no se usa MetodoPagoValor.referenciaBanco,
  // pero sí se necesita el monto para efectivo/banco puro (SelectorMetodoPago
  // no lo trae incluido — ver EgresoModal.tsx, mismo patrón).
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [monto, setMonto] = useState(0);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usuariosApi.listar().then(setUsuarios).catch(() => {});
  }, []);

  const duenosDisponibles = usuarios.filter((u) => ROLES_DUENO.has(u.rol_nombre));
  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  // Mismo criterio que EgresoModal.tsx (el precedente real de egresos): nunca
  // se valida faltaReferenciaBanco acá — con pedirReferenciaBanco={false} esa
  // función igual exigiría una referencia que la UI ni siquiera muestra.
  const puedeGuardar =
    pagadoA.trim().length > 0 &&
    concepto.trim().length > 0 &&
    (pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0) &&
    (fuente !== "dueno" || duenoId.length > 0);

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await valesApi.crear({
        pagadoA: pagadoA.trim(),
        destinatarioUsuarioId: destinatarioUsuarioId || undefined,
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        concepto: concepto.trim(),
        fuente,
        duenoId: fuente === "dueno" ? duenoId : undefined,
        ...(pago.metodoPago === "mixto"
          ? { metodoPago: "mixto", montoEfectivo: pago.montoEfectivo, montoBanco: pago.montoBanco }
          : { metodoPago: pago.metodoPago, monto }),
      });
      await onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el vale");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo vale" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Pagado a / Para</label>
          <input value={pagadoA} onChange={(e) => setPagadoA(e.target.value)} className={INPUT_CLASE} autoFocus />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Vincular a un usuario existente (opcional)</label>
            <select value={destinatarioUsuarioId} onChange={(e) => setDestinatarioUsuarioId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin vincular</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Documento (opcional)</label>
            <input value={destinatarioDocumento} onChange={(e) => setDestinatarioDocumento(e.target.value)} className={INPUT_CLASE} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">Por concepto de</label>
          <textarea value={concepto} onChange={(e) => setConcepto(e.target.value)} rows={2} className={`${INPUT_CLASE} resize-y`} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">¿De dónde sale el dinero?</label>
          <select value={fuente} onChange={(e) => setFuente(e.target.value as FuenteVale)} className={INPUT_CLASE}>
            {FUENTES.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </div>

        {fuente === "dueno" && (
          <div>
            <label className="mb-1 block text-xs font-medium">¿Cuál dueño?</label>
            <select value={duenoId} onChange={(e) => setDuenoId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Elige un dueño</option>
              {duenosDisponibles.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium">Valor</label>
          {pago.metodoPago !== "mixto" && (
            <input
              type="number"
              value={monto || ""}
              onChange={(e) => setMonto(Number(e.target.value))}
              placeholder="Monto"
              className={`${INPUT_CLASE} mb-2`}
            />
          )}
          <SelectorMetodoPago value={pago} onChange={setPago} pedirReferenciaBanco={false} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando || !puedeGuardar}
          className="rounded-md bg-brand-green-700 px-4 py-3 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : "Crear vale"}
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

Esperado: solo debe faltar `DetalleValePage` (react-router-dom no valida rutas en tiempo de compilación — el error pendiente real es que `/vales/:id` no tiene ruta registrada todavía, eso es Task 11). `SelectorMetodoPago`/`MetodoPagoValor` ya existen tal cual se usan acá (verificado contra `frontend/src/shared/components/SelectorMetodoPago.tsx` real) — no se tocan en este plan.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/components/NuevoValeModal.tsx
git commit -m "feat(vales): modal de nuevo vale"
```

---

## Task 10: Frontend — `DetalleValePage.tsx`

**Files:**
- Create: `frontend/src/modules/vales/pages/DetalleValePage.tsx`

**Interfaces:**
- Consumes: `valesApi` (Task 7), `shared/components/{Modal, BotonVolver}`.
- Produces: la pantalla que se monta en `/vales/:id` (ruta la agrega Task 11).

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type Vale } from "../api";

const LABEL_FUENTE: Record<string, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DetalleValePage() {
  const { id } = useParams<{ id: string }>();
  const [vale, setVale] = useState<Vale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [fuenteReposicion, setFuenteReposicion] = useState<"turno" | "acumulado">("turno");
  const [pidiendoReposicion, setPidiendoReposicion] = useState(false);

  async function cargar() {
    if (!id) return;
    try {
      setVale(await valesApi.obtener(id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el vale");
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRegistrarRefresco(cargar);

  async function reponer() {
    if (!id) return;
    setProcesando(true);
    setError(null);
    try {
      await valesApi.marcarRepuesto(id, { fuenteReposicion });
      setPidiendoReposicion(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar como repuesto");
    } finally {
      setProcesando(false);
    }
  }

  async function anular() {
    if (!id) return;
    const aviso = vale?.repuesto_en
      ? "Este vale ya está repuesto — anularlo revierte TANTO el egreso original como el de la reposición. ¿Anular igual?"
      : "¿Anular este vale? Si ya generó un egreso en Caja, se revierte.";
    if (!confirm(aviso)) return;
    setProcesando(true);
    setError(null);
    try {
      await valesApi.anular(id);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo anular el vale");
    } finally {
      setProcesando(false);
    }
  }

  if (error && !vale) return <p className="text-sm text-red-600">{error}</p>;
  if (!vale) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const monto = Number(vale.monto_efectivo) + Number(vale.monto_banco);
  const puedeReponer = vale.fuente === "dueno" && !vale.repuesto_en && !vale.anulado_en;
  const puedeAnular = !vale.anulado_en;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/vales" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Vale {vale.numero}</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          {formatearFechaHora(vale.created_at)}
          {vale.anulado_en && <span className="ml-2 font-semibold text-red-600">· ANULADO</span>}
          {vale.repuesto_en && !vale.anulado_en && <span className="ml-2 font-semibold text-blue-600">· Repuesto</span>}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-brand-vanilla-dark p-4 text-sm dark:border-brand-green-700">
          <p><span className="font-semibold">Pagado a:</span> {vale.pagado_a}</p>
          {vale.destinatario_usuario_nombre && <p><span className="font-semibold">Usuario vinculado:</span> {vale.destinatario_usuario_nombre}</p>}
          {vale.destinatario_documento && <p><span className="font-semibold">Documento:</span> {vale.destinatario_documento}</p>}
          <p><span className="font-semibold">Concepto:</span> {vale.concepto}</p>
          <p><span className="font-semibold">Monto:</span> {formatMoney(monto)}</p>
          <p><span className="font-semibold">Fuente:</span> {LABEL_FUENTE[vale.fuente]}</p>
          {vale.fuente === "dueno" && vale.dueno_nombre && <p><span className="font-semibold">Dueño:</span> {vale.dueno_nombre}</p>}
          {vale.creado_por_nombre && <p><span className="font-semibold">Registrado por:</span> {vale.creado_por_nombre}</p>}
        </div>

        <div className="flex flex-col gap-3">
          {puedeReponer && (
            <div className="rounded-lg border border-blue-300 p-3 dark:border-blue-700">
              {!pidiendoReposicion ? (
                <button
                  onClick={() => setPidiendoReposicion(true)}
                  disabled={procesando}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Marcar como repuesto
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium">¿Con qué se le repone al dueño?</label>
                  <select
                    value={fuenteReposicion}
                    onChange={(e) => setFuenteReposicion(e.target.value as "turno" | "acumulado")}
                    className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                  >
                    <option value="turno">Turno abierto</option>
                    <option value="acumulado">Acumulado</option>
                  </select>
                  <button
                    onClick={reponer}
                    disabled={procesando}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {procesando ? "Procesando..." : "Confirmar reposición"}
                  </button>
                </div>
              )}
            </div>
          )}

          {puedeAnular && (
            <button
              onClick={anular}
              disabled={procesando}
              className="rounded-md border border-red-400 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/30"
            >
              Anular vale
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

Esperado: sin errores nuevos propios de este archivo (el router sigue sin tener la ruta `/vales/:id`, eso se resuelve en Task 11).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/pages/DetalleValePage.tsx
git commit -m "feat(vales): pantalla de detalle (reponer, anular)"
```

---

## Task 11: Impresión + rutas + botón del header + verificación final

**Files:**
- Modify: `frontend/src/shared/components/ReciboImprimible.tsx`
- Create: `frontend/src/modules/vales/factura.ts`
- Modify: `frontend/src/modules/vales/pages/DetalleValePage.tsx`
- Modify: `frontend/src/shared/layout/AppShell.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `DetalleValePage` (Task 10), `ValesPage` (Task 8), `shared/components/ModalImprimir`.
- Produces: la app completa y navegable, con impresión de vale.

- [ ] **Step 1: Agregar el tipo `"vale"` a `ReciboImprimible.tsx`**

Cambiar la línea del `tipo` en `ReciboImprimibleProps` (buscar `tipo: "factura" | "cotizacion" | "movimiento" | "resumen" | "comprobante_propina";`):

```typescript
  tipo: "factura" | "cotizacion" | "movimiento" | "resumen" | "comprobante_propina" | "vale";
```

Buscar `const esComprobantePropina = tipo === "comprobante_propina";` y agregar justo debajo:

```typescript
  const esVale = tipo === "vale";
```

Cambiar la línea `const esLineaUnica = esMovimiento || esComprobantePropina;` por:

```typescript
  const esLineaUnica = esMovimiento || esComprobantePropina || esVale;
```

Cambiar el bloque de `franjaTexto` (buscar `: esComprobantePropina`) agregando el caso de vale antes del `: esMovimiento`:

```typescript
  const franjaTexto = esCotizacion
    ? "COTIZACIÓN — NO es una factura de venta"
    : esResumen
      ? "RESUMEN DE CAJA"
      : esComprobantePropina
        ? "COMPROBANTE DE ENTREGA DE PROPINA"
        : esVale
          ? "VALE"
          : esMovimiento
            ? esEgreso
              ? "COMPROBANTE DE EGRESO"
              : "COMPROBANTE DE INGRESO"
            : "FACTURA DE VENTA";
```

Cambiar el bloque de `tituloDocumento` igual, agregando el caso de vale:

```typescript
  const tituloDocumento = esCotizacion
    ? "Cotización"
    : esComprobantePropina
      ? "Comprobante de propina"
      : esVale
        ? "Vale"
        : esMovimiento
          ? "Comprobante"
          : esResumen
            ? null
            : "Factura";
```

Cambiar `{esComprobantePropina && (` (el bloque de la firma) por:

```tsx
      {(esComprobantePropina || esVale) && (
        <div className="mt-6 text-[16px]">
          <div className="border-t border-black pt-1 text-center">Firma de quien recibe</div>
          <div className="mt-1 text-center text-[13px]">C.C.: _______________________</div>
        </div>
      )}
```

Y cambiar la línea `: esMovimiento || esResumen || esComprobantePropina` (el pie de página "Documento interno") por:

```typescript
          : esMovimiento || esResumen || esComprobantePropina || esVale
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b && echo "tsc OK"
```

Esperado: `tsc OK`.

- [ ] **Step 3: Escribir `frontend/src/modules/vales/factura.ts`**

```typescript
import type { ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import type { Vale } from "./api";

const LABEL_FUENTE: Record<string, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

/** Traduce un vale al formato genérico que espera `ReciboImprimible` — mismo
 *  patrón que `migao/factura.ts::entregaPropinaAReciboProps` (también de una
 *  sola línea, con espacio de firma). */
export function valeAReciboProps(vale: Vale): Omit<ReciboImprimibleProps, "anchoMm"> {
  const camposEncabezado: { etiqueta: string; valor: string }[] = [
    { etiqueta: "Pagado a", valor: vale.pagado_a },
  ];
  if (vale.destinatario_documento) camposEncabezado.push({ etiqueta: "Documento", valor: vale.destinatario_documento });
  camposEncabezado.push({ etiqueta: "Fuente", valor: LABEL_FUENTE[vale.fuente] ?? vale.fuente });
  if (vale.creado_por_nombre) camposEncabezado.push({ etiqueta: "Registrado por", valor: vale.creado_por_nombre });

  const montoEfectivo = Number(vale.monto_efectivo);
  const montoBanco = Number(vale.monto_banco);
  const total = montoEfectivo + montoBanco;

  return {
    tipo: "vale",
    folio: vale.numero,
    fecha: vale.created_at,
    camposEncabezado,
    items: [{ nombre: vale.concepto, cantidad: 1, precioUnitario: total, subtotal: total }],
    total,
    pagos: [
      ...(montoEfectivo > 0 ? [{ metodoPago: "efectivo", monto: montoEfectivo }] : []),
      ...(montoBanco > 0 ? [{ metodoPago: "banco", monto: montoBanco }] : []),
    ],
  };
}
```

- [ ] **Step 4: Agregar el botón de imprimir en `DetalleValePage.tsx`**

Agregar los imports junto a los demás:

```tsx
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { valeAReciboProps } from "../factura";
```

Agregar un estado nuevo junto a los demás `useState`:

```tsx
  const [imprimiendo, setImprimiendo] = useState(false);
```

Agregar el botón "Imprimir" en el header (justo después del párrafo de fecha/estado, dentro del primer `<div>` del return):

```tsx
        <button
          onClick={() => setImprimiendo(true)}
          className="mt-2 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        >
          🖨️ Imprimir vale
        </button>
```

Y, justo antes del `</div>` final que cierra el componente (después del `</div>` que cierra el `grid`), agregar:

```tsx
      {imprimiendo && <ModalImprimir {...valeAReciboProps(vale)} onCerrar={() => setImprimiendo(false)} />}
```

- [ ] **Step 5: Botón en el header global (`AppShell.tsx`)**

`tieneAccesoTotal` ya está importado en este archivo (línea 6: `import { tieneAccesoTotal } from "../auth/roles";`) — no agregar ese import de nuevo.

Cambiar la línea 2 (el único import de `react-router-dom` del archivo):

```tsx
import { Outlet } from "react-router-dom";
```

por:

```tsx
import { Link, Outlet } from "react-router-dom";
```

El usuario pidió el botón de Vales **junto al botón de mensajes del bot** (`BotonLeadExterno`) — buscar esta línea exacta dentro del `<div className="flex shrink-0 items-center gap-2 text-sm">` del header:

```tsx
            <BotonLeadExterno />
```

y agregar justo después:

```tsx
            <BotonLeadExterno />
            {tieneAccesoTotal(usuario.rol) && (
              <Link
                to="/vales"
                aria-label="Vales"
                title="Vales"
                className="flex items-center justify-center rounded-md p-1.5 text-lg text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                🧾
              </Link>
            )}
```

- [ ] **Step 6: Rutas en `App.tsx`**

Agregar los imports justo antes de `import { RequireAuth } from "./shared/auth/RequireAuth";`:

```tsx
import { DetalleValePage } from "./modules/vales/pages/DetalleValePage";
import { ValesPage } from "./modules/vales/pages/ValesPage";
```

Y las rutas, después de la línea `<Route path="/pedidos/:id" element={<DetallePedidoPage />} />`:

```tsx
        <Route path="/pedidos/:id" element={<DetallePedidoPage />} />
        <Route path="/vales" element={<ValesPage />} />
        <Route path="/vales/:id" element={<DetalleValePage />} />
```

- [ ] **Step 7: Verificar que compila todo**

```bash
cd frontend && npx tsc -b && npm run build && cd ../backend && npx tsc --noEmit && echo "tsc OK (frontend + backend)"
```

Esperado: build exitoso, `tsc OK (frontend + backend)`.

- [ ] **Step 8: Verificación manual end-to-end completa**

Con ambos servidores corriendo, logueado como Root o Super Root:

1. El ícono 🧾 debe aparecer en el header en cualquier pantalla; no debe aparecer logueado como Cajero/Administrador.
2. Ir a Vales → "+ Nuevo vale" → crear uno con fuente "Turno abierto" (con un turno ya abierto) → confirmar que aparece en el listado y que generó un movimiento en Caja General con motivo que empieza por "Vale V-...".
3. Crear otro con fuente "Cuenta general (acumulado)", método mixto (parte efectivo, parte banco) → confirmar en la base que se insertaron 2 filas en `caja_egresos_acumulado` con el mismo `referencia_id`.
4. Anular el vale del paso 3 (fuente acumulado) → confirmar que las 2 filas de `caja_egresos_acumulado` con ese `referencia_id` ya no existen, y que **no** se tocó ninguna fila de `movimientos_caja` (ese vale nunca generó ninguna) — este es el caso que mezcla las dos tablas de reversión distintas; si por error se hubiera llamado `anularMovimientosPorReferencia` en vez de `anularEgresoAcumuladoPorReferencia`, este paso no revertiría nada y lo mostraría.
5. Crear otro con fuente "Bolsillo de un dueño" → confirmar que NO generó ningún movimiento en Caja (ni en `movimientos_caja` ni en `caja_egresos_acumulado`).
6. Sobre ese último, "Marcar como repuesto" contra el turno abierto → confirmar que ahora sí aparece el egreso de reposición en Caja General, con motivo que empieza por "Reposición vale V-...".
7. Anular el vale del paso 2 (fuente turno) → confirmar que el movimiento de Caja General que generó ya no aparece en el historial de ese turno.
8. Anular el vale del paso 6 (ya repuesto) → confirmar que se revierten TANTO el egreso original (que nunca existió, fuente dueño) como el de la reposición — el vale queda anulado sin dejar ningún movimiento vivo en Caja.
9. Cerrar el turno abierto y, sin abrir uno nuevo: (a) intentar crear un vale con fuente "Turno abierto" → debe rechazarse con "No hay un turno de caja abierto"; (b) crear un vale con fuente "Bolsillo de un dueño" y de inmediato intentar "Marcar como repuesto" eligiendo "Turno abierto" como fuente de reposición → debe rechazarse con el mismo mensaje (confirma que `marcarValeRepuesto`'s rama "turno" exige turno abierto igual que crear). Volver a abrir un turno después de esta prueba para los pasos siguientes.
10. Imprimir un vale desde el detalle → confirmar que el recibo muestra "VALE", el número, pagado a, concepto, monto, fuente, y el espacio de firma al final.
11. Loguearse como Cajero o Administrador y confirmar que `/vales` devuelve 403 (o que el ícono del header ni siquiera aparece).
12. Abrir un turno nuevo, crear un vale con fuente "Turno abierto", y **cerrar ese turno** (con el vale todavío vigente, sin anular). Anotar el total de egresos que muestra el cierre. Anular el vale → confirmar que el cierre de ese turno (ya cerrado) se recalculó: su total de egresos debe bajar exactamente por el monto del vale anulado (`cajaService.recalcularCierresSiEstanCerrados` corre después del commit, para cualquier turno cerrado que haya quedado involucrado — si esto no corriera, el cierre quedaría con cifras viejas que no cuadran contra `movimientos_caja`).

- [ ] **Step 9: Commit y push final**

```bash
git add frontend/src/shared/components/ReciboImprimible.tsx frontend/src/modules/vales/factura.ts \
        frontend/src/modules/vales/pages/DetalleValePage.tsx frontend/src/shared/layout/AppShell.tsx frontend/src/App.tsx
git commit -m "feat(vales): impresión, botón del header, rutas — módulo completo y navegable"
git push
```
