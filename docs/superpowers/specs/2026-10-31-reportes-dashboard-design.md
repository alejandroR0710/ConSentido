# Módulo de Reportes en el Dashboard — Diseño

## Intención y por qué

Hoy la contabilidad del negocio Con Sentido se lleva en un Excel manual
(`CON__SENTIDO_OCTUBRE_2026.xlsx`) que además tiene errores de fórmulas y
fechas mal digitadas. El objetivo es reemplazar esa hoja de cálculo con una
sección de **Reportes** dentro del dashboard del POS, calculada en vivo
sobre los datos que el sistema ya captura, sin digitación manual duplicada
y sin los errores que el Excel acumuló.

## Alcance de negocio

Estos reportes cubren el negocio **Con Sentido** tal como existe en el
sistema: todo lo que cae en `movimientos_caja` con `modulo_origen_id`
dentro de `{insumos, con_sentido, talleres, general, pedidos}`.

- **`general`** se incluye porque es donde caen los gastos fijos/
  administrativos no atados a un área específica (arriendo, marketing,
  administrativo) — excluirlo dejaría huecos justo en las categorías de
  gasto que el Excel más quiere ver.
- **`migao`** se excluye: es un negocio aparte (cafetería/restaurante con
  su propia caja, mesas y meseros) que ya tiene su propio analytics
  (`/analytics/migao`). No se mezcla con estos reportes (excepto el
  reporte de Cierre de caja — ver nota especial más abajo).
- **`vales`** se excluye de Ingresos/Gastos: son préstamos, no ingresos ni
  gastos del negocio. Sí alimentan el reporte de Préstamos (ver abajo).
- **`pedidos` SÍ se incluye** (corrección tras revisión de código: mi
  primera versión de este documento asumía que todas las ventas de
  Pedidos ya se reclasificaban a insumos/con_sentido/talleres y que
  `pedidos` nunca recibía movimientos de caja propios — eso es falso.
  `movimientos_caja.modulo_origen_id = 'pedidos'` sí ocurre hoy: (a) todo
  abono de un pedido creado antes de la migración de áreas por producto
  cae ahí como respaldo, y (b) Caja General permite etiquetar un
  ingreso/egreso manual como "Pedidos" directamente. Excluirlo haría que
  plata real desaparezca en silencio de Resumen/Ventas/Gastos/
  Conciliación — justo el tipo de descuadre que este proyecto busca
  eliminar).

Confirmado con el usuario (2026-10-31): alcance Insumos + Con Sentido +
Talleres + General (+ Pedidos, corrección posterior).

## Reglas globales (Global Constraints)

- **Solo lectura.** Ningún reporte escribe, borra ni migra datos. Todas
  las consultas son `SELECT`.
- **No inventar datos.** Si el modelo actual no tiene un campo que el
  Excel pide, el reporte lo marca como "dato no disponible" y se lista en
  la sección de Brechas al final — nunca se rellena con un valor inventado
  ni se fuerza una forma de dato que no existe (ver sección Brechas).
- **Moneda:** COP, sin decimales, separador de miles con punto —
  reutilizar `frontend/src/shared/format/money.ts::formatMoney` (ya hace
  exactamente `$1.264.900`), tanto en frontend como en el texto de los
  Excel exportados.
- **Zona horaria:** la conexión MySQL ya fija `time_zone = '-05:00'`
  (Bogotá) a nivel de sesión (`backend/src/shared/db/pool.ts`) — no hace
  falta ninguna conversión adicional en las consultas; `NOW()`/`CURDATE()`
  ya están en hora de Bogotá.
- **Semana:** semana del mes (1–5, por bloques de 7 días desde el día 1)
  como opción principal; semana ISO como alternativa en el selector de
  "Ventas". El filtro/agrupación por semana solo tiene sentido dentro de
  un único mes — si el período activo es "rango libre" abarcando varios
  meses o "todo el histórico", el selector de semana se oculta y el
  reporte agrupa por día o por mes en su lugar.
- **Agregaciones en la base de datos** (`GROUP BY`), nunca traer todas las
  filas al frontend para sumar ahí.
- **Reutilizar el permiso existente** `general.dashboard.analytics.ver`
  para toda la sección de Reportes — es el mismo rol (gerencia/dueño) que
  ya ve Analytics, y evita una migración de seed solo para un permiso
  nuevo.
- **Sin nuevas migraciones de esquema.** Todo reporte se construye sobre
  tablas que ya existen (no se crea ninguna tabla nueva, incluida
  "cuentas por pagar" — ver Brechas).
- **Rama de trabajo:** todo este desarrollo vive en una rama local
  independiente (`feature/reportes-dashboard`), no se sube a `origin` ni
  se mergea a `main` hasta que el usuario lo revise y lo apruebe.

## Mapeo Excel → sistema real (confirmado)

| Concepto Excel | Fuente real | Nota |
|---|---|---|
| Ingresos / Ventas (fecha, total, método de pago) | `movimientos_caja` (tipo=ingreso), filtrado a los 4 módulos de alcance | Método de pago solo tiene `efectivo`/`banco` en la BD — no hay Nequi/tarjeta/transferencia como valores separados |
| Ingresos / Ventas (cliente, producto, cantidad) | `con_sentido_venta_items` + `pedido_items` + `productos` | Corrección: `venta_items` es exclusivo de Migao (nunca lo escriben Con Sentido/Insumos/Talleres/Pedidos) — no se usa aquí. Cliente casi siempre vacío en mostrador (no es obligatorio en el sistema) |
| Consecutivo de venta | `facturas.numero` cuando existe factura; si no, id interno de la venta | `ventas`/`con_sentido_ventas` no tienen número propio |
| Ingresos por Tipo (Velas / Insumos / Talleres) | área por producto ya calculada: `insumos` / `con_sentido` / `talleres` | **"Con Sentido" no es solo "Velas"** — es el área catch-all (velas, concreto, y cualquier producto del e-commerce sin categoría de insumos/talleres). El reporte usa las etiquetas reales `Insumos / Con Sentido / Talleres`, no fuerza "Velas" |
| Gastos (proveedor, categoría, método, total) | `movimientos_caja` (tipo=egreso) `.proveedor_id/categoria_gasto_id/metodo_pago/monto` | Categorías de gasto son dinámicas (lo que exista hoy en `categorias_gasto`), no las 11 fijas del Excel |
| Gastos (cantidad, costo unitario) | — | NO EXISTE desglose por línea — un egreso es un monto total con `motivo` en texto libre |
| Método de pago "Préstamo" en gastos | — | NO EXISTE — ver Brechas |
| Cuentas por pagar | — | NO EXISTE ninguna tabla de deuda a proveedor — ver Brechas |
| Cierre de caja diario (hoja MIGAO) | `turnos_caja` + `movimientos_caja`, **sin filtrar por módulo** | Confirmado con el usuario (2026-10-31): este reporte es el único que NO excluye Migao — es el conteo físico real de la caja única del POS (compartida por todos los módulos, Migao incluido), no una reconstrucción del negocio Con Sentido. Es distinto en naturaleza a los demás reportes de este documento, que sí están acotados al negocio Con Sentido |
| Préstamos a empleados (hoja DEUDA SERGIO) | `vales`, ambos `tipo` (`deuda` y `pago`) | NO soporta saldo corrido parcial — el cobro/reposición es del monto total de una sola vez. Confirmado con el usuario (2026-10-31): se construye una versión simplificada con lo que sí existe, en vez de omitirlo. Corrección tras revisión de código: se incluyen los dos `tipo` de vale (no solo `deuda`) — `tipo='pago'` es dinero que ya salió hacia el empleado y también es un préstamo real, solo que con su propio modelo de estado (repuesto/pendiente-reposición en vez de cobrado/pendiente-cobro); el reporte muestra Fecha \| Destinatario \| Tipo \| Monto \| Estado (el estado nativo de cada tipo) \| Fecha de resolución |

## Brechas (quedan fuera, no se inventan)

1. **Cuentas por pagar** — no existe ninguna tabla de deuda a proveedor con
   abonos parciales/saldo/estado. No se construye ese reporte; queda
   documentado como dato no disponible.
2. **Método de pago "Préstamo" en gastos** y su reconciliación con cuentas
   por pagar (regla de no doble conteo del Excel) — no aplica, porque
   ninguno de los dos conceptos existe en el sistema.
3. **Desglose cantidad/costo unitario por línea de gasto** — un egreso es
   un monto total, no una lista de ítems.
4. **Préstamos a empleados con saldo corrido** — se construye una versión
   simplificada (ver mapeo arriba) en vez de la forma exacta del Excel.
5. **Categorías de gasto fijas del Excel** (materia prima, empaque,
   herramientas, etc.) — se listan las categorías reales que ya existan en
   `categorias_gasto`, no las 11 del Excel.
6. **Consecutivo de venta propio** fuera de la tabla `facturas`.

## Inconsistencias del Excel que el sistema debe evitar (anti-goals)

- Fórmulas de "Ventas por mes" desplazadas de mayo en adelante → cada
  reporte suma por mes real, agregado en SQL, nunca copiando una celda
  desplazada.
- Cuentas por pagar con `Abono − Valor` en vez de `Valor − Abono` → no
  aplica (esa hoja no se construye), pero si en el futuro se construye,
  el orden de la resta queda documentado aquí para no repetir el error.
- Ingresos vs Ingresos por Tipo que no cuadran → como ambos reportes leen
  de la MISMA fuente (`movimientos_caja` filtrado a los mismos módulos),
  no deberían desincronizarse. El reporte de Conciliación igual se
  construye como verificación cruzada día por día.
- Fechas fuera de rango razonable (años 0265, 1900, 2027, etc.) → los
  datos reales del sistema no tienen este problema (son `DATETIME`
  generados por la aplicación, no digitados a mano), así que no se
  necesita un filtro especial; cualquier fecha fuera del rango
  seleccionado simplemente no entra a los totales por el `WHERE` normal.
- Totales de cierre de caja que omiten el último día del mes → el reporte
  de Cierre de caja itera explícitamente todos los días del rango
  seleccionado (incluyendo el último), no una resta de fechas que pueda
  quedar corta.

## Reportes a construir (y su forma final)

1. **Resumen** (vista principal, con selector de período: mes actual por
   defecto, rango libre, o todo el histórico):
   - Bloque A: Total ingresos, Total gastos, Utilidad, Cuentas por pagar
     (omitido — brecha), Utilidad real disponible = Utilidad (sin ajuste
     de cuentas por pagar, ya que no existen).
   - Bloque B: flujo por medio de pago (ingresos/gastos/disponible, banco
     y efectivo).
   - Bloque C: gastos por categoría (categorías reales, incluidas las que
     estén en 0 si tienen movimientos en otro período del rango... si no
     tienen ningún movimiento histórico tampoco se inventan en 0).
   - Bloque D: ingresos por tipo (Insumos / Con Sentido / Talleres).
   - Bloque E: matriz ventas por mes (filas Insumos/Con Sentido/Talleres/
     Total, columnas = todos los meses con datos en el histórico
     completo) + gráfico de evolución mensual. **Este bloque es
     independiente del selector de período del Resumen** — si no, con
     "mes actual" por defecto la matriz colapsaría a una sola columna y
     perdería su propósito de mostrar la evolución mensual (igual que en
     el Excel original, que tiene una columna fija por cada mes desde que
     el negocio empezó a operar).
2. **Ventas**: tabla con filtros (fecha, mes, semana, método, cliente,
   producto), totales al pie, vista agrupada por día.
3. **Ventas por tipo**: tabla diaria Insumos/Con Sentido/Talleres/Total,
   totales y % de participación, gráfico de barras apiladas por mes.
4. **Gastos**: tabla con filtros (fecha, mes, semana, categoría,
   proveedor, método), totales al pie, ranking de proveedores (top 10),
   gráfico por categoría.
5. **Cierre de caja diario**: un renglón por día del mes seleccionado
   (incluye días sin movimiento en 0), con saldo inicial y fila TOTAL que
   cubre todo el mes. Es la caja física real y única del POS — sin
   filtrar por módulo (incluye Migao, ver mapeo arriba). Construcción:
   - `VENTA EFECTIVO`/`VENTA BANCO`/`GASTOS EFECTIVO`/`GASTOS BANCO` de
     ese día = suma de `movimientos_caja` de ese día por tipo+método, sin
     filtro de `modulo_origen_id`.
   - `EFECTIVO`/`BANCO` (columnas de saldo corrido) = saldo del día
     anterior + (venta − gastos) de ese método ese día — no se leen de
     `turnos_caja.monto_final_calculado_*`, porque un turno puede abrir o
     cerrar a media jornada y no siempre coincide con el corte de
     calendario.
   - Fila de saldo inicial = `monto_inicial_efectivo`/`monto_inicial_banco`
     del primer `turno_caja` dentro del rango seleccionado (si el rango
     empieza antes de cualquier turno registrado, la fila queda como
     "dato no disponible" en vez de asumir 0).
   - `Notas/Responsable` por día = nombre(s) del/los `cajero_id` de
     cualquier turno que estuvo abierto ese día (puede haber más de uno
     si hubo cambio de turno).
6. **Préstamos** (simplificado, basado en `vales`): selector de
   destinatario, tabla Fecha | Destinatario | Monto adeudado | Estado
   (pendiente/cobrado) | Fecha de cobro.
7. **Conciliación**: por día, total de ventas por método de pago vs total
   por tipo (Insumos/Con Sentido/Talleres), marca los días con diferencia.
8. **Cuentas por pagar**: NO se construye (brecha). No hay pestaña para
   esto; se documenta solo en el resumen final de brechas.

Exportar a Excel (.xlsx) cada reporte con los mismos nombres de columna
del Excel original donde aplique.

## Decisiones de "cómo se construye" (mi criterio, el usuario puede corregir)

- **Backend:** nuevo módulo `backend/src/modules/reportes/` siguiendo el
  patrón existente (`*.routes.ts` / `*.controller.ts` / `*.service.ts` /
  `*.repository.ts` / `*.schema.ts`), montado en `backend/src/app.ts` como
  los demás módulos. Endpoints bajo `GET /reportes/*`.
- **Frontend:** nuevo módulo `frontend/src/modules/reportes/` con una
  página de pestañas, agregada como una sección más del
  `DashboardPage.tsx` (union `Seccion` ya existente).
- **Gráficos:** el proyecto no tiene ninguna librería de gráficos hoy
  (`frontend/package.json` solo tiene react/react-dom/react-router-dom).
  Propongo agregar `recharts` (liviana, estándar en React, compatible con
  React 19) en vez de reinventar gráficos de barras/líneas en SVG a mano.
  Si se prefiere no agregar dependencias nuevas, la alternativa es barras
  simples con `<div>`s y porcentajes — lo digo aquí como mi llamada, el
  plan puede ajustarse si el usuario prefiere la alternativa sin
  dependencia nueva.
- **Exportar a Excel:** el backend tampoco tiene ninguna librería de Excel
  hoy. Propongo `exceljs` (genera `.xlsx` real en Node, bien mantenida) en
  el backend — el endpoint de export genera el archivo en el servidor y
  el frontend solo dispara la descarga. Mismo criterio: si se prefiere
  evitar la dependencia nueva, la alternativa es CSV (abre en Excel, pero
  sin formato de hoja real).
- El PDF del Resumen que menciona el documento original queda fuera de
  este plan por ahora (no hay librería de PDF tampoco y no es el reporte
  más usado); se puede agregar después si hace falta.

## Qué queda a criterio de quien implemente

- Nombres exactos de componentes React y organización interna de
  carpetas dentro de `frontend/src/modules/reportes/components/`.
- Forma exacta de las queries SQL (joins, CTEs) mientras respeten los
  `GROUP BY` en base de datos y el alcance de módulos confirmado.
- Estructura exacta de los DTOs/tipos de respuesta de cada endpoint.
