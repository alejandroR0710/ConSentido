import { PoolClient, pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { RegistrarIngresoInput } from "../general/caja/caja.schema";
import { deltaEcommerce, getProductoParaVenta, reponerStock } from "../con_sentido/con_sentido.repository";
import { descontarParaVenta, motivoVenta } from "../con_sentido/stock-venta";
import { encolarDeltaStock, programarEnvio } from "../integracion_ecommerce/salida";
import { exigirReferenciaBanco } from "../../shared/utils/pago-mixto";
import { getRolById } from "../general/usuarios/usuarios.repository";
import * as notificacionesService from "../general/notificaciones/notificaciones.service";
import * as repo from "./pedidos.repository";
import {
  CambiarEstadoPedidoInput,
  CrearPedidoInput,
  EditarPedidoInput,
  RegistrarAbonoPedidoInput,
} from "./pedidos.schema";

// Transiciones válidas — nunca se salta un paso ni se retrocede (salvo
// cancelar, posible desde cualquier estado no terminal). Cancelar desde
// "enviado" es exclusivo de Root/Super Root (ver ROLES_CANCELAR_ENVIADO
// abajo) — el resto de las transiciones no distingue rol, eso ya lo filtra
// el permiso pedidos.cambiar_estado.
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  pendiente: ["alistado", "cancelado"],
  alistado: ["enviado", "cancelado"],
  enviado: ["entregado", "cancelado"],
  entregado: [],
  cancelado: [],
};

const ROLES_CANCELAR_ENVIADO = new Set(["Root", "Super Root"]);

// Mismos roles que pueden ver el módulo (permiso pedidos.ver) — todos se
// enteran apenas entra un pedido nuevo, no solo cuando ya lleva rato sin
// moverse (eso sigue siendo exclusivo de Root/Super Root, ver alarma.ts).
const ROLES_NOTIFICAR_PEDIDO_CREADO = ["Cajero", "Administrador", "Root", "Super Root"];

/** Fire-and-forget: nunca debe tumbar la creación del pedido si el push
 *  falla (ej. sin claves VAPID configuradas, enviarATodosDeRol ya retorna
 *  temprano sin lanzar). */
async function notificarPedidoCreado(pedidoId: string, descripcion: string) {
  const payload = {
    titulo: "Nuevo pedido",
    cuerpo: descripcion,
    url: `/pedidos/${pedidoId}`,
  };
  await Promise.all(
    ROLES_NOTIFICAR_PEDIDO_CREADO.map((rol) => notificacionesService.enviarATodosDeRol(rol, payload)),
  );
}

const TIMESTAMP_POR_ESTADO: Record<string, "alistado_en" | "enviado_en" | "entregado_en" | undefined> = {
  alistado: "alistado_en",
  enviado: "enviado_en",
  entregado: "entregado_en",
};

async function calcularProximaAlarma(): Promise<Date> {
  const { intervalo_alarma_minutos } = await repo.getParametros();
  return new Date(Date.now() + Number(intervalo_alarma_minutos) * 60_000);
}

const aCentavos = (n: number) => Math.round(n * 100);

/** 100.00% expresado en centésimas de punto — `pedido_areas.porcentaje` es
 *  DECIMAL(5,2), así que todo el reparto trabaja en enteros sobre esta base. */
const PUNTOS_BASE = 10_000;

/**
 * Reparte el entero `total` entre `pesos` (enteros >= 0, suma > 0) por el
 * método del remanente mayor (Hamilton) — mismo criterio que
 * caja.service.ts::registrarIngresoManual: a cada uno el piso de su parte
 * proporcional, y luego 1 unidad a la vez a los de mayor remanente hasta
 * agotar la diferencia (desempate: el de menor índice). Todo en aritmética
 * entera (pesos * total cabe holgado en 2^53 para los rangos de acá), la
 * suma da EXACTO `total` y ningún resultado puede ser negativo (cada uno es
 * un piso de un número >= 0, o ese piso + 1 — nunca una resta).
 */
function repartirPorRemanenteMayor(total: number, pesos: number[]): number[] {
  const sumaPesos = pesos.reduce((a, b) => a + b, 0);
  if (sumaPesos <= 0) throw new Error("repartirPorRemanenteMayor: los pesos deben sumar más de 0");
  const piso = pesos.map((p) => Math.floor((p * total) / sumaPesos));
  const remanente = pesos.map((p, i) => p * total - piso[i] * sumaPesos);
  let faltante = total - piso.reduce((a, b) => a + b, 0);
  const orden = pesos.map((_, i) => i).sort((a, b) => remanente[b] - remanente[a] || a - b);
  const resultado = [...piso];
  for (let i = 0; faltante > 0; i = (i + 1) % orden.length) {
    resultado[orden[i]] += 1;
    faltante--;
  }
  return resultado;
}

/**
 * Proporción FIJA del pedido por área, calculada UNA vez al crearlo: el peso
 * de cada área es la suma (cantidad * precioUnitario) de sus líneas, y su %
 * es su proporción sobre el total de las líneas (hoy precio_acordado ES esa
 * suma, ver crearPedido — si algún día difieren, la proporción se sigue
 * tomando de las líneas y se aplica sobre precio_acordado en cada abono).
 * Se descartan las áreas sin valor (líneas a $0) ANTES de repartir, y
 * también las que, por ser ínfimas, redondean a 0.00% (la columna exige
 * porcentaje > 0). Los % devueltos suman exactamente 100.00. Si ninguna
 * línea vale nada (pedido de $0) devuelve [] — ese pedido nunca puede
 * recibir un abono (todo abono > 0 supera su saldo de $0).
 */
function calcularPorcentajesPorArea(items: { moduloOrigenSlug: string; cantidad: number; precioUnitario: number }[]) {
  const centavosPorArea = new Map<string, number>();
  for (const item of items) {
    const area = item.moduloOrigenSlug;
    centavosPorArea.set(area, (centavosPorArea.get(area) ?? 0) + aCentavos(item.cantidad * item.precioUnitario));
  }
  const conValor = [...centavosPorArea].filter(([, c]) => c > 0);
  if (conValor.length === 0) return [];
  const puntos = repartirPorRemanenteMayor(
    PUNTOS_BASE,
    conValor.map(([, c]) => c),
  );
  return conValor
    .map(([moduloOrigenSlug], i) => ({ moduloOrigenSlug, puntos: puntos[i] }))
    .filter((a) => a.puntos > 0)
    .map((a) => ({ moduloOrigenSlug: a.moduloOrigenSlug, porcentaje: a.puntos / 100 }));
}

/**
 * Cuánto de ESTE abono va a cada área del pedido, en centavos.
 *
 * En vez de repartir solo el monto de este abono (lo que deja que el
 * redondeo de cada abono se acumule y un área pueda pasarse de su parte
 * antes del cierre), se reparte el ACUMULADO: con el total abonado después
 * de este abono, se calcula cuánto debería llevar cada área en total según
 * su % fijo (`repartirPorRemanenteMayor` sobre ese acumulado), y a cada área
 * le toca la diferencia con lo que ya recibió de verdad en Caja. Así:
 *  - un abono intermedio reparte su monto según el % fijo (a lo sumo 1
 *    centavo de diferencia con aplicar el % solo sobre su monto, y ese
 *    centavo justo es el que compensa el redondeo de abonos anteriores);
 *  - el abono que deja el pedido en $0 tiene acumulado = precio_acordado, así
 *    que a cada área le da EXACTAMENTE lo que le falta para su parte del
 *    precio_acordado — el "cierre exacto" sale solo, sin rama aparte, y no
 *    depende de cuántos abonos hubo antes ni de cómo redondearon.
 *
 * Salvaguarda: si la diferencia no sirve tal cual — alguna saldría
 * negativa, no sumaría el monto del abono (lo ya recibido en Caja no cuadra,
 * ej. un movimiento editado a mano), o llevaría a un área por encima de su
 * parte FINAL del precio_acordado (posible solo con 3+ áreas, por la
 * "paradoja de Alabama" del remanente mayor; con 2 áreas nunca pasa) — se
 * reparte el monto del abono proporcional a lo que le falta a cada área para
 * su parte final (o al % fijo si a ninguna le falta nada). Eso nunca da
 * negativos, siempre suma exacto, y nunca pasa a un área de su parte final
 * (cada una recibe a lo sumo el techo de m·falta/Σfalta ≤ falta, porque
 * Σfalta = saldo pendiente ≥ m), así que el cierre sigue siendo exacto.
 */
function repartirAbonoPorArea(params: {
  areas: { slug: string; porcentaje: number }[];
  precioCentavos: number;
  abonadoAntesCentavos: number;
  montoCentavos: number;
  recibidoPorArea: Map<string, number>;
}): { moduloOrigenSlug: string; montoCentavos: number }[] {
  const { areas, precioCentavos, abonadoAntesCentavos, montoCentavos, recibidoPorArea } = params;
  const puntos = areas.map((a) => Math.round(a.porcentaje * 100));
  const recibido = areas.map((a) => aCentavos(recibidoPorArea.get(a.slug) ?? 0));
  const parteFinal = repartirPorRemanenteMayor(precioCentavos, puntos);
  const falta = parteFinal.map((p, i) => p - recibido[i]);
  const objetivo = repartirPorRemanenteMayor(abonadoAntesCentavos + montoCentavos, puntos);
  const deseado = objetivo.map((o, i) => o - recibido[i]);

  let montos = deseado;
  const cuadra =
    deseado.every((d, i) => d >= 0 && d <= falta[i]) && deseado.reduce((x, y) => x + y, 0) === montoCentavos;
  if (!cuadra) {
    console.warn("[pedidos] el reparto acumulado por área no cuadra; se reparte por lo que le falta a cada área", {
      deseado,
      falta,
      montoCentavos,
    });
    const pesos = falta.map((f) => Math.max(0, f));
    montos = repartirPorRemanenteMayor(montoCentavos, pesos.some((p) => p > 0) ? pesos : puntos);
  }
  return areas
    .map((a, i) => ({ moduloOrigenSlug: a.slug, montoCentavos: montos[i] }))
    .filter((r) => r.montoCentavos > 0);
}

/**
 * Registra en Caja General el ingreso de un abono ya creado (pedido_abonos),
 * repartido entre las áreas del pedido según su proporción fija — un
 * movimiento por área con monto > 0, todos con referencia_entidad
 * "pedido_abonos" y referencia_id = el abono. Mismo camino para el abono
 * inicial (crearPedido) y para cualquier abono posterior (registrarAbono).
 *
 * Pedidos creados antes de que existiera pedido_areas no tienen proporción
 * guardada: esos siguen yendo completos al área "pedidos", como siempre.
 */
async function registrarAbonoEnCaja(
  client: PoolClient,
  params: {
    pedidoId: string;
    abonoId: string;
    descripcion: string;
    precioAcordado: number;
    abonadoAntes: number;
    monto: number;
    metodoPago: "efectivo" | "banco";
    referenciaBanco: string | undefined;
  },
  usuarioId: string,
) {
  const areas = await repo.getPedidoAreas(params.pedidoId, client);
  const filas =
    areas.length === 0
      ? [{ moduloOrigenSlug: "pedidos", montoCentavos: aCentavos(params.monto) }]
      : repartirAbonoPorArea({
          areas,
          precioCentavos: aCentavos(params.precioAcordado),
          abonadoAntesCentavos: aCentavos(params.abonadoAntes),
          montoCentavos: aCentavos(params.monto),
          recibidoPorArea: await repo.sumIngresosPorAreaDePedido(params.pedidoId, client),
        });
  for (const fila of filas) {
    await cajaService.registrarIngreso(
      {
        // Viene de pedido_areas (solo slugs reales de `modulos`) o es "pedidos".
        moduloOrigenSlug: fila.moduloOrigenSlug as RegistrarIngresoInput["moduloOrigenSlug"],
        motivo: `Abono pedido — ${params.descripcion}`,
        referenciaEntidad: "pedido_abonos",
        referenciaId: params.abonoId,
        metodoPago: params.metodoPago,
        monto: fila.montoCentavos / 100,
        referenciaBanco: params.referenciaBanco,
      },
      usuarioId,
      client,
    );
  }
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
      itemsResueltos.push({
        productoId,
        sku,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        moduloOrigenSlug: item.moduloOrigenSlug,
      });
    }

    const descripcion = input.descripcion?.trim() || input.items.map((i) => i.nombre).join(", ");
    const proximaAlarmaEn = await calcularProximaAlarma();

    const pedido = await repo.crearPedido(client, {
      clienteId: input.clienteId ?? null,
      descripcion,
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
    // Proporción fija por área: se calcula y se guarda UNA vez, acá — todo
    // abono (incluido el inicial, abajo) se reparte según ella.
    await repo.crearPedidoAreas(client, pedido.id, calcularPorcentajesPorArea(itemsResueltos));
    await repo.insertHistorial(client, { pedidoId: pedido.id, accion: "creado", usuarioId });

    if (input.abonoInicial) {
      if (aCentavos(input.abonoInicial.monto) > aCentavos(precioAcordado)) {
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
      await registrarAbonoEnCaja(
        client,
        {
          pedidoId: pedido.id,
          abonoId: abono.id,
          descripcion,
          precioAcordado,
          abonadoAntes: 0,
          monto: input.abonoInicial.monto,
          metodoPago: input.abonoInicial.metodoPago,
          referenciaBanco,
        },
        usuarioId,
      );
      await repo.insertHistorial(client, {
        pedidoId: pedido.id,
        accion: "abono",
        detalle: { monto: input.abonoInicial.monto, metodoPago: input.abonoInicial.metodoPago },
        usuarioId,
      });
    }

    await client.query("COMMIT");
    void notificarPedidoCreado(pedido.id, descripcion).catch((err) =>
      console.error("[pedidos] error notificando pedido creado", err),
    );
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
export async function cambiarEstadoPedido(id: string, input: CambiarEstadoPedidoInput, usuarioId: string, rolId: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pedido = await repo.getPedidoParaCambiarEstado(client, id);
    if (!pedido) throw Errors.notFound("Pedido no encontrado");

    const destinosValidos = TRANSICIONES_VALIDAS[pedido.estado] ?? [];
    if (!destinosValidos.includes(input.estado)) {
      throw Errors.conflict(`No se puede pasar de "${pedido.estado}" a "${input.estado}"`);
    }

    // Cancelar un pedido que ya se despachó revierte dinero ya cobrado (ver
    // más abajo) — exclusivo de Root/Super Root, igual que anular una venta
    // en Caja General.
    if (input.estado === "cancelado" && pedido.estado === "enviado") {
      const rol = await getRolById(rolId);
      if (!rol || !ROLES_CANCELAR_ENVIADO.has(rol.nombre)) {
        throw Errors.forbidden("Solo Root o Super Root puede cancelar un pedido que ya fue enviado");
      }
    }

    // El método de envío (y sus campos) no se piden al crear el pedido — se
    // vuelven obligatorios justo al despachar, salvo que ya se hayan
    // guardado antes vía una edición (PATCH /pedidos/:id). Cada método exige
    // datos distintos; "recoge_tienda" no necesita ninguno extra.
    if (input.estado === "enviado") {
      const metodoEnvio = input.metodoEnvio || pedido.metodo_envio;
      if (!metodoEnvio) {
        throw Errors.badRequest(
          "Elige cómo se va a entregar el pedido: transportadora, recoge en tienda, o plataforma de recogida",
        );
      }
      if (metodoEnvio === "transportadora") {
        const transportadora = input.transportadora || pedido.transportadora;
        const numeroGuia = input.numeroGuia || pedido.numero_guia;
        if (!transportadora || !numeroGuia) {
          throw Errors.badRequest("Para marcar como enviado por transportadora hace falta su nombre y el número de guía");
        }
      } else if (metodoEnvio === "plataforma") {
        const conductorNombre = input.conductorNombre || pedido.conductor_nombre;
        const conductorPlaca = input.conductorPlaca || pedido.conductor_placa;
        if (!conductorNombre || !conductorPlaca) {
          throw Errors.badRequest(
            "Para marcar como enviado por plataforma hace falta el nombre del conductor y la placa del vehículo",
          );
        }
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

    // El stock se descontó al pasar a "alistado" — si el pedido llegó a
    // "enviado" sin cambiar de ahí, nunca se devolvió, así que cancelar
    // desde cualquiera de los dos estados tiene que revertirlo igual.
    if (input.estado === "cancelado" && (pedido.estado === "alistado" || pedido.estado === "enviado")) {
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

    // Cancelar un envío también revierte el dinero ya abonado — se borra
    // cada abono y su ingreso en Caja (con su propia auditoría ahí, ver
    // anularMovimientosPorReferencia), dejando el pedido con saldo pendiente
    // completo de nuevo, "como estaba" antes de cualquier pago. Los pagos de
    // un pedido pendiente/alistado (Cajero/Administrador también pueden
    // cancelar esos) NO se tocan acá — ese es otro caso, fuera de este cambio.
    const turnoIdsAfectados: string[] = [];
    let abonosRevertidos: { monto: string; metodoPago: string }[] = [];
    if (input.estado === "cancelado" && pedido.estado === "enviado") {
      const abonos = await repo.getAbonosPorPedido(id, client);
      for (const abono of abonos) {
        const turnoIds = await cajaService.anularMovimientosPorReferencia(
          client,
          "pedido_abonos",
          abono.id,
          `Cancelación de pedido enviado — ${pedido.descripcion}`,
          usuarioId,
        );
        turnoIdsAfectados.push(...turnoIds);
        await repo.borrarAbono(client, abono.id);
      }
      abonosRevertidos = abonos.map((a) => ({ monto: a.monto, metodoPago: a.metodo_pago }));
    }

    // La alarma solo sigue activa en pendiente/alistado (ver Global Constraints).
    const siguienteAlarma =
      input.estado === "alistado" ? await calcularProximaAlarma() : null;

    await repo.actualizarEstadoPedido(client, id, {
      estado: input.estado,
      timestampCampo: TIMESTAMP_POR_ESTADO[input.estado],
      proximaAlarmaEn: siguienteAlarma,
      metodoEnvio: input.metodoEnvio,
      transportadora: input.transportadora,
      numeroGuia: input.numeroGuia,
      conductorNombre: input.conductorNombre,
      conductorPlaca: input.conductorPlaca,
      conductorDescripcion: input.conductorDescripcion,
    });
    await repo.insertHistorial(client, {
      pedidoId: id,
      accion: "cambio_estado",
      detalle: {
        de: pedido.estado,
        a: input.estado,
        ...(Object.keys(observacionesInventario).length ? { observacionesInventario } : {}),
        ...(abonosRevertidos.length ? { abonosRevertidos } : {}),
      },
      usuarioId,
    });

    await client.query("COMMIT");
    // Después del COMMIT, nunca dentro (mismo cuidado que anularVenta): si
    // alguno de esos abonos quedó atribuido a un turno que ya está cerrado,
    // sus totales guardados quedarían desactualizados sin este recálculo.
    if (turnoIdsAfectados.length) {
      await cajaService.recalcularCierresSiEstanCerrados([...new Set(turnoIdsAfectados)]);
    }
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
    // En centavos: comparar flotantes podría dejar pasar un abono que supera
    // el saldo por una fracción de centavo, y el reparto por área (que
    // trabaja en centavos) se pasaría del precio_acordado.
    if (aCentavos(input.monto) > aCentavos(saldoPendiente)) {
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
    await registrarAbonoEnCaja(
      client,
      {
        pedidoId: id,
        abonoId: abono.id,
        descripcion: pedido.descripcion,
        precioAcordado: Number(pedido.precio_acordado),
        abonadoAntes: totalAbonado,
        monto: input.monto,
        metodoPago: input.metodoPago,
        referenciaBanco,
      },
      usuarioId,
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
 *
 * Incluye `totalAbonado`/`saldoPendiente`: el frontend decide con eso si
 * imprime la factura real o una prefactura (ver
 * frontend/src/modules/migao/factura.ts::facturaAReciboProps) — acá solo se
 * calcula y se expone, nunca se bloquea la generación por falta de pago.
 */
export async function obtenerFacturaPedido(id: string) {
  const pedido = await repo.getPedidoById(id);
  if (!pedido) throw Errors.notFound("Pedido no encontrado");

  const [items, abonos, totalAbonado] = await Promise.all([
    repo.getItemsPorPedido(id),
    repo.getAbonosPorPedido(id),
    repo.sumAbonosPorPedido(id),
  ]);
  const monto = Number(pedido.precio_acordado);
  const factura = await repo.getOrCrearFacturaPedido({ pedidoId: id, subtotal: monto, total: monto });

  return {
    numeroFactura: factura.numero as string,
    fecha: pedido.created_at as string,
    mesaNumero: null,
    mesaPiso: null,
    meseroNombre: null,
    comensalNumero: null,
    // "Despacho", no "Entrega": ya no se le pide esa fecha al crear el
    // pedido — lo relevante para la factura/rótulo es cuándo se alistó.
    fechaDespacho: pedido.alistado_en as string | null,
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
    totalAbonado,
    saldoPendiente: Math.max(0, monto - totalAbonado),
  };
}
