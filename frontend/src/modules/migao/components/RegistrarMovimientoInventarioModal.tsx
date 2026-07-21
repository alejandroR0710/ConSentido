import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { migaoApi, type InventarioProducto } from "../api";

interface RegistrarMovimientoInventarioModalProps {
  producto: InventarioProducto;
  onCerrar: () => void;
  onRegistrado: () => Promise<void> | void;
}

/**
 * Alta de stock a mano (entrada) o corrección de un conteo (ajuste) — la
 * salida por venta nunca se toca acá, la descuenta sola el flujo de órdenes
 * (ver aplicarConsumoPorProducto en el backend).
 */
export function RegistrarMovimientoInventarioModal({
  producto,
  onCerrar,
  onRegistrado,
}: RegistrarMovimientoInventarioModalProps) {
  const [tipo, setTipo] = useState<"entrada" | "ajuste">("entrada");
  const [paquetes, setPaquetes] = useState(1);
  const [unidades, setUnidades] = useState(0);
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unidadesPorPaquete = Number(producto.unidades_por_paquete);
  const unidadesDeEntrada = paquetes * unidadesPorPaquete;
  const puedeRegistrar =
    tipo === "entrada" ? paquetes > 0 : unidades !== 0 && motivo.trim().length >= 3;

  async function registrar() {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await migaoApi.registrarMovimientoInventario(
        tipo === "entrada"
          ? { tipo: "entrada", productoId: producto.id, paquetes, motivo: motivo.trim() || undefined }
          : { tipo: "ajuste", productoId: producto.id, unidades, motivo: motivo.trim() },
      );
      await onRegistrado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Modal titulo={`Registrar movimiento — ${producto.nombre}`} onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        Stock actual: {producto.stock_unidades} {producto.unidad_medida}
      </p>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTipo("entrada")}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
            tipo === "entrada"
              ? "border-brand-green-700 bg-brand-green-700 text-brand-vanilla"
              : "border-brand-vanilla-dark text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          }`}
        >
          Entrada (llegó mercancía)
        </button>
        <button
          type="button"
          onClick={() => setTipo("ajuste")}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
            tipo === "ajuste"
              ? "border-amber-600 bg-amber-500 text-white"
              : "border-brand-vanilla-dark text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          }`}
        >
          Ajuste (corregir conteo)
        </button>
      </div>

      {tipo === "entrada" ? (
        <>
          <label className="mb-1 block text-xs font-medium">Paquetes recibidos</label>
          <NumeroInput
            value={paquetes}
            onChange={setPaquetes}
            className="mb-1 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            = {unidadesDeEntrada} {producto.unidad_medida} ({unidadesPorPaquete} por paquete)
          </p>
        </>
      ) : (
        <>
          <label className="mb-1 block text-xs font-medium">
            Unidades a corregir (positivo suma, negativo resta)
          </label>
          <NumeroInput
            value={unidades}
            onChange={setUnidades}
            permitirNegativo
            placeholder="Ej. -2"
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </>
      )}

      <label className="mb-1 block text-xs font-medium">
        Motivo{tipo === "entrada" ? " (opcional)" : ""}
      </label>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder={tipo === "entrada" ? 'Ej. "Compra semanal"' : 'Ej. "Se dañó una porción"'}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={registrando || !puedeRegistrar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : "Registrar movimiento"}
      </button>
    </Modal>
  );
}
