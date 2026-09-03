import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import {
  migaoApi,
  type CuentaDetalle,
  type ItemActivo,
  type Mesa,
  type OrdenDetalle,
  type OrdenResumen,
  type RegistrarAbonoInput,
} from "../api";
import { AREAS_MESA, areaDeMesa } from "../areas";
import { AgregarParaLlevarModal } from "../components/AgregarParaLlevarModal";
import { CancelarOrdenModal } from "../components/CancelarOrdenModal";
import { EditarNombreOrdenModal } from "../components/EditarNombreOrdenModal";
import { EstadoBadge } from "../components/EstadoBadge";
import { FloorPlanCanvas } from "../components/FloorPlanCanvas";
import { BADGE_POR_ESTADO, BORDE_POR_ESTADO, ETIQUETA_POR_ESTADO, estadoAgregadoOrden } from "../estadoOrden";
import { facturaAReciboProps } from "../factura";
import { formatCantidad } from "../format";
import { combinarMesasConOrdenes } from "../ocupacionMesas";

const POLL_MS = 8000;

/** Cuánto de lo que se está cobrando es efectivo (para la calculadora de
 *  vuelta): el total completo si el método es puro efectivo, la porción
 *  correspondiente si es mixto, o 0 si es puro banco. */
function montoEfectivoRequerido(pago: MetodoPagoValor, totalSiEsSimple: number): number {
  if (pago.metodoPago === "efectivo") return totalSiEsSimple;
  if (pago.metodoPago === "mixto") return pago.montoEfectivo;
  return 0;
}

export function MigaoPage() {
  const { usuario } = useAuth();
  // "Pago administrativo" (no genera ingreso en Caja General) es exclusivo de
  // Root/Super Root — Cajero cobra normal.
  const puedeAdministrativo = tieneAccesoTotal(usuario?.rol);

  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [itemsActivos, setItemsActivos] = useState<ItemActivo[]>([]);
  const [mesasLayout, setMesasLayout] = useState<Mesa[]>([]);
  const [vistaOrdenes, setVistaOrdenes] = useState<"lista" | "plano">("lista");
  const [ordenSeleccionadaId, setOrdenSeleccionadaId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<OrdenDetalle | null>(null);
  const [nombreAbierto, setNombreAbierto] = useState(false);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  // "Pago administrativo": no genera ingreso en Caja General, exclusivo de
  // Root/Super Root. Aparte del selector normal (efectivo/banco/mixto) porque
  // ese tipo se comparte con Caja General, que nunca debe ofrecer esta opción.
  const [esAdministrativo, setEsAdministrativo] = useState(false);
  // % de descuento sobre el total — solo aplica al cobro simple, no a cuenta
  // dividida (ver migao.schema.ts::cerrarOrdenSchema).
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(0);
  // Propina opcional (5%/10%/valor voluntario) sobre el total de la cuenta —
  // a diferencia de descuento, SÍ aplica también a cuenta dividida (se
  // reparte entre las personas solo en pantalla, ver totalPropinaPorParte).
  // 0 = sin propina, null = "otro valor" (propinaMontoCustom).
  const [propinaPorcentaje, setPropinaPorcentaje] = useState<0 | 5 | 10 | null>(0);
  const [propinaMontoCustom, setPropinaMontoCustom] = useState(0);
  // Hasta que el cajero no elija explícitamente "Sin propina" / 5% / 10% /
  // "Otro valor" no se muestra la sumatoria de la cuenta — evita que se cobre
  // de una sin pasar por la pregunta de la propina (ver bloque de Total).
  const [propinaDecidida, setPropinaDecidida] = useState(false);
  // En qué método se recibió la propina — determina de qué "pendiente por
  // repartir" descuenta (ver HistorialPropinasPage, reparto por separado).
  const [propinaMetodoPago, setPropinaMetodoPago] = useState<"efectivo" | "banco">("efectivo");
  // Cuánto dijo el cliente que entregaba en efectivo — solo para calcular la
  // vuelta en pantalla, no se envía al backend (ver CalculadoraVuelta).
  const [montoRecibido, setMontoRecibido] = useState(0);
  // Motor de pagos parciales/cuenta dividida: ya no se puede iniciar desde
  // acá (se quitó el botón "Dividir cuenta") — `cuenta` solo se llena si la
  // orden ya traía uno en marcha de antes (ver seleccionarOrden), para poder
  // terminar de cobrarlo sin dejarlo colgado.
  const [cuenta, setCuenta] = useState<CuentaDetalle | null>(null);
  // Formulario de abono por parte, clave = parte.id — se resincroniza cada
  // vez que cambia `cuenta` (nueva parte creada, o pendiente ya actualizado
  // tras un abono anterior), preservando lo que el cajero ya haya escrito si
  // sigue siendo válido (ver el useEffect más abajo).
  const [abonoForms, setAbonoForms] = useState<
    Record<string, { pago: MetodoPagoValor; montoPagarAhora: number; propina: number; montoRecibido: number }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  // Al cobrar y cerrar, se PREGUNTA si se quiere imprimir la factura (el punto
  // real de uso: la orden todavía "caliente" en el mostrador) — recién si dice
  // que sí se pide la factura y se abre el modal de impresión. No bloquea el
  // cobro si algo falla, solo se le avisa al Cajero.
  const [preguntaFacturaOrdenId, setPreguntaFacturaOrdenId] = useState<string | null>(null);
  const [reciboFactura, setReciboFactura] = useState<ReturnType<typeof facturaAReciboProps> | null>(null);
  const [errorFactura, setErrorFactura] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cobrando, setCobrando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState<"cancelar" | "para-llevar" | null>(null);

  // Aparte del cobro simple de arriba: cobrar solo ALGUNOS productos de la
  // cuenta mientras sigue abierta (se puede seguir agregando) — cada cobro
  // genera su propia venta+factura independiente, sin fijar de antemano
  // cómo queda partida la cuenta. Cantidad por ítem (no solo un checkbox):
  // permite pagar solo PARTE de la cantidad pedida, ej. 1 de 3 limonadas.
  const [cantidadesSeleccionadas, setCantidadesSeleccionadas] = useState<Record<number, number>>({});
  const [modalPagarItemsAbierto, setModalPagarItemsAbierto] = useState(false);
  const [pagoItems, setPagoItems] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [propinaItemsMonto, setPropinaItemsMonto] = useState(0);
  const [montoRecibidoItems, setMontoRecibidoItems] = useState(0);
  const [cobrandoItems, setCobrandoItems] = useState(false);
  const [errorItems, setErrorItems] = useState<string | null>(null);

  // Ref (no state) para que el intervalo de polling, creado una sola vez al montar,
  // siempre lea cuál es la orden seleccionada actual sin necesidad de recrearse.
  const ordenSeleccionadaIdRef = useRef<string | null>(null);
  useEffect(() => {
    ordenSeleccionadaIdRef.current = ordenSeleccionadaId;
  }, [ordenSeleccionadaId]);

  // "Última petición gana": si el sondeo automático (cada 8s) ya había salido
  // justo antes de cobrar una orden, su respuesta puede llegar DESPUÉS del
  // refresco explícito que se dispara al cobrar y pisarlo con datos viejos —
  // la orden recién cerrada seguía viéndose unos segundos más. Con un id que
  // se incrementa en cada llamada, se descarta cualquier respuesta que ya no
  // sea la más reciente, sin importar el orden en que lleguen.
  const ordenesRequestIdRef = useRef(0);

  async function cargarOrdenes() {
    const requestId = ++ordenesRequestIdRef.current;
    try {
      const [ordenesData, itemsData] = await Promise.all([
        migaoApi.listarOrdenesAbiertas(),
        migaoApi.listarItemsActivos(),
      ]);
      if (requestId !== ordenesRequestIdRef.current) return;
      setOrdenes(ordenesData);
      setItemsActivos(itemsData);
    } catch (err) {
      if (requestId === ordenesRequestIdRef.current) {
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar las órdenes");
      }
    } finally {
      if (requestId === ordenesRequestIdRef.current) setLoading(false);
    }

    const ordenSeleccionadaActual = ordenSeleccionadaIdRef.current;
    if (ordenSeleccionadaActual) {
      try {
        const detalleData = await migaoApi.obtenerDetalle(ordenSeleccionadaActual);
        if (requestId === ordenesRequestIdRef.current) setDetalle(detalleData);
      } catch {
        // Si la orden ya no existe (se cerró/canceló desde otro dispositivo), el
        // detalle se deja como estaba; cerrarYCobrar/seleccionarOrden lo limpian.
      }
    }
  }

  async function cargarMesas() {
    try {
      setMesasLayout(await migaoApi.listarMesas());
    } catch {
      /* el plano visual simplemente no aparece, la vista de lista sigue funcionando */
    }
  }

  useEffect(() => {
    cargarOrdenes();
    cargarMesas();
    const intervalo = setInterval(cargarOrdenes, POLL_MS);
    // Las mesas del plano casi no cambian (Root las dibuja una sola vez) — un
    // ciclo bastante más lento que el de las órdenes es suficiente.
    const intervaloMesas = setInterval(cargarMesas, POLL_MS * 8);
    return () => {
      clearInterval(intervalo);
      clearInterval(intervaloMesas);
    };
  }, []);

  useRegistrarRefresco(async () => {
    await Promise.all([cargarOrdenes(), cargarMesas()]);
  });

  function reiniciarDivision() {
    setCuenta(null);
    setAbonoForms({});
  }

  async function seleccionarOrden(ordenId: string) {
    setOrdenSeleccionadaId(ordenId);
    setDetalle(null);
    setMensaje(null);
    setError(null);
    setPago({ metodoPago: "efectivo" });
    setMontoRecibido(0);
    setDescuentoPorcentaje(0);
    setPropinaPorcentaje(0);
    setPropinaMontoCustom(0);
    setPropinaDecidida(false);
    setPropinaMetodoPago("efectivo");
    setEsAdministrativo(false);
    reiniciarDivision();
    setCantidadesSeleccionadas({});
    try {
      const detalleData = await migaoApi.obtenerDetalle(ordenId);
      setDetalle(detalleData);
      // Ya no se puede iniciar un cobro dividido/parcial desde acá, pero si la
      // orden ya traía uno en marcha de antes, se reabre donde se quedó para
      // poder terminar de cobrarlo. 'pagando' también puede venir de
      // pagarItems (productos sueltos) en vez de este motor; ahí simplemente
      // no hay "cuenta" que cargar, se ignora el 404.
      if (detalleData.orden.estado === "pagando") {
        try {
          setCuenta(await migaoApi.obtenerCuenta(ordenId));
        } catch {
          // 'pagando' por productos sueltos (pagarItems) — nada que reabrir acá.
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle de la orden");
    }
  }

  function volverALista() {
    setOrdenSeleccionadaId(null);
    setDetalle(null);
    setError(null);
    setMensaje(null);
  }

  /** Recarga el detalle sin tocar el método de pago ni la división ya elegidos
   *  — a diferencia de seleccionarOrden(), que sí los reinicia porque cambia
   *  de orden. Se usa después de agregar un cargo de "para llevar". */
  async function refrescarDetalle() {
    if (!ordenSeleccionadaId) return;
    try {
      setDetalle(await migaoApi.obtenerDetalle(ordenSeleccionadaId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el detalle de la orden");
    }
  }

  const cantidadTotalSeleccionada = Object.values(cantidadesSeleccionadas).reduce((acc, c) => acc + c, 0);
  const totalSeleccionados = detalle
    ? detalle.items.reduce((acc, i) => {
        const cantidad = cantidadesSeleccionadas[i.id] ?? 0;
        if (cantidad <= 0) return acc;
        return acc + Number(i.precio_unitario) * cantidad;
      }, 0)
    : 0;

  function abrirModalPagarItems() {
    setPagoItems({ metodoPago: "efectivo" });
    setPropinaItemsMonto(0);
    setMontoRecibidoItems(0);
    setErrorItems(null);
    setModalPagarItemsAbierto(true);
  }

  const montoEnEfectivoItems =
    pagoItems.metodoPago === "mixto"
      ? pagoItems.montoEfectivo
      : pagoItems.metodoPago === "efectivo"
        ? totalSeleccionados + propinaItemsMonto
        : 0;
  const faltaMontoRecibidoItems = montoEnEfectivoItems > 0 && montoRecibidoItems < montoEnEfectivoItems;

  async function confirmarPagarItems() {
    if (!ordenSeleccionadaId || cantidadTotalSeleccionada <= 0 || faltaMontoRecibidoItems) return;
    if (
      pagoItems.metodoPago === "mixto" &&
      Math.abs(pagoItems.montoEfectivo + pagoItems.montoBanco - (totalSeleccionados + propinaItemsMonto)) > 0.01
    ) {
      setErrorItems(
        `Entre efectivo y banco deben sumar el total${propinaItemsMonto > 0 ? " con propina incluida" : ""} (${formatMoney(totalSeleccionados + propinaItemsMonto)})`,
      );
      return;
    }
    setCobrandoItems(true);
    setErrorItems(null);
    try {
      const resultado = await migaoApi.pagarItems(ordenSeleccionadaId, {
        unidades: Object.entries(cantidadesSeleccionadas)
          .filter(([, cantidad]) => cantidad > 0)
          .map(([itemId, cantidad]) => ({ itemId: Number(itemId), cantidad })),
        ...pagoItems,
        montoRecibidoEfectivo: montoEnEfectivoItems > 0 ? montoRecibidoItems : undefined,
        ...(propinaItemsMonto > 0 ? { propina: propinaItemsMonto } : {}),
      });
      setModalPagarItemsAbierto(false);
      setCantidadesSeleccionadas({});
      const sufijoAlertas = resultado.alertasInventario.length > 0 ? ` ${resultado.alertasInventario.join(" ")}` : "";
      setMensaje(
        (resultado.ordenCerrada
          ? `Productos cobrados. Total: ${formatMoney(resultado.total)} — la cuenta quedó cerrada.`
          : `Productos cobrados. Total: ${formatMoney(resultado.total)} — la mesa sigue abierta.`) + sufijoAlertas,
      );
      setPreguntaFacturaOrdenId(ordenSeleccionadaId);
      if (resultado.ordenCerrada) {
        setDetalle(null);
        setOrdenSeleccionadaId(null);
      } else {
        await refrescarDetalle();
      }
      await cargarOrdenes();
    } catch (err) {
      setErrorItems(err instanceof ApiError ? err.message : "No se pudo cobrar los productos seleccionados");
    } finally {
      setCobrandoItems(false);
    }
  }

  // El descuento se aplica ANTES de elegir método de pago: el selector y la
  // calculadora de vuelta siempre trabajan contra el total ya descontado.
  const totalConDescuento = detalle ? detalle.total * (1 - descuentoPorcentaje / 100) : 0;
  // Propina: un solo valor sobre el total de la cuenta (ya con descuento
  // aplicado), sin importar si se divide o no — nunca entra a la validación
  // de mixto en la cuenta DIVIDIDA (ahí cada parte sigue sumando solo su
  // propio subtotal) ni al total que ve Caja General, es dinero aparte del
  // mesero. En el cobro SIMPLE mixto sí hay que tenerla en cuenta al validar
  // efectivo+banco (ver pagoMixtoInvalido): lo que el cliente entrega de
  // verdad incluye la propina, el backend ya separa esa parte antes de
  // registrar el ingreso en Caja General (migao.service.ts::calcularTotalesPorMetodo).
  const propinaMonto =
    propinaPorcentaje === 0 ? 0 : propinaPorcentaje === null ? propinaMontoCustom : totalConDescuento * (propinaPorcentaje / 100);

  // La propina se reparte SIEMPRE en la misma proporción efectivo/banco en la
  // que de verdad se pagó la cuenta (lo calcula el backend, ver
  // migao.service.ts::calcularTotalesPorMetodo) — cubre pago simple puro,
  // simple mixto y cuenta dividida con partes de cualquier método. Solo
  // queda a elección manual del cajero cuando es "administrativo": ahí no
  // hay un pago real del que derivar la proporción.
  const propinaEsAutomatica = !esAdministrativo;

  const pagoMixtoInvalido =
    !esAdministrativo &&
    pago.metodoPago === "mixto" &&
    detalle !== null &&
    Math.abs(pago.montoEfectivo + pago.montoBanco - (totalConDescuento + propinaMonto)) > 0.01;

  // Cuánto de este cobro va en efectivo de verdad — mismo cálculo que el
  // `aPagar` de la CalculadoraVuelta de abajo, reutilizado acá para poder
  // exigir "Recibí" antes de dejar cobrar (backend también lo valida, ver
  // migao.service.ts::exigirMontoRecibidoEfectivo).
  const montoEnEfectivoSimple =
    esAdministrativo || pago.metodoPago === "banco"
      ? 0
      : pago.metodoPago === "mixto"
        ? pago.montoEfectivo
        : montoEfectivoRequerido(pago, totalConDescuento) + propinaMonto;
  const faltaMontoRecibido = montoEnEfectivoSimple > 0 && montoRecibido < montoEnEfectivoSimple;

  /** Trae la factura recién generada y la ofrece para imprimir de una vez —
   *  si falla, solo se avisa aparte, nunca deshace el cobro (ya se cerró). */
  async function abrirFacturaTrasCobro(ordenId: string) {
    try {
      const factura = await migaoApi.obtenerFactura(ordenId);
      setReciboFactura(facturaAReciboProps(factura));
      setErrorFactura(null);
    } catch (err) {
      setErrorFactura(err instanceof ApiError ? err.message : "No se pudo generar la factura para imprimir");
    }
  }

  async function cerrarYCobrar() {
    if (!ordenSeleccionadaId || pagoMixtoInvalido || faltaMontoRecibido) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      const pagoConRecibido = esAdministrativo
        ? ({ metodoPago: "administrativo" } as const)
        : { ...pago, montoRecibidoEfectivo: montoEnEfectivoSimple > 0 ? montoRecibido : undefined };
      const resultado = await migaoApi.cerrarOrden(
        ordenSeleccionadaId,
        pagoConRecibido,
        descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
        propinaMonto > 0 ? { propina: propinaMonto, propinaPorcentaje, propinaMetodoPago } : undefined,
      );
      const sufijoAlertas =
        resultado.alertasInventario.length > 0 ? ` ${resultado.alertasInventario.join(" ")}` : "";
      setMensaje(`Orden cobrada y cerrada. Total: ${formatMoney(resultado.total)}${sufijoAlertas}`);
      setPreguntaFacturaOrdenId(ordenSeleccionadaId);
      setDetalle(null);
      setOrdenSeleccionadaId(null);
      await cargarOrdenes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la orden");
    } finally {
      setCobrando(false);
    }
  }

  // Ya no se puede iniciar desde acá (se quitó "Dividir cuenta"/"Pago
  // parcial") — solo queda true si la orden ya traía un cobro de este tipo
  // en marcha de antes (ver seleccionarOrden), para poder terminarlo.
  const usarMotorNuevo = cuenta !== null;

  // Se resincroniza cada vez que cambia `cuenta` (partes recién creadas, o
  // pendiente ya actualizado tras un abono) — conserva lo que el cajero ya
  // haya escrito si sigue siendo válido (no supera el nuevo pendiente); si
  // no, prellena con el pendiente completo y la propina repartida por igual
  // (atajo por defecto, sigue editable por abono).
  useEffect(() => {
    if (!cuenta) return;
    setAbonoForms((actual) => {
      const nuevo: typeof actual = {};
      const propinaPorParte = cuenta.partes.length > 0 ? Math.round((propinaMonto / cuenta.partes.length) * 100) / 100 : 0;
      for (const parte of cuenta.partes) {
        const previo = actual[parte.id];
        nuevo[parte.id] =
          previo && previo.montoPagarAhora <= parte.pendiente
            ? previo
            : { pago: { metodoPago: "efectivo" }, montoPagarAhora: parte.pendiente, propina: propinaPorParte, montoRecibido: 0 };
      }
      return nuevo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuenta]);

  function actualizarAbonoForm(
    parteId: string,
    cambios: Partial<{ pago: MetodoPagoValor; montoPagarAhora: number; propina: number; montoRecibido: number }>,
  ) {
    setAbonoForms((actual) => ({ ...actual, [parteId]: { ...actual[parteId], ...cambios } }));
  }

  /** Atajo: reparte la propina total elegida arriba por igual entre TODAS las
   *  partes — solo prellena, cada abono la sigue pudiendo editar después. */
  function repartirPropinaIgual() {
    if (!cuenta || cuenta.partes.length === 0) return;
    const porParte = Math.round((propinaMonto / cuenta.partes.length) * 100) / 100;
    setAbonoForms((actual) => {
      const nuevo = { ...actual };
      for (const parte of cuenta.partes) nuevo[parte.id] = { ...nuevo[parte.id], propina: porParte };
      return nuevo;
    });
  }

  /** Atajo: le asigna la propina COMPLETA a una sola parte, deja las demás en 0. */
  function asignarPropinaCompletaA(parteId: string) {
    if (!cuenta) return;
    setAbonoForms((actual) => {
      const nuevo = { ...actual };
      for (const parte of cuenta.partes) nuevo[parte.id] = { ...nuevo[parte.id], propina: parte.id === parteId ? propinaMonto : 0 };
      return nuevo;
    });
  }

  const algunAbonoMixtoInvalido = cuenta
    ? cuenta.partes.some((parte) => {
        const form = abonoForms[parte.id];
        if (!form || form.pago.metodoPago !== "mixto") return false;
        return Math.abs(form.pago.montoEfectivo + form.pago.montoBanco - (form.montoPagarAhora + form.propina)) > 0.01;
      })
    : false;
  const totalAPagarAhora = Object.values(abonoForms).reduce((acc, f) => acc + f.montoPagarAhora, 0);

  // Mismo cálculo que el `aPagar` de la CalculadoraVuelta de cada parte, para
  // poder exigir "Recibí" antes de dejar registrar el/los abono(s).
  function montoEnEfectivoDeAbono(form: { pago: MetodoPagoValor; montoPagarAhora: number; propina: number }) {
    if (form.pago.metodoPago === "banco") return 0;
    if (form.pago.metodoPago === "mixto") return form.pago.montoEfectivo;
    return montoEfectivoRequerido(form.pago, form.montoPagarAhora) + form.propina;
  }
  const algunAbonoSinMontoRecibido = cuenta
    ? cuenta.partes.some((parte) => {
        const form = abonoForms[parte.id];
        if (!form || form.montoPagarAhora <= 0) return false;
        const montoEnEfectivo = montoEnEfectivoDeAbono(form);
        return montoEnEfectivo > 0 && form.montoRecibido < montoEnEfectivo;
      })
    : false;

  /** Registra un abono por cada parte que tenga algo que pagar ahora — puede
   *  ser el pago completo de todas (cierra la orden) o parcial de alguna(s)
   *  (la orden queda en 'pagando' hasta el próximo abono). */
  async function registrarPagos() {
    if (!ordenSeleccionadaId || !cuenta || algunAbonoSinMontoRecibido) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      let cuentaActual = cuenta;
      for (const parte of cuenta.partes) {
        const form = abonoForms[parte.id];
        if (!form || form.montoPagarAhora <= 0) continue;
        const propinaInput = form.propina > 0 ? { monto: form.propina, porcentaje: propinaPorcentaje } : undefined;
        const montoEnEfectivo = montoEnEfectivoDeAbono(form);
        const montoRecibidoEfectivo = montoEnEfectivo > 0 ? form.montoRecibido : undefined;
        const input: RegistrarAbonoInput =
          form.pago.metodoPago === "mixto"
            ? {
                metodoPago: "mixto",
                montoEfectivo: form.pago.montoEfectivo,
                montoBanco: form.pago.montoBanco,
                propina: propinaInput,
                montoRecibidoEfectivo,
              }
            : { metodoPago: form.pago.metodoPago, monto: form.montoPagarAhora, propina: propinaInput, montoRecibidoEfectivo };
        cuentaActual = await migaoApi.registrarAbono(parte.id, input);
      }
      setCuenta(cuentaActual);
      if (cuentaActual.ordenEstado === "cerrada") {
        const alertas = cuentaActual.alertasInventario ?? [];
        const sufijoAlertas = alertas.length > 0 ? ` ${alertas.join(" ")}` : "";
        setMensaje(`Orden cobrada y cerrada. Total: ${formatMoney(Number(cuentaActual.venta.total))}${sufijoAlertas}`);
        setPreguntaFacturaOrdenId(ordenSeleccionadaId);
        setDetalle(null);
        setOrdenSeleccionadaId(null);
        reiniciarDivision();
      } else {
        const pendienteTotal = cuentaActual.partes.reduce((acc, p) => acc + p.pendiente, 0);
        setMensaje(`Quedó pendiente ${formatMoney(pendienteTotal)} — la mesa sigue abierta hasta completarlo.`);
      }
      await cargarOrdenes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el pago");
    } finally {
      setCobrando(false);
    }
  }

  const ordenActual = ordenes.find((o) => o.id === ordenSeleccionadaId);
  const mostrarCobro = ordenSeleccionadaId !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Caja Migao</h1>
          {puedeAdministrativo && !mostrarCobro && (
            <>
              <Link
                to="/migao/historial"
                className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              >
                🧾 Historial
              </Link>
              <Link
                to="/migao/propinas"
                className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              >
                💵 Propinas
              </Link>
            </>
          )}
        </div>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Cobro de mesas/órdenes. Cerrar o cancelar una orden es una acción exclusiva del rol Cajero.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}
      {errorFactura && <p className="text-sm text-amber-700 dark:text-amber-400">⚠ {errorFactura}</p>}

      {!mostrarCobro ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-brand-green-700 dark:text-brand-vanilla">
              Órdenes abiertas {ordenes.length > 0 && <span className="text-brand-ink/50">({ordenes.length})</span>}
            </h2>
            <div className="flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
              {(["lista", "plano"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVistaOrdenes(v)}
                  className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors ${
                    vistaOrdenes === v
                      ? "bg-brand-green-600 text-white"
                      : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
              Cargando...
            </p>
          ) : vistaOrdenes === "plano" ? (
            <div className="flex flex-col gap-6">
              {AREAS_MESA.map((area) => (
                <div
                  key={area.valor}
                  className={`flex flex-col gap-2 rounded-lg border-l-8 p-2 ${area.colorBorde} ${area.colorFondo}`}
                >
                  <h3 className={`text-base font-bold ${area.colorTexto}`}>
                    <span aria-hidden>{area.icon}</span> {area.label}
                  </h3>
                  <FloorPlanCanvas
                    mesas={combinarMesasConOrdenes(
                      mesasLayout.filter((m) => m.piso === area.valor && m.activo),
                      ordenes,
                    )}
                    modo="ver"
                    onSeleccionar={(_mesa, orden) => orden && seleccionarOrden(orden.id)}
                  />
                </div>
              ))}
            </div>
          ) : ordenes.length === 0 ? (
            <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
              No hay órdenes abiertas.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ordenes.map((o) => {
                const estadoCocina = estadoAgregadoOrden(o.id, itemsActivos);
                const area = areaDeMesa(o.mesa_piso);
                return (
                  <button
                    key={o.id}
                    onClick={() => seleccionarOrden(o.id)}
                    className={`rounded-lg p-4 text-left transition-colors hover:brightness-95 dark:hover:brightness-125 ${
                      estadoCocina
                        ? BORDE_POR_ESTADO[estadoCocina]
                        : area
                          ? `border-4 ${area.colorBorde}`
                          : "border-2 border-brand-vanilla-dark dark:border-brand-green-700"
                    } ${area?.colorFondo ?? ""}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-lg font-semibold text-brand-ink dark:text-brand-vanilla">
                        Mesa {o.mesa_numero ?? "—"}
                        {area && <span className={`text-sm font-bold ${area.colorTexto}`}> ({area.label})</span>}
                        {o.nombre && (
                          <span className="ml-1 text-sm font-semibold italic text-brand-green-700 dark:text-brand-vanilla">
                            "{o.nombre}"
                          </span>
                        )}
                      </div>
                      {estadoCocina && (
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${BADGE_POR_ESTADO[estadoCocina]}`}
                        >
                          {ETIQUETA_POR_ESTADO[estadoCocina]}
                        </span>
                      )}
                    </div>
                    {o.estado === "pagando" && (
                      <div className="mt-1 inline-block rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                        Pago parcial — falta {formatMoney(o.pendiente_cobro)}
                      </div>
                    )}
                    <div className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                      {o.mesero_nombre && <span>Mesero: {o.mesero_nombre} · </span>}
                      {o.cliente_nombre && <span>Cliente: {o.cliente_nombre} · </span>}
                      Total {formatMoney(o.total)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <button
            onClick={volverALista}
            className="self-start text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ← Volver a órdenes
          </button>

          <h2 className="-mt-2 flex items-center gap-2 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            <span>
              {ordenActual ? `Mesa ${ordenActual.mesa_numero ?? "—"}` : "Cobro"}
              {ordenActual?.mesero_nombre && (
                <span className="ml-2 text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                  Mesero: {ordenActual.mesero_nombre}
                </span>
              )}
              {ordenActual?.nombre && (
                <span className="ml-2 text-sm font-semibold italic text-brand-green-700 dark:text-brand-vanilla">
                  "{ordenActual.nombre}"
                </span>
              )}
            </span>
            {ordenActual && (
              <button
                onClick={() => setNombreAbierto(true)}
                aria-label="Editar nombre de la cuenta"
                title="Editar nombre de la cuenta"
                className="rounded-md px-1.5 py-1 text-sm text-brand-ink/60 hover:bg-brand-green-50 dark:text-brand-vanilla/60 dark:hover:bg-brand-green-700/40"
              >
                ✏️
              </button>
            )}
          </h2>

          {!detalle ? (
            <p className="text-sm text-brand-ink/60">Cargando detalle...</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {detalle.items.map((item) => {
                  const cobrable = item.estado !== "cancelado" && !item.venta_id;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-3 ${
                        item.es_para_llevar
                          ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/20"
                          : "border-brand-vanilla-dark dark:border-brand-green-700"
                      }`}
                    >
                      {cobrable && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setCantidadesSeleccionadas((actual) => {
                                const nueva = Math.max(0, (actual[item.id] ?? 0) - 1);
                                const copia = { ...actual };
                                if (nueva <= 0) delete copia[item.id];
                                else copia[item.id] = nueva;
                                return copia;
                              })
                            }
                            disabled={(cantidadesSeleccionadas[item.id] ?? 0) <= 0}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-vanilla-dark text-base font-bold leading-none text-brand-ink disabled:opacity-30 dark:border-brand-green-700 dark:text-brand-vanilla"
                            aria-label={`Quitar una unidad de ${item.producto_nombre} de la selección`}
                          >
                            −
                          </button>
                          <span className="w-5 text-center text-sm font-semibold tabular-nums text-brand-ink dark:text-brand-vanilla">
                            {cantidadesSeleccionadas[item.id] ?? 0}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCantidadesSeleccionadas((actual) => ({
                                ...actual,
                                [item.id]: Math.min(Number(item.cantidad), (actual[item.id] ?? 0) + 1),
                              }))
                            }
                            disabled={(cantidadesSeleccionadas[item.id] ?? 0) >= Number(item.cantidad)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-vanilla-dark text-base font-bold leading-none text-brand-ink disabled:opacity-30 dark:border-brand-green-700 dark:text-brand-vanilla"
                            aria-label={`Agregar una unidad de ${item.producto_nombre} a la selección`}
                          >
                            +
                          </button>
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="text-base font-medium text-brand-ink dark:text-brand-vanilla">
                          {item.es_para_llevar && "🥡 "}
                          {formatCantidad(item.cantidad)}× {item.producto_nombre}
                        </div>
                        <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                          {formatMoney(item.precio_unitario)} c/u
                        </div>
                        {item.observaciones && (
                          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                            ⚠ {item.observaciones}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {item.venta_id ? (
                          <span className="rounded-full bg-brand-green-600 px-2 py-0.5 text-xs font-bold text-white">
                            ✓ Pagado
                          </span>
                        ) : (
                          <EstadoBadge estado={item.estado} />
                        )}
                        <span className="text-base font-semibold text-brand-ink dark:text-brand-vanilla">
                          {formatMoney(item.subtotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {cantidadTotalSeleccionada > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-brand-green-600 bg-brand-green-50 px-3 py-2 dark:bg-brand-green-700/20">
                  <span className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">
                    {cantidadTotalSeleccionada} unidad{cantidadTotalSeleccionada === 1 ? "" : "es"} seleccionada
                    {cantidadTotalSeleccionada === 1 ? "" : "s"} — {formatMoney(totalSeleccionados)}
                  </span>
                  <button
                    onClick={abrirModalPagarItems}
                    className="rounded-md bg-brand-green-700 px-3 py-1.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
                  >
                    Cobrar seleccionados
                  </button>
                </div>
              )}

              {cuenta ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  Esta cuenta ya tiene un cobro en marcha — no se pueden agregar más productos.
                </p>
              ) : (
                <button
                  onClick={() => setModalAbierto("para-llevar")}
                  className="w-full rounded-md border border-amber-400 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
                >
                  🥡 Agregar para llevar
                </button>
              )}

              {detalle.items.some((i) => i.estado === "pendiente" || i.estado === "preparando") && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  Todavía hay productos en cocina sin terminar.
                </p>
              )}

              {propinaDecidida ? (
                <div className="flex flex-col gap-2 rounded-lg bg-brand-green-50 px-4 py-3 dark:bg-brand-green-700/20">
                  {descuentoPorcentaje > 0 && (
                    <div className="flex items-center justify-between text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                      <span>Sin descuento</span>
                      <span className="line-through">{formatMoney(detalle.total)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-brand-ink dark:text-brand-vanilla">Total</span>
                    <span className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                      {formatMoney(totalConDescuento)}
                    </span>
                  </div>
                  {propinaMonto > 0 && (
                    <>
                      <div className="flex items-center justify-between text-sm text-brand-green-700 dark:text-brand-vanilla">
                        <span>+ Propina{propinaPorcentaje ? ` (${propinaPorcentaje}%)` : ""}</span>
                        <span className="font-semibold">{formatMoney(propinaMonto)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-brand-green-600/30 pt-2 dark:border-brand-vanilla/30">
                        <span className="text-base font-medium text-brand-ink dark:text-brand-vanilla">
                          Total a cobrar
                        </span>
                        <span className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                          {formatMoney(totalConDescuento + propinaMonto)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="rounded-lg bg-brand-green-50 px-4 py-3 text-sm text-brand-ink/70 dark:bg-brand-green-700/20 dark:text-brand-vanilla/70">
                  Elige abajo si hay propina o no para ver el total de la cuenta.
                </p>
              )}

              <div className="flex items-center gap-2">
                <label className="text-sm text-brand-ink dark:text-brand-vanilla">Descuento %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={descuentoPorcentaje || ""}
                  onChange={(e) => setDescuentoPorcentaje(Math.min(100, Math.max(0, Number(e.target.value))))}
                  placeholder="0"
                  className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm text-brand-ink dark:text-brand-vanilla">¿Agregar propina (servicio)?</span>
                <div className="flex flex-wrap gap-2">
                  {([0, 5, 10] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setPropinaPorcentaje(p);
                        setPropinaDecidida(true);
                      }}
                      className={`rounded-md border-2 px-3 py-1.5 text-sm font-medium ${
                        propinaPorcentaje === p
                          ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                          : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
                      }`}
                    >
                      {p === 0 ? "Sin propina" : `${p}%`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setPropinaPorcentaje(null);
                      setPropinaDecidida(true);
                    }}
                    className={`rounded-md border-2 px-3 py-1.5 text-sm font-medium ${
                      propinaPorcentaje === null
                        ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                        : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
                    }`}
                  >
                    Otro valor
                  </button>
                </div>
                {propinaPorcentaje === null && (
                  <input
                    type="number"
                    min={0}
                    step="100"
                    autoFocus
                    value={propinaMontoCustom || ""}
                    onChange={(e) => setPropinaMontoCustom(Math.max(0, Number(e.target.value)))}
                    placeholder="Valor de la propina"
                    className="w-40 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                  />
                )}
                {propinaMonto > 0 &&
                  (propinaEsAutomatica ? (
                    // Se reparte sola según cómo se pague la cuenta (efectivo/banco/mixto/
                    // dividida) — nada que elegir acá, lo calcula el backend.
                    <p className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                      La propina se reparte según el método de pago de la cuenta.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                        Pago administrativo — ¿en qué se recibió la propina?
                      </span>
                      {(["efectivo", "banco"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPropinaMetodoPago(m)}
                          className={`rounded-md border-2 px-2 py-1 text-xs font-medium capitalize ${
                            propinaMetodoPago === m
                              ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                              : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ))}
              </div>

              {!usarMotorNuevo ? (
                <>
                  {puedeAdministrativo && (
                    <label className="flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
                      <input
                        type="checkbox"
                        checked={esAdministrativo}
                        onChange={(e) => setEsAdministrativo(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Pago administrativo (no cuenta en Caja General)
                    </label>
                  )}

                  {esAdministrativo ? (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                      ⚠ Esta cuenta no generará ingreso en Caja General — solo queda en el historial administrativo.
                    </p>
                  ) : (
                    <>
                      <label className="-mb-2 block text-xs font-medium">Método de pago</label>
                      {propinaMonto > 0 && pago.metodoPago === "mixto" && (
                        <p className="-mb-2 text-xs text-amber-700 dark:text-amber-400">
                          Incluye la propina: entre efectivo y banco deben sumar {formatMoney(totalConDescuento + propinaMonto)}.
                        </p>
                      )}
                      <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={totalConDescuento + propinaMonto} />

                      {pago.metodoPago !== "banco" && (
                        <>
                          <CalculadoraVuelta aPagar={montoEnEfectivoSimple} recibido={montoRecibido} onChange={setMontoRecibido} />
                          {faltaMontoRecibido && (
                            <p className="-mt-1 text-xs text-red-600">
                              Escribe cuánto te dio el cliente en efectivo para poder cerrar la cuenta.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}

                  <button
                    onClick={cerrarYCobrar}
                    disabled={cobrando || pagoMixtoInvalido || faltaMontoRecibido}
                    className="w-full rounded-md bg-brand-green-700 px-3 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                  >
                    {cobrando ? "Cobrando..." : "Cobrar y cerrar orden"}
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-4 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
                  {cuenta && (
                    <>
                      {cuenta.partes.length > 1 && propinaMonto > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-brand-ink/70 dark:text-brand-vanilla/70">Propina:</span>
                          <button
                            type="button"
                            onClick={repartirPropinaIgual}
                            className="rounded-md border border-brand-green-700 px-2 py-1 font-medium text-brand-green-700 dark:border-brand-vanilla dark:text-brand-vanilla"
                          >
                            Repartir por igual
                          </button>
                        </div>
                      )}

                      {cuenta.partes.map((parte) => {
                        const form = abonoForms[parte.id];
                        return (
                          <div
                            key={parte.id}
                            className="flex flex-col gap-2 border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                                Parte {parte.indice}
                                {parte.modo === "producto" && parte.unidades.length > 0 && (
                                  <span className="ml-1 text-xs font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                                    ({parte.unidades.map((u) => `${formatCantidad(u.cantidad)}× ${u.productoNombre}`).join(", ")})
                                  </span>
                                )}
                              </span>
                              <span className="text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
                                {formatMoney(parte.montoDebido)}
                                {parte.montoPagado > 0 && (
                                  <span className="ml-1 text-xs font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                                    (pagado {formatMoney(parte.montoPagado)})
                                  </span>
                                )}
                              </span>
                            </div>

                            {parte.pendiente <= 0.001 || !form ? (
                              <p className="text-xs font-medium text-brand-green-700 dark:text-brand-vanilla">
                                ✓ Pagada por completo
                              </p>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                                    ¿Cuánto se paga ahora?
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={parte.pendiente}
                                    step="100"
                                    value={form.montoPagarAhora || ""}
                                    onChange={(e) =>
                                      actualizarAbonoForm(parte.id, {
                                        montoPagarAhora: Math.min(parte.pendiente, Math.max(0, Number(e.target.value))),
                                      })
                                    }
                                    className="w-32 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 disabled:opacity-60 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                                  />
                                  <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                                    de {formatMoney(parte.pendiente)} pendiente
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                                    Propina de este abono
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step="100"
                                    value={form.propina || ""}
                                    onChange={(e) => actualizarAbonoForm(parte.id, { propina: Math.max(0, Number(e.target.value)) })}
                                    className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                                  />
                                  {cuenta.partes.length > 1 && propinaMonto > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => asignarPropinaCompletaA(parte.id)}
                                      className="text-xs font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
                                    >
                                      Asignar propina completa aquí
                                    </button>
                                  )}
                                </div>

                                <SelectorMetodoPago
                                  value={form.pago}
                                  onChange={(nuevo) => actualizarAbonoForm(parte.id, { pago: nuevo })}
                                  totalFijo={form.montoPagarAhora + form.propina}
                                />
                                {form.pago.metodoPago !== "banco" && (
                                  <>
                                    <CalculadoraVuelta
                                      aPagar={montoEnEfectivoDeAbono(form)}
                                      recibido={form.montoRecibido}
                                      onChange={(valor) => actualizarAbonoForm(parte.id, { montoRecibido: valor })}
                                    />
                                    {montoEnEfectivoDeAbono(form) > 0 && form.montoRecibido < montoEnEfectivoDeAbono(form) && (
                                      <p className="text-xs text-red-600">
                                        Escribe cuánto te dio el cliente en efectivo para poder registrar este abono.
                                      </p>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}

                      {algunAbonoMixtoInvalido && (
                        <p className="text-xs text-red-600">Alguna parte mixta no cuadra con su monto + propina.</p>
                      )}

                      <button
                        onClick={registrarPagos}
                        disabled={cobrando || algunAbonoMixtoInvalido || algunAbonoSinMontoRecibido || totalAPagarAhora <= 0}
                        className="w-full rounded-md bg-brand-green-700 px-3 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                      >
                        {cobrando ? "Cobrando..." : "Registrar pago(s)"}
                      </button>
                    </>
                  )}
                </div>
              )}

              <button
                onClick={() => setModalAbierto("cancelar")}
                disabled={cobrando}
                className="w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                Cancelar orden (cliente ya no quiere pedir)
              </button>
            </>
          )}
        </div>
      )}

      {modalAbierto === "cancelar" && ordenSeleccionadaId && (
        <CancelarOrdenModal
          ordenId={ordenSeleccionadaId}
          onCerrar={() => setModalAbierto(null)}
          onCancelada={async (mensajeCancelacion) => {
            setMensaje(mensajeCancelacion);
            setDetalle(null);
            setOrdenSeleccionadaId(null);
            await cargarOrdenes();
          }}
        />
      )}

      {nombreAbierto && ordenActual && (
        <EditarNombreOrdenModal
          ordenId={ordenActual.id}
          nombreActual={ordenActual.nombre}
          onCerrar={() => setNombreAbierto(false)}
          onGuardado={cargarOrdenes}
        />
      )}

      {modalPagarItemsAbierto && (
        <Modal titulo="Cobrar productos seleccionados" onCerrar={() => setModalPagarItemsAbierto(false)}>
          <div className="mb-3 flex items-center justify-between text-lg font-bold text-brand-green-700 dark:text-brand-vanilla">
            <span>Total ({cantidadTotalSeleccionada} unidad{cantidadTotalSeleccionada === 1 ? "" : "es"})</span>
            <span>{formatMoney(totalSeleccionados)}</span>
          </div>

          <label className="mb-1 block text-xs font-medium">Propina (opcional)</label>
          <input
            type="number"
            min={0}
            step="100"
            value={propinaItemsMonto || ""}
            onChange={(e) => setPropinaItemsMonto(Math.max(0, Number(e.target.value)))}
            placeholder="0"
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          <label className="mb-1 block text-xs font-medium">Método de pago</label>
          <div className="mb-3">
            <SelectorMetodoPago value={pagoItems} onChange={setPagoItems} totalFijo={totalSeleccionados + propinaItemsMonto} />
          </div>

          {pagoItems.metodoPago !== "banco" && (
            <div className="mb-3">
              <CalculadoraVuelta aPagar={montoEnEfectivoItems} recibido={montoRecibidoItems} onChange={setMontoRecibidoItems} />
              {faltaMontoRecibidoItems && (
                <p className="mt-1 text-xs text-red-600">Escribe cuánto te dio el cliente en efectivo para poder cobrar.</p>
              )}
            </div>
          )}

          {errorItems && <p className="mb-3 text-sm text-red-600">{errorItems}</p>}

          <button
            onClick={confirmarPagarItems}
            disabled={cobrandoItems || faltaMontoRecibidoItems}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {cobrandoItems ? "Cobrando..." : "Cobrar y generar factura"}
          </button>
        </Modal>
      )}

      {modalAbierto === "para-llevar" && ordenSeleccionadaId && (
        <AgregarParaLlevarModal
          ordenId={ordenSeleccionadaId}
          onCerrar={() => setModalAbierto(null)}
          onAgregado={refrescarDetalle}
        />
      )}

      {preguntaFacturaOrdenId && (
        <Modal titulo="Orden cobrada" onCerrar={() => setPreguntaFacturaOrdenId(null)}>
          <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">¿Deseas imprimir la factura de esta orden?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPreguntaFacturaOrdenId(null)}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-2.5 text-sm font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            >
              No, gracias
            </button>
            <button
              onClick={async () => {
                const ordenId = preguntaFacturaOrdenId;
                setPreguntaFacturaOrdenId(null);
                await abrirFacturaTrasCobro(ordenId);
              }}
              className="flex-1 rounded-md bg-brand-green-700 px-4 py-2.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
            >
              Sí, imprimir
            </button>
          </div>
        </Modal>
      )}

      {reciboFactura && <ModalImprimir {...reciboFactura} onCerrar={() => setReciboFactura(null)} />}
    </div>
  );
}
