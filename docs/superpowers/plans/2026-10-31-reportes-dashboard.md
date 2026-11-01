# Módulo de Reportes en el Dashboard — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el Excel manual "CON SENTIDO" por una sección de Reportes en el dashboard del POS, calculada en vivo sobre los datos que el sistema ya captura, 100% de solo lectura.

**Architecture:** Un módulo backend nuevo (`reportes`) con 7 endpoints `GET` de solo lectura siguiendo el patrón ya existente de `general/analytics` (mismo helper de permiso, mismo `desde`/`hasta` por query, agregaciones en SQL vía `movimientos_caja` como fuente de verdad de dinero). Un módulo frontend nuevo (`reportes`) con una página de pestañas montada como una sección más de `DashboardPage`.

**Tech Stack:** Express + TypeScript + SQL crudo (MySQL 8) en backend; React 19 + TypeScript + Tailwind v4 en frontend. Dependencias nuevas: `exceljs` (backend, exportar `.xlsx`) y `recharts` (frontend, gráficos) — el proyecto no tenía ninguna librería de ninguno de los dos hoy.

**Spec:** `docs/superpowers/specs/2026-10-31-reportes-dashboard-design.md`

## Global Constraints

- **Solo lectura.** Todo endpoint de este plan es un `SELECT`. Ningún endpoint escribe, actualiza ni borra filas. Las tareas de exportar a Excel generan el archivo en memoria a partir de un `SELECT`, nunca escriben a la base de datos.
- **No inventar datos.** Donde el modelo no tenga el campo (cuentas por pagar, saldo corrido de préstamos, cantidad/costo unitario por línea de gasto), el endpoint devuelve explícitamente que el dato no está disponible — nunca un `0`/`null` que se pueda confundir con "sí hay datos y son cero". Ver Spec, sección "Brechas".
- **Alcance de negocio:** todo reporte (excepto Cierre de caja) filtra `movimientos_caja`/ventas a los módulos `{insumos, con_sentido, talleres, general, pedidos}` — nunca a `migao` ni a `vales` (vales solo alimenta el reporte de Préstamos). Definir esta lista UNA sola vez, en `reportes.repository.ts`, y reusarla desde ahí en cada query — nunca repetirla hardcodeada en otro archivo.
- **Cierre de caja diario es la única excepción de alcance**: usa `turnos_caja`/`movimientos_caja` SIN filtrar por módulo — es el conteo físico real de la caja única del POS (compartida con Migao). Ver Spec.
- **Moneda:** COP sin decimales, separador de miles con punto. El backend devuelve siempre números crudos (`DECIMAL`/`number`), nunca strings pre-formateadas — el frontend aplica `frontend/src/shared/format/money.ts::formatMoney` en el render, igual que el resto del dashboard.
- **Zona horaria:** ya resuelta a nivel de conexión (`time_zone = '-05:00'`) — ninguna query necesita conversión de zona horaria.
- **Fechas por query:** `desde`/`hasta` como `YYYY-MM-DD`, mismo formato y mismo nombre de parámetro que `analyticsRangoSchema` (`backend/src/modules/general/analytics/analytics.schema.ts`) — crear un esquema análogo en `reportes.schema.ts`, no reimportar el de analytics (son módulos distintos).
- **Permiso:** reusar `general.dashboard.analytics.ver` en los 7 endpoints — no se crea ningún permiso nuevo ni se toca ningún seed.
- **Agregaciones en SQL** (`GROUP BY`), nunca traer todas las filas al frontend para sumar ahí.
- **Sin migraciones de esquema.** Ninguna tabla nueva. Ninguna columna nueva.
- **Sin suite de tests automatizada en este repo.** La verificación de cada tarea backend es: `npx tsc -b` limpio + un `curl` real contra el backend corriendo en local (`:4000`) con parámetros reales, comparando el JSON devuelto contra un cálculo manual con `mysql -h127.0.0.1 -P3306 -uroot -p1429 sistemapos` sobre los mismos filtros. La verificación de cada tarea frontend es `npx tsc -b` limpio + revisar la pantalla real en el navegador (`npm run dev`, puerto 5173) con datos reales del dashboard.
- **Rama:** todo este plan se ejecuta sobre `feature/reportes-dashboard` (ya creada, con el documento de diseño commiteado). No se hace merge ni push a `origin` sin que el usuario lo pida explícitamente.

## Review Focus

- Una venta repartida entre dos métodos de pago (mixta) o entre dos áreas (insumos+con_sentido en la misma venta) no debe duplicar ni perder plata en ningún total — todo total de dinero sale de `movimientos_caja`, que ya reparte correctamente por línea (ver `con_sentido.service.ts::descomponerPorAreaYMetodo`), nunca de sumar `con_sentido_ventas.monto` directo.
- Ventas/pedidos anulados o cancelados (`con_sentido_ventas.estado='anulada'`, `pedidos.estado='cancelado'`) no deben aparecer en ningún total — `movimientos_caja` ya los excluye porque el movimiento se borra al anular, pero cualquier query que lea `con_sentido_venta_items`/`pedido_items` directo (para el detalle de producto/cantidad) debe filtrar el estado explícitamente, o duplicará ventas que ya no existen para efectos de caja.
- El filtro de fecha debe incluir completo el primer y el último día del rango (`DATE_FORMAT(columna, '%Y-%m-%d') BETWEEN $1 AND $2`, igual que en `analytics.repository.ts` — nunca una comparación directa de `DATETIME` que corte las horas de la tarde del último día).
- Una categoría de gasto o un módulo sin ningún movimiento en el rango debe aparecer en la tabla con total `0`, no desaparecer — usar `LEFT JOIN` desde la tabla "catálogo" (`categorias_gasto`, `modulos`) hacia `movimientos_caja`, nunca un `INNER JOIN`/`WHERE EXISTS` que la oculte.
- Un rango sin ningún turno de caja (antes del primer turno registrado, o un mes sin ningún movimiento) debe devolver el saldo inicial como "dato no disponible" explícito en el reporte de Cierre de caja — nunca asumir `0`.

## File Structure

**Backend — nuevo módulo `backend/src/modules/reportes/`:**
- `reportes.schema.ts` — Zod: rango base (`desde`/`hasta`) + filtros por endpoint.
- `reportes.repository.ts` — todas las queries SQL + la constante de alcance `MODULOS_ALCANCE_SLUGS`.
- `reportes.service.ts` — composición por reporte (igual patrón que `analytics.service.ts`: `Promise.all` de varias llamadas al repository, cálculo de porcentajes/totales derivados).
- `reportes.controller.ts` — un handler por endpoint, parseo con Zod, `ok(res, data)`.
- `reportes.routes.ts` — `Router()`, montado en `backend/src/app.ts`.
- `reportes.excel.ts` — helper `generarExcel(nombreHoja, columnas, filas): Buffer` sobre `exceljs`, usado por los 7 endpoints de exportar.
- `reportes.types.ts` — tipos de respuesta de cada reporte.

**Frontend — nuevo módulo `frontend/src/modules/reportes/`:**
- `api.ts` — cliente HTTP, un función por endpoint + una por export.
- `pages/ReportesPage.tsx` — contenedor de pestañas + `PeriodoSelector` global.
- `components/PeriodoSelector.tsx` — selector mes actual/rango libre/todo el histórico (+ Día/Semana/Mes donde aplique), reemplaza la necesidad de duplicarlo en cada pestaña.
- `components/ResumenTab.tsx`, `VentasTab.tsx`, `VentasPorTipoTab.tsx`, `GastosTab.tsx`, `CierreCajaTab.tsx`, `PrestamosTab.tsx`, `ConciliacionTab.tsx`.
- `components/BotonExportarExcel.tsx` — botón genérico reusado por las 7 pestañas.

**Modificados:**
- `backend/src/app.ts` — importar y montar `reportesRouter`.
- `backend/package.json` — agregar `exceljs`.
- `frontend/package.json` — agregar `recharts`.
- `frontend/src/modules/general/pages/DashboardPage.tsx` — nueva entrada `"reportes"` en el union `Seccion` y en `SECCIONES`.

---

## Task 1: Scaffolding del módulo backend + alcance de negocio + rango de fechas

**Files:**
- Create: `backend/src/modules/reportes/reportes.schema.ts`
- Create: `backend/src/modules/reportes/reportes.repository.ts`
- Create: `backend/src/modules/reportes/reportes.service.ts`
- Create: `backend/src/modules/reportes/reportes.controller.ts`
- Create: `backend/src/modules/reportes/reportes.routes.ts`
- Create: `backend/src/modules/reportes/reportes.types.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Produces: `reportesRangoSchema` (Zod, `{ desde: string, hasta: string }`, mismo regex/refine que `analyticsRangoSchema`), exportado desde `reportes.schema.ts` — todas las tareas siguientes lo extienden con `.extend({...})` para sus filtros propios.
- Produces: `MODULOS_ALCANCE_SLUGS = ['insumos', 'con_sentido', 'talleres', 'general', 'pedidos'] as const` y un fragmento SQL reusable `MODULOS_ALCANCE_SUBQUERY = "(SELECT id FROM modulos WHERE slug IN ('insumos','con_sentido','talleres','general','pedidos'))"`, exportados desde `reportes.repository.ts` — toda tarea siguiente que filtre por alcance de negocio usa `modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}`, nunca repite la lista de slugs.
- Produces: `reportesRouter` (Express `Router`), montado en `app.ts` bajo el path `/reportes` igual que `analyticsRouter` está montado bajo `/analytics` (ver la línea de `app.use` correspondiente en `app.ts`).
- Consumes: `requirePermission("general.dashboard.analytics.ver")` de `backend/src/shared/middlewares/rbac.middleware.ts`, `authMiddleware` de `backend/src/shared/middlewares/auth.middleware.ts`, `asyncHandler` de `backend/src/shared/utils/async-handler.ts`, `ok` de `backend/src/shared/utils/response.ts`, `pool` de `backend/src/shared/db/pool.ts` — los cuatro ya existen, se importan igual que en `analytics.*`.

- [ ] **Paso 1: Crear `reportes.schema.ts`**

Copiar literalmente `analyticsRangoSchema` de `analytics.schema.ts` (mismo `FECHA_REGEX`, mismo `.refine`), renombrado `reportesRangoSchema`, exportado junto a su tipo `ReportesRangoInput`.

- [ ] **Paso 2: Crear `reportes.repository.ts` con la constante de alcance**

Exportar `MODULOS_ALCANCE_SLUGS` y `MODULOS_ALCANCE_SUBQUERY` como se describe en Interfaces arriba. Sin funciones de query todavía — las agrega cada tarea siguiente en este mismo archivo.

- [ ] **Paso 3: Crear `reportes.service.ts`, `reportes.controller.ts`, `reportes.types.ts` vacíos (solo exports placeholder)**

Un `export {}` o comentario en cada uno — se llenan en las tareas siguientes. El objetivo de este paso es que existan los tres archivos para que `reportes.routes.ts` los pueda importar sin error de módulo faltante.

- [ ] **Paso 4: Crear `reportes.routes.ts` con el router vacío (sin rutas todavía) y montarlo en `app.ts`**

```ts
import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";

export const reportesRouter = Router();
reportesRouter.use(authMiddleware);
```

En `backend/src/app.ts`: agregar el `import { reportesRouter } from "./modules/reportes/reportes.routes";` junto a los demás imports de módulos (orden alfabético, igual que los existentes), y `app.use("/reportes", reportesRouter)` junto al `app.use("/analytics", analyticsRouter)` existente.

- [ ] **Paso 5: Verificar**

Correr `npx tsc -b` en `backend/`. Esperado: sin errores. Arrancar el backend local (`npm run dev` en `backend/`) y confirmar que levanta sin excepciones (el router vacío no rompe nada).

- [ ] **Paso 6: Commit**

```bash
git add backend/src/modules/reportes/ backend/src/app.ts
git commit -m "feat(reportes): scaffolding del módulo backend de reportes"
```

---

## Task 2: Endpoint Resumen (`GET /reportes/resumen`)

**Files:**
- Modify: `backend/src/modules/reportes/reportes.repository.ts`
- Modify: `backend/src/modules/reportes/reportes.service.ts`
- Modify: `backend/src/modules/reportes/reportes.controller.ts`
- Modify: `backend/src/modules/reportes/reportes.routes.ts`
- Modify: `backend/src/modules/reportes/reportes.types.ts`

**Interfaces:**
- Consumes: `reportesRangoSchema`, `MODULOS_ALCANCE_SUBQUERY` (Task 1).
- Produces: `service.obtenerResumen(desde: string, hasta: string): Promise<ResumenReporte>` — usado también por Task 9 (exportar Resumen). `ResumenReporte` (en `reportes.types.ts`) tiene exactamente los campos de los 5 bloques descritos abajo.

Este es el reporte principal (Spec, "Resumen" — Bloques A-E). Todas las queries nuevas van en `reportes.repository.ts`, compuestas con `Promise.all` en `reportes.service.ts`, siguiendo el patrón de `analytics.service.ts`.

- [ ] **Paso 1: Repository — Bloque A y B (KPIs + flujo por medio de pago)**

Agregar `getResumenTotales(desde, hasta)` en `reportes.repository.ts`: un único `SELECT` sobre `movimientos_caja mc` con `modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}` y `DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN $1 AND $2`, con `SUM(CASE ...)` para: `ingresos_total`, `gastos_total`, `ingresos_efectivo`, `ingresos_banco`, `gastos_efectivo`, `gastos_banco` (mismo idioma que `getTotalesMovimientos`/`getMovimientosPorModulo` en `analytics.repository.ts`, pero con el filtro de alcance de negocio agregado). De ahí el service deriva `utilidad = ingresos_total - gastos_total`, `disponible_efectivo = ingresos_efectivo - gastos_efectivo`, `disponible_banco = ingresos_banco - gastos_banco`, `total_disponible = disponible_efectivo + disponible_banco`, y `utilidad_real_disponible = utilidad` (sin ajuste de cuentas por pagar — no existen, ver Spec/Brechas). `cuentas_por_pagar: null` explícito en la respuesta (dato no disponible, no `0`).

- [ ] **Paso 2: Repository — Bloque C (gastos por categoría)**

Agregar `getGastosPorCategoria(desde, hasta)`: `SELECT cg.id, cg.nombre, COALESCE(SUM(mc.monto),0) AS total FROM categorias_gasto cg LEFT JOIN movimientos_caja mc ON mc.categoria_gasto_id = cg.id AND mc.tipo='egreso' AND mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY} AND DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN $1 AND $2 WHERE cg.activo = true GROUP BY cg.id, cg.nombre ORDER BY total DESC` — el `LEFT JOIN` desde `categorias_gasto` es obligatorio (Review Focus: categorías en 0 deben seguir apareciendo).

- [ ] **Paso 3: Repository — Bloque D (ingresos por tipo)**

Agregar `getIngresosPorTipo(desde, hasta)`: `SELECT m.slug, COALESCE(SUM(mc.monto),0) AS total FROM modulos m LEFT JOIN movimientos_caja mc ON mc.modulo_origen_id = m.id AND mc.tipo='ingreso' AND DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN $1 AND $2 WHERE m.slug IN ('insumos','con_sentido','talleres') GROUP BY m.slug` — nótese que este bloque NO incluye `general`/`pedidos` (son las 3 líneas de negocio del Excel, "Insumos/Con Sentido/Talleres"; `general`/`pedidos` sí entran en los Bloques A/B/C que son de todo el negocio).

- [ ] **Paso 4: Repository — Bloque E (matriz ventas por mes, independiente del período)**

Agregar `getVentasPorMes()` (sin parámetros de fecha — Spec: este bloque siempre muestra el histórico completo, no el rango del selector): `SELECT m.slug, DATE_FORMAT(mc.created_at, '%Y-%m') AS mes, COALESCE(SUM(mc.monto),0) AS total FROM movimientos_caja mc JOIN modulos m ON m.id = mc.modulo_origen_id WHERE mc.tipo='ingreso' AND m.slug IN ('insumos','con_sentido','talleres') GROUP BY m.slug, mes ORDER BY mes`. El service pivotea el resultado a la forma matriz (filas Insumos/Con Sentido/Talleres/Total, columnas = meses distintos encontrados) y agrega la fila `Total` sumando las 3 líneas por mes.

- [ ] **Paso 5: Service — componer `obtenerResumen`**

`Promise.all` de las 4 queries de arriba, armar el objeto `ResumenReporte` con los 5 bloques. Seguir el patrón de composición de `analytics.service.ts` (ver cualquiera de sus `obtenerAnalytics*`).

- [ ] **Paso 6: Controller + ruta**

`obtenerResumenController`: parsea `reportesRangoSchema.parse(req.query)`, llama `service.obtenerResumen`, `ok(res, data)`. Montar `reportesRouter.get("/resumen", requirePermission("general.dashboard.analytics.ver"), asyncHandler(obtenerResumenController))`.

- [ ] **Paso 7: Verificar**

`npx tsc -b` limpio. Con el backend corriendo: `curl` a `/reportes/resumen?desde=2026-10-01&hasta=2026-10-31` con una cookie de sesión válida (login real contra el dev server) y comparar `ingresos_total`/`gastos_total` contra:
```sql
SELECT tipo, SUM(monto) FROM movimientos_caja mc JOIN modulos m ON m.id = mc.modulo_origen_id
 WHERE m.slug IN ('insumos','con_sentido','talleres','general','pedidos')
   AND DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN '2026-10-01' AND '2026-10-31'
 GROUP BY tipo;
```
Esperado: los números cuadran exactamente. Confirmar también que `cuentas_por_pagar` llega como `null`, no `0`.

- [ ] **Paso 8: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Resumen (bloques A-E)"
```

---

## Task 3: Endpoint Ventas (`GET /reportes/ventas`)

**Files:** Modify los mismos 5 archivos del módulo reportes que Task 2.

**Interfaces:**
- Consumes: `reportesRangoSchema`, `MODULOS_ALCANCE_SUBQUERY`.
- Produces: `service.obtenerVentas(filtros: VentasFiltros): Promise<VentasReporte>` — usado también por Task 9.

**Invariante que debe cumplir la query** (en vez de fijar aquí el join exacto, que depende de cómo se resuelva el detalle de pedidos): la suma de los montos de las filas que devuelve este endpoint para un rango dado debe ser EXACTAMENTE igual a la suma de `movimientos_caja.monto` (`tipo='ingreso'`, alcance de negocio, mismo rango) que ya probó Task 2. Si no cuadra, el join está mal — revisar antes de seguir.

- [ ] **Paso 1: Repository — líneas de venta de mostrador (Con Sentido/Insumos/Talleres)**

Agregar `getVentasDetalle(desde, hasta, filtros: {metodo?, cliente?, producto?})`: `SELECT cv.id, cv.created_at, cvi.producto, cvi.cantidad, cvi.precio_unitario, cvi.subtotal, cv.metodo_pago, m.slug AS area FROM con_sentido_venta_items cvi JOIN con_sentido_ventas cv ON cv.id = cvi.venta_id LEFT JOIN modulos m ON m.id = cvi.modulo_origen_id WHERE cv.estado = 'completada' AND DATE_FORMAT(cv.created_at,'%Y-%m-%d') BETWEEN $1 AND $2` + filtros opcionales (`cv.metodo_pago = $n`, `cvi.producto LIKE $n`). `cv.id` no es el consecutivo mostrable — unir con `facturas` (`LEFT JOIN facturas f ON f.venta_id = cv.id` si existe esa FK, o el nombre de columna equivalente — revisar `facturas` en `schema.sql` antes de escribir el join final) para traer `f.numero AS consecutivo`, `NULL` si no hay factura.

- [ ] **Paso 2: Repository — ingresos que no son línea de producto (abonos de pedidos, ingresos manuales de Caja General dentro del alcance)**

Agregar `getIngresosSinDetalle(desde, hasta, filtros)`: todo `movimientos_caja` (`tipo='ingreso'`, alcance de negocio, mismo rango/filtros de método) que NO corresponda a una venta ya cubierta por el Paso 1 — usar `referencia_entidad`/`referencia_id` de `movimientos_caja` para excluir las que sí tienen contraparte en `con_sentido_ventas` (revisar en `con_sentido.service.ts` qué valor de `referencia_entidad` usa al insertar el movimiento, para filtrar `WHERE NOT (referencia_entidad = '<ese valor>' AND referencia_id IN (SELECT id FROM con_sentido_ventas ...))`). Esta fila se muestra en la tabla con `Producto = mc.motivo`, `Cantidad = NULL`, `Consecutivo = NULL`.

- [ ] **Paso 3: Service — unir, ordenar por día, calcular totales**

`obtenerVentas` llama los dos repository de arriba, concatena, ordena por fecha, agrupa por día para la "vista agrupada por día" del Spec, y calcula `total_general`, `total_bancos`, `total_efectivo`.

- [ ] **Paso 4: Controller + ruta**

Esquema `reportesVentasFiltrosSchema = reportesRangoSchema.extend({ metodo: z.enum(['efectivo','banco']).optional(), cliente: z.string().optional(), producto: z.string().optional() })`. Montar `GET /reportes/ventas`.

- [ ] **Paso 5: Verificar**

`npx tsc -b` limpio. `curl /reportes/ventas?desde=...&hasta=...`, confirmar que `total_general` del Paso 3 coincide con el `ingresos_total` de alcance que ya se verificó en Task 2 para el mismo rango (la invariante de arriba). Probar también con `?metodo=banco` y confirmar que el total baja al subconjunto correcto contra una consulta manual.

- [ ] **Paso 6: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Ventas con filtros y totales"
```

---

## Task 4: Endpoint Ventas por tipo (`GET /reportes/ventas-por-tipo`)

**Files:** Modify los mismos 5 archivos del módulo.

**Interfaces:**
- Consumes: `reportesRangoSchema`.
- Produces: `service.obtenerVentasPorTipo(desde, hasta): Promise<VentasPorTipoReporte>`.

- [ ] **Paso 1: Repository**

Agregar `getVentasPorTipoDiario(desde, hasta)`: igual idioma que `getIngresosPorTipo` de Task 2 (Paso 3) pero agrupado por día en vez de total: `SELECT DATE_FORMAT(mc.created_at,'%Y-%m-%d') AS fecha, m.slug, COALESCE(SUM(mc.monto),0) AS total FROM movimientos_caja mc JOIN modulos m ON m.id = mc.modulo_origen_id WHERE mc.tipo='ingreso' AND m.slug IN ('insumos','con_sentido','talleres') AND DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN $1 AND $2 GROUP BY fecha, m.slug ORDER BY fecha`.

- [ ] **Paso 2: Service**

Pivotear a filas por día con columnas `insumos`/`con_sentido`/`talleres`/`total` (= suma de las 3), calcular totales por línea y % de participación sobre el total del rango.

- [ ] **Paso 3: Controller + ruta**

`GET /reportes/ventas-por-tipo`.

- [ ] **Paso 4: Verificar**

`npx tsc -b` limpio. `curl`, confirmar que la suma de la columna `total` de todos los días == `ingresos_total` del Bloque D de Task 2 para el mismo rango.

- [ ] **Paso 5: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Ventas por tipo"
```

---

## Task 5: Endpoint Gastos (`GET /reportes/gastos`)

**Files:** Modify los mismos 5 archivos del módulo.

**Interfaces:**
- Consumes: `reportesRangoSchema`, `MODULOS_ALCANCE_SUBQUERY`.
- Produces: `service.obtenerGastos(filtros): Promise<GastosReporte>`.

- [ ] **Paso 1: Repository — detalle de gastos**

Agregar `getGastosDetalle(desde, hasta, filtros: {categoriaId?, proveedorId?, metodo?})`: `SELECT mc.id, mc.created_at, p.nombre AS proveedor, cg.nombre AS categoria, mc.motivo, mc.monto, mc.metodo_pago FROM movimientos_caja mc LEFT JOIN proveedores p ON p.id = mc.proveedor_id JOIN categorias_gasto cg ON cg.id = mc.categoria_gasto_id WHERE mc.tipo='egreso' AND mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY} AND DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN $1 AND $2` + filtros opcionales. Explícito en la respuesta: no hay columnas `cantidad`/`costo_unitario` (dato no disponible, ver Spec).

- [ ] **Paso 2: Repository — ranking de proveedores (top 10)**

Agregar `getTopProveedores(desde, hasta, limit = 10)`: mismo filtro base, `GROUP BY p.id, p.nombre ORDER BY SUM(mc.monto) DESC LIMIT $n`, solo proveedores no nulos.

- [ ] **Paso 3: Repository — gastos por categoría (para el gráfico de este reporte)**

Reusar `getGastosPorCategoria` de Task 2 (ya filtra por alcance y rango) — no duplicar la query, importarla/exportarla para que `reportes.service.ts` la llame también aquí.

- [ ] **Paso 4: Service + controller + ruta**

`obtenerGastos` compone los 3; calcula `total_general`, `total_bancos`, `total_efectivo`. Esquema `reportesGastosFiltrosSchema`. `GET /reportes/gastos`.

- [ ] **Paso 5: Verificar**

`npx tsc -b` limpio. `curl`, confirmar `total_general` contra una consulta manual de `SUM(monto) WHERE tipo='egreso'` con el mismo alcance/rango, y que el top de proveedores coincide con el proveedor de mayor gasto real del rango.

- [ ] **Paso 6: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Gastos con ranking de proveedores"
```

---

## Task 6: Endpoint Cierre de caja diario (`GET /reportes/cierre-caja`)

**Files:** Modify los mismos 5 archivos del módulo.

**Interfaces:**
- Produces: `service.obtenerCierreCaja(mes: string): Promise<CierreCajaReporte>` (`mes` formato `YYYY-MM`, NO usa `reportesRangoSchema` — este endpoint tiene su propio esquema `reportesCierreCajaSchema = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) })`).

**Única excepción de alcance de este plan: NO filtra por `modulo_origen_id`** (Global Constraints) — es la caja física real y única, Migao incluido.

- [ ] **Paso 1: Repository — movimientos del mes por día**

Agregar `getMovimientosDiarios(mes)`: `SELECT DATE_FORMAT(mc.created_at,'%Y-%m-%d') AS fecha, SUM(CASE WHEN tipo='ingreso' AND metodo_pago='efectivo' THEN monto END) AS venta_efectivo, SUM(CASE WHEN tipo='ingreso' AND metodo_pago='banco' THEN monto END) AS venta_banco, SUM(CASE WHEN tipo='egreso' AND metodo_pago='efectivo' THEN monto END) AS gastos_efectivo, SUM(CASE WHEN tipo='egreso' AND metodo_pago='banco' THEN monto END) AS gastos_banco FROM movimientos_caja mc WHERE DATE_FORMAT(mc.created_at,'%Y-%m') = $1 GROUP BY fecha` — SIN join a `modulos`, sin filtro de alcance.

- [ ] **Paso 2: Repository — saldo inicial y responsables**

Agregar `getPrimerTurnoDelRango(mes)`: `SELECT monto_inicial_efectivo, monto_inicial_banco, abierto_en FROM turnos_caja WHERE DATE_FORMAT(abierto_en,'%Y-%m') <= $1 ORDER BY abierto_en DESC LIMIT 1` traído desde el turno más reciente que abrió ANTES o en ese mes (si no existe ninguno, el service devuelve `saldo_inicial: null` — dato no disponible, Review Focus). Agregar `getCajerosPorDia(mes)`: `SELECT DATE_FORMAT(abierto_en,'%Y-%m-%d') AS fecha, u.nombre FROM turnos_caja tc JOIN usuarios u ON u.id = tc.cajero_id WHERE DATE_FORMAT(abierto_en,'%Y-%m') = $1` (una fila por turno abierto ese mes; el service agrupa nombres por fecha, puede haber más de uno el mismo día).

- [ ] **Paso 3: Service — construir el saldo corrido**

Generar TODOS los días del mes (incluir días sin movimiento con los 4 montos en `0`, Spec). Para cada día en orden: `efectivo_dia = efectivo_dia_anterior + venta_efectivo - gastos_efectivo` (arranca desde el saldo inicial del Paso 2), igual para `banco`. `total_dinero_dia = efectivo_dia + banco_dia`. Fila `TOTAL` al final = suma de `venta_dia`/`venta_efectivo`/`venta_banco`/`gastos_efectivo`/`gastos_banco` de TODOS los días (incluido el último — Review Focus/anti-goal del Excel original), y el `efectivo`/`banco`/`total_dinero` del renglón TOTAL son los del ÚLTIMO día (es un saldo corrido, no una suma). `notas_responsable` = nombres del Paso 2 para ese día, o `"—"` si ningún turno abrió ese día.

- [ ] **Paso 4: Controller + ruta**

`GET /reportes/cierre-caja?mes=2026-10`.

- [ ] **Paso 5: Verificar**

`npx tsc -b` limpio. `curl`, elegir 2-3 días al azar del mes y comparar `venta_efectivo`/`gastos_banco` contra `SELECT SUM(monto) FROM movimientos_caja WHERE DATE_FORMAT(created_at,'%Y-%m-%d')='<fecha>' AND tipo=... AND metodo_pago=...` manual (sin filtro de módulo). Confirmar que la fila `TOTAL.venta_efectivo` suma los 1-31/30/28 días completos.

- [ ] **Paso 6: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Cierre de caja diario"
```

---

## Task 7: Endpoint Préstamos (`GET /reportes/prestamos`)

**Files:** Modify los mismos 5 archivos del módulo.

**Interfaces:**
- Produces: `service.obtenerPrestamos(destinatarioUsuarioId?: string): Promise<PrestamosReporte>` — SIN filtro de fecha obligatorio (Spec: selector de destinatario, no de período — pero aceptar `desde`/`hasta` opcionales igual no hace daño; si se agregan, filtran por `created_at`).

- [ ] **Paso 1: Repository**

Agregar `getVales(destinatarioUsuarioId?)`: `SELECT id, numero, tipo, pagado_a, destinatario_usuario_id, concepto, monto_efectivo, monto_banco, monto_adeudado, cobrado_en, monto_cobrado_efectivo, monto_cobrado_banco, repuesto_en, created_at FROM vales WHERE anulado_en IS NULL` + `AND destinatario_usuario_id = $1` si se pasa el filtro, `ORDER BY created_at DESC`.

- [ ] **Paso 2: Service — calcular monto y estado por fila**

Por cada vale: si `tipo='deuda'` → `monto = monto_adeudado`, `estado = cobrado_en ? 'Cobrado' : 'Pendiente de cobro'`, `fecha_resolucion = cobrado_en`. Si `tipo='pago'` → `monto = monto_efectivo + monto_banco`, `estado = repuesto_en ? 'Repuesto' : 'Pendiente de reposición'`, `fecha_resolucion = repuesto_en`. Devolver también totales: `total_pendiente` (suma de filas sin resolver) y `total_resuelto`.

- [ ] **Paso 3: Controller + ruta**

`GET /reportes/prestamos?destinatarioUsuarioId=`.

- [ ] **Paso 4: Verificar**

`npx tsc -b` limpio. `curl`, confirmar contra `SELECT * FROM vales WHERE anulado_en IS NULL` manual que cada fila tiene el estado correcto según sus columnas `cobrado_en`/`repuesto_en`.

- [ ] **Paso 5: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Préstamos (basado en vales)"
```

---

## Task 8: Endpoint Conciliación (`GET /reportes/conciliacion`)

**Files:** Modify los mismos 5 archivos del módulo.

**Interfaces:**
- Produces: `service.obtenerConciliacion(desde, hasta): Promise<ConciliacionReporte>`.

- [ ] **Paso 1: Repository**

Agregar `getConciliacionDiaria(desde, hasta)`: `SELECT DATE_FORMAT(mc.created_at,'%Y-%m-%d') AS fecha, SUM(CASE WHEN metodo_pago='efectivo' THEN monto END) AS por_metodo_efectivo, SUM(CASE WHEN metodo_pago='banco' THEN monto END) AS por_metodo_banco, SUM(CASE WHEN m.slug='insumos' THEN monto END) AS insumos, SUM(CASE WHEN m.slug='con_sentido' THEN monto END) AS con_sentido, SUM(CASE WHEN m.slug='talleres' THEN monto END) AS talleres FROM movimientos_caja mc JOIN modulos m ON m.id = mc.modulo_origen_id WHERE mc.tipo='ingreso' AND m.slug IN ('insumos','con_sentido','talleres') AND DATE_FORMAT(mc.created_at,'%Y-%m-%d') BETWEEN $1 AND $2 GROUP BY fecha`.

- [ ] **Paso 2: Service**

Por cada día: `total_por_metodo = por_metodo_efectivo + por_metodo_banco`, `total_por_tipo = insumos + con_sentido + talleres`, `diferencia = total_por_metodo - total_por_tipo`, `tiene_diferencia = diferencia != 0`. Como ambos totales salen de la MISMA fila de `movimientos_caja` agrupada de dos formas distintas (Review Focus), `diferencia` debería ser siempre `0` — si el implementador encuentra un caso real con diferencia, es una señal de bug en la query, no un dato real a conciliar; investigarlo antes de continuar, no silenciarlo.

- [ ] **Paso 3: Controller + ruta**

`GET /reportes/conciliacion`.

- [ ] **Paso 4: Verificar**

`npx tsc -b` limpio. `curl`, confirmar que TODOS los días devuelven `diferencia: 0` contra datos reales (si no, hay un bug real que corregir antes de cerrar la tarea, no se documenta como "hallazgo esperado").

- [ ] **Paso 5: Commit**

```bash
git add backend/src/modules/reportes/
git commit -m "feat(reportes): endpoint de Conciliación"
```

---

## Task 9: Exportar a Excel (los 7 reportes)

**Files:**
- Create: `backend/src/modules/reportes/reportes.excel.ts`
- Modify: `backend/src/modules/reportes/reportes.controller.ts`
- Modify: `backend/src/modules/reportes/reportes.routes.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `service.obtener*` de las Tasks 2-8 (ya existen, se reusan tal cual — este endpoint no repite ninguna query).
- Produces: `generarExcel(nombreHoja: string, columnas: {header: string, key: string}[], filas: Record<string, unknown>[]): Promise<Buffer>` en `reportes.excel.ts`.

- [ ] **Paso 1: Agregar `exceljs` a `backend/package.json`**

`npm install exceljs` desde `backend/`. Confirmar que queda en `dependencies`, no en `devDependencies` (se usa en runtime, no solo en build).

- [ ] **Paso 2: Implementar `generarExcel`**

Usar `ExcelJS.Workbook` → `addWorksheet(nombreHoja)` → `columns = columnas` → `addRows(filas)` → `workbook.xlsx.writeBuffer()`. Nombres de columna EXACTOS a los del Excel original por reporte (ver Spec, cada reporte lista sus columnas).

- [ ] **Paso 3: Un endpoint de export por reporte**

`GET /reportes/:tipo/exportar` con `tipo` restringido por Zod a `z.enum(['resumen','ventas','ventas-por-tipo','gastos','cierre-caja','prestamos','conciliacion'])`, mismos query params que el endpoint de datos correspondiente. El controller llama al `service.obtener*` correspondiente, mapea el resultado a filas planas, llama `generarExcel`, y responde con `res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')` + `res.setHeader('Content-Disposition', 'attachment; filename="<tipo>.xlsx"')` + `res.send(buffer)` (no pasa por el helper `ok()`, que serializa JSON — este endpoint responde binario).

- [ ] **Paso 4: Verificar**

`npx tsc -b` limpio. `curl -o /tmp/test.xlsx "http://localhost:4000/reportes/ventas/exportar?desde=...&hasta=..."` (con cookie de sesión) y abrir el archivo descargado (`unzip -l /tmp/test.xlsx` debe listar `xl/worksheets/sheet1.xml` — confirma que es un `.xlsx` real, no un JSON mal etiquetado) para los 7 tipos.

- [ ] **Paso 5: Commit**

```bash
git add backend/src/modules/reportes/ backend/package.json backend/package-lock.json
git commit -m "feat(reportes): exportar cada reporte a Excel"
```

---

## Task 10: Scaffolding del módulo frontend + PeriodoSelector + integración en el Dashboard

**Files:**
- Create: `frontend/src/modules/reportes/api.ts`
- Create: `frontend/src/modules/reportes/pages/ReportesPage.tsx`
- Create: `frontend/src/modules/reportes/components/PeriodoSelector.tsx`
- Modify: `frontend/src/modules/general/pages/DashboardPage.tsx`

**Interfaces:**
- Produces: `reportesApi.obtenerResumen/obtenerVentas/.../obtenerConciliacion` en `api.ts` (una función por endpoint de Tasks 2-8, mismo patrón que `frontend/src/modules/general/api.ts` para analytics: `fetch` al backend con `desde`/`hasta` y filtros como query params, parseo de la respuesta `ok()`).
- Produces: `<PeriodoSelector value={...} onChange={...} />` — props `{ periodo: 'mes_actual' | 'rango' | 'historico', desde: string, hasta: string }` y callback `onChange(nuevoValor)`. Cada pestaña (Tasks 11-17) lo usa y le pasa el `desde`/`hasta` resultante a su propia llamada de API — el componente NO llama a la API él mismo, solo resuelve fechas (igual separación de responsabilidades que el patrón `Día/Semana/Mes` ya usado en `InsumosAnalyticsSection.tsx`/`TalleresAnalyticsSection.tsx`, pero centralizado una sola vez en vez de 7 copias).
- Consumes: `Seccion` (union type) y `SECCIONES` (array) en `DashboardPage.tsx` — agregar `"reportes"` a ambos, con icono y label "Reportes".

- [ ] **Paso 1: `api.ts` — funciones de cliente**

Seguir el patrón de `frontend/src/modules/general/api.ts` (función por endpoint, `fetch` con `credentials: 'include'`, parseo de error con `ApiError` si la respuesta no es 2xx — ver cualquier función existente ahí como plantilla exacta). Una función por cada uno de los 7 endpoints de datos (Tasks 2-8) — las de exportar las agrega Task 18.

- [ ] **Paso 2: `PeriodoSelector.tsx`**

Tres botones/pills: "Mes actual" (default, calcula `desde`/`hasta` del mes en curso), "Rango libre" (dos `<input type="date">`), "Todo el histórico" (`desde` = fecha muy antigua tipo `'2000-01-01'`, o mejor, omite `desde` y el backend trata ausencia... — NO: los endpoints de Tasks 2-8 exigen `desde`/`hasta` por el schema; para "histórico" el componente resuelve `desde` a una fecha fija suficientemente antigua, ej. `'2020-01-01'`, y `hasta` a hoy). Cuando el período activo no es "mes actual" ni "rango libre" de un solo mes, el selector de semana (si la pestaña lo usa) se deshabilita (Spec).

- [ ] **Paso 3: `ReportesPage.tsx` — contenedor de pestañas**

Estado local de pestaña activa (`'resumen' | 'ventas' | 'ventas-por-tipo' | 'gastos' | 'cierre-caja' | 'prestamos' | 'conciliacion'`), un `PeriodoSelector` compartido en la parte superior, renderiza la pestaña activa (las Tasks 11-17 agregan cada componente real — este paso puede dejar las 7 como placeholders `<p>Próximamente</p>` hasta que lleguen esas tareas, SIN que eso bloquee el build).

- [ ] **Paso 4: Integrar en `DashboardPage.tsx`**

Agregar `"reportes"` al union `Seccion` (línea 11) y un objeto a `SECCIONES` (icono sugerido: 📊). Agregar el `import { ReportesPage } from "../../reportes/pages/ReportesPage"` y el render condicional correspondiente, mismo patrón que las demás secciones (ver cómo está hecho para `"talleres"`, la sección más reciente agregada).

- [ ] **Paso 5: Verificar**

`npx tsc -b` en `frontend/`, limpio. Con `npm run dev` corriendo (puerto 5173): abrir el dashboard en el navegador, hacer login, confirmar que aparece la pestaña "Reportes" en el selector de secciones y que al entrar se ve el `PeriodoSelector` y los 7 placeholders sin errores en consola.

- [ ] **Paso 6: Commit**

```bash
git add frontend/src/modules/reportes/ frontend/src/modules/general/pages/DashboardPage.tsx
git commit -m "feat(reportes): scaffolding del módulo frontend y pestaña en el dashboard"
```

---

## Task 11: Pestaña Resumen (+ agregar `recharts`)

**Files:**
- Create: `frontend/src/modules/reportes/components/ResumenTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx` (reemplaza el placeholder)
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `reportesApi.obtenerResumen(desde, hasta)` (Task 10), `formatMoney` (`frontend/src/shared/format/money.ts`).

- [ ] **Paso 1: Agregar `recharts` a `frontend/package.json`**

`npm install recharts` desde `frontend/`.

- [ ] **Paso 2: KPIs (Bloque A) y flujo por medio de pago (Bloque B)**

Tarjetas tipo `StatCard` (seguir el patrón visual inline que ya usan `TalleresAnalyticsSection.tsx`/`InsumosAnalyticsSection.tsx` para sus tarjetas — no existe un `StatCard` compartido exportado hoy, replicar el mismo marcado/clases Tailwind). Mostrar "Cuentas por pagar" como "No disponible" (texto gris), no como `$0`.

- [ ] **Paso 3: Gastos por categoría (Bloque C) e Ingresos por tipo (Bloque D)**

Dos tablas simples (categoría/total, tipo/total) ordenadas descendente.

- [ ] **Paso 4: Matriz ventas por mes (Bloque E) + gráfico**

Tabla con filas Insumos/Con Sentido/Talleres/Total y una columna por mes. Gráfico de líneas o barras con `recharts` (`<LineChart>`/`<BarChart>` de `recharts`, una serie por línea de negocio) debajo de la tabla.

- [ ] **Paso 5: Montar en `ReportesPage.tsx`**

Reemplazar el placeholder de "resumen" por `<ResumenTab desde={desde} hasta={hasta} />`.

- [ ] **Paso 6: Verificar**

`npx tsc -b` limpio. En el navegador: entrar a Reportes → Resumen con datos reales de octubre 2026, confirmar visualmente que los números coinciden con los que ya se verificaron por `curl` en Task 2, y que el gráfico se ve bien en escritorio y en una ventana angosta (viewport móvil, ~390px).

- [ ] **Paso 7: Commit**

```bash
git add frontend/src/modules/reportes/ frontend/package.json frontend/package-lock.json
git commit -m "feat(reportes): pestaña Resumen con KPIs y gráfico mensual"
```

---

## Task 12: Pestaña Ventas

**Files:**
- Create: `frontend/src/modules/reportes/components/VentasTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx`

**Interfaces:**
- Consumes: `reportesApi.obtenerVentas(filtros)` (Task 10).

- [ ] **Paso 1: Filtros**

Inputs de método de pago (select efectivo/banco/todos), cliente (texto), producto (texto) — encima de la tabla, además del `PeriodoSelector` global.

- [ ] **Paso 2: Tabla + totales al pie**

Columnas exactas del Spec (Consecutivo, Fecha, Cliente, Producto, Cantidad, Precio unitario, Total, Método de pago). Fila de totales al pie: general, bancos, efectivo.

- [ ] **Paso 3: Vista agrupada por día**

Toggle simple tabla plana / agrupada por día (un `<details>` o acordeón por fecha, mismo patrón visual de cualquier tabla agrupada existente en el proyecto si hay una — si no, un `<details>` nativo por fecha es suficiente, sin librería nueva).

- [ ] **Paso 4: Montar en `ReportesPage.tsx` y verificar**

`npx tsc -b` limpio. En el navegador, confirmar que el total general de la tabla coincide con el de la pestaña Resumen para el mismo rango (misma invariante que Task 3 verificó por `curl`).

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): pestaña Ventas con filtros y totales"
```

---

## Task 13: Pestaña Ventas por tipo

**Files:**
- Create: `frontend/src/modules/reportes/components/VentasPorTipoTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx`

**Interfaces:**
- Consumes: `reportesApi.obtenerVentasPorTipo(desde, hasta)` (Task 10).

- [ ] **Paso 1: Tabla diaria**

Columnas Fecha/Insumos/Con Sentido/Talleres/Total.

- [ ] **Paso 2: Totales y % de participación**

Fila de totales al pie + 3 cifras de % de participación (una por línea) sobre el total del rango.

- [ ] **Paso 3: Gráfico de barras apiladas por mes**

`<BarChart>` de `recharts` con `stackId` compartido entre las 3 series (Insumos/Con Sentido/Talleres), agrupado por mes dentro del rango seleccionado.

- [ ] **Paso 4: Montar y verificar**

`npx tsc -b` limpio. Confirmar en navegador que la suma de la columna Total de todos los días coincide con el Bloque D de Resumen para el mismo rango.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): pestaña Ventas por tipo con gráfico apilado"
```

---

## Task 14: Pestaña Gastos

**Files:**
- Create: `frontend/src/modules/reportes/components/GastosTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx`

**Interfaces:**
- Consumes: `reportesApi.obtenerGastos(filtros)` (Task 10).

- [ ] **Paso 1: Filtros**

Categoría (select, poblado con las categorías reales que ya trae la respuesta del Bloque C de Resumen o una llamada propia a `getGastosPorCategoria`), proveedor (texto), método de pago.

- [ ] **Paso 2: Tabla + totales al pie**

Columnas del Spec MENOS Cantidad/Costo unitario (no existen — mostrar solo Fecha/Proveedor/Categoría/Descripción(`motivo`)/Total/Método). Totales: general, bancos, efectivo, préstamo (este último siempre "No disponible" — no existe ese método, Spec/Brechas).

- [ ] **Paso 3: Ranking de proveedores (top 10) y gráfico por categoría**

Tabla simple top 10. Gráfico de barras o dona (`recharts` `<PieChart>` o `<BarChart>`) de gastos por categoría.

- [ ] **Paso 4: Montar y verificar**

`npx tsc -b` limpio. Confirmar en navegador que el total general coincide con los gastos del Bloque A de Resumen para el mismo rango.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): pestaña Gastos con ranking de proveedores"
```

---

## Task 15: Pestaña Cierre de caja

**Files:**
- Create: `frontend/src/modules/reportes/components/CierreCajaTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx`

**Interfaces:**
- Consumes: `reportesApi.obtenerCierreCaja(mes)` (Task 10) — esta pestaña usa un selector de MES, no el `PeriodoSelector` global (Task 6: este endpoint toma `mes`, no `desde`/`hasta`).

- [ ] **Paso 1: Selector de mes propio**

Un `<input type="month">` simple, independiente del `PeriodoSelector` de las demás pestañas.

- [ ] **Paso 2: Tabla diaria**

Columnas exactas del Spec (Fecha, Venta día, Venta efectivo, Venta banco, Gastos efectivo, Gastos banco, Efectivo, Banco, Total dinero, Notas/Responsable). Fila de saldo inicial arriba (o "Dato no disponible" si vino `null`), fila TOTAL al pie.

- [ ] **Paso 3: Montar y verificar**

`npx tsc -b` limpio. Confirmar en navegador contra los mismos 2-3 días verificados por `curl` en Task 6.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): pestaña Cierre de caja diario"
```

---

## Task 16: Pestaña Préstamos

**Files:**
- Create: `frontend/src/modules/reportes/components/PrestamosTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx`

**Interfaces:**
- Consumes: `reportesApi.obtenerPrestamos(destinatarioUsuarioId?)` (Task 10) — sin período, selector de destinatario (lista de usuarios con al menos un vale, o un `<select>` de usuarios si ya existe un listado de usuarios reusable en el proyecto).

- [ ] **Paso 1: Selector de destinatario**

Dropdown "Todos" + lista de `pagado_a` distintos que aparecen en la respuesta sin filtro.

- [ ] **Paso 2: Tabla**

Columnas Fecha/Destinatario/Tipo/Monto/Estado/Fecha de resolución, como quedó definido en el Spec/Task 7.

- [ ] **Paso 3: Montar y verificar**

`npx tsc -b` limpio. Confirmar en navegador contra los datos reales de `vales` ya verificados en Task 7.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): pestaña Préstamos"
```

---

## Task 17: Pestaña Conciliación

**Files:**
- Create: `frontend/src/modules/reportes/components/ConciliacionTab.tsx`
- Modify: `frontend/src/modules/reportes/pages/ReportesPage.tsx`

**Interfaces:**
- Consumes: `reportesApi.obtenerConciliacion(desde, hasta)` (Task 10).

- [ ] **Paso 1: Tabla**

Columnas Fecha/Total por método/Total por tipo/Diferencia, resaltando en rojo cualquier fila con `tiene_diferencia: true`.

- [ ] **Paso 2: Montar y verificar**

`npx tsc -b` limpio. Confirmar en navegador que, con datos reales, ninguna fila queda resaltada (todas las diferencias en 0 — Task 8 Review Focus).

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): pestaña Conciliación"
```

---

## Task 18: Exportar a Excel desde el frontend

**Files:**
- Create: `frontend/src/modules/reportes/components/BotonExportarExcel.tsx`
- Modify: `frontend/src/modules/reportes/api.ts`
- Modify: las 7 pestañas (Tasks 11-17) — agregar el botón a cada una.

**Interfaces:**
- Consumes: `GET /reportes/:tipo/exportar` (Task 9).
- Produces: `<BotonExportarExcel tipo="ventas" filtros={...} />` — dispara `fetch` al endpoint de export con los mismos filtros activos de la pestaña, recibe el blob binario, y lo descarga con un `<a download>` sintético (patrón estándar de descarga de blob en el navegador).

- [ ] **Paso 1: `reportesApi.exportar(tipo, filtros): Promise<Blob>`**

En `api.ts`: `fetch` al endpoint de export, `credentials: 'include'`, devuelve `response.blob()` en vez de parsear JSON.

- [ ] **Paso 2: `BotonExportarExcel.tsx`**

Botón que llama `reportesApi.exportar`, crea `URL.createObjectURL(blob)`, dispara la descarga, revoca el object URL después.

- [ ] **Paso 3: Agregar el botón a las 7 pestañas**

Un `<BotonExportarExcel tipo="..." filtros={...} />` en la esquina superior de cada una de las 7 pestañas (Tasks 11-17), pasando los filtros/período activos de esa pestaña.

- [ ] **Paso 4: Verificar**

`npx tsc -b` limpio. En el navegador: en cada una de las 7 pestañas, click en "Exportar a Excel", confirmar que descarga un archivo `.xlsx` real (abrir con Excel/Numbers/LibreOffice o `unzip -l` como en Task 9) con los datos del filtro activo.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/modules/reportes/
git commit -m "feat(reportes): exportar cada reporte a Excel desde el dashboard"
```
