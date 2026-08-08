import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import * as repo from "./con_sentido.repository";
import {
  CrearClienteConSentidoInput,
  CrearProductoConSentidoInput,
  EditarProductoConSentidoInput,
  RegistrarVentaInput,
} from "./con_sentido.schema";

export async function listarProductos() {
  return repo.listProductos();
}

export async function crearProducto(input: CrearProductoConSentidoInput) {
  return repo.crearProducto(input);
}

export async function editarProducto(id: string, input: EditarProductoConSentidoInput) {
  const existente = await repo.getProductoConSentidoById(id);
  if (!existente) throw Errors.notFound("Producto no encontrado");
  return repo.actualizarProducto(id, input);
}

export async function listarClientes() {
  return repo.listClientes();
}

export async function crearCliente(input: CrearClienteConSentidoInput) {
  return repo.crearCliente({ nombre: input.nombre, telefono: input.telefono, email: input.email || undefined });
}

/**
 * Registra la venta (con su desglose de ítems) y el ingreso correspondiente en
 * Caja General, todo en una sola transacción — si el turno no está abierto
 * (cajaService.registrarIngreso lo valida) o falla cualquier paso, se revierte
 * todo, incluida la venta. El ingreso se registra UNA sola vez acá; el
 * frontend no debe volver a llamar a la API de Caja por su cuenta (eso fue lo
 * que causaba que cada venta quedara duplicada en Caja General).
 */
export async function registrarVenta(input: RegistrarVentaInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const venta = await repo.crearVenta(client, {
      usuarioId,
      monto: input.monto,
      metodoPago: input.metodoPago,
      montoEfectivo: input.metodoPago === "mixto" ? input.montoEfectivo : undefined,
      montoBanco: input.metodoPago === "mixto" ? input.montoBanco : undefined,
    });

    for (const item of input.items) {
      await repo.crearVentaItem(client, {
        ventaId: venta.id,
        producto: item.producto,
        descripcion: item.descripcion,
        categoria: item.categoria,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
      });
    }

    // Factura: se genera acá mismo, al registrar la venta, no cuando alguien
    // la pide para imprimir — así cualquier venta ya tiene su número
    // (F-000123) desde el momento en que se cobra (ver mismo criterio en
    // migao.service.ts::cerrarOrden).
    await repo.getOrCrearFactura({ ventaId: venta.id, subtotal: input.monto, total: input.monto }, client);

    const motivo = `Venta Con Sentido - ${input.items.length} producto(s)`;
    if (input.metodoPago === "mixto") {
      await cajaService.registrarIngreso(
        {
          moduloOrigenSlug: "con_sentido",
          motivo,
          referenciaEntidad: "con_sentido_ventas",
          referenciaId: venta.id,
          metodoPago: "mixto",
          montoEfectivo: input.montoEfectivo,
          montoBanco: input.montoBanco,
        },
        usuarioId,
        client,
      );
    } else {
      await cajaService.registrarIngreso(
        {
          moduloOrigenSlug: "con_sentido",
          motivo,
          referenciaEntidad: "con_sentido_ventas",
          referenciaId: venta.id,
          metodoPago: input.metodoPago,
          monto: input.monto,
        },
        usuarioId,
        client,
      );
    }

    await client.query("COMMIT");
    return { id: venta.id, createdAt: venta.created_at, monto: input.monto, metodoPago: input.metodoPago, items: input.items };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * El historial de "ventas" que ve Con Sentido combina dos orígenes: las
 * ventas registradas por su propio flujo ("Nueva venta") y los ingresos que
 * alguien registró a mano desde Caja General con área "Con Sentido" (ej. un
 * cobro que no pasó por el flujo normal) — mismo patrón que el historial de
 * Migao (ver migao.service.ts::listarHistorialOrdenes).
 */
export async function listarVentas(skip: number, limit: number, fecha?: string) {
  const [ventas, ingresosManuales] = await Promise.all([
    repo.listVentas(skip, limit, fecha),
    repo.listIngresosManualesConSentido(),
  ]);

  const entradasVentas = ventas.map((v) => ({ tipo: "venta" as const, ...v }));
  const entradasManuales = ingresosManuales
    .filter(
      (i) => !fecha || new Date(i.created_at).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) === fecha,
    )
    .map((i) => ({
      tipo: "ingreso_manual" as const,
      id: i.id,
      created_at: i.created_at,
      monto: i.monto,
      metodo_pago: i.metodo_pago,
      monto_efectivo: null,
      monto_banco: null,
      motivo: i.motivo,
      usuario_nombre: i.usuario_nombre,
      items: [],
    }));

  return [...entradasVentas, ...entradasManuales].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function obtenerVenta(id: string) {
  const venta = await repo.getVentaById(id);
  if (!venta) throw Errors.notFound("Venta no encontrada");
  return venta;
}

/**
 * Factura imprimible de una venta de Con Sentido — mismo formato normalizado
 * que migao.service.ts::obtenerFacturaOrden (mesa/mesero/comensal quedan null,
 * acá no aplican) para poder reusar el mismo componente de impresión del
 * frontend. No hay concepto de descuento en este flujo, así que subtotal y
 * total son iguales.
 */
export async function obtenerFacturaVenta(ventaId: string) {
  const venta = await repo.getVentaById(ventaId);
  if (!venta) throw Errors.notFound("Venta no encontrada");

  const monto = Number(venta.monto);
  const factura = await repo.getOrCrearFactura({ ventaId, subtotal: monto, total: monto });

  const pagos =
    venta.metodo_pago === "mixto"
      ? [
          { metodoPago: "efectivo", monto: Number(venta.monto_efectivo), referencia: null },
          { metodoPago: "banco", monto: Number(venta.monto_banco), referencia: null },
        ]
      : [{ metodoPago: venta.metodo_pago as string, monto, referencia: null }];

  return {
    numeroFactura: factura.numero as string,
    fecha: venta.created_at as string,
    mesaNumero: null,
    mesaPiso: null,
    meseroNombre: null,
    comensalNumero: null,
    items: (venta.items as Array<Record<string, unknown>>).map((item) => ({
      productoNombre: item.producto as string,
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
    })),
    subtotal: monto,
    descuentoPorcentaje: 0,
    descuentoMonto: 0,
    total: monto,
    pagos,
    propina: null,
  };
}
