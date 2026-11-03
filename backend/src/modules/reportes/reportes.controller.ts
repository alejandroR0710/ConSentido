import { Request, Response } from "express";
import { ok } from "../../shared/utils/response";
import { CLAVE_NUMFMT_POR_CELDA, ColumnaExcel, FORMATO_MONTO, FORMATO_PORCENTAJE, generarExcel } from "./reportes.excel";
import {
  reportesCierreCajaSchema,
  reportesExportarTipoSchema,
  reportesGastosFiltrosSchema,
  reportesPrestamosFiltrosSchema,
  reportesRangoSchema,
  reportesVentasFiltrosSchema,
} from "./reportes.schema";
import * as service from "./reportes.service";
import type {
  CierreCajaFila,
  CierreCajaReporte,
  ConciliacionReporte,
  GastosReporte,
  PrestamosReporte,
  ResumenReporte,
  VentasPorTipoReporte,
  VentasReporte,
} from "./reportes.types";

export async function obtenerResumenController(req: Request, res: Response) {
  const { desde, hasta } = reportesRangoSchema.parse(req.query);
  const resumen = await service.obtenerResumen(desde, hasta);
  return ok(res, resumen);
}

export async function obtenerVentasController(req: Request, res: Response) {
  const filtros = reportesVentasFiltrosSchema.parse(req.query);
  const ventas = await service.obtenerVentas(filtros);
  return ok(res, ventas);
}

export async function obtenerVentasPorTipoController(req: Request, res: Response) {
  const { desde, hasta } = reportesRangoSchema.parse(req.query);
  const ventasPorTipo = await service.obtenerVentasPorTipo(desde, hasta);
  return ok(res, ventasPorTipo);
}

export async function obtenerGastosController(req: Request, res: Response) {
  const filtros = reportesGastosFiltrosSchema.parse(req.query);
  const gastos = await service.obtenerGastos(filtros);
  return ok(res, gastos);
}

export async function obtenerConciliacionController(req: Request, res: Response) {
  const { desde, hasta } = reportesRangoSchema.parse(req.query);
  const conciliacion = await service.obtenerConciliacion(desde, hasta);
  return ok(res, conciliacion);
}

export async function obtenerCierreCajaController(req: Request, res: Response) {
  const { mes } = reportesCierreCajaSchema.parse(req.query);
  const cierreCaja = await service.obtenerCierreCaja(mes);
  return ok(res, cierreCaja);
}

export async function obtenerPrestamosController(req: Request, res: Response) {
  const { destinatarioUsuarioId } = reportesPrestamosFiltrosSchema.parse(req.query);
  const prestamos = await service.obtenerPrestamos(destinatarioUsuarioId);
  return ok(res, prestamos);
}

/**
 * Task 9 — mapeo de cada uno de los 7 reportes a filas planas de Excel.
 *
 * Ninguno de estos mappers repite ninguna query: consumen tal cual el
 * resultado ya calculado por el `service.obtener*` correspondiente (Tasks
 * 2-8). Las decisiones de "cómo aplanar" cada forma están documentadas en el
 * report de esta tarea (`task-9-report.md`) — en particular Resumen (5
 * bloques heterogéneos, sin tabla natural) y Cierre de caja (saldo inicial +
 * días + fila TOTAL) no tienen un mapeo 1:1 campo-por-campo con el Spec.
 */

/** Resumen (Bloques A-E) — sin una tabla natural única, se aplana en formato
 *  "largo" (Bloque, Concepto, Valor): una fila por cada KPI/categoría/mes,
 *  en vez de inventar una grilla ancha distinta por bloque dentro de la
 *  misma hoja de columnas uniformes que exige `generarExcel`. */
function mapearResumen(resumen: ResumenReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Bloque", key: "bloque" },
    { header: "Concepto", key: "concepto" },
    { header: "Valor", key: "valor", numFmt: FORMATO_MONTO },
  ];

  const filas: Record<string, unknown>[] = [];

  filas.push(
    { bloque: "Totales", concepto: "Ingresos totales", valor: resumen.totales.ingresos_total },
    { bloque: "Totales", concepto: "Gastos totales", valor: resumen.totales.gastos_total },
    { bloque: "Totales", concepto: "Utilidad", valor: resumen.totales.utilidad },
    {
      bloque: "Totales",
      concepto: "Cuentas por pagar",
      valor: resumen.totales.cuentas_por_pagar ?? "No disponible",
    },
    { bloque: "Totales", concepto: "Utilidad real disponible", valor: resumen.totales.utilidad_real_disponible },
  );

  const flujo = resumen.flujoPorMetodoPago;
  filas.push(
    { bloque: "Flujo por método de pago", concepto: "Ingresos efectivo", valor: flujo.ingresos_efectivo },
    { bloque: "Flujo por método de pago", concepto: "Ingresos banco", valor: flujo.ingresos_banco },
    { bloque: "Flujo por método de pago", concepto: "Gastos efectivo", valor: flujo.gastos_efectivo },
    { bloque: "Flujo por método de pago", concepto: "Gastos banco", valor: flujo.gastos_banco },
    { bloque: "Flujo por método de pago", concepto: "Disponible efectivo", valor: flujo.disponible_efectivo },
    { bloque: "Flujo por método de pago", concepto: "Disponible banco", valor: flujo.disponible_banco },
    { bloque: "Flujo por método de pago", concepto: "Total disponible", valor: flujo.total_disponible },
  );

  for (const g of resumen.gastosPorCategoria) {
    filas.push({ bloque: "Gastos por categoría", concepto: g.nombre, valor: g.total });
  }

  for (const i of resumen.ingresosPorTipo) {
    filas.push({ bloque: "Ingresos por tipo", concepto: i.slug, valor: i.total });
  }

  for (const fila of resumen.ventasPorMes.filas) {
    for (const mes of resumen.ventasPorMes.meses) {
      filas.push({ bloque: "Ventas por mes", concepto: `${fila.slug} — ${mes}`, valor: fila.valores[mes] });
    }
  }

  return { nombreHoja: "Resumen", columnas, filas };
}

/** Ventas — `filas` (detalle de producto + ingresos sin detalle, Tasks 2-3)
 *  ya es una tabla plana por construcción, mapeo casi 1:1. Se omite la vista
 *  `porDia` (agregado derivable de estas mismas filas, ya graficado en el
 *  frontend) y se agregan 3 filas de totales al final usando las mismas
 *  columnas (`fecha`/`subtotal`), igual que una fila TOTAL al pie de una
 *  tabla de Excel tradicional. */
function mapearVentas(ventas: VentasReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Fecha", key: "fecha" },
    { header: "Producto", key: "producto" },
    { header: "Cantidad", key: "cantidad" },
    { header: "Precio unitario", key: "precio_unitario", numFmt: FORMATO_MONTO },
    { header: "Subtotal", key: "subtotal", numFmt: FORMATO_MONTO },
    { header: "Método de pago", key: "metodo_pago" },
    { header: "Área", key: "area" },
    { header: "Consecutivo", key: "consecutivo" },
  ];

  const filas: Record<string, unknown>[] = ventas.filas.map((f) => ({
    fecha: f.fecha,
    producto: f.producto,
    cantidad: f.cantidad,
    precio_unitario: f.precio_unitario,
    subtotal: f.subtotal,
    metodo_pago: f.metodo_pago,
    area: f.area,
    consecutivo: f.consecutivo,
  }));

  filas.push(
    { fecha: "TOTAL GENERAL", subtotal: ventas.totales.total_general },
    { fecha: "TOTAL EFECTIVO", subtotal: ventas.totales.total_efectivo },
    { fecha: "TOTAL BANCOS", subtotal: ventas.totales.total_bancos },
  );

  return { nombreHoja: "Ventas", columnas, filas };
}

/** Ventas por tipo — `porDia` ya es la tabla diaria Insumos/Con
 *  Sentido/Talleres/Total del Spec, mapeo 1:1. Se agregan la fila TOTAL del
 *  rango y una fila de % de participación (mismas columnas, valores en
 *  escala 0-100). Fix de revisión final (Finding 2) — esa fila no es dinero,
 *  así que no puede quedar bajo el `FORMATO_MONTO` de columna (regresión del
 *  fix de moneda real, commit a141535): se le pide `FORMATO_PORCENTAJE` por
 *  celda vía `CLAVE_NUMFMT_POR_CELDA` (ver `reportes.excel.ts`). */
function mapearVentasPorTipo(reporte: VentasPorTipoReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Fecha", key: "fecha" },
    { header: "Insumos", key: "insumos", numFmt: FORMATO_MONTO },
    { header: "Con Sentido", key: "con_sentido", numFmt: FORMATO_MONTO },
    { header: "Talleres", key: "talleres", numFmt: FORMATO_MONTO },
    { header: "Total", key: "total", numFmt: FORMATO_MONTO },
  ];

  const filas: Record<string, unknown>[] = reporte.porDia.map((d) => ({
    fecha: d.fecha,
    insumos: d.insumos,
    con_sentido: d.con_sentido,
    talleres: d.talleres,
    total: d.total,
  }));

  filas.push({
    fecha: "TOTAL",
    insumos: reporte.totales.insumos,
    con_sentido: reporte.totales.con_sentido,
    talleres: reporte.totales.talleres,
    total: reporte.totales.total,
  });
  filas.push({
    fecha: "% Participación",
    insumos: reporte.participacion.insumos,
    con_sentido: reporte.participacion.con_sentido,
    talleres: reporte.participacion.talleres,
    total: null,
    [CLAVE_NUMFMT_POR_CELDA]: {
      insumos: FORMATO_PORCENTAJE,
      con_sentido: FORMATO_PORCENTAJE,
      talleres: FORMATO_PORCENTAJE,
    },
  });

  return { nombreHoja: "Ventas por tipo", columnas, filas };
}

/** Gastos — `filas` (detalle de egresos, Task 4) es la tabla plana, mapeo
 *  casi 1:1 (mismo criterio que Ventas: 3 filas de totales al final). Se
 *  omiten `topProveedores`/`gastosPorCategoria` como bloques aparte en esta
 *  hoja — son agregados ya graficados en el frontend y derivables al
 *  pivotear este mismo detalle en Excel; `gastosPorCategoria` además ya
 *  aparece íntegro en el export de Resumen (Bloque C). */
function mapearGastos(gastos: GastosReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Fecha", key: "fecha" },
    { header: "Proveedor", key: "proveedor" },
    { header: "Categoría", key: "categoria" },
    { header: "Motivo", key: "motivo" },
    { header: "Monto", key: "monto", numFmt: FORMATO_MONTO },
    { header: "Método de pago", key: "metodo_pago" },
  ];

  const filas: Record<string, unknown>[] = gastos.filas.map((f) => ({
    fecha: f.fecha,
    proveedor: f.proveedor,
    categoria: f.categoria,
    motivo: f.motivo,
    monto: f.monto,
    metodo_pago: f.metodo_pago,
  }));

  filas.push(
    { fecha: "TOTAL GENERAL", monto: gastos.totales.total_general },
    { fecha: "TOTAL EFECTIVO", monto: gastos.totales.total_efectivo },
    { fecha: "TOTAL BANCOS", monto: gastos.totales.total_bancos },
  );

  return { nombreHoja: "Gastos", columnas, filas };
}

/** Cierre de caja — mapeo casi 1:1 de `CierreCajaFila` a columnas (mismos
 *  nombres que el Spec: `VENTA EFECTIVO`/`VENTA BANCO`/etc.), pero la forma
 *  completa (`saldo_inicial` + `dias[]` + `total`) sí necesita una decisión:
 *  se antepone una fila "SALDO INICIAL" (mismas columnas de saldo corrido,
 *  resto en blanco; "No disponible" si `saldo_inicial` es `null`, nunca 0 —
 *  mismo criterio del tipo) antes de los días, y se agrega `total` tal cual
 *  como última fila (el propio tipo documenta que esa es la forma esperada
 *  de consumirlo — "el consumidor decide si lo renderiza como última fila de
 *  la tabla"). */
function mapearCierreCaja(reporte: CierreCajaReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Fecha", key: "fecha" },
    { header: "Venta efectivo", key: "venta_efectivo", numFmt: FORMATO_MONTO },
    { header: "Venta banco", key: "venta_banco", numFmt: FORMATO_MONTO },
    { header: "Venta del día", key: "venta_dia", numFmt: FORMATO_MONTO },
    { header: "Gastos efectivo", key: "gastos_efectivo", numFmt: FORMATO_MONTO },
    { header: "Gastos banco", key: "gastos_banco", numFmt: FORMATO_MONTO },
    { header: "Efectivo", key: "efectivo", numFmt: FORMATO_MONTO },
    { header: "Banco", key: "banco", numFmt: FORMATO_MONTO },
    { header: "Total dinero", key: "total_dinero", numFmt: FORMATO_MONTO },
    { header: "Notas/Responsable", key: "notas_responsable" },
  ];

  // `efectivo`/`banco`/`total_dinero` llegan en `null` (fix de revisión
  // final I4) cuando `saldo_inicial` es `null` — se exportan como
  // "No disponible", mismo literal que ya usa `filaSaldoInicial` abajo para
  // ese mismo dato faltante, nunca como `0`.
  const filaACelda = (f: CierreCajaFila): Record<string, unknown> => ({
    fecha: f.fecha,
    venta_efectivo: f.venta_efectivo,
    venta_banco: f.venta_banco,
    venta_dia: f.venta_dia,
    gastos_efectivo: f.gastos_efectivo,
    gastos_banco: f.gastos_banco,
    efectivo: f.efectivo ?? "No disponible",
    banco: f.banco ?? "No disponible",
    total_dinero: f.total_dinero ?? "No disponible",
    notas_responsable: f.notas_responsable,
  });

  const saldoInicial = reporte.saldo_inicial;
  const filaSaldoInicial: Record<string, unknown> = {
    fecha: "SALDO INICIAL",
    venta_efectivo: null,
    venta_banco: null,
    venta_dia: null,
    gastos_efectivo: null,
    gastos_banco: null,
    efectivo: saldoInicial ? saldoInicial.efectivo : "No disponible",
    banco: saldoInicial ? saldoInicial.banco : "No disponible",
    total_dinero: saldoInicial ? saldoInicial.efectivo + saldoInicial.banco : "No disponible",
    notas_responsable: "—",
  };

  const filas: Record<string, unknown>[] = [filaSaldoInicial, ...reporte.dias.map(filaACelda), filaACelda(reporte.total)];

  return { nombreHoja: "Cierre de caja", columnas, filas };
}

/** Préstamos — el Spec (escrito antes de las Tasks 7-8) propone columnas
 *  "Fecha | Destinatario | Monto adeudado | Estado | Fecha de cobro", pero
 *  la forma real de `PrestamoFila` es más rica (dos tipos con dos
 *  obligaciones distintas, `monto` derivado de `fuente` no de `tipo` — ver
 *  reportes.types.ts). Se adapta: "Fecha" → `created_at` (cuándo se generó
 *  el vale, no cuándo se resolvió); "Destinatario" → `pagado_a` (a quién se
 *  le pagó, el dato humano-legible real) más una columna aparte para
 *  `destinatario_usuario_id` (id interno, sin resolver a nombre — este
 *  endpoint no repite ninguna query, así que no hace join contra usuarios);
 *  "Monto adeudado" → "Monto" (ya no es siempre una deuda: puede ser un pago
 *  con fuente); "Fecha de cobro" → "Fecha de resolución" (cubre tanto cobro
 *  de deuda como reposición de pago, los dos casos de `tipo`). Se agregan
 *  `numero`/`tipo`/`concepto`, ausentes del Spec original pero parte de la
 *  identidad real de cada vale. */
function mapearPrestamos(reporte: PrestamosReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Número", key: "numero" },
    { header: "Tipo", key: "tipo" },
    { header: "Fecha de creación", key: "created_at" },
    { header: "Pagado a", key: "pagado_a" },
    { header: "Usuario asociado (ID)", key: "destinatario_usuario_id" },
    { header: "Concepto", key: "concepto" },
    { header: "Monto", key: "monto", numFmt: FORMATO_MONTO },
    { header: "Estado", key: "estado" },
    { header: "Fecha de resolución", key: "fecha_resolucion" },
  ];

  const filas: Record<string, unknown>[] = reporte.filas.map((f) => ({
    numero: f.numero,
    tipo: f.tipo === "deuda" ? "Deuda" : "Pago",
    created_at: f.created_at,
    pagado_a: f.pagado_a,
    destinatario_usuario_id: f.destinatario_usuario_id,
    concepto: f.concepto,
    monto: f.monto,
    estado: f.estado,
    fecha_resolucion: f.fecha_resolucion,
  }));

  filas.push(
    { numero: "TOTAL PENDIENTE", monto: reporte.totales.total_pendiente },
    { numero: "TOTAL RESUELTO", monto: reporte.totales.total_resuelto },
  );

  return { nombreHoja: "Préstamos", columnas, filas };
}

/** Conciliación — `dias` ya es exactamente la tabla del Spec (total por
 *  método vs. total por tipo + diferencia), mapeo 1:1. `tiene_diferencia`
 *  se traduce a "Sí"/"No" para una hoja legible por un no-programador. */
function mapearConciliacion(reporte: ConciliacionReporte) {
  const columnas: ColumnaExcel[] = [
    { header: "Fecha", key: "fecha" },
    { header: "Total por método de pago", key: "total_por_metodo", numFmt: FORMATO_MONTO },
    { header: "Total por tipo", key: "total_por_tipo", numFmt: FORMATO_MONTO },
    { header: "Diferencia", key: "diferencia", numFmt: FORMATO_MONTO },
    { header: "¿Tiene diferencia?", key: "tiene_diferencia" },
  ];

  const filas: Record<string, unknown>[] = reporte.dias.map((d) => ({
    fecha: d.fecha,
    total_por_metodo: d.total_por_metodo,
    total_por_tipo: d.total_por_tipo,
    diferencia: d.diferencia,
    tiene_diferencia: d.tiene_diferencia ? "Sí" : "No",
  }));

  return { nombreHoja: "Conciliación", columnas, filas };
}

/**
 * `GET /reportes/:tipo/exportar` — un único endpoint parametrizado para los
 * 7 reportes (en vez de 7 rutas de export separadas), Paso 3 del brief.
 * Reusa el `service.obtener*` correspondiente (misma query que el endpoint
 * de datos), mapea a filas planas con el mapper de arriba y genera el
 * `.xlsx` con `generarExcel`. Responde binario directamente (`res.send`),
 * sin pasar por `ok()` (que serializa JSON).
 */
export async function exportarReporteController(req: Request, res: Response) {
  const { tipo } = reportesExportarTipoSchema.parse(req.params);

  let resultado: { nombreHoja: string; columnas: ColumnaExcel[]; filas: Record<string, unknown>[] };

  switch (tipo) {
    case "resumen": {
      const { desde, hasta } = reportesRangoSchema.parse(req.query);
      resultado = mapearResumen(await service.obtenerResumen(desde, hasta));
      break;
    }
    case "ventas": {
      const filtros = reportesVentasFiltrosSchema.parse(req.query);
      resultado = mapearVentas(await service.obtenerVentas(filtros));
      break;
    }
    case "ventas-por-tipo": {
      const { desde, hasta } = reportesRangoSchema.parse(req.query);
      resultado = mapearVentasPorTipo(await service.obtenerVentasPorTipo(desde, hasta));
      break;
    }
    case "gastos": {
      const filtros = reportesGastosFiltrosSchema.parse(req.query);
      resultado = mapearGastos(await service.obtenerGastos(filtros));
      break;
    }
    case "cierre-caja": {
      const { mes } = reportesCierreCajaSchema.parse(req.query);
      resultado = mapearCierreCaja(await service.obtenerCierreCaja(mes));
      break;
    }
    case "prestamos": {
      const { destinatarioUsuarioId } = reportesPrestamosFiltrosSchema.parse(req.query);
      resultado = mapearPrestamos(await service.obtenerPrestamos(destinatarioUsuarioId));
      break;
    }
    case "conciliacion": {
      const { desde, hasta } = reportesRangoSchema.parse(req.query);
      resultado = mapearConciliacion(await service.obtenerConciliacion(desde, hasta));
      break;
    }
    default: {
      // Exhaustividad en tiempo de compilación: si se agrega un valor al enum
      // de `reportesExportarTipoSchema` sin agregar su `case`, esto no compila.
      const _nunca: never = tipo;
      throw new Error(`Tipo de reporte no soportado: ${_nunca}`);
    }
  }

  const buffer = await generarExcel(resultado.nombreHoja, resultado.columnas, resultado.filas);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${tipo}.xlsx"`);
  res.send(buffer);
}
