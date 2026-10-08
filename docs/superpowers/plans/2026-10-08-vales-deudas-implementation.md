# Vales — Extensión "Deudas" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ampliar el módulo Vales (ya implementado y en producción) con un segundo tipo de vale, "deuda" — dinero que un empleado o cliente le debe al negocio, en vez de dinero que ya salió — con o sin préstamo inicial, y su propio cobro.

**Architecture:** Extiende la tabla `vales` existente (nuevas columnas, sin tabla nueva) y los 5 archivos del módulo backend más los 5 del frontend que ya existen, reutilizando toda la infraestructura de Caja General ya probada (`registrarEgreso`/`registrarEgresoAcumulado`/`registrarIngreso`/`anularMovimientosPorReferencia`/`anularEgresoAcumuladoPorReferencia`/`recalcularCierresSiEstanCerrados`).

**Tech Stack:** MySQL 8 (dialecto Postgres vía shim), Express, Zod, React, Vite.

**Spec:** `docs/superpowers/specs/2026-10-08-vales-deudas-design.md`

## Global Constraints

- Una deuda nunca es de un dueño (los dueños financian, no deben) — solo empleados o clientes.
- Con préstamo: puede salir de turno, acumulado, o bolsillo de un dueño (mismas 3 fuentes que un pago). Sin préstamo: no toca Caja en absoluto.
- Cobrar siempre exige turno abierto — no existe "ingreso acumulado" en este sistema y esta extensión no lo construye.
- El cobro es siempre completo, de una sola vez — no hay abonos parciales.
- El monto a cobrar no es editable por quien cobra; solo el método de pago.
- Cobrar una deuda SÍ exige `referenciaBanco` cuando hay banco de por medio (es un ingreso — al revés que crear un vale, que nunca la exige porque siempre es un egreso).
- Anular una deuda revierte hasta 3 cosas (préstamo, reposición, cobro), cada una si llegó a ocurrir.
- Sin framework de tests en este repo — verificación vía `tsc --noEmit`/`tsc -b` + lectura manual del código, igual que el resto de este proyecto. Sin base de datos alcanzable en el entorno de ejecución de esta sesión — toda verificación con curl/DB real queda para que el usuario la corrobore en su propio entorno.

**Hallazgo relacionado, fuera de alcance de este plan:** `cajaService.registrarIngreso`/`registrarIngresoSchema` (caja.schema.ts/caja.service.ts) todavía aceptan `referenciaEntidad`/`referenciaId` dentro del body público de `POST /caja/ingresos` — la misma clase de problema que se corrigió para `registrarEgreso` tras la revisión del módulo Vales original (ver `caja.service.ts::ReferenciaEgreso`), pero nunca se corrigió del lado de ingresos. Corregirlo de verdad implica tocar 8 llamadores en `pedidos.service.ts`, `con_sentido.service.ts` y `migao.service.ts` — alcance mucho mayor al de esta extensión. Este plan NO lo corrige (es un problema preexistente, no introducido por "Deudas"), pero la función `cobrarVale` que este plan agrega llama a `registrarIngreso` directo desde el servidor (nunca deja que el cliente fije `referenciaEntidad`), así que el código nuevo en sí no es explotable — infórmaselo al usuario como hallazgo aparte al presentar este plan.

## Review Focus

- **Crear una deuda sin fuente y sin `montoAdeudado`** (ninguna de las dos ramas del Zod union se cumple): debe rechazarse con un 400 claro de Zod, no un 500 opaco ni un vale a medio crear.
- **Cobrar un monto que no coincide con lo adeudado** (de más o de menos): el backend debe rechazarlo — nunca confiar en que el formulario mande el total correcto, mismo criterio ya aplicado a `referenciaEntidad`/`referenciaId` tras la revisión del módulo original.
- **Anular una deuda que generó préstamo Y ya fue cobrada**: debe revertir AMBOS movimientos (el préstamo original Y el cobro), no solo el primero que encuentre.
- **Cobrar sin turno abierto**: debe fallar con el mismo mensaje de siempre ("No hay un turno de caja abierto"), no un error distinto ni una deuda marcada cobrada a medias.
- **Cobrar con banco de por medio, sin `referenciaBanco`**: a diferencia de crear un vale (que NUNCA la exige), cobrar SÍ debe exigirla — es un ingreso, no un egreso.

---

## Task 1: Base de datos — ALTER TABLE vales + permiso nuevo

**Files:**
- Create: `database/mysql/migraciones/2026-10-08_vales_deudas.sql`
- Modify: `database/mysql/schema.sql`
- Modify: `database/seed.sql`

**Interfaces:**
- Produces: columnas `tipo`, `monto_adeudado`, `cobrado_en`, `monto_cobrado_efectivo`, `monto_cobrado_banco` en `vales`; `fuente` pasa a NULL-able; permiso `vales.marcar_cobrado` (Root/Super Root).

- [ ] **Step 1: Escribir la migración incremental**

Crear `database/mysql/migraciones/2026-10-08_vales_deudas.sql`:

```sql
-- ============================================================================
-- Módulo Vales — extensión "Deudas" (dinero que un empleado o cliente le
-- debe al negocio, con o sin préstamo inicial) — ver
-- docs/superpowers/specs/2026-10-08-vales-deudas-design.md
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE vales
  MODIFY COLUMN fuente VARCHAR(20) NULL,
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'pago' AFTER numero,
  ADD COLUMN monto_adeudado DECIMAL(12,2) NULL AFTER monto_banco,
  ADD COLUMN cobrado_en DATETIME(6) NULL AFTER fuente_reposicion,
  ADD COLUMN monto_cobrado_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cobrado_en,
  ADD COLUMN monto_cobrado_banco DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER monto_cobrado_efectivo;

-- Las dos restricciones originales sin nombre explícito (MySQL las nombró
-- automáticamente vales_chk_1/vales_chk_2, por orden de aparición en el
-- CREATE TABLE original) ya no son correctas: `fuente` ahora puede ser NULL
-- (deuda sin préstamo), y en ese caso monto_efectivo+monto_banco en 0 es
-- válido. Si alguno de estos DROP falla con "check constraint does not
-- exist", el nombre real es distinto al esperado — consulta
-- information_schema.TABLE_CONSTRAINTS (columna CONSTRAINT_NAME, filtrando
-- TABLE_NAME='vales' y CONSTRAINT_TYPE='CHECK') para encontrar el nombre
-- real antes de reintentar. Es un fallo ruidoso y recuperable, nunca
-- silencioso.
ALTER TABLE vales DROP CONSTRAINT vales_chk_1;
ALTER TABLE vales DROP CONSTRAINT vales_chk_2;

ALTER TABLE vales
  ADD CONSTRAINT chk_vales_tipo CHECK (tipo IN ('pago','deuda')),
  ADD CONSTRAINT chk_vales_fuente CHECK (fuente IS NULL OR fuente IN ('turno','acumulado','dueno')),
  ADD CONSTRAINT chk_vales_fuente_null_solo_deuda CHECK (fuente IS NOT NULL OR tipo = 'deuda'),
  ADD CONSTRAINT chk_vales_monto_pago CHECK (fuente IS NULL OR monto_efectivo + monto_banco > 0),
  ADD CONSTRAINT chk_vales_monto_adeudado CHECK (fuente IS NOT NULL OR (monto_adeudado IS NOT NULL AND monto_adeudado > 0)),
  ADD CONSTRAINT chk_vales_cobro_solo_deuda CHECK (cobrado_en IS NULL OR tipo = 'deuda'),
  ADD CONSTRAINT chk_vales_monto_cobrado CHECK (cobrado_en IS NULL OR monto_cobrado_efectivo + monto_cobrado_banco > 0);

CREATE INDEX idx_vales_tipo ON vales(tipo);

-- --- Permiso nuevo ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_cobrado', 'vales.marcar_cobrado'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = 'vales.marcar_cobrado');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'vales.marcar_cobrado'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
```

- [ ] **Step 2: Reflejar lo mismo en `database/mysql/schema.sql` (instalación nueva)**

Buscar el `CREATE TABLE vales (...)` completo (sección "7.1 MODULO VALES") y reemplazarlo por:

```sql
CREATE TABLE vales (
  id                        CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  numero                    VARCHAR(20) NOT NULL UNIQUE,
  tipo                      VARCHAR(20) NOT NULL DEFAULT 'pago',
  pagado_a                  VARCHAR(150) NOT NULL,
  -- Enganche opcional a futuro (módulo de nóminas) — "pagado_a" sigue siendo
  -- el dato real, esto nunca lo reemplaza.
  destinatario_usuario_id   CHAR(36) NULL,
  destinatario_documento    VARCHAR(30) NULL,
  concepto                  TEXT NOT NULL,
  monto_efectivo            DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_banco               DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- Solo para tipo='deuda' SIN préstamo inicial (fuente=NULL) — cuánto debe,
  -- independiente de cómo se vaya a pagar después.
  monto_adeudado            DECIMAL(12,2) NULL,
  -- NULL = deuda sin préstamo inicial (nunca tocó Caja); solo válido si tipo='deuda'.
  fuente                    VARCHAR(20) NULL,
  dueno_id                  CHAR(36) NULL,
  repuesto_en               DATETIME(6) NULL,
  fuente_reposicion         VARCHAR(20) NULL,
  -- Cuándo (y con qué método) se cobró una deuda — siempre contra el turno
  -- abierto, no existe "ingreso acumulado" en este sistema.
  cobrado_en                DATETIME(6) NULL,
  monto_cobrado_efectivo    DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_cobrado_banco       DECIMAL(12,2) NOT NULL DEFAULT 0,
  anulado_en                DATETIME(6) NULL,
  creado_por_id             CHAR(36) NOT NULL,
  created_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (destinatario_usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (dueno_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (tipo IN ('pago','deuda')),
  CHECK (fuente IS NULL OR fuente IN ('turno','acumulado','dueno')),
  CHECK (fuente IS NOT NULL OR tipo = 'deuda'),
  CHECK (fuente IS NULL OR monto_efectivo + monto_banco > 0),
  CHECK (fuente IS NOT NULL OR (monto_adeudado IS NOT NULL AND monto_adeudado > 0)),
  CHECK (fuente != 'dueno' OR dueno_id IS NOT NULL),
  CHECK (cobrado_en IS NULL OR tipo = 'deuda'),
  CHECK (cobrado_en IS NULL OR monto_cobrado_efectivo + monto_cobrado_banco > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_vales_fuente ON vales(fuente);
CREATE INDEX idx_vales_dueno ON vales(dueno_id);
CREATE INDEX idx_vales_tipo ON vales(tipo);
```

- [ ] **Step 3: Agregar el permiso a `database/seed.sql` (instalación nueva)**

Buscar el bloque de 4 permisos `vales.*` ya agregados (termina en `((SELECT id FROM modulos WHERE slug = 'vales'), 'anular', 'vales.anular');`) y cambiar el `;` final por `,` agregando la quinta fila:

```sql
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'ver',             'vales.ver'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'crear',           'vales.crear'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_repuesto', 'vales.marcar_repuesto'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'anular',          'vales.anular'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_cobrado',  'vales.marcar_cobrado');
```

No hace falta ningún otro cambio en `seed.sql` — Super Root/Root siguen tomando todos los permisos automáticamente (ver comentario ya existente justo arriba de este bloque).

- [ ] **Step 4: Verificar consistencia**

```bash
cd /Users/alejandroramos/Desktop/sistemapos/ConSentido && grep -q "vales.marcar_cobrado" database/mysql/migraciones/2026-10-08_vales_deudas.sql && grep -q "vales.marcar_cobrado" database/seed.sql && grep -q "ADD COLUMN monto_adeudado" database/mysql/migraciones/2026-10-08_vales_deudas.sql && grep -q "monto_adeudado" database/mysql/schema.sql && echo "consistencia SQL OK"
```

Esperado: `consistencia SQL OK`.

- [ ] **Step 5: Commit**

```bash
git add database/mysql/migraciones/2026-10-08_vales_deudas.sql database/mysql/schema.sql database/seed.sql
git commit -m "feat(vales): migración de base de datos para la extensión Deudas"
```

---

## Task 2: Backend — `vales.schema.ts`

**Files:**
- Modify: `backend/src/modules/vales/vales.schema.ts`

**Interfaces:**
- Produces: `crearValeSchema`/`CrearValeInput` ampliado (2 ramas: con fuente/tipo opcional-default-"pago", o sin fuente/tipo="deuda" literal con `montoAdeudado`); `cobrarValeSchema`/`CobrarValeInput` nuevo — los usan Task 4 (service) y Task 5 (controller).

- [ ] **Step 1: Reemplazar el archivo completo**

```typescript
import { z } from "zod";
import { referenciaBancoSchema } from "../../shared/utils/pago-mixto";

const METODOS_PAGO = ["efectivo", "banco"] as const;
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";

// Mismo patrón que registrarEgresoSchema (caja.schema.ts) — "mixto" no es un
// método real en la base, se descompone en 1-2 líneas puras al guardar. Un
// vale/préstamo nunca pide referenciaBanco (esa regla es solo para pagos
// recibidos — ver cobrarValeSchema más abajo, que SÍ la necesita).
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
export type PagoValeInput = z.infer<typeof pagoValeSchema>;

const FUENTES = ["turno", "acumulado", "dueno"] as const;
export type FuenteVale = (typeof FUENTES)[number];

const TIPOS = ["pago", "deuda"] as const;
export type TipoVale = (typeof TIPOS)[number];

const camposComunes = {
  pagadoA: z.string().trim().min(1, "Escribe a quién corresponde este vale").max(150),
  destinatarioUsuarioId: z.string().uuid().optional(),
  destinatarioDocumento: z.string().trim().max(30).optional(),
  concepto: z.string().trim().min(1, "Escribe el concepto del vale").max(500),
};

// Un vale "pago" (dinero que ya salió, tipo por defecto si se omite), o una
// "deuda" CON préstamo inicial (también sale dinero real, pero queda
// pendiente de cobrar después) — misma forma en los dos casos, solo cambia
// qué significa `tipo`.
const conFuenteSchema = z
  .object({
    ...camposComunes,
    tipo: z.enum(TIPOS).default("pago"),
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

// Una "deuda" SIN préstamo inicial: no toca Caja para nada al crearla, solo
// queda registrado cuánto debe (ej. un daño que el empleado tiene que asumir).
const sinFuenteSchema = z.object({
  ...camposComunes,
  tipo: z.literal("deuda"),
  montoAdeudado: z.number().positive(),
});

export const crearValeSchema = z.union([conFuenteSchema, sinFuenteSchema]);
export type CrearValeInput = z.infer<typeof crearValeSchema>;

export const reponerValeSchema = z.object({
  fuenteReposicion: z.enum(["turno", "acumulado"]),
});
export type ReponerValeInput = z.infer<typeof reponerValeSchema>;

// Cobrar una deuda es un INGRESO (dinero que entra), al revés de crear un
// vale (siempre egreso) — por eso SÍ necesita referenciaBanco cuando hay
// banco de por medio (ver pago-mixto.ts::exigirReferenciaBanco, que corre
// dentro de cajaService.registrarIngreso).
export const cobrarValeSchema = z.union([
  z.object({ metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive(), ...referenciaBancoSchema }),
  z
    .object({
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
      ...referenciaBancoSchema,
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type CobrarValeInput = z.infer<typeof cobrarValeSchema>;
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: **falla** — `vales.service.ts` todavía usa el `CrearValeInput` viejo (`input.fuente` sin narrowing, `pagoDesdeInput(input: CrearValeInput)` accediendo a `.metodoPago` directo). Este error es esperado en este punto, se corrige en la Task 4.

- [ ] **Step 3: Verificación — un body sin `fuente` NI `montoAdeudado` se rechaza claro, no con un 500**

Esto es una prueba pura de Zod (no toca la base de datos, se puede correr ya mismo):

```bash
cd backend && npx tsx -e "
import { crearValeSchema } from './src/modules/vales/vales.schema';
const resultado = crearValeSchema.safeParse({ pagadoA: 'Prueba', concepto: 'Prueba', tipo: 'deuda' });
console.log(resultado.success ? 'FALLO: debió rechazar' : 'OK: rechazado — ' + resultado.error.issues.map((i) => i.message).join(' | '));
"
```

Esperado: `OK: rechazado — ...` (con algún mensaje de Zod sobre el campo faltante — nunca `FALLO`).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/vales/vales.schema.ts
git commit -m "feat(vales): schema de Deudas (crearValeSchema ampliado, cobrarValeSchema nuevo)"
```

---

## Task 3: Backend — `vales.repository.ts`

**Files:**
- Modify: `backend/src/modules/vales/vales.repository.ts`

**Interfaces:**
- Consumes: nada nuevo de otras tasks.
- Produces: `crearVale` ampliado (acepta `tipo`, `fuente` nullable, `montoAdeudado`); `marcarCobrado(client, id, montoEfectivo, montoBanco)` nuevo; `FiltrosListarVales`/`listVales` con filtro `tipo` y `estado` generalizado (`"activo"|"resuelto"|"anulado"`) — los usa Task 4 (service).

- [ ] **Step 1: Reemplazar `FiltrosListarVales` y `listVales`**

```typescript
export interface FiltrosListarVales {
  tipo?: "pago" | "deuda";
  fuente?: string;
  estado?: "activo" | "resuelto" | "anulado";
}

export async function listVales(filtros: FiltrosListarVales) {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtros.tipo) {
    condiciones.push(`v.tipo = $${params.length + 1}`);
    params.push(filtros.tipo);
  }
  if (filtros.fuente) {
    condiciones.push(`v.fuente = $${params.length + 1}`);
    params.push(filtros.fuente);
  }
  if (filtros.estado === "anulado") {
    condiciones.push(`v.anulado_en IS NOT NULL`);
  } else if (filtros.estado === "resuelto") {
    condiciones.push(`(v.repuesto_en IS NOT NULL OR v.cobrado_en IS NOT NULL) AND v.anulado_en IS NULL`);
  } else if (filtros.estado === "activo") {
    condiciones.push(`v.repuesto_en IS NULL AND v.cobrado_en IS NULL AND v.anulado_en IS NULL`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(`${SELECT_VALE} ${where} ORDER BY v.created_at DESC`, params);
  return result.rows;
}
```

- [ ] **Step 2: Reemplazar `crearVale` y agregar `marcarCobrado`**

```typescript
export async function crearVale(
  client: PoolClient,
  params: {
    tipo: string;
    pagadoA: string;
    destinatarioUsuarioId: string | null;
    destinatarioDocumento: string | null;
    concepto: string;
    montoEfectivo: number;
    montoBanco: number;
    montoAdeudado: number | null;
    fuente: string | null;
    duenoId: string | null;
    creadoPorId: string;
  },
) {
  const result = await client.query(
    `INSERT INTO vales (
       numero, tipo, pagado_a, destinatario_usuario_id, destinatario_documento, concepto,
       monto_efectivo, monto_banco, monto_adeudado, fuente, dueno_id, creado_por_id
     ) VALUES (
       'V-' || lpad(nextval('vales_numero_seq'), 6, '0'),
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )
     RETURNING *`,
    [
      params.tipo,
      params.pagadoA,
      params.destinatarioUsuarioId,
      params.destinatarioDocumento,
      params.concepto,
      params.montoEfectivo,
      params.montoBanco,
      params.montoAdeudado,
      params.fuente,
      params.duenoId,
      params.creadoPorId,
    ],
  );
  return result.rows[0];
}

export async function marcarCobrado(client: PoolClient, id: string, montoEfectivo: number, montoBanco: number) {
  await client.query(
    `UPDATE vales SET cobrado_en = NOW(), monto_cobrado_efectivo = $2, monto_cobrado_banco = $3 WHERE id = $1`,
    [id, montoEfectivo, montoBanco],
  );
}
```

- [ ] **Step 3: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```

Esperado: **sigue fallando** por las mismas razones de la Task 2 (vales.service.ts todavía no actualizado) — además ahora también falla por el nuevo shape de `crearVale`'s params. Esperado, se corrige en la Task 4.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/vales/vales.repository.ts
git commit -m "feat(vales): repositorio ampliado para Deudas (crearVale, marcarCobrado, filtros)"
```

---

## Task 4: Backend — `vales.service.ts`

**Files:**
- Modify: `backend/src/modules/vales/vales.service.ts`

**Interfaces:**
- Consumes: `vales.schema.ts::{CrearValeInput, CobrarValeInput, PagoValeInput}` (Task 2), `vales.repository.ts::{crearVale, marcarCobrado}` (Task 3), `caja.service.ts::registrarIngreso` (ya existente, firma `(input, usuarioId, executor?)`).
- Produces: `crearVale` ramificado, `cobrarVale` nuevo, `anularVale` ampliado — los usa Task 5 (controller).

- [ ] **Step 1: Reemplazar el archivo completo**

```typescript
import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { getUsuarioById } from "../general/usuarios/usuarios.repository";
import * as repo from "./vales.repository";
import { CobrarValeInput, CrearValeInput, PagoValeInput, ReponerValeInput } from "./vales.schema";

const ROLES_DUENO = new Set(["Root", "Super Root"]);
const CATEGORIA_GASTO_VALES = "Vales";
// `movimientos_caja.motivo` es TEXT, pero `caja_egresos_acumulado.motivo` es
// VARCHAR(200) (ver database/mysql/schema.sql) — como un vale puede ir a
// cualquiera de las dos según `fuente`, el motivo se recorta siempre al
// mismo límite para que no falle con un 500 opaco solo en el caso acumulado
// cuando el concepto (hasta 500 caracteres, ver vales.schema.ts) es largo.
const MOTIVO_MAX_LEN = 200;

function truncarMotivo(texto: string): string {
  return texto.slice(0, MOTIVO_MAX_LEN);
}

async function categoriaGastoValesId(): Promise<number> {
  const id = await repo.getCategoriaGastoPorNombre(CATEGORIA_GASTO_VALES);
  if (!id) throw Errors.conflict('No existe la categoría de gasto "Vales" — corre la migración del módulo de vales.');
  return id;
}

/** Un usuario eliminado (soft-delete) o desactivado no debe poder elegirse
 *  como dueño ni como destinatario vinculado — `getUsuarioById` no filtra
 *  esto (sigue encontrando la fila), así que hay que comprobarlo acá. El
 *  frontend ya los oculta de los selectores, pero esto es lo que de verdad
 *  lo impide si alguien llama la API directo. */
function usuarioActivo(u: { activo: boolean; deleted_at: string | null }): boolean {
  return u.activo && !u.deleted_at;
}

/** `monto`/`montoEfectivo`+`montoBanco` según el método — nunca los dos a la
 *  vez (mismo shape que descomponerPago espera). Solo se usa con el pago de
 *  un vale/préstamo (nunca con una deuda sin fuente, que no tiene esta forma). */
function pagoDesdeInput(input: PagoValeInput) {
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
 * Crea el vale/deuda y, según el caso, genera de inmediato el egreso real
 * que corresponde — todo en una sola transacción: si el egreso falla (ej.
 * no hay turno abierto), nada se crea.
 *
 * - "fuente" en el input (pago normal, o deuda CON préstamo): mismo flujo de
 *   siempre, genera egreso según `fuente`.
 * - Sin "fuente" (solo válido para tipo="deuda"): no toca Caja en absoluto,
 *   solo guarda `montoAdeudado`.
 */
export async function crearVale(input: CrearValeInput, usuarioId: string) {
  let duenoId: string | null = null;
  if ("fuente" in input && input.fuente === "dueno") {
    // input.duenoId ya viene garantizado por el refine del schema (Task 2).
    const dueno = await getUsuarioById(input.duenoId!);
    if (!dueno || !ROLES_DUENO.has(dueno.rol_nombre) || !usuarioActivo(dueno)) {
      throw Errors.badRequest("El dueño elegido no es una cuenta Root o Super Root activa y válida");
    }
    duenoId = dueno.id;
  }

  if (input.destinatarioUsuarioId) {
    const destinatario = await getUsuarioById(input.destinatarioUsuarioId);
    if (!destinatario || !usuarioActivo(destinatario)) {
      throw Errors.badRequest("El usuario vinculado elegido no existe o ya no está activo");
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let montoEfectivo = 0;
    let montoBanco = 0;
    let montoAdeudado: number | null = null;
    if ("fuente" in input) {
      montoEfectivo = input.metodoPago === "mixto" ? input.montoEfectivo : input.metodoPago === "efectivo" ? input.monto : 0;
      montoBanco = input.metodoPago === "mixto" ? input.montoBanco : input.metodoPago === "banco" ? input.monto : 0;
    } else {
      montoAdeudado = input.montoAdeudado;
    }

    const vale = await repo.crearVale(client, {
      tipo: input.tipo,
      pagadoA: input.pagadoA,
      destinatarioUsuarioId: input.destinatarioUsuarioId ?? null,
      destinatarioDocumento: input.destinatarioDocumento ?? null,
      concepto: input.concepto,
      montoEfectivo,
      montoBanco,
      montoAdeudado,
      fuente: "fuente" in input ? input.fuente : null,
      duenoId,
      creadoPorId: usuarioId,
    });

    if ("fuente" in input) {
      if (input.fuente === "turno") {
        await cajaService.registrarEgreso(
          {
            categoriaGastoId: await categoriaGastoValesId(),
            motivo: truncarMotivo(`Vale ${vale.numero} — ${input.concepto}`),
            moduloOrigenSlug: "vales",
            ...pagoDesdeInput(input),
          },
          usuarioId,
          client,
          { entidad: "vales", id: vale.id },
        );
      } else if (input.fuente === "acumulado") {
        await cajaService.registrarEgresoAcumulado(
          {
            categoriaGastoId: await categoriaGastoValesId(),
            motivo: truncarMotivo(`Vale ${vale.numero} — ${input.concepto}`),
            ...pagoDesdeInput(input),
          },
          usuarioId,
          client,
          { entidad: "vales", id: vale.id },
        );
      }
      // fuente === "dueno": no se toca Caja.
    }
    // Deuda sin préstamo (sin "fuente" en el input): no se toca Caja en absoluto.

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
          motivo: truncarMotivo(`Reposición vale ${vale.numero} — ${vale.pagado_a}`),
          moduloOrigenSlug: "vales",
          ...pago,
        },
        usuarioId,
        client,
        { entidad: "vales_reposicion", id: vale.id },
      );
    } else {
      await cajaService.registrarEgresoAcumulado(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: truncarMotivo(`Reposición vale ${vale.numero} — ${vale.pagado_a}`),
          ...pago,
        },
        usuarioId,
        client,
        { entidad: "vales_reposicion", id: vale.id },
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

/**
 * Cobra una deuda: el monto es siempre el exacto que se debe (no lo elige
 * quien cobra, solo el método de pago) — se valida server-side que lo que
 * llega coincide antes de generar el ingreso, nunca se confía en el total
 * que mande el formulario (mismo criterio aplicado a referenciaEntidad/
 * referenciaId tras la revisión del módulo original). Siempre contra el
 * turno abierto — no existe "ingreso acumulado" en este sistema.
 */
export async function cobrarVale(id: string, input: CobrarValeInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vale = await repo.getValeParaActualizar(client, id);
    if (!vale) throw Errors.notFound("Vale no encontrado");
    if (vale.tipo !== "deuda") throw Errors.conflict("Solo una deuda se puede marcar como cobrada");
    if (vale.cobrado_en) throw Errors.conflict("Esta deuda ya está cobrada");
    if (vale.anulado_en) throw Errors.conflict("Este vale está anulado");

    const montoAdeudadoTotal = vale.fuente
      ? Number(vale.monto_efectivo) + Number(vale.monto_banco)
      : Number(vale.monto_adeudado);
    const montoEfectivo = input.metodoPago === "mixto" ? input.montoEfectivo : input.metodoPago === "efectivo" ? input.monto : 0;
    const montoBanco = input.metodoPago === "mixto" ? input.montoBanco : input.metodoPago === "banco" ? input.monto : 0;
    if (Math.abs(montoEfectivo + montoBanco - montoAdeudadoTotal) > 0.01) {
      throw Errors.badRequest(`El monto a cobrar debe ser exactamente lo que se debe (${montoAdeudadoTotal})`);
    }

    await cajaService.registrarIngreso(
      {
        moduloOrigenSlug: "vales",
        motivo: truncarMotivo(`Cobro de deuda — vale ${vale.numero} — ${vale.pagado_a}`),
        referenciaEntidad: "vales_cobro",
        referenciaId: id,
        ...input,
      },
      usuarioId,
      client,
    );

    await repo.marcarCobrado(client, id, montoEfectivo, montoBanco);

    await client.query("COMMIT");
    return repo.getValeById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Anula un vale/deuda: revierte todos los movimientos reales que haya
 *  generado (préstamo o pago original, reposición al dueño, y cobro de la
 *  deuda), cada uno en la tabla que le corresponde según su fuente — turno
 *  usa `movimientos_caja`, acumulado usa `caja_egresos_acumulado`, son
 *  mecanismos de reversión distintos. Los tres son independientes entre sí. */
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

    if (vale.cobrado_en) {
      // El cobro siempre fue contra el turno (nunca acumulado — ver
      // cobrarVale) — anularMovimientosPorReferencia ya es genérico sobre
      // movimientos_caja, sirve igual para un ingreso que para un egreso.
      const ids = await cajaService.anularMovimientosPorReferencia(client, "vales_cobro", id, nota, usuarioId);
      turnoIdsAfectados.push(...ids);
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
cd backend && npx tsc --noEmit && echo "tsc OK"
```

Esperado: `tsc OK`. Si marca algo sobre `cajaService.registrarIngreso`, revisar que su firma real sea `(input: RegistrarIngresoInput, usuarioId: string, executor?: Pool | PoolClient)` y que `RegistrarIngresoInput` incluya `moduloOrigenSlug` (obligatorio), `motivo`/`referenciaEntidad`/`referenciaId` (opcionales) además del shape de pago — son campos de `camposIngreso` en `caja.schema.ts`, no se tocan en este plan.

- [ ] **Step 3: Verificación manual — caso no-mixto de `cobrarVale` sigue la misma matemática que `pagoDesdeInput`**

Sin base de datos alcanzable en este entorno (ver Global Constraints), se verifica leyendo el código: para `metodoPago !== "mixto"`, `montoEfectivo`/`montoBanco` en `cobrarVale` se calculan exactamente igual que en `marcarValeRepuesto`'s rama de pago puro — confirma que `input.monto` termina completo en el lado que corresponde (efectivo o banco), nunca repartido a medias.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/vales/vales.service.ts
git commit -m "feat(vales): lógica de negocio de Deudas (crear ramificado, cobrar, anular ampliado)"
```

---

## Task 5: Backend — controller + routes (endpoint `/vales/:id/cobrar`)

**Files:**
- Modify: `backend/src/modules/vales/vales.controller.ts`
- Modify: `backend/src/modules/vales/vales.routes.ts`

**Interfaces:**
- Consumes: `vales.service.ts::cobrarVale` (Task 4), `vales.schema.ts::cobrarValeSchema` (Task 2).
- Produces: `POST /vales/:id/cobrar`.

- [ ] **Step 1: Actualizar `listarValesController` y agregar `cobrarValeController`**

En `vales.controller.ts`, cambiar el import:

```typescript
import { crearValeSchema, cobrarValeSchema, reponerValeSchema } from "./vales.schema";
```

Reemplazar `listarValesController` completo — ahora también lee el filtro `tipo`, y `estado` usa los valores generalizados (`"activo"|"resuelto"|"anulado"`, ver Task 3):

```typescript
export async function listarValesController(req: Request, res: Response) {
  const tipo = req.query.tipo as "pago" | "deuda" | undefined;
  const fuente = req.query.fuente as string | undefined;
  const estado = req.query.estado as "activo" | "resuelto" | "anulado" | undefined;
  return ok(res, await service.listarVales({ tipo, fuente, estado }));
}
```

Y agregar, después de `marcarValeRepuestoController`:

```typescript
export async function cobrarValeController(req: Request, res: Response) {
  const data = cobrarValeSchema.parse(req.body);
  return ok(res, await service.cobrarVale(req.params.id, data, req.auth!.usuarioId));
}
```

- [ ] **Step 2: Agregar la ruta**

En `vales.routes.ts`, cambiar el import:

```typescript
import {
  anularValeController,
  cobrarValeController,
  crearValeController,
  listarValesController,
  marcarValeRepuestoController,
  obtenerValeController,
} from "./vales.controller";
```

Y agregar, después de la ruta `/:id/reponer`:

```typescript
valesRouter.post("/:id/cobrar", requirePermission("vales.marcar_cobrado"), asyncHandler(cobrarValeController));
```

- [ ] **Step 3: Verificar que compila**

```bash
cd backend && npx tsc --noEmit && echo "tsc OK"
```

Esperado: `tsc OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/vales/vales.controller.ts backend/src/modules/vales/vales.routes.ts
git commit -m "feat(vales): endpoint POST /vales/:id/cobrar"
```

---

## Task 6: Frontend — `api.ts`

**Files:**
- Modify: `frontend/src/modules/vales/api.ts`

**Interfaces:**
- Produces: `Vale` ampliado (`tipo`, `monto_adeudado`, `cobrado_en`, `monto_cobrado_efectivo/banco`, `fuente` nullable), `CrearValeInput` (unión de 2 ramas), `CobrarValeInput` nuevo, `valesApi.cobrar` — los usan Tasks 7-9.

- [ ] **Step 1: Reemplazar el archivo completo**

```typescript
import { apiFetch } from "../../shared/api/client";

export type FuenteVale = "turno" | "acumulado" | "dueno";
export type TipoVale = "pago" | "deuda";
export type EstadoVale = "activo" | "resuelto" | "anulado";

export interface Vale {
  id: string;
  numero: string;
  tipo: TipoVale;
  pagado_a: string;
  destinatario_usuario_id: string | null;
  destinatario_usuario_nombre: string | null;
  destinatario_documento: string | null;
  concepto: string;
  monto_efectivo: string;
  monto_banco: string;
  monto_adeudado: string | null;
  fuente: FuenteVale | null;
  dueno_id: string | null;
  dueno_nombre: string | null;
  repuesto_en: string | null;
  fuente_reposicion: FuenteVale | null;
  cobrado_en: string | null;
  monto_cobrado_efectivo: string;
  monto_cobrado_banco: string;
  anulado_en: string | null;
  creado_por_nombre: string | null;
  created_at: string;
}

// Mismo shape que descomponerPago espera del lado del backend — nunca se
// manda referenciaBanco (esa regla es solo para pagos recibidos, nunca para
// un vale/préstamo que siempre es dinero que sale).
export type PagoValeInput =
  | { metodoPago: "efectivo" | "banco"; monto: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

// Cobrar SÍ necesita referenciaBanco cuando hay banco de por medio — es un
// ingreso (dinero que entra), al revés que crear un vale.
export type CobrarValeInput =
  | { metodoPago: "efectivo" | "banco"; monto: number; referenciaBanco?: string }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number; referenciaBanco?: string };

type CamposComunesVale = {
  pagadoA: string;
  destinatarioUsuarioId?: string;
  destinatarioDocumento?: string;
  concepto: string;
};

export type CrearValeInput =
  | (CamposComunesVale & { tipo?: TipoVale; fuente: FuenteVale; duenoId?: string } & PagoValeInput)
  | (CamposComunesVale & { tipo: "deuda"; montoAdeudado: number });

export interface ReponerValeInput {
  fuenteReposicion: "turno" | "acumulado";
}

export const valesApi = {
  listar: (filtros?: { tipo?: TipoVale; fuente?: FuenteVale; estado?: EstadoVale }) => {
    const params = new URLSearchParams();
    if (filtros?.tipo) params.set("tipo", filtros.tipo);
    if (filtros?.fuente) params.set("fuente", filtros.fuente);
    if (filtros?.estado) params.set("estado", filtros.estado);
    const qs = params.toString();
    return apiFetch<Vale[]>(`/vales${qs ? `?${qs}` : ""}`);
  },
  obtener: (id: string) => apiFetch<Vale>(`/vales/${id}`),
  crear: (input: CrearValeInput) => apiFetch<Vale>("/vales", { method: "POST", body: input }),
  marcarRepuesto: (id: string, input: ReponerValeInput) =>
    apiFetch<Vale>(`/vales/${id}/reponer`, { method: "POST", body: input }),
  cobrar: (id: string, input: CobrarValeInput) =>
    apiFetch<Vale>(`/vales/${id}/cobrar`, { method: "POST", body: input }),
  anular: (id: string) => apiFetch<Vale>(`/vales/${id}/anular`, { method: "POST" }),
};
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend && npx tsc -b
```

Esperado: **falla** — `ValesPage.tsx` todavía usa el `estado: "activo"|"repuesto"|"anulado"` viejo y `LABEL_FUENTE[v.fuente]` sin guardar contra `null`. Esperado, se corrige en la Task 7.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/api.ts
git commit -m "feat(vales): api.ts ampliado para Deudas"
```

---

## Task 7: Frontend — `ValesPage.tsx` (listado)

**Files:**
- Modify: `frontend/src/modules/vales/pages/ValesPage.tsx`

**Interfaces:**
- Consumes: `valesApi` ampliado (Task 6).
- Produces: listado con columna/filtro de tipo y estado generalizado.

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type EstadoVale, type FuenteVale, type TipoVale, type Vale } from "../api";
import { NuevoValeModal } from "../components/NuevoValeModal";

const POLL_MS = 20000;

const LABEL_FUENTE: Record<FuenteVale, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

const LABEL_TIPO: Record<TipoVale, string> = {
  pago: "Pago",
  deuda: "Deuda",
};

const FILTROS_TIPO: { valor: TipoVale | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos los tipos" },
  { valor: "pago", etiqueta: "Pago" },
  { valor: "deuda", etiqueta: "Deuda" },
];

const FILTROS_FUENTE: { valor: FuenteVale | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas las fuentes" },
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Acumulado" },
  { valor: "dueno", etiqueta: "Bolsillo de dueño" },
];

const FILTROS_ESTADO: { valor: EstadoVale | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activo", etiqueta: "Activos / pendientes" },
  { valor: "resuelto", etiqueta: "Repuestos / cobrados" },
  { valor: "anulado", etiqueta: "Anulados" },
];

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function estadoVale(v: Vale): EstadoVale {
  if (v.anulado_en) return "anulado";
  if (v.repuesto_en || v.cobrado_en) return "resuelto";
  return "activo";
}

/** La misma palabra "resuelto" significa cosas distintas según el tipo —
 *  "Repuesto" para un pago financiado por un dueño, "Cobrada" para una
 *  deuda — y "activo" también cambia: "Pendiente de cobro" para una deuda. */
function labelEstado(v: Vale, estado: EstadoVale): string {
  if (estado === "anulado") return "Anulado";
  if (v.tipo === "deuda") return estado === "resuelto" ? "Cobrada" : "Pendiente de cobro";
  return estado === "resuelto" ? "Repuesto" : "Activo";
}

function montoVale(v: Vale): number {
  return v.fuente ? Number(v.monto_efectivo) + Number(v.monto_banco) : Number(v.monto_adeudado ?? 0);
}

const ESTILO_ESTADO: Record<EstadoVale, string> = {
  activo: "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla",
  resuelto: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  anulado: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

export function ValesPage() {
  const [vales, setVales] = useState<Vale[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<TipoVale | "todos">("todos");
  const [filtroFuente, setFiltroFuente] = useState<FuenteVale | "todas">("todas");
  const [filtroEstado, setFiltroEstado] = useState<EstadoVale | "todos">("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  async function cargar() {
    try {
      setVales(
        await valesApi.listar({
          tipo: filtroTipo === "todos" ? undefined : filtroTipo,
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
  }, [filtroTipo, filtroFuente, filtroEstado]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Vales</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Comprobantes de dinero ya entregado, o deudas que te deben.
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
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as TipoVale | "todos")}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          {FILTROS_TIPO.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </select>
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
          onChange={(e) => setFiltroEstado(e.target.value as EstadoVale | "todos")}
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
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Tipo</th>
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
                return (
                  <tr key={v.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">
                      <Link to={`/vales/${v.id}`} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                        {v.numero}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{LABEL_TIPO[v.tipo]}</td>
                    <td className="px-3 py-2">{v.pagado_a}</td>
                    <td className="px-3 py-2">{formatearFechaHora(v.created_at)}</td>
                    <td className="px-3 py-2">{v.fuente ? LABEL_FUENTE[v.fuente] : "Sin préstamo"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[estado]}`}>
                        {labelEstado(v, estado)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(montoVale(v))}</td>
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

Esperado: **sigue fallando** — no por `NuevoValeModal.tsx` (su llamada a `valesApi.crear` sin `tipo` todavía calza bien, porque `tipo?` es opcional en la primera rama de `CrearValeInput`), sino porque `DetalleValePage.tsx` y `factura.ts` (ninguno tocado todavía) siguen indexando `LABEL_FUENTE[vale.fuente]` contra el `fuente` que ya es `FuenteVale | null` desde la Task 6 — un `Record` indexado con `null` no compila. Esperado, se corrige en la Task 9 (que sí toca esos dos archivos).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/pages/ValesPage.tsx
git commit -m "feat(vales): listado con tipo/estado de Deudas (WIP — falta NuevoValeModal)"
```

---

## Task 8: Frontend — `NuevoValeModal.tsx`

**Files:**
- Modify: `frontend/src/modules/vales/components/NuevoValeModal.tsx`

**Interfaces:**
- Consumes: `valesApi.crear` ampliado (Task 6).
- Produces: selector de tipo + toggle de préstamo inicial.

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { usuariosApi, type Usuario } from "../../general/api";
import { valesApi, type FuenteVale, type TipoVale } from "../api";

interface NuevoValeModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

const BOTON_TOGGLE_BASE = "rounded-md border-2 px-3 py-2 text-sm font-medium transition-colors";
const BOTON_TOGGLE_ACTIVO =
  "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla";
const BOTON_TOGGLE_INACTIVO =
  "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20";

const ROLES_DUENO = new Set(["Root", "Super Root"]);

const FUENTES: { valor: FuenteVale; etiqueta: string }[] = [
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Cuenta general (acumulado)" },
  { valor: "dueno", etiqueta: "Bolsillo de un dueño" },
];

const TIPOS: { valor: TipoVale; etiqueta: string }[] = [
  { valor: "pago", etiqueta: "Pago (dinero que sale)" },
  { valor: "deuda", etiqueta: "Deuda (te deben)" },
];

export function NuevoValeModal({ onCerrar, onCreado }: NuevoValeModalProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [tipo, setTipo] = useState<TipoVale>("pago");
  const [pagadoA, setPagadoA] = useState("");
  const [destinatarioUsuarioId, setDestinatarioUsuarioId] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [concepto, setConcepto] = useState("");
  // Solo aplica si tipo === "deuda": ¿salió dinero real a prestar, o es una
  // deuda pura (ej. un daño) que nunca tocó Caja?
  const [huboPrestamo, setHuboPrestamo] = useState(true);
  const [montoAdeudado, setMontoAdeudado] = useState(0);
  const [fuente, setFuente] = useState<FuenteVale>("turno");
  const [duenoId, setDuenoId] = useState("");
  // Como no hay referenciaBanco en un vale/préstamo (siempre es dinero que
  // sale), no se usa MetodoPagoValor.referenciaBanco, pero sí se necesita el
  // monto para efectivo/banco puro (SelectorMetodoPago no lo trae incluido
  // — ver EgresoModal.tsx, mismo patrón).
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [monto, setMonto] = useState(0);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usuariosApi.listar().then(setUsuarios).catch(() => {});
  }, []);

  // Un usuario eliminado (soft-delete) o desactivado no puede elegirse ni
  // como dueño ni como destinatario vinculado — el backend también lo
  // rechaza (ver vales.service.ts::usuarioActivo), esto es solo para que
  // ni siquiera aparezca en la lista.
  const usuariosActivos = usuarios.filter((u) => u.activo && !u.deleted_at);
  const duenosDisponibles = usuariosActivos.filter((u) => ROLES_DUENO.has(u.rol_nombre));
  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  // Sin préstamo (deuda pura, ej. un daño): no hay fuente ni método de pago
  // que validar, solo el monto que debe. Con préstamo (pago normal, o deuda
  // con préstamo): mismas reglas de siempre.
  const necesitaFuente = tipo === "pago" || huboPrestamo;
  // Mismo criterio que EgresoModal.tsx (el precedente real de egresos): nunca
  // se valida faltaReferenciaBanco acá — con pedirReferenciaBanco={false} esa
  // función igual exigiría una referencia que la UI ni siquiera muestra.
  const puedeGuardar =
    pagadoA.trim().length > 0 &&
    concepto.trim().length > 0 &&
    (necesitaFuente
      ? (pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0) && (fuente !== "dueno" || duenoId.length > 0)
      : montoAdeudado > 0);

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const camposComunes = {
        pagadoA: pagadoA.trim(),
        destinatarioUsuarioId: destinatarioUsuarioId || undefined,
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        concepto: concepto.trim(),
      };
      if (necesitaFuente) {
        await valesApi.crear({
          ...camposComunes,
          tipo,
          fuente,
          duenoId: fuente === "dueno" ? duenoId : undefined,
          ...(pago.metodoPago === "mixto"
            ? { metodoPago: "mixto", montoEfectivo: pago.montoEfectivo, montoBanco: pago.montoBanco }
            : { metodoPago: pago.metodoPago, monto }),
        });
      } else {
        await valesApi.crear({ ...camposComunes, tipo: "deuda", montoAdeudado });
      }
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
          <label className="mb-1 block text-xs font-medium">Tipo</label>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => setTipo(t.valor)}
                className={`${BOTON_TOGGLE_BASE} ${tipo === t.valor ? BOTON_TOGGLE_ACTIVO : BOTON_TOGGLE_INACTIVO}`}
              >
                {t.etiqueta}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">{tipo === "deuda" ? "¿Quién debe?" : "Pagado a / Para"}</label>
          <input value={pagadoA} onChange={(e) => setPagadoA(e.target.value)} className={INPUT_CLASE} autoFocus />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Vincular a un usuario existente (opcional)</label>
            <select value={destinatarioUsuarioId} onChange={(e) => setDestinatarioUsuarioId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin vincular</option>
              {usuariosActivos.map((u) => (
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

        {tipo === "deuda" && (
          <div>
            <label className="mb-1 block text-xs font-medium">¿Hubo un préstamo inicial?</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setHuboPrestamo(true)}
                className={`${BOTON_TOGGLE_BASE} ${huboPrestamo ? BOTON_TOGGLE_ACTIVO : BOTON_TOGGLE_INACTIVO}`}
              >
                Sí, salió dinero
              </button>
              <button
                type="button"
                onClick={() => setHuboPrestamo(false)}
                className={`${BOTON_TOGGLE_BASE} ${!huboPrestamo ? BOTON_TOGGLE_ACTIVO : BOTON_TOGGLE_INACTIVO}`}
              >
                No, solo se debe
              </button>
            </div>
          </div>
        )}

        {necesitaFuente ? (
          <>
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
          </>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium">Monto que debe</label>
            <input
              type="number"
              value={montoAdeudado || ""}
              onChange={(e) => setMontoAdeudado(Number(e.target.value))}
              placeholder="Monto"
              className={INPUT_CLASE}
            />
          </div>
        )}

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

Esperado: **sigue fallando** — `DetalleValePage.tsx` todavía no maneja `fuente: null` ni tiene el botón de cobrar, y `factura.ts` todavía indexa `LABEL_FUENTE[vale.fuente]` sin guardar contra `null`. Esperado, se corrige en la Task 9.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/vales/components/NuevoValeModal.tsx
git commit -m "feat(vales): selector de tipo y préstamo inicial en NuevoValeModal"
```

---

## Task 9: Frontend — `DetalleValePage.tsx` + `factura.ts` + `ReciboImprimible.tsx` (cobrar + impresión) + verificación final

**Files:**
- Modify: `frontend/src/modules/vales/pages/DetalleValePage.tsx`
- Modify: `frontend/src/modules/vales/factura.ts`
- Modify: `frontend/src/shared/components/ReciboImprimible.tsx`

**Interfaces:**
- Consumes: `valesApi.cobrar` (Task 6), `shared/components/SelectorMetodoPago::{faltaReferenciaBanco, referenciaBancoPayload}` (ya existentes).
- Produces: botón "Marcar como cobrada" + impresión de una deuda.

- [ ] **Step 1: Reemplazar `DetalleValePage.tsx` completo**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import {
  SelectorMetodoPago,
  faltaReferenciaBanco,
  referenciaBancoPayload,
  type MetodoPagoValor,
} from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type Vale } from "../api";
import { valeAReciboProps } from "../factura";

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
  const [pidiendoCobro, setPidiendoCobro] = useState(false);
  // El monto a cobrar es siempre el exacto que se debe (no editable) — solo
  // se elige el método; "mixto" sí necesita repartirlo, con feedback de
  // "cuadra"/"no cuadra" vía el totalFijo de SelectorMetodoPago.
  const [pagoCobro, setPagoCobro] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [imprimiendo, setImprimiendo] = useState(false);

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

  async function cobrar(montoAdeudadoTotal: number) {
    if (!id) return;
    setProcesando(true);
    setError(null);
    try {
      await valesApi.cobrar(id, {
        ...(pagoCobro.metodoPago === "mixto"
          ? { metodoPago: "mixto", montoEfectivo: pagoCobro.montoEfectivo, montoBanco: pagoCobro.montoBanco }
          : { metodoPago: pagoCobro.metodoPago, monto: montoAdeudadoTotal }),
        ...referenciaBancoPayload(pagoCobro),
      });
      setPidiendoCobro(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar como cobrada");
    } finally {
      setProcesando(false);
    }
  }

  async function anular() {
    if (!id) return;
    const aviso =
      vale?.repuesto_en || vale?.cobrado_en
        ? "Este vale ya está repuesto o cobrado — anularlo revierte todo lo que haya pasado. ¿Anular igual?"
        : "¿Anular este vale? Si ya generó un movimiento en Caja, se revierte.";
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

  const montoEfectivo = Number(vale.monto_efectivo);
  const montoBanco = Number(vale.monto_banco);
  const esMixto = montoEfectivo > 0 && montoBanco > 0;
  const montoAdeudadoTotal = vale.fuente ? montoEfectivo + montoBanco : Number(vale.monto_adeudado ?? 0);
  const puedeReponer = vale.fuente === "dueno" && !vale.repuesto_en && !vale.anulado_en;
  const puedeCobrar = vale.tipo === "deuda" && !vale.cobrado_en && !vale.anulado_en;
  const puedeAnular = !vale.anulado_en;
  const mixtoCobroInvalido =
    pagoCobro.metodoPago === "mixto" && Math.abs(pagoCobro.montoEfectivo + pagoCobro.montoBanco - montoAdeudadoTotal) > 0.01;
  const puedeConfirmarCobro = !mixtoCobroInvalido && !faltaReferenciaBanco(pagoCobro);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/vales" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
          {vale.tipo === "deuda" ? "Deuda" : "Vale"} {vale.numero}
        </h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          {formatearFechaHora(vale.created_at)}
          {vale.anulado_en && <span className="ml-2 font-semibold text-red-600">· ANULADO</span>}
          {vale.repuesto_en && !vale.anulado_en && <span className="ml-2 font-semibold text-blue-600">· Repuesto</span>}
          {vale.cobrado_en && !vale.anulado_en && <span className="ml-2 font-semibold text-blue-600">· Cobrada</span>}
        </p>
        <button
          onClick={() => setImprimiendo(true)}
          className="mt-2 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        >
          🖨️ Imprimir
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-brand-vanilla-dark p-4 text-sm dark:border-brand-green-700">
          <p><span className="font-semibold">{vale.tipo === "deuda" ? "Quién debe:" : "Pagado a:"}</span> {vale.pagado_a}</p>
          {vale.destinatario_usuario_nombre && <p><span className="font-semibold">Usuario vinculado:</span> {vale.destinatario_usuario_nombre}</p>}
          {vale.destinatario_documento && <p><span className="font-semibold">Documento:</span> {vale.destinatario_documento}</p>}
          <p><span className="font-semibold">Concepto:</span> {vale.concepto}</p>
          <p><span className="font-semibold">Monto:</span> {formatMoney(montoAdeudadoTotal)}</p>
          {vale.fuente && esMixto && (
            <p className="pl-4 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
              {formatMoney(montoEfectivo)} efectivo + {formatMoney(montoBanco)} banco
            </p>
          )}
          <p><span className="font-semibold">Fuente:</span> {vale.fuente ? LABEL_FUENTE[vale.fuente] : "Sin préstamo inicial"}</p>
          {vale.fuente === "dueno" && vale.dueno_nombre && <p><span className="font-semibold">Dueño:</span> {vale.dueno_nombre}</p>}
          {vale.creado_por_nombre && <p><span className="font-semibold">Registrado por:</span> {vale.creado_por_nombre}</p>}
          {vale.repuesto_en && (
            <p>
              <span className="font-semibold">Repuesto el:</span> {formatearFechaHora(vale.repuesto_en)}
              {vale.fuente_reposicion && ` — vía ${LABEL_FUENTE[vale.fuente_reposicion]}`}
            </p>
          )}
          {vale.cobrado_en && <p><span className="font-semibold">Cobrado el:</span> {formatearFechaHora(vale.cobrado_en)}</p>}
          {vale.anulado_en && (
            <p className="font-semibold text-red-600">Anulado el: {formatearFechaHora(vale.anulado_en)}</p>
          )}
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

          {puedeCobrar && (
            <div className="rounded-lg border border-blue-300 p-3 dark:border-blue-700">
              {!pidiendoCobro ? (
                <button
                  onClick={() => setPidiendoCobro(true)}
                  disabled={procesando}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Marcar como cobrada
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium">
                    Monto a cobrar (fijo): <span className="font-semibold">{formatMoney(montoAdeudadoTotal)}</span>
                  </p>
                  <SelectorMetodoPago value={pagoCobro} onChange={setPagoCobro} totalFijo={montoAdeudadoTotal} />
                  <button
                    onClick={() => cobrar(montoAdeudadoTotal)}
                    disabled={procesando || !puedeConfirmarCobro}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {procesando ? "Procesando..." : "Confirmar cobro"}
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

      {imprimiendo && <ModalImprimir {...valeAReciboProps(vale)} onCerrar={() => setImprimiendo(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Reemplazar `factura.ts` completo**

```typescript
import type { ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import type { Vale } from "./api";

const LABEL_FUENTE: Record<string, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

/** Traduce un vale (o una deuda) al formato genérico que espera
 *  `ReciboImprimible` — mismo patrón que `migao/factura.ts::entregaPropinaAReciboProps`
 *  (también de una sola línea, con espacio de firma). */
export function valeAReciboProps(vale: Vale): Omit<ReciboImprimibleProps, "anchoMm"> {
  const camposEncabezado: { etiqueta: string; valor: string }[] = [
    { etiqueta: vale.tipo === "deuda" ? "Quién debe" : "Pagado a", valor: vale.pagado_a },
  ];
  if (vale.destinatario_documento) camposEncabezado.push({ etiqueta: "Documento", valor: vale.destinatario_documento });
  camposEncabezado.push({ etiqueta: "Fuente", valor: vale.fuente ? LABEL_FUENTE[vale.fuente] : "Sin préstamo inicial" });
  if (vale.tipo === "deuda") {
    camposEncabezado.push({ etiqueta: "Estado", valor: vale.cobrado_en ? "Cobrada" : "Pendiente de cobro" });
  }
  if (vale.creado_por_nombre) camposEncabezado.push({ etiqueta: "Registrado por", valor: vale.creado_por_nombre });

  const montoEfectivo = Number(vale.monto_efectivo);
  const montoBanco = Number(vale.monto_banco);
  const total = vale.fuente ? montoEfectivo + montoBanco : Number(vale.monto_adeudado ?? 0);

  return {
    tipo: "vale",
    variante: vale.tipo === "deuda" ? "deuda" : undefined,
    folio: vale.numero,
    fecha: vale.created_at,
    camposEncabezado,
    items: [{ nombre: vale.concepto, cantidad: 1, precioUnitario: total, subtotal: total }],
    total,
    pagos: [
      ...(montoEfectivo > 0 ? [{ metodoPago: "efectivo", monto: montoEfectivo }] : []),
      ...(montoBanco > 0 ? [{ metodoPago: "banco", monto: montoBanco }] : []),
    ],
    // Un vale anulado tiene que seguir siendo imprimible (sirve de constancia
    // de que se anuló), pero NUNCA debe salir en blanco como si fuera válido
    // para firmar — alguien podría reimprimirlo y hacerlo firmar de nuevo
    // como si el pago/deuda siguiera vigente.
    nota: vale.anulado_en ? `⚠ VALE ANULADO el ${new Date(vale.anulado_en).toLocaleString("es")} — este documento ya NO es válido.` : null,
  };
}
```

- [ ] **Step 3: Ampliar `ReciboImprimible.tsx` para la variante "deuda"**

Cambiar la línea del `variante` en `ReciboImprimibleProps` (buscar `variante?: "ingreso" | "egreso";`):

```typescript
  // Solo aplica a tipo "movimiento" ("ingreso"/"egreso") o tipo "vale" ("deuda").
  variante?: "ingreso" | "egreso" | "deuda";
```

Buscar `const esVale = tipo === "vale";` y agregar justo debajo:

```typescript
  const esDeuda = esVale && variante === "deuda";
```

Cambiar el bloque de `franjaTexto` (buscar `: esVale`), agregando el caso de deuda antes del `"VALE"`:

```typescript
  const franjaTexto = esCotizacion
    ? "COTIZACIÓN — NO es una factura de venta"
    : esResumen
      ? "RESUMEN DE CAJA"
      : esComprobantePropina
        ? "COMPROBANTE DE ENTREGA DE PROPINA"
        : esVale
          ? esDeuda
            ? "DEUDA"
            : "VALE"
          : esMovimiento
            ? esEgreso
              ? "COMPROBANTE DE EGRESO"
              : "COMPROBANTE DE INGRESO"
            : "FACTURA DE VENTA";
```

Cambiar el bloque de `tituloDocumento` igual:

```typescript
  const tituloDocumento = esCotizacion
    ? "Cotización"
    : esComprobantePropina
      ? "Comprobante de propina"
      : esVale
        ? esDeuda
          ? "Deuda"
          : "Vale"
        : esMovimiento
          ? "Comprobante"
          : esResumen
            ? null
            : "Factura";
```

Cambiar el bloque de la firma (buscar `{(esComprobantePropina || esVale) && (`):

```tsx
      {(esComprobantePropina || esVale) && (
        <div className="mt-6 text-[16px]">
          <div className="border-t border-black pt-1 text-center">
            {esDeuda ? "Firma de quien reconoce la deuda" : "Firma de quien recibe"}
          </div>
          <div className="mt-1 text-center text-[13px]">C.C.: _______________________</div>
        </div>
      )}
```

- [ ] **Step 4: Verificar que compila todo**

```bash
cd frontend && npx tsc -b && npm run build && cd ../backend && npx tsc --noEmit && echo "tsc OK (frontend + backend)"
```

Esperado: build exitoso, `tsc OK (frontend + backend)`.

- [ ] **Step 5: Verificación manual end-to-end completa**

Sin base de datos alcanzable en este entorno (ver Global Constraints) — lista para que el usuario la corrobore una vez corrida la migración, en Caja con un turno abierto, logueado como Root o Super Root:

1. Crear una deuda CON préstamo (fuente turno) → debe generar un egreso en Caja con motivo "Vale V-...", y en el detalle debe verse el botón "Marcar como cobrada" (no "Marcar como repuesto", salvo que la fuente sea "dueno").
2. Marcar esa deuda como cobrada, eligiendo efectivo puro → debe generar un ingreso en Caja con motivo "Cobro de deuda — vale V-...", y el detalle debe mostrar "Cobrado el: ...".
3. Crear una deuda SIN préstamo (toggle "No, solo se debe", solo monto) → confirmar que NO aparece ningún movimiento en Caja al crearla.
4. Cobrar esa deuda eligiendo "Banco" sin escribir la referencia de 4 caracteres → debe rechazarse pidiendo la referencia (al revés que crear un vale, que nunca la pide).
5. Llamar `POST /vales/:id/cobrar` directo (curl, no desde el formulario) con un monto distinto al adeudado (ej. una deuda de $50.000 con `{"metodoPago":"efectivo","monto":40000}`) → debe rechazarse con el mensaje "El monto a cobrar debe ser exactamente lo que se debe (...)", sin generar ningún ingreso ni marcar la deuda como cobrada.
6. Anular una deuda ya cobrada (con préstamo de por medio) → confirmar que se revierten TANTO el préstamo original como el cobro — ningún movimiento vivo en Caja relacionado con esa deuda.
7. Intentar cobrar una deuda sin turno abierto (cerrar el turno primero) → debe rechazarse con "No hay un turno de caja abierto", igual que al crear un vale con fuente turno.
8. Imprimir una deuda pendiente → el encabezado debe decir "DEUDA" y "Pendiente de cobro"; la firma debe decir "Firma de quien reconoce la deuda". Imprimir la misma ya cobrada → debe decir "Cobrada".
9. Confirmar que un vale "pago" normal (los que ya existían antes de esta extensión) sigue funcionando exactamente igual — crear uno, reponerlo si es de dueño, anularlo, imprimirlo.

- [ ] **Step 6: Commit y push final**

```bash
git add frontend/src/modules/vales/pages/DetalleValePage.tsx frontend/src/modules/vales/factura.ts frontend/src/shared/components/ReciboImprimible.tsx
git commit -m "feat(vales): cobrar deuda + impresión — extensión Deudas completa"
git push
```
