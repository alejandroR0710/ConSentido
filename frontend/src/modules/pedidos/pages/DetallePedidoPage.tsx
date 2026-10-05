import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { BotonFactura } from "../../migao/components/BotonFactura";
import { pedidosApi, type EstadoPedido, type MetodoEnvioPedido, type PedidoDetalle } from "../api";

const SIGUIENTE_ESTADO: Partial<Record<EstadoPedido, { estado: Exclude<EstadoPedido, "pendiente">; etiqueta: string }>> = {
  pendiente: { estado: "alistado", etiqueta: "Marcar como Alistado" },
  alistado: { estado: "enviado", etiqueta: "Marcar como Enviado" },
  enviado: { estado: "entregado", etiqueta: "Marcar como Entregado" },
};

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DetallePedidoPage() {
  const { id } = useParams<{ id: string }>();
  const { usuario } = useAuth();
  const [pedido, setPedido] = useState<PedidoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [observacionInventario, setObservacionInventario] = useState("");
  const [pidiendoObservacion, setPidiendoObservacion] = useState(false);
  const [metodoEnvioInput, setMetodoEnvioInput] = useState<MetodoEnvioPedido | null>(null);
  const [transportadoraInput, setTransportadoraInput] = useState("");
  const [numeroGuiaInput, setNumeroGuiaInput] = useState("");
  const [conductorNombreInput, setConductorNombreInput] = useState("");
  const [conductorPlacaInput, setConductorPlacaInput] = useState("");
  const [conductorDescripcionInput, setConductorDescripcionInput] = useState("");
  const [pidiendoEnvio, setPidiendoEnvio] = useState(false);

  const [modalAbonoAbierto, setModalAbonoAbierto] = useState(false);
  const [montoAbono, setMontoAbono] = useState(0);
  const [metodoAbono, setMetodoAbono] = useState<"efectivo" | "banco">("efectivo");
  const [referenciaBancoAbono, setReferenciaBancoAbono] = useState("");
  const [guardandoAbono, setGuardandoAbono] = useState(false);
  const [errorAbono, setErrorAbono] = useState<string | null>(null);

  const faltaReferenciaAbono = metodoAbono === "banco" && !/^[A-Za-z0-9]{4}$/.test(referenciaBancoAbono);

  async function cargar() {
    if (!id) return;
    try {
      setPedido(await pedidosApi.obtener(id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el pedido");
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRegistrarRefresco(cargar);

  async function avanzarEstado(
    destino: Exclude<EstadoPedido, "pendiente">,
    extra?: {
      observacionInventario?: string;
      metodoEnvio?: MetodoEnvioPedido;
      transportadora?: string;
      numeroGuia?: string;
      conductorNombre?: string;
      conductorPlaca?: string;
      conductorDescripcion?: string;
    },
  ) {
    if (!id) return;
    setCambiandoEstado(true);
    setError(null);
    try {
      await pedidosApi.cambiarEstado(id, destino, extra);
      setPidiendoObservacion(false);
      setObservacionInventario("");
      setPidiendoEnvio(false);
      setMetodoEnvioInput(null);
      setTransportadoraInput("");
      setNumeroGuiaInput("");
      setConductorNombreInput("");
      setConductorPlacaInput("");
      setConductorDescripcionInput("");
      await cargar();
    } catch (err) {
      const mensaje = err instanceof ApiError ? err.message : "No se pudo cambiar el estado";
      // Si el backend pide observación de inventario (stock negativo) o
      // datos del método de envío (al despachar), se muestra el campo en vez
      // de un simple mensaje de error.
      if (mensaje.toLowerCase().includes("observación")) {
        setPidiendoObservacion(true);
      }
      if (
        mensaje.toLowerCase().includes("transportadora") ||
        mensaje.toLowerCase().includes("guía") ||
        mensaje.toLowerCase().includes("conductor") ||
        mensaje.toLowerCase().includes("entregar el pedido")
      ) {
        setPidiendoEnvio(true);
      }
      setError(mensaje);
    } finally {
      setCambiandoEstado(false);
    }
  }

  function clicSiguienteEstado() {
    if (!pedido) return;
    const siguiente = SIGUIENTE_ESTADO[pedido.estado];
    if (!siguiente) return;
    // El método de envío recién se pide al despachar (no al crear el
    // pedido) — si todavía no está guardado, se muestra el formulario en
    // vez de avanzar directo.
    if (siguiente.estado === "enviado" && !pedido.metodo_envio) {
      setPidiendoEnvio(true);
      return;
    }
    avanzarEstado(siguiente.estado);
  }

  async function registrarAbono() {
    if (!id || montoAbono <= 0 || faltaReferenciaAbono) return;
    setGuardandoAbono(true);
    setErrorAbono(null);
    try {
      await pedidosApi.registrarAbono(id, {
        monto: montoAbono,
        metodoPago: metodoAbono,
        referenciaBanco: metodoAbono === "banco" ? referenciaBancoAbono.trim().toUpperCase() : undefined,
      });
      setModalAbonoAbierto(false);
      setMontoAbono(0);
      setReferenciaBancoAbono("");
      await cargar();
    } catch (err) {
      setErrorAbono(err instanceof ApiError ? err.message : "No se pudo registrar el abono");
    } finally {
      setGuardandoAbono(false);
    }
  }

  if (error && !pedido) return <p className="text-sm text-red-600">{error}</p>;
  if (!pedido) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const siguiente = SIGUIENTE_ESTADO[pedido.estado];
  // Cancelar un pedido ya enviado revierte stock Y los abonos ya cobrados —
  // por eso es exclusivo de Root/Super Root, igual que anular una venta en
  // Caja General (el backend lo exige igual, esto solo evita ofrecer un
  // botón que Cajero/Administrador no podrían usar).
  const puedeCancelar =
    pedido.estado === "pendiente" || pedido.estado === "alistado" || (pedido.estado === "enviado" && tieneAccesoTotal(usuario?.rol));
  const faltaDatosEnvio =
    !metodoEnvioInput ||
    (metodoEnvioInput === "transportadora" && (!transportadoraInput.trim() || !numeroGuiaInput.trim())) ||
    (metodoEnvioInput === "plataforma" && (!conductorNombreInput.trim() || !conductorPlacaInput.trim()));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/pedidos" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">{pedido.descripcion}</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Estado actual: <span className="font-semibold capitalize">{pedido.estado}</span>
          {pedido.cliente_nombre ? ` · Cliente: ${pedido.cliente_nombre}` : ""}
        </p>
        <BotonFactura
          origen={{ tipo: "pedido", id: pedido.id }}
          className="mt-2 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {siguiente && (
          <button
            onClick={clicSiguienteEstado}
            disabled={cambiandoEstado}
            className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {siguiente.etiqueta}
          </button>
        )}
        {puedeCancelar && (
          <button
            onClick={() => {
              const aviso =
                pedido.estado === "enviado"
                  ? `Este pedido ya se envió${
                      pedido.totalAbonado > 0 ? ` y tiene ${formatMoney(pedido.totalAbonado)} abonado(s)` : ""
                    }. Al cancelarlo se devuelve el stock descontado${
                      pedido.totalAbonado > 0 ? " y se eliminan esos abonos de Caja General" : ""
                    }, dejando todo como estaba antes. ¿Cancelar igual?`
                  : pedido.totalAbonado > 0
                    ? `Este pedido ya tiene ${formatMoney(pedido.totalAbonado)} abonado(s), que NO se revierten solos en Caja General. ¿Cancelar igual?`
                    : "¿Cancelar este pedido?";
              if (confirm(aviso)) avanzarEstado("cancelado");
            }}
            disabled={cambiandoEstado}
            className="rounded-md border border-red-400 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/30"
          >
            Cancelar pedido
          </button>
        )}
      </div>

      {pidiendoObservacion && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="mb-2 text-sm">Alguno de los productos queda sin stock suficiente — escribe por qué:</p>
          <input
            value={observacionInventario}
            onChange={(e) => setObservacionInventario(e.target.value)}
            placeholder="Ej. llegó mercancía nueva que aún no se registra"
            className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <button
            onClick={() => siguiente && avanzarEstado(siguiente.estado, { observacionInventario })}
            disabled={!observacionInventario.trim()}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Confirmar con observación
          </button>
        </div>
      )}

      {pidiendoEnvio && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="mb-2 text-sm">¿Cómo se va a entregar este pedido?</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                { valor: "transportadora", etiqueta: "Transportadora" },
                { valor: "recoge_tienda", etiqueta: "Recoge en tienda" },
                { valor: "plataforma", etiqueta: "Plataforma de recogida" },
              ] as const
            ).map((opcion) => (
              <button
                key={opcion.valor}
                type="button"
                onClick={() => setMetodoEnvioInput(opcion.valor)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  metodoEnvioInput === opcion.valor
                    ? "bg-amber-600 text-white"
                    : "border border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>

          {metodoEnvioInput === "transportadora" && (
            <div className="mb-2 flex flex-wrap gap-2">
              <input
                value={transportadoraInput}
                onChange={(e) => setTransportadoraInput(e.target.value)}
                placeholder="Transportadora"
                className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <input
                value={numeroGuiaInput}
                onChange={(e) => setNumeroGuiaInput(e.target.value)}
                placeholder="Número de guía"
                className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
            </div>
          )}

          {metodoEnvioInput === "plataforma" && (
            <div className="mb-2 flex flex-col gap-2">
              <input
                value={conductorNombreInput}
                onChange={(e) => setConductorNombreInput(e.target.value)}
                placeholder="Nombre del conductor"
                className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <input
                value={conductorPlacaInput}
                onChange={(e) => setConductorPlacaInput(e.target.value)}
                placeholder="Placa del vehículo"
                className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <input
                value={conductorDescripcionInput}
                onChange={(e) => setConductorDescripcionInput(e.target.value)}
                placeholder="Descripción (opcional)"
                className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
            </div>
          )}

          {metodoEnvioInput === "recoge_tienda" && (
            <p className="mb-2 text-xs text-amber-700/80 dark:text-amber-400/80">
              El cliente recoge el pedido en tienda — no se necesita más información.
            </p>
          )}

          <button
            onClick={() =>
              avanzarEstado("enviado", {
                metodoEnvio: metodoEnvioInput ?? undefined,
                transportadora: metodoEnvioInput === "transportadora" ? transportadoraInput : undefined,
                numeroGuia: metodoEnvioInput === "transportadora" ? numeroGuiaInput : undefined,
                conductorNombre: metodoEnvioInput === "plataforma" ? conductorNombreInput : undefined,
                conductorPlaca: metodoEnvioInput === "plataforma" ? conductorPlacaInput : undefined,
                conductorDescripcion: metodoEnvioInput === "plataforma" ? conductorDescripcionInput : undefined,
              })
            }
            disabled={faltaDatosEnvio}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Confirmar envío
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Ítems</h2>
          <div className="overflow-hidden rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pedido.items.map((item) => (
                  <tr key={item.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">{item.nombre}</td>
                    <td className="px-3 py-2 text-right">{item.cantidad}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-6 text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Envío</h2>
          <div className="rounded-lg border border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700">
            <p>{pedido.destinatario_nombre ?? "Sin destinatario registrado"}</p>
            {pedido.destinatario_documento && <p>Doc: {pedido.destinatario_documento}</p>}
            {pedido.destinatario_telefono && <p>Tel: {pedido.destinatario_telefono}</p>}
            {pedido.direccion_envio && <p>{pedido.direccion_envio}{pedido.ciudad_envio ? `, ${pedido.ciudad_envio}` : ""}</p>}
            {pedido.metodo_envio === "transportadora" && pedido.transportadora && (
              <p>{pedido.transportadora} — Guía: {pedido.numero_guia ?? "—"}</p>
            )}
            {pedido.metodo_envio === "recoge_tienda" && <p>Recoge en tienda</p>}
            {pedido.metodo_envio === "plataforma" && (
              <p>
                Recogido por plataforma — {pedido.conductor_nombre} (placa {pedido.conductor_placa})
                {pedido.conductor_descripcion ? ` — ${pedido.conductor_descripcion}` : ""}
              </p>
            )}
            {pedido.notas_entrega && <p className="mt-1 italic">{pedido.notas_entrega}</p>}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Pagos</h2>
            {pedido.saldoPendiente > 0 && pedido.estado !== "cancelado" && (
              <button
                onClick={() => setModalAbonoAbierto(true)}
                className="rounded-md border border-brand-green-600 px-3 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                + Agregar abono
              </button>
            )}
          </div>
          <div className="rounded-lg border border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700">
            <div className="flex justify-between"><span>Total</span><span>{formatMoney(pedido.precio_acordado)}</span></div>
            <div className="flex justify-between"><span>Abonado</span><span>{formatMoney(pedido.totalAbonado)}</span></div>
            <div className="flex justify-between font-bold"><span>Saldo</span><span>{formatMoney(pedido.saldoPendiente)}</span></div>
          </div>
          {pedido.abonos.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
              {pedido.abonos.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>{formatearFechaHora(a.created_at)} · {a.metodo_pago}</span>
                  <span>{formatMoney(a.monto)}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-2 mt-6 text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial</h2>
          <ul className="flex flex-col gap-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
            {pedido.historial.map((h) => (
              <li key={h.id}>
                {formatearFechaHora(h.created_at)} — {h.accion} {h.usuario_nombre ? `(${h.usuario_nombre})` : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {modalAbonoAbierto && (
        <Modal titulo="Registrar abono" onCerrar={() => setModalAbonoAbierto(false)}>
          <p className="mb-3 text-sm">Saldo pendiente: <span className="font-bold">{formatMoney(pedido.saldoPendiente)}</span></p>
          <label className="mb-1 block text-xs font-medium">Monto</label>
          <MoneyInput
            value={montoAbono}
            onChange={setMontoAbono}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <label className="mb-1 block text-xs font-medium">Método</label>
          <select
            value={metodoAbono}
            onChange={(e) => setMetodoAbono(e.target.value as "efectivo" | "banco")}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            <option value="efectivo">Efectivo</option>
            <option value="banco">Banco</option>
          </select>
          {metodoAbono === "banco" && (
            <>
              <label className="mb-1 block text-xs font-medium">Últimos 4 de la transferencia</label>
              <input
                value={referenciaBancoAbono}
                onChange={(e) => setReferenciaBancoAbono(e.target.value)}
                maxLength={4}
                className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
            </>
          )}
          {errorAbono && <p className="mb-3 text-sm text-red-600">{errorAbono}</p>}
          <button
            onClick={registrarAbono}
            disabled={guardandoAbono || montoAbono <= 0 || faltaReferenciaAbono}
            className="w-full rounded-md bg-brand-green-700 px-4 py-2.5 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {guardandoAbono ? "Guardando..." : "Registrar abono"}
          </button>
        </Modal>
      )}
    </div>
  );
}
