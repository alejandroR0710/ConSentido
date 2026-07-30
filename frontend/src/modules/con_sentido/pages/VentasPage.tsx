import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { NuevaVentaModal } from "../components/NuevaVentaModal";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi } from "../../caja/api";
import { conSentidoApi } from "../api";

const PRODUCTOS_EJEMPLO = [
  {
    id: 1,
    nombre: "Artesanía A",
    precio: 50000,
    descripcion: "Pieza artesanal hecha a mano",
  },
  {
    id: 2,
    nombre: "Artesanía B",
    precio: 75000,
    descripcion: "Diseño exclusivo y único",
  },
  {
    id: 3,
    nombre: "Artesanía C",
    precio: 100000,
    descripcion: "Colección premium",
  },
];

function cargarProductos() {
  try {
    const guardados = localStorage.getItem("consentido_inventario_productos");
    const productosInventario = guardados ? JSON.parse(guardados) : [];
    return productosInventario.length > 0 ? productosInventario : PRODUCTOS_EJEMPLO;
  } catch {
    return PRODUCTOS_EJEMPLO;
  }
}

export function VentasPage() {
  const [ventas, setVentas] = useState<any[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [productos, setProductos] = useState(cargarProductos());
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ventasExpandidas, setVentasExpandidas] = useState<Set<string>>(new Set());

  // Cargar ventas desde API (siempre, sin cache)
  const cargarVentasActuales = async () => {
    try {
      const ventasApi = await conSentidoApi.listarVentas();

      if (ventasApi && ventasApi.length > 0) {
        // Mapear campos del API al formato esperado por el frontend
        const ventasMapeadas = ventasApi.map((v: any) => ({
          id: v.id,
          monto: parseFloat(v.monto),
          metodoPago: v.metodo_pago,
          fecha: v.created_at,
          items: v.items.map((item: any) => ({
            producto: item.producto,
            descripcion: item.descripcion,
            imagen: item.imagen,
            categoria: item.categoria,
            cantidad: parseFloat(item.cantidad),
            precioUnitario: parseFloat(item.precio_unitario),
            subtotal: parseFloat(item.subtotal),
          })),
          montoEfectivo: parseFloat(v.monto_efectivo || 0),
          montoBanco: parseFloat(v.monto_banco || 0),
        }));
        setVentas(ventasMapeadas);
      } else {
        setVentas([]);
      }
    } catch (err) {
      // Fallback a localStorage solo si API falla
      try {
        const guardadas = localStorage.getItem("consentido_ventas");
        const ventasLocal = guardadas ? JSON.parse(guardadas) : [];
        if (ventasLocal.length > 0) {
          setVentas(ventasLocal);
        }
      } catch {
        // No hay datos
      }
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    setCargando(true);
    cargarVentasActuales();
  }, []);

  // Sincronizar cuando la página vuelve a tener foco
  useEffect(() => {
    function handleFocus() {
      cargarVentasActuales();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Polling automático cada 5 segundos para detectar cambios en Caja General
  useEffect(() => {
    const intervalo = setInterval(() => {
      cargarVentasActuales();
    }, 5000);

    return () => clearInterval(intervalo);
  }, []);

  // Refrescar productos cuando cambian en inventario
  useEffect(() => {
    function handleStorageChange() {
      setProductos(cargarProductos());
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
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
    try {
      setRegistrando(true);
      setError(null);

      // Guardar en API de Con Sentido
      try {
        await conSentidoApi.registrarVenta(venta);
      } catch (apiErr) {
        console.warn("API de Con Sentido no disponible, guardando localmente", apiErr);
        // Fallback: guardar en localStorage
        localStorage.setItem("consentido_ventas", JSON.stringify([venta, ...ventas]));
      }

      // Registrar ingreso en Caja
      try {
        if (venta.metodoPago === "mixto") {
          await cajaApi.registrarIngreso({
            moduloOrigenSlug: "con_sentido",
            motivo: `Venta Con Sentido - ${venta.items?.length || 1} producto(s)`,
            metodoPago: "mixto",
            montoEfectivo: venta.montoEfectivo || 0,
            montoBanco: venta.montoBanco || 0,
          });
        } else {
          await cajaApi.registrarIngreso({
            moduloOrigenSlug: "con_sentido",
            motivo: `Venta Con Sentido - ${venta.items?.length || 1} producto(s)`,
            metodoPago: venta.metodoPago,
            monto: venta.monto,
          });
        }
      } catch (cajaErr) {
        console.warn("Error al registrar en Caja:", cajaErr);
        // No es crítico si falla Caja, la venta ya se guardó
      }

      setVentas([venta, ...ventas]);
    } catch (err) {
      setError("Error al registrar la venta");
      console.error(err);
    } finally {
      setRegistrando(false);
    }
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
        <div className="space-y-3">
          {ventas.map((venta) => (
            <div
              key={venta.id}
              className="rounded-lg border border-brand-vanilla-dark bg-brand-vanilla p-4 dark:border-brand-green-700 dark:bg-brand-green-900/20"
            >
              <button
                onClick={() => alternarVenta(venta.id.toString())}
                className="w-full text-left"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      Venta #{venta.id.toString().slice(-6)}
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
                    </div>
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
                    <div className="text-xl text-brand-green-700 dark:text-brand-vanilla">
                      {ventasExpandidas.has(venta.id.toString()) ? "▼" : "▶"}
                    </div>
                  </div>
                </div>
              </button>

              {ventasExpandidas.has(venta.id.toString()) && (
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
