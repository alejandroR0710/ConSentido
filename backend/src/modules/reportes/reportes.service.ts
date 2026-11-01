import * as repo from "./reportes.repository";
import type {
  CierreCajaFila,
  CierreCajaReporte,
  CierreCajaSaldoInicial,
  GastoFila,
  GastosFiltros,
  GastosReporte,
  PrestamoFila,
  PrestamosReporte,
  ResumenReporte,
  ResumenVentasPorMesFila,
  VentasFila,
  VentasFiltros,
  VentasPorDia,
  VentasPorTipoDiaFila,
  VentasPorTipoReporte,
  VentasReporte,
} from "./reportes.types";

const LINEAS_NEGOCIO = ["insumos", "con_sentido", "talleres"] as const;

/**
 * Pivota las filas planas de `getVentasPorMes` (slug, mes, total) a una
 * matriz (filas = líneas de negocio + fila "total", columnas = meses
 * distintos encontrados en el histórico completo) — ver Bloque E del Spec.
 */
function pivotarVentasPorMes(filas: { slug: string; mes: string; total: string | number }[]) {
  const mesesSet = new Set<string>();
  const porLinea = new Map<string, Map<string, number>>(LINEAS_NEGOCIO.map((slug) => [slug, new Map<string, number>()]));

  for (const fila of filas) {
    mesesSet.add(fila.mes);
    porLinea.get(fila.slug)?.set(fila.mes, Number(fila.total));
  }

  const meses = [...mesesSet].sort();

  const filasMatriz: ResumenVentasPorMesFila[] = LINEAS_NEGOCIO.map((slug) => {
    const valoresLinea = porLinea.get(slug)!;
    return { slug, valores: Object.fromEntries(meses.map((mes) => [mes, valoresLinea.get(mes) ?? 0])) };
  });

  const filaTotal: ResumenVentasPorMesFila = {
    slug: "total",
    valores: Object.fromEntries(
      meses.map((mes) => [mes, filasMatriz.reduce((acum, fila) => acum + fila.valores[mes], 0)]),
    ),
  };

  return { meses, filas: [...filasMatriz, filaTotal] };
}

/**
 * Reporte "Resumen" — Bloques A-E. Es el reporte principal del módulo
 * (también usado por la exportación a Excel, Task 9), así que compone las
 * 4 queries independientes con `Promise.all`, siguiendo el patrón de
 * `analytics.service.ts`.
 */
export async function obtenerResumen(desde: string, hasta: string): Promise<ResumenReporte> {
  const [totalesRow, gastosPorCategoria, ingresosPorTipo, ventasPorMes] = await Promise.all([
    repo.getResumenTotales(desde, hasta),
    repo.getGastosPorCategoria(desde, hasta),
    repo.getIngresosPorTipo(desde, hasta),
    repo.getVentasPorMes(),
  ]);

  const ingresos_total = Number(totalesRow.ingresos_total);
  const gastos_total = Number(totalesRow.gastos_total);
  const ingresos_efectivo = Number(totalesRow.ingresos_efectivo);
  const ingresos_banco = Number(totalesRow.ingresos_banco);
  const gastos_efectivo = Number(totalesRow.gastos_efectivo);
  const gastos_banco = Number(totalesRow.gastos_banco);

  const utilidad = ingresos_total - gastos_total;
  const disponible_efectivo = ingresos_efectivo - gastos_efectivo;
  const disponible_banco = ingresos_banco - gastos_banco;
  const total_disponible = disponible_efectivo + disponible_banco;

  return {
    totales: {
      ingresos_total,
      gastos_total,
      utilidad,
      // No existen cuentas por pagar en el sistema (ver Spec/Brechas): dato
      // no disponible explícito, nunca inventado como 0.
      cuentas_por_pagar: null,
      utilidad_real_disponible: utilidad,
    },
    flujoPorMetodoPago: {
      ingresos_efectivo,
      ingresos_banco,
      gastos_efectivo,
      gastos_banco,
      disponible_efectivo,
      disponible_banco,
      total_disponible,
    },
    gastosPorCategoria: gastosPorCategoria.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      total: Number(g.total),
    })),
    ingresosPorTipo: ingresosPorTipo.map((i) => ({
      slug: i.slug,
      total: Number(i.total),
    })),
    ventasPorMes: pivotarVentasPorMes(ventasPorMes),
  };
}

/**
 * Reparte el `subtotal` de una línea (Paso 1) entre efectivo/banco según el
 * `metodo_pago` de la VENTA completa (no hay método por item, solo por
 * venta): limpio para `'efectivo'`/`'banco'` (todo el subtotal va a ese
 * balde), prorrateado para `'mixto'` usando el reparto real de la venta
 * (`monto_efectivo`/`monto_banco` sobre `monto_efectivo + monto_banco` —
 * NO sobre `monto`, ver Round 3 fix dentro de la rama `'mixto'` más abajo)
 * — nunca un 50/50 a ciegas. `monto_efectivo + monto_banco === 0` no
 * debería pasar en una venta `'mixto'` real (el `.refine()` de
 * `con_sentido.schema.ts` ya exige `montoEfectivo + montoBanco > 0`), pero
 * se cubre sin dividir por cero: ambos baldes en 0 para esa línea (no se
 * pierde del `total_general`, que no usa esta función — ver nota abajo).
 */
function repartirPorMetodoPago(
  metodoPago: "efectivo" | "banco" | "mixto" | null,
  subtotal: number,
  monto: number,
  montoEfectivo: number,
  montoBanco: number,
): { efectivo_share: number; banco_share: number } {
  if (metodoPago === "efectivo") return { efectivo_share: subtotal, banco_share: 0 };
  if (metodoPago === "banco") return { efectivo_share: 0, banco_share: subtotal };
  if (metodoPago === "mixto") {
    // Denominador = montoEfectivo + montoBanco, NO cv.monto (Round 3 fix):
    // con_sentido.schema.ts solo exige montoEfectivo + montoBanco > 0 para
    // 'mixto', nunca que esa suma sea igual a `monto` — así que una venta
    // mixta mal digitada (monto !== montoEfectivo + montoBanco, posible hoy
    // en el flujo "Nueva venta", no bloqueado por el schema) podía dejar
    // efectivo_share + banco_share !== subtotal si se dividía entre `monto`.
    // Dividiendo entre la suma real de los dos montos, ambas fracciones
    // siempre suman exactamente 1 por construcción, sin depender de esa
    // invariante no garantizada.
    const base = montoEfectivo + montoBanco;
    if (!base) return { efectivo_share: 0, banco_share: 0 };
    return {
      efectivo_share: subtotal * (montoEfectivo / base),
      banco_share: subtotal * (montoBanco / base),
    };
  }
  // `metodo_pago` NULL solo es posible en una venta todavía 'pendiente', que
  // Paso 1 ya excluye (`cv.estado = 'completada'`) — defensivo, no debería
  // alcanzarse en la práctica.
  return { efectivo_share: 0, banco_share: 0 };
}

/**
 * Reporte "Ventas" — concatena el detalle de producto (Paso 1) con los
 * ingresos sin línea propia (Paso 2), ordena por fecha, agrupa por día (la
 * "vista agrupada por día" del Spec) y calcula los totales del rango.
 *
 * `filtros.cliente` se recibe pero no se usa en ninguna de las dos queries:
 * `con_sentido_ventas`/`con_sentido_venta_items` no guardan ningún dato de
 * cliente (venta de mostrador — el propio documento de diseño lo anota:
 * "Cliente casi siempre vacío en mostrador, no es obligatorio en el
 * sistema"), así que no hay columna real contra la que filtrar. Se deja en
 * el esquema/tipo por si una fuente futura (Task 9 u otra) sí lo necesita.
 *
 * `total_efectivo`/`total_bancos` — segundo intento, ver historial completo
 * en el report de la Task 3 (dos rounds de fix anteriores):
 * - Round 0 (original): sumaba `filas.subtotal` agrupado por el
 *   `metodo_pago` de cada fila. Bug: una venta `'mixto'` no cae en ningún
 *   balde, así que `total_efectivo + total_bancos < total_general`.
 * - Round 1 (revertido en este fix): leía los totales con una query
 *   independiente sobre `movimientos_caja`
 *   (`getVentasTotalesPorMetodoPago`), acotada solo por rango + alcance +
 *   `metodo` — pero NUNCA recibía `producto`/`cliente`, así que esos filtros
 *   no movían los totales; y aun con solo `?metodo=`, una venta mixta sigue
 *   escribiendo AMBAS mitades en `movimientos_caja` (son dos movimientos
 *   separados, `efectivo` y `banco`, por diseño de
 *   `con_sentido.service.ts`), así que `?metodo=banco` seguía sumando la
 *   mitad efectivo... no, sumaba la mitad banco de una venta que la query de
 *   `filas` ya había excluido por no ser literalmente `'banco'` — doble
 *   inconsistencia, no solo "sin filtro".
 * - Round 2 (este fix): sin segunda query. Se prorratea CADA fila de detalle
 *   con `repartirPorMetodoPago` (arriba) usando el split real de SU propia
 *   venta (`cv.monto_efectivo`/`cv.monto_banco`/`cv.monto`, agregados en
 *   `getVentasDetalle`), y se suma sobre las filas que de verdad sobrevivieron
 *   el filtro — las mismas que ya ve `filas`/`total_general`. Las filas "sin
 *   detalle" (Paso 2, de `movimientos_caja`) siguen usando igualdad literal:
 *   esa tabla nunca tiene `'mixto'` (`con_sentido.service.ts` ya reparte cada
 *   venta mixta en dos movimientos limpios al escribir en caja), así que no
 *   hace falta prorratear ahí. Como ya no hay una segunda query con su propio
 *   alcance de filtros, `total_efectivo + total_bancos === total_general` es
 *   una identidad aritmética sobre el mismo array `filas`, no una coincidencia
 *   que dos queries separadas tengan que mantener sincronizada — se cumple
 *   automáticamente bajo cualquier combinación de `metodo`/`producto`/rango.
 */
export async function obtenerVentas(filtros: VentasFiltros): Promise<VentasReporte> {
  const { desde, hasta, metodo, cliente, producto } = filtros;

  const [detalle, sinDetalle] = await Promise.all([
    repo.getVentasDetalle(desde, hasta, { metodo, cliente, producto }),
    repo.getIngresosSinDetalle(desde, hasta, { metodo }),
  ]);

  let total_efectivo = 0;
  let total_bancos = 0;

  const filasDetalle: VentasFila[] = detalle.map((d) => {
    const subtotal = Number(d.subtotal);
    const { efectivo_share, banco_share } = repartirPorMetodoPago(
      d.metodo_pago,
      subtotal,
      Number(d.monto),
      Number(d.monto_efectivo),
      Number(d.monto_banco),
    );
    total_efectivo += efectivo_share;
    total_bancos += banco_share;
    return {
      tipo: "detalle",
      id: String(d.id),
      fecha: d.fecha,
      producto: d.producto,
      cantidad: Number(d.cantidad),
      precio_unitario: Number(d.precio_unitario),
      subtotal,
      metodo_pago: d.metodo_pago,
      area: d.area,
      consecutivo: d.consecutivo,
    };
  });

  const filasSinDetalle: VentasFila[] = sinDetalle.map((s) => {
    const subtotal = Number(s.monto);
    // `movimientos_caja.metodo_pago` nunca es 'mixto' (CHECK constraint) —
    // igualdad literal es correcta y exacta acá, sin prorrateo.
    if (s.metodo_pago === "efectivo") total_efectivo += subtotal;
    else if (s.metodo_pago === "banco") total_bancos += subtotal;
    return {
      tipo: "sin_detalle",
      id: String(s.id),
      fecha: s.fecha,
      producto: s.motivo,
      cantidad: null,
      precio_unitario: null,
      subtotal,
      metodo_pago: s.metodo_pago,
      area: s.area,
      consecutivo: null,
    };
  });

  const filas = [...filasDetalle, ...filasSinDetalle].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const porDiaMap = new Map<string, number>();
  for (const fila of filas) {
    porDiaMap.set(fila.fecha, (porDiaMap.get(fila.fecha) ?? 0) + fila.subtotal);
  }
  const porDia: VentasPorDia[] = [...porDiaMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, total]) => ({ fecha, total }));

  const total_general = filas.reduce((acc, f) => acc + f.subtotal, 0);

  return {
    filas,
    porDia,
    totales: { total_general, total_efectivo, total_bancos },
  };
}

/**
 * Reporte "Ventas por tipo" — pivotea las filas planas de
 * `getVentasPorTipoDiario` (fecha, slug, total) a una fila por día con
 * columnas insumos/con_sentido/talleres/total, más los totales del rango
 * completo por línea y el % de participación de cada una sobre ese total.
 *
 * Invariante (ver self-review del brief): la suma de `total` de todos los
 * días == `totales.total` == el `ingresos_total` del Bloque D de
 * `obtenerResumen` para el mismo rango — ambos leen exactamente las mismas
 * filas de `movimientos_caja` (mismo filtro de 3 líneas de negocio, mismo
 * `tipo='ingreso'`, mismo rango), solo que agrupadas distinto (por día aquí,
 * sin agrupar allá).
 *
 * Días sin ninguna línea con ingreso no aparecen (no hay fila que agrupar) —
 * mismo comportamiento que el resto del módulo, que no sintetiza días
 * vacíos. Dentro de un día que SÍ aparece, una línea sin ingreso ese día
 * queda en 0 explícito (no se omite la columna) porque el pivot inicializa
 * las 3 líneas en 0 antes de llenar las que trae la query.
 */
export async function obtenerVentasPorTipo(desde: string, hasta: string): Promise<VentasPorTipoReporte> {
  const filas = await repo.getVentasPorTipoDiario(desde, hasta);

  const porDiaMap = new Map<string, Record<(typeof LINEAS_NEGOCIO)[number], number>>();
  for (const fila of filas) {
    const slug = fila.slug as (typeof LINEAS_NEGOCIO)[number];
    const valoresDia = porDiaMap.get(fila.fecha) ?? { insumos: 0, con_sentido: 0, talleres: 0 };
    valoresDia[slug] = Number(fila.total);
    porDiaMap.set(fila.fecha, valoresDia);
  }

  const porDia: VentasPorTipoDiaFila[] = [...porDiaMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, valores]) => ({
      fecha,
      insumos: valores.insumos,
      con_sentido: valores.con_sentido,
      talleres: valores.talleres,
      total: valores.insumos + valores.con_sentido + valores.talleres,
    }));

  const totales = porDia.reduce(
    (acum, dia) => ({
      insumos: acum.insumos + dia.insumos,
      con_sentido: acum.con_sentido + dia.con_sentido,
      talleres: acum.talleres + dia.talleres,
      total: acum.total + dia.total,
    }),
    { insumos: 0, con_sentido: 0, talleres: 0, total: 0 },
  );

  const participacion = {
    insumos: totales.total ? (totales.insumos / totales.total) * 100 : 0,
    con_sentido: totales.total ? (totales.con_sentido / totales.total) * 100 : 0,
    talleres: totales.total ? (totales.talleres / totales.total) * 100 : 0,
  };

  return { porDia, totales, participacion };
}

/**
 * Reporte "Gastos" — compone 3 queries independientes vía `Promise.all`:
 * detalle de egresos (filtrable), ranking top-10 de proveedores (siempre
 * sobre el universo completo del rango, sin los filtros opcionales — ver
 * nota del repository) y gastos por categoría (`getGastosPorCategoria`,
 * reusada literalmente de Task 2 para el gráfico de este reporte, no
 * duplicada).
 *
 * `total_efectivo`/`total_bancos` — a diferencia de `obtenerVentas`
 * (`con_sentido_ventas.metodo_pago` sí admite `'mixto'`, de ahí el
 * prorrateo por fila), acá NO hace falta: `movimientos_caja.metodo_pago`
 * tiene `CHECK (metodo_pago IN ('efectivo', 'banco'))` (schema.sql) — nunca
 * `'mixto'`, nunca "préstamo" (esa forma de pago no existe en el sistema,
 * Spec/Brecha #2). Sumar por igualdad literal sobre `filas` es exacto y, por
 * construcción, `total_efectivo + total_bancos === total_general` siempre
 * (toda fila cae en exactamente uno de los dos baldes).
 */
export async function obtenerGastos(filtros: GastosFiltros): Promise<GastosReporte> {
  const { desde, hasta, categoriaId, proveedorId, metodo } = filtros;

  const [detalle, topProveedores, gastosPorCategoria] = await Promise.all([
    repo.getGastosDetalle(desde, hasta, { categoriaId, proveedorId, metodo }),
    repo.getTopProveedores(desde, hasta),
    repo.getGastosPorCategoria(desde, hasta),
  ]);

  let total_efectivo = 0;
  let total_bancos = 0;

  const filas: GastoFila[] = detalle.map((d) => {
    const monto = Number(d.monto);
    if (d.metodo_pago === "efectivo") total_efectivo += monto;
    else if (d.metodo_pago === "banco") total_bancos += monto;
    return {
      id: String(d.id),
      fecha: d.fecha,
      proveedor: d.proveedor,
      categoria: d.categoria,
      motivo: d.motivo,
      monto,
      metodo_pago: d.metodo_pago,
    };
  });

  const total_general = filas.reduce((acc, f) => acc + f.monto, 0);

  return {
    filas,
    topProveedores: topProveedores.map((p) => ({ id: p.id, nombre: p.nombre, total: Number(p.total) })),
    gastosPorCategoria: gastosPorCategoria.map((g) => ({ id: g.id, nombre: g.nombre, total: Number(g.total) })),
    totales: { total_general, total_efectivo, total_bancos },
  };
}

/** Todos los días calendario de `mes` (`YYYY-MM`), como `YYYY-MM-DD`, sin
 *  pasar por `Date`/`toISOString` (evitaría cualquier corrimiento de zona
 *  horaria): `new Date(anio, mesIndice1Based, 0).getDate()` es el truco
 *  estándar para "último día del mes" (día 0 del mes siguiente), evaluado
 *  en horario local del proceso — nunca se usa esa `Date` para construir
 *  las fechas de salida, solo para contar cuántos días tiene el mes. */
function diasDelMes(mes: string): string[] {
  const [anioStr, mesStr] = mes.split("-");
  const anio = Number(anioStr);
  const numMes = Number(mesStr);
  const totalDias = new Date(anio, numMes, 0).getDate();
  return Array.from({ length: totalDias }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Reporte "Cierre de caja diario" — ÚNICA excepción de alcance de todo el
 * módulo (ver reportes.types.ts): ninguna de las 3 queries de este reporte
 * filtra por `modulo_origen_id`/`MODULOS_ALCANCE_SUBQUERY` — es la caja
 * física real y única del POS, Migao incluido.
 *
 * Construye el saldo corrido día por día sobre TODOS los días calendario
 * del mes (`diasDelMes`, no solo los días que `getMovimientosDiarios`
 * trajo con filas reales) — un día sin ningún movimiento todavía necesita
 * una fila con los 4 montos en `0` que SÍ propaga el saldo corrido del día
 * anterior (no lo resetea, no lo omite).
 *
 * `efectivoCorrido`/`bancoCorrido` arrancan en `saldo_inicial` (Paso 2) —
 * `?? 0` solo aplica cuando `saldo_inicial` es `null` (no hay ningún turno
 * registrado hasta este mes): la propagación aritmética sigue funcionando
 * igual, arrancando en 0, SIN que eso cambie el valor expuesto de
 * `saldo_inicial` en la respuesta, que se calcula antes y por separado — un
 * mes sin turno previo sigue devolviendo `saldo_inicial: null` (dato no
 * disponible) aunque el saldo corrido interno arranque en 0 para poder
 * calcularse igual.
 *
 * Fix de review (Finding 1) — `saldo_inicial` YA NO es solo los montos de
 * apertura crudos del turno semilla: ahora les suma el flujo (venta −
 * gastos, por método, `getFlujoEntreFechas`) de TODOS los `movimientos_caja`
 * entre `turno.abierto_en` (inclusive) y el día 1 del mes solicitado
 * (exclusive). El algoritmo original del brief ignoraba ese arrastre — para
 * cualquier mes POSTERIOR al mes de apertura del turno, perdía todo lo que
 * pasó en la caja entre esa apertura y el inicio del mes pedido (ej. pedir
 * `mes=2026-11` con el turno abierto el 2026-10-20 mostraba
 * `saldo_inicial: {0, 0}` en vez del saldo real de fin de octubre). Para el
 * propio mes de apertura del turno la ventana es vacía (nada pasa en la caja
 * antes de que el turno la abra), así que este fix no cambia nada para una
 * consulta sobre ESE mes — solo corrige los meses posteriores.
 */
export async function obtenerCierreCaja(mes: string): Promise<CierreCajaReporte> {
  const [movimientos, primerTurno, cajerosPorDiaFilas] = await Promise.all([
    repo.getMovimientosDiarios(mes),
    repo.getPrimerTurnoDelRango(mes),
    repo.getCajerosPorDia(mes),
  ]);

  const movimientosPorFecha = new Map<
    string,
    { venta_efectivo: number; venta_banco: number; gastos_efectivo: number; gastos_banco: number }
  >();
  for (const m of movimientos) {
    movimientosPorFecha.set(m.fecha, {
      venta_efectivo: Number(m.venta_efectivo ?? 0),
      venta_banco: Number(m.venta_banco ?? 0),
      gastos_efectivo: Number(m.gastos_efectivo ?? 0),
      gastos_banco: Number(m.gastos_banco ?? 0),
    });
  }

  // Puede haber más de un turno (cambio de cajero) el mismo día calendario.
  const cajerosPorFecha = new Map<string, string[]>();
  for (const c of cajerosPorDiaFilas) {
    const nombres = cajerosPorFecha.get(c.fecha) ?? [];
    nombres.push(c.nombre);
    cajerosPorFecha.set(c.fecha, nombres);
  }

  let saldo_inicial: CierreCajaSaldoInicial | null = null;
  if (primerTurno) {
    const flujo = await repo.getFlujoEntreFechas(primerTurno.abierto_en, `${mes}-01`);
    saldo_inicial = {
      efectivo:
        Number(primerTurno.monto_inicial_efectivo) +
        Number(flujo.venta_efectivo ?? 0) -
        Number(flujo.gastos_efectivo ?? 0),
      banco:
        Number(primerTurno.monto_inicial_banco) +
        Number(flujo.venta_banco ?? 0) -
        Number(flujo.gastos_banco ?? 0),
    };
  }

  let efectivoCorrido = saldo_inicial?.efectivo ?? 0;
  let bancoCorrido = saldo_inicial?.banco ?? 0;

  const dias: CierreCajaFila[] = diasDelMes(mes).map((fecha) => {
    const m = movimientosPorFecha.get(fecha) ?? {
      venta_efectivo: 0,
      venta_banco: 0,
      gastos_efectivo: 0,
      gastos_banco: 0,
    };

    efectivoCorrido = efectivoCorrido + m.venta_efectivo - m.gastos_efectivo;
    bancoCorrido = bancoCorrido + m.venta_banco - m.gastos_banco;

    const responsables = cajerosPorFecha.get(fecha);

    return {
      fecha,
      venta_efectivo: m.venta_efectivo,
      venta_banco: m.venta_banco,
      venta_dia: m.venta_efectivo + m.venta_banco,
      gastos_efectivo: m.gastos_efectivo,
      gastos_banco: m.gastos_banco,
      efectivo: efectivoCorrido,
      banco: bancoCorrido,
      total_dinero: efectivoCorrido + bancoCorrido,
      notas_responsable: responsables?.length ? responsables.join(", ") : "—",
    };
  });

  // Fila TOTAL: los 5 montos de movimiento son la SUMA de los `dias`
  // (incluido el último — anti-goal del Excel original, Spec); el saldo
  // corrido (`efectivo`/`banco`/`total_dinero`) es el del ÚLTIMO día, no una
  // suma de saldos (sumar saldos corridos no tendría sentido aritmético).
  const ultimoDia = dias[dias.length - 1];
  const total: CierreCajaFila = {
    fecha: "TOTAL",
    venta_efectivo: dias.reduce((acum, d) => acum + d.venta_efectivo, 0),
    venta_banco: dias.reduce((acum, d) => acum + d.venta_banco, 0),
    venta_dia: dias.reduce((acum, d) => acum + d.venta_dia, 0),
    gastos_efectivo: dias.reduce((acum, d) => acum + d.gastos_efectivo, 0),
    gastos_banco: dias.reduce((acum, d) => acum + d.gastos_banco, 0),
    efectivo: ultimoDia.efectivo,
    banco: ultimoDia.banco,
    total_dinero: ultimoDia.total_dinero,
    // No hay un único "responsable del mes completo" — a diferencia de
    // efectivo/banco/total_dinero, copiar el del último día sería engañoso
    // (ver nota en reportes.types.ts::CierreCajaFila).
    notas_responsable: "—",
  };

  return { mes, saldo_inicial, dias, total };
}

/**
 * Reporte "Préstamos" — único reporte del módulo que lee `vales` en vez de
 * `movimientos_caja`; no hay concepto de módulo/alcance de negocio acá (un
 * vale no está etiquetado por área), así que no se reutiliza ningún query
 * builder del resto del módulo.
 *
 * Por cada vale (ya filtrado sin anulados por `getVales`), `monto`/`estado`/
 * `fecha_resolucion` se derivan según `tipo` — dos obligaciones distintas,
 * con sus propias columnas de "cuánto"/"cuándo se resolvió":
 * - `tipo='deuda'`: `monto = monto_adeudado`; se resuelve cuando se cobra
 *   (`cobrado_en`) → `estado: 'Cobrado'` / `'Pendiente de cobro'`.
 * - `tipo='pago'`: `monto = monto_efectivo + monto_banco`; se resuelve
 *   cuando se repone al dueño (`repuesto_en`) → `estado: 'Repuesto'` /
 *   `'Pendiente de reposición'`.
 * Las etiquetas NUNCA se comparten entre los dos tipos (a propósito, para no
 * mezclar "cobrar una deuda" con "reponerle a un dueño") — ver brief, Paso 2.
 *
 * `total_pendiente`/`total_resuelto` suman `monto` según si la fila tiene
 * `fecha_resolucion` o no, sobre el mismo array `filas` que se devuelve (no
 * una query de agregación aparte) — mismo patrón de "totales derivados del
 * array ya construido" que `obtenerVentas`/`obtenerGastos`.
 */
export async function obtenerPrestamos(destinatarioUsuarioId?: string): Promise<PrestamosReporte> {
  const valesRows = await repo.getVales(destinatarioUsuarioId);

  let total_pendiente = 0;
  let total_resuelto = 0;

  const filas: PrestamoFila[] = valesRows.map((v) => {
    let monto: number;
    let estado: string;
    let fecha_resolucion: string | null;

    if (v.tipo === "deuda") {
      monto = Number(v.monto_adeudado);
      estado = v.cobrado_en ? "Cobrado" : "Pendiente de cobro";
      fecha_resolucion = v.cobrado_en;
    } else {
      monto = Number(v.monto_efectivo) + Number(v.monto_banco);
      estado = v.repuesto_en ? "Repuesto" : "Pendiente de reposición";
      fecha_resolucion = v.repuesto_en;
    }

    if (fecha_resolucion) total_resuelto += monto;
    else total_pendiente += monto;

    return {
      id: String(v.id),
      numero: v.numero,
      tipo: v.tipo,
      pagado_a: v.pagado_a,
      destinatario_usuario_id: v.destinatario_usuario_id,
      concepto: v.concepto,
      monto,
      estado,
      fecha_resolucion,
      created_at: v.created_at,
    };
  });

  return { filas, totales: { total_pendiente, total_resuelto } };
}
