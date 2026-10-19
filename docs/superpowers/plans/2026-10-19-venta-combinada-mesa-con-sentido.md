# Venta combinada: mesa de Migao + productos Con Sentido — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vincular un carrito de productos Con Sentido al cobro (con partes/abonos) de una mesa de Migao, con descuento y pago parcial/diferido independientes para cada lado, propina solo sobre la porción de mesa, y factura separada para cada uno al cerrar.

**Architecture:** El vínculo vive en `con_sentido_ventas.parte_id` (nueva columna, FK a `migao_cuenta_partes`). Mientras se arma el carrito, esa venta está en `estado='pendiente'` (sin `metodo_pago`, sin factura). Cada abono sobre la parte reparte su monto proporcionalmente entre el pendiente de mesa y el pendiente de tienda, registra un ingreso en Caja General para cada lado, y cuando el lado de tienda llega a 0 se marca `'completada'` y recién ahí se le asigna número de factura — exactamente igual a como ya funciona el lado de mesa hoy.

**Tech Stack:** Node/Express/TypeScript, SQL estilo Postgres sobre MySQL 8 (shim existente, no se toca), Zod, React/TypeScript en el frontend.

**Spec:** `docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md`

## Global Constraints

- Sin framework de tests en este proyecto: cada tarea se verifica con `tsc --noEmit` (backend) / `tsc -b` (frontend) + verificación manual real contra la base de datos local (`sistemapos` en MySQL 8.4.11, puerto 3306, usuario `root`/`1429`) y el backend corriendo en `http://localhost:4000` — a diferencia de planes anteriores de este proyecto, ESTA sesión sí tiene una base de datos local alcanzable, así que los pasos de verificación usan `curl`/consultas SQL reales, no solo lectura de código.
- Todo el SQL nuevo usa el dialecto Postgres existente (`$1`, `RETURNING`, etc.) — el shim lo traduce a MySQL en tiempo de ejecución, igual que el resto del código. No tocar el shim.
- Reusar siempre las utilidades ya existentes: `Errors.*` (`shared/utils/app-error`), `descomponerPago`/`exigirReferenciaBanco`/`exigirMontoRecibidoEfectivo` (`shared/utils/pago-mixto`), el tipo `Executor = Pool | PoolClient`.
- Toda migración nueva va en `database/mysql/migraciones/`, reflejada también en `database/mysql/schema.sql` y `database/mysql/seed.sql` (los archivos nativos de MySQL de este repo). No se pide al usuario que la corra a mano en producción dentro de este plan — eso es una decisión aparte, posterior a que el usuario revise el resultado.
- Nuevo permiso: `con_sentido.ventas.vincular_mesa`, otorgado al rol Cajero (Root/Super Root ya lo tienen por sus reglas "todos los permisos").

## Review Focus

- Doble clic / carrera: dos requests casi simultáneos vinculando/editando el carrito de la misma parte — debe comportarse igual que `iniciarCobro` (lock `FOR UPDATE` sobre la parte antes de leer/escribir su carrito).
- Un abono cuyo monto supera el pendiente de mesa solo pero no el combinado (o viceversa) — la validación de "no puede superar el pendiente" debe comparar contra mesa+tienda, nunca contra mesa sola.
- Editar (reemplazar) el carrito de una parte que ya tiene algo de tienda pagado — debe rechazarse, igual que ya se rechaza agregar ítems a una mesa con cobro dividido abierto.
- Redondeo de la proporción en un caso no divisible limpio (ej. pendiente mesa=33333, pendiente tienda=16667, abono=10000) — la suma de los dos montos repartidos debe dar EXACTO el monto del abono.
- Cancelar una orden con un carrito de tienda pendiente SIN pagos (debe anularse y devolver stock) vs. con algún pago de tienda ya registrado aunque la mesa no tenga nada pagado (debe rechazarse igual que hoy se rechaza por pagos de mesa).

---

### Task 1: Migración — columnas nuevas en `con_sentido_ventas` + permiso nuevo

**Files:**
- Create: `database/mysql/migraciones/2026-10-19_venta_combinada_mesa_con_sentido.sql`
- Modify: `database/mysql/schema.sql` (reflejar las mismas columnas/constraint en la definición de `con_sentido_ventas`, y agregar el permiso a los INSERT de `permisos`/`roles_permisos` si ese archivo los trae — confirmar primero con `grep -n "con_sentido_ventas\|INSERT INTO permisos" database/mysql/schema.sql`, ya que en este repo el permiso real vive en `database/mysql/seed.sql`, no en `schema.sql`)
- Modify: `database/mysql/seed.sql` (agregar el INSERT del permiso nuevo + el GRANT a Cajero)

**Interfaces:**
- Produces: columnas `con_sentido_ventas.parte_id` (CHAR(36) NULL, FK a `migao_cuenta_partes.id`), `con_sentido_ventas.descuento_porcentaje` (DECIMAL(5,2) NULL DEFAULT 0), `con_sentido_ventas.descuento` (DECIMAL(12,2) NULL DEFAULT 0); `con_sentido_ventas.metodo_pago` pasa a NULLABLE (hoy es NOT NULL); el CHECK de `estado` pasa a permitir `'pendiente'`; permiso `con_sentido.ventas.vincular_mesa` en la tabla `permisos`, otorgado a Cajero en `roles_permisos`.

- [ ] **Step 1: Confirmar el nombre real del CHECK de `estado` en la base local**

Run: `/usr/local/opt/mysql@8.4/bin/mysql -h127.0.0.1 -uroot -p1429 sistemapos -e "SHOW CREATE TABLE con_sentido_ventas\G" 2>&1 | grep -i check`
Expected: una línea `CONSTRAINT \`con_sentido_ventas_chk_2\` CHECK ((\`estado\` in (_utf8mb4'completada',_utf8mb4'anulada')))` (ya confirmado en el diseño; si el nombre difiere, usar el real en el Step 2).

- [ ] **Step 2: Escribir la migración**

```sql
ALTER TABLE con_sentido_ventas
  ADD COLUMN parte_id CHAR(36) NULL,
  ADD COLUMN descuento_porcentaje DECIMAL(5,2) NULL DEFAULT 0,
  ADD COLUMN descuento DECIMAL(12,2) NULL DEFAULT 0,
  MODIFY metodo_pago VARCHAR(20) NULL,
  ADD CONSTRAINT fk_con_sentido_ventas_parte FOREIGN KEY (parte_id) REFERENCES migao_cuenta_partes(id);

ALTER TABLE con_sentido_ventas DROP CHECK con_sentido_ventas_chk_2;
ALTER TABLE con_sentido_ventas
  ADD CONSTRAINT chk_con_sentido_ventas_estado CHECK (estado IN ('pendiente', 'completada', 'anulada'));

INSERT INTO permisos (modulo_id, accion, codigo) VALUES
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'vincular_mesa', 'con_sentido.ventas.vincular_mesa');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cajero'), id FROM permisos WHERE codigo = 'con_sentido.ventas.vincular_mesa';
```

- [ ] **Step 3: Aplicar la migración a la base local y verificar**

Run: `/usr/local/opt/mysql@8.4/bin/mysql -h127.0.0.1 -uroot -p1429 sistemapos < database/mysql/migraciones/2026-10-19_venta_combinada_mesa_con_sentido.sql && /usr/local/opt/mysql@8.4/bin/mysql -h127.0.0.1 -uroot -p1429 sistemapos -e "DESCRIBE con_sentido_ventas; SELECT codigo FROM permisos WHERE codigo='con_sentido.ventas.vincular_mesa'; SELECT p.codigo FROM roles_permisos rp JOIN roles r ON r.id=rp.rol_id JOIN permisos p ON p.id=rp.permiso_id WHERE r.nombre='Cajero' AND p.codigo='con_sentido.ventas.vincular_mesa';"`
Expected: `parte_id`/`descuento_porcentaje`/`descuento` aparecen en la salida de `DESCRIBE`, `metodo_pago` con `Null = YES`, y las dos últimas consultas devuelven una fila cada una (no vacío).

- [ ] **Step 4: Reflejar los mismos cambios en `database/mysql/schema.sql` y el permiso en `database/mysql/seed.sql`**

Mismo contenido que el Step 2, en el formato de definición de tabla/INSERT que ya usa cada archivo (no una migración `ALTER`, sino la definición final).

- [ ] **Step 5: Commit**

```bash
git add database/mysql/migraciones/2026-10-19_venta_combinada_mesa_con_sentido.sql database/mysql/schema.sql database/mysql/seed.sql
git commit -m "feat(con-sentido): columnas de vínculo a mesa + permiso vincular_mesa"
```

---

### Task 2: `con_sentido.schema.ts` + `con_sentido.repository.ts` — carrito de tienda

**Files:**
- Modify: `backend/src/modules/con_sentido/con_sentido.schema.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.repository.ts`

**Interfaces:**
- Consumes: `descontarParaVenta`/`motivoVenta` (`./stock-venta.ts`, ya existen), `reponerStock`/`crearVentaItem`/`getOrCrearFactura` (ya existen en este mismo archivo).
- Produces:
  - `vincularCarritoTiendaSchema` → `{ items: {productoId: string; cantidad: number; precioUnitario: number; observacionInventario?: string}[]; descuentoPorcentaje?: number }`, tipo `VincularCarritoTiendaInput`.
  - `vincularMesaSchema` → `{ ordenId: string; parteId?: string; items: [...mismo shape]; descuentoPorcentaje?: number }`, tipo `VincularMesaInput`.
  - `getCarritoTiendaPorParte(parteId: string, executor?: Executor): Promise<CarritoTienda | null>` donde `CarritoTienda = { ventaId: string; estado: "pendiente"|"completada"; items: {productoId: string|null; nombre: string; cantidad: number; precioUnitario: number; subtotal: number}[]; descuentoPorcentaje: number; descuentoMonto: number; monto: number; pagado: number; pendiente: number }`.
  - `crearCarritoTienda(client: PoolClient, parteId: string, usuarioId: string): Promise<{id: string}>`.
  - `reemplazarCarritoTienda(client: PoolClient, params: {ventaId: string; items: VincularCarritoTiendaInput["items"]; descuentoPorcentaje: number}): Promise<{subtotal: number; descuentoMonto: number; monto: number}>`.
  - `marcarCarritoCompletado(client: PoolClient, ventaId: string, pago: {metodoPago: "efectivo"|"banco"|"mixto"; montoEfectivo: number; montoBanco: number}): Promise<void>`.
  - `anularCarritosTiendaPorOrden(client: PoolClient, ordenId: string): Promise<void>`.
  - `existenPagosTiendaPorOrden(ordenId: string): Promise<boolean>`.

- [ ] **Step 1: Agregar los schemas Zod**

```ts
const itemCarritoTiendaSchema = z.object({
  productoId: z.string().uuid(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative(),
  observacionInventario: z.string().trim().max(500).optional(),
});
export const vincularCarritoTiendaSchema = z.object({
  items: z.array(itemCarritoTiendaSchema).min(1, "Agrega al menos un producto"),
  descuentoPorcentaje: z.number().min(0).max(100).optional(),
});
export type VincularCarritoTiendaInput = z.infer<typeof vincularCarritoTiendaSchema>;

export const vincularMesaSchema = z.object({
  ordenId: z.string().uuid(),
  parteId: z.string().uuid().optional(),
  items: z.array(itemCarritoTiendaSchema).min(1, "Agrega al menos un producto"),
  descuentoPorcentaje: z.number().min(0).max(100).optional(),
});
export type VincularMesaInput = z.infer<typeof vincularMesaSchema>;
```

- [ ] **Step 2: Implementar `getCarritoTiendaPorParte`**

```ts
export async function getCarritoTiendaPorParte(parteId: string, executor: Executor = pool) {
  const ventaResult = await executor.query(
    `SELECT id, estado, monto, descuento_porcentaje, descuento
       FROM con_sentido_ventas WHERE parte_id = $1 AND estado != 'anulada'`,
    [parteId],
  );
  if (!ventaResult.rowCount) return null;
  const venta = ventaResult.rows[0];

  const itemsResult = await executor.query(
    `SELECT producto_id, producto, cantidad, precio_unitario, subtotal
       FROM con_sentido_venta_items WHERE venta_id = $1 ORDER BY id ASC`,
    [venta.id],
  );
  const pagadoResult = await executor.query(
    `SELECT COALESCE(SUM(monto), 0) AS pagado FROM movimientos_caja
      WHERE referencia_entidad = 'con_sentido_ventas' AND referencia_id = $1`,
    [venta.id],
  );

  const monto = Number(venta.monto);
  const pagado = Number(pagadoResult.rows[0].pagado);
  return {
    ventaId: venta.id as string,
    estado: venta.estado as "pendiente" | "completada",
    items: itemsResult.rows.map((i) => ({
      productoId: i.producto_id as string | null,
      nombre: i.producto as string,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
    })),
    descuentoPorcentaje: Number(venta.descuento_porcentaje ?? 0),
    descuentoMonto: Number(venta.descuento ?? 0),
    monto,
    pagado,
    pendiente: Math.max(0, monto - pagado),
  };
}
```

- [ ] **Step 3: Implementar `crearCarritoTienda`**

```ts
export async function crearCarritoTienda(client: PoolClient, parteId: string, usuarioId: string) {
  const result = await client.query(
    `INSERT INTO con_sentido_ventas (usuario_id, monto, metodo_pago, estado, parte_id, descuento_porcentaje, descuento)
     VALUES ($1, 0, NULL, 'pendiente', $2, 0, 0) RETURNING id`,
    [usuarioId, parteId],
  );
  return result.rows[0];
}
```

- [ ] **Step 4: Implementar `reemplazarCarritoTienda`** (quita stock de los ítems que ya no están, descuenta el de los nuevos, recalcula monto)

```ts
export async function reemplazarCarritoTienda(
  client: PoolClient,
  params: { ventaId: string; items: VincularCarritoTiendaInput["items"]; descuentoPorcentaje: number },
) {
  const existentes = await client.query(
    `SELECT producto_id, cantidad FROM con_sentido_venta_items WHERE venta_id = $1`,
    [params.ventaId],
  );
  for (const fila of existentes.rows) {
    if (fila.producto_id) await reponerStock(client, fila.producto_id, Number(fila.cantidad));
  }
  await client.query(`DELETE FROM con_sentido_venta_items WHERE venta_id = $1`, [params.ventaId]);

  let subtotal = 0;
  for (const item of params.items) {
    const vendido = await descontarParaVenta(client, {
      productoId: item.productoId,
      cantidad: item.cantidad,
      nombre: "producto",
      observacion: item.observacionInventario,
    });
    if (!vendido) throw Errors.badRequest("Uno de los productos del carrito ya no está en el catálogo");
    await crearVentaItem(client, {
      ventaId: params.ventaId,
      productoId: vendido.producto.id,
      sku: vendido.producto.sku,
      producto: vendido.producto.nombre,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      observacionInventario: vendido.observacion,
    });
    subtotal += item.cantidad * item.precioUnitario;
  }

  const descuentoMonto = Math.round(subtotal * (params.descuentoPorcentaje / 100) * 100) / 100;
  const monto = subtotal - descuentoMonto;
  await client.query(
    `UPDATE con_sentido_ventas SET monto = $2, descuento_porcentaje = $3, descuento = $4 WHERE id = $1`,
    [params.ventaId, monto, params.descuentoPorcentaje, descuentoMonto],
  );
  return { subtotal, descuentoMonto, monto };
}
```

Importar `Errors` de `../../shared/utils/app-error` en este archivo (hoy no se usa ahí — confirmar con `grep -n "^import" con_sentido.repository.ts` antes de agregar el import duplicado).

- [ ] **Step 5: Implementar `marcarCarritoCompletado`, `anularCarritosTiendaPorOrden`, `existenPagosTiendaPorOrden`**

```ts
export async function marcarCarritoCompletado(
  client: PoolClient,
  ventaId: string,
  pago: { metodoPago: "efectivo" | "banco" | "mixto"; montoEfectivo: number; montoBanco: number },
) {
  await client.query(
    `UPDATE con_sentido_ventas SET estado = 'completada', metodo_pago = $2, monto_efectivo = $3, monto_banco = $4 WHERE id = $1`,
    [ventaId, pago.metodoPago, pago.montoEfectivo, pago.montoBanco],
  );
}

export async function anularCarritosTiendaPorOrden(client: PoolClient, ordenId: string) {
  const result = await client.query(
    `SELECT cv.id FROM con_sentido_ventas cv
       JOIN migao_cuenta_partes cp ON cp.id = cv.parte_id
       JOIN ventas v ON v.id = cp.venta_id
      WHERE v.orden_id = $1 AND cv.estado = 'pendiente'`,
    [ordenId],
  );
  for (const row of result.rows) {
    const items = await client.query(
      `SELECT producto_id, cantidad FROM con_sentido_venta_items WHERE venta_id = $1`,
      [row.id],
    );
    for (const item of items.rows) {
      if (item.producto_id) await reponerStock(client, item.producto_id, Number(item.cantidad));
    }
    await client.query(`UPDATE con_sentido_ventas SET estado = 'anulada' WHERE id = $1`, [row.id]);
  }
}

export async function existenPagosTiendaPorOrden(ordenId: string) {
  const result = await pool.query(
    `SELECT 1 FROM movimientos_caja mc
       JOIN con_sentido_ventas cv ON cv.id = mc.referencia_id
       JOIN migao_cuenta_partes cp ON cp.id = cv.parte_id
       JOIN ventas v ON v.id = cp.venta_id
      WHERE mc.referencia_entidad = 'con_sentido_ventas' AND v.orden_id = $1 LIMIT 1`,
    [ordenId],
  );
  return result.rowCount! > 0;
}
```

- [ ] **Step 6: Verificar tipos**

Run: `cd backend && npx tsc --noEmit && echo "tsc --noEmit: sin errores"`
Expected: `tsc --noEmit: sin errores` (sin errores de compilación — todavía no hay nada que use estas funciones, así que no debe haber unused-export warnings con la config actual).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/con_sentido/con_sentido.schema.ts backend/src/modules/con_sentido/con_sentido.repository.ts
git commit -m "feat(con-sentido): funciones de repositorio y schemas para el carrito de tienda vinculado a una mesa"
```

---

### Task 3: `con_sentido.service.ts` — `vincularCarritoTienda` y `vincularMesa`

**Files:**
- Modify: `backend/src/modules/con_sentido/con_sentido.service.ts`

**Interfaces:**
- Consumes: todo lo producido en Task 2; `migaoRepo.getVentaAbiertaPorOrden`, `migaoRepo.getCuentaPorOrden` (ya existen en `migao.repository.ts` — importar como `import * as migaoRepo from "../migao/migao.repository"`); `migaoService.iniciarCobro` (`import * as migaoService from "../migao/migao.service"`).
- Produces:
  - `vincularCarritoTienda(parteId: string, input: VincularCarritoTiendaInput, usuarioId: string): Promise<{ventaId: string; subtotal: number; descuentoMonto: number; monto: number}>`.
  - `vincularMesa(input: VincularMesaInput, usuarioId: string): Promise<{ventaId: string; parteId: string; subtotal: number; descuentoMonto: number; monto: number}>`.

- [ ] **Step 1: Implementar `vincularCarritoTienda`**

Lockea la parte (`FOR UPDATE`, mismo patrón que `migao.service.ts::registrarAbono`), rechaza si el carrito existente ya tiene algo pagado (`carrito.pagado > 0`), crea el carrito si no existe, reemplaza sus ítems.

```ts
export async function vincularCarritoTienda(parteId: string, input: VincularCarritoTiendaInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const parteResult = await client.query(`SELECT id FROM migao_cuenta_partes WHERE id = $1 FOR UPDATE`, [parteId]);
    if (!parteResult.rowCount) throw Errors.notFound("Parte de cuenta no encontrada");

    let carrito = await repo.getCarritoTiendaPorParte(parteId, client);
    if (carrito && carrito.pagado > 0) {
      throw Errors.conflict("Ya se registraron pagos para el carrito de tienda de esta parte, no se puede editar");
    }
    if (!carrito) {
      const nuevo = await repo.crearCarritoTienda(client, parteId, usuarioId);
      carrito = { ventaId: nuevo.id } as Awaited<ReturnType<typeof repo.getCarritoTiendaPorParte>> & { ventaId: string };
    }

    const resultado = await repo.reemplazarCarritoTienda(client, {
      ventaId: carrito.ventaId,
      items: input.items,
      descuentoPorcentaje: input.descuentoPorcentaje ?? 0,
    });

    await client.query("COMMIT");
    return { ventaId: carrito.ventaId, ...resultado };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Implementar `vincularMesa`**

Si la orden no tiene cobro iniciado, lo inicia con una sola parte (`division: {modo:"igual", numPartes:1}`); si ya tiene varias partes y no llega `parteId`, rechaza pidiendo que se especifique.

```ts
export async function vincularMesa(input: VincularMesaInput, usuarioId: string) {
  const ventaAbierta = await migaoRepo.getVentaAbiertaPorOrden(input.ordenId);
  if (!ventaAbierta) {
    await migaoService.iniciarCobro(input.ordenId, { division: { modo: "igual", numPartes: 1 } }, usuarioId);
  }

  const cuenta = await migaoRepo.getCuentaPorOrden(input.ordenId);
  if (!cuenta) throw Errors.notFound("Esta orden no tiene un cobro iniciado");

  let parteId = input.parteId;
  if (!parteId) {
    if (cuenta.partes.length > 1) {
      throw Errors.badRequest("Esta mesa tiene la cuenta dividida — especifica a cuál parte vincular los productos");
    }
    parteId = cuenta.partes[0].id;
  } else if (!cuenta.partes.some((p) => p.id === parteId)) {
    throw Errors.badRequest("Esa parte no corresponde a esta mesa");
  }

  const resultado = await vincularCarritoTienda(
    parteId,
    { items: input.items, descuentoPorcentaje: input.descuentoPorcentaje },
    usuarioId,
  );
  return { ...resultado, parteId };
}
```

Agregar los imports nuevos al tope del archivo: `import { pool } from "../../shared/db/pool";` (ya existe), `import * as migaoRepo from "../migao/migao.repository";`, `import * as migaoService from "../migao/migao.service";`, y `VincularCarritoTiendaInput`/`VincularMesaInput` al bloque de imports de `./con_sentido.schema`.

- [ ] **Step 3: Verificar tipos**

Run: `cd backend && npx tsc --noEmit && echo "tsc --noEmit: sin errores"`
Expected: `tsc --noEmit: sin errores`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/con_sentido/con_sentido.service.ts
git commit -m "feat(con-sentido): orquesta vincular/reemplazar el carrito de tienda de una parte o de una mesa"
```

---

### Task 4: `migao.repository.ts::getCuentaPorOrden` — agregar el campo `tienda` por parte

**Files:**
- Modify: `backend/src/modules/migao/migao.repository.ts:1021-1094` (función `getCuentaPorOrden`)

**Interfaces:**
- Consumes: `conSentidoRepo.getCarritoTiendaPorParte` (Task 2). Importar al tope del archivo: `import * as conSentidoRepo from "../con_sentido/con_sentido.repository";`.
- Produces: `getCuentaPorOrden(ordenId: string)` ahora devuelve, por cada elemento de `partes`, un campo adicional `tienda: CarritoTienda | null` (mismo tipo que exporta Task 2).

- [ ] **Step 1: Cambiar el `.map` de `partes` (línea ~1066) por un `Promise.all` que agregue `tienda`**

```ts
const partes = await Promise.all(
  partesResult.rows.map(async (p) => ({
    id: p.id as string,
    indice: p.indice as number,
    modo: p.modo as "producto" | "igual",
    montoDebido: Number(p.monto_debido),
    montoPagado: Number(p.monto_pagado),
    pendiente: Math.max(0, Number(p.monto_debido) - Number(p.monto_pagado)),
    unidades: (unidadesPorParte.get(p.id) ?? []).map((u) => ({
      itemId: Number(u.orden_item_id),
      cantidad: Number(u.cantidad),
      productoNombre: u.producto_nombre as string,
    })),
    tienda: await conSentidoRepo.getCarritoTiendaPorParte(p.id),
  })),
);
```

(El resto de la función, incluido el `return { venta, ordenEstado, partes, pagos, propinas }` final, no cambia — `partes` ya es la nueva variable `await`eada.)

- [ ] **Step 2: Verificar manualmente contra la base local**

Run: `curl -s -X POST http://localhost:4000/api/v1/auth/login -H "Content-Type: application/json" -d '{"identificador":"admin@sistemapos.local","password":"SuperRoot2026!"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.accessToken))"` (guardar el token), luego crear una orden de prueba en una mesa libre, iniciar su cobro (`POST /migao/ordenes/:id/cobro` con `{"division":{"modo":"igual","numPartes":1}}`), y `GET /migao/ordenes/:id/cobro`.
Expected: la respuesta incluye, dentro de `partes[0]`, la clave `"tienda": null` (todavía no se ha vinculado ningún carrito).

- [ ] **Step 3: Verificar tipos**

Run: `cd backend && npx tsc --noEmit && echo "tsc --noEmit: sin errores"`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/migao/migao.repository.ts
git commit -m "feat(migao): obtenerCuenta incluye el carrito de tienda vinculado a cada parte"
```

---

### Task 5: `migao.service.ts::registrarAbono` — reparto proporcional mesa/tienda

**Files:**
- Modify: `backend/src/modules/migao/migao.service.ts:1453-1597` (función `registrarAbono`)

**Interfaces:**
- Consumes: `conSentidoRepo.getCarritoTiendaPorParte`, `conSentidoRepo.marcarCarritoCompletado` (Task 2); `conSentidoRepo.getOrCrearFactura` ya existe con firma `{ventaId, subtotal, total}`.
- Produces: `registrarAbono` ahora valida el pendiente COMBINADO (mesa + tienda), reparte el abono proporcionalmente, y completa/factura el carrito de tienda cuando corresponde. La forma de la respuesta no cambia (sigue devolviendo `{...cuenta, alertasInventario}}`, y `cuenta.partes[].tienda` ya refleja el nuevo estado gracias a Task 4).

- [ ] **Step 1: Después de calcular `pendiente` (línea ~1476), obtener el carrito de tienda y el pendiente combinado**

```ts
const carritoTienda = await conSentidoRepo.getCarritoTiendaPorParte(parteId, client);
const pendienteTienda = carritoTienda?.pendiente ?? 0;
const pendienteTotal = pendiente + pendienteTienda;
if (pendienteTotal <= 0.001) throw Errors.conflict("Esta parte ya está completamente pagada");
```

(Elimina el `if (pendiente <= 0.001) throw ...` existente justo arriba — ahora el chequeo de "ya pagada" es sobre `pendienteTotal`.)

- [ ] **Step 2: Cambiar la validación de "el abono no puede superar el pendiente" para usar `pendienteTotal`**

La línea `if (montoAbono - pendiente > 0.01) throw Errors.badRequest(...)` pasa a comparar contra `pendienteTotal` (mismo mensaje, cambiando `pendiente` por `pendienteTotal` en el texto).

- [ ] **Step 3: Calcular el reparto proporcional y usar `montoMesaAbono` en vez de `montoAbono` para todo lo que sigue del lado de mesa**

```ts
const proporcionTienda = pendienteTotal > 0 ? pendienteTienda / pendienteTotal : 0;
const montoTiendaAbono = Math.round(montoAbono * proporcionTienda * 100) / 100;
const montoMesaAbono = montoAbono - montoTiendaAbono;
```

Reemplazar cada uso posterior de `montoAbono` en el cálculo de `lineas` (el `descomponerPago({..., monto: montoAbono})` del caso no-mixto, y el `montoAbono` dentro del caso mixto) por `montoMesaAbono`. La propina (`input.propina`) NO cambia — sigue calculándose solo sobre lo que entra del lado de mesa, que es exactamente `montoMesaAbono` y sus líneas ya decompuestas (esto ya es así hoy porque `propina` nunca se mezcla con `monto` en el código existente — confirmar que el bloque de propina sigue usando `lineas`, no `montoAbono`, tras el cambio).

- [ ] **Step 4: Si `montoTiendaAbono > 0`, registrar el ingreso del lado de tienda**

Justo después del `for (const linea of lineas) { ... }` del lado de mesa (antes del bloque de propina), agregar:

```ts
if (montoTiendaAbono > 0 && carritoTienda) {
  const ingresoTienda =
    input.metodoPago === "mixto"
      ? (() => {
          const entregado = input.montoEfectivo + input.montoBanco;
          const efectivo = entregado > 0 ? Math.round(montoTiendaAbono * (input.montoEfectivo / entregado) * 100) / 100 : 0;
          return { metodoPago: "mixto" as const, montoEfectivo: efectivo, montoBanco: montoTiendaAbono - efectivo };
        })()
      : { metodoPago: input.metodoPago, monto: montoTiendaAbono };

  await cajaService.registrarIngreso(
    {
      moduloOrigenSlug: "con_sentido",
      referenciaEntidad: "con_sentido_ventas",
      referenciaId: carritoTienda.ventaId,
      referenciaBanco: input.referenciaBanco,
      ...ingresoTienda,
    } as Parameters<typeof cajaService.registrarIngreso>[0],
    usuarioId,
    client,
  );

  const pagadoPorMetodo = await client.query(
    `SELECT metodo_pago, COALESCE(SUM(monto), 0) AS monto FROM movimientos_caja
      WHERE referencia_entidad = 'con_sentido_ventas' AND referencia_id = $1 GROUP BY metodo_pago`,
    [carritoTienda.ventaId],
  );
  const efectivoAcumulado = Number(pagadoPorMetodo.rows.find((r) => r.metodo_pago === "efectivo")?.monto ?? 0);
  const bancoAcumulado = Number(pagadoPorMetodo.rows.find((r) => r.metodo_pago === "banco")?.monto ?? 0);
  const pagadoTiendaTotal = efectivoAcumulado + bancoAcumulado;

  if (carritoTienda.monto - pagadoTiendaTotal <= 0.01) {
    await conSentidoRepo.marcarCarritoCompletado(client, carritoTienda.ventaId, {
      metodoPago: efectivoAcumulado > 0 && bancoAcumulado > 0 ? "mixto" : efectivoAcumulado > 0 ? "efectivo" : "banco",
      montoEfectivo: efectivoAcumulado,
      montoBanco: bancoAcumulado,
    });
    await conSentidoRepo.getOrCrearFactura(
      { ventaId: carritoTienda.ventaId, subtotal: carritoTienda.monto + carritoTienda.descuentoMonto, total: carritoTienda.monto },
      client,
    );
  }
}
```

Importar `conSentidoRepo` al tope de `migao.service.ts`: `import * as conSentidoRepo from "../con_sentido/con_sentido.repository";`.

- [ ] **Step 5: Verificar manualmente — abono que paga mesa y tienda a la vez**

Run (continuando el escenario de Task 4: orden con cobro iniciado en 1 parte): vincular un carrito de tienda a la parte (`PUT /migao/cuentas/partes/:parteId/carrito-tienda` con un producto Con Sentido existente — ver Task 7 para esta ruta; si Task 7 aún no existe, llamar directo a `conSentidoService.vincularCarritoTienda` desde una consulta temporal, o adelantar este chequeo hasta después de Task 7), luego `POST /migao/cuentas/partes/:parteId/abonos` con un monto que cubra TODO lo pendiente combinado.
Expected: la respuesta trae `partes[0].pendiente = 0` y `partes[0].tienda.estado = "completada"`; `GET /con-sentido/ventas/:ventaId/factura` (con el `ventaId` del carrito) devuelve una factura válida con `mesaNumero: null` y los ítems del carrito.

- [ ] **Step 6: Verificar el caso de redondeo (Review Focus)**

Con pendiente de mesa = 33333 y pendiente de tienda = 16667 (total 50000), registrar un abono de 10000.
Expected: `montoMesaAbono + montoTiendaAbono === 10000` exacto (revisar en los logs/respuesta de `movimientos_caja` para ese abono, sumando las dos líneas creadas).

- [ ] **Step 7: Verificar tipos**

Run: `cd backend && npx tsc --noEmit && echo "tsc --noEmit: sin errores"`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/migao/migao.service.ts
git commit -m "feat(migao): registrarAbono reparte proporcionalmente entre mesa y el carrito de tienda vinculado"
```

---

### Task 6: `migao.service.ts::cancelarOrden` — bloqueo/cancelación del carrito de tienda

**Files:**
- Modify: `backend/src/modules/migao/migao.service.ts:1606-` (función `cancelarOrden`)

**Interfaces:**
- Consumes: `conSentidoRepo.existenPagosTiendaPorOrden`, `conSentidoRepo.anularCarritosTiendaPorOrden` (Task 2, ya importado como `conSentidoRepo` desde Task 5).

- [ ] **Step 1: Ampliar el chequeo de pagos existentes**

Cambiar:
```ts
if (await repo.existenPagosPorOrden(ordenId)) {
  throw Errors.conflict(
    "Esta cuenta ya tiene pagos registrados — para cancelarla, anula la venta desde Caja General",
  );
}
```
por:
```ts
if (await repo.existenPagosPorOrden(ordenId) || await conSentidoRepo.existenPagosTiendaPorOrden(ordenId)) {
  throw Errors.conflict(
    "Esta cuenta ya tiene pagos registrados (de mesa o de tienda) — para cancelarla, anula la venta desde Caja General",
  );
}
```

- [ ] **Step 2: Anular los carritos de tienda pendientes antes del `COMMIT`**

Justo antes de `await client.query("COMMIT")` al final de `cancelarOrden`, agregar:
```ts
await conSentidoRepo.anularCarritosTiendaPorOrden(client, ordenId);
```

- [ ] **Step 3: Verificar manualmente**

Crear una orden nueva, iniciar su cobro, vincular un carrito de tienda (sin pagar nada), cancelar la orden (`POST /migao/ordenes/:id/cancelar`).
Expected: la cancelación responde 200/201 (no error), y `SELECT estado FROM con_sentido_ventas WHERE parte_id = '<parteId>'` en MySQL muestra `'anulada'`; el stock del producto vinculado volvió a su valor anterior.

- [ ] **Step 4: Verificar el rechazo cuando ya hay un pago de tienda**

Repetir el escenario pero registrando primero un abono que cubra (aunque sea parcialmente) el carrito de tienda, luego intentar cancelar.
Expected: `POST /migao/ordenes/:id/cancelar` responde 409 con el mensaje de "ya tiene pagos registrados".

- [ ] **Step 5: Verificar tipos**

Run: `cd backend && npx tsc --noEmit && echo "tsc --noEmit: sin errores"`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/migao/migao.service.ts
git commit -m "feat(migao): cancelarOrden también anula o bloquea según el carrito de tienda vinculado"
```

---

### Task 7: Rutas — las dos puertas

**Files:**
- Modify: `backend/src/modules/migao/migao.controller.ts` (nuevo `vincularCarritoTiendaController`, nuevo `obtenerFacturaTiendaDePartecontroller`)
- Modify: `backend/src/modules/migao/migao.routes.ts` (nuevas rutas `PUT /cuentas/partes/:parteId/carrito-tienda` y `GET /cuentas/partes/:parteId/factura-tienda`)
- Modify: `backend/src/modules/con_sentido/con_sentido.controller.ts` (nuevo `vincularMesaController`)
- Modify: `backend/src/modules/con_sentido/con_sentido.routes.ts` (nueva ruta `POST /vincular-mesa`)

**Interfaces:**
- Consumes: `conSentidoService.vincularCarritoTienda`/`vincularMesa`/`obtenerFacturaVenta` (Task 3 para los primeros dos; `obtenerFacturaVenta` ya existe en `con_sentido.service.ts`, firma `(ventaId: string)`); `conSentidoRepo.getCarritoTiendaPorParte` (Task 2) para resolver `parteId → ventaId`; patrón de controller existente (`asyncHandler`, `req.params`, `req.body`, helpers `ok`/`created` de `shared/utils/http-response` — confirmar el nombre exacto del helper con `grep -n "^import" migao.controller.ts | grep -i response`).
- Nota de permisos: el Cajero tiene `con_sentido.ventas.vincular_mesa` pero NO `con_sentido.ventas.ver` — por eso la factura del lado de tienda se expone bajo una ruta propia de Migao (`/cuentas/partes/:parteId/factura-tienda`), gateada por `con_sentido.ventas.vincular_mesa`, en vez de reusar `GET /con-sentido/ventas/:id/factura` (que exige el permiso general que el Cajero no tiene).

- [ ] **Step 1: Controller de Migao (Puerta 1)**

En `migao.controller.ts`, siguiendo el patrón de `registrarAbonoController` ya existente:
```ts
export async function vincularCarritoTiendaController(req: Request, res: Response) {
  const data = vincularCarritoTiendaSchema.parse(req.body);
  const resultado = await conSentidoService.vincularCarritoTienda(req.params.parteId, data, req.usuario!.id);
  return ok(res, resultado);
}
```
Agregar los imports: `import { vincularCarritoTiendaSchema } from "../con_sentido/con_sentido.schema";` y `import * as conSentidoService from "../con_sentido/con_sentido.service";` (verificar el nombre real de la propiedad del usuario autenticado en `req` — `req.usuario!.id` sigue el patrón que ya usan los demás controllers de este archivo; confirmar con `grep -n "req.usuario" migao.controller.ts | head -3`).

- [ ] **Step 2: Ruta de Migao**

En `migao.routes.ts`, junto a la ruta de `/cuentas/partes/:parteId/abonos`:
```ts
migaoRouter.put(
  "/cuentas/partes/:parteId/carrito-tienda",
  requirePermission("con_sentido.ventas.vincular_mesa"),
  asyncHandler(vincularCarritoTiendaController),
);
```

- [ ] **Step 2b: Controller y ruta para reimprimir la factura del lado de tienda**

En `migao.controller.ts`:
```ts
export async function obtenerFacturaTiendaDeParteController(req: Request, res: Response) {
  const carrito = await conSentidoRepo.getCarritoTiendaPorParte(req.params.parteId);
  if (!carrito) throw Errors.notFound("Esta parte no tiene un carrito de tienda vinculado");
  const factura = await conSentidoService.obtenerFacturaVenta(carrito.ventaId);
  return ok(res, factura);
}
```
En `migao.routes.ts`:
```ts
migaoRouter.get(
  "/cuentas/partes/:parteId/factura-tienda",
  requirePermission("con_sentido.ventas.vincular_mesa"),
  asyncHandler(obtenerFacturaTiendaDeParteController),
);
```
Importar `conSentidoRepo` igual que en Task 4/5 (ya debería estar importado en `migao.repository.ts`/`migao.service.ts`; en `migao.controller.ts` hace falta un import nuevo: `import * as conSentidoRepo from "../con_sentido/con_sentido.repository";`).

- [ ] **Step 3: Controller de Con Sentido (Puerta 2)**

En `con_sentido.controller.ts`:
```ts
export async function vincularMesaController(req: Request, res: Response) {
  const data = vincularMesaSchema.parse(req.body);
  const resultado = await service.vincularMesa(data, req.usuario!.id);
  return ok(res, resultado);
}
```

- [ ] **Step 4: Ruta de Con Sentido**

En `con_sentido.routes.ts`:
```ts
conSentidoRouter.post(
  "/vincular-mesa",
  requirePermission("con_sentido.ventas.vincular_mesa"),
  asyncHandler(vincularMesaController),
);
```

- [ ] **Step 5: Verificar manualmente las dos puertas**

Run: `curl` a `PUT /api/v1/migao/cuentas/partes/<parteId>/carrito-tienda` con un cuerpo `{"items":[{"productoId":"<id>","cantidad":1,"precioUnitario":25000}]}`, y por separado `curl` a `POST /api/v1/con-sentido/vincular-mesa` con `{"ordenId":"<id>","items":[...]}` sobre una mesa/orden distinta que no tenga cobro iniciado.
Expected: ambos devuelven 200/201 con `ventaId`/`monto`; `GET /api/v1/migao/ordenes/<ordenId>/cobro` refleja el carrito en ambos casos.

- [ ] **Step 6: Verificar tipos**

Run: `cd backend && npx tsc --noEmit && echo "tsc --noEmit: sin errores"`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/migao/migao.controller.ts backend/src/modules/migao/migao.routes.ts backend/src/modules/con_sentido/con_sentido.controller.ts backend/src/modules/con_sentido/con_sentido.routes.ts
git commit -m "feat: expone las dos puertas (Migao y Con Sentido) para vincular un carrito de tienda a una mesa"
```

---

### Task 8: Frontend — Puerta 1 (cobro de la mesa en Migao)

**Files:**
- Modify: `frontend/src/modules/migao/api.ts` (nueva función `vincularCarritoTienda`)
- Create: `frontend/src/modules/migao/components/CarritoTiendaModal.tsx`
- Modify: `frontend/src/modules/migao/pages/MigaoPage.tsx` (botón nuevo por parte + total combinado)

**Interfaces:**
- Consumes: `conSentidoApi.listarProductos()` (ya existe en `frontend/src/modules/con_sentido/api.ts`) para el buscador de productos dentro del modal.
- Produces: `migaoApi.vincularCarritoTienda(parteId: string, input: {items: {productoId:string; cantidad:number; precioUnitario:number}[]; descuentoPorcentaje?: number}): Promise<{ventaId: string; subtotal: number; descuentoMonto: number; monto: number}>`.

- [ ] **Step 1: `vincularCarritoTienda` en `migao/api.ts`**

Mismo patrón que las demás funciones de ese archivo (`PUT` con `apiClient`/`fetchJson` — confirmar el helper exacto leyendo el tope del archivo antes de escribir).

- [ ] **Step 2: `CarritoTiendaModal.tsx`**

Modal con: buscador de productos de Con Sentido (reusar la llamada `conSentidoApi.listarProductos()`, filtrando en el cliente por nombre — no hace falta un componente de búsqueda compartido para esta primera versión), lista de ítems agregados con cantidad/subtotal, campo de % de descuento, botón "Guardar carrito" que llama a `vincularCarritoTienda`. Recibe por props `parteId`, el carrito actual (`parte.tienda`, puede ser `null`) para precargar el estado, y un callback `onGuardado` para refrescar la cuenta.

- [ ] **Step 3: Botón y total combinado en `MigaoPage.tsx`**

Donde hoy se renderiza cada parte con su `pendiente`, agregar un botón "+ Agregar producto de la tienda" que abre `CarritoTiendaModal`, y sumar `parte.tienda?.pendiente ?? 0` al monto que se usa como tope/sugerido del campo de abono.

- [ ] **Step 3b: Botón de factura de tienda cuando ya está completada**

Cuando `parte.tienda?.estado === "completada"`, mostrar junto al botón de factura de la mesa (reusar `BotonFactura.tsx` si su interfaz lo permite, o un botón equivalente) uno que llame a `GET /migao/cuentas/partes/:parteId/factura-tienda` (Task 7, Step 2b) y abra el mismo visor/impresión de factura que ya usa la mesa.

- [ ] **Step 4: Verificar**

Run: `cd frontend && npm run build`
Expected: build sin errores de TypeScript.

Verificación manual en el navegador (`http://localhost:5173`, sesión como Cajero o Super Root): abrir el cobro de una mesa con cobro iniciado, agregar un producto Con Sentido desde el botón nuevo, confirmar que el total a abonar sube por el valor del producto.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/migao/api.ts frontend/src/modules/migao/components/CarritoTiendaModal.tsx frontend/src/modules/migao/pages/MigaoPage.tsx
git commit -m "feat(migao): agrega productos de Con Sentido al cobro de una mesa desde el cobro mismo"
```

---

### Task 9: Frontend — Puerta 2 (venta de Con Sentido vinculada a una mesa)

**Files:**
- Modify: `frontend/src/modules/con_sentido/api.ts` (nueva función `vincularMesa`)
- Create: `frontend/src/modules/con_sentido/components/SelectorMesaVisual.tsx`
- Modify: `frontend/src/modules/con_sentido/components/NuevaVentaModal.tsx` (paso opcional "¿Vincular a una mesa?")

**Interfaces:**
- Consumes: `migaoApi.listarMesas()`/`migaoApi.listarOrdenesAbiertas()` (ya existen en `frontend/src/modules/migao/api.ts`) para mostrar número/piso/estado/capacidad de cada mesa y cuál tiene una orden abierta.
- Produces: `conSentidoApi.vincularMesa(input: {ordenId: string; parteId?: string; items: [...]; descuentoPorcentaje?: number})`.

- [ ] **Step 1: `vincularMesa` en `con_sentido/api.ts`**

Mismo patrón que `registrarVenta` en ese archivo.

- [ ] **Step 2: `SelectorMesaVisual.tsx`**

Grilla/lista de mesas (número, piso, estado, capacidad) — no es necesario replicar el plano visual con posiciones x/y de `MigaoPage.tsx` para esta primera versión; una grilla simple agrupada por piso ya cumple "todo visual, con detalles de la mesa". Recibe `onElegirMesa(ordenId: string)` — solo habilita elegir mesas que tengan una orden abierta (buscar el `ordenId` correspondiente vía `listarOrdenesAbiertas`).

- [ ] **Step 3: Paso opcional en `NuevaVentaModal.tsx`**

Checkbox/toggle "¿Vincular a una mesa?" que, al activarse, muestra `SelectorMesaVisual`; al confirmar la venta con una mesa elegida, en vez de llamar a `registrarVenta` llama a `vincularMesa` con los mismos ítems del carrito ya armado en el modal.

- [ ] **Step 4: Verificar**

Run: `cd frontend && npm run build`
Expected: build sin errores de TypeScript.

Verificación manual: en Con Sentido, armar una venta, activar "¿Vincular a una mesa?", elegir una mesa con orden abierta, confirmar. Luego abrir el cobro de esa misma mesa en Migao y confirmar que aparece el carrito vinculado.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/con_sentido/api.ts frontend/src/modules/con_sentido/components/SelectorMesaVisual.tsx frontend/src/modules/con_sentido/components/NuevaVentaModal.tsx
git commit -m "feat(con-sentido): permite vincular una venta a una mesa de Migao desde el selector visual"
```
