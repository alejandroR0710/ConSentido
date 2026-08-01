import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "../../../shared/format/money";
import { conSentidoApi } from "../api";

export function ConSentidoPage() {
  const [ventas, setVentas] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);

  useEffect(() => {
    async function cargarDatos() {
      try {
        const ventasApi = await conSentidoApi.listarVentas();
        const ventasMapeadas = ventasApi.map((v: any) => ({
          id: v.id,
          monto: parseFloat(v.monto),
          metodoPago: v.metodo_pago,
          fecha: v.created_at,
          items:
            v.items?.map((item: any) => ({
              producto: item.producto,
              descripcion: item.descripcion,
              categoria: item.categoria,
              cantidad: parseFloat(item.cantidad),
              precioUnitario: parseFloat(item.precio_unitario),
              subtotal: parseFloat(item.subtotal),
            })) || [],
          montoEfectivo: parseFloat(v.monto_efectivo || 0),
          montoBanco: parseFloat(v.monto_banco || 0),
        }));
        setVentas(ventasMapeadas);
      } catch (err) {
        console.error("Error cargando ventas:", err);
      }

      try {
        setProductos(await conSentidoApi.listarProductos());
      } catch (err) {
        console.error("Error cargando productos:", err);
      }
    }
    cargarDatos();
  }, []);

  const ventasHoy = ventas.filter((v) => {
    const fecha = new Date(v.fecha);
    const hoy = new Date();
    return (
      fecha.getDate() === hoy.getDate() &&
      fecha.getMonth() === hoy.getMonth() &&
      fecha.getFullYear() === hoy.getFullYear()
    );
  });

  const totalHoy = ventasHoy.reduce((sum, v) => sum + v.monto, 0);
  const totalProductos = productos.reduce((sum, p) => sum + p.stock, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
            Caja Con Sentido
          </h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Gestión de ventas y transacciones del módulo Con Sentido.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/con-sentido/ventas"
          className="rounded-lg border-2 border-brand-vanilla-dark p-4 hover:border-brand-green-400 hover:bg-brand-green-50 transition-colors dark:border-brand-green-700 dark:hover:bg-brand-green-700/20"
        >
          <div className="text-3xl mb-2">💳</div>
          <h2 className="font-semibold text-brand-green-700 dark:text-brand-vanilla">Ventas</h2>
          <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Registrar y gestionar ventas
          </p>
        </Link>

        <Link
          to="/con-sentido/clientes"
          className="rounded-lg border-2 border-brand-vanilla-dark p-4 hover:border-brand-green-400 hover:bg-brand-green-50 transition-colors dark:border-brand-green-700 dark:hover:bg-brand-green-700/20"
        >
          <div className="text-3xl mb-2">👥</div>
          <h2 className="font-semibold text-brand-green-700 dark:text-brand-vanilla">Clientes</h2>
          <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Gestionar clientes y contactos
          </p>
        </Link>

        <Link
          to="/con-sentido/inventario"
          className="rounded-lg border-2 border-brand-vanilla-dark p-4 hover:border-brand-green-400 hover:bg-brand-green-50 transition-colors dark:border-brand-green-700 dark:hover:bg-brand-green-700/20"
        >
          <div className="text-3xl mb-2">📦</div>
          <h2 className="font-semibold text-brand-green-700 dark:text-brand-vanilla">Inventario</h2>
          <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Control de inventario
          </p>
        </Link>
      </div>

      <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
        <h2 className="mb-3 font-semibold text-brand-green-700 dark:text-brand-vanilla">Resumen Hoy</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded bg-brand-green-50 p-3 dark:bg-brand-green-700/20">
            <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Ventas</div>
            <div className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">
              {ventasHoy.length}
            </div>
            <div className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
              {formatMoney(totalHoy)}
            </div>
          </div>
          <div className="rounded bg-brand-green-50 p-3 dark:bg-brand-green-700/20">
            <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Total</div>
            <div className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">
              {formatMoney(totalHoy)}
            </div>
          </div>
          <div className="rounded bg-brand-green-50 p-3 dark:bg-brand-green-700/20">
            <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Productos</div>
            <div className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">
              {productos.length}
            </div>
            <div className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
              {totalProductos} en stock
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
