import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { migaoApi } from "../api";

interface NuevoInventarioProductoModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

const campoClase =
  "w-full rounded-lg border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/20 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const etiquetaClase = "mb-1 block text-xs font-medium text-brand-ink/80 dark:text-brand-vanilla/80";
const seccionClase =
  "mb-3 rounded-xl border border-brand-green-100 bg-brand-green-50/60 p-3 dark:border-brand-green-700/50 dark:bg-brand-green-700/10";
const seccionOpcionalClase =
  "mb-4 rounded-xl border border-dashed border-brand-vanilla-dark bg-transparent p-3 dark:border-brand-green-700";
const tituloSeccionClase =
  "mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla/70";

/**
 * Alta de un producto de inventario "tal como lo entrega el proveedor" — ej.
 * una torta de chocolate (12 porciones), una paca de leche (6 unidades), o
 * una bolsita de amasijos suelta (unidades_por_paquete = 1). El stock arranca
 * en 0; se carga después con "Registrar movimiento" (entrada).
 */
export function NuevoInventarioProductoModal({ onCerrar, onCreado }: NuevoInventarioProductoModalProps) {
  const [nombre, setNombre] = useState("");
  const [unidadMedida, setUnidadMedida] = useState("");
  const [unidadesPorPaquete, setUnidadesPorPaquete] = useState(0);
  const [tamanoUnidad, setTamanoUnidad] = useState("");
  const [costoPaquete, setCostoPaquete] = useState(0);
  const [stockMinimoUnidades, setStockMinimoUnidades] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeGuardar = nombre.trim().length >= 2 && unidadMedida.trim().length > 0 && unidadesPorPaquete > 0;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.crearInventarioProducto({
        nombre: nombre.trim(),
        unidadMedida: unidadMedida.trim(),
        unidadesPorPaquete,
        tamanoUnidad: tamanoUnidad.trim() || undefined,
        costoPaquete: costoPaquete > 0 ? costoPaquete : undefined,
        stockMinimoUnidades: stockMinimoUnidades > 0 ? stockMinimoUnidades : undefined,
      });
      await onCreado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el producto");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo producto de inventario" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>📋</span> Información básica
        </p>
        <label className={etiquetaClase}>Nombre</label>
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder='Ej. "Torta de chocolate"'
          className={campoClase}
        />
      </div>

      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>📦</span> Unidades y empaque
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={etiquetaClase}>Unidad de medida</label>
            <input
              value={unidadMedida}
              onChange={(e) => setUnidadMedida(e.target.value)}
              placeholder='"porción", "bolsita"...'
              className={campoClase}
            />
          </div>
          <div>
            <label className={etiquetaClase}>Unidades por paquete</label>
            <NumeroInput value={unidadesPorPaquete} onChange={setUnidadesPorPaquete} placeholder="Ej. 12" className={campoClase} />
          </div>
        </div>

        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-green-100 px-3 py-1 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          <span aria-hidden>🧮</span>
          1 paquete = {unidadesPorPaquete > 0 ? unidadesPorPaquete : "?"} {unidadMedida.trim() || "unidad(es)"}
        </div>
        <p className="mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
          💡 Ej. una torta de chocolate = 12 porciones; una paca de leche = 6 unidades; una bolsita suelta = 1.
        </p>

        <label className={`${etiquetaClase} mt-3`}>Tamaño/descripción de la unidad (opcional)</label>
        <input
          value={tamanoUnidad}
          onChange={(e) => setTamanoUnidad(e.target.value)}
          placeholder='Ej. "140g"'
          className={campoClase}
        />
      </div>

      <div className={seccionOpcionalClase}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-ink/50 dark:text-brand-vanilla/50">
          ⚙️ Opcional
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={etiquetaClase}>Costo por paquete</label>
            <MoneyInput value={costoPaquete} onChange={setCostoPaquete} className={campoClase} />
          </div>
          <div>
            <label className={etiquetaClase}>Stock mínimo (unidades)</label>
            <NumeroInput value={stockMinimoUnidades} onChange={setStockMinimoUnidades} placeholder="0" className={campoClase} />
          </div>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-lg bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla transition hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Creando..." : "Crear producto"}
      </button>
    </Modal>
  );
}
