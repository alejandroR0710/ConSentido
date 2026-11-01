import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { reportesApi, type PrestamoFila, type PrestamosReporte } from "../api";

/**
 * `created_at`/`fecha_resolucion` son `DATETIME(6)` con hora+zona (ver
 * `vales` en `database/mysql/migraciones/2026-10-05_modulo_vales.sql` /
 * `2026-10-08_vales_deudas.sql`), serializados como ISO completo con `Z`
 * (ej. `"2026-11-01T16:35:28.000Z"`, ver Task 7 report) — a diferencia de los
 * `YYYY-MM-DD` *sin* hora del resto del módulo (`VentasTab.tsx`/
 * `GastosTab.tsx`/`CierreCajaTab.tsx::formatFechaCorta`), que SÍ necesitan el
 * truco de parsear año/mes/día a mano para evitar que `new Date(fecha)`
 * interprete el string como medianoche UTC y muestre el día anterior en
 * zonas horarias al oeste de UTC. Acá ese riesgo no existe (el string ya
 * trae hora+`Z` explícitos), así que `new Date(fechaIso)` directo es seguro.
 */
function formatFecha(fechaIso: string): string {
  return new Date(fechaIso).toLocaleDateString("es-CO");
}

/** Etiqueta de display de `tipo` — SOLO capitalización, no un mapeo que
 *  pueda divergir de nada (a diferencia de `estado`, que el backend ya manda
 *  resuelto y este componente nunca reinterpreta — ver doc de `FilaPrestamo`
 *  abajo). */
function etiquetaTipo(tipo: PrestamoFila["tipo"]): string {
  return tipo === "deuda" ? "Deuda" : "Pago";
}

interface DestinatarioOption {
  id: string;
  nombre: string;
}

/**
 * Dedup de destinatarios distintos a partir de un array de `filas` SIN
 * filtrar, por `destinatario_usuario_id` (la clave real que acepta
 * `reportesApi.obtenerPrestamos`) — usa el `pagado_a` de la primera fila que
 * aparece con ese id como etiqueta visible. Mismo criterio de "match exacto
 * por id, no por texto libre" que `GastosTab.tsx::topProveedores` (acá no
 * hay un endpoint de catálogo separado que listar, así que se deriva de la
 * misma respuesta).
 *
 * Filas con `destinatario_usuario_id === null` (un vale sin ese enganche
 * opcional, ver doc de `vales` en la migración) no generan una opción propia
 * — no hay id con el que filtrar — pero sí siguen incluidas en "Todos" y en
 * la tabla sin filtro (ver footnote del componente principal).
 */
function destinatariosDistintos(filas: PrestamoFila[]): DestinatarioOption[] {
  const porId = new Map<string, string>();
  for (const f of filas) {
    if (f.destinatario_usuario_id && !porId.has(f.destinatario_usuario_id)) {
      porId.set(f.destinatario_usuario_id, f.pagado_a);
    }
  }
  // Alfabético para el `<select>` — mismo criterio que
  // `GastosTab.tsx::categoriasSelect`.
  return [...porId.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Una fila de la tabla — columnas del brief (Fecha/Destinatario/Tipo/Monto/
 * Estado/Fecha de resolución), tal cual llegan en `PrestamoFila`. `monto` y
 * `estado` se imprimen DIRECTO, sin recalcular nada acá: el backend ya
 * resuelve `monto` según `fuente` (no `tipo` — fix de review del Task 7,
 * ver doc de `PrestamoFila`/`obtenerPrestamos` en
 * `reportes.types.ts`/`reportes.service.ts`) y ya manda la etiqueta de
 * `estado` correcta para cada `tipo` ("Cobrado"/"Pendiente de cobro" para
 * `deuda`, "Repuesto"/"Pendiente de reposición" para `pago`) — reinventar un
 * mapeo propio acá correría el riesgo de divergir del backend.
 */
function FilaPrestamo({ fila }: { fila: PrestamoFila }) {
  return (
    <tr className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
      <td className="whitespace-nowrap px-3 py-2">{formatFecha(fila.created_at)}</td>
      <td className="whitespace-nowrap px-3 py-2">{fila.pagado_a}</td>
      <td className="whitespace-nowrap px-3 py-2">{etiquetaTipo(fila.tipo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(fila.monto)}</td>
      <td className="whitespace-nowrap px-3 py-2">{fila.estado}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {fila.fecha_resolucion ? formatFecha(fila.fecha_resolucion) : "—"}
      </td>
    </tr>
  );
}

function TablaPrestamos({ filas }: { filas: PrestamoFila[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          <tr>
            <th className="whitespace-nowrap px-3 py-2">Fecha</th>
            <th className="whitespace-nowrap px-3 py-2">Destinatario</th>
            <th className="whitespace-nowrap px-3 py-2">Tipo</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Monto</th>
            <th className="whitespace-nowrap px-3 py-2">Estado</th>
            <th className="whitespace-nowrap px-3 py-2">Fecha de resolución</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                No hay préstamos para mostrar con el filtro actual.
              </td>
            </tr>
          ) : (
            filas.map((f) => <FilaPrestamo key={f.id} fila={f} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Totales al pie — `total_pendiente`/`total_resuelto` tal cual los manda
 *  `PrestamosReporte.totales` (suma de `monto` de las filas sin/con
 *  `fecha_resolucion`, ya resuelta del lado del backend — ver doc en
 *  `reportes.types.ts`), mismo patrón visual que `GastosTab.tsx::TotalesFooter`. */
function TotalesFooter({ totales }: { totales: PrestamosReporte["totales"] }) {
  const filas: { etiqueta: string; valor: number }[] = [
    { etiqueta: "Total pendiente", valor: totales.total_pendiente },
    { etiqueta: "Total resuelto", valor: totales.total_resuelto },
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-green-700 dark:border-brand-vanilla">
      <table className="w-full text-left text-sm">
        <tbody>
          {filas.map((f, i) => (
            <tr
              key={f.etiqueta}
              className={`${i > 0 ? "border-t border-brand-vanilla-dark dark:border-brand-green-700" : ""} bg-brand-green-50 font-semibold dark:bg-brand-green-700/30`}
            >
              <td className="px-3 py-2 text-brand-green-700 dark:text-brand-vanilla">{f.etiqueta}</td>
              <td className="px-3 py-2 text-right text-brand-green-700 dark:text-brand-vanilla">
                {formatMoney(f.valor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pestaña "Préstamos" del módulo Reportes — endpoint
 * `reportesApi.obtenerPrestamos` (Task 7 backend/Task 10 frontend), basado
 * en `vales`, no en `movimientos_caja`.
 *
 * ÚNICA pestaña del módulo además de "Cierre de caja" que NO usa el
 * `PeriodoSelector` compartido de `ReportesPage` (ver
 * `PESTANAS_SIN_PERIODO_COMPARTIDO` ahí): `obtenerPrestamos` no acepta
 * `desde`/`hasta`, solo un `destinatarioUsuarioId` opcional (Spec/Task 7) —
 * un selector de período no tendría ningún efecto acá.
 *
 * Selector de destinatario: el brief pedía "selector de destinatario, tabla
 * con saldo corrido", pero no existe un saldo corrido real en este sistema
 * (descartado explícitamente en el Task 7 backend — `vales` no es una cuenta
 * corriente) — se implementa solo el selector, un `<select>` simple con
 * "Todos" + las opciones de `destinatariosDistintos` arriba, sin ninguna
 * columna de saldo acumulado.
 *
 * Dos fetches independientes, mismo criterio que
 * `GastosTab.tsx`/`CierreCajaTab.tsx` (guard `cancelado` contra respuestas
 * obsoletas en ambos):
 * 1. Uno SIN filtro, que corre una sola vez al montar — solo para poblar el
 *    `<select>` con el universo completo de destinatarios (si se derivara del
 *    fetch ya filtrado de abajo, el `<select>` se vaciaría a una sola opción
 *    en cuanto se elige un destinatario, perdiendo el resto de las
 *    opciones). Si este fetch falla, se ignora en silencio: el `<select>`
 *    simplemente queda con solo "Todos" — no bloquea la tabla principal, que
 *    tiene su propio manejo de error independiente.
 * 2. Uno filtrado por `destinatarioUsuarioId` (el que de verdad alimenta la
 *    tabla/totales visibles), re-ejecutado cada vez que cambia el filtro.
 */
export function PrestamosTab() {
  const [destinatarioUsuarioId, setDestinatarioUsuarioId] = useState("");
  const [destinatarios, setDestinatarios] = useState<DestinatarioOption[]>([]);
  const [datos, setDatos] = useState<PrestamosReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch 1: universo completo de destinatarios para el <select> (ver doc arriba).
  useEffect(() => {
    let cancelado = false;
    reportesApi
      .obtenerPrestamos()
      .then((res) => {
        if (!cancelado) setDestinatarios(destinatariosDistintos(res.filas));
      })
      .catch(() => {
        // Silencioso a propósito — ver doc del componente arriba.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Fetch 2: tabla/totales reales, filtrados por el destinatario elegido.
  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerPrestamos(destinatarioUsuarioId || undefined)
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar los préstamos");
      });
    return () => {
      cancelado = true;
    };
  }, [destinatarioUsuarioId]);

  return (
    <div className="flex flex-col gap-6">
      {/* Paso 1: selector de destinatario propio (ver doc arriba) */}
      <label className="flex w-fit flex-col gap-1 text-sm">
        <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
          Destinatario
        </span>
        <select
          value={destinatarioUsuarioId}
          onChange={(e) => setDestinatarioUsuarioId(e.target.value)}
          className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
        >
          <option value="">Todos</option>
          {destinatarios.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !datos && <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>}

      {datos && (
        <>
          {/* Paso 2: tabla */}
          <TablaPrestamos filas={datos.filas} />
          <TotalesFooter totales={datos.totales} />
        </>
      )}

      {/* Footnote de la limitación del selector (ver doc de
       *  `destinatariosDistintos` arriba) — mismo criterio textual que el de
       *  "Proveedor" en `GastosTab.tsx`. */}
      <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
        * El selector de destinatario solo incluye vales con un usuario asociado (`destinatario_usuario_id`); un vale
        pagado a alguien sin ese enganche no es seleccionable individualmente ahí, aunque sí aparece en la tabla y en
        los totales cuando no se aplica ningún filtro.
      </p>
    </div>
  );
}
