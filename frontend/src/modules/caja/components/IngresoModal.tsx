import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import {
  SelectorMetodoPago,
  faltaReferenciaBanco,
  referenciaBancoPayload,
  type MetodoPagoValor,
} from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import {
  useIngresosMinimizados,
  type FormularioIngreso,
  type IngresoMinimizado,
  type LineaIngreso,
  type OrigenIngreso,
} from "../../../shared/ingresosMinimizados/IngresosMinimizadosContext";
import { conSentidoApi, type ProductoConSentido } from "../../con_sentido/api";
import { SelectorMesaVisual } from "../../con_sentido/components/SelectorMesaVisual";
import { migaoApi, type CuentaParte } from "../../migao/api";
import { cajaApi, type ItemIngresoInput, type ModuloOrigenSlug, type RegistrarIngresoResultado } from "../api";
import { SugerenciasProducto } from "./SugerenciasProducto";
import { facturaCajaAReciboProps } from "../factura";
import { MODULOS_ORIGEN } from "../moduloOrigen";
import { preciosConMayorista } from "../../con_sentido/mayorista";

interface IngresoModalProps {
  // De dónde sale este formulario — viaja con el snapshot al minimizar para
  // saber a qué pantalla volver y qué hacer después de registrar (ver
  // IngresosMinimizadosContext.tsx).
  origen: OrigenIngreso;
  onCerrar: () => void;
  // Recibe el resultado del registro — quien abre este modal desde otro
  // lugar (ej. "Pasar a factura" de una cotización) lo necesita para, por
  // ejemplo, dejar un rastro de qué venta salió de ahí.
  onRegistrado: (resultado: RegistrarIngresoResultado) => Promise<void>;
  // Precarga el formulario — usado para "Pasar a factura" desde una
  // cotización: todo queda editable, esto solo evita volver a escribirlo.
  valoresIniciales?: {
    moduloOrigenSlug?: ModuloOrigenSlug;
    motivo?: string;
    items?: ItemIngresoInput[];
  };
  // Formulario minimizado que se está restaurando — tiene prioridad sobre
  // valoresIniciales (que solo aplica al abrir en blanco desde una cotización).
  snapshotRestaurado?: IngresoMinimizado;
}

let siguienteKeyLinea = 1;
function lineaVacia(): LineaIngreso {
  return { key: siguienteKeyLinea++, nombre: "", cantidad: 1, precioUnitario: 0 };
}

export function IngresoModal({ origen, onCerrar, onRegistrado, valoresIniciales, snapshotRestaurado }: IngresoModalProps) {
  const { minimizar, descartar } = useIngresosMinimizados();
  // Mismo id si se está restaurando (para que minimizar de nuevo pise la
  // misma entrada en vez de duplicarla). Si no, y el origen es una
  // cotización, un id estable por cotización — abrir "Pasar a factura" dos
  // veces sobre la misma cotización debe pisar la misma entrada minimizada,
  // no crear dos chips para lo mismo. `crypto.randomUUID` no existe fuera de
  // un contexto seguro (ej. acceder por IP/HTTP en la red local) — con un
  // fallback nunca revienta el formulario por eso.
  const [id] = useState(
    () =>
      snapshotRestaurado?.id ??
      (origen.tipo === "cotizacion"
        ? `cotizacion-${origen.cotizacionId}`
        : (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)),
  );
  const f = snapshotRestaurado?.formulario;
  const tieneItemsIniciales = Boolean(valoresIniciales?.items && valoresIniciales.items.length > 0);
  // Con Sentido por defecto: la mayoría de ingresos manuales acá son de ahí
  // (Migao casi siempre cobra desde su propia pantalla, no desde acá) — antes
  // arrancaba en "migao" y era fácil dejarlo así sin querer.
  const [modulo, setModulo] = useState<ModuloOrigenSlug>(f?.modulo ?? valoresIniciales?.moduloOrigenSlug ?? "con_sentido");
  // "Agregar productos" abre primero (es el flujo más usado); "Monto único"
  // queda como segunda opción para un ingreso suelto sin desglose.
  const [modoMonto, setModoMonto] = useState<"unico" | "productos">(f?.modoMonto ?? "productos");
  // "Monto" siempre es el bruto (antes de descuento); lo que realmente se
  // registra/suma al turno es el neto ya descontado (montoNeto más abajo).
  const [monto, setMonto] = useState(f?.monto ?? 0);
  const [lineas, setLineas] = useState<LineaIngreso[]>(
    f
      // Re-clavar las keys con el contador de ESTA sesión: las que traía el
      // snapshot pueden venir de antes de un refresh de página, y el
      // contador reinicia en 1 en cada carga — sin esto, una línea nueva
      // agregada después podía terminar con la misma key que una restaurada.
      ? f.lineas.map((l) => ({ ...l, key: siguienteKeyLinea++ }))
      : tieneItemsIniciales
        ? valoresIniciales!.items!.map((i) => ({ key: siguienteKeyLinea++, ...i }))
        : [lineaVacia()],
  );
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(f?.descuentoPorcentaje ?? 0);
  const [pago, setPago] = useState<MetodoPagoValor>(f?.pago ?? { metodoPago: "efectivo" });
  const [montoRecibido, setMontoRecibido] = useState(f?.montoRecibido ?? 0);
  const [motivo, setMotivo] = useState(f?.motivo ?? valoresIniciales?.motivo ?? "");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Venta combinada mesa + Con Sentido — ver
  // docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
  // Solo aplica con productos reales de Con Sentido (nunca con un snapshot
  // restaurado/minimizado: se arranca siempre apagado en ese caso, para no
  // dejar un estado a medias si el cajero minimizó justo en el medio).
  const [vincularAMesa, setVincularAMesa] = useState(false);
  const [ordenIdElegida, setOrdenIdElegida] = useState<string | null>(null);
  // Todas las partes reales de esa mesa (con sus montos) — null = todavía
  // no se consultó. Se guardan completas (no solo id/índice) para poder
  // mostrar el panel resumen de "cuánto debe la mesa" al costado.
  const [todasLasPartes, setTodasLasPartes] = useState<CuentaParte[] | null>(null);
  const [parteIdElegida, setParteIdElegida] = useState<string | null>(null);
  const partesDeLaMesa = (todasLasPartes?.length ?? 0) > 1 ? todasLasPartes! : [];
  const parteElegida: CuentaParte | null = !todasLasPartes
    ? null
    : todasLasPartes.length === 1
      ? todasLasPartes[0]
      : (todasLasPartes.find((p) => p.id === parteIdElegida) ?? null);

  useEffect(() => {
    if (!ordenIdElegida) {
      setTodasLasPartes(null);
      setParteIdElegida(null);
      return;
    }
    migaoApi
      .obtenerCuenta(ordenIdElegida)
      .then((cuenta) => setTodasLasPartes(cuenta.partes))
      .catch(() => setTodasLasPartes([])); // sin cobro iniciado todavía: se crea una sola parte sola al vincular
  }, [ordenIdElegida]);

  // Si el formulario abre YA lleno (precargado desde una cotización) o
  // restaurado, "sigue como arrancó" no es lo mismo que "está vacío" — lo que
  // importa para no dejar un chip fantasma es si el cajero cambió algo desde
  // que se montó, sin importar con qué arrancó.
  const primerRenderTocadoRef = useRef(true);
  const tocadoRef = useRef(false);
  useEffect(() => {
    if (primerRenderTocadoRef.current) {
      primerRenderTocadoRef.current = false;
      return;
    }
    tocadoRef.current = true;
  }, [modulo, modoMonto, monto, lineas, descuentoPorcentaje, pago, montoRecibido, motivo]);

  // Catálogo de Con Sentido para el autocompletar de "Producto o servicio" —
  // se carga una vez al abrir el modal (mismo listado que usa el e-commerce,
  // con imagen/nombre/precio/sku ya sincronizados, ver con_sentido.repository.ts).
  const [productos, setProductos] = useState<ProductoConSentido[]>([]);
  const [filaEnfocada, setFilaEnfocada] = useState<number | null>(null);
  useEffect(() => {
    conSentidoApi
      .listarProductos()
      .then(setProductos)
      .catch(() => {}); // sin catálogo disponible, el campo sigue funcionando como texto libre
  }, []);

  // Todo ingreso genera su propia factura (ver caja.service.ts::registrarIngresoManual)
  // — al terminar se pregunta si se quiere imprimir, en vez de cerrar de una.
  const [resultado, setResultado] = useState<RegistrarIngresoResultado | null>(null);
  const [recibo, setRecibo] = useState<ReturnType<typeof facturaCajaAReciboProps> | null>(null);
  const [cargandoFactura, setCargandoFactura] = useState(false);
  const [errorFactura, setErrorFactura] = useState<string | null>(null);

  const lineasValidas = lineas.filter((l) => l.nombre.trim().length > 0 && l.cantidad > 0);

  // Sin stock suficiente se vende igual: el inventario queda en negativo y hay
  // que explicar por qué no cuadró (mismo criterio que NuevaVentaModal).
  const cantidadEnLineas = (productoId: string) =>
    lineas.filter((l) => l.productoId === productoId).reduce((acc, l) => acc + l.cantidad, 0);
  const stockResultante = (linea: LineaIngreso) => {
    if (!linea.productoId) return null;
    const producto = productos.find((p) => p.id === linea.productoId);
    return producto ? Number(producto.stock) - cantidadEnLineas(linea.productoId) : null;
  };
  const faltaStock = (linea: LineaIngreso) => {
    const resultante = stockResultante(linea);
    return resultante !== null && resultante < 0;
  };
  const faltaObservacion = lineasValidas.some((l) => faltaStock(l) && !l.observacionInventario?.trim());
  // Precio mayorista (ver con_sentido/mayorista.ts): se recalcula con cada cambio de las líneas,
  // sumando las del mismo producto. `precioDe` es el precio que de verdad se cobra en cada línea.
  const productoDe = (linea: LineaIngreso) =>
    linea.productoId ? productos.find((p) => p.id === linea.productoId) : undefined;
  const precios = preciosConMayorista(
    lineas.map((l) => {
      const producto = productoDe(l);
      return {
        grupo: producto ? producto.grupo : null,
        cantidad: l.cantidad,
        precioNormal: producto ? producto.precio : l.precioUnitario,
        precioMayorista: producto?.precio_mayorista ?? null,
        mayoristaDesde: producto?.mayorista_desde ?? null,
        precioManual: l.precioManual ?? false,
      };
    }),
  );
  const precioDe = (linea: LineaIngreso) =>
    precios[lineas.findIndex((l) => l.key === linea.key)]?.precio ?? linea.precioUnitario;
  const esMayorista = (linea: LineaIngreso) =>
    precios[lineas.findIndex((l) => l.key === linea.key)]?.esMayorista ?? false;
  const totalLineas = lineasValidas.reduce((acc, l) => acc + l.cantidad * precioDe(l), 0);
  const montoBruto = modoMonto === "productos" ? totalLineas : monto;
  const montoNeto = montoBruto * (1 - descuentoPorcentaje / 100);
  const mixtoInvalido =
    pago.metodoPago === "mixto" && Math.abs(pago.montoEfectivo + pago.montoBanco - montoNeto) > 0.01;
  // Cuánto de este ingreso va en efectivo de verdad — obligatorio indicar
  // cuánto entregó el cliente para calcular la vuelta (backend también lo
  // valida, ver caja.service.ts::exigirMontoRecibidoEfectivo).
  const montoEnEfectivo = pago.metodoPago === "mixto" ? pago.montoEfectivo : pago.metodoPago === "efectivo" ? montoNeto : 0;
  const faltaMontoRecibido = montoEnEfectivo > 0 && montoRecibido < montoEnEfectivo;
  // Vinculando a una mesa: todas las líneas deben ser productos reales del
  // catálogo (el backend no acepta texto libre en el carrito de tienda) y
  // hace falta haber elegido una mesa — no se valida método de pago ni
  // monto, acá no se cobra nada todavía (hallazgo de uso real: el cajero
  // esperaba esta función justo acá, en "Registrar ingreso", no en una
  // pantalla aparte — ver docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md).
  const todasLasLineasConProducto = lineasValidas.length > 0 && lineasValidas.every((l) => Boolean(l.productoId));
  const faltaElegirParte = partesDeLaMesa.length > 1 && !parteIdElegida;
  const puedeRegistrar = vincularAMesa
    ? todasLasLineasConProducto &&
      !faltaObservacion &&
      ordenIdElegida !== null &&
      todasLasPartes !== null &&
      !faltaElegirParte
    : montoNeto > 0 &&
      !mixtoInvalido &&
      !faltaMontoRecibido &&
      !faltaReferenciaBanco(pago) &&
      (modoMonto === "unico" || (lineasValidas.length > 0 && !faltaObservacion));

  function actualizarLinea(key: number, cambios: Partial<LineaIngreso>) {
    setLineas((actual) => actual.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  // Siempre queda al menos una línea: si es la única, la ✕ la deja en blanco en vez de quitarla
  // (antes la ✕ quedaba deshabilitada y un producto mal elegido en la primera línea no se podía
  // quitar).
  function quitarLinea(key: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.key !== key) : [lineaVacia()]));
  }

  // Se marca en cuanto el POST de registrar responde bien, ANTES de esperar
  // a onRegistrado (que puede tardar — ej. marcarCotizacionFacturada) y antes
  // de que el estado resultado llegue a commitearse. Si el modal se cierra en
  // esa ventana, guardarComoMinimizado no debe tratar un ingreso YA
  // registrado como uno a medio llenar — eso duplicaría la venta al
  // restaurarlo y volver a registrar.
  const yaRegistradoRef = useRef(false);

  /** Guarda el formulario tal cual bajo su id — a diferencia de Migao, no hay
   *  nada "fresco" que repedir al backend, así que esto es todo lo que hace
   *  falta para poder restaurarlo después (ver spec 2026-10-11). Se salta si
   *  ya se registró (nada que minimizar) o si el formulario sigue tal cual
   *  arrancó (abrirlo y cerrarlo sin cambiar nada no debe dejar un chip en la
   *  barra, incluso si arrancó precargado desde una cotización). */
  function guardarComoMinimizado() {
    if (resultado || yaRegistradoRef.current || !tocadoRef.current) return;
    const formulario: FormularioIngreso = {
      modulo,
      modoMonto,
      monto,
      lineas,
      descuentoPorcentaje,
      pago,
      montoRecibido,
      motivo,
    };
    const etiqueta = origen.tipo === "cotizacion" ? `Cotización #${origen.numeroCotizacion}` : "Ingreso";
    minimizar(id, origen, etiqueta, montoNeto, formulario);
  }

  // guardarComoMinimizadoRef siempre apunta a la versión más reciente de la
  // función (cierra sobre el estado del último render) — el cleanup de abajo
  // se registra una sola vez (deps vacías) y solo se dispara al desmontar de
  // verdad, así que no puede leer el closure del primer render.
  const guardarComoMinimizadoRef = useRef(guardarComoMinimizado);
  useEffect(() => {
    guardarComoMinimizadoRef.current = guardarComoMinimizado;
  });

  // Minimizar nunca pierde el progreso sin importar POR QUÉ este modal deja
  // de estar montado: la ✕/fondo oscuro/botón "Minimizar" (los tres llaman a
  // onCerrar sin más), otra restauración que lo reemplaza en la misma
  // pantalla (ver key en CajaPage/CotizacionesPage), o navegar a otra
  // pantalla sin tocar nada explícito.
  useEffect(() => {
    return () => guardarComoMinimizadoRef.current();
  }, []);

  // Por si quedó una entrada minimizada bajo este id de alguna carrera (ej.
  // StrictMode en desarrollo re-disparando el efecto de arriba justo al
  // montar) — una vez que el ingreso quedó registrado, nunca debe quedar un
  // chip para él en la barra.
  useEffect(() => {
    if (resultado) descartar(id);
  }, [resultado, id, descartar]);

  const [vinculadoOk, setVinculadoOk] = useState(false);

  async function registrar() {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    setError(null);

    if (vincularAMesa) {
      try {
        await conSentidoApi.vincularMesa({
          ordenId: ordenIdElegida!,
          parteId: parteIdElegida ?? undefined,
          items: lineasValidas.map((l) => ({
            productoId: l.productoId!,
            cantidad: l.cantidad,
            precioUnitario: precioDe(l),
            observacionInventario: faltaStock(l) ? l.observacionInventario?.trim() : undefined,
          })),
          descuentoPorcentaje: descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
        });
        yaRegistradoRef.current = true;
        setVinculadoOk(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo vincular el carrito a la mesa");
      } finally {
        setRegistrando(false);
      }
      return;
    }

    try {
      const items =
        modoMonto === "productos"
          ? lineasValidas.map((l) => ({
              nombre: l.nombre.trim(),
              cantidad: l.cantidad,
              precioUnitario: precioDe(l),
              productoId: l.productoId,
              observacionInventario: faltaStock(l) ? l.observacionInventario?.trim() : undefined,
            }))
          : undefined;
      const montoRecibidoEfectivo = montoEnEfectivo > 0 ? montoRecibido : undefined;
      const creado = await cajaApi.registrarIngreso({
        moduloOrigenSlug: modulo,
        motivo: motivo.trim() || undefined,
        descuentoPorcentaje: descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
        items,
        ...(pago.metodoPago === "mixto"
          ? { ...pago, montoRecibidoEfectivo }
          : { metodoPago: pago.metodoPago, monto: montoNeto, montoRecibidoEfectivo }),
        ...referenciaBancoPayload(pago),
      });
      // Antes de esperar onRegistrado (puede tardar) y antes de que
      // setResultado llegue a commitearse — si el modal se desmonta en el
      // medio, guardarComoMinimizado ya no debe guardar nada bajo este id.
      yaRegistradoRef.current = true;
      await onRegistrado(creado);
      setResultado(creado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el ingreso");
    } finally {
      setRegistrando(false);
    }
  }

  async function imprimirFactura() {
    if (!resultado) return;
    setCargandoFactura(true);
    setErrorFactura(null);
    try {
      setRecibo(facturaCajaAReciboProps(await cajaApi.obtenerFacturaVenta(resultado.venta.id)));
    } catch (err) {
      setErrorFactura(err instanceof ApiError ? err.message : "No se pudo generar la factura");
    } finally {
      setCargandoFactura(false);
    }
  }

  if (vinculadoOk) {
    return (
      <Modal titulo="Productos vinculados a la mesa" onCerrar={onCerrar}>
        <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
          Quedaron vinculados a la mesa — se cobran junto con su cuenta, no acá. La factura de estos productos se
          genera cuando se termine de pagar esa cuenta desde Migao.
        </p>
        <button
          onClick={onCerrar}
          className="w-full rounded-md bg-brand-green-700 px-4 py-2.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          Listo
        </button>
      </Modal>
    );
  }

  if (resultado) {
    return (
      <>
        <Modal titulo="Ingreso registrado" onCerrar={onCerrar}>
          <p className="mb-1 text-sm text-brand-ink dark:text-brand-vanilla">
            Se registró correctamente — factura{" "}
            <span className="font-mono font-semibold text-brand-green-700 dark:text-brand-vanilla">
              {resultado.factura.numero}
            </span>
          </p>
          <p className="mb-4 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">¿Deseas imprimirla?</p>
          {errorFactura && <p className="mb-3 text-sm text-red-600">{errorFactura}</p>}
          <div className="flex gap-2">
            <button
              onClick={onCerrar}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-2.5 text-sm font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            >
              No, gracias
            </button>
            <button
              onClick={imprimirFactura}
              disabled={cargandoFactura}
              className="flex-1 rounded-md bg-brand-green-700 px-4 py-2.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
            >
              {cargandoFactura ? "..." : "Sí, imprimir"}
            </button>
          </div>
        </Modal>
        {recibo && <ModalImprimir {...recibo} onCerrar={onCerrar} />}
      </>
    );
  }

  return (
    <Modal
      titulo="Registrar ingreso"
      onCerrar={onCerrar}
      maxWidth="sm:max-w-2xl"
      accionExtra={
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-md px-2 py-1 text-sm font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        >
          ➖ Minimizar
        </button>
      }
    >
      <label className="mb-2 block text-xs font-medium">Viene de</label>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {MODULOS_ORIGEN.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setModulo(m.value)}
            autoFocus={m.value === "con_sentido"}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-colors ${
              modulo === m.value
                ? "border-brand-green-600 bg-brand-green-50 dark:border-brand-green-400 dark:bg-brand-green-700/30"
                : "border-brand-vanilla-dark hover:border-brand-green-400 dark:border-brand-green-700 dark:hover:border-brand-green-600"
            }`}
          >
            <span className="text-2xl">{m.icon}</span>
            <span className="text-xs font-medium leading-tight text-brand-ink dark:text-brand-vanilla">{m.label}</span>
          </button>
        ))}
      </div>

      <label className="mb-2 block text-xs font-medium">Monto</label>
      <div className="mb-3 flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
        {(
          [
            { valor: "productos" as const, etiqueta: "Agregar productos" },
            { valor: "unico" as const, etiqueta: "Monto único" },
          ]
        ).map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setModoMonto(op.valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              modoMonto === op.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {op.etiqueta}
          </button>
        ))}
      </div>

      {modoMonto === "productos" ? (
        <div className="mb-3">
          <div className="mb-2 flex flex-col gap-2">
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
                    className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                  />
                  {filaEnfocada === linea.key && (
                    <SugerenciasProducto
                      productos={productos}
                      texto={linea.nombre}
                      onSeleccionar={(producto) => {
                        actualizarLinea(linea.key, {
                          nombre: producto.nombre,
                          precioUnitario: producto.precio,
                          precioManual: false,
                          productoId: producto.id,
                        });
                        setFilaEnfocada(null);
                      }}
                    />
                  )}
                </div>
                <input
                  type="number"
                  min={1}
                  value={linea.cantidad}
                  onChange={(e) => actualizarLinea(linea.key, { cantidad: Math.max(1, Number(e.target.value)) })}
                  className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
                <MoneyInput
                  value={precioDe(linea)}
                  onChange={(v) => actualizarLinea(linea.key, { precioUnitario: v, precioManual: true })}
                  placeholder="Precio"
                  className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
                <span className="w-24 text-right text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                  {esMayorista(linea) && (
                    <span className="block text-[10px] font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      Mayorista
                    </span>
                  )}
                  {formatMoney(linea.cantidad * precioDe(linea))}
                </span>
                <button
                  type="button"
                  onClick={() => quitarLinea(linea.key)}
                  className="rounded-md px-2 py-1 text-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  aria-label={lineas.length === 1 ? "Vaciar línea" : "Quitar línea"}
                >
                  ✕
                </button>
                {faltaStock(linea) && (
                  <div className="w-full">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      ⚠️ En inventario hay {Number(productos.find((p) => p.id === linea.productoId)?.stock)}: quedará en{" "}
                      {stockResultante(linea)}. Explica por qué no cuadra el inventario:
                    </p>
                    <textarea
                      rows={2}
                      maxLength={500}
                      placeholder="Ej.: apareció en bodega, se hizo para esta venta, mala contada…"
                      value={linea.observacionInventario ?? ""}
                      onChange={(e) => actualizarLinea(linea.key, { observacionInventario: e.target.value })}
                      className={`mt-1 w-full rounded-md border bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:bg-brand-green-900 dark:text-brand-vanilla ${
                        linea.observacionInventario?.trim()
                          ? "border-brand-vanilla-dark dark:border-brand-green-700"
                          : "border-red-400 dark:border-red-500"
                      }`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLineas((actual) => [...actual, lineaVacia()])}
            className="mb-2 text-sm text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            + Agregar línea
          </button>
          <div className="flex items-center justify-between rounded-md bg-brand-green-50 px-3 py-2 text-base font-bold text-brand-green-700 dark:bg-brand-green-700/20 dark:text-brand-vanilla">
            <span>Total</span>
            <span>{formatMoney(totalLineas)}</span>
          </div>

          {/* Venta combinada mesa + Con Sentido — ver
              docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md */}
          {modulo === "con_sentido" && (
            <div className="mt-3 border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={vincularAMesa}
                  onChange={(e) => {
                    setVincularAMesa(e.target.checked);
                    setOrdenIdElegida(null);
                  }}
                />
                ¿Vincular estos productos a una mesa? (se cobran junto con su cuenta, no acá)
              </label>
              {vincularAMesa && (
                <div className="mt-2 grid gap-4 sm:grid-cols-[1fr_260px]">
                  <div>
                    {!todasLasLineasConProducto && (
                      <p className="mb-2 text-xs text-red-600">
                        Todas las líneas deben ser un producto real del catálogo (elígelo de las sugerencias) — no se
                        puede vincular texto libre.
                      </p>
                    )}
                    {ordenIdElegida ? (
                      <div>
                        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                          Mesa elegida.{" "}
                          <button
                            type="button"
                            onClick={() => setOrdenIdElegida(null)}
                            className="text-brand-green-700 underline dark:text-brand-vanilla"
                          >
                            Cambiar
                          </button>
                        </p>
                        {partesDeLaMesa.length > 1 && (
                          <div className="mt-2">
                            <p className="mb-1 text-xs font-medium">
                              Esta mesa tiene la cuenta dividida — ¿a cuál parte se vincula?
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {partesDeLaMesa.map((parte) => (
                                <button
                                  key={parte.id}
                                  type="button"
                                  onClick={() => setParteIdElegida(parte.id)}
                                  className={`rounded-md border px-3 py-1 text-xs font-medium ${
                                    parteIdElegida === parte.id
                                      ? "border-brand-green-700 bg-brand-green-100 text-brand-green-700 dark:bg-brand-green-700/40 dark:text-brand-vanilla"
                                      : "border-brand-vanilla-dark text-brand-ink/70 dark:border-brand-green-700 dark:text-brand-vanilla/70"
                                  }`}
                                >
                                  Parte {parte.indice}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <SelectorMesaVisual onElegirMesa={setOrdenIdElegida} />
                    )}
                  </div>

                  {parteElegida && (
                    <div className="flex flex-col gap-3 self-start rounded-xl border border-brand-vanilla-dark bg-brand-vanilla/60 p-3 dark:border-brand-green-700 dark:bg-brand-green-900/40">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                        Resumen
                      </h4>
                      <div className="flex flex-col gap-1 rounded-lg bg-brand-vanilla px-3 py-2 dark:bg-brand-green-900">
                        <div className="flex items-center justify-between text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
                          <span>🍽️ Cuenta de la mesa</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
                          <span>Pendiente</span>
                          <span>{formatMoney(parteElegida.pendiente)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 rounded-lg bg-brand-vanilla px-3 py-2 dark:bg-brand-green-900">
                        <div className="flex items-center justify-between text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
                          <span>🛍️ Este carrito</span>
                        </div>
                        <ul className="flex flex-col gap-0.5 text-[11px] text-brand-ink/60 dark:text-brand-vanilla/60">
                          {lineasValidas.map((l) => (
                            <li key={l.key} className="flex items-center justify-between gap-2">
                              <span className="truncate">
                                {l.cantidad}× {l.nombre || "(sin nombre)"}
                              </span>
                              <span className="shrink-0">{formatMoney(l.cantidad * precioDe(l))}</span>
                            </li>
                          ))}
                        </ul>
                        {descuentoPorcentaje > 0 && (
                          <div className="flex items-center justify-between text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                            <span>Descuento {descuentoPorcentaje}%</span>
                            <span>-{formatMoney(totalLineas - montoNeto)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
                          <span>Total</span>
                          <span>{formatMoney(montoNeto)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-brand-green-600 px-3 py-2.5 text-sm font-medium text-brand-vanilla">
                        <span>Quedará pendiente en la mesa</span>
                        <span className="text-lg font-bold">{formatMoney(parteElegida.pendiente + montoNeto)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <MoneyInput
          value={monto}
          onChange={setMonto}
          className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      )}

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium">Descuento %</label>
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
        {descuentoPorcentaje > 0 && (
          <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            A registrar: {formatMoney(montoNeto)}
          </span>
        )}
      </div>

      {!vincularAMesa && (
        <>
          <label className="mb-1 block text-xs font-medium">Método</label>
          <div className="mb-3">
            <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={montoNeto} />
          </div>

          <label className="mb-1 block text-xs font-medium">Motivo (opcional)</label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className="mb-4 w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          {pago.metodoPago !== "banco" && (
            <div className="mb-3">
              <CalculadoraVuelta
                aPagar={montoEnEfectivo}
                recibido={montoRecibido}
                onChange={setMontoRecibido}
                esParteDeMixto={pago.metodoPago === "mixto"}
              />
            </div>
          )}
        </>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={registrando || !puedeRegistrar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {registrando ? "Guardando..." : vincularAMesa ? "Vincular a la mesa" : "Registrar ingreso"}
      </button>
    </Modal>
  );
}
