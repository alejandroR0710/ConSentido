import ExcelJS from "exceljs";

/** Formato numérico estándar para montos en COP dentro de este módulo: sin
 *  decimales (la moneda del sistema no usa centavos en ningún otro reporte/
 *  factura), con separador de miles y el símbolo `$` literal en la celda —
 *  mismo estilo visual que `formatMoney` en el frontend (`$1.264.900`), no
 *  solo el número plano. */
export const FORMATO_MONTO = '"$"#,##0';

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
      copia[clave] = typeof valor === "number" ? Math.round(valor * 100) / 100 : valor;
    }
    return copia;
  });

  hoja.addRows(filasRedondeadas);

  // `workbook.xlsx.writeBuffer()` devuelve un Node `Buffer` real en runtime,
  // pero el .d.ts de exceljs declara su propio tipo local `Buffer` (un alias
  // de `ArrayBuffer` dentro de ese módulo, sin relación nominal con el
  // `Buffer` global de @types/node) — de ahí el cast: sin él, TS2740 rechaza
  // el valor como si le faltaran los métodos de `Buffer` que en realidad sí
  // tiene.
  const datos = await workbook.xlsx.writeBuffer();
  return Buffer.from(datos as unknown as Uint8Array);
}
