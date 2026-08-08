import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { BotonFactura } from "../../migao/components/BotonFactura";
import { NuevaVentaModal } from "../components/NuevaVentaModal";
import { conSentidoApi } from "../api";

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Fecha calendario en hora Colombia de un timestamp ISO, en formato
 *  'YYYY-MM-DD' — mismo criterio que el historial de Migao, para agrupar por
 *  el mismo día sin importar en qué huso horario esté el servidor. */
function fechaBogota(fechaIso: string) {
  return new Date(fechaIso).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** `fecha` ya es 'YYYY-MM-DD' — se arma con el constructor de 3 argumentos
 *  (año, mes, día) para que quede en hora LOCAL del navegador sin pasar por
 *  UTC, y así no se corra un día (mismo truco que MigaoHistorialPage). */
function formatearFechaLarga(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(anio, mes - 1, dia);
  return `${DIAS_SEMANA[d.getDay()]} ${dia} de ${MESES[mes - 1]}`;
}

interface GrupoDiaVentas {
  fecha: string;
  ventas: any[];
}

/** Las ventas ya vienen ordenadas por fecha DESC (ver conSentidoApi.listarVentas),
 *  así que agrupar es un solo recorrido: cuando cambia el día (hora Colombia)
 *  se abre un grupo nuevo — mismo patrón que agruparPorDia en Migao. */
function agruparPorDia(ventas: any[]): GrupoDiaVentas[] {
  const grupos: GrupoDiaVentas[] = [];
  for (const v of ventas) {
    const fecha = fechaBogota(v.fecha);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.ventas.push(v);
    } else {
      grupos.push({ fecha, ventas: [v] });
    }
  }
  return grupos;
}

/** Efectivo/banco repartido de verdad (un pago "mixto" reparte su monto entre
 *  los dos, no cuenta completo en ninguno) — mismo criterio que el resumen
 *  diario de Migao, necesario para que la suma cuadre con lo que en realidad
 *  entró a cada bolsa. */
function totalesDelDia(ventasDelDia: any[]) {
  let efectivo = 0;
  let banco = 0;
  for (const v of ventasDelDia) {
    if (v.metodoPago === "efectivo") efectivo += v.monto;
    else if (v.metodoPago === "banco") banco += v.monto;
    else if (v.metodoPago === "mixto") {
      efectivo += v.montoEfectivo;
      banco += v.montoBanco;
    }
  }
  return { efectivo, banco, ganancia: efectivo + banco };
}

export function VentasPage() {
  const [ventas, setVentas] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ventasExpandidas, setVentasExpandidas] = useState<Set<string>>(new Set());

  const cargarVentasActuales = async () => {
    try {
      const ventasApi = await conSentidoApi.listarVentas();
      // El backend combina dos orígenes: ventas registradas por "Nueva venta"
      // y los ingresos que alguien registró a mano desde Caja General con
      // área "Con Sentido" (mismo patrón que el historial de Migao) — estos
      // últimos no tienen ítems, solo motivo/usuario.
      const ventasMapeadas = ventasApi.map((v: any) => ({
        tipo: v.tipo as "venta" | "ingreso_manual",
        id: v.id,
        monto: parseFloat(v.monto),
        metodoPago: v.metodo_pago,
        fecha: v.created_at,
        motivo: v.motivo,
        usuarioNombre: v.usuario_nombre,
        items: (v.items || []).map((item: any) => ({
          producto: item.producto,
          descripcion: item.descripcion,
          categoria: item.categoria,
          cantidad: parseFloat(item.cantidad),
          precioUnitario: parseFloat(item.precio_unitario),
          subtotal: parseFloat(item.subtotal),
        })),
        montoEfectivo: parseFloat(v.monto_efectivo || 0),
        montoBanco: parseFloat(v.monto_banco || 0),
        numeroFactura: v.numero_factura ?? null,
      }));
      setVentas(ventasMapeadas);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial de ventas");
    }
  };

  useEffect(() => {
    cargarVentasActuales();
    conSentidoApi.listarProductos().then(setProductos).catch(() => {});
  }, []);

  // Sincronizar cuando la página vuelve a tener foco, y cada 5s mientras está abierta.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState === "visible") cargarVentasActuales();
    }
    document.addEventListener("visibilitychange", alVolver);
    const intervalo = setInterval(cargarVentasActuales, 5000);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      clearInterval(intervalo);
    };
  }, []);

  function alternarVenta(ventaId: string) {
    const nuevas = new Set(ventasExpandidas);
    if (nuevas.has(ventaId)) {
      nuevas.delete(ventaId);
    } else {
      nuevas.add(ventaId);
    }
    setVentasExpandidas(nuevas);
  }

  async function guardarVenta(venta: any) {
    // El backend (con_sentido.service.ts::registrarVentaService) ya registra
    // el ingreso en movimientos_caja como parte de esta misma llamada — no hay
    // que volver a llamar a la API de Caja acá. Hacerlo (como pasaba antes)
    // duplicaba el ingreso: quedaba una vez desde el backend y otra vez desde
    // el frontend, así que Caja General mostraba el doble de lo vendido.
    await conSentidoApi.registrarVenta(venta);
    await cargarVentasActuales();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
            Ventas
          </h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Registra y gestiona las ventas de Con Sentido
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => cargarVentasActuales()}
            className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            title="Refrescar historial de ventas"
          >
            🔄 Refrescar
          </button>
          <Link
            to="/con-sentido"
            className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
          >
            ← Atrás
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
        <button
          onClick={() => setModalAbierto(true)}
          className="w-full max-w-xs rounded-md bg-brand-green-600 px-4 py-3 font-medium text-white hover:bg-brand-green-700"
        >
          + Nueva venta
        </button>
      </div>

      {ventas.length === 0 ? (
        <div className="rounded-lg border border-brand-vanilla-dark p-8 text-center dark:border-brand-green-700">
          <p className="text-brand-ink/60 dark:text-brand-vanilla/60">
            No hay ventas registradas aún
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
        {agruparPorDia(ventas).map((grupo) => {
          const totales = totalesDelDia(grupo.ventas);
          return (
            <div key={grupo.fecha} className="flex flex-col gap-3">
              <div className="rounded-lg border-t-2 border-brand-green-600 bg-brand-green-50 px-3 py-2 dark:border-brand-green-500 dark:bg-brand-green-700/20">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="font-semibold capitalize text-brand-green-700 dark:text-brand-vanilla">
                    {formatearFechaLarga(grupo.fecha)}
                  </span>
                  <span className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                    Efectivo {formatMoney(totales.efectivo)} · Banco {formatMoney(totales.banco)} ·{" "}
                    <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      Ganancia {formatMoney(totales.ganancia)}
                    </span>
                  </span>
                </div>
              </div>

              <div className="space-y-3">
        {grupo.ventas.map((venta) => (
            <div
              key={venta.id}
              className="rounded-lg border border-brand-vanilla-dark bg-brand-vanilla p-4 dark:border-brand-green-700 dark:bg-brand-green-900/20"
            >
              <button
                onClick={() => venta.tipo === "venta" && alternarVenta(venta.id.toString())}
                className="w-full text-left"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">
                        {venta.tipo === "ingreso_manual" ? "Ingreso manual" : `Venta #${venta.id.toString().slice(-6)}`}
                      </span>
                      {venta.tipo === "ingreso_manual" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          Caja General
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                      {new Date(venta.fecha).toLocaleDateString("es", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })} - {new Date(venta.fecha).toLocaleTimeString("es", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      {venta.numeroFactura && (
                        <span className="font-mono text-brand-ink/70 dark:text-brand-vanilla/70">
                          {" "}
                          · Fact. {venta.numeroFactura}
                        </span>
                      )}
                    </div>
                    {venta.tipo === "ingreso_manual" && (venta.motivo || venta.usuarioNombre) && (
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                        {[venta.motivo, venta.usuarioNombre].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                        {formatMoney(venta.monto)}
                      </div>
                      <span
                        className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                          venta.metodoPago === "efectivo"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : venta.metodoPago === "banco"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                        }`}
                      >
                        {venta.metodoPago}
                      </span>
                    </div>
                    {venta.tipo === "venta" && (
                      <div className="text-xl text-brand-green-700 dark:text-brand-vanilla">
                        {ventasExpandidas.has(venta.id.toString()) ? "▼" : "▶"}
                      </div>
                    )}
                  </div>
                </div>
              </button>

              {/* Fuera del botón de arriba (que expande/colapsa la venta) para no
                  anidar un <button> dentro de otro. */}
              {venta.tipo === "venta" && (
                <div className="mt-2 flex justify-end">
                  <BotonFactura origen={{ tipo: "venta_con_sentido", id: venta.id.toString() }} />
                </div>
              )}

              {venta.tipo === "venta" && ventasExpandidas.has(venta.id.toString()) && (
                <div className="border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
                  <div className="space-y-2">
                    {venta.items.map((item: any, idx: number) => (
                      <div key={idx} className="flex gap-2">
                        {item.imagen && (
                          <img
                            src={item.imagen}
                            alt={item.producto}
                            className="h-10 w-10 shrink-0 rounded object-cover"
                          />
                        )}
                        <div className="flex-1">
                          <div className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">
                            {item.cantidad}x {item.producto}
                          </div>
                          {item.descripcion && (
                            <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                              {item.descripcion}
                            </p>
                          )}
                          {item.categoria && (
                            <div className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                              {item.categoria}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
                            {formatMoney(item.subtotal)}
                          </div>
                          <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                            @{formatMoney(item.precioUnitario)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {venta.metodoPago === "mixto" && (
                <div className="mt-3 flex gap-4 border-t border-brand-vanilla-dark pt-3 text-xs text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60">
                  <div>Efectivo: {formatMoney(venta.montoEfectivo)}</div>
                  <div>Banco: {formatMoney(venta.montoBanco)}</div>
                </div>
              )}
            </div>
        ))}
              </div>
            </div>
          );
        })}
        </div>
      )}

      {modalAbierto && (
        <NuevaVentaModal
          productos={productos}
          onCerrar={() => setModalAbierto(false)}
          onGuardar={guardarVenta}
        />
      )}
    </div>
  );
}
