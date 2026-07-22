import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import { tienePermiso } from "../../shared/middlewares/rbac.middleware";
import { descomponerPago } from "../../shared/utils/pago-mixto";
import * as cajaService from "../general/caja/caja.service";
import * as notificacionesService from "../general/notificaciones/notificaciones.service";
import * as inventarioService from "./inventario.service";
import * as repo from "./migao.repository";
import {
  AgregarItemInput,
  CambiarMesaInput,
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

/** Historial de cuentas cerradas con pago "administrativo" — separado del
 *  historial normal porque no representan dinero real en Caja General. */
export async function listarHistorialAdministrativo() {
  return repo.listOrdenesHistorialAdministrativo();
}

/** Cuánto entró de Migao por día y método de pago (efectivo/banco) — para
 *  agrupar el historial de órdenes por día con su propio subtotal. */
export async function obtenerResumenDiarioIngresos() {
  const dias = await repo.getResumenDiarioIngresos();
  return dias.map((d) => ({
    fecha: d.fecha,
    efectivo: Number(d.efectivo),
    banco: Number(d.banco),
  }));
}

export async function listarProductos() {
  return repo.listProductosMigao();
}

/** Solo los productos marcados como cargo de "para llevar" — lo que ve el
 *  Cajero al cobrar (no tiene acceso al catálogo completo, ver
 *  agregarCargoParaLlevar). */
export async function listarProductosParaLlevar() {
  return repo.listProductosParaLlevar();
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
  const alertasInventario: string[] = [];
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
      // Descuenta del inventario los ingredientes que ese producto consume
      // (si no tiene receta asociada, no hace nada) — nunca bloquea, solo
      // devuelve un aviso si el stock queda en negativo.
      alertasInventario.push(
        ...(await inventarioService.aplicarConsumoPorProducto(client, item.productoId, item.cantidad, meseroId, nuevoItem.id)),
      );
    }

    await client.query("COMMIT");
    // Aviso push a Cocina (aunque tenga la pestaña cerrada) — nunca debe
    // romper la creación de la orden si el push falla.
    notificacionesService
      .enviarATodosDeRol("Cocina", { titulo: "Pedido nuevo", cuerpo: `Mesa ${mesa.numero}`, url: "/cocina" })
      .catch(() => {});
    return { ...orden, alertasInventario };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function agregarItem(
  ordenId: string,
  input: AgregarItemInput,
  usuarioId: string,
  notificarCocina = true,
) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    throw Errors.conflict("No se pueden agregar productos a una orden cerrada o cancelada");
  }

  const client = await pool.connect();
  let item;
  let alertasInventario: string[];
  try {
    await client.query("BEGIN");
    item = await repo.agregarItem(ordenId, input.productoId, input.cantidad, input.precioUnitario, input.observaciones, client);
    await repo.insertHistorial(client, {
      ordenId,
      ordenItemId: item.id,
      accion: "item_agregado",
      detalle: { cantidad: input.cantidad, precioUnitario: input.precioUnitario },
      usuarioId,
    });
    alertasInventario = await inventarioService.aplicarConsumoPorProducto(
      client,
      input.productoId,
      input.cantidad,
      usuarioId,
      item.id,
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (notificarCocina) {
    notificacionesService
      .enviarATodosDeRol("Cocina", { titulo: "Pedido nuevo", cuerpo: "Se agregó un producto a una orden", url: "/cocina" })
      .catch(() => {});
  }
  return { ...item, alertasInventario };
}

/**
 * Vía acotada para que el Cajero agregue un cargo de "para llevar" al cobrar,
 * sin darle el permiso general de agregar cualquier producto (eso sigue
 * siendo exclusivo del Mesero). Solo acepta productos marcados
 * `es_para_llevar`; para cualquier otro producto responde 400, sin importar
 * qué productoId le manden.
 */
export async function agregarCargoParaLlevar(ordenId: string, input: AgregarItemInput, usuarioId: string) {
  const producto = await repo.getProductoMigaoById(input.productoId);
  if (!producto || !producto.es_para_llevar) {
    throw Errors.badRequest('Este producto no está marcado como "para llevar"');
  }
  // No es comida: no debe avisarle a Cocina ni aparecer en su cola (ver el
  // filtro es_para_llevar en migao.repository.ts::listItemsCocina).
  return agregarItem(ordenId, input, usuarioId, false);
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

  const client = await pool.connect();
  let actualizado;
  let alertasInventario: string[];
  try {
    await client.query("BEGIN");

    if (input.cancelar) {
      actualizado = await repo.updateItemEstado(itemId, "cancelado", client);
      await repo.insertHistorial(client, {
        ordenId: item.orden_id,
        ordenItemId: Number(itemId),
        accion: "item_cancelado",
        detalle: { cantidadAnterior: item.cantidad },
        usuarioId,
      });
      // Se devuelve TODO lo que ese ítem había consumido (delta negativo = el
      // stock sube).
      alertasInventario = await inventarioService.aplicarConsumoPorProducto(
        client,
        item.producto_id,
        -Number(item.cantidad),
        usuarioId,
        Number(itemId),
      );
    } else {
      actualizado = await repo.updateItemCantidad(itemId, input.cantidad!, client);
      await repo.insertHistorial(client, {
        ordenId: item.orden_id,
        ordenItemId: Number(itemId),
        accion: "item_editado",
        detalle: { cantidadAnterior: item.cantidad, cantidadNueva: input.cantidad, estadoAnterior: item.estado },
        usuarioId,
      });
      // Solo el DELTA entre la cantidad vieja y la nueva — si aumentó,
      // consume más; si bajó, se devuelve la diferencia.
      alertasInventario = await inventarioService.aplicarConsumoPorProducto(
        client,
        item.producto_id,
        input.cantidad! - Number(item.cantidad),
        usuarioId,
        Number(itemId),
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { ...actualizado, alertasInventario };
}

/** El mesero cambia la mesa de una orden ya abierta (ej. los comensales se
 *  cambiaron de mesa). Igual que al crear la orden, la mesa se resuelve/crea
 *  por número — no hace falta que ya exista. */
export async function cambiarMesaOrden(ordenId: string, input: CambiarMesaInput) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    throw Errors.conflict("No se puede cambiar la mesa de una orden cerrada o cancelada");
  }
  const mesa = await repo.getOrCreateMesaPorNumero(input.mesaNumero, input.piso);
  return repo.actualizarMesaOrden(ordenId, mesa.id);
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

/** Suma cuánto vale, en total, lo que una parte se llevó — según las unidades
 *  (posiblemente fracciones de la cantidad de un mismo ítem) que le tocaron. */
function calcularMontoPorUnidades<T extends { id: unknown; precio_unitario: string }>(
  items: T[],
  unidades: { itemId: number; cantidad: number }[],
) {
  return unidades.reduce((acc, u) => {
    const item = items.find((i) => Number(i.id) === u.itemId)!;
    return acc + u.cantidad * Number(item.precio_unitario);
  }, 0);
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
    if (orden.mesero_id) {
      notificacionesService
        .enviarAUsuario(orden.mesero_id, { titulo: "Orden lista", cuerpo: "Una orden tuya ya está lista", url: "/mesero" })
        .catch(() => {});
    }
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
 * Cierra la mesa/orden y cobra. La ruta concede el permiso 'migao.ordenes.cerrar'
 * a Cajero/Root/Super Root (ver rbac.middleware) — el método "administrativo"
 * dentro de este mismo flujo se restringe aparte, solo a Root/Super Root.
 * Venta, pago, ingreso en Caja General y cierre de la orden ocurren en una sola
 * transacción: si algo falla (ej. no hay turno de caja abierto), todo se revierte.
 */
export async function cerrarOrden(ordenId: string, input: CerrarOrdenInput, usuarioId: string, rolId: number) {
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
    const totalBruto = items.reduce((acc, i) => acc + i.subtotal, 0);

    // Descuento y "administrativo" solo existen en el cobro SIMPLE (no
    // dividido) — ver comentario en migao.schema.ts::cerrarOrdenSchema.
    const descuentoPorcentaje = !input.dividir ? (input.descuentoPorcentaje ?? 0) : 0;
    const total = totalBruto * (1 - descuentoPorcentaje / 100);
    const descuentoMonto = totalBruto - total;

    if (!input.dividir && input.metodoPago === "administrativo") {
      if (!(await tienePermiso(rolId, "migao.ordenes.pago_administrativo"))) {
        throw Errors.forbidden("No tiene permiso para cerrar una cuenta como pago administrativo");
      }
    }

    if (input.dividir) {
      // Cada producto se reparte por UNIDADES, no por ítem completo: "2x
      // Americano" puede repartirse 1 unidad a cada persona. La suma de
      // cantidades asignadas a un mismo itemId, entre todas las partes, debe
      // ser EXACTAMENTE su cantidad real — ni de más ni de menos. Se valida
      // ANTES de escribir nada, para no crear una venta a medias.
      const cantidadPorItem = new Map(items.map((i) => [Number(i.id), Number(i.cantidad)]));
      const asignadoPorItem = new Map<number, number>();
      for (const parte of input.partes) {
        for (const u of parte.unidades) {
          if (!cantidadPorItem.has(u.itemId)) {
            throw Errors.badRequest(`El producto ${u.itemId} no pertenece a esta orden o está cancelado`);
          }
          asignadoPorItem.set(u.itemId, (asignadoPorItem.get(u.itemId) ?? 0) + u.cantidad);
        }
      }
      for (const [itemId, cantidadReal] of cantidadPorItem) {
        const asignado = asignadoPorItem.get(itemId) ?? 0;
        if (Math.abs(asignado - cantidadReal) > 0.001) {
          throw Errors.badRequest(
            `El producto ${itemId} debe quedar completamente asignado (cantidad ${cantidadReal}, se asignó ${asignado})`,
          );
        }
      }
      // Si una parte es mixta, sus dos montos deben sumar justo el subtotal de
      // SUS unidades (calculado del lado del servidor, no lo que mande el cliente).
      for (const [idx, parte] of input.partes.entries()) {
        if (parte.metodoPago !== "mixto") continue;
        const montoParte = calcularMontoPorUnidades(items, parte.unidades);
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
      subtotal: totalBruto,
      descuento: descuentoMonto,
      descuentoPorcentaje,
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
        const montoParte = calcularMontoPorUnidades(items, parte.unidades);
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
    } else if (input.metodoPago === "administrativo") {
      // Sin cajaService.registrarIngreso: esta cuenta NO genera ingreso real en
      // Caja General — queda solo en el historial administrativo (ver
      // listOrdenesHistorialAdministrativo).
      await repo.crearPago(client, {
        ordenId,
        ventaId: venta.id,
        metodoPago: "administrativo",
        monto: total,
        referencia: input.referencia,
        usuarioId,
      });
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

        // El % de descuento se pasa tal cual: registrarIngreso ya calcula el
        // "monto sin descuento" proporcional a cada línea (efectivo/banco).
        await cajaService.registrarIngreso(
          {
            moduloOrigenSlug: "migao",
            monto: linea.monto,
            metodoPago: linea.metodoPago,
            referenciaEntidad: "ventas",
            referenciaId: venta.id,
            descuentoPorcentaje: descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
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
