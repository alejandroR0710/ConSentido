import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as repo from "./insumos.repository";
import { ActualizarInsumoInput, CrearInsumoInput, RegistrarMovimientoInput } from "./insumos.schema";

export async function listarInsumos() {
  return repo.listInsumos();
}

export async function obtenerInsumo(id: string) {
  const insumo = await repo.getInsumoById(id);
  if (!insumo) throw Errors.notFound("Insumo no encontrado");
  return insumo;
}

export async function crearInsumo(data: CrearInsumoInput) {
  return repo.createInsumo(data);
}

export async function actualizarInsumo(id: string, data: ActualizarInsumoInput) {
  const insumo = await repo.updateInsumo(id, data);
  if (!insumo) throw Errors.notFound("Insumo no encontrado");
  return insumo;
}

export async function listarInsumosAdmin() {
  return repo.listInsumosAdmin();
}

export async function actualizarImagenInsumo(id: string, imagenUrl: string) {
  const insumo = await repo.actualizarImagenInsumo(id, imagenUrl);
  if (!insumo) throw Errors.notFound("Insumo no encontrado");
  return insumo;
}

export async function listarAlmacenes() {
  return repo.listAlmacenes();
}

export async function listarMovimientos(desde: string, hasta: string) {
  return repo.listMovimientos(desde, hasta);
}

/**
 * Registra un movimiento de inventario y ajusta el stock en la misma transacción.
 * Esta es la única puerta de entrada para que CUALQUIER módulo (Talleres, Migao,
 * Pedidos) modifique el inventario de insumos, manteniendo la trazabilidad.
 */
export async function registrarMovimiento(input: RegistrarMovimientoInput, usuarioId?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insumo = await repo.getInsumoById(input.insumoId);
    if (!insumo) throw Errors.notFound("Insumo no encontrado");

    if (input.tipo === "salida" || input.tipo === "transferencia") {
      const stockActual = await repo.getStock(client, input.insumoId, input.almacenId);
      if (stockActual < input.cantidad) {
        throw Errors.conflict(
          `Stock insuficiente en el almacén origen (disponible: ${stockActual}, solicitado: ${input.cantidad})`,
        );
      }
    }

    let nuevoStockOrigen: number;
    if (input.tipo === "entrada" || input.tipo === "ajuste") {
      nuevoStockOrigen = await repo.ajustarStock(client, input.insumoId, input.almacenId, input.cantidad);
    } else {
      nuevoStockOrigen = await repo.ajustarStock(client, input.insumoId, input.almacenId, -input.cantidad);
    }

    if (input.tipo === "transferencia" && input.almacenDestinoId) {
      await repo.ajustarStock(client, input.insumoId, input.almacenDestinoId, input.cantidad);
    }

    await repo.insertMovimiento(client, { ...input, usuarioId });

    const stockMinimo = await repo.getStockMinimo(client, input.insumoId);
    if (nuevoStockOrigen < stockMinimo) {
      await repo.crearAlertaStockMinimo(client, input.insumoId, insumo.nombre, nuevoStockOrigen);
    }

    await client.query("COMMIT");
    return { insumoId: input.insumoId, almacenId: input.almacenId, nuevoStock: nuevoStockOrigen };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
