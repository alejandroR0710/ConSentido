import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import { descomponerPago } from "../../shared/utils/pago-mixto";
import * as cajaService from "../general/caja/caja.service";
import * as repo from "./migao.repository";
import {
  AgregarItemInput,
  CerrarOrdenInput,
  CheckItemInput,
  CrearOrdenInput,
  CrearProductoInput,
  EditarItemInput,
  EditarProductoInput,
} from "./migao.schema";

export async function listarCategorias() {
  return repo.listCategoriasProducto();
}

export async function crearCategoria(nombre: string) {
  return repo.crearCategoriaProducto(nombre);
}

export async function listarMesas() {
  return repo.listMesas();
}

export async function listarOrdenesAbiertas() {
  return repo.listOrdenesAbiertas();
}

/**
 * Historial que ve el Cajero: órdenes cerradas/canceladas + ingresos manuales de
 * Migao registrados desde Caja (ventas que no pasaron por crear/cerrar una
 * orden), todo junto y ordenado por fecha. El historial acotado por mesero
 * (`meseroId` presente) NO incluye los ingresos manuales — un ingreso manual no
 * tiene mesero asociado, así que no aplica "mi historial" para ellos.
 */
export async function listarHistorialOrdenes(meseroId?: string) {
  const ordenes = await repo.listOrdenesHistorial(meseroId);
  const entradasOrdenes = ordenes.map((o) => ({ tipo: "orden" as const, ...o }));

  if (meseroId) return entradasOrdenes;

  const ingresosManuales = await repo.listIngresosManualesMigao();
  const entradasIngresos = ingresosManuales.map((i) => ({
    tipo: "ingreso_manual" as const,
    id: i.id,
    created_at: i.created_at,
    closed_at: i.created_at,
    monto: i.monto,
    motivo: i.motivo,
    metodo_pago: i.metodo_pago,
    usuario_nombre: i.usuario_nombre,
  }));

  return [...entradasOrdenes, ...entradasIngresos].sort(
    (a, b) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime(),
  );
}

export async function listarProductos() {
  return repo.listProductosMigao();
}

export async function crearProducto(input: CrearProductoInput) {
  return repo.crearProductoMigao(input);
}

export async function listarProductosAdmin() {
  return repo.listProductosMigaoAdmin();
}

export async function editarProducto(id: string, input: EditarProductoInput) {
  const producto = await repo.actualizarProductoMigao(id, input);
  if (!producto) throw Errors.notFound("Producto no encontrado");
  return producto;
}

export async function actualizarImagenProducto(id: string, imagenUrl: string) {
  const producto = await repo.actualizarImagenProductoMigao(id, imagenUrl);
  if (!producto) throw Errors.notFound("Producto no encontrado");
  return producto;
}

/**
 * El mesero arma todo el pedido (mesa + productos) antes de que exista nada en
 * la base: la orden y todos sus ítems se crean juntos, en una sola transacción,
 * recién cuando confirma. La mesa se resuelve/crea por número.
 */
export async function crearOrden(meseroId: string, input: CrearOrdenInput) {
  const mesa = await repo.getOrCreateMesaPorNumero(input.mesaNumero, input.piso);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orden = await repo.crearOrden(meseroId, mesa.id, input.clienteId, input.numeroPersonas, client);

    for (const item of input.items) {
      const nuevoItem = await repo.agregarItem(
        orden.id,
        item.productoId,
        item.cantidad,
        item.precioUnitario,
        item.observaciones,
        client,
      );
      await repo.insertHistorial(client, {
        ordenId: orden.id,
        ordenItemId: nuevoItem.id,
        accion: "item_agregado",
        detalle: { cantidad: item.cantidad, precioUnitario: item.precioUnitario },
        usuarioId: meseroId,
      });
    }

    await client.query("COMMIT");
    return orden;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function agregarItem(ordenId: string, input: AgregarItemInput, usuarioId: string) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    throw Errors.conflict("No se pueden agregar productos a una orden cerrada o cancelada");
  }
  const item = await repo.agregarItem(ordenId, input.productoId, input.cantidad, input.precioUnitario, input.observaciones);
  await repo.insertHistorial(pool, {
    ordenId,
    ordenItemId: item.id,
    accion: "item_agregado",
    detalle: { cantidad: input.cantidad, precioUnitario: input.precioUnitario },
    usuarioId,
  });
  return item;
}

/**
 * El mesero corrige un ítem (cantidad) o lo cancela. Cada cambio queda en
 * orden_historial, consultable desde el detalle de la orden. Cocina nunca lee
 * este historial: siempre consulta orden_items en vivo, así que ve la orden
 * ya corregida en su próximo refresco automático.
 */
export async function editarItem(itemId: string, input: EditarItemInput, usuarioId: string) {
  const item = await repo.getItemById(itemId);
  if (!item) throw Errors.notFound("Ítem de orden no encontrado");
  if (item.estado === "cancelado") throw Errors.conflict("Este ítem ya fue cancelado");
  if (item.estado === "servido") throw Errors.conflict("Este ítem ya fue servido, no se puede editar");

  const orden = await repo.getOrdenById(item.orden_id);
  if (orden && (orden.estado === "cerrada" || orden.estado === "cancelada")) {
    throw Errors.conflict("No se puede editar un ítem de una orden cerrada o cancelada");
  }

  if (input.cancelar) {
    const actualizado = await repo.updateItemEstado(itemId, "cancelado");
    await repo.insertHistorial(pool, {
      ordenId: item.orden_id,
      ordenItemId: Number(itemId),
      accion: "item_cancelado",
      detalle: { cantidadAnterior: item.cantidad },
      usuarioId,
    });
    return actualizado;
  }

  const actualizado = await repo.updateItemCantidad(itemId, input.cantidad!);
  await repo.insertHistorial(pool, {
    ordenId: item.orden_id,
    ordenItemId: Number(itemId),
    accion: "item_editado",
    detalle: { cantidadAnterior: item.cantidad, cantidadNueva: input.cantidad, estadoAnterior: item.estado },
    usuarioId,
  });
  return actualizado;
}

export async function listarItemsActivos() {
  return repo.listItemsActivos();
}

/** El mesero marca como entregado un ítem que cocina ya dejó "listo". */
export async function entregarItem(itemId: string, usuarioId: string) {
  const item = await repo.getItemById(itemId);
  if (!item) throw Errors.notFound("Ítem de orden no encontrado");
  if (item.estado !== "listo") {
    throw Errors.conflict("Solo se puede marcar como entregado un ítem que ya está listo");
  }
  const actualizado = await repo.updateItemEstado(itemId, "servido");
  await repo.insertHistorial(pool, {
    ordenId: item.orden_id,
    ordenItemId: Number(itemId),
    accion: "item_entregado",
    usuarioId,
  });
  return actualizado;
}

function calcularItemsConSubtotal<T extends { cantidad: string; precio_unitario: string }>(items: T[]) {
  return items.map((i) => ({ ...i, subtotal: Number(i.cantidad) * Number(i.precio_unitario) }));
}

export async function listarColaDeCocina() {
  return repo.listItemsCocina();
}

export async function listarHistorialDespachados() {
  return repo.listItemsDespachados();
}

/**
 * Cocina empieza a preparar TODA la orden de una vez (no producto por producto):
 * todo lo que esté "pendiente" en esa orden pasa a "preparando" en un solo paso.
 * Si el mesero agrega un producto nuevo después, vuelve a quedar "pendiente" y
 * este mismo botón lo suma al lote sin afectar lo que ya se estaba preparando.
 */
export async function empezarPreparar(ordenId: string, usuarioId: string) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actualizados = await repo.empezarPreparar(ordenId, client);
    if (actualizados.length === 0) {
      throw Errors.conflict("No hay productos pendientes por empezar a preparar en esta orden");
    }
    // Marca de tiempo para poder calcular después cuánto tarda Cocina en
    // preparar cada producto (ver analytics del Dashboard).
    for (const item of actualizados) {
      await repo.insertHistorial(client, { ordenId, ordenItemId: item.id, accion: "item_preparando", usuarioId });
    }
    await client.query("COMMIT");
    return actualizados;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Cocina marca/desmarca el check de un producto individual mientras se prepara la orden. */
export async function marcarCheckItem(itemId: string, input: CheckItemInput) {
  const item = await repo.getItemById(itemId);
  if (!item) throw Errors.notFound("Ítem de orden no encontrado");
  if (item.estado !== "preparando") {
    throw Errors.conflict("Solo se puede marcar el check de un producto que está en preparación");
  }
  return repo.setCheckItem(itemId, input.listoCocina);
}

/**
 * Marca TODA la orden como lista. Bloqueado hasta que no queden productos
 * pendientes por empezar ni productos en preparación sin su check marcado.
 */
export async function marcarOrdenLista(ordenId: string, usuarioId: string) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");

  const items = await repo.getItemsPorOrden(ordenId);
  const activos = items.filter((i) => i.estado !== "cancelado" && i.estado !== "servido" && i.estado !== "listo");

  if (activos.length === 0) {
    throw Errors.conflict("Esta orden no tiene productos en preparación");
  }
  if (activos.some((i) => i.estado === "pendiente")) {
    throw Errors.conflict("Aún hay productos sin empezar a preparar");
  }
  const sinCheck = activos.filter((i) => !i.listo_cocina);
  if (sinCheck.length > 0) {
    throw Errors.conflict(
      `Faltan ${sinCheck.length} producto(s) por marcar con el check antes de poner la orden en listo`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actualizados = await repo.marcarItemsListos(ordenId, client);
    // Marca de tiempo de cierre para el tiempo de preparación (ver item_preparando arriba).
    for (const item of actualizados) {
      await repo.insertHistorial(client, { ordenId, ordenItemId: item.id, accion: "item_listo", usuarioId });
    }
    await client.query("COMMIT");
    return actualizados;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Detalle para cobro y para edición del mesero: cada línea con su valor
 * independiente, el total, y el historial de altas/ediciones/cancelaciones
 * registrado para esta orden.
 */
export async function obtenerDetalleOrden(ordenId: string) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");

  const items = await repo.getItemsPorOrden(ordenId);
  const itemsConSubtotal = calcularItemsConSubtotal(items);
  // Los ítems cancelados se siguen mostrando (para que quede el registro de qué
  // se canceló), pero no deben sumar al total a cobrar.
  const total = itemsConSubtotal
    .filter((i) => i.estado !== "cancelado")
    .reduce((acc, i) => acc + i.subtotal, 0);
  const historial = await repo.getHistorialPorOrden(ordenId);

  return { orden, items: itemsConSubtotal, total, historial };
}

/**
 * Cierra la mesa/orden y cobra. La ruta solo concede el permiso 'migao.ordenes.cerrar'
 * al rol Cajero (ver rbac.middleware) — ningún otro rol puede ejecutar esta acción.
 * Venta, pago, ingreso en Caja General y cierre de la orden ocurren en una sola
 * transacción: si algo falla (ej. no hay turno de caja abierto), todo se revierte.
 */
export async function cerrarOrden(ordenId: string, input: CerrarOrdenInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orden = await repo.getOrdenById(ordenId, client, true);
    if (!orden) throw Errors.notFound("Orden no encontrada");
    if (orden.estado === "cerrada") throw Errors.conflict("Esta orden ya está cerrada");
    if (orden.estado === "cancelada") throw Errors.conflict("Esta orden fue cancelada");

    const itemsRaw = await repo.getItemsPorOrden(ordenId, client);
    if (itemsRaw.length === 0) throw Errors.conflict("La orden no tiene productos que cobrar");

    // Los ítems cancelados no se cobran ni quedan registrados como vendidos.
    const items = calcularItemsConSubtotal(itemsRaw).filter((i) => i.estado !== "cancelado");
    if (items.length === 0) throw Errors.conflict("La orden no tiene productos que cobrar");
    const total = items.reduce((acc, i) => acc + i.subtotal, 0);

    if (input.dividir) {
      // Cada producto debe quedar asignado a exactamente una parte: ni repetido
      // ni faltante. El monto de cada parte se calcula de sus propios productos,
      // así que la suma de las partes siempre cuadra con el total sin redondeos.
      // Se valida ANTES de escribir nada, para no crear una venta a medias.
      const idsValidos = new Set(items.map((i) => Number(i.id)));
      const idsAsignados = new Set<number>();
      for (const parte of input.partes) {
        for (const itemId of parte.itemIds) {
          if (!idsValidos.has(itemId)) {
            throw Errors.badRequest(`El producto ${itemId} no pertenece a esta orden o está cancelado`);
          }
          if (idsAsignados.has(itemId)) {
            throw Errors.badRequest(`El producto ${itemId} quedó asignado a más de una parte`);
          }
          idsAsignados.add(itemId);
        }
      }
      if (idsAsignados.size !== items.length) {
        throw Errors.badRequest("Todos los productos deben quedar asignados a alguna parte antes de cobrar");
      }
      // Si una parte es mixta, sus dos montos deben sumar justo el subtotal de
      // SUS productos (calculado del lado del servidor, no lo que mande el cliente).
      for (const [idx, parte] of input.partes.entries()) {
        if (parte.metodoPago !== "mixto") continue;
        const montoParte = items
          .filter((i) => parte.itemIds.includes(Number(i.id)))
          .reduce((acc, i) => acc + i.subtotal, 0);
        if (Math.abs(parte.montoEfectivo + parte.montoBanco - montoParte) > 0.01) {
          throw Errors.badRequest(
            `La parte ${idx + 1}: efectivo + banco debe sumar el subtotal de sus productos (${montoParte})`,
          );
        }
      }
    } else if (input.metodoPago === "mixto") {
      if (Math.abs(input.montoEfectivo + input.montoBanco - total) > 0.01) {
        throw Errors.badRequest(`La suma de efectivo + banco debe ser igual al total (${total})`);
      }
    }

    const venta = await repo.crearVenta(client, {
      clienteId: orden.cliente_id,
      usuarioId,
      ordenId,
      subtotal: total,
      total,
    });

    await repo.crearVentaItems(
      client,
      venta.id,
      items.map((i) => ({
        productoId: i.producto_id,
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precio_unitario),
      })),
    );

    if (input.dividir) {
      for (const [idx, parte] of input.partes.entries()) {
        const itemsParte = items.filter((i) => parte.itemIds.includes(Number(i.id)));
        const montoParte = itemsParte.reduce((acc, i) => acc + i.subtotal, 0);
        const lineas =
          parte.metodoPago === "mixto"
            ? descomponerPago({ metodoPago: "mixto", montoEfectivo: parte.montoEfectivo, montoBanco: parte.montoBanco })
            : descomponerPago({ metodoPago: parte.metodoPago, monto: montoParte });

        for (const linea of lineas) {
          await repo.crearPago(client, {
            ordenId,
            ventaId: venta.id,
            metodoPago: linea.metodoPago,
            monto: linea.monto,
            referencia: `Cuenta dividida ${idx + 1}/${input.partes.length}`,
            usuarioId,
          });
          await cajaService.registrarIngreso(
            {
              moduloOrigenSlug: "migao",
              monto: linea.monto,
              metodoPago: linea.metodoPago,
              referenciaEntidad: "ventas",
              referenciaId: venta.id,
            },
            usuarioId,
            client,
          );
        }
      }
    } else {
      const lineas =
        input.metodoPago === "mixto"
          ? descomponerPago({ metodoPago: "mixto", montoEfectivo: input.montoEfectivo, montoBanco: input.montoBanco })
          : descomponerPago({ metodoPago: input.metodoPago, monto: total });

      for (const linea of lineas) {
        await repo.crearPago(client, {
          ordenId,
          ventaId: venta.id,
          metodoPago: linea.metodoPago,
          monto: linea.monto,
          referencia: input.referencia,
          usuarioId,
        });

        await cajaService.registrarIngreso(
          {
            moduloOrigenSlug: "migao",
            monto: linea.monto,
            metodoPago: linea.metodoPago,
            referenciaEntidad: "ventas",
            referenciaId: venta.id,
          },
          usuarioId,
          client,
        );
      }
    }

    await repo.cerrarOrdenEstado(client, ordenId);

    await client.query("COMMIT");
    return { orden: { ...orden, estado: "cerrada" }, venta, total };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancela la orden completa (ej. el cliente ya no quiere pedir): cada ítem que
 * todavía no estaba cancelado/servido pasa a "cancelado" (queda registrado en
 * el historial igual que una cancelación individual del mesero) y la orden
 * pasa a "cancelada". Exclusivo del Cajero (ver rbac.middleware), igual que
 * cerrar y cobrar una orden.
 */
export async function cancelarOrden(ordenId: string, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orden = await repo.getOrdenById(ordenId, client, true);
    if (!orden) throw Errors.notFound("Orden no encontrada");
    if (orden.estado === "cerrada") throw Errors.conflict("Esta orden ya está cerrada y cobrada");
    if (orden.estado === "cancelada") throw Errors.conflict("Esta orden ya fue cancelada");

    const items = await repo.getItemsPorOrden(ordenId, client);
    for (const item of items) {
      if (item.estado === "cancelado" || item.estado === "servido") continue;
      await repo.updateItemEstado(item.id, "cancelado", client);
      await repo.insertHistorial(client, {
        ordenId,
        ordenItemId: item.id,
        accion: "item_cancelado",
        detalle: { cantidadAnterior: item.cantidad, estadoAnterior: item.estado },
        usuarioId,
      });
    }

    await repo.cancelarOrdenEstado(client, ordenId);

    await client.query("COMMIT");
    return { ...orden, estado: "cancelada" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Reset exclusivo de Super Root: borra por completo el historial de órdenes
 *  (no hay modo "conservar historial" como en Caja — ver migao.repository.ts). */
export async function resetearOrdenes() {
  return repo.resetearOrdenesCompleto();
}

/** Reinicio total exclusivo de Super Root: borra TODO el historial de Migao y
 *  de Caja General de una sola vez (ver migao.repository.ts). Deja intacto el
 *  catálogo (productos, categorías), usuarios y roles/permisos. */
export async function reiniciarTodo() {
  return repo.reiniciarTodoCompleto();
}
