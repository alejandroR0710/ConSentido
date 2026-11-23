import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { pedidosApi, type Rotulo } from "../api";

interface NuevoRotuloModalProps {
  onCerrar: () => void;
  onCreado: (rotulo: Rotulo) => void;
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

/**
 * Rótulo de envío suelto, sin pasar por todo el flujo de crear un pedido
 * completo — solo lo que hace falta para imprimir la etiqueta (ver
 * RotuloEnvio.tsx: transportadora/guía solo importan si se llenan).
 */
export function NuevoRotuloModal({ onCerrar, onCreado }: NuevoRotuloModalProps) {
  const [destinatarioNombre, setDestinatarioNombre] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [destinatarioTelefono, setDestinatarioTelefono] = useState("");
  const [direccionEnvio, setDireccionEnvio] = useState("");
  const [ciudadEnvio, setCiudadEnvio] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [transportadora, setTransportadora] = useState("");
  const [numeroGuia, setNumeroGuia] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeGuardar = destinatarioNombre.trim().length > 0 && descripcion.trim().length > 0;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const conTransportadora = transportadora.trim().length > 0 || numeroGuia.trim().length > 0;
      const rotulo = await pedidosApi.crearRotulo({
        destinatarioNombre: destinatarioNombre.trim(),
        descripcion: descripcion.trim(),
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        destinatarioTelefono: destinatarioTelefono.trim() || undefined,
        direccionEnvio: direccionEnvio.trim() || undefined,
        ciudadEnvio: ciudadEnvio.trim() || undefined,
        metodoEnvio: conTransportadora ? "transportadora" : undefined,
        transportadora: conTransportadora ? transportadora.trim() || undefined : undefined,
        numeroGuia: conTransportadora ? numeroGuia.trim() || undefined : undefined,
      });
      onCreado(rotulo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el rótulo");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="🏷️ Nuevo rótulo" onCerrar={onCerrar} ancho="sm:w-[50vw]">
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Destinatario</label>
          <input
            autoFocus
            required
            value={destinatarioNombre}
            onChange={(e) => setDestinatarioNombre(e.target.value)}
            className={INPUT_CLASE}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Documento (opcional)</label>
          <input value={destinatarioDocumento} onChange={(e) => setDestinatarioDocumento(e.target.value)} className={INPUT_CLASE} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Teléfono (opcional)</label>
          <input value={destinatarioTelefono} onChange={(e) => setDestinatarioTelefono(e.target.value)} className={INPUT_CLASE} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Ciudad (opcional)</label>
          <input value={ciudadEnvio} onChange={(e) => setCiudadEnvio(e.target.value)} className={INPUT_CLASE} />
        </div>
      </div>

      <label className="mb-1 block text-xs font-medium">Dirección (opcional)</label>
      <input value={direccionEnvio} onChange={(e) => setDireccionEnvio(e.target.value)} className={`mb-3 ${INPUT_CLASE}`} />

      <label className="mb-1 block text-xs font-medium">Descripción (lo que va en el rótulo)</label>
      <input
        required
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        className={`mb-3 ${INPUT_CLASE}`}
      />

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Transportadora (opcional)</label>
          <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} className={INPUT_CLASE} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Número de guía (opcional)</label>
          <input value={numeroGuia} onChange={(e) => setNumeroGuia(e.target.value)} className={INPUT_CLASE} />
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-2.5 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Crear rótulo"}
      </button>
    </Modal>
  );
}
