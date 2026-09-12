import { useState } from "react";
import { leadsExternosApi } from "../api/leadsExternos";
import { Modal } from "../components/Modal";

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

const CASILLAS: { clave: "showWorkshops" | "showExperience" | "includeImages" | "sendCatalog"; etiqueta: string }[] = [
  { clave: "showExperience", etiqueta: "Mostrar experiencia" },
  { clave: "showWorkshops", etiqueta: "Mostrar talleres" },
  { clave: "includeImages", etiqueta: "Incluir imágenes" },
  { clave: "sendCatalog", etiqueta: "Enviar catálogo" },
];

/**
 * Botón del header para registrar un contacto interesado y reenviarlo al bot
 * externo (otro proyecto, fuera de este repo — ver leadsExternos.ts). Ese bot
 * solo vive en la red Wi-Fi del negocio, así que la llamada sale DIRECTO
 * desde el navegador (nunca pasa por nuestro backend en Render, que no
 * podría alcanzarlo) — solo funciona si el dispositivo está en esa red.
 * Disponible para cualquier usuario logueado, sin permiso dedicado: no es un
 * módulo del menú, es un atajo rápido desde cualquier pantalla.
 */
export function BotonLeadExterno() {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [params, setParams] = useState({
    showWorkshops: false,
    showExperience: false,
    includeImages: false,
    sendCatalog: false,
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  function reiniciar() {
    setNombre("");
    setTelefono("");
    setParams({ showWorkshops: false, showExperience: false, includeImages: false, sendCatalog: false });
    setError(null);
    setExito(false);
  }

  function cerrar() {
    setAbierto(false);
    reiniciar();
  }

  async function enviar() {
    if (!nombre.trim() || !telefono.trim()) {
      setError("Nombre y teléfono son obligatorios");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await leadsExternosApi.enviar({ name: nombre.trim(), phone: telefono.trim(), params });
      setExito(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el lead");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        aria-label="Enviar lead"
        title="Enviar lead"
        className="flex items-center justify-center rounded-md p-1.5 text-lg text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
      >
        📇
      </button>

      {abierto && (
        <Modal titulo="Enviar lead" onCerrar={cerrar}>
          {exito ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">✓ Lead enviado correctamente.</p>
              <button
                onClick={cerrar}
                className="w-full rounded-md bg-brand-green-700 px-4 py-2 font-semibold text-brand-vanilla hover:bg-brand-green-600"
              >
                Cerrar
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Nombre</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre del contacto"
                  className={INPUT_CLASE}
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">Teléfono</label>
                <input
                  type="tel"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="Ej. 573001234567"
                  className={INPUT_CLASE}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium">¿Qué debe enviarle el bot?</span>
                {CASILLAS.map(({ clave, etiqueta }) => (
                  <label key={clave} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={params[clave]}
                      onChange={(e) => setParams((actual) => ({ ...actual, [clave]: e.target.checked }))}
                      className="h-4 w-4"
                    />
                    {etiqueta}
                  </label>
                ))}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={enviar}
                disabled={enviando}
                className="w-full rounded-md bg-brand-green-700 px-4 py-2 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
              >
                {enviando ? "Enviando..." : "Enviar lead"}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
