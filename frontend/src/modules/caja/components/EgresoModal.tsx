import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { cajaApi, type CategoriaGasto, type ModuloOrigenSlug, type Proveedor } from "../api";
import { MODULOS_ORIGEN } from "../moduloOrigen";

// Solo para el selector de "Área" de ESTE modal (Registrar egreso) — Con
// Sentido ya abarca insumos/talleres/pedidos a efectos de reportar un gasto
// (todo lo que no es Migao), así que ofrecerlos sueltos acá sería
// redundante. El resto de pantallas sigue usando MODULOS_ORIGEN completo.
const AREAS_EGRESO = MODULOS_ORIGEN.filter((m) => m.value === "con_sentido" || m.value === "migao" || m.value === "general");

interface EgresoModalProps {
  categorias: CategoriaGasto[];
  onCerrar: () => void;
  onRegistrado: () => Promise<void>;
}

export function EgresoModal({ categorias, onCerrar, onRegistrado }: EgresoModalProps) {
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [moduloOrigenSlug, setModuloOrigenSlug] = useState<ModuloOrigenSlug | "">("");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [monto, setMonto] = useState(0);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar proveedores al abrir el modal
  useEffect(() => {
    cargarProveedores();
  }, []);

  async function cargarProveedores() {
    try {
      const provs = await cajaApi.listarProveedores();
      setProveedores(provs);
    } catch {
      // Sin proveedores disponibles, el campo es opcional
    }
  }

  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  const puedeRegistrar = Boolean(categoriaId) && motivo.trim().length > 0 && (pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0);

  async function registrar() {
    if (!categoriaId || !puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await cajaApi.registrarEgreso({
        categoriaGastoId: Number(categoriaId),
        motivo: motivo.trim(),
        proveedorId: proveedorId || undefined,
        moduloOrigenSlug: moduloOrigenSlug || undefined,
        ...(pago.metodoPago === "mixto" ? pago : { metodoPago: pago.metodoPago, monto }),
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
    <Modal titulo="Registrar egreso" onCerrar={onCerrar} ancho="sm:w-[60vw]">
      <label className="mb-1 block text-xs font-medium">Área (opcional)</label>
      <select
        autoFocus
        value={moduloOrigenSlug}
        onChange={(e) => setModuloOrigenSlug(e.target.value as ModuloOrigenSlug | "")}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="">Sin área específica</option>
        {AREAS_EGRESO.map((m) => (
          <option key={m.value} value={m.value}>
            {m.icon} {m.label}
          </option>
        ))}
      </select>

      {/* Categoría y Proveedor comparten fila al 50/50 — si no hay
          proveedores cargados, Categoría ocupa el ancho completo en vez de
          quedar a la mitad (mismo criterio que Monto/Motivo más abajo). */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={proveedores.length === 0 ? "sm:col-span-2" : ""}>
          <label className="mb-1 block text-xs font-medium">Categoría de gasto</label>
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(Number(e.target.value))}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
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
        </div>

        {proveedores.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium">Proveedor (opcional)</label>
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            >
              <option value="">Sin proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Los únicos dos inputs reales del formulario (el resto son selects o
          el selector de método) van en una grilla de 2 columnas — Monto se
          oculta con pago mixto, así que Motivo queda solo y ocupa las 2
          columnas en ese caso en vez de quedar a la mitad. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pago.metodoPago !== "mixto" && (
          <div>
            <label className="mb-1 block text-xs font-medium">Monto</label>
            <MoneyInput
              value={monto}
              onChange={setMonto}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>
        )}
        <div className={pago.metodoPago === "mixto" ? "sm:col-span-2" : ""}>
          <label className="mb-1 block text-xs font-medium">Motivo</label>
          <input
            required
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      <label className="mb-1 block text-xs font-medium">Método</label>
      <div className="mb-3">
        <SelectorMetodoPago value={pago} onChange={setPago} pedirReferenciaBanco={false} />
      </div>

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
