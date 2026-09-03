import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type ItemIngresoInput, type ModuloOrigenSlug, type RegistrarIngresoResultado } from "../api";
import { facturaCajaAReciboProps } from "../factura";
import { MODULOS_ORIGEN } from "../moduloOrigen";

interface IngresoModalProps {
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
}

// Igual que en Cotizaciones: en vez de un solo monto, se pueden agregar
// varias líneas sueltas (nombre libre + cantidad + precio) y el total se
// suma solo — útil cuando el ingreso viene de varios productos/servicios
// distintos que no vale la pena registrar como venta aparte.
interface LineaIngreso {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

let siguienteKeyLinea = 1;
function lineaVacia(): LineaIngreso {
  return { key: siguienteKeyLinea++, nombre: "", cantidad: 1, precioUnitario: 0 };
}

export function IngresoModal({ onCerrar, onRegistrado, valoresIniciales }: IngresoModalProps) {
  const tieneItemsIniciales = Boolean(valoresIniciales?.items && valoresIniciales.items.length > 0);
  // Con Sentido por defecto: la mayoría de ingresos manuales acá son de ahí
  // (Migao casi siempre cobra desde su propia pantalla, no desde acá) — antes
  // arrancaba en "migao" y era fácil dejarlo así sin querer.
  const [modulo, setModulo] = useState<ModuloOrigenSlug>(valoresIniciales?.moduloOrigenSlug ?? "con_sentido");
  const [modoMonto, setModoMonto] = useState<"unico" | "productos">(tieneItemsIniciales ? "productos" : "unico");
  // "Monto" siempre es el bruto (antes de descuento); lo que realmente se
  // registra/suma al turno es el neto ya descontado (montoNeto más abajo).
  const [monto, setMonto] = useState(0);
  const [lineas, setLineas] = useState<LineaIngreso[]>(
    tieneItemsIniciales
      ? valoresIniciales!.items!.map((i) => ({ key: siguienteKeyLinea++, ...i }))
      : [lineaVacia()],
  );
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(0);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [montoRecibido, setMontoRecibido] = useState(0);
  const [motivo, setMotivo] = useState(valoresIniciales?.motivo ?? "");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Todo ingreso genera su propia factura (ver caja.service.ts::registrarIngresoManual)
  // — al terminar se pregunta si se quiere imprimir, en vez de cerrar de una.
  const [resultado, setResultado] = useState<RegistrarIngresoResultado | null>(null);
  const [recibo, setRecibo] = useState<ReturnType<typeof facturaCajaAReciboProps> | null>(null);
  const [cargandoFactura, setCargandoFactura] = useState(false);
  const [errorFactura, setErrorFactura] = useState<string | null>(null);

  const lineasValidas = lineas.filter((l) => l.nombre.trim().length > 0 && l.cantidad > 0);
  const totalLineas = lineasValidas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
  const montoBruto = modoMonto === "productos" ? totalLineas : monto;
  const montoNeto = montoBruto * (1 - descuentoPorcentaje / 100);
  const mixtoInvalido =
    pago.metodoPago === "mixto" && Math.abs(pago.montoEfectivo + pago.montoBanco - montoNeto) > 0.01;
  // Cuánto de este ingreso va en efectivo de verdad — obligatorio indicar
  // cuánto entregó el cliente para calcular la vuelta (backend también lo
  // valida, ver caja.service.ts::exigirMontoRecibidoEfectivo).
  const montoEnEfectivo = pago.metodoPago === "mixto" ? pago.montoEfectivo : pago.metodoPago === "efectivo" ? montoNeto : 0;
  const faltaMontoRecibido = montoEnEfectivo > 0 && montoRecibido < montoEnEfectivo;
  const puedeRegistrar =
    montoNeto > 0 && !mixtoInvalido && !faltaMontoRecibido && (modoMonto === "unico" || lineasValidas.length > 0);

  function actualizarLinea(key: number, cambios: Partial<LineaIngreso>) {
    setLineas((actual) => actual.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  function quitarLinea(key: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.key !== key) : actual));
  }

  async function registrar() {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      const items =
        modoMonto === "productos"
          ? lineasValidas.map((l) => ({ nombre: l.nombre.trim(), cantidad: l.cantidad, precioUnitario: l.precioUnitario }))
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
      });
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
    <Modal titulo="Registrar ingreso" onCerrar={onCerrar} maxWidth="sm:max-w-2xl">
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
            { valor: "unico" as const, etiqueta: "Monto único" },
            { valor: "productos" as const, etiqueta: "Agregar productos" },
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
                <input
                  value={linea.nombre}
                  onChange={(e) => actualizarLinea(linea.key, { nombre: e.target.value })}
                  placeholder="Producto o servicio"
                  className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
                <input
                  type="number"
                  min={1}
                  value={linea.cantidad}
                  onChange={(e) => actualizarLinea(linea.key, { cantidad: Math.max(1, Number(e.target.value)) })}
                  className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
                <MoneyInput
                  value={linea.precioUnitario}
                  onChange={(v) => actualizarLinea(linea.key, { precioUnitario: v })}
                  placeholder="Precio"
                  className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
                <span className="w-24 text-right text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                  {formatMoney(linea.cantidad * linea.precioUnitario)}
                </span>
                <button
                  type="button"
                  onClick={() => quitarLinea(linea.key)}
                  disabled={lineas.length === 1}
                  className="rounded-md px-2 py-1 text-lg text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/30"
                  aria-label="Quitar línea"
                >
                  ✕
                </button>
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
          <CalculadoraVuelta aPagar={montoEnEfectivo} recibido={montoRecibido} onChange={setMontoRecibido} />
          {faltaMontoRecibido && (
            <p className="mt-1 text-xs text-red-600">Escribe cuánto te dio el cliente en efectivo para poder registrar el ingreso.</p>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={registrando || !puedeRegistrar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : "Registrar ingreso"}
      </button>
    </Modal>
  );
}
