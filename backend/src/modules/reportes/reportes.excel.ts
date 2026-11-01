import ExcelJS from "exceljs";

/** Formato numérico estándar para montos en COP dentro de este módulo: sin
 *  decimales (la moneda del sistema no usa centavos en ningún otro reporte/
 *  factura) y con separador de miles. */
export const FORMATO_MONTO = "#,##0";

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
    numFmt: columna.numFmt,
  }));
  hoja.getRow(1).font = { bold: true };

  hoja.addRows(filas);

  // `workbook.xlsx.writeBuffer()` devuelve un Node `Buffer` real en runtime,
  // pero el .d.ts de exceljs declara su propio tipo local `Buffer` (un alias
  // de `ArrayBuffer` dentro de ese módulo, sin relación nominal con el
  // `Buffer` global de @types/node) — de ahí el cast: sin él, TS2740 rechaza
  // el valor como si le faltaran los métodos de `Buffer` que en realidad sí
  // tiene.
  const datos = await workbook.xlsx.writeBuffer();
  return Buffer.from(datos as unknown as Uint8Array);
}
