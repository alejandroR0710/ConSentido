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
  CrearCotizacionInput,
  CrearMesaInput,
  CrearOrdenInput,
  CrearProductoInput,
  EditarItemInput,
  EditarMesaInput,
  EditarProductoInput,
  IniciarCobroInput,
  PagarItemsInput,
  PosicionMesaInput,
  RegistrarAbonoInput,
  RepartirPropinasInput,
} from "./migao.schema";

// Quiénes deben enterarse de un aviso de stock (bajo o agotado) sin importar
// quién haya sido el mesero/cocina que disparó el consumo — Root/Super Root
// porque administran el negocio, Cocina porque administra el inventario
// (ver migao.inventario.administrar).
const ROLES_ALERTA_INVENTARIO = ["Root", "Super Root", "Cocina"];

/** Avisa por push a los roles de arriba cuando un consumo de inventario deja
 *  algo en negativo — nunca lanza, nunca bloquea el flujo de la orden. */
function notificarAlertasInventario(alertas: string[]) {
  if (alertas.length === 0) return;
  const cuerpo = alertas.join(" ");
  for (const rol of ROLES_ALERTA_INVENTARIO) {
    notificacionesService
      .enviarATodosDeRol(rol, { titulo: "⚠ Stock de inventario", cuerpo, url: "/migao/inventario" })
      .catch(() => {});
  }
}

export async function listarCategorias() {
  return repo.listCategoriasProducto();
}

export async function crearCategoria(nombre: string) {
  return repo.crearCategoriaProducto(nombre);
}

export async function listarMesas() {
  return repo.listMesas();
}

export async function crearMesa(input: CrearMesaInput) {
  return repo.crearMesaConLayout(input);
}

export async function moverMesa(id: number, input: PosicionMesaInput) {
  const actualizada = await repo.actualizarPosicionMesa(id, input);
  if (!actualizada) throw Errors.notFound("Mesa no encontrada");
  return actualizada;
}

export async function editarMesa(id: number, input: EditarMesaInput) {
  try {
    const actualizada = await repo.actualizarDetalleMesa(id, input);
    if (!actualizada) throw Errors.notFound("Mesa no encontrada");
    return actualizada;
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "23505") {
      throw Errors.conflict("Ya existe una mesa con ese número en esa área");
    }
    throw err;
  }
}

/** Borrado real — solo funciona si la mesa nunca fue referenciada por ninguna
 *  orden (abierta o histórica); si no, usa "Desactivar" (editarMesa con
 *  activo:false) para ocultarla del plano sin romper el historial. */
export async function eliminarMesa(id: number) {
  try {
    const borrada = await repo.eliminarMesa(id);
    if (!borrada) throw Errors.notFound("Mesa no encontrada");
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "23503") {
      throw Errors.conflict(
        'No se puede eliminar: ya tiene órdenes asociadas. Usa "Desactivar" en su lugar.',
      );
    }
    throw err;
  }
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

export async function listarPropinas() {
  return repo.listPropinas();
}

/** Pendiente de repartir por día, efectivo y banco desglosados — el panel de
 *  reparto lo usa para dejar elegir qué días concretos (una semana completa
 *  o sueltos) entran en el reparto. */
export async function listarPendientesPropinasPorDia() {
  return repo.listPendientesPropinasPorDia();
}

/** Propinas de HOY, efectivo y banco — usado en el resumen de Caja General
 *  (cuadro aparte, esta plata nunca cuenta para el cuadre de Caja). */
export async function obtenerPropinasDeHoy() {
  return repo.sumPropinasDeHoy();
}

/** Reparte (liquida) las propinas pendientes — un solo reparto cubre
 *  efectivo y banco a la vez, cada `entrega` elige su propio método de pago
 *  (en qué se le entrega a ESA persona, sin importar en qué método vino la
 *  propina original). Si `fechas` viene, solo cuenta lo pendiente de esos
 *  días (hora Colombia); si no, es TODO lo pendiente (comportamiento
 *  original). Nunca borra migao_propinas: las marca como liquidadas, así el
 *  "pendiente por repartir" de esos días baja sin perder el historial de
 *  cada propina individual. La suma de las entregas en efectivo tiene que
 *  dar EXACTAMENTE el pendiente en efectivo, y lo mismo para banco — cada
 *  método sigue cuadrando aparte, aunque el reparto sea uno solo. */
export async function repartirPropinas(usuarioId: string, input: RepartirPropinasInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pendiente = await repo.sumPropinasPendientes(client, input.fechas);
    if (pendiente.efectivo <= 0 && pendiente.banco <= 0) {
      throw Errors.conflict(
        `No hay propinas pendientes${input.fechas?.length ? " en los días seleccionados" : ""} por repartir`,
      );
    }

    const sumaEfectivo = input.entregas.filter((e) => e.metodoPago === "efectivo").reduce((acc, e) => acc + e.monto, 0);
    const sumaBanco = input.entregas.filter((e) => e.metodoPago === "banco").reduce((acc, e) => acc + e.monto, 0);
    if (Math.abs(sumaEfectivo - pendiente.efectivo) > 0.01) {
      throw Errors.badRequest(
        `Las entregas en efectivo (${sumaEfectivo}) deben sumar igual al pendiente en efectivo (${pendiente.efectivo})`,
      );
    }
    if (Math.abs(sumaBanco - pendiente.banco) > 0.01) {
      throw Errors.badRequest(
        `Las entregas en banco (${sumaBanco}) deben sumar igual al pendiente en banco (${pendiente.banco})`,
      );
    }

    const fechasOrdenadas = input.fechas?.length ? [...input.fechas].sort() : null;
    const liquidacion = await repo.crearLiquidacionPropinas(client, {
      montoEfectivo: pendiente.efectivo,
      montoBanco: pendiente.banco,
      nota: input.nota,
      usuarioId,
      fechaDesde: fechasOrdenadas?.[0] ?? null,
      fechaHasta: fechasOrdenadas?.at(-1) ?? null,
    });

    await repo.marcarPropinasLiquidadas(client, {
      liquidacionId: liquidacion.id,
      fechas: input.fechas,
    });

    const entregas = [];
    for (const entrega of input.entregas) {
      entregas.push(
        await repo.crearEntregaPropina(client, {
          liquidacionId: liquidacion.id,
          nombrePersona: entrega.nombrePersona,
          metodoPago: entrega.metodoPago,
          monto: entrega.monto,
          fechaEntrega: entrega.fechaEntrega,
          motivo: entrega.motivo,
          usuarioId,
        }),
      );
    }

    await client.query("COMMIT");
    return { ...liquidacion, entregas };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Historial de a quién se le entregó cuánto, en todas las liquidaciones —
 *  pantalla aparte del historial de propinas individuales por cuenta. */
export async function listarEntregasPropinas() {
  return repo.listEntregasPropinas();
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
      // El consumo de inventario ya NO pasa acá: se descuenta recién cuando
      // Cocina marca el producto como "listo" (ver marcarOrdenLista) — ahí
      // es cuando de verdad se usó el ingrediente, no al solo pedirlo.
    }

    await client.query("COMMIT");
    // Aviso push a Cocina (aunque tenga la pestaña cerrada) — nunca debe
    // romper la creación de la orden si el push falla.
    notificacionesService
      .enviarATodosDeRol("Cocina", { titulo: "Pedido nuevo", cuerpo: `Mesa ${mesa.numero}`, url: "/cocina" })
      .catch(() => {});
    return { ...orden, alertasInventario: [] as string[] };
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
  // Los productos "para llevar" (envases) nunca pasan por Cocina — se quedan
  // en 'pendiente' para siempre (ver el filtro es_para_llevar en
  // listItemsCocina), así que nunca llegarían a "listo" para descontar ahí.
  // Para esos, el consumo se aplica de una vez al agregarlos.
  consumirInmediato = false,
) {
  const orden = await repo.getOrdenById(ordenId);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    throw Errors.conflict("No se pueden agregar productos a una orden cerrada o cancelada");
  }
  // Ya se inició el cobro CON EL MOTOR DE PARTES (dividir cuenta/pago
  // parcial) — cambiar los productos ahora invalidaría los montos ya
  // fijados por parte (ver migao_cuenta_partes.monto_debido). No bloquea si
  // solo hay cobros de "productos sueltos" (pagarItems): esos SÍ permiten
  // seguir agregando productos nuevos a la misma mesa mientras tanto.
  if (await repo.existeCobroDivididoAbierto(ordenId)) {
    throw Errors.conflict("Esta cuenta ya tiene pagos registrados, no se pueden agregar más productos");
  }

  const client = await pool.connect();
  let item;
  let alertasInventario: string[] = [];
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
    if (consumirInmediato) {
      alertasInventario = await inventarioService.aplicarConsumoPorProducto(
        client,
        input.productoId,
        input.cantidad,
        usuarioId,
        item.id,
      );
    }
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
  notificarAlertasInventario(alertasInventario);
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
  // filtro es_para_llevar en migao.repository.ts::listItemsCocina), así que
  // nunca pasará por marcarOrdenLista — el consumo se aplica de una vez.
  return agregarItem(ordenId, input, usuarioId, false, true);
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

  // El consumo de inventario ya se aplicó si Cocina ya marcó este ítem como
  // "listo" (ver marcarOrdenLista), o si es un cargo "para llevar" (esos se
  // consumen de una vez al agregarlos, nunca pasan por Cocina). En cualquier
  // otro estado (pendiente/preparando) todavía no se tocó el inventario, así
  // que no hay nada que revertir aquí: updateItemCantidad deja el ítem en
  // 'pendiente' de nuevo y se consumirá, ya con la cantidad correcta, cuando
  // de verdad llegue a "listo".
  const producto = await repo.getProductoMigaoById(item.producto_id);
  const yaConsumido = item.estado === "listo" || Boolean(producto?.es_para_llevar);

  const client = await pool.connect();
  let actualizado;
  let alertasInventario: string[] = [];
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
      if (yaConsumido) {
        // Se devuelve TODO lo que ese ítem había consumido (delta negativo =
        // el stock sube).
        alertasInventario = await inventarioService.aplicarConsumoPorProducto(
          client,
          item.producto_id,
          -Number(item.cantidad),
          usuarioId,
          Number(itemId),
        );
      }
    } else if (input.cantidad !== undefined) {
      actualizado = await repo.updateItemCantidad(itemId, input.cantidad, input.observaciones, client);
      await repo.insertHistorial(client, {
        ordenId: item.orden_id,
        ordenItemId: Number(itemId),
        accion: "item_editado",
        detalle: { cantidadAnterior: item.cantidad, cantidadNueva: input.cantidad, estadoAnterior: item.estado },
        usuarioId,
      });
      if (producto?.es_para_llevar) {
        // Estos nunca vuelven a pasar por marcarOrdenLista, así que se ajusta
        // ahora mismo solo el DELTA entre la cantidad vieja y la nueva.
        alertasInventario = await inventarioService.aplicarConsumoPorProducto(
          client,
          item.producto_id,
          input.cantidad - Number(item.cantidad),
          usuarioId,
          Number(itemId),
        );
      } else if (item.estado === "listo") {
        // updateItemCantidad regresa el ítem a 'pendiente': se volverá a
        // preparar y a consumir COMPLETO (ya con la cantidad corregida) la
        // próxima vez que cocina lo marque listo — por eso acá se revierte
        // TODO lo que ya se había consumido, no solo el delta, para no
        // duplicar el descuento cuando eso vuelva a pasar.
        alertasInventario = await inventarioService.aplicarConsumoPorProducto(
          client,
          item.producto_id,
          -Number(item.cantidad),
          usuarioId,
          Number(itemId),
        );
      }
      // Si seguía pendiente/preparando, todavía no se había consumido nada:
      // se consumirá por primera vez, ya con la cantidad correcta, al llegar a "listo".
    } else {
      // Solo se corrigió la observación (nota para cocina): la cantidad y el
      // estado del ítem no cambian, así que el inventario no se toca.
      actualizado = await repo.updateItemObservaciones(itemId, input.observaciones!, client);
      await repo.insertHistorial(client, {
        ordenId: item.orden_id,
        ordenItemId: Number(itemId),
        accion: "item_editado",
        detalle: { observacionAnterior: item.observaciones, observacionNueva: input.observaciones },
        usuarioId,
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  notificarAlertasInventario(alertasInventario);
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

/**
 * Cuánto de la CUENTA (sin la propina) entró de verdad en efectivo vs. en
 * banco — se usa tanto para registrar el ingreso real en Caja General como
 * para repartir la propina en esa misma proporción (ver cerrarOrden). Cubre
 * las 4 formas de pagar: simple puro, simple mixto, dividida (suma cada
 * parte, cada una puede ser pura o mixta) y administrativo (sin pago real, {0,0}).
 *
 * En el cobro simple mixto, lo que el cajero escribe en efectivo/banco es lo
 * que el cliente entregó de verdad — eso incluye la propina si hay (ver
 * migao.schema.ts::cerrarOrdenSchema, ahí se valida que la suma dé
 * total+propina). Por eso acá se reparte `total` proporcional a esos dos
 * montos, en vez de usarlos tal cual: si se usaran tal cual, la propina se
 * colaría como ingreso de Caja General.
 */
function calcularTotalesPorMetodo<T extends { id: unknown; precio_unitario: string }>(
  input: CerrarOrdenInput,
  items: T[],
  total: number,
): { efectivo: number; banco: number } {
  if (input.dividir) {
    let efectivo = 0;
    let banco = 0;
    for (const parte of input.partes) {
      if (parte.metodoPago === "mixto") {
        efectivo += parte.montoEfectivo;
        banco += parte.montoBanco;
      } else {
        const montoParte = calcularMontoPorUnidades(items, parte.unidades);
        if (parte.metodoPago === "efectivo") efectivo += montoParte;
        else banco += montoParte;
      }
    }
    return { efectivo, banco };
  }
  if (input.metodoPago === "mixto") {
    const entregado = input.montoEfectivo + input.montoBanco;
    if (entregado <= 0) return { efectivo: 0, banco: 0 };
    const efectivo = Math.round(total * (input.montoEfectivo / entregado));
    return { efectivo, banco: total - efectivo };
  }
  if (input.metodoPago === "efectivo") return { efectivo: total, banco: 0 };
  if (input.metodoPago === "banco") return { efectivo: 0, banco: total };
  return { efectivo: 0, banco: 0 }; // administrativo: no hay pago real, se maneja aparte
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
  // Los cargos "para llevar" (envases) nunca pasan por Cocina — ni aparecen en
  // su cola ni llegan a "preparando" (ver el filtro en empezarPreparar), así
  // que tampoco deben contar acá: de lo contrario esta orden quedaría
  // bloqueada para siempre esperando un check que Cocina jamás puede poner.
  const activos = items.filter(
    (i) => !i.es_para_llevar && i.estado !== "cancelado" && i.estado !== "servido" && i.estado !== "listo",
  );

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
  const alertasInventario: string[] = [];
  try {
    await client.query("BEGIN");
    const actualizados = await repo.marcarItemsListos(ordenId, client);
    // Marca de tiempo de cierre para el tiempo de preparación (ver item_preparando arriba).
    for (const item of actualizados) {
      await repo.insertHistorial(client, { ordenId, ordenItemId: item.id, accion: "item_listo", usuarioId });
      // Recién ahora el producto de verdad "salió de cocina": se descuentan
      // sus ingredientes de inventario (si no tiene receta, no hace nada) —
      // nunca bloquea, solo devuelve un aviso si el stock queda en negativo.
      alertasInventario.push(
        ...(await inventarioService.aplicarConsumoPorProducto(
          client,
          item.producto_id,
          Number(item.cantidad),
          usuarioId,
          item.id,
        )),
      );
    }
    await client.query("COMMIT");
    if (orden.mesero_id) {
      notificacionesService
        .enviarAUsuario(orden.mesero_id, { titulo: "Orden lista", cuerpo: "Una orden tuya ya está lista", url: "/mesero" })
        .catch(() => {});
    }
    notificarAlertasInventario(alertasInventario);
    return { items: actualizados, alertasInventario };
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
  // Los ítems cancelados o ya pagados sueltos (ver pagarItems) se siguen
  // mostrando (para que quede el registro de qué había), pero no deben
  // sumar al total todavía por cobrar.
  const total = itemsConSubtotal
    .filter((i) => i.estado !== "cancelado" && !i.venta_id)
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

    // Los ítems cancelados no se cobran; los ya pagados sueltos (ver
    // pagarItems) tampoco — esta cuenta cobra lo que quede pendiente, sea
    // todo o solo el resto de lo que ya se fue pagando de a poco.
    const items = calcularItemsConSubtotal(itemsRaw).filter((i) => i.estado !== "cancelado" && !i.venta_id);
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
      // Lo que el cajero escribe acá es lo que el cliente entregó de verdad
      // (efectivo + tarjeta/transferencia) — si hay propina, esa plata
      // también viene incluida en esos dos montos, no solo la cuenta.
      const totalConPropina = total + (input.propina && input.propina > 0 ? input.propina : 0);
      if (Math.abs(input.montoEfectivo + input.montoBanco - totalConPropina) > 0.01) {
        throw Errors.badRequest(
          `La suma de efectivo + banco debe ser igual al total${input.propina ? " con propina incluida" : ""} (${totalConPropina})`,
        );
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

    // Factura: se genera acá mismo, al cerrar, no cuando alguien la pide para
    // imprimir — así CUALQUIER venta ya tiene su número (F-000123) desde el
    // momento en que se cobra, y ese número puede mostrarse de una en el
    // historial sin depender de que alguien haya apretado "Factura" antes
    // (útil para ubicar una venta rápido si llega un reclamo).
    await repo.getOrCrearFactura({ ventaId: venta.id, ordenId, subtotal: totalBruto, total }, client);

    // Propina: se reparte SIEMPRE en la misma proporción efectivo/banco en la
    // que de verdad entró el pago de la cuenta (una cuenta mixta 60%
    // efectivo/40% banco reparte la propina 60/40 también) — nunca hay que
    // preguntarle al cajero, el backend lo calcula solo a partir de cómo se
    // pagó. Puede terminar en 1 o 2 registros (uno por método), sin importar
    // si la cuenta se dividió o no — dinero del mesero, nunca entra a
    // cajaService.registrarIngreso ni a la validación de mixto de arriba.
    // Única excepción: pago "administrativo" no tiene un pago real detrás,
    // ahí sigue siendo el cajero quien elige el método a mano.
    if (input.propina && input.propina > 0) {
      const esAdministrativo = !input.dividir && input.metodoPago === "administrativo";
      if (esAdministrativo) {
        await repo.crearPropina(client, {
          ordenId,
          ventaId: venta.id,
          meseroId: orden.mesero_id,
          usuarioId,
          monto: input.propina,
          porcentaje: input.propinaPorcentaje ?? null,
          metodoPago: input.propinaMetodoPago ?? "efectivo",
        });
      } else {
        const { efectivo: efectivoRecibido, banco: bancoRecibido } = calcularTotalesPorMetodo(input, items, total);
        const totalRecibido = efectivoRecibido + bancoRecibido;
        const propinaEfectivo =
          totalRecibido > 0 ? Math.round((input.propina * efectivoRecibido) / totalRecibido) : input.propina;
        const propinaBanco = input.propina - propinaEfectivo;

        if (propinaEfectivo > 0) {
          await repo.crearPropina(client, {
            ordenId,
            ventaId: venta.id,
            meseroId: orden.mesero_id,
            usuarioId,
            monto: propinaEfectivo,
            porcentaje: input.propinaPorcentaje ?? null,
            metodoPago: "efectivo",
          });
        }
        if (propinaBanco > 0) {
          await repo.crearPropina(client, {
            ordenId,
            ventaId: venta.id,
            meseroId: orden.mesero_id,
            usuarioId,
            monto: propinaBanco,
            porcentaje: input.propinaPorcentaje ?? null,
            metodoPago: "banco",
          });
        }
      }
    }

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
      // Ojo: en mixto, input.montoEfectivo/montoBanco es lo que el cliente
      // entregó de verdad (puede incluir propina) — para Caja General se usa
      // SOLO la porción de la cuenta (calcularTotalesPorMetodo ya la separa),
      // nunca los montos crudos, o la propina se colaría como ingreso.
      const lineas =
        input.metodoPago === "mixto"
          ? (() => {
              const { efectivo, banco } = calcularTotalesPorMetodo(input, items, total);
              return descomponerPago({ metodoPago: "mixto", montoEfectivo: efectivo, montoBanco: banco });
            })()
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
 * Cobra solo ALGUNOS productos de una cuenta que sigue abierta — genera su
 * propia venta + factura independiente de esos productos (con su propio
 * número de factura), los marca pagados (orden_items.venta_id) y la mesa
 * sigue aceptando productos nuevos mientras queden ítems sin cobrar. Si con
 * este pago ya no queda nada pendiente, la orden se cierra sola — mismo
 * criterio que el motor de partes, pero item por item en vez de partes
 * fijadas de antemano.
 *
 * No se puede combinar con "dividir cuenta"/"pago parcial" (motor de
 * partes) para la misma orden — ver agregarItem, que sí bloquea ese otro
 * motor si ya se usó, y viceversa esta función revisa lo mismo.
 */
export async function pagarItems(ordenId: string, input: PagarItemsInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orden = await repo.getOrdenById(ordenId, client, true);
    if (!orden) throw Errors.notFound("Orden no encontrada");
    if (orden.estado === "cerrada") throw Errors.conflict("Esta orden ya está cerrada");
    if (orden.estado === "cancelada") throw Errors.conflict("Esta orden fue cancelada");
    if (await repo.existeCobroDivididoAbierto(ordenId)) {
      throw Errors.conflict("Esta cuenta ya se está cobrando con cuenta dividida/pago parcial — no se puede combinar");
    }

    const itemsRaw = await repo.getItemsPorOrden(ordenId, client);
    const seleccionados = itemsRaw.filter((i) => input.itemIds.includes(Number(i.id)));
    if (seleccionados.length !== input.itemIds.length) {
      throw Errors.badRequest("Algún producto seleccionado no pertenece a esta orden");
    }
    if (seleccionados.some((i) => i.estado === "cancelado")) {
      throw Errors.badRequest("No se puede cobrar un producto cancelado");
    }
    if (seleccionados.some((i) => i.venta_id)) {
      throw Errors.conflict("Alguno de estos productos ya fue pagado");
    }

    const items = calcularItemsConSubtotal(seleccionados);
    const total = items.reduce((acc, i) => acc + i.subtotal, 0);

    if (input.metodoPago === "mixto") {
      const totalConPropina = total + (input.propina && input.propina > 0 ? input.propina : 0);
      if (Math.abs(input.montoEfectivo + input.montoBanco - totalConPropina) > 0.01) {
        throw Errors.badRequest(
          `La suma de efectivo + banco debe ser igual al total${input.propina ? " con propina incluida" : ""} (${totalConPropina})`,
        );
      }
    }

    const venta = await repo.crearVenta(client, {
      clienteId: orden.cliente_id,
      usuarioId,
      ordenId,
      subtotal: total,
      descuento: 0,
      descuentoPorcentaje: 0,
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
    await repo.getOrCrearFactura({ ventaId: venta.id, ordenId, subtotal: total, total }, client);
    await repo.marcarItemsPagados(
      client,
      items.map((i) => Number(i.id)),
      venta.id,
    );

    // Cuánto de LA CUENTA (sin la propina) entró de verdad en efectivo vs.
    // banco — mismo criterio que calcularTotalesPorMetodo en cerrarOrden: en
    // mixto, lo que el cajero escribe es lo que el cliente entregó de
    // verdad (incluye la propina si hay), por eso se reparte `total`
    // proporcional a esos dos montos en vez de usarlos tal cual.
    const { efectivo: efectivoRecibido, banco: bancoRecibido } =
      input.metodoPago === "mixto"
        ? (() => {
            const entregado = input.montoEfectivo + input.montoBanco;
            if (entregado <= 0) return { efectivo: 0, banco: 0 };
            const efectivo = Math.round(total * (input.montoEfectivo / entregado));
            return { efectivo, banco: total - efectivo };
          })()
        : input.metodoPago === "efectivo"
          ? { efectivo: total, banco: 0 }
          : { efectivo: 0, banco: total };

    // Propina: se reparte en esa misma proporción efectivo/banco.
    if (input.propina && input.propina > 0) {
      const totalRecibido = efectivoRecibido + bancoRecibido;
      const propinaEfectivo =
        totalRecibido > 0 ? Math.round((input.propina * efectivoRecibido) / totalRecibido) : input.propina;
      const propinaBanco = input.propina - propinaEfectivo;

      if (propinaEfectivo > 0) {
        await repo.crearPropina(client, {
          ordenId,
          ventaId: venta.id,
          meseroId: orden.mesero_id,
          usuarioId,
          monto: propinaEfectivo,
          porcentaje: input.propinaPorcentaje ?? null,
          metodoPago: "efectivo",
        });
      }
      if (propinaBanco > 0) {
        await repo.crearPropina(client, {
          ordenId,
          ventaId: venta.id,
          meseroId: orden.mesero_id,
          usuarioId,
          monto: propinaBanco,
          porcentaje: input.propinaPorcentaje ?? null,
          metodoPago: "banco",
        });
      }
    }

    const lineas =
      input.metodoPago === "mixto"
        ? descomponerPago({ metodoPago: "mixto", montoEfectivo: efectivoRecibido, montoBanco: bancoRecibido })
        : descomponerPago({ metodoPago: input.metodoPago, monto: total });

    for (const linea of lineas) {
      await repo.crearPago(client, {
        ordenId,
        ventaId: venta.id,
        metodoPago: linea.metodoPago,
        monto: linea.monto,
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

    // Si ya no queda nada pendiente por cobrar (todo lo no cancelado ya
    // tiene venta_id), la orden se cierra sola; si no, sigue abierta para
    // que se le puedan seguir agregando productos (o pasa a 'pagando' si
    // venía 'abierta', mismo badge que el motor de partes).
    const todosLosItems = await repo.getItemsPorOrden(ordenId, client);
    const quedaPendiente = todosLosItems.some((i) => i.estado !== "cancelado" && !i.venta_id);
    if (!quedaPendiente) {
      await repo.cerrarOrdenEstado(client, ordenId);
    } else if (orden.estado === "abierta") {
      await client.query(`UPDATE ordenes SET estado = 'pagando' WHERE id = $1`, [ordenId]);
    }

    await client.query("COMMIT");
    return { venta, total, ordenCerrada: !quedaPendiente };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reparte `total` en las partes que pide `division`, validando y calculando
 * cada `montoDebido` del lado del servidor (nunca se confía en lo que mande
 * el cliente). Usada solo por iniciarCobro — una cuenta sin dividir es, acá,
 * una división de 1 sola parte (modo 'igual', numPartes 1).
 */
function calcularPartes<T extends { id: unknown; cantidad: string; precio_unitario: string }>(
  division: IniciarCobroInput["division"],
  items: (T & { subtotal: number })[],
  total: number,
  totalBruto: number,
): { modo: "producto" | "igual"; montoDebido: number; unidades?: { itemId: number; cantidad: number }[] }[] {
  if (division.modo === "igual") {
    const n = division.numPartes;
    const base = Math.floor((total / n) * 100) / 100;
    const montos = Array.from({ length: n }, () => base);
    // La última parte absorbe el residuo del redondeo, así la suma de todas
    // las partes siempre da EXACTO el total (nunca queda 1 centavo suelto).
    montos[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100;
    return montos.map((montoDebido) => ({ modo: "igual" as const, montoDebido }));
  }

  // modo 'producto': misma validación de cerrarOrden dividido — la suma de
  // cantidades asignadas a un mismo itemId, entre todas las partes, debe ser
  // EXACTAMENTE su cantidad real (ni de más ni de menos).
  const cantidadPorItem = new Map(items.map((i) => [Number(i.id), Number(i.cantidad)]));
  const asignadoPorItem = new Map<number, number>();
  for (const parte of division.partes) {
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
  // Si hay descuento (solo posible cuando queda 1 sola parte, ver
  // iniciarCobro), se reparte proporcional — montoDebido nunca se calcula
  // directo del precio de lista cuando el total ya viene descontado.
  const escala = totalBruto > 0 ? total / totalBruto : 1;
  return division.partes.map((parte) => ({
    modo: "producto" as const,
    montoDebido: Math.round(calcularMontoPorUnidades(items, parte.unidades) * escala * 100) / 100,
    unidades: parte.unidades,
  }));
}

/**
 * Arranca el cobro de una orden con el motor nuevo de pagos parciales/cuenta
 * dividida por igual — a diferencia de cerrarOrden, esto NO cobra nada
 * todavía: solo fija cómo queda partida la cuenta y crea la venta+factura
 * (mismo criterio de cerrarOrden: la factura ya tiene número desde el primer
 * momento). Idempotente: si la orden ya tiene una venta iniciada, la
 * devuelve tal cual e ignora `input` — la división ya quedó fija la primera
 * vez, así reabrir una orden en 'pagando' nunca la reparte de nuevo.
 */
export async function iniciarCobro(ordenId: string, input: IniciarCobroInput, usuarioId: string) {
  const yaExiste = await repo.getVentaAbiertaPorOrden(ordenId);
  if (yaExiste) return repo.getCuentaPorOrden(ordenId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orden = await repo.getOrdenById(ordenId, client, true);
    if (!orden) throw Errors.notFound("Orden no encontrada");
    if (orden.estado === "cerrada") throw Errors.conflict("Esta orden ya está cerrada");
    if (orden.estado === "cancelada") throw Errors.conflict("Esta orden fue cancelada");

    // Alguien pudo haber iniciado el cobro justo antes, entre el check de
    // arriba (sin lock) y este punto (con lock de la orden) — se reconfirma
    // para no crear una venta duplicada por una carrera de doble clic.
    const carrera = await repo.getVentaAbiertaPorOrden(ordenId, client);
    if (carrera) {
      await client.query("COMMIT");
      return repo.getCuentaPorOrden(ordenId);
    }

    const itemsRaw = await repo.getItemsPorOrden(ordenId, client);
    if (itemsRaw.length === 0) throw Errors.conflict("La orden no tiene productos que cobrar");
    // Los ya pagados sueltos (ver pagarItems) no vuelven a entrar acá.
    const items = calcularItemsConSubtotal(itemsRaw).filter((i) => i.estado !== "cancelado" && !i.venta_id);
    if (items.length === 0) throw Errors.conflict("La orden no tiene productos que cobrar");
    const totalBruto = items.reduce((acc, i) => acc + i.subtotal, 0);

    // Igual que cerrarOrden: el descuento solo existe cuando la cuenta queda
    // en 1 sola parte (no tendría sentido descontar una parte de terceros).
    const partesCount = input.division.modo === "igual" ? input.division.numPartes : input.division.partes.length;
    const descuentoPorcentaje = partesCount === 1 ? (input.descuentoPorcentaje ?? 0) : 0;
    const total = totalBruto * (1 - descuentoPorcentaje / 100);
    const descuentoMonto = totalBruto - total;

    const partesInput = calcularPartes(input.division, items, total, totalBruto);

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

    await repo.getOrCrearFactura({ ventaId: venta.id, ordenId, subtotal: totalBruto, total }, client);
    await repo.crearPartes(client, venta.id, partesInput);

    await client.query("COMMIT");
    return repo.getCuentaPorOrden(ordenId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Estado completo de una cuenta en cobro — usado para reabrir una orden en
 *  'pagando' y seguir registrando abonos donde se quedó. */
export async function obtenerCuenta(ordenId: string) {
  const cuenta = await repo.getCuentaPorOrden(ordenId);
  if (!cuenta) throw Errors.notFound("Esta orden no tiene un cobro iniciado");
  return cuenta;
}

/**
 * Registra un abono (pago parcial o el resto final) de una parte de la
 * cuenta. Si con este abono TODAS las partes de la venta quedan pagadas del
 * todo, la orden cierra sola; si no, la orden pasa (o se mantiene) en
 * 'pagando' hasta el próximo abono.
 */
export async function registrarAbono(parteId: string, input: RegistrarAbonoInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const parteResult = await client.query(
      `SELECT cp.*, v.orden_id, v.id AS venta_id
         FROM migao_cuenta_partes cp
         JOIN ventas v ON v.id = cp.venta_id
        WHERE cp.id = $1 FOR UPDATE`,
      [parteId],
    );
    if (parteResult.rowCount === 0) throw Errors.notFound("Parte de cuenta no encontrada");
    const parte = parteResult.rows[0];

    const orden = await repo.getOrdenById(parte.orden_id, client, true);
    if (!orden) throw Errors.notFound("Orden no encontrada");
    if (orden.estado === "cerrada") throw Errors.conflict("Esta orden ya está cerrada");
    if (orden.estado === "cancelada") throw Errors.conflict("Esta orden fue cancelada");

    const pagadoResult = await client.query(`SELECT COALESCE(SUM(monto), 0) AS pagado FROM pagos WHERE parte_id = $1`, [
      parteId,
    ]);
    const pendiente = Number(parte.monto_debido) - Number(pagadoResult.rows[0].pagado);
    if (pendiente <= 0.001) throw Errors.conflict("Esta parte ya está completamente pagada");

    // Igual que cerrarOrden mixto: en un abono mixto, lo que el cajero
    // escribe es lo que el cliente entregó de verdad — si trae propina, esa
    // plata también viene incluida ahí, no solo el abono a la cuenta.
    const montoAbono =
      input.metodoPago === "mixto" ? input.montoEfectivo + input.montoBanco - (input.propina?.monto ?? 0) : input.monto;
    if (montoAbono <= 0) {
      throw Errors.badRequest("El monto del abono debe ser mayor a 0 (revisa la propina incluida)");
    }
    if (montoAbono - pendiente > 0.01) {
      throw Errors.badRequest(`El abono (${montoAbono}) no puede superar el pendiente de esta parte (${pendiente})`);
    }

    const lineas =
      input.metodoPago === "mixto"
        ? (() => {
            const entregado = input.montoEfectivo + input.montoBanco;
            const efectivo = entregado > 0 ? Math.round(montoAbono * (input.montoEfectivo / entregado)) : 0;
            return descomponerPago({ metodoPago: "mixto", montoEfectivo: efectivo, montoBanco: montoAbono - efectivo });
          })()
        : descomponerPago({ metodoPago: input.metodoPago, monto: montoAbono });

    for (const linea of lineas) {
      await repo.crearPago(client, {
        ordenId: parte.orden_id,
        ventaId: parte.venta_id,
        metodoPago: linea.metodoPago,
        monto: linea.monto,
        referencia: `Abono parte ${parte.indice}`,
        usuarioId,
        parteId,
      });
      await cajaService.registrarIngreso(
        {
          moduloOrigenSlug: "migao",
          monto: linea.monto,
          metodoPago: linea.metodoPago,
          referenciaEntidad: "ventas",
          referenciaId: parte.venta_id,
        },
        usuarioId,
        client,
      );
    }

    if (input.propina && input.propina.monto > 0) {
      const efectivoRecibido = lineas.filter((l) => l.metodoPago === "efectivo").reduce((a, l) => a + l.monto, 0);
      const bancoRecibido = lineas.filter((l) => l.metodoPago === "banco").reduce((a, l) => a + l.monto, 0);
      const totalRecibido = efectivoRecibido + bancoRecibido;
      const propinaEfectivo =
        totalRecibido > 0 ? Math.round((input.propina.monto * efectivoRecibido) / totalRecibido) : input.propina.monto;
      const propinaBanco = input.propina.monto - propinaEfectivo;

      if (propinaEfectivo > 0) {
        await repo.crearPropina(client, {
          ordenId: parte.orden_id,
          ventaId: parte.venta_id,
          meseroId: orden.mesero_id,
          usuarioId,
          monto: propinaEfectivo,
          porcentaje: input.propina.porcentaje ?? null,
          metodoPago: "efectivo",
          parteId,
        });
      }
      if (propinaBanco > 0) {
        await repo.crearPropina(client, {
          ordenId: parte.orden_id,
          ventaId: parte.venta_id,
          meseroId: orden.mesero_id,
          usuarioId,
          monto: propinaBanco,
          porcentaje: input.propina.porcentaje ?? null,
          metodoPago: "banco",
          parteId,
        });
      }
    }

    const todasPartesResult = await client.query(
      `SELECT cp.monto_debido, COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.parte_id = cp.id), 0) AS pagado
         FROM migao_cuenta_partes cp WHERE cp.venta_id = $1`,
      [parte.venta_id],
    );
    const todasPagadas = todasPartesResult.rows.every((r) => Number(r.monto_debido) - Number(r.pagado) <= 0.01);

    if (todasPagadas) {
      await repo.cerrarOrdenEstado(client, parte.orden_id);
    } else if (orden.estado === "abierta") {
      await client.query(`UPDATE ordenes SET estado = 'pagando' WHERE id = $1`, [parte.orden_id]);
    }

    await client.query("COMMIT");
    return repo.getCuentaPorOrden(parte.orden_id);
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
    // Ya se cobró plata real de esta cuenta (uno o más abonos) — cancelar la
    // orden acá la dejaría "sin cuenta" sin devolver ese dinero. Hay que
    // anular la venta desde Caja General (caja.service.ts::anularVenta), que
    // sí revierte los movimientos de caja correspondientes.
    if (await repo.existenPagosPorOrden(ordenId)) {
      throw Errors.conflict(
        "Esta cuenta ya tiene pagos registrados — para cancelarla, anula la venta desde Caja General",
      );
    }

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

/**
 * Reconstruye la factura imprimible de una orden ya cobrada a partir de lo
 * que quedó guardado al cerrarla (ventas/venta_items/pagos/migao_propinas) —
 * nunca recalcula ni vuelve a tocar esa transacción, solo la lee. La primera
 * vez que se pide se le asigna un número de factura (get-or-create, ver
 * migao.repository.ts::getOrCrearFactura); reimprimir después trae el mismo número.
 */
/** Construye lo imprimible a partir de una venta y su orden YA resueltas —
 *  compartido por obtenerFacturaOrden (venta más reciente de la orden) y
 *  obtenerFacturaVenta (una venta puntual, ej. una de varias facturas
 *  parciales de pagarItems) para que cada una arme la factura de la venta
 *  exacta que le pidieron, sin volver a re-resolver por ordenId (una orden
 *  puede tener varias ventas: pagos de productos sueltos + el cierre final). */
async function construirFacturaDeVenta(venta: Record<string, unknown>, orden: Record<string, unknown>) {
  const ventaId = venta.id as string;
  const [items, pagos, propina, factura] = await Promise.all([
    repo.getVentaItems(ventaId),
    repo.getPagosPorVenta(ventaId),
    repo.getPropinaPorVenta(ventaId),
    repo.getOrCrearFactura({
      ventaId,
      ordenId: orden.id as string,
      subtotal: Number(venta.subtotal),
      total: Number(venta.total),
    }),
  ]);

  return {
    numeroFactura: factura.numero as string,
    fecha: (orden.closed_at as string | null) ?? (venta.created_at as string),
    mesaNumero: orden.mesa_numero as string | null,
    mesaPiso: orden.mesa_piso as number | null,
    meseroNombre: orden.mesero_nombre as string | null,
    comensalNumero: orden.comensal_numero as number,
    items: items.map((i) => ({
      productoNombre: i.producto_nombre as string,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
    })),
    subtotal: Number(venta.subtotal),
    descuentoPorcentaje: Number(venta.descuento_porcentaje),
    descuentoMonto: Number(venta.descuento),
    total: Number(venta.total),
    pagos: pagos.map((p) => ({
      metodoPago: p.metodo_pago as string,
      monto: Number(p.monto),
      referencia: p.referencia as string | null,
    })),
    propina: propina
      ? {
          monto: Number(propina.monto),
          porcentaje: propina.porcentaje !== null ? Number(propina.porcentaje) : null,
          metodoPago: propina.metodo_pago as "efectivo" | "banco",
        }
      : null,
  };
}

/**
 * Reconstruye la factura imprimible de una orden ya cobrada a partir de lo
 * que quedó guardado al cerrarla (ventas/venta_items/pagos/migao_propinas) —
 * nunca recalcula ni vuelve a tocar esa transacción, solo la lee. La primera
 * vez que se pide se le asigna un número de factura (get-or-create, ver
 * migao.repository.ts::getOrCrearFactura); reimprimir después trae el mismo número.
 * Si la orden tuvo varias ventas (pagos de productos sueltos, ver
 * pagarItems), esta trae la MÁS RECIENTE — para una factura parcial anterior
 * puntual hay que pedirla por su propio venta_id (obtenerFacturaVenta).
 */
export async function obtenerFacturaOrden(ordenId: string) {
  const [orden, venta] = await Promise.all([repo.getOrdenParaFactura(ordenId), repo.getVentaPorOrdenId(ordenId)]);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  if (!venta) throw Errors.notFound("Esta orden todavía no tiene una venta cobrada que facturar");
  return construirFacturaDeVenta(venta, orden);
}

/** Reimprimir la factura de UNA venta puntual (ej. una de varias facturas
 *  parciales de pagarItems, o desde Caja General donde los movimientos
 *  guardan el venta_id, no el orden_id) — a diferencia de
 *  obtenerFacturaOrden, nunca ambigua entre varias ventas de la misma orden. */
export async function obtenerFacturaVenta(ventaId: string) {
  const ordenId = await repo.getOrdenIdPorVentaId(ventaId);
  if (!ordenId) throw Errors.notFound("Esta venta no corresponde a una orden de Migao");
  const [orden, venta] = await Promise.all([repo.getOrdenParaFactura(ordenId), repo.getVentaPorId(ventaId)]);
  if (!orden) throw Errors.notFound("Orden no encontrada");
  if (!venta) throw Errors.notFound("Venta no encontrada");
  return construirFacturaDeVenta(venta, orden);
}

/**
 * Cotización: presupuesto para un cliente ANTES de que exista una orden/venta
 * real — vive completamente aparte, nunca toca ordenes/ventas/inventario/caja.
 * El total se calcula acá a partir de los ítems, nunca se confía en un total
 * mandado por el cliente.
 */
export async function crearCotizacion(usuarioId: string, input: CrearCotizacionInput) {
  const subtotal = input.items.reduce((acc, i) => acc + i.cantidad * i.precioUnitario, 0);
  const cotizacion = await repo.crearCotizacion({
    clienteNombre: input.clienteNombre,
    clienteTelefono: input.clienteTelefono,
    nota: input.nota,
    subtotal,
    total: subtotal,
    usuarioId,
  });
  await repo.crearCotizacionItems(cotizacion.id, input.items);
  return repo.getCotizacionPorId(cotizacion.id);
}

export async function listarCotizaciones() {
  return repo.listCotizaciones();
}

export async function obtenerCotizacion(id: string) {
  const cotizacion = await repo.getCotizacionPorId(id);
  if (!cotizacion) throw Errors.notFound("Cotización no encontrada");
  return cotizacion;
}

export async function eliminarCotizacion(id: string) {
  const eliminada = await repo.eliminarCotizacion(id);
  if (!eliminada) throw Errors.notFound("Cotización no encontrada");
  return { eliminada: true };
}
