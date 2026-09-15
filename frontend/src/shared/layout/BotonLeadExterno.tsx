import { useState } from "react";
import { leadsExternosApi, type TipoLead } from "../api/leadsExternos";
import { Modal } from "../components/Modal";

const CAMPO_CLASE =
  "rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const INPUT_CLASE = `w-full ${CAMPO_CLASE}`;

// Indicativos de país más comunes para los clientes del negocio — Colombia
// por defecto. El número final que se manda al bot es código + número pegado
// (ej. "57" + "3001234567" = "573001234567"), igual al formato del ejemplo.
const CODIGOS_PAIS: { valor: string; etiqueta: string }[] = [
  { valor: "57", etiqueta: "🇨🇴 +57 Colombia" },
  { valor: "52", etiqueta: "🇲🇽 +52 México" },
  { valor: "58", etiqueta: "🇻🇪 +58 Venezuela" },
  { valor: "593", etiqueta: "🇪🇨 +593 Ecuador" },
  { valor: "51", etiqueta: "🇵🇪 +51 Perú" },
  { valor: "54", etiqueta: "🇦🇷 +54 Argentina" },
  { valor: "1", etiqueta: "🇺🇸 +1 Estados Unidos" },
  { valor: "34", etiqueta: "🇪🇸 +34 España" },
];

// Los 4 tipos reales que se mandan al bot (params.type).
const TIPOS: { valor: TipoLead; etiqueta: string }[] = [
  { valor: "experience", etiqueta: "Solo experiencia" },
  { valor: "basic", etiqueta: "Taller básico (incluye básico personalizado)" },
  { valor: "advanced", etiqueta: "Avanzado" },
  { valor: "concrete", etiqueta: "Concreto" },
];
const TODOS_LOS_TIPOS = TIPOS.map((t) => t.valor);

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
  const [codigoPais, setCodigoPais] = useState("57");
  const [telefono, setTelefono] = useState("");
  const [tipos, setTipos] = useState<TipoLead[]>(["basic"]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  function reiniciar() {
    setNombre("");
    setCodigoPais("57");
    setTelefono("");
    setTipos(["basic"]);
    setError(null);
    setExito(false);
  }

  function alternarTipo(valor: TipoLead) {
    setTipos((actual) => (actual.includes(valor) ? actual.filter((t) => t !== valor) : [...actual, valor]));
  }

  // "Todo junto" no es un valor que se manda al bot: es un atajo que marca
  // (o desmarca) los 4 tipos reales de una — evita mandar "all" Y los sueltos
  // duplicado si alguien marca todo a mano.
  const todoMarcado = TODOS_LOS_TIPOS.every((t) => tipos.includes(t));
  function alternarTodo() {
    setTipos(todoMarcado ? [] : TODOS_LOS_TIPOS);
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
    if (tipos.length === 0) {
      setError("Marca al menos una opción de interés");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const phone = `${codigoPais}${telefono.trim().replace(/\D/g, "")}`;
      await leadsExternosApi.enviar({ name: nombre.trim(), phone, params: { type: tipos } });
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
                <div className="flex gap-2">
                  <select
                    value={codigoPais}
                    onChange={(e) => setCodigoPais(e.target.value)}
                    className={`${CAMPO_CLASE} shrink-0`}
                  >
                    {CODIGOS_PAIS.map(({ valor, etiqueta }) => (
                      <option key={valor} value={valor}>
                        {etiqueta}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="Ej. 3001234567"
                    className={`${CAMPO_CLASE} min-w-0 flex-1`}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium">¿Qué le interesa? (puedes marcar varios)</span>
                {TIPOS.map(({ valor, etiqueta }) => (
                  <label key={valor} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={tipos.includes(valor)}
                      onChange={() => alternarTipo(valor)}
                      className="h-4 w-4"
                    />
                    {etiqueta}
                  </label>
                ))}
                <label className="flex items-center gap-2 border-t border-brand-vanilla-dark pt-2 text-sm font-medium dark:border-brand-green-700">
                  <input type="checkbox" checked={todoMarcado} onChange={alternarTodo} className="h-4 w-4" />
                  Todo junto
                </label>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={enviar}
                disabled={enviando || tipos.length === 0}
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
