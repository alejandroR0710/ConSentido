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
  type DivisionInput,
  type ItemActivo,
  type Mesa,
  type OrdenDetalle,
  type OrdenResumen,
  type RegistrarAbonoInput,
} from "../api";
import { AREAS_MESA, labelArea } from "../areas";
import { AgregarParaLlevarModal } from "../components/AgregarParaLlevarModal";
import { CancelarOrdenModal } from "../components/CancelarOrdenModal";
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
  // En qué método se recibió la propina — determina de qué "pendiente por
  // repartir" descuenta (ver HistorialPropinasPage, reparto por separado).
  const [propinaMetodoPago, setPropinaMetodoPago] = useState<"efectivo" | "banco">("efectivo");
  // Cuánto dijo el cliente que entregaba en efectivo — solo para calcular la
  // vuelta en pantalla, no se envía al backend (ver CalculadoraVuelta).
  const [montoRecibido, setMontoRecibido] = useState(0);
  const [dividirCuenta, setDividirCuenta] = useState(false);
  const [numPartes, setNumPartes] = useState(2);
  // itemId (de orden_items) -> índice de parte (0-based) a la que quedó asignado.
  // Clave por UNIDAD de producto (no por ítem): un ítem con cantidad 2 genera
  // dos claves asignables por separado, para poder repartir "2x Americano"
  // entre dos personas en vez de mandarlo entero a una sola.
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({});
  // Motor NUEVO y aparte del cobro simple de arriba: pagos parciales y/o
  // cuenta dividida por igual (no solo por producto). "Dividir cuenta" y
  // "Pago parcial" se pueden combinar — cualquiera de los dos activa este
  // motor, que trata una cuenta sin dividir como 1 sola "parte".
  const [pagoParcial, setPagoParcial] = useState(false);
  const [modoDivisionCuenta, setModoDivisionCuenta] = useState<"producto" | "igual">("producto");
  const [cuenta, setCuenta] = useState<CuentaDetalle | null>(null);
  const [iniciandoCobro, setIniciandoCobro] = useState(false);
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
    setDividirCuenta(false);
    setNumPartes(2);
    setAsignaciones({});
    setModoDivisionCuenta("producto");
    setPagoParcial(false);
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
    setPropinaMetodoPago("efectivo");
    setEsAdministrativo(false);
    reiniciarDivision();
    try {
      const detalleData = await migaoApi.obtenerDetalle(ordenId);
      setDetalle(detalleData);
      // La orden ya tenía un cobro en marcha (motor nuevo) — se reabre donde
      // se quedó, en vez de ofrecer el formulario de cobro desde cero.
      if (detalleData.orden.estado === "pagando") {
        setPagoParcial(true);
        const cuentaCargada = await migaoApi.obtenerCuenta(ordenId);
        setCuenta(cuentaCargada);
        if (cuentaCargada.partes.length > 1) setDividirCuenta(true);
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
    if (!ordenSeleccionadaId || pagoMixtoInvalido) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      const resultado = await migaoApi.cerrarOrden(
        ordenSeleccionadaId,
        esAdministrativo ? { metodoPago: "administrativo" } : pago,
        descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
        propinaMonto > 0 ? { propina: propinaMonto, propinaPorcentaje, propinaMetodoPago } : undefined,
      );
      setMensaje(`Orden cobrada y cerrada. Total: ${formatMoney(resultado.total)}`);
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

  // Una unidad por cada unidad física del producto: "2x Americano" (cantidad
  // entera > 1) se parte en 2 filas de 1 unidad cada una, asignables por
  // separado. Cantidades no enteras (poco comunes en Migao) se dejan como una
  // sola fila — no tiene sentido partir "1.5" en unidades discretas.
  const unidadesCobrables = detalle
    ? detalle.items
        .filter((i) => i.estado !== "cancelado")
        .flatMap((item) => {
          const cantidad = Number(item.cantidad);
          const precioUnitario = Number(item.precio_unitario);
          if (Number.isInteger(cantidad) && cantidad > 1) {
            return Array.from({ length: cantidad }, (_, idx) => ({
              key: `${item.id}-${idx}`,
              itemId: item.id,
              productoNombre: item.producto_nombre,
              cantidadUnidad: 1,
              subtotalUnidad: precioUnitario,
            }));
          }
          return [
            {
              key: `${item.id}-0`,
              itemId: item.id,
              productoNombre: item.producto_nombre,
              cantidadUnidad: cantidad,
              subtotalUnidad: item.subtotal,
            },
          ];
        })
    : [];
  const todosAsignados =
    unidadesCobrables.length > 0 && unidadesCobrables.every((u) => asignaciones[u.key] !== undefined);

  // Por producto, no tiene sentido tener más partes que unidades cobrables
  // (cada parte necesita al menos 1 unidad); por igual no hay esa relación,
  // el tope es solo el que ya valida el backend (iniciarCobroSchema).
  const MAX_PARTES_IGUAL = 20;
  function topeNumPartes() {
    return modoDivisionCuenta === "igual" ? MAX_PARTES_IGUAL : Math.max(2, unidadesCobrables.length);
  }

  function cambiarNumPartes(n: number) {
    const nuevo = Math.min(topeNumPartes(), Math.max(2, n));
    setNumPartes(nuevo);
    // Las unidades que quedaron asignadas a una parte que ya no existe vuelven a quedar sin asignar.
    setAsignaciones((actual) => {
      const copia: Record<string, number> = {};
      for (const [key, parteIdx] of Object.entries(actual)) {
        if (parteIdx < nuevo) copia[key] = parteIdx;
      }
      return copia;
    });
  }

  /** Al activar "Dividir cuenta", arranca en tantas partes como comensales se
   *  registraron al crear la orden (numero_personas) — no siempre en 2 —
   *  ajustado a los límites válidos (mínimo 2, máximo una por unidad cobrable). */
  function activarDivision() {
    const personasRegistradas = detalle?.orden.numero_personas ?? 0;
    const partesIniciales = Math.min(
      Math.max(2, personasRegistradas || 2),
      Math.max(2, unidadesCobrables.length),
    );
    cambiarNumPartes(partesIniciales);
    setDividirCuenta(true);
  }

  function subtotalParte(parteIdx: number) {
    return unidadesCobrables
      .filter((u) => asignaciones[u.key] === parteIdx)
      .reduce((acc, u) => acc + u.subtotalUnidad, 0);
  }

  /** Agrupa las unidades de una parte por itemId (una parte puede llevarse
   *  más de una unidad del mismo producto), para mandarle al backend cuánta
   *  cantidad de cada ítem le corresponde. */
  function unidadesAsignadasAParte(parteIdx: number) {
    const porItem = new Map<number, number>();
    for (const u of unidadesCobrables) {
      if (asignaciones[u.key] === parteIdx) {
        porItem.set(u.itemId, (porItem.get(u.itemId) ?? 0) + u.cantidadUnidad);
      }
    }
    return Array.from(porItem.entries()).map(([itemId, cantidad]) => ({ itemId, cantidad }));
  }

  // "Dividir cuenta" y/o "Pago parcial" activan el motor nuevo — una cuenta
  // sin dividir es, para él, una división de 1 sola parte.
  const usarMotorNuevo = dividirCuenta || pagoParcial;

  function construirDivisionInput(): DivisionInput {
    if (!dividirCuenta) return { modo: "igual", numPartes: 1 };
    if (modoDivisionCuenta === "igual") return { modo: "igual", numPartes };
    return {
      modo: "producto",
      partes: Array.from({ length: numPartes }, (_, idx) => ({ unidades: unidadesAsignadasAParte(idx) })),
    };
  }

  /** Fija cómo queda partida la cuenta y crea la venta+factura — todavía no
   *  cobra nada, eso lo hace registrarPagos() con uno o más abonos. */
  async function iniciarCobroMotor() {
    if (!ordenSeleccionadaId) return;
    setIniciandoCobro(true);
    setError(null);
    try {
      setCuenta(await migaoApi.iniciarCobro(ordenSeleccionadaId, construirDivisionInput(), descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar el cobro de esta cuenta");
    } finally {
      setIniciandoCobro(false);
    }
  }

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

  /** Registra un abono por cada parte que tenga algo que pagar ahora — puede
   *  ser el pago completo de todas (cierra la orden) o parcial de alguna(s)
   *  (la orden queda en 'pagando' hasta el próximo abono). */
  async function registrarPagos() {
    if (!ordenSeleccionadaId || !cuenta) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      let cuentaActual = cuenta;
      for (const parte of cuenta.partes) {
        const form = abonoForms[parte.id];
        if (!form || form.montoPagarAhora <= 0) continue;
        const propinaInput = form.propina > 0 ? { monto: form.propina, porcentaje: propinaPorcentaje } : undefined;
        const input: RegistrarAbonoInput =
          form.pago.metodoPago === "mixto"
            ? { metodoPago: "mixto", montoEfectivo: form.pago.montoEfectivo, montoBanco: form.pago.montoBanco, propina: propinaInput }
            : { metodoPago: form.pago.metodoPago, monto: form.montoPagarAhora, propina: propinaInput };
        cuentaActual = await migaoApi.registrarAbono(parte.id, input);
      }
      setCuenta(cuentaActual);
      if (cuentaActual.ordenEstado === "cerrada") {
        setMensaje(`Orden cobrada y cerrada. Total: ${formatMoney(Number(cuentaActual.venta.total))}`);
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
                <div key={area.valor} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
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
                return (
                  <button
                    key={o.id}
                    onClick={() => seleccionarOrden(o.id)}
                    className={`rounded-lg p-4 text-left transition-colors hover:bg-brand-green-50 dark:hover:bg-brand-green-700/30 ${
                      estadoCocina
                        ? BORDE_POR_ESTADO[estadoCocina]
                        : "border border-brand-vanilla-dark dark:border-brand-green-700"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-lg font-semibold text-brand-ink dark:text-brand-vanilla">
                        Mesa {o.mesa_numero ?? "—"}
                        {o.mesa_piso && <span className="text-sm font-normal"> ({labelArea(o.mesa_piso)})</span>}
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

          <h2 className="-mt-2 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            {ordenActual ? `Mesa ${ordenActual.mesa_numero ?? "—"}` : "Cobro"}
            {ordenActual?.mesero_nombre && (
              <span className="ml-2 text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                Mesero: {ordenActual.mesero_nombre}
              </span>
            )}
          </h2>

          {!detalle ? (
            <p className="text-sm text-brand-ink/60">Cargando detalle...</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {detalle.items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      item.es_para_llevar
                        ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/20"
                        : "border-brand-vanilla-dark dark:border-brand-green-700"
                    }`}
                  >
                    <div>
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
                      <EstadoBadge estado={item.estado} />
                      <span className="text-base font-semibold text-brand-ink dark:text-brand-vanilla">
                        {formatMoney(item.subtotal)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

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

              {!dividirCuenta && (
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
              )}

              <div className="flex flex-col gap-2">
                <span className="text-sm text-brand-ink dark:text-brand-vanilla">¿Agregar propina (servicio)?</span>
                <div className="flex flex-wrap gap-2">
                  {([0, 5, 10] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPropinaPorcentaje(p)}
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
                    onClick={() => setPropinaPorcentaje(null)}
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
                {dividirCuenta && propinaMonto > 0 && (
                  <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                    ≈ {formatMoney(propinaMonto / numPartes)} de propina por persona
                  </p>
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

              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
                  <input
                    type="checkbox"
                    checked={dividirCuenta}
                    onChange={(e) => (e.target.checked ? activarDivision() : reiniciarDivision())}
                    disabled={unidadesCobrables.length < 2 || cuenta !== null}
                    className="h-4 w-4"
                  />
                  Dividir cuenta entre varias personas
                  {!dividirCuenta && Boolean(detalle?.orden.numero_personas) && (
                    <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                      (sugerido: {detalle!.orden.numero_personas} comensal
                      {detalle!.orden.numero_personas === 1 ? "" : "es"})
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
                  <input
                    type="checkbox"
                    checked={pagoParcial}
                    onChange={(e) => setPagoParcial(e.target.checked)}
                    disabled={cuenta !== null}
                    className="h-4 w-4"
                  />
                  ¿Pago parcial?
                </label>
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
                        <CalculadoraVuelta
                          aPagar={
                            pago.metodoPago === "mixto"
                              ? pago.montoEfectivo // ya incluye su parte de la propina (ver validación de arriba)
                              : montoEfectivoRequerido(pago, totalConDescuento) + propinaMonto
                          }
                          recibido={montoRecibido}
                          onChange={setMontoRecibido}
                        />
                      )}
                    </>
                  )}

                  <button
                    onClick={cerrarYCobrar}
                    disabled={cobrando || pagoMixtoInvalido}
                    className="w-full rounded-md bg-brand-green-700 px-3 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                  >
                    {cobrando ? "Cobrando..." : "Cobrar y cerrar orden"}
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-4 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
                  {!cuenta ? (
                    <>
                      {dividirCuenta && (
                        <>
                          <div className="flex gap-2">
                            {(["producto", "igual"] as const).map((modo) => (
                              <button
                                key={modo}
                                type="button"
                                onClick={() => setModoDivisionCuenta(modo)}
                                className={`flex-1 rounded-md border-2 px-3 py-1.5 text-sm font-medium ${
                                  modoDivisionCuenta === modo
                                    ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                                    : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
                                }`}
                              >
                                {modo === "producto" ? "Por producto" : "Por igual"}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                              ¿Entre cuántas partes?
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => cambiarNumPartes(numPartes - 1)}
                                disabled={numPartes <= 2}
                                className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-green-700 font-bold text-brand-green-700 disabled:opacity-40 dark:border-brand-vanilla dark:text-brand-vanilla"
                              >
                                −
                              </button>
                              <span className="w-6 text-center font-semibold text-brand-ink dark:text-brand-vanilla">
                                {numPartes}
                              </span>
                              <button
                                type="button"
                                onClick={() => cambiarNumPartes(numPartes + 1)}
                                disabled={numPartes >= topeNumPartes()}
                                className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-green-700 font-bold text-brand-green-700 disabled:opacity-40 dark:border-brand-vanilla dark:text-brand-vanilla"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {modoDivisionCuenta === "producto" && (
                            <div className="flex flex-col gap-2">
                              <span className="text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
                                Toca la parte a la que corresponde cada producto:
                              </span>
                              {unidadesCobrables.map((unidad) => (
                                <div key={unidad.key} className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-brand-ink dark:text-brand-vanilla">
                                    {formatCantidad(unidad.cantidadUnidad)}× {unidad.productoNombre}
                                  </span>
                                  <div className="flex shrink-0 gap-1">
                                    {Array.from({ length: numPartes }, (_, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setAsignaciones((actual) => ({ ...actual, [unidad.key]: idx }))}
                                        className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-bold ${
                                          asignaciones[unidad.key] === idx
                                            ? "border-brand-green-700 bg-brand-green-700 text-brand-vanilla"
                                            : "border-brand-vanilla-dark text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60"
                                        }`}
                                      >
                                        {idx + 1}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              <div className="flex flex-col gap-1 border-t border-brand-vanilla-dark pt-2 dark:border-brand-green-700">
                                {Array.from({ length: numPartes }, (_, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs text-brand-ink/70 dark:text-brand-vanilla/70"
                                  >
                                    <span>Parte {idx + 1}</span>
                                    <span>{formatMoney(subtotalParte(idx))}</span>
                                  </div>
                                ))}
                              </div>
                              {!todosAsignados && (
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                  Asigna todos los productos a alguna parte antes de continuar.
                                </p>
                              )}
                            </div>
                          )}

                          {modoDivisionCuenta === "igual" && (
                            <div className="flex flex-col gap-1">
                              {Array.from({ length: numPartes }, (_, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm text-brand-ink dark:text-brand-vanilla">
                                  <span>Parte {idx + 1}</span>
                                  <span>≈ {formatMoney(totalConDescuento / numPartes)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      <button
                        onClick={iniciarCobroMotor}
                        disabled={iniciandoCobro || (dividirCuenta && modoDivisionCuenta === "producto" && !todosAsignados)}
                        className="w-full rounded-md bg-brand-green-700 px-3 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                      >
                        {iniciandoCobro ? "Iniciando..." : "Continuar"}
                      </button>
                    </>
                  ) : (
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
                                    disabled={!pagoParcial}
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
                                  <CalculadoraVuelta
                                    aPagar={
                                      form.pago.metodoPago === "mixto"
                                        ? form.pago.montoEfectivo
                                        : montoEfectivoRequerido(form.pago, form.montoPagarAhora) + form.propina
                                    }
                                    recibido={form.montoRecibido}
                                    onChange={(valor) => actualizarAbonoForm(parte.id, { montoRecibido: valor })}
                                  />
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
                        disabled={cobrando || algunAbonoMixtoInvalido || totalAPagarAhora <= 0}
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
