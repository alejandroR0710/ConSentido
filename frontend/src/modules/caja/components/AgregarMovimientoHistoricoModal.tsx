import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { cajaApi, type CategoriaGasto, type MetodoPago, type Proveedor } from "../api";
import { MODULOS_ORIGEN } from "../moduloOrigen";

const FRASE_CONFIRMACION = "AJUSTAR HISTORIAL";

interface AgregarMovimientoHistoricoModalProps {
  fecha: string;
  categorias: CategoriaGasto[];
  onCerrar: () => void;
  onAgregado: () => Promise<void> | void;
}

/**
 * Alta retroactiva de un ingreso/egreso en un día ya cerrado — para cuando se
 * olvidó registrar algo ese día. Reabre contabilidad ya contada físicamente,
 * así que exige una nota (por qué) y la frase de confirmación escrita, igual
 * que el resto de acciones sensibles de Caja.
 */
export function AgregarMovimientoHistoricoModal({
  fecha,
  categorias,
  onCerrar,
  onAgregado,
}: AgregarMovimientoHistoricoModalProps) {
  const [tipo, setTipo] = useState<"ingreso" | "egreso">("egreso");
  const [moduloOrigenSlug, setModuloOrigenSlug] = useState(MODULOS_ORIGEN[0].value);
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [monto, setMonto] = useState(0);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");
  const [motivo, setMotivo] = useState("");
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

  const puedeGuardar =
    monto > 0 &&
    nota.trim().length >= 3 &&
    frase === FRASE_CONFIRMACION &&
    (tipo === "ingreso" || (Boolean(categoriaId) && motivo.trim().length > 0));

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await cajaApi.agregarMovimientoHistorico(
        fecha,
        tipo === "ingreso"
          ? {
              tipo: "ingreso",
              moduloOrigenSlug,
              monto,
              metodoPago,
              motivo: motivo.trim() || undefined,
              nota: nota.trim(),
              confirmacion: FRASE_CONFIRMACION,
            }
          : {
              tipo: "egreso",
              categoriaGastoId: Number(categoriaId),
              proveedorId: proveedorId || undefined,
              monto,
              metodoPago,
              motivo: motivo.trim(),
              nota: nota.trim(),
              confirmacion: FRASE_CONFIRMACION,
            },
      );
      await onAgregado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo agregar el movimiento");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Agregar movimiento al ${fecha}`} onCerrar={onCerrar}>
      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
        Este día ya está cerrado. Agregar un movimiento aquí recalcula el cierre del turno de ese día.
      </p>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTipo("ingreso")}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
            tipo === "ingreso"
              ? "border-brand-green-700 bg-brand-green-700 text-brand-vanilla"
              : "border-brand-vanilla-dark text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          }`}
        >
          Ingreso
        </button>
        <button
          type="button"
          onClick={() => setTipo("egreso")}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
            tipo === "egreso"
              ? "border-red-600 bg-red-600 text-white"
              : "border-brand-vanilla-dark text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          }`}
        >
          Egreso
        </button>
      </div>

      {tipo === "ingreso" ? (
        <>
          <label className="mb-1 block text-xs font-medium">Viene de</label>
          <select
            value={moduloOrigenSlug}
            onChange={(e) => setModuloOrigenSlug(e.target.value as typeof moduloOrigenSlug)}
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
            <option value="" disabled>
              Selecciona una categoría
            </option>
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

      <label className="mb-1 block text-xs font-medium">
        Motivo{tipo === "ingreso" ? " (opcional)" : ""}
      </label>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Nota — ¿por qué se agrega ahora?</label>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={2}
        placeholder='Ej. "Se olvidó registrar esta compra el día que se hizo"'
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
        {guardando ? "Guardando..." : "Agregar movimiento"}
      </button>
    </Modal>
  );
}
