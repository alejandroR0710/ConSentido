import ExcelJS from "exceljs";

/** Formato numérico estándar para montos en COP dentro de este módulo: sin
 *  decimales (la moneda del sistema no usa centavos en ningún otro reporte/
 *  factura), con separador de miles y el símbolo `$` literal en la celda —
 *  mismo estilo visual que `formatMoney` en el frontend (`$1.264.900`), no
 *  solo el número plano. */
export const FORMATO_MONTO = '"$"#,##0';

/** Formato numérico para porcentajes en escala 0-100 (ej. `33.33` →
 *  `"33.33%"`) — NO moneda. Ver `CLAVE_NUMFMT_POR_CELDA`: una fila como "%
 *  Participación" de Ventas por tipo comparte columnas con `FORMATO_MONTO`
 *  pero sus valores no son dinero (fix de revisión final, Finding 2: ese
 *  renglón se exportaba con el `$` de la columna por quedar bajo el mismo
 *  `numFmt` de columna que las filas de monto reales). */
export const FORMATO_PORCENTAJE = '0.00"%"';

/** Clave reservada que una fila puede llevar para pedir, SOLO para sus
 *  propias celdas, un `numFmt` distinto al de la columna (ej. la fila "%
 *  Participación" de Ventas por tipo, que no es dinero aunque comparta
 *  columnas con `FORMATO_MONTO`) — ver Finding 2 de la revisión final. Valor
 *  esperado: `Record<key de columna, numFmt>`. No es una columna real: se
 *  retira de la fila antes de escribirla y se consume aparte, después de
 *  `addRows`, para sobreescribir la celda puntual. */
export const CLAVE_NUMFMT_POR_CELDA = "__numFmtPorCelda";

export interface ColumnaExcel {
  header: string;
  key: string;
  /** Formato numérico de ExcelJS para esta columna (ej. `FORMATO_MONTO` para
   *  montos en COP). Omitido para columnas de texto/fecha. */
  numFmt?: string;
  width?: number;
}

/**
 * Genera el buffer `.xlsx` de una sola hoja a partir de columnas + filas ya
 * planas — el mapeo de cada uno de los 7 reportes a este formato vive en
 * `reportes.controller.ts` (cada reporte tiene su propia forma de datos,
 * `generarExcel` no sabe nada de reportes, solo de hojas de cálculo).
 */
export async function generarExcel(
  nombreHoja: string,
  columnas: ColumnaExcel[],
  filas: Record<string, unknown>[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet(nombreHoja);

  hoja.columns = columnas.map((columna) => ({
    header: columna.header,
    key: columna.key,
    width: columna.width ?? Math.max(columna.header.length + 2, 12),
  }));
  hoja.getRow(1).font = { bold: true };

  // Fix de revisión final (Finding I3) — `Column.defn`, el setter que usa la
  // asignación `hoja.columns = [...]` de arriba, solo lee
  // `key`/`width`/`outlineLevel`/`style`/`header`/`hidden`: un `numFmt`
  // dentro de ese mismo objeto de definición se descarta en silencio
  // (confirmado por el revisor con un script de prueba directo contra
  // ExcelJS) — de ahí que todo monto se exportara como número crudo sin
  // formato. Se aplica en un paso separado, DESPUÉS de la asignación, sobre
  // la columna ya creada (`hoja.getColumn(key).numFmt = ...`), que sí
  // respeta el formato.
  for (const columna of columnas) {
    if (columna.numFmt) {
      hoja.getColumn(columna.key).numFmt = columna.numFmt;
    }
  }

  // Redondeo a 2 decimales (Finding I3) — los valores prorrateados de
  // Ventas (Findings I1/I2: repartos `efectivo_share`/`banco_share`, escalado
  // por descuento) y el saldo corrido de Cierre de caja pueden dejar un
  // residuo de punto flotante del tipo `3333.3333333333335` al llegar hasta
  // acá; se redondea CUALQUIER valor numérico de cualquier reporte (no solo
  // los de estos dos findings) antes de escribirlo en la celda — inocuo para
  // los montos ya enteros del resto de los reportes, que no cambian.
  const filasRedondeadas = filas.map((fila) => {
    const copia: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(fila)) {
      if (clave === CLAVE_NUMFMT_POR_CELDA) continue;
      copia[clave] = typeof valor === "number" ? Math.round(valor * 100) / 100 : valor;
    }
    return copia;
  });

  hoja.addRows(filasRedondeadas);

  // Overrides de numFmt por celda (Finding 2, revisión final) — se aplican
  // DESPUÉS de `addRows`, sobre la celda puntual de esa fila, para no
  // arrastrar el numFmt de la columna (ej. `FORMATO_MONTO`) a una fila que
  // ahí comparte columna pero no es dinero (ej. "% Participación" en Ventas
  // por tipo).
  filas.forEach((fila, indice) => {
    const overrides = fila[CLAVE_NUMFMT_POR_CELDA] as Record<string, string> | undefined;
    if (!overrides) return;
    const filaExcel = hoja.getRow(indice + 2); // +1 por índice 1-based, +1 por la fila de encabezado
    for (const [key, numFmt] of Object.entries(overrides)) {
      filaExcel.getCell(key).numFmt = numFmt;
    }
  });

  // `workbook.xlsx.writeBuffer()` devuelve un Node `Buffer` real en runtime,
  // pero el .d.ts de exceljs declara su propio tipo local `Buffer` (un alias
  // de `ArrayBuffer` dentro de ese módulo, sin relación nominal con el
  // `Buffer` global de @types/node) — de ahí el cast: sin él, TS2740 rechaza
  // el valor como si le faltaran los métodos de `Buffer` que en realidad sí
  // tiene.
  const datos = await workbook.xlsx.writeBuffer();
  return Buffer.from(datos as unknown as Uint8Array);
}
