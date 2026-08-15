import { PoolClient } from "pg";
import { pool } from "../../shared/db/pool";
import { tienePermiso } from "../../shared/middlewares/rbac.middleware";
import { Errors } from "../../shared/utils/app-error";
import * as amasijosService from "./amasijos.service";
import * as repo from "./inventario.repository";
import {
  CrearInventarioProductoInput,
  EditarInventarioProductoInput,
  IngredienteInput,
  RegistrarMovimientoInventarioInput,
} from "./inventario.schema";

export async function listarProductos() {
  return repo.listProductos();
}

export async function crearProducto(input: CrearInventarioProductoInput) {
  return repo.crearProducto(input);
}

export async function editarProducto(id: string, input: EditarInventarioProductoInput) {
  const actualizado = await repo.actualizarProducto(id, input);
  if (!actualizado) throw Errors.notFound("Producto de inventario no encontrado");
  return actualizado;
}

/**
 * A diferencia de "desactivar" (soft-delete, para productos con historial),
 * esto borra la fila de verdad — pensado para productos creados por error o
 * de prueba, que nunca tuvieron entradas/consumos. Si ya tiene movimientos o
 * está en la receta de algún producto del menú, la base rechaza el borrado
 * (foreign key sin CASCADE) y se traduce en un conflicto legible.
 *
 * `forzar` (exclusivo de Super Root, vía el permiso migao.inventario.eliminar_forzado)
 * se salta esa protección: borra también los movimientos y recetas asociadas
 * antes de borrar el producto. Es permanente e irreversible.
 */
export async function eliminarProducto(id: string, rolId: number, forzar = false) {
  if (forzar) {
    if (!(await tienePermiso(rolId, "migao.inventario.eliminar_forzado"))) {
      throw Errors.forbidden("No tienes permiso para forzar la eliminación de este producto");
    }
    const borrado = await repo.eliminarProductoForzado(id);
    if (!borrado) throw Errors.notFound("Producto de inventario no encontrado");
    return;
  }

  try {
    const borrado = await repo.eliminarProducto(id);
    if (!borrado) throw Errors.notFound("Producto de inventario no encontrado");
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "23503") {
      throw Errors.conflict(
        'No se puede eliminar: ya tiene movimientos o recetas asociadas. Usa "Desactivar" en su lugar.',
      );
    }
    throw err;
  }
}

/**
 * Alta de stock a mano (Root/Super Root/Cocina) — nunca 'consumo', eso solo
 * lo escribe aplicarConsumoPorProducto. 'entrada' llega en paquetes (así los
 * entrega el proveedor) y se convierte a unidades; 'ajuste' ya viene en
 * unidades directas (puede ser negativo, para corregir un conteo).
 *
 * Si la entrada es de una "base" con receta configurada (ej. "Base Valluno"),
 * se resuelve como preparación: descuenta los amasijos según la receta y da
 * entrada a la base — da igual si se registra acá o desde el módulo de
 * Amasijos, es el mismo código (ver amasijos.service.ts::prepararBaseSiAplica).
 */
export async function registrarMovimiento(input: RegistrarMovimientoInventarioInput, usuarioId: string) {
  const producto = await repo.getProductoById(input.productoId);
  if (!producto) throw Errors.notFound("Producto de inventario no encontrado");

  const deltaUnidades =
    input.tipo === "entrada" ? input.paquetes * Number(producto.unidades_por_paquete) : input.unidades;

  if (input.tipo === "entrada") {
    const resultado = await amasijosService.prepararBaseSiAplica(input.productoId, deltaUnidades, input.motivo, usuarioId);
    if (resultado) return resultado;
  }

  const actualizado = await repo.ajustarStock(pool, input.productoId, deltaUnidades);
  const movimiento = await repo.insertMovimiento(pool, {
    productoId: input.productoId,
    tipo: input.tipo,
    cantidadUnidades: deltaUnidades,
    motivo: input.motivo,
    usuarioId,
  });
  return { producto: actualizado, movimiento, alertasInventario: [] as string[] };
}

export async function listarMovimientos(productoId: string) {
  return repo.listMovimientosPorProducto(productoId);
}

/**
 * Se llama desde migao.service.ts en cada alta/edición/cancelación de un
 * ítem de orden. `deltaCantidadProducto` positivo = se pidió/aumentó
 * cantidad (consume, el stock baja); negativo = se canceló/redujo (se
 * devuelve, el stock sube). Nunca bloquea: si el stock queda en negativo,
 * se devuelve un mensaje de alerta para que el mesero lo vea, pero el ítem
 * igual se agrega — el usuario prefiere avisar a frenar una venta por un
 * inventario que puede estar mal contado.
 */
export async function aplicarConsumoPorProducto(
  client: PoolClient,
  productoId: string,
  deltaCantidadProducto: number,
  usuarioId: string,
  ordenItemId: number,
): Promise<string[]> {
  const ingredientes = await repo.listIngredientesDeProducto(productoId, client);
  if (ingredientes.length === 0) return [];

  const alertas: string[] = [];
  for (const ingrediente of ingredientes) {
    const deltaUnidades = -Number(ingrediente.cantidadPorUnidad) * deltaCantidadProducto;
    const actualizado = await repo.ajustarStock(client, ingrediente.inventarioProductoId, deltaUnidades);
    if (!actualizado) continue;

    await repo.insertMovimiento(client, {
      productoId: ingrediente.inventarioProductoId,
      tipo: "consumo",
      cantidadUnidades: deltaUnidades,
      referenciaEntidad: "orden_items",
      referenciaId: String(ordenItemId),
      usuarioId,
    });

    if (deltaUnidades < 0 && Number(actualizado.stock_unidades) < 0) {
      alertas.push(
        `⚠ Sin stock suficiente de "${ingrediente.nombre}" — quedan ${actualizado.stock_unidades} ${ingrediente.unidadMedida}.`,
      );
    }
  }
  return alertas;
}

/** Reemplaza la receta completa de un producto del menú — se llama desde
 *  Menú al guardar (crear o editar) un producto, fuera de cualquier
 *  transacción de órdenes, así que administra la suya propia. */
export async function guardarIngredientesDeProducto(productoId: string, ingredientes: IngredienteInput[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await repo.reemplazarIngredientesDeProducto(
      client,
      productoId,
      ingredientes.map((i) => ({ inventarioProductoId: i.inventarioProductoId, cantidadPorUnidad: i.cantidadPorUnidad })),
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function obtenerIngredientesDeProducto(productoId: string) {
  return repo.listIngredientesDeProducto(productoId);
}
