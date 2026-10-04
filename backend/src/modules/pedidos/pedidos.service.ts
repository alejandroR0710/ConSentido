import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { deltaEcommerce, getProductoParaVenta, reponerStock } from "../con_sentido/con_sentido.repository";
import { descontarParaVenta, motivoVenta } from "../con_sentido/stock-venta";
import { encolarDeltaStock, programarEnvio } from "../integracion_ecommerce/salida";
import { exigirReferenciaBanco } from "../../shared/utils/pago-mixto";
import * as repo from "./pedidos.repository";
import {
  CambiarEstadoPedidoInput,
  CrearPedidoInput,
  EditarPedidoInput,
  RegistrarAbonoPedidoInput,
} from "./pedidos.schema";

// Transiciones válidas — nunca se salta un paso ni se retrocede (salvo
// cancelar, posible desde cualquier estado no terminal).
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  pendiente: ["alistado", "cancelado"],
  alistado: ["enviado", "cancelado"],
  enviado: ["entregado"],
  entregado: [],
  cancelado: [],
};

const TIMESTAMP_POR_ESTADO: Record<string, "alistado_en" | "enviado_en" | "entregado_en" | undefined> = {
  alistado: "alistado_en",
  enviado: "enviado_en",
  entregado: "entregado_en",
};

async function calcularProximaAlarma(): Promise<Date> {
  const { intervalo_alarma_minutos } = await repo.getParametros();
  return new Date(Date.now() + Number(intervalo_alarma_minutos) * 60_000);
}

async function construirDetallePedido(pedidoId: string) {
  const [pedido, items, abonos, historial] = await Promise.all([
    repo.getPedidoById(pedidoId),
    repo.getItemsPorPedido(pedidoId),
    repo.getAbonosPorPedido(pedidoId),
    repo.getHistorialPorPedido(pedidoId),
  ]);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");
  const totalAbonado = abonos.reduce((acc, a) => acc + Number(a.monto), 0);
  return {
    ...pedido,
    items,
    abonos,
    historial,
    totalAbonado,
    saldoPendiente: Number(pedido.precio_acordado) - totalAbonado,
  };
}

export async function listarPedidos(filtros: repo.FiltrosListarPedidos) {
  return repo.listPedidos(filtros);
}

export async function obtenerPedido(id: string) {
  return construirDetallePedido(id);
}

/**
 * Crea el pedido con sus ítems, en una sola transacción. Si trae abono
 * inicial, también se registra su ingreso en Caja General en la MISMA
 * transacción — si no hay turno abierto, se revierte todo el pedido (mismo
 * criterio que con_sentido.service.ts::registrarVenta).
 */
export async function crearPedido(input: CrearPedidoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Cada ítem de catálogo trae su nombre/sku/costo de referencia — el
    // precioUnitario que cobra lo decide quien registra el pedido (puede
    // diferir del precio de catálogo, igual que en Con Sentido).
    const itemsResueltos = [];
    let costoEstimado = 0;
    let precioAcordado = 0;
    for (const item of input.items) {
      let productoId: string | null = null;
      let sku: string | null = null;
      if (item.productoId) {
        const producto = await repo.getProductoInfo(item.productoId);
        if (!producto) throw Errors.badRequest(`El producto "${item.nombre}" ya no está en el catálogo`);
        productoId = producto.id;
        sku = producto.sku ?? null;
        costoEstimado += Number(producto.costo ?? 0) * item.cantidad;
      }
      precioAcordado += item.precioUnitario * item.cantidad;
      itemsResueltos.push({ productoId, sku, nombre: item.nombre, cantidad: item.cantidad, precioUnitario: item.precioUnitario });
    }

    const descripcion = input.descripcion?.trim() || input.items.map((i) => i.nombre).join(", ");
    const proximaAlarmaEn = await calcularProximaAlarma();

    const pedido = await repo.crearPedido(client, {
      clienteId: input.clienteId ?? null,
      descripcion,
      fechaEntrega: input.fechaEntrega,
      destinatarioNombre: input.destinatarioNombre,
      destinatarioDocumento: input.destinatarioDocumento,
      destinatarioTelefono: input.destinatarioTelefono,
      direccionEnvio: input.direccionEnvio,
      ciudadEnvio: input.ciudadEnvio,
      notasEntrega: input.notasEntrega,
      costoEstimado,
      precioAcordado,
      responsableId: input.responsableId ?? null,
      creadoPorId: usuarioId,
      proximaAlarmaEn,
    });

    await repo.crearPedidoItems(client, pedido.id, itemsResueltos);
    await repo.insertHistorial(client, { pedidoId: pedido.id, accion: "creado", usuarioId });

    if (input.abonoInicial) {
      if (input.abonoInicial.monto > precioAcordado) {
        throw Errors.badRequest("El abono inicial no puede ser mayor al total del pedido");
      }
      const referenciaBanco = exigirReferenciaBanco(
        input.abonoInicial.metodoPago === "banco" ? input.abonoInicial.monto : 0,
        input.abonoInicial.referenciaBanco,
      );
      const abono = await repo.crearAbono(client, {
        pedidoId: pedido.id,
        monto: input.abonoInicial.monto,
        metodoPago: input.abonoInicial.metodoPago,
        usuarioId,
      });
      await cajaService.registrarIngreso(
        {
          moduloOrigenSlug: "pedidos",
          motivo: `Abono pedido — ${descripcion}`,
          referenciaEntidad: "pedido_abonos",
          referenciaId: abono.id,
          metodoPago: input.abonoInicial.metodoPago,
          monto: input.abonoInicial.monto,
          referenciaBanco,
        },
        usuarioId,
        client,
      );
      await repo.insertHistorial(client, {
        pedidoId: pedido.id,
        accion: "abono",
        detalle: { monto: input.abonoInicial.monto, metodoPago: input.abonoInicial.metodoPago },
        usuarioId,
      });
    }

    await client.query("COMMIT");
    return construirDetallePedido(pedido.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function editarPedido(id: string, input: EditarPedidoInput, usuarioId: string) {
  const pedido = await repo.getPedidoById(id);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");
  if (pedido.estado === "entregado" || pedido.estado === "cancelado") {
    throw Errors.conflict("No se puede editar un pedido ya entregado o cancelado");
  }
  const actualizadoId = await repo.actualizarPedido(id, input);
  if (!actualizadoId) throw Errors.notFound("Pedido no encontrado");
  await repo.insertHistorial(pool, { pedidoId: id, accion: "edicion", usuarioId });
  return construirDetallePedido(id);
}

/**
 * Cambia el estado del pedido. Al pasar a `alistado` descuenta el stock de
 * cada ítem de catálogo (reusando exactamente la misma lógica de Con
 * Sentido: si queda en negativo, exige observación). Al cancelar un pedido
 * que ya estaba `alistado`, devuelve ese stock. La alarma se reprograma o se
 * apaga según el estado destino (ver TIMESTAMP_POR_ESTADO y la lista de
 * estados "en alarma" en pedidos.repository.ts::listPedidosVencidos).
 */
export async function cambiarEstadoPedido(id: string, input: CambiarEstadoPedidoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pedido = await repo.getPedidoParaCambiarEstado(client, id);
    if (!pedido) throw Errors.notFound("Pedido no encontrado");

    const destinosValidos = TRANSICIONES_VALIDAS[pedido.estado] ?? [];
    if (!destinosValidos.includes(input.estado)) {
      throw Errors.conflict(`No se puede pasar de "${pedido.estado}" a "${input.estado}"`);
    }

    // Transportadora/guía no se piden al crear el pedido — se vuelven
    // obligatorias justo al despachar, salvo que ya se hayan guardado antes
    // vía una edición (PATCH /pedidos/:id).
    if (input.estado === "enviado") {
      const transportadora = input.transportadora || pedido.transportadora;
      const numeroGuia = input.numeroGuia || pedido.numero_guia;
      if (!transportadora || !numeroGuia) {
        throw Errors.badRequest("Para marcar como enviado hace falta la transportadora y el número de guía");
      }
    }

    // Observaciones de inventario negativo por ítem (si las hubo) — se
    // guardan en el historial para no perder por qué quedó en negativo cada
    // producto (antes se usaban solo para el aviso al e-commerce y se
    // descartaban, ver Review Focus del plan).
    const observacionesInventario: Record<string, string> = {};

    if (input.estado === "alistado") {
      const items = await repo.getItemsPorPedido(id, client);
      for (const item of items) {
        if (!item.producto_id) continue;
        const descontado = await descontarParaVenta(client, {
          productoId: item.producto_id,
          cantidad: Number(item.cantidad),
          nombre: item.nombre,
          observacion: input.observacionInventario,
        });
        if (!descontado) continue; // ya no está en el catálogo — no bloquea el alistamiento
        if (descontado.observacion) observacionesInventario[item.nombre] = descontado.observacion;
        if (descontado.producto.ecommerce_product_id && descontado.deltaEcommerce !== 0) {
          await encolarDeltaStock(client, {
            productId: descontado.producto.ecommerce_product_id,
            variantId: descontado.producto.ecommerce_variant_id ?? null,
            sku: descontado.producto.sku,
            delta: descontado.deltaEcommerce,
            kind: "SALE",
            reason: motivoVenta(`Pedido alistado — ${pedido.descripcion}`, descontado.observacion),
          });
          programarEnvio();
        }
      }
    }

    if (input.estado === "cancelado" && pedido.estado === "alistado") {
      const items = await repo.getItemsPorPedido(id, client);
      for (const item of items) {
        if (!item.producto_id) continue;
        const producto = await getProductoParaVenta(client, item.producto_id);
        if (!producto) continue;
        await reponerStock(client, producto.id, Number(item.cantidad));
        const delta = deltaEcommerce(producto.stock, producto.stock + Number(item.cantidad));
        if (producto.ecommerce_product_id && delta !== 0) {
          await encolarDeltaStock(client, {
            productId: producto.ecommerce_product_id,
            variantId: producto.ecommerce_variant_id ?? null,
            sku: producto.sku,
            delta,
            kind: "RETURN",
            reason: `Pedido cancelado — ${pedido.descripcion}`,
          });
          programarEnvio();
        }
      }
    }

    // La alarma solo sigue activa en pendiente/alistado (ver Global Constraints).
    const siguienteAlarma =
      input.estado === "alistado" ? await calcularProximaAlarma() : null;

    await repo.actualizarEstadoPedido(client, id, {
      estado: input.estado,
      timestampCampo: TIMESTAMP_POR_ESTADO[input.estado],
      proximaAlarmaEn: siguienteAlarma,
      transportadora: input.transportadora,
      numeroGuia: input.numeroGuia,
    });
    await repo.insertHistorial(client, {
      pedidoId: id,
      accion: "cambio_estado",
      detalle: {
        de: pedido.estado,
        a: input.estado,
        ...(Object.keys(observacionesInventario).length ? { observacionesInventario } : {}),
      },
      usuarioId,
    });

    await client.query("COMMIT");
    return construirDetallePedido(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function registrarAbono(id: string, input: RegistrarAbonoPedidoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE: bloquea la fila hasta el COMMIT, para que dos abonos
    // simultáneos (doble clic, dos cajeros) no lean el mismo saldo pendiente
    // y ambos pasen la validación de abajo.
    const pedido = await repo.getPedidoParaCambiarEstado(client, id);
    if (!pedido) throw Errors.notFound("Pedido no encontrado");
    if (pedido.estado === "cancelado") throw Errors.conflict("Este pedido está cancelado");

    const totalAbonado = await repo.sumAbonosPorPedido(id, client);
    const saldoPendiente = Number(pedido.precio_acordado) - totalAbonado;
    if (input.monto > saldoPendiente) {
      throw Errors.badRequest(`El abono (${input.monto}) es mayor al saldo pendiente (${saldoPendiente})`);
    }

    const referenciaBanco = exigirReferenciaBanco(
      input.metodoPago === "banco" ? input.monto : 0,
      input.referenciaBanco,
    );
    const abono = await repo.crearAbono(client, {
      pedidoId: id,
      monto: input.monto,
      metodoPago: input.metodoPago,
      usuarioId,
    });
    await cajaService.registrarIngreso(
      {
        moduloOrigenSlug: "pedidos",
        motivo: `Abono pedido — ${pedido.descripcion}`,
        referenciaEntidad: "pedido_abonos",
        referenciaId: abono.id,
        metodoPago: input.metodoPago,
        monto: input.monto,
        referenciaBanco,
      },
      usuarioId,
      client,
    );
    await repo.insertHistorial(client, {
      pedidoId: id,
      accion: "abono",
      detalle: { monto: input.monto, metodoPago: input.metodoPago },
      usuarioId,
    });

    await client.query("COMMIT");
    return construirDetallePedido(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const obtenerParametros = () => repo.getParametros();
export const actualizarParametros = (intervaloAlarmaMinutos: number) => repo.actualizarParametros(intervaloAlarmaMinutos);

/** Usada por el chequeo periódico de alarmas (Task 6) — nunca por una ruta HTTP. */
export const listarPedidosVencidos = () => repo.listPedidosVencidos();

/**
 * Factura imprimible del pedido — mismo formato normalizado que
 * con_sentido.service.ts::obtenerFacturaVenta (mesa/mesero/comensal/propina
 * quedan null, acá no aplican) para reusar el mismo componente de impresión
 * del frontend. Sin descuento en este flujo: subtotal y total son iguales.
 */
export async function obtenerFacturaPedido(id: string) {
  const pedido = await repo.getPedidoById(id);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");

  const [items, abonos] = await Promise.all([repo.getItemsPorPedido(id), repo.getAbonosPorPedido(id)]);
  const monto = Number(pedido.precio_acordado);
  const factura = await repo.getOrCrearFacturaPedido({ pedidoId: id, subtotal: monto, total: monto });

  return {
    numeroFactura: factura.numero as string,
    fecha: pedido.created_at as string,
    mesaNumero: null,
    mesaPiso: null,
    meseroNombre: null,
    comensalNumero: null,
    items: items.map((i) => ({
      productoNombre: i.nombre as string,
      sku: i.sku as string | null,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
    })),
    subtotal: monto,
    descuentoPorcentaje: 0,
    descuentoMonto: 0,
    total: monto,
    pagos: abonos.map((a) => ({ metodoPago: a.metodo_pago as string, monto: Number(a.monto), referencia: null as string | null })),
    propina: null,
  };
}
