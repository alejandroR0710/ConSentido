import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { crearTareaScrum } from "../api";

interface NuevaTareaScrumModalProps {
  /** Áreas ya usadas en las tareas del tablero cargado — solo son
   *  sugerencias del `<datalist>`, el campo de área sigue siendo texto
   *  libre (no restringe a esta lista). */
  areasSugeridas: string[];
  onCerrar: () => void;
  onCreada: () => Promise<void> | void;
}

function fechaISOHoy(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}

const campoClase =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const etiquetaClase = "mb-1 block text-xs font-medium text-brand-ink/80 dark:text-brand-vanilla/80";

/**
 * Alta de una tarea compartida del tablero (Scrum). Solo Root/Super Root
 * pueden montarlo (ver `puedeGestionar` en `TableroPage`); el backend exige
 * `tareas.gestionar` de todas formas (`crearTareaScrum` en tareas.routes.ts).
 *
 * El área es un input de texto libre: el `<datalist>` sugiere las áreas ya
 * vistas en el tablero cargado para evitar variantes del mismo nombre
 * ("Cocina" vs "cocina"), pero no restringe a esa lista — permite crear
 * áreas nuevas.
 */
export function NuevaTareaScrumModal({ areasSugeridas, onCerrar, onCreada }: NuevaTareaScrumModalProps) {
  const [titulo, setTitulo] = useState("");
  const [area, setArea] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState(fechaISOHoy());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeGuardar = titulo.trim().length > 0 && area.trim().length > 0;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await crearTareaScrum({
        titulo: titulo.trim(),
        area: area.trim(),
        descripcion: descripcion.trim() || undefined,
        fecha,
      });
      await onCreada();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la tarea");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva tarea" onCerrar={onCerrar}>
      <label className={etiquetaClase}>Título</label>
      <input
        autoFocus
        maxLength={150}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder='Ej. "Limpieza de vitrinas"'
        className={`${campoClase} mb-3`}
      />

      <label className={etiquetaClase}>Área</label>
      <input
        maxLength={80}
        value={area}
        onChange={(e) => setArea(e.target.value)}
        placeholder='Ej. "Cocina"'
        list="nueva-tarea-scrum-areas"
        className={`${campoClase} mb-3`}
      />
      <datalist id="nueva-tarea-scrum-areas">
        {areasSugeridas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      <label className={etiquetaClase}>Descripción (opcional)</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={2}
        className={`${campoClase} mb-3`}
      />

      <label className={etiquetaClase}>Fecha</label>
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={`${campoClase} mb-4`} />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Creando..." : "Crear tarea"}
      </button>
    </Modal>
  );
}
