import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { formatMoney } from "../../../shared/format/money";
import { usuariosApi, type Usuario } from "../../general/api";
import { conSentidoApi, type ClienteConSentido, type ProductoConSentido } from "../../con_sentido/api";
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
}

let siguienteKeyLinea = 1;
function lineaVacia(): LineaPedido {
  return { key: siguienteKeyLinea++, nombre: "", cantidad: 1, precioUnitario: 0 };
}

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

export function NuevoPedidoModal({ onCerrar, onCreado }: NuevoPedidoModalProps) {
  const [clientes, setClientes] = useState<ClienteConSentido[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [productos, setProductos] = useState<ProductoConSentido[]>([]);
  const [filaEnfocada, setFilaEnfocada] = useState<number | null>(null);

  const [clienteId, setClienteId] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState("");
  const [lineas, setLineas] = useState<LineaPedido[]>([lineaVacia()]);

  const [destinatarioNombre, setDestinatarioNombre] = useState("");
  const [destinatarioDocumento, setDestinatarioDocumento] = useState("");
  const [destinatarioTelefono, setDestinatarioTelefono] = useState("");
  const [direccionEnvio, setDireccionEnvio] = useState("");
  const [ciudadEnvio, setCiudadEnvio] = useState("");
  const [transportadora, setTransportadora] = useState("");
  const [numeroGuia, setNumeroGuia] = useState("");
  const [notasEntrega, setNotasEntrega] = useState("");

  const [conAbono, setConAbono] = useState(false);
  const [montoAbono, setMontoAbono] = useState(0);
  const [metodoAbono, setMetodoAbono] = useState<"efectivo" | "banco">("efectivo");
  const [referenciaBancoAbono, setReferenciaBancoAbono] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    conSentidoApi.listarClientes().then(setClientes).catch(() => {});
    usuariosApi.listar().then(setUsuarios).catch(() => {});
    conSentidoApi.listarProductos().then(setProductos).catch(() => {});
  }, []);

  const lineasValidas = lineas.filter((l) => l.nombre.trim().length > 0 && l.cantidad > 0);
  const total = lineasValidas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
  const faltaReferenciaAbono = conAbono && metodoAbono === "banco" && !/^[A-Za-z0-9]{4}$/.test(referenciaBancoAbono);
  const puedeGuardar =
    lineasValidas.length > 0 &&
    fechaEntrega.length > 0 &&
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
        clienteId: clienteId || undefined,
        responsableId: responsableId || undefined,
        descripcion: descripcion.trim() || undefined,
        fechaEntrega,
        destinatarioNombre: destinatarioNombre.trim() || undefined,
        destinatarioDocumento: destinatarioDocumento.trim() || undefined,
        destinatarioTelefono: destinatarioTelefono.trim() || undefined,
        direccionEnvio: direccionEnvio.trim() || undefined,
        ciudadEnvio: ciudadEnvio.trim() || undefined,
        transportadora: transportadora.trim() || undefined,
        numeroGuia: numeroGuia.trim() || undefined,
        notasEntrega: notasEntrega.trim() || undefined,
        items: lineasValidas.map((l) => ({
          nombre: l.nombre.trim(),
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          productoId: l.productoId,
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
            <label className="mb-1 block text-xs font-medium">Cliente (opcional)</label>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={INPUT_CLASE}>
              <option value="">Sin cliente registrado</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
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
          <div>
            <label className="mb-1 block text-xs font-medium">Fecha de entrega</label>
            <input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} className={INPUT_CLASE} />
          </div>
          <div>
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
                <div className="relative min-w-0 flex-1">
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
                        });
                        setFilaEnfocada(null);
                      }}
                    />
                  )}
                </div>
                <NumeroInput
                  value={linea.cantidad}
                  onChange={(v) => actualizarLinea(linea.key, { cantidad: Math.max(0.001, v) })}
                  className={`${INPUT_CLASE} w-20`}
                />
                <MoneyInput
                  value={linea.precioUnitario}
                  onChange={(v) => actualizarLinea(linea.key, { precioUnitario: v })}
                  placeholder="Precio"
                  className={`${INPUT_CLASE} w-28`}
                />
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
            <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Transportadora" className={INPUT_CLASE} />
            <input value={numeroGuia} onChange={(e) => setNumeroGuia(e.target.value)} placeholder="Número de guía" className={INPUT_CLASE} />
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
              <MoneyInput value={montoAbono} onChange={setMontoAbono} placeholder="Monto del abono" className={`${INPUT_CLASE} w-40`} />
              <select value={metodoAbono} onChange={(e) => setMetodoAbono(e.target.value as "efectivo" | "banco")} className={`${INPUT_CLASE} w-32`}>
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco</option>
              </select>
              {metodoAbono === "banco" && (
                <input
                  value={referenciaBancoAbono}
                  onChange={(e) => setReferenciaBancoAbono(e.target.value)}
                  placeholder="Últimos 4 de la transferencia"
                  maxLength={4}
                  className={`${INPUT_CLASE} w-48`}
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
