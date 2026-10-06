import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { usuariosApi, type Usuario } from "../../general/api";
import { valesApi, type FuenteVale } from "../api";

interface NuevoValeModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

const ROLES_DUENO = new Set(["Root", "Super Root"]);

const FUENTES: { valor: FuenteVale; etiqueta: string }[] = [
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Cuenta general (acumulado)" },
  { valor: "dueno", etiqueta: "Bolsillo de un dueño" },
];

export function NuevoValeModal({ onCerrar, onCreado }: NuevoValeModalProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [pagadoA, setPagadoA] = useState("");
  const [destinatarioUsuarioId, setDestinatarioUsuarioId] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fuente, setFuente] = useState<FuenteVale>("turno");
  const [duenoId, setDuenoId] = useState("");
  // Como no hay referenciaBanco en un vale, no se usa MetodoPagoValor.referenciaBanco,
  // pero sí se necesita el monto para efectivo/banco puro (SelectorMetodoPago
  // no lo trae incluido — ver EgresoModal.tsx, mismo patrón).
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [monto, setMonto] = useState(0);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usuariosApi.listar().then(setUsuarios).catch(() => {});
  }, []);

  const duenosDisponibles = usuarios.filter((u) => ROLES_DUENO.has(u.rol_nombre));
  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  // Mismo criterio que EgresoModal.tsx (el precedente real de egresos): nunca
  // se valida faltaReferenciaBanco acá — con pedirReferenciaBanco={false} esa
  // función igual exigiría una referencia que la UI ni siquiera muestra.
  const puedeGuardar =
    pagadoA.trim().length > 0 &&
    concepto.trim().length > 0 &&
    (pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0) &&
    (fuente !== "dueno" || duenoId.length > 0);

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await valesApi.crear({
        pagadoA: pagadoA.trim(),
        destinatarioUsuarioId: destinatarioUsuarioId || undefined,
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        concepto: concepto.trim(),
        fuente,
        duenoId: fuente === "dueno" ? duenoId : undefined,
        ...(pago.metodoPago === "mixto"
          ? { metodoPago: "mixto", montoEfectivo: pago.montoEfectivo, montoBanco: pago.montoBanco }
          : { metodoPago: pago.metodoPago, monto }),
      });
      await onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el vale");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo vale" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Pagado a / Para</label>
          <input value={pagadoA} onChange={(e) => setPagadoA(e.target.value)} className={INPUT_CLASE} autoFocus />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Vincular a un usuario existente (opcional)</label>
            <select value={destinatarioUsuarioId} onChange={(e) => setDestinatarioUsuarioId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin vincular</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Documento (opcional)</label>
            <input value={destinatarioDocumento} onChange={(e) => setDestinatarioDocumento(e.target.value)} className={INPUT_CLASE} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">Por concepto de</label>
          <textarea value={concepto} onChange={(e) => setConcepto(e.target.value)} rows={2} className={`${INPUT_CLASE} resize-y`} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">¿De dónde sale el dinero?</label>
          <select value={fuente} onChange={(e) => setFuente(e.target.value as FuenteVale)} className={INPUT_CLASE}>
            {FUENTES.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </div>

        {fuente === "dueno" && (
          <div>
            <label className="mb-1 block text-xs font-medium">¿Cuál dueño?</label>
            <select value={duenoId} onChange={(e) => setDuenoId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Elige un dueño</option>
              {duenosDisponibles.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium">Valor</label>
          {pago.metodoPago !== "mixto" && (
            <input
              type="number"
              value={monto || ""}
              onChange={(e) => setMonto(Number(e.target.value))}
              placeholder="Monto"
              className={`${INPUT_CLASE} mb-2`}
            />
          )}
          <SelectorMetodoPago value={pago} onChange={setPago} pedirReferenciaBanco={false} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando || !puedeGuardar}
          className="rounded-md bg-brand-green-700 px-4 py-3 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : "Crear vale"}
        </button>
      </div>
    </Modal>
  );
}
