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

export async function listarVentas(skip: number, limit: number, fecha?: string) {
  return repo.listVentas(skip, limit, fecha);
}

export async function obtenerVenta(id: string) {
  const venta = await repo.getVentaById(id);
  if (!venta) throw Errors.notFound("Venta no encontrada");
  return venta;
}
