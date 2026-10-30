# Área económica por producto (insumos vs. Con Sentido) — Plan de implementación

> **Para quien ejecute esto:** REQUIRED SUB-SKILL: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Que cada línea de producto (no cada venta completa) sepa hacia qué área económica (Insumos o Con Sentido/tienda) va su parte del dinero, con un valor por defecto heredado de la categoría del producto y siempre editable a mano — en Caja General, en la venta directa de Con Sentido, al facturar una cotización, y en los abonos de Pedidos.

**Arquitectura:** El área se resuelve del lado del cliente (prellenado desde un campo nuevo que cada producto trae en su listado, calculado en el backend a partir de `categorias_producto.modulo_id`), viaja en cada línea del payload de venta, y el backend agrupa las líneas por área (y por método de pago, igual que ya hace hoy con los pagos "mixto") antes de insertar los movimientos de caja — generando varias filas en vez de una sola cuando una venta mezcla áreas. No se re-valida el área en el backend contra la categoría: una vez elegida en la línea, se respeta tal cual (el cajero puede corregirla a propósito).

**Tech Stack:** Backend Node/Express/TypeScript + MySQL (dialecto Postgres traducido), Zod. Frontend React 19 + TypeScript + Vite + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-29-area-por-producto-design.md`

**Nota sobre verificación:** este proyecto no tiene framework de pruebas automatizadas. "Verificar" en cada paso de este plan significa: `tsc -b` limpio (backend y frontend según corresponda) + una verificación funcional real contra los servidores de desarrollo locales (backend puerto 4000, frontend puerto 5173) — por script directo a la API para lógica de backend, y con un navegador real (Playwright) para UI — con datos de prueba creados y limpiados explícitamente. No hay "tests" que escribir; el "Expected" de cada paso de verificación es el resultado observable de esa prueba manual/scripted.

## Global Constraints

- No hay sistema de migraciones — todo cambio de esquema se aplica con SQL directo a la base de datos local primero, y se entrega un archivo de migración en `database/mysql/migraciones/` para que el usuario lo corra en producción. `database/mysql/schema.sql` se actualiza en paralelo para que una instalación nueva nazca ya con el esquema final.
- `tsconfig.app.json` del frontend tiene `noUnusedLocals`/`noUnusedParameters: true` — cualquier código que quede sin usar tras quitar el selector "Viene de" debe eliminarse, no comentarse.
- Todo cambio de backend debe conservar los flujos de dinero **fuera de alcance** (cobro de mesa de Migao, mesa combinada con tienda, egresos) exactamente como están hoy — ningún `moduloOrigenSlug`/`modulo_origen_id` existente fuera de las rutas tocadas por este plan debe cambiar de comportamiento.
- Toda inserción nueva en `movimientos_caja` sigue el patrón ya existente de `descomponerPago`/`insertIngreso` — nunca se construye un INSERT a mano por fuera de `repo.insertIngreso`.
- Los montos se redondean con el mismo criterio ya usado en el resto del sistema ("todas las partes menos la última reciben el valor base, la última se lleva el residuo exacto") — nunca debe quedar un centavo suelto sin cuadrar entre las filas generadas de una misma venta.

## Review Focus

- Un producto cuya categoría tiene `modulo_id` apuntando a un módulo que NO es insumos ni con_sentido (p. ej. alguien marca por error una categoría como "migao" desde la base) — el valor por defecto debe seguir cayendo a `con_sentido`, nunca reventar ni mandar un área sin sentido para este catálogo.
- Un ítem anotado a mano sin área elegida, en cualquiera de los 3 formularios (Caja, Con Sentido, Pedidos) — debe bloquear el guardado con un mensaje claro, nunca guardarse silenciosamente en `con_sentido` por defecto.
- Una venta/pedido cuyo monto total, al repartirse entre dos áreas, no divide exacto en centavos (p. ej. $100.01 repartido 33%/67%) — la suma de las filas generadas debe seguir dando exactamente el total original.
- Un pedido cuyo último abono es MENOR al saldo pendiente de una de sus áreas (pago parcial que no alcanza a cerrar ninguna área todavía) — debe repartirse proporcional, no disparar el "cierre exacto" antes de tiempo.
- El modo "Monto único" de Registrar Ingreso, usado sin elegir área — debe bloquear igual que un ítem a mano, y el ítem sintético que hoy arma el backend a partir del `motivo` debe dejar de generarse ahí (la línea ya viene armada desde el frontend con su área).

---

## Task 1: Utilidad compartida de reparto exacto (redondeo) y decomposición por área

**Files:**
- Create: `backend/src/shared/utils/distribuir.ts`
- Modify: `backend/src/modules/migao/migao.service.ts` (quitar la copia privada de `distribuirIgual`, importar la nueva)
- Create: `backend/src/shared/utils/area-pago.ts`
- Test: verificación por script de Node contra las funciones exportadas (no hay runner de tests — ver nota de verificación arriba; usar `npx tsx` para correr un script suelto que las importe y compare resultados)

**Interfaces:**
- Produces: `distribuirIgual(total: number, n: number): number[]` (idéntica a la que ya existe hoy en `migao.service.ts`, solo movida y exportada).
- Produces: `descomponerPorAreaYMetodo(lineas: { moduloOrigenSlug: string; monto: number }[], pago: PagoInput): { moduloOrigenSlug: string; metodoPago: "efectivo" | "banco"; monto: number }[]` — agrupa `lineas` por `moduloOrigenSlug` sumando sus montos, y para cada grupo aplica `descomponerPago` (de `pago-mixto.ts`) proporcionalmente a la mezcla de método de pago de `pago` (si `pago` es mixto con proporción X% efectivo / Y% banco, cada grupo de área se reparte en esa misma proporción X/Y, usando el mismo criterio de redondeo "último absorbe el residuo" para que la suma de TODOS los grupos en efectivo dé exacto `pago.montoEfectivo` y lo mismo para banco). Grupos con monto 0 no generan fila (mismo criterio que `descomponerPago`).
- Consumes: `descomponerPago`, `PagoInput` de `backend/src/shared/utils/pago-mixto.ts` (sin cambios).

- [ ] **Paso 1: mover `distribuirIgual`**

Cortar la función tal cual está hoy en `migao.service.ts` (línea ~1387-1392) a `backend/src/shared/utils/distribuir.ts`, exportada. En `migao.service.ts`, reemplazar la definición local por `import { distribuirIgual } from "../../shared/utils/distribuir";` y confirmar que su único call site (reparto de propinas) sigue compilando igual.

- [ ] **Paso 2: verificar que compila**

Run: `cd backend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 3: escribir `descomponerPorAreaYMetodo`**

En `area-pago.ts`: agrupar `lineas` por `moduloOrigenSlug` (`Map<string, number>` sumando montos). Para cada grupo, si `pago.metodoPago !== "mixto"`, una sola fila `{moduloOrigenSlug, metodoPago: pago.metodoPago, monto: montoDelGrupo}`. Si es mixto, calcular la proporción efectivo/banco de `pago` (`pago.montoEfectivo / (pago.montoEfectivo + pago.montoBanco)`) y aplicarla a `montoDelGrupo` con `distribuirIgual`-style (dos valores, el segundo absorbe el residuo) — PERO el residuo total (sumado entre TODOS los grupos) debe seguir cuadrando exacto con `pago.montoEfectivo`/`pago.montoBanco` globales: la forma más simple y robusta es aplicar el redondeo normal a cada grupo excepto el ÚLTIMO grupo (por orden de inserción del `Map`), y que el último grupo, para cada método, reciba `pago.montoMetodo - sumaYaAsignadaEnEseMetodo` (el residuo exacto), en vez de su propia proporción calculada — mismo principio que ya usa `distribuirIgual` pero aplicado sobre dos dimensiones en cascada (primero las áreas salvo la última se llevan su proporción calculada y redondeada, la última área se lleva el residuo exacto de cada método).

- [ ] **Paso 4: script de verificación manual**

Escribir un script temporal en el scratchpad (no se commitea) que importe `descomponerPorAreaYMetodo` y pruebe: (a) una sola área, pago simple efectivo → una fila; (b) dos áreas, pago simple banco $100.000 repartido 60/40 → dos filas que suman exacto $100.000; (c) dos áreas, pago mixto $100.000 (60% efectivo/40% banco) repartido 70/30 entre áreas → hasta 4 filas, suma de las filas "efectivo" = monto efectivo total del pago, suma de las "banco" = monto banco total, suma de TODO = $100.000 exacto. Correr con `npx tsx scratch.ts` y confirmar los 3 casos a ojo.
Expected: los 3 casos cuadran exacto, sin residuos sueltos.

- [ ] **Paso 5: commit**

```bash
git add backend/src/shared/utils/distribuir.ts backend/src/shared/utils/area-pago.ts backend/src/modules/migao/migao.service.ts
git commit -m "feat(caja): utilidad compartida para repartir un pago entre varias áreas y métodos"
```

---

## Task 2: Esquema de base de datos — área por categoría, columnas de área por ítem, permiso nuevo

**Files:**
- Modify: `database/mysql/schema.sql`
- Modify: `database/mysql/seed.sql`
- Create: `database/mysql/migraciones/2026-10-29-area-por-producto.sql`

**Interfaces:**
- Produces: `categorias_producto.modulo_id` (nullable, FK a `modulos`).
- Produces: `caja_ingreso_items.modulo_origen_id`, `con_sentido_venta_items.modulo_origen_id`, `pedido_items.modulo_origen_id` (todas nullable, FK a `modulos`).
- Produces: tabla nueva `pedido_areas (pedido_id, modulo_id, porcentaje)` — ver Task 10 para su uso exacto.
- Produces: permiso `con_sentido.categorias.administrar`, otorgado a Root y Super Root.

- [ ] **Paso 1: escribir el ALTER/CREATE en `schema.sql`**

Junto a la definición de `categorias_producto` (línea ~402-405):
```sql
ALTER TABLE categorias_producto
  ADD COLUMN modulo_id SMALLINT NULL,
  ADD CONSTRAINT fk_categorias_producto_modulo FOREIGN KEY (modulo_id) REFERENCES modulos(id);
```
Junto a `caja_ingreso_items`, `con_sentido_venta_items`, `pedido_items` respectivamente:
```sql
ALTER TABLE caja_ingreso_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_caja_ingreso_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);
ALTER TABLE con_sentido_venta_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_con_sentido_venta_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);
ALTER TABLE pedido_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_pedido_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);
```
Tabla nueva, junto a `pedido_abonos`:
```sql
CREATE TABLE pedido_areas (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id  CHAR(36) NOT NULL,
  modulo_id  SMALLINT NOT NULL,
  porcentaje DECIMAL(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (modulo_id) REFERENCES modulos(id),
  UNIQUE INDEX uq_pedido_areas (pedido_id, modulo_id)
);
```
Permiso nuevo, junto a los demás permisos de `con_sentido`:
```sql
INSERT INTO permisos (modulo_id, accion, codigo) VALUES
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'administrar_categorias', 'con_sentido.categorias.administrar');
```

- [ ] **Paso 2: otorgar el permiso en `seed.sql`**

Agregar `con_sentido.categorias.administrar` al bloque de permisos que ya se le dan a Root y Super Root (seguir el patrón existente — buscar dónde se arma esa lista para esos dos roles y agregar el código ahí).

- [ ] **Paso 3: escribir la migración**

Mismo contenido que los Pasos 1-2, en `database/mysql/migraciones/2026-10-29-area-por-producto.sql`, con un comentario al inicio explicando qué hace y que es seguro correrla directo (es puramente aditiva, no borra ni modifica columnas existentes — a diferencia de otras migraciones de esta carpeta, no necesita un "paso 2 destructivo" aparte).

- [ ] **Paso 4: aplicar en la base local**

Run: `mysql -h127.0.0.1 -P3306 -uroot -p1429 sistemapos < database/mysql/migraciones/2026-10-29-area-por-producto.sql`
Expected: sin errores.

- [ ] **Paso 5: verificar**

Run: `mysql -h127.0.0.1 -P3306 -uroot -p1429 sistemapos -e "DESCRIBE categorias_producto; DESCRIBE pedido_areas; SELECT codigo FROM permisos WHERE codigo='con_sentido.categorias.administrar';"`
Expected: `categorias_producto` tiene `modulo_id`; `pedido_areas` existe con las 4 columnas; el permiso aparece.

- [ ] **Paso 6: commit**

```bash
git add database/mysql/schema.sql database/mysql/seed.sql database/mysql/migraciones/2026-10-29-area-por-producto.sql
git commit -m "feat(db): columnas de área por producto/ítem y tabla pedido_areas"
```

---

## Task 3: Backend — exponer el área por defecto de cada producto en los listados existentes

**Files:**
- Modify: `backend/src/modules/con_sentido/con_sentido.repository.ts` (función que lista productos para el autocompletar — `listProductos` o equivalente)
- Modify: `backend/src/modules/con_sentido/con_sentido.schema.ts`/tipo de respuesta si aplica
- Modify: `frontend/src/modules/con_sentido/api.ts` (tipo `Producto`/`ProductoConSentido`)

**Interfaces:**
- Produces: cada producto devuelto por el endpoint que alimenta `SugerenciasProducto` (usado en `IngresoModal.tsx`, `NuevaVentaModal.tsx`, `NuevoPedidoModal.tsx`) gana un campo `areaDefecto: "insumos" | "con_sentido"`.
- Consumes: `categorias_producto.modulo_id` (Task 2).

- [ ] **Paso 1: localizar la query exacta**

Confirmar con `grep -n "listProductos\|SugerenciasProducto" backend/src/modules/con_sentido/con_sentido.repository.ts frontend/src/modules/caja/components/SugerenciasProducto.tsx` cuál función de backend alimenta ese componente (es la misma lista que usan los 3 formularios).

- [ ] **Paso 2: agregar el JOIN y el campo calculado**

En esa query, LEFT JOIN `categorias_producto cp ON cp.id = p.categoria_id` LEFT JOIN `modulos m2 ON m2.id = cp.modulo_id`, y agregar a la selección: `CASE WHEN m2.slug = 'insumos' THEN 'insumos' ELSE 'con_sentido' END AS area_defecto`.

- [ ] **Paso 3: reflejar el campo nuevo en el tipo de respuesta backend y en el tipo frontend**

Backend: agregar `areaDefecto: string` al tipo que esa función retorna (si hay una interfaz explícita). Frontend: agregar `areaDefecto: "insumos" | "con_sentido"` a la interfaz `Producto`/`ProductoConSentido` en `frontend/src/modules/con_sentido/api.ts`.

- [ ] **Paso 4: verificar con una llamada real**

Con el backend corriendo, `curl` (con un token válido) al endpoint real y confirmar que un producto con categoría SIN marcar como insumos devuelve `"areaDefecto":"con_sentido"`.
Expected: campo presente y correcto.

- [ ] **Paso 5: `tsc -b` en ambos**

Run: `cd backend && npx tsc -b && cd ../frontend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 6: commit**

```bash
git add backend/src/modules/con_sentido/con_sentido.repository.ts frontend/src/modules/con_sentido/api.ts
git commit -m "feat(con-sentido): exponer el área por defecto de cada producto en el listado"
```

---

## Task 4: Backend — administrar el área de las categorías de producto

**Files:**
- Modify: `backend/src/modules/con_sentido/con_sentido.schema.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.repository.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.service.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.controller.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.routes.ts`

**Interfaces:**
- Produces: `GET /con-sentido/categorias` → `{id: number; nombre: string; areaSlug: "insumos" | "con_sentido"}[]`, **filtrado** a solo categorías usadas por al menos un producto con `productos.modulo_id` = con_sentido (nunca categorías de menú de Migao).
- Produces: `PATCH /con-sentido/categorias/:id` con body `{areaSlug: "insumos" | "con_sentido"}` → actualiza `categorias_producto.modulo_id`.
- Ambos gateados por el permiso `con_sentido.categorias.administrar` (Task 2).

- [ ] **Paso 1: schema**

```ts
export const actualizarAreaCategoriaSchema = z.object({
  areaSlug: z.enum(["insumos", "con_sentido"]),
});
export type ActualizarAreaCategoriaInput = z.infer<typeof actualizarAreaCategoriaSchema>;
```

- [ ] **Paso 2: repository**

`listarCategoriasConArea()`: `SELECT DISTINCT cp.id, cp.nombre, COALESCE(m2.slug, 'con_sentido') AS area_slug FROM categorias_producto cp JOIN productos p ON p.categoria_id = cp.id JOIN modulos m ON m.id = p.modulo_id LEFT JOIN modulos m2 ON m2.id = cp.modulo_id WHERE m.slug = 'con_sentido' ORDER BY cp.nombre`. `actualizarAreaCategoria(id, areaSlug)`: mismo idioma que `actualizarCategoriaGasto` — `UPDATE categorias_producto SET modulo_id = (SELECT id FROM modulos WHERE slug = $2) WHERE id = $1`.

- [ ] **Paso 3: service + controller + routes**

Pass-through directo (mismo patrón que el resto de `con_sentido.service.ts`). Rutas nuevas en `con_sentido.routes.ts`, ambas con `requirePermission("con_sentido.categorias.administrar")`.

- [ ] **Paso 4: verificar con curl**

Con el backend corriendo: `GET /con-sentido/categorias` con un token de Super Root → lista de categorías con `areaSlug`. Marcar una como insumos vía `PATCH`, repetir el GET, confirmar que cambió. Repetir el GET con un token de un rol sin el permiso nuevo → 403.
Expected: los 3 resultados correctos.

- [ ] **Paso 5: `tsc -b`**

Run: `cd backend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 6: commit**

```bash
git add backend/src/modules/con_sentido/
git commit -m "feat(con-sentido): endpoints para administrar el área de las categorías de producto"
```

---

## Task 5: Frontend — pantalla para administrar el área de las categorías

**Files:**
- Modify: `frontend/src/modules/con_sentido/api.ts` (cliente de los 2 endpoints nuevos)
- Create: `frontend/src/modules/con_sentido/components/CategoriasAreaPanel.tsx`
- Modify: `frontend/src/modules/con_sentido/pages/InventarioPage.tsx` (montar el panel, gateado por `tieneAccesoTotal`)

**Interfaces:**
- Consumes: `GET /con-sentido/categorias`, `PATCH /con-sentido/categorias/:id` (Task 4).
- Consumes: `tieneAccesoTotal` de `frontend/src/shared/auth/roles.ts` (patrón ya usado en `CajaPage.tsx`/`EditorMesasPage.tsx`).

- [ ] **Paso 1: cliente API**

En `conSentidoApi`: `listarCategorias: () => apiFetch<{id,nombre,areaSlug}[]>("/con-sentido/categorias")`, `actualizarAreaCategoria: (id, areaSlug) => apiFetch(...,{method:"PATCH", body:{areaSlug}})`.

- [ ] **Paso 2: `CategoriasAreaPanel.tsx`**

Tabla simple: nombre de categoría + un `<select>` con SOLO dos opciones (Insumos / Con Sentido-tienda) — a diferencia de `CategoriasPanel.tsx` (que ofrece los 6 módulos), este selector está restringido a dos porque los demás módulos no aplican a este catálogo. Al cambiar, llama `actualizarAreaCategoria` de una vez (sin botón "Guardar" aparte, mismo criterio inmediato que otros paneles de administración de esta sesión).

- [ ] **Paso 3: montar en `InventarioPage.tsx`**

`const { usuario } = useAuth();` (o como ya se obtenga el usuario en esa página), y `{tieneAccesoTotal(usuario?.rol) && <CategoriasAreaPanel />}` como una sección nueva de la página.

- [ ] **Paso 4: `tsc -b`**

Run: `cd frontend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 5: verificar en el navegador**

Login como Super Root, ir a `/con-sentido/inventario`, confirmar que aparece la sección nueva con las categorías reales de la base, cambiar una a Insumos, recargar, confirmar que quedó. Login con un rol sin `tieneAccesoTotal` (p. ej. Cajero), confirmar que la sección NO aparece.
Expected: ambos casos correctos.

- [ ] **Paso 6: commit**

```bash
git add frontend/src/modules/con_sentido/
git commit -m "feat(con-sentido): pantalla para marcar qué categorías de producto son de insumos"
```

---

## Task 6: Backend — Caja General reparte por área al guardar

**Files:**
- Modify: `backend/src/modules/general/caja/caja.schema.ts`
- Modify: `backend/src/modules/general/caja/caja.service.ts`
- Modify: `backend/src/modules/general/caja/caja.repository.ts`

**Interfaces:**
- Consumes: `descomponerPorAreaYMetodo` (Task 1).
- Produces: `itemIngresoSchema` gana `moduloOrigenSlug: z.enum(["insumos","con_sentido"]).optional()`. `registrarIngresoSchema`'s `moduloOrigenSlug` top-level pasa a **opcional** (sigue siendo obligatorio para los llamados internos vía `referenciaEntidad` — Migao, propinas, etc. — que no mandan `items`; ver Paso 2).
- Produces: `crearIngresoItems`/`IngresoItemFila` ganan `moduloOrigenSlug`, persistido en `caja_ingreso_items.modulo_origen_id`.

- [ ] **Paso 1: schema**

`itemIngresoSchema` gana el campo opcional de arriba. En `registrarIngresoSchema`, `moduloOrigenSlug` pasa de requerido a `.optional()`. Agregar un `.refine` a nivel del schema (o validación en el service, lo que resulte más simple de expresar) que exija: si `items` viene con longitud > 0, CADA item debe traer `moduloOrigenSlug` (el "monto único" también debe convertirse en un `items` de 1 elemento desde el frontend — ver Task 7 — así que a partir de este cambio `registrarIngresoManual` SIEMPRE recibe `items` no vacío quien venga de `IngresoModal`; los llamadores internos sin `items` siguen usando el `moduloOrigenSlug` top-level tal cual hoy).

- [ ] **Paso 2: `registrarIngresoManual` — quitar el ítem sintético, repartir por área**

Quitar el fallback que arma `[{nombre: motivo || "Ingreso registrado", ...}]` cuando `items` viene vacío (ya no debería pasar para este flujo, ver Paso 1) — si llega sin items, lanzar el mismo error de validación que hoy se lanza para otros campos faltantes. Reemplazar el loop final (`for (const parte of partes)`) por: `const grupos = descomponerPorAreaYMetodo(input.items.map(i => ({moduloOrigenSlug: i.moduloOrigenSlug!, monto: i.cantidad * i.precioUnitario})), pagoInputDesdeInput(input))`, luego `for (const grupo of grupos) { await repo.insertIngreso(client, {..., moduloOrigenSlug: grupo.moduloOrigenSlug, monto: grupo.monto, metodoPago: grupo.metodoPago, ...}) }`. `crearIngresoItems` sigue escribiendo una fila por ítem tal cual (ahora incluyendo su `moduloOrigenSlug` en la columna nueva), independiente de cómo se agrupen los movimientos de caja.

- [ ] **Paso 3: `insertIngreso`/`crearIngresoItems` en el repository**

`crearIngresoItems`: agregar `modulo_origen_id` al INSERT, resuelto igual que en otros lados (`(SELECT id FROM modulos WHERE slug = $n)`). `insertIngreso` no cambia de firma (ya acepta `moduloOrigenSlug` por llamada, que es justo lo que el nuevo loop le pasa por grupo).

- [ ] **Paso 4: `insertarMovimientosIngreso` (la rama con `referenciaEntidad`) — sin cambios de comportamiento**

Confirmar que esta rama (usada por Migao/propinas/etc., fuera de alcance) sigue usando `input.moduloOrigenSlug` tal cual, sin pasar por `descomponerPorAreaYMetodo` — esos llamadores no mandan `items`, así que la rama nueva del Paso 2 no les aplica.

- [ ] **Paso 5: `tsc -b`**

Run: `cd backend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 6: verificar con curl contra el backend local**

Crear (por API) una venta manual con 2 ítems, uno `moduloOrigenSlug: "insumos"` y otro `"con_sentido"`, pago simple efectivo. Luego `SELECT modulo_origen_id, monto FROM movimientos_caja WHERE referencia_id = '<ventaId>'` — debe haber 2 filas, una por área, que sumen el total. Repetir con pago mixto (efectivo+banco) y confirmar hasta 4 filas correctamente repartidas. Repetir un llamado SIN `moduloOrigenSlug` en algún ítem → debe rechazar con 400.
Expected: los 3 casos correctos; limpiar la venta/movimientos de prueba al terminar.

- [ ] **Paso 7: commit**

```bash
git add backend/src/modules/general/caja/
git commit -m "feat(caja): registrar ingreso reparte el pago entre las áreas de cada producto"
```

---

## Task 7: Frontend — `IngresoModal.tsx` sin selector único, con área por línea

**Files:**
- Modify: `frontend/src/shared/ingresosMinimizados/IngresosMinimizadosContext.tsx` (`LineaIngreso` gana el campo nuevo)
- Modify: `frontend/src/modules/caja/components/IngresoModal.tsx`
- Modify: `frontend/src/modules/caja/api.ts` (payload de `registrarIngreso`)

**Interfaces:**
- Consumes: `producto.areaDefecto` (Task 3), endpoint `cajaApi.registrarIngreso` ampliado (Task 6).
- Produces: `LineaIngreso.moduloOrigenSlug?: "insumos" | "con_sentido"`.

- [ ] **Paso 1: tipo `LineaIngreso`**

Agregar `moduloOrigenSlug?: "insumos" | "con_sentido";` a la interfaz en `IngresosMinimizadosContext.tsx`.

- [ ] **Paso 2: quitar el bloque "Viene de" y el estado `modulo`**

Borrar los botones de `MODULOS_ORIGEN` (líneas ~747-767) y el `useState<ModuloOrigenSlug>` de `modulo` (línea ~103) — dejando intacto, en el mismo bloque condicional, el selector de modo "Agregar productos"/"Monto único" que vive al lado (líneas ~769-790, NO se borra). Revisar el uso de `modulo === "con_sentido"` en la condición de "vincular a mesa" (línea ~894): como ese flujo (fuera de alcance, decisión 8 del diseño) sigue siendo siempre `con_sentido`, reemplazar esa condición por una constante/chequeo que ya no dependa del estado borrado (simplemente asumir `con_sentido` ahí, sin selector).

- [ ] **Paso 3: selector de área por línea**

En el bloque de cada línea (~797-875), agregar un `<select>` de dos opciones junto a cantidad/precio, con `value={linea.moduloOrigenSlug ?? ""}`. Al seleccionar un producto del autocompletar (`onSeleccionar` de `SugerenciasProducto`, ~813-821), prellenar `moduloOrigenSlug: producto.areaDefecto`. `lineaVacia()` (línea ~69-71) NO prellena ningún valor (queda `undefined` — el cajero elige, ver decisión 4 del diseño). El `<select>` tiene una opción inicial deshabilitada tipo "Elegir área..." cuando no hay valor.

- [ ] **Paso 4: modo "Monto único" también elige área**

Junto al `MoneyInput` del modo único (~999-1005), agregar el mismo `<select>` de área, en un estado nuevo (p. ej. `const [areaMontoUnico, setAreaMontoUnico] = useState<"insumos"|"con_sentido"|"">("")`).

- [ ] **Paso 5: `registrar()` — siempre manda `items`, nunca el `moduloOrigenSlug` top-level**

En el modo "productos": cada línea mapeada incluye `moduloOrigenSlug: l.moduloOrigenSlug` (bloquear el submit — deshabilitar el botón de guardar — si alguna línea válida no tiene área elegida). En el modo "único": construir `items: [{ nombre: motivo.trim() || "Ingreso registrado", cantidad: 1, precioUnitario: monto, moduloOrigenSlug: areaMontoUnico }]` en vez de mandar `monto`/sin items (bloquear el submit si `areaMontoUnico` está vacío). Quitar `moduloOrigenSlug: modulo` del payload — ya no se manda ese campo desde este formulario.

- [ ] **Paso 6: `tsc -b`**

Run: `cd frontend && npx tsc -b`
Expected: sin errores (confirmar que no queda ningún import/uso suelto de `MODULOS_ORIGEN`/`ModuloOrigenSlug` sin usar en este archivo — `noUnusedLocals` lo marcaría).

- [ ] **Paso 7: verificar en el navegador**

Caja General → Registrar ingreso → modo "Agregar productos": confirmar que YA NO aparece "Viene de"; agregar un producto del catálogo y confirmar que su área se prellena sola; agregar una línea a mano y confirmar que el botón de guardar queda deshabilitado hasta elegir área; completar con 2 líneas de áreas distintas, guardar, y verificar (por `SELECT` directo, como en la Task 6) que se crearon 2 movimientos de caja con las áreas correctas. Repetir en modo "Monto único": confirmar que pide el área y bloquea sin ella.
Expected: todo lo anterior correcto.

- [ ] **Paso 8: commit**

```bash
git add frontend/src/shared/ingresosMinimizados/ frontend/src/modules/caja/
git commit -m "feat(caja): Registrar Ingreso reparte por área por línea en vez de un selector único"
```

---

## Task 8: Backend — venta directa de Con Sentido reparte por área

**Files:**
- Modify: `backend/src/modules/con_sentido/con_sentido.schema.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.service.ts`
- Modify: `backend/src/modules/con_sentido/con_sentido.repository.ts`

**Interfaces:**
- Consumes: `descomponerPorAreaYMetodo` (Task 1).
- Produces: `itemVentaSchema` gana `moduloOrigenSlug: z.enum(["insumos","con_sentido"])` (obligatorio — a diferencia de Caja, acá CADA ítem siempre tiene que traerlo, nunca hay un modo "sin productos").
- Produces: `crearVentaItem` persiste `modulo_origen_id` en `con_sentido_venta_items`.

- [ ] **Paso 1: schema**

`itemVentaSchema.moduloOrigenSlug` requerido (no opcional — este formulario no tiene equivalente a "monto único").

- [ ] **Paso 2: `registrarVenta` — reemplazar el llamado único a `registrarIngreso`**

Donde hoy llama `cajaService.registrarIngreso({..., moduloOrigenSlug: "con_sentido", ...})` una sola vez (líneas ~161/176), construir los grupos con `descomponerPorAreaYMetodo(input.items.map(i => ({moduloOrigenSlug: i.moduloOrigenSlug, monto: i.cantidad * i.precioUnitario})), pagoInputDesdeInput(input))` y llamar `cajaService.registrarIngreso` una vez por grupo, igual que en la Task 6 — usando `referenciaEntidad: "con_sentido_ventas"` como ya se hace hoy.

- [ ] **Paso 3: `crearVentaItem` en el repository**

Agregar `modulo_origen_id` al INSERT de `con_sentido_venta_items`.

- [ ] **Paso 4: `tsc -b`**

Run: `cd backend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 5: verificar con curl**

Registrar una venta de Con Sentido con 2 ítems de áreas distintas vía `POST /con-sentido/ventas`, y verificar (SQL directo) que se generaron 2 filas de `movimientos_caja` correctas, y que `con_sentido_venta_items` guardó el área de cada ítem.
Expected: correcto; limpiar los datos de prueba.

- [ ] **Paso 6: commit**

```bash
git add backend/src/modules/con_sentido/
git commit -m "feat(con-sentido): la venta directa reparte el pago entre las áreas de cada producto"
```

---

## Task 9: Frontend — `NuevaVentaModal.tsx` con área por línea

**Files:**
- Modify: `frontend/src/modules/con_sentido/components/NuevaVentaModal.tsx`
- Modify: `frontend/src/modules/con_sentido/pages/VentasPage.tsx` (si `onGuardar` arma el payload final ahí, confirmar que pasa el campo nuevo)
- Modify: `frontend/src/modules/con_sentido/api.ts` (payload de `registrarVenta`)

**Interfaces:**
- Consumes: `producto.areaDefecto` (Task 3), endpoint ampliado (Task 8).
- Produces: `ItemCarrito.moduloOrigenSlug?: "insumos" | "con_sentido"`.

- [ ] **Paso 1: tipo `ItemCarrito`**

Agregar el campo nuevo a la interfaz local (~líneas 35-45).

- [ ] **Paso 2: selector por línea**

Igual que Task 7 Paso 3, pero en el bloque de fila de este modal (~299-418): al elegir un producto, prellenar desde `producto.areaDefecto`; un ítem escrito a mano arranca sin valor; bloquear "Agregar a la venta"/guardar si falta alguna.

- [ ] **Paso 3: `guardar()` — incluir el campo en cada ítem del payload**

En el `items: carrito.map(...)` (~158-199), agregar `moduloOrigenSlug: item.moduloOrigenSlug`. Confirmar en `VentasPage.tsx` que el objeto `venta` arma hasta `conSentidoApi.registrarVenta` sin perder este campo en el camino.

- [ ] **Paso 4: `tsc -b`**

Run: `cd frontend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 5: verificar en el navegador**

`/con-sentido/ventas` → "Nueva venta": agregar 2 productos de áreas distintas, confirmar que cada uno trae su área prellenada y editable, guardar, y verificar por SQL directo que generó los movimientos de caja correctos.
Expected: correcto; limpiar datos de prueba.

- [ ] **Paso 6: commit**

```bash
git add frontend/src/modules/con_sentido/
git commit -m "feat(con-sentido): Nueva venta reparte por área por línea"
```

---

## Task 10: Backend — Pedidos fija la proporción al crear y la respeta en cada abono

**Files:**
- Modify: `backend/src/modules/pedidos/pedidos.schema.ts`
- Modify: `backend/src/modules/pedidos/pedidos.service.ts`
- Modify: `backend/src/modules/pedidos/pedidos.repository.ts`

**Interfaces:**
- Consumes: `distribuirIgual` y `descomponerPago` (de `pago-mixto.ts`) de Task 1 — **no** `descomponerPorAreaYMetodo` directamente: esa función agrupa a partir de ítems crudos, mientras que Pedidos ya tiene un porcentaje FIJO por área guardado de antemano (`pedido_areas`), así que la lógica acá es su propia variante (repartir un monto conocido entre N porcentajes conocidos, con el mismo criterio de residuo en la última, y luego `descomponerPago` dentro de cada grupo de área para la dimensión de método) en vez de una llamada directa a la función de Task 1. Tabla `pedido_areas` (Task 2).
- Produces: `itemPedidoSchema` gana `moduloOrigenSlug: z.enum(["insumos","con_sentido"])` (obligatorio, mismo criterio que Con Sentido).
- Produces: `crearPedidoItems` persiste `modulo_origen_id` en `pedido_items`.
- Produces: `repo.crearPedidoAreas(client, pedidoId, areas: {moduloId, porcentaje}[])`, `repo.getPedidoAreas(pedidoId)`.

- [ ] **Paso 1: schema**

`itemPedidoSchema.moduloOrigenSlug` requerido.

- [ ] **Paso 2: `crearPedido` — calcular y guardar la proporción fija**

Después de construir `itemsResueltos` (línea ~104-119) y antes/junto con `crearPedidoItems`: agrupar los ítems por `moduloOrigenSlug` sumando `cantidad * precioUnitario`, calcular `porcentaje = (sumaDelGrupo / precioAcordado) * 100` para cada área (si `precioAcordado` difiere de la suma de los ítems — el pedido puede tener un precio acordado distinto a la suma literal de sus líneas — usar la PROPORCIÓN de cada grupo respecto al total de los ítems, no respecto a `precioAcordado` directamente, y aplicar esa proporción sobre `precioAcordado`). Guardar con `repo.crearPedidoAreas`. El `abonoInicial`, si viene, ya no manda `moduloOrigenSlug: "pedidos"` fijo — en vez de eso, repartir su monto entre las áreas recién calculadas con `distribuirIgual`-por-proporción (incluyendo el cálculo de residuo tal como en `descomponerPorAreaYMetodo`) y llamar `cajaService.registrarIngreso` una vez por área resultante (siempre con `referenciaEntidad: "pedido_abonos"`, igual que hoy).

- [ ] **Paso 3: `registrarAbono` — repartir según la proporción fija, con cierre exacto**

Antes de registrar el abono, calcular `saldoPendienteAntes` (ya existe, línea ~399) y `saldoPendienteDespues = saldoPendienteAntes - input.monto`. Obtener `repo.getPedidoAreas(id)`. Si `saldoPendienteDespues > 0` (no es el abono que cierra el pedido): repartir `input.monto` entre las áreas según sus `porcentaje` guardados (mismo criterio de redondeo: todas menos la última reciben su proporción calculada, la última se lleva el residuo de ESTE abono). Si `saldoPendienteDespues <= 0` (este abono deja el pedido en $0, el "cierre"): en vez de repartir proporcionalmente el monto de este abono, calcular cuánto le falta a CADA área en este momento (su `porcentaje` × `precioAcordado`, menos lo que ya se le abonó de esa área en abonos anteriores — requiere sumar, por área, lo ya registrado; si no hay un registro directo de "cuánto lleva cada área", derivarlo de los `movimientos_caja` ya insertados para este pedido via `referencia_id` de sus abonos previos) y asignarle a cada área exactamente ese saldo. Llamar `cajaService.registrarIngreso` una vez por área con monto > 0 resultante.

- [ ] **Paso 4: `crearPedidoItems`/`crearPedidoAreas`/`getPedidoAreas` en el repository**

`crearPedidoItems`: agregar `modulo_origen_id` al INSERT. `crearPedidoAreas`: INSERT múltiple en `pedido_areas`. `getPedidoAreas`: `SELECT modulo_id, porcentaje FROM pedido_areas WHERE pedido_id = $1` (unido a `modulos` para traer el slug).

- [ ] **Paso 5: `tsc -b`**

Run: `cd backend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 6: verificar con curl — caso de varios abonos**

Crear un pedido con 2 ítems (uno insumos $60.000, uno con_sentido $40.000, `precioAcordado: 100000`, sin abono inicial) → verificar `pedido_areas` quedó 60%/40%. Registrar un primer abono de $30.000 → verificar que generó 2 movimientos de caja ($18.000 insumos + $12.000 banco... perdón, con_sentido) respetando la proporción. Registrar un segundo abono que deja el pedido en $0 (el resto, $70.000) → verificar que el cierre exacto hizo que la SUMA TOTAL de movimientos de caja de insumos para este pedido dé exactamente $60.000 y la de con_sentido exactamente $40.000 (ni un peso de más o de menos), sin importar cómo haya quedado el redondeo de los abonos intermedios.
Expected: correcto en los 3 puntos; limpiar los datos de prueba.

- [ ] **Paso 7: commit**

```bash
git add backend/src/modules/pedidos/
git commit -m "feat(pedidos): repartir los abonos entre las áreas de sus productos, con cierre exacto"
```

---

## Task 11: Frontend — `NuevoPedidoModal.tsx` con área por línea

**Files:**
- Modify: `frontend/src/modules/pedidos/components/NuevoPedidoModal.tsx`
- Modify: `frontend/src/modules/pedidos/api.ts` (payload de `pedidosApi.crear`)

**Interfaces:**
- Consumes: `producto.areaDefecto` (Task 3), endpoint ampliado (Task 10).
- Produces: `LineaPedido.moduloOrigenSlug?: "insumos" | "con_sentido"`.

- [ ] **Paso 1: tipo `LineaPedido`**

Agregar el campo nuevo.

- [ ] **Paso 2: selector por línea**

Mismo patrón que Tasks 7/9, en el bloque de fila (~152-202).

- [ ] **Paso 3: `guardar()`**

Incluir `moduloOrigenSlug: l.moduloOrigenSlug` en cada ítem del payload; bloquear guardar si falta en alguna línea.

- [ ] **Paso 4: `tsc -b`**

Run: `cd frontend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 5: verificar en el navegador**

Pedidos → Nuevo pedido: 2 líneas de áreas distintas, confirmar prellenado/edición/bloqueo igual que en las tasks anteriores, crear el pedido, confirmar por SQL que `pedido_areas` quedó bien calculado.
Expected: correcto; limpiar datos de prueba.

- [ ] **Paso 6: commit**

```bash
git add frontend/src/modules/pedidos/
git commit -m "feat(pedidos): Nuevo pedido reparte por área por línea"
```

---

## Task 12: Backend — ajustar el dashboard de Con Sentido a la nueva separación

**Files:**
- Modify: `backend/src/modules/general/analytics/analytics.repository.ts`

**Interfaces:**
- Modifica: `getIngresosConSentido` — pasa a filtrar por `movimientos_caja.modulo_origen_id` = con_sentido (vía JOIN a `modulos`), igual que ya hace `getIngresosPorMetodoPagoConSentido`, en vez de sumar `con_sentido_ventas.monto` sin filtrar.
- Sin cambios: `getMovimientosPorModulo`, `getVentasPorCategoriaConSentido`, `getProductosTopConSentido` (confirmar que de verdad no hace falta tocarlos, ver spec).

- [ ] **Paso 1: reescribir `getIngresosConSentido`**

Cambiar la fuente de la suma de `con_sentido_ventas` a `movimientos_caja` filtrado por `modulo_origen_id` del módulo `con_sentido` y `referencia_entidad = 'con_sentido_ventas'` (mismo filtro base que ya usa `getIngresosPorMetodoPagoConSentido`, confirmar el nombre exacto de esa función/query para copiar el mismo WHERE).

- [ ] **Paso 2: `tsc -b`**

Run: `cd backend && npx tsc -b`
Expected: sin errores.

- [ ] **Paso 3: verificar con una venta mixta real**

Con una venta de Con Sentido ya repartida entre insumos/con_sentido (de la Task 8/9), confirmar que `getIngresosConSentido` ahora devuelve SOLO la porción `con_sentido`, no el total de la venta — y que coincide con lo que devuelve `getIngresosPorMetodoPagoConSentido` sumado.
Expected: ambos números coinciden entre sí y excluyen la porción de insumos.

- [ ] **Paso 4: commit**

```bash
git add backend/src/modules/general/analytics/
git commit -m "fix(analytics): el total de ingresos de Con Sentido ya solo cuenta su propia área"
```

---

## Task 13: Verificación de extremo a extremo — Cotizaciones → Factura

**Files:**
- Ninguno (verificación pura; `CotizacionesPage.tsx` reutiliza `IngresoModal` sin cambios propios, ya cubierto por la Task 7).

- [ ] **Paso 1: verificar en el navegador**

Crear una cotización con 2 productos de áreas distintas (Migao → Cotizaciones), facturarla ("Pasar a factura"), confirmar en el modal de facturación (el mismo `IngresoModal`) que cada línea trae su selector de área prellenado y editable, confirmar el pago, y verificar por SQL que se generaron los movimientos de caja repartidos correctamente.
Expected: correcto; limpiar los datos de prueba (cotización, venta, movimientos).

- [ ] **Paso 2: sin commit — esta tarea es solo de verificación**

---

## Self-Review

**Cobertura de la spec:** las 9 decisiones de diseño están cubiertas — 1/3/4 (Task 7/9/11, selector por línea + obligatorio en manuales), 2 (Task 2/3/4, categoría→área), 5 (Task 1/6/8, decomposición), 6 (Task 10/11, Pedidos), 7 (fuera de alcance, sin tarea), 8 (confirmado fuera de alcance explícitamente en Task 6 Paso 4/Task 7 Paso 2), 9 (Task 10). La adición post-brainstorming de la pantalla "Ventas" de Con Sentido está cubierta (Tasks 3/8/9). Reportes cubiertos (Task 12).

**Proporción:** 13 tareas para un cambio que toca 4 tablas, 3 flujos de venta independientes y una pantalla nueva es proporcional al tamaño real descrito en la spec — no se encontró forma honesta de reducirlo sin dejar un flujo a medias.

**Consistencia de tipos:** `moduloOrigenSlug` se usa con el mismo nombre y las mismas 2 opciones (`"insumos" | "con_sentido"`) en los 3 formularios y sus 3 schemas de backend — confirmado consistente en todas las tareas.
