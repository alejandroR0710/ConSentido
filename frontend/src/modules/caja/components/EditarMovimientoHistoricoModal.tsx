import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import {
  cajaApi,
  type CategoriaGasto,
  type MetodoPago,
  type ModuloOrigenSlug,
  type MovimientoCaja,
  type Proveedor,
} from "../api";
import { LABEL_POR_MODULO_SLUG, MODULOS_ORIGEN } from "../moduloOrigen";

const FRASE_CONFIRMACION = "AJUSTAR HISTORIAL";

interface EditarMovimientoHistoricoModalProps {
  movimiento: MovimientoCaja;
  categorias: CategoriaGasto[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

/**
 * Corrige monto/método/motivo/módulo-o-categoría de un movimiento de un
 * turno YA cerrado (ej. el egreso "amasijos" que en realidad fue por
 * transferencia, no efectivo). Exige nota + frase de confirmación, igual que
 * el resto de acciones sensibles de Caja — reabre contabilidad ya contada.
 */
export function EditarMovimientoHistoricoModal({
  movimiento,
  categorias,
  onCerrar,
  onGuardado,
}: EditarMovimientoHistoricoModalProps) {
  const [monto, setMonto] = useState(Number(movimiento.monto));
  const [metodoPago, setMetodoPago] = useState<MetodoPago>(movimiento.metodo_pago);
  const [motivo, setMotivo] = useState(movimiento.motivo ?? "");
  const [categoriaId, setCategoriaId] = useState<number | "">(movimiento.categoria_gasto_id ?? "");
  const [proveedorId, setProveedorId] = useState<string>(movimiento.proveedor_id ?? "");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [moduloOrigenSlug, setModuloOrigenSlug] = useState(movimiento.modulo_origen_slug ?? MODULOS_ORIGEN[0].value);
  const [nota, setNota] = useState("");
  const [frase, setFrase] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cajaApi
      .listarProveedores()
      .then(setProveedores)
      .catch(() => {
        /* sin proveedores disponibles, el campo es opcional */
      });
  }, []);

  const puedeGuardar = monto > 0 && nota.trim().length >= 3 && frase === FRASE_CONFIRMACION;
  const etiquetaOrigen =
    movimiento.tipo === "ingreso"
      ? (movimiento.modulo_origen_slug ? LABEL_POR_MODULO_SLUG[movimiento.modulo_origen_slug] : "Otro")
      : (movimiento.categoria_gasto_nombre ?? "Otro");

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await cajaApi.editarMovimientoHistorico(movimiento.id, {
        monto,
        metodoPago,
        motivo: motivo.trim() || undefined,
        moduloOrigenSlug: movimiento.tipo === "ingreso" ? (moduloOrigenSlug as ModuloOrigenSlug) : undefined,
        categoriaGastoId: movimiento.tipo === "egreso" && categoriaId ? Number(categoriaId) : undefined,
        proveedorId: movimiento.tipo === "egreso" ? proveedorId || undefined : undefined,
        nota: nota.trim(),
        confirmacion: FRASE_CONFIRMACION,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo editar el movimiento");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Editar ${movimiento.tipo}`} onCerrar={onCerrar}>
      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
        Este movimiento pertenece a un día ya cerrado. Editarlo recalcula el cierre de ese turno.
      </p>

      <p className="mb-3 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        Valor original: {etiquetaOrigen} · {formatMoney(movimiento.monto)} · {movimiento.metodo_pago}
      </p>

      {movimiento.tipo === "ingreso" ? (
        <>
          <label className="mb-1 block text-xs font-medium">Viene de</label>
          <select
            value={moduloOrigenSlug}
            onChange={(e) => setModuloOrigenSlug(e.target.value)}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            {MODULOS_ORIGEN.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label className="mb-1 block text-xs font-medium">Categoría de gasto</label>
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(Number(e.target.value))}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>

          {proveedores.length > 0 && (
            <>
              <label className="mb-1 block text-xs font-medium">Proveedor (opcional)</label>
              <select
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              >
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}

      <label className="mb-1 block text-xs font-medium">Monto</label>
      <MoneyInput
        value={monto}
        onChange={setMonto}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Método</label>
      <div className="mb-3 flex gap-2">
        {(["efectivo", "banco"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetodoPago(m)}
            className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
              metodoPago === m
                ? "border-brand-green-700 bg-brand-green-100 dark:bg-brand-green-700/40"
                : "border-brand-vanilla-dark dark:border-brand-green-700"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-medium">Motivo</label>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Nota — ¿por qué se corrige?</label>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={2}
        placeholder='Ej. "Este pago fue por transferencia, no efectivo"'
        className="mb-3 w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">
        Escribe <span className="font-mono">{FRASE_CONFIRMACION}</span> para confirmar
      </label>
      <input
        value={frase}
        onChange={(e) => setFrase(e.target.value)}
        placeholder={FRASE_CONFIRMACION}
        className="mb-4 w-full rounded-md border border-amber-400 bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-amber-600 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar corrección"}
      </button>
    </Modal>
  );
}
