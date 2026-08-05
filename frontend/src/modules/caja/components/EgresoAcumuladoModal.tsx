import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { cajaApi, type CategoriaGasto, type Proveedor } from "../api";

interface EgresoAcumuladoModalProps {
  categorias: CategoriaGasto[];
  onCerrar: () => void;
  onRegistrado: () => Promise<void>;
}

/** Egreso contra el ACUMULADO TOTAL histórico — no un turno ni un día. Sin
 *  "mixto": es una reducción puntual de un solo método por vez. */
export function EgresoAcumuladoModal({ categorias, onCerrar, onRegistrado }: EgresoAcumuladoModalProps) {
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [monto, setMonto] = useState(0);
  const [metodoPago, setMetodoPago] = useState<"efectivo" | "banco">("efectivo");
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cajaApi
      .listarProveedores()
      .then(setProveedores)
      .catch(() => {
        /* sin proveedores disponibles, el campo es opcional */
      });
  }, []);

  const puedeRegistrar = Boolean(categoriaId) && motivo.trim().length > 0 && monto > 0;

  async function registrar() {
    if (!categoriaId || !puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await cajaApi.registrarEgresoAcumulado({
        categoriaGastoId: Number(categoriaId),
        motivo: motivo.trim(),
        proveedorId: proveedorId || undefined,
        metodoPago,
        monto,
      });
      await onRegistrado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el egreso");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Modal titulo="Egreso del acumulado total" onCerrar={onCerrar}>
      <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
        Descuenta directo del acumulado histórico — no depende de que haya un turno abierto ni afecta el cuadre del
        turno actual.
      </p>

      <label className="mb-1 block text-xs font-medium">Categoría de gasto</label>
      <select
        autoFocus
        value={categoriaId}
        onChange={(e) => setCategoriaId(Number(e.target.value))}
        className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
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
            className={`flex-1 rounded-md border-2 px-3 py-2 text-sm font-medium capitalize ${
              metodoPago === m
                ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-medium">Motivo</label>
      <input
        required
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={registrando || !puedeRegistrar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : "Registrar egreso"}
      </button>
    </Modal>
  );
}
