import { pool } from "../../shared/db/pool";
import { AppError, Errors } from "../../shared/utils/app-error";
import { descomponerPorAreaYMetodo } from "../../shared/utils/area-pago";
import { descomponerPago, PagoInput } from "../../shared/utils/pago-mixto";
import * as cajaService from "../general/caja/caja.service";
import { encolarDeltaStock, programarEnvio } from "../integracion_ecommerce/salida";
import * as migaoRepo from "../migao/migao.repository";
import * as migaoService from "../migao/migao.service";
import * as repo from "./con_sentido.repository";
import { descontarParaVenta, motivoVenta } from "./stock-venta";
import {
  ActualizarAreaCategoriaInput,
  CrearClienteConSentidoInput,
  CrearProductoConSentidoInput,
  EditarProductoConSentidoInput,
  RegistrarVentaInput,
  VincularCarritoTiendaInput,
  VincularMesaInput,
} from "./con_sentido.schema";

export async function listarProductos() {
  return repo.listProductos();
}

export async function crearProducto(input: CrearProductoConSentidoInput) {
  return repo.crearProducto(input);
}

// Campos del catálogo que, en un producto sincronizado, manda el e-commerce.
const CAMPOS_DEL_ECOMMERCE = ["nombre", "precio", "descripcion", "categoria", "imagenUrl", "activo"] as const;

export async function editarProducto(id: string, input: EditarProductoConSentidoInput) {
  const existente = await repo.getProductoConSentidoById(id);
  if (!existente) throw Errors.notFound("Producto no encontrado");

  if (!existente.ecommerce_item_key) return repo.actualizarProducto(id, input);

  // Producto sincronizado con el e-commerce: el catálogo se edita allá; acá
  // solo se corrige el stock, y el ajuste se le avisa al e-commerce.
  if (CAMPOS_DEL_ECOMMERCE.some((campo) => input[campo] !== undefined)) {
    throw Errors.badRequest("Este producto viene del e-commerce: su nombre, precio y categoría se editan en consentidovelas.com.");
  }
  if (input.stock === undefined) return repo.actualizarProducto(id, input);
  if (!Number.isInteger(input.stock)) throw Errors.badRequest("El stock debe ser un número entero");

  // El e-commerce refleja max(stock, 0) — ver deltaEcommerce.
  const delta = repo.deltaEcommerce(Number(existente.stock), input.stock);
  const actualizado = await repo.actualizarProducto(id, { stock: input.stock });
  if (delta !== 0) {
    await encolarDeltaStock(pool, {
      productId: existente.ecommerce_product_id,
      variantId: existente.ecommerce_variant_id,
      sku: existente.sku,
      delta,
      kind: "ADJUSTMENT",
      reason: "Ajuste de inventario en el POS",
    });
    programarEnvio();
  }
  return actualizado;
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

    // Productos del inventario vendidos: se descuenta su stock (sin stock se
    // deja vender igual: queda en negativo, con observación obligatoria — ver
    // stock-venta.ts) y, si están sincronizados, se le avisa al e-commerce más abajo.
    const vendidosSincronizados: {
      productId: string;
      variantId: string | null;
      sku: string;
      delta: number;
      observacion: string | null;
    }[] = [];
    for (const item of input.items) {
      let productoId: string | null = null;
      let sku: string | null = null;
      let observacionInventario: string | null = null;
      if (item.productoId) {
        const vendido = await descontarParaVenta(client, {
          productoId: item.productoId,
          cantidad: item.cantidad,
          nombre: item.producto,
          observacion: item.observacionInventario,
        });
        if (!vendido) throw Errors.badRequest(`El producto "${item.producto}" ya no está en el inventario`);
        const { producto } = vendido;
        productoId = producto.id;
        sku = producto.sku ?? null;
        observacionInventario = vendido.observacion;
        if (producto.ecommerce_product_id) {
          vendidosSincronizados.push({
            productId: producto.ecommerce_product_id,
            variantId: producto.ecommerce_variant_id ?? null,
            sku: producto.sku,
            delta: vendido.deltaEcommerce,
            observacion: vendido.observacion,
          });
        }
      }
      await repo.crearVentaItem(client, {
        ventaId: venta.id,
        productoId,
        sku,
        producto: item.producto,
        descripcion: item.descripcion,
        categoria: item.categoria,
        cantidad: item.cantidad,
        observacionInventario,
        precioUnitario: item.precioUnitario,
        moduloOrigenSlug: item.moduloOrigenSlug,
      });
    }

    // Factura: se genera acá mismo, al registrar la venta, no cuando alguien
    // la pide para imprimir — así cualquier venta ya tiene su número
    // (F-000123) desde el momento en que se cobra (ver mismo criterio en
    // migao.service.ts::cerrarOrden).
    const factura = await repo.getOrCrearFactura({ ventaId: venta.id, subtotal: input.monto, total: input.monto }, client);

    // Aviso al e-commerce en la MISMA transacción: si la venta se revierte
    // (p. ej. caja cerrada), el aviso también.
    for (const vendido of vendidosSincronizados) {
      await encolarDeltaStock(client, {
        productId: vendido.productId,
        variantId: vendido.variantId,
        sku: vendido.sku,
        delta: vendido.delta,
        kind: "SALE",
        reason: motivoVenta(`Venta ${factura?.numero ?? venta.id}`, vendido.observacion),
      });
    }

    // Cada ítem puede ser de una área distinta (insumos/con_sentido) — se
    // reparte el PAGO REAL (lo que de verdad entra a Caja: `input.monto`, o
    // `montoEfectivo + montoBanco` si es mixto) proporcional al bruto
    // (cantidad * precioUnitario) de los ítems de cada área.
    //
    // A propósito NO se le pasa el bruto crudo de los ítems a
    // descomponerPorAreaYMetodo (como se hizo en un primer intento): nada en
    // el schema obliga a que Σ ítems cuadre con el pago — el frontend solo
    // lo AVISA (SelectorMetodoPago.tsx, el mensaje "Faltan/Sobran") pero NO
    // bloquea el submit si no cuadra (NuevaVentaModal.tsx::puedeRegistrar no
    // valida eso), así que un cajero puede enviar items por $50.000 con un
    // mixto de solo $40.000 real. Y aunque cuadraran, una `cantidad`
    // fraccionaria (los ítems de catálogo exigen entero, pero un ítem de
    // texto libre no) puede desviar por 1 centavo la suma redondeada POR
    // ÁREA (que es lo que ve el invariante) de la suma redondeada UNA SOLA
    // VEZ al final (que es como se calculó `monto`). En cualquiera de los
    // dos casos, pasar el bruto crudo hace que el invariante de
    // descomponerPorAreaYMetodo compare esa suma contra el pago real y, si
    // no cuadran, lance un throw sin capturar (500) — hallazgo real de code
    // review (2026-10-29).
    //
    // La solución, igual que caja.service.ts::registrarIngresoManual (Task
    // 6) pero sin su escala por descuento (que acá no existe): se reparte el
    // TOTAL REALMENTE PAGADO en centavos ENTEROS con el método del remanente
    // mayor (Hamilton) — el piso de la parte proporcional de cada área y
    // luego 1 centavo a la vez (a las de mayor remanente fraccional) hasta
    // agotar la diferencia. Así el reparto SIEMPRE suma EXACTO al pago real
    // (nunca al bruto de los ítems), sin importar si los ítems cuadran con
    // él o no, y sin poder quedar negativo (cada centavo final es un piso de
    // un número positivo, o ese piso más 1 — jamás una resta; misma prueba
    // que en Task 6).
    const pagoInput: PagoInput =
      input.metodoPago === "mixto"
        ? { metodoPago: "mixto", montoEfectivo: input.montoEfectivo, montoBanco: input.montoBanco }
        : { metodoPago: input.metodoPago, monto: input.monto };
    const partesPago = descomponerPago(pagoInput);
    const totalNeto = partesPago.reduce((acc, p) => acc + p.monto, 0);
    // "mixto" es solo una comodidad de UI: si de verdad tuvo las 2 partes
    // (no un lado en $0, ya reducido a pago simple), cada movimiento que
    // resulte de repartir por área debe seguir marcado como parte de un pago
    // mixto — igual que antes de repartir por área.
    const esPagoMixto = partesPago.length > 1;

    const brutoPorArea = new Map<string, number>();
    for (const item of input.items) {
      brutoPorArea.set(
        item.moduloOrigenSlug,
        (brutoPorArea.get(item.moduloOrigenSlug) ?? 0) + item.cantidad * item.precioUnitario,
      );
    }
    const areasConBruto = [...brutoPorArea].filter(([, bruto]) => bruto > 0);
    const sumaBruto = areasConBruto.reduce((acc, [, bruto]) => acc + bruto, 0);
    // Degenerado: se cobra plata real (totalNeto > 0, ya garantizado por el
    // schema — `monto`/`montoEfectivo+montoBanco` positivos) pero NINGÚN
    // ítem vale algo (ej. todo a $0) — no hay cómo repartir esa plata entre
    // áreas. Mismo hallazgo de code review que en
    // caja.service.ts::registrarIngresoManual (Task 6, 2026-10-29).
    if (sumaBruto <= 0) {
      throw Errors.badRequest(
        "Los productos deben tener un precio mayor a 0 para poder repartir la venta entre áreas",
      );
    }

    const totalCentavos = Math.round(totalNeto * 100);
    const exactos = areasConBruto.map(([, bruto]) => (bruto * totalCentavos) / sumaBruto);
    const piso = exactos.map((e) => Math.floor(e));
    let faltante = totalCentavos - piso.reduce((a, b) => a + b, 0);
    const porRemanenteDesc = piso
      .map((_, idx) => idx)
      .sort((a, b) => exactos[b] - piso[b] - (exactos[a] - piso[a]));
    const centavosPorArea = [...piso];
    for (let i = 0; i < porRemanenteDesc.length && faltante > 0; i++) {
      centavosPorArea[porRemanenteDesc[i]] += 1;
      faltante--;
    }
    const lineasPorArea = areasConBruto.map(([moduloOrigenSlug], idx) => ({
      moduloOrigenSlug,
      monto: centavosPorArea[idx] / 100,
    }));
    const grupos = descomponerPorAreaYMetodo(lineasPorArea, pagoInput);

    const motivo = `Venta Con Sentido - ${input.items.length} producto(s)`;
    for (const grupo of grupos) {
      await cajaService.registrarIngreso(
        {
          // `descomponerPorAreaYMetodo` trabaja sobre `string` genérico (lo
          // comparte con Caja General, que admite más áreas) — acá se sabe
          // que solo puede ser una de las tres que mandó itemVentaSchema.
          moduloOrigenSlug: grupo.moduloOrigenSlug as "insumos" | "talleres" | "con_sentido",
          motivo,
          referenciaEntidad: "con_sentido_ventas",
          referenciaId: venta.id,
          metodoPago: grupo.metodoPago,
          monto: grupo.monto,
          referenciaBanco: input.referenciaBanco,
          esPagoMixto,
        },
        usuarioId,
        client,
      );
    }

    await client.query("COMMIT");
    if (vendidosSincronizados.length) programarEnvio();
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
  // Un carrito de tienda vinculado a una mesa que todavía no se terminó de
  // pagar no tiene factura todavía — asignarle un número ahora sería
  // prematuro (y venta.metodo_pago todavía es NULL). Ver
  // docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md,
  // hallazgo I6 de la revisión final.
  if (venta.estado === "pendiente") {
    throw Errors.conflict("Este carrito de tienda todavía no se ha terminado de pagar — no tiene factura todavía");
  }

  const monto = Number(venta.monto);
  // Una venta vinculada a una parte (ver parte_id) puede tener su propio
  // descuento — una venta suelta normal nunca lo tuvo, por eso antes se
  // hardcodeaba en 0 (hallazgo I7 de la revisión final).
  const descuentoMonto = venta.parte_id ? Number(venta.descuento ?? 0) : 0;
  const descuentoPorcentaje = venta.parte_id ? Number(venta.descuento_porcentaje ?? 0) : 0;
  const subtotal = monto + descuentoMonto;
  const factura = await repo.getOrCrearFactura({ ventaId, subtotal, total: monto });

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
      sku: (item.sku as string | null) ?? null,
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
    })),
    subtotal,
    descuentoPorcentaje,
    descuentoMonto,
    total: monto,
    pagos,
    propina: null,
  };
}

/**
 * Crea (si no existe) o reemplaza por completo el carrito de tienda vinculado
 * a una parte de cuenta dividida de Migao — ver
 * docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
 * Devuelve stock de lo que ya estaba, descuenta el de lo nuevo (mismo criterio
 * que registrarVenta: sin stock se vende igual, con observación), y recalcula
 * monto/descuento. Rechaza si ya se cobró algo de este carrito — editar una
 * parte ya pagada (aunque sea parcialmente) rompería lo que ya se facturó.
 */
export async function vincularCarritoTienda(parteId: string, input: VincularCarritoTiendaInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Bloquea también la orden (no solo la parte) — sin esto, una
    // cancelarOrden concurrente que ya pasó su propio chequeo de "sin pagos"
    // podía colarse entre este lock de la parte y el INSERT de abajo,
    // dejando un carrito nuevo sobre una orden recién cancelada (hallazgo I2
    // de la revisión final).
    const parteResult = await client.query(
      `SELECT cp.id, o.estado AS orden_estado
         FROM migao_cuenta_partes cp
         JOIN ventas v ON v.id = cp.venta_id
         JOIN ordenes o ON o.id = v.orden_id
        WHERE cp.id = $1
        FOR UPDATE`,
      [parteId],
    );
    if (!parteResult.rowCount) throw Errors.notFound("Parte de cuenta no encontrada");
    const ordenEstado = parteResult.rows[0].orden_estado as string;
    if (ordenEstado === "cerrada") throw Errors.conflict("Esta orden ya está cerrada");
    if (ordenEstado === "cancelada") throw Errors.conflict("Esta orden fue cancelada");

    const carritoExistente = await repo.getCarritoTiendaPorParte(parteId, client);
    if (carritoExistente && carritoExistente.pagado > 0) {
      throw Errors.conflict("Ya se registraron pagos para el carrito de tienda de esta parte, no se puede editar");
    }

    const ventaId = carritoExistente ? carritoExistente.ventaId : (await repo.crearCarritoTienda(client, parteId, usuarioId)).id;

    // Avisos al e-commerce (mismo criterio que registrarVenta/anularVenta —
    // hallazgo I8 de la revisión final): lo que se quita del carrito es una
    // devolución (RETURN), lo nuevo es una venta (SALE). Se encolan DENTRO
    // de esta misma transacción (si se revierte, el aviso también).
    const existentes = await repo.getItemsCarrito(ventaId, client);
    let huboAvisosEcommerce = false;
    for (const fila of existentes) {
      if (!fila.producto_id) continue;
      const producto = await repo.getProductoParaVenta(client, fila.producto_id);
      if (!producto) continue; // ya no está en el catálogo
      await repo.reponerStock(client, fila.producto_id, Number(fila.cantidad));
      const delta = repo.deltaEcommerce(producto.stock, producto.stock + Number(fila.cantidad));
      if (producto.ecommerce_product_id && delta !== 0) {
        await encolarDeltaStock(client, {
          productId: producto.ecommerce_product_id,
          variantId: producto.ecommerce_variant_id ?? null,
          sku: producto.sku,
          delta,
          kind: "RETURN",
          reason: "Carrito de tienda de una mesa: se reemplazó por uno nuevo",
        });
        huboAvisosEcommerce = true;
      }
    }

    const itemsResueltos = [];
    for (const item of input.items) {
      // Línea de texto libre (sin productoId, pedido explícito del cajero):
      // sin catálogo no hay stock que descontar ni e-commerce que avisar, y
      // el precio queda en manos del cajero (acá sí se confía en el
      // cliente — no hay producto real cuyo precio real se pueda pisar).
      if (!item.productoId) {
        itemsResueltos.push({
          productoId: null,
          sku: null,
          nombre: item.nombre!.trim(),
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          observacionInventario: item.observacionInventario ?? null,
        });
        continue;
      }

      const producto = await repo.getProductoParaVenta(client, item.productoId);
      const vendido = await descontarParaVenta(client, {
        productoId: item.productoId,
        cantidad: item.cantidad,
        nombre: producto?.nombre ?? "producto",
        observacion: item.observacionInventario,
      });
      if (!vendido) throw Errors.badRequest("Uno de los productos del carrito ya no está en el catálogo");
      if (vendido.producto.ecommerce_product_id) {
        // Mismo criterio que registrarVenta: siempre se encola (sin
        // condicionar a delta !== 0) para un producto sincronizado.
        await encolarDeltaStock(client, {
          productId: vendido.producto.ecommerce_product_id,
          variantId: vendido.producto.ecommerce_variant_id ?? null,
          sku: vendido.producto.sku,
          delta: vendido.deltaEcommerce,
          kind: "SALE",
          reason: motivoVenta("Carrito de tienda vinculado a una mesa", vendido.observacion),
        });
        huboAvisosEcommerce = true;
      }
      itemsResueltos.push({
        productoId: vendido.producto.id as string,
        sku: (vendido.producto.sku as string | null) ?? null,
        nombre: vendido.producto.nombre as string,
        cantidad: item.cantidad,
        // El precio se resuelve del catálogo, nunca del cliente — el Cajero
        // tiene con_sentido.ventas.vincular_mesa precisamente porque NO
        // tiene con_sentido.ventas.crear (sin control de precios); confiar
        // en item.precioUnitario dejaba vender cualquier producto a
        // cualquier precio por esta puerta (hallazgo I11 de la revisión
        // final).
        precioUnitario: Number(vendido.producto.precio),
        observacionInventario: vendido.observacion,
      });
    }

    const resultado = await repo.reemplazarItemsCarrito(client, {
      ventaId,
      items: itemsResueltos,
      descuentoPorcentaje: input.descuentoPorcentaje ?? 0,
    });

    await client.query("COMMIT");
    if (huboAvisosEcommerce) programarEnvio();
    return { ventaId, ...resultado };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Quita del todo el carrito de tienda vinculado a una parte — devuelve el
 * stock de cada ítem con producto real, avisa al e-commerce (RETURN) si
 * aplica, y borra la venta y sus ítems (sin dejar rastro). Pedido explícito:
 * un botón para corregir un error o un cliente que cambia de opinión, en vez
 * de obligar a "editar" el carrito a $0 (que de todas formas no se puede
 * guardar vacío). Mismo guardia que editar: nada si ya se pagó algo.
 */
export async function quitarCarritoTienda(parteId: string, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const parteResult = await client.query(
      `SELECT cp.id, o.estado AS orden_estado
         FROM migao_cuenta_partes cp
         JOIN ventas v ON v.id = cp.venta_id
         JOIN ordenes o ON o.id = v.orden_id
        WHERE cp.id = $1
        FOR UPDATE`,
      [parteId],
    );
    if (!parteResult.rowCount) throw Errors.notFound("Parte de cuenta no encontrada");

    const carrito = await repo.getCarritoTiendaPorParte(parteId, client);
    if (!carrito) throw Errors.notFound("Esta parte no tiene un carrito de tienda vinculado");
    if (carrito.pagado > 0) {
      throw Errors.conflict("Ya se registraron pagos para el carrito de tienda de esta parte, no se puede quitar");
    }

    const items = await repo.getItemsCarrito(carrito.ventaId, client);
    let huboAvisosEcommerce = false;
    for (const fila of items) {
      if (!fila.producto_id) continue;
      const producto = await repo.getProductoParaVenta(client, fila.producto_id);
      if (!producto) continue; // ya no está en el catálogo
      await repo.reponerStock(client, fila.producto_id, Number(fila.cantidad));
      const delta = repo.deltaEcommerce(producto.stock, producto.stock + Number(fila.cantidad));
      if (producto.ecommerce_product_id && delta !== 0) {
        await encolarDeltaStock(client, {
          productId: producto.ecommerce_product_id,
          variantId: producto.ecommerce_variant_id ?? null,
          sku: producto.sku,
          delta,
          kind: "RETURN",
          reason: "Se quitó el carrito de tienda vinculado a la mesa",
        });
        huboAvisosEcommerce = true;
      }
    }

    await repo.eliminarCarritoTienda(client, carrito.ventaId);
    await client.query("COMMIT");
    if (huboAvisosEcommerce) programarEnvio();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Puerta 2: vincula una venta de Con Sentido a una mesa desde la pantalla de
 * Con Sentido. Si la orden todavía no tiene cobro iniciado, arranca uno de
 * una sola parte (igual que un cobro sin dividir); si ya tiene varias
 * partes, exige que se diga a cuál se vincula.
 */
export async function vincularMesa(input: VincularMesaInput, usuarioId: string) {
  // iniciarCobro y vincularCarritoTienda corren en transacciones separadas
  // (iniciarCobro ya commitea la suya) — si el segundo paso falla, el cobro
  // de la mesa ya quedó iniciado (y VISIBLE en Migao, ver hallazgo C1) y
  // puede completarse desde ahí; se avisa explícito en vez de un error
  // genérico (hallazgo I1 de la revisión final — atomicidad completa
  // requeriría exponer un `client` compartido entre ambos módulos, fuera de
  // alcance de este fix pass).
  const yaExistiaCobro = Boolean(await migaoRepo.getVentaAbiertaPorOrden(input.ordenId));
  if (!yaExistiaCobro) {
    await migaoService.iniciarCobro(input.ordenId, { division: { modo: "igual", numPartes: 1 } }, usuarioId);
  }

  const cuenta = await migaoRepo.getCuentaPorOrden(input.ordenId);
  if (!cuenta) throw Errors.notFound("Esta orden no tiene un cobro iniciado");

  let parteId = input.parteId;
  if (!parteId) {
    if (cuenta.partes.length > 1) {
      throw Errors.badRequest("Esta mesa tiene la cuenta dividida — especifica a cuál parte vincular los productos");
    }
    parteId = cuenta.partes[0].id;
  } else if (!cuenta.partes.some((p) => p.id === parteId)) {
    throw Errors.badRequest("Esa parte no corresponde a esta mesa");
  }

  // Si esa parte ya tiene un carrito de tienda (ej. alguien lo agregó desde
  // Migao), no lo pisamos en silencio — el cajero tiene que ir a Migao a
  // verlo y editarlo ahí, donde sí ve lo que ya hay (hallazgo I3 de la
  // revisión final).
  const parteElegida = cuenta.partes.find((p) => p.id === parteId)!;
  if (parteElegida.tienda) {
    throw Errors.conflict(
      "Esta parte ya tiene productos de la tienda vinculados — edítalos desde el cobro de la mesa en Migao",
    );
  }

  try {
    const resultado = await vincularCarritoTienda(
      parteId,
      { items: input.items, descuentoPorcentaje: input.descuentoPorcentaje },
      usuarioId,
    );
    return { ...resultado, parteId };
  } catch (err) {
    if (!yaExistiaCobro && err instanceof AppError) {
      throw Errors.conflict(
        `${err.message} — el cobro de esta mesa ya quedó iniciado (parte ${parteId}); agrega los productos desde el cobro de la mesa en Migao.`,
      );
    }
    throw err;
  }
}

export async function listarCategoriasConArea() {
  return repo.listarCategoriasConArea();
}

export async function actualizarAreaCategoria(id: string, input: ActualizarAreaCategoriaInput) {
  return repo.actualizarAreaCategoria(Number(id), input.areaSlug);
}
