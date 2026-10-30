import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { formatMoney } from "../../../shared/format/money";
import { usuariosApi, type Usuario } from "../../general/api";
import { conSentidoApi, type ProductoConSentido } from "../../con_sentido/api";
import { SugerenciasProducto } from "../../caja/components/SugerenciasProducto";
import { pedidosApi } from "../api";

interface NuevoPedidoModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

interface LineaPedido {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  productoId?: string;
  // De qué área es ESTA línea — igual que IngresoModal.tsx (Task 7) y
  // NuevaVentaModal.tsx (Task 9): se precarga desde producto.areaDefecto al
  // elegir un producto del catálogo, pero siempre se puede cambiar; una
  // línea escrita a mano arranca sin valor y hay que elegirla a mano.
  // Obligatoria en TODAS las líneas (ver itemPedidoSchema en el backend,
  // Task 10: moduloOrigenSlug ya no es opcional).
  moduloOrigenSlug?: "insumos" | "con_sentido";
}

let siguienteKeyLinea = 1;
function lineaVacia(): LineaPedido {
  return { key: siguienteKeyLinea++, nombre: "", cantidad: 1, precioUnitario: 0 };
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
// Igual que INPUT_CLASE pero sin `w-full` — para campos de ancho fijo
// (cantidad/precio/abono). Concatenar INPUT_CLASE + "w-NN" no funciona: en el
// CSS compilado .w-full se emite después de .w-NN y gana el empate de
// especificidad, dejando el campo en 100% de ancho pese al w-NN — eso
// forzaba cantidad/precio a su propia línea bajo el nombre (flex-wrap) y
// achicaba el wrapper que SugerenciasProducto mide para su dropdown.
const INPUT_CLASE_ANCHO_FIJO =
  "rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

export function NuevoPedidoModal({ onCerrar, onCreado }: NuevoPedidoModalProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [productos, setProductos] = useState<ProductoConSentido[]>([]);
  const [filaEnfocada, setFilaEnfocada] = useState<number | null>(null);

  const [responsableId, setResponsableId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [lineas, setLineas] = useState<LineaPedido[]>([lineaVacia()]);

  const [destinatarioNombre, setDestinatarioNombre] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [destinatarioTelefono, setDestinatarioTelefono] = useState("");
  const [direccionEnvio, setDireccionEnvio] = useState("");
  const [ciudadEnvio, setCiudadEnvio] = useState("");
  const [notasEntrega, setNotasEntrega] = useState("");

  const [conAbono, setConAbono] = useState(false);
  const [montoAbono, setMontoAbono] = useState(0);
  const [metodoAbono, setMetodoAbono] = useState<"efectivo" | "banco">("efectivo");
  const [referenciaBancoAbono, setReferenciaBancoAbono] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usuariosApi.listar().then(setUsuarios).catch(() => {});
    conSentidoApi.listarProductos().then(setProductos).catch(() => {});
  }, []);

  const lineasValidas = lineas.filter((l) => l.nombre.trim().length > 0 && l.cantidad > 0);
  const total = lineasValidas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
  const faltaReferenciaAbono = conAbono && metodoAbono === "banco" && !/^[A-Za-z0-9]{4}$/.test(referenciaBancoAbono);
  // Cada línea reparte el pago (abono inicial y cualquier abono posterior) a
  // SU área (ver pedidos.service.ts::calcularPorcentajesPorArea) — sin
  // elegirla en TODAS las líneas no hay cómo crear el pedido. Mismo criterio
  // que faltaAreaLineas en IngresoModal.tsx (Task 7) y faltaAreaCarrito en
  // NuevaVentaModal.tsx (Task 9).
  const faltaAreaLineas = lineasValidas.some((l) => !l.moduloOrigenSlug);
  const puedeGuardar =
    lineasValidas.length > 0 &&
    !faltaAreaLineas &&
    (!conAbono || (montoAbono > 0 && montoAbono <= total && !faltaReferenciaAbono));

  function actualizarLinea(key: number, cambios: Partial<LineaPedido>) {
    setLineas((actual) => actual.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }
  function quitarLinea(key: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.key !== key) : actual));
  }

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await pedidosApi.crear({
        responsableId: responsableId || undefined,
        descripcion: descripcion.trim() || undefined,
        destinatarioNombre: destinatarioNombre.trim() || undefined,
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        destinatarioTelefono: destinatarioTelefono.trim() || undefined,
        direccionEnvio: direccionEnvio.trim() || undefined,
        ciudadEnvio: ciudadEnvio.trim() || undefined,
        notasEntrega: notasEntrega.trim() || undefined,
        items: lineasValidas.map((l) => ({
          nombre: l.nombre.trim(),
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          productoId: l.productoId,
          // puedeGuardar ya garantiza que todas las líneas la tienen (ver
          // faltaAreaLineas) — el cast es seguro acá.
          moduloOrigenSlug: l.moduloOrigenSlug as "insumos" | "con_sentido",
        })),
        abonoInicial: conAbono
          ? {
              monto: montoAbono,
              metodoPago: metodoAbono,
              referenciaBanco: metodoAbono === "banco" ? referenciaBancoAbono.trim().toUpperCase() : undefined,
            }
          : undefined,
      });
      await onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el pedido");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo pedido" onCerrar={onCerrar} maxWidth="sm:max-w-3xl">
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Responsable (opcional)</label>
            <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium">Descripción (opcional — se arma sola si la dejas vacía)</label>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={INPUT_CLASE} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Ítems del pedido
          </p>
          <div className="flex flex-col gap-2">
            {lineas.map((linea) => (
              <div key={linea.key} className="flex flex-wrap items-center gap-2">
                {/* min-w-36 (no min-w-0): con flex-wrap, el navegador decide qué
                    entra en la línea usando el tamaño "hipotético" de cada
                    ítem (su flex-basis, acá 0% por flex-1) — así que con
                    min-w-0 cantidad+precio+área (ya con ancho fijo real tras
                    el fix de abajo) "caben" los tres en la hipótesis y el
                    nombre queda con las migajas (y SugerenciasProducto, que
                    copia este ancho, igual de angosto). Un mínimo real le da
                    un piso al cálculo de wrap y fuerza a los campos de ancho
                    fijo que no quepan a bajar de línea en vez de aplastar el
                    nombre — mismo problema, no cubierto por el fix de
                    INPUT_CLASE/w-full de abajo. */}
                <div className="relative min-w-36 flex-1">
                  <input
                    value={linea.nombre}
                    onChange={(e) => actualizarLinea(linea.key, { nombre: e.target.value, productoId: undefined })}
                    onFocus={() => setFilaEnfocada(linea.key)}
                    onBlur={() => setFilaEnfocada((actual) => (actual === linea.key ? null : actual))}
                    placeholder="Producto o servicio"
                    autoComplete="off"
                    className={INPUT_CLASE}
                  />
                  {filaEnfocada === linea.key && (
                    <SugerenciasProducto
                      productos={productos}
                      texto={linea.nombre}
                      onSeleccionar={(producto) => {
                        actualizarLinea(linea.key, {
                          nombre: producto.nombre,
                          precioUnitario: producto.precio,
                          productoId: producto.id,
                          moduloOrigenSlug: producto.areaDefecto,
                        });
                        setFilaEnfocada(null);
                      }}
                    />
                  )}
                </div>
                <NumeroInput
                  value={linea.cantidad}
                  onChange={(v) => actualizarLinea(linea.key, { cantidad: Math.max(0.001, v) })}
                  className={`${INPUT_CLASE_ANCHO_FIJO} w-20`}
                />
                <MoneyInput
                  value={linea.precioUnitario}
                  onChange={(v) => actualizarLinea(linea.key, { precioUnitario: v })}
                  placeholder="Precio"
                  className={`${INPUT_CLASE_ANCHO_FIJO} w-28`}
                />
                {/* A qué área se reparte el pago de ESTA línea (ver
                    pedidos.service.ts::calcularPorcentajesPorArea) — se
                    precarga sola al elegir un producto del catálogo
                    (producto.areaDefecto, ver onSeleccionar arriba) pero
                    siempre se puede cambiar; una línea escrita a mano arranca
                    sin valor. Mismo criterio que el selector por línea de
                    IngresoModal.tsx (Task 7) y NuevaVentaModal.tsx (Task 9). */}
                <select
                  value={linea.moduloOrigenSlug ?? ""}
                  onChange={(e) =>
                    actualizarLinea(linea.key, {
                      moduloOrigenSlug: e.target.value ? (e.target.value as "insumos" | "con_sentido") : undefined,
                    })
                  }
                  className={`w-32 rounded-md border bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:bg-brand-green-900 dark:text-brand-vanilla ${
                    linea.moduloOrigenSlug || !lineasValidas.includes(linea)
                      ? "border-brand-vanilla-dark dark:border-brand-green-700"
                      : "border-red-400 dark:border-red-500"
                  }`}
                >
                  <option value="" disabled>
                    Elegir área...
                  </option>
                  <option value="insumos">📦 Insumos</option>
                  <option value="con_sentido">🎨 Con Sentido</option>
                </select>
                <span className="w-24 text-right text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                  {formatMoney(linea.cantidad * linea.precioUnitario)}
                </span>
                <button
                  type="button"
                  onClick={() => quitarLinea(linea.key)}
                  disabled={lineas.length === 1}
                  className="rounded-md px-2 py-1 text-lg text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLineas((actual) => [...actual, lineaVacia()])}
            className="mt-2 text-sm text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            + Agregar ítem
          </button>
          <div className="mt-2 flex items-center justify-between rounded-md bg-brand-green-50 px-3 py-2 text-base font-bold text-brand-green-700 dark:bg-brand-green-700/20 dark:text-brand-vanilla">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Datos de envío
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={destinatarioNombre} onChange={(e) => setDestinatarioNombre(e.target.value)} placeholder="Nombre de quien recibe" className={INPUT_CLASE} />
            <input value={destinatarioDocumento} onChange={(e) => setDestinatarioDocumento(e.target.value)} placeholder="Documento" className={INPUT_CLASE} />
            <input value={destinatarioTelefono} onChange={(e) => setDestinatarioTelefono(e.target.value)} placeholder="Teléfono de contacto" className={INPUT_CLASE} />
            <input value={ciudadEnvio} onChange={(e) => setCiudadEnvio(e.target.value)} placeholder="Ciudad" className={INPUT_CLASE} />
            <input value={direccionEnvio} onChange={(e) => setDireccionEnvio(e.target.value)} placeholder="Dirección" className={`${INPUT_CLASE} sm:col-span-2`} />
            <textarea
              value={notasEntrega}
              onChange={(e) => setNotasEntrega(e.target.value)}
              placeholder="Notas de entrega (opcional)"
              rows={2}
              className={`${INPUT_CLASE} sm:col-span-2 resize-y`}
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={conAbono} onChange={(e) => setConAbono(e.target.checked)} />
            Registrar un abono ahora
          </label>
          {conAbono && (
            <div className="mt-2 flex flex-wrap gap-2">
              <MoneyInput value={montoAbono} onChange={setMontoAbono} placeholder="Monto del abono" className={`${INPUT_CLASE_ANCHO_FIJO} w-40`} />
              <select value={metodoAbono} onChange={(e) => setMetodoAbono(e.target.value as "efectivo" | "banco")} className={`${INPUT_CLASE_ANCHO_FIJO} w-32`}>
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco</option>
              </select>
              {metodoAbono === "banco" && (
                <input
                  value={referenciaBancoAbono}
                  onChange={(e) => setReferenciaBancoAbono(e.target.value)}
                  placeholder="Últimos 4 de la transferencia"
                  maxLength={4}
                  className={`${INPUT_CLASE_ANCHO_FIJO} w-48`}
                />
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando || !puedeGuardar}
          className="rounded-md bg-brand-green-700 px-4 py-3 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : "Crear pedido"}
        </button>
      </div>
    </Modal>
  );
}
