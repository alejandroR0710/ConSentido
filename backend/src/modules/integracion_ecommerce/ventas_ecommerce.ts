import { PoolClient, pool } from "../../shared/db/pool";
import * as cajaRepo from "../general/caja/caja.repository";
import { anularMovimientosPorReferencia } from "../general/caja/caja.service";
import * as csRepo from "../con_sentido/con_sentido.repository";
import { claveItem, type AnulacionVentaEcommerce, type VentaEcommerce } from "./tipos";

// ---------------------------------------------------------------------------
// Ventas pagadas en la tienda en línea → historial de Con Sentido y Caja del
// POS (spec 2026-11-05-ventas-ecommerce-al-pos-design.md, repo del e-commerce).
//
// - Llegan como SALE_RECORDED y esperan en `ecommerce_ventas_pendientes`
//   hasta que haya un turno abierto (se aplican al abrirlo o en el cron).
// - Entran como venta de Con Sentido (origen 'ecommerce') + ingreso por banco
//   del turno, por el TOTAL que pagó el cliente, repartido por área.
// - El inventario NO se toca: el e-commerce ya descontó el stock (y al
//   cancelar/reembolsar lo repone) y eso llega por STOCK_DELTA. Por eso estas
//   ventas no pasan por descontarParaVenta/reponerStock/encolarDeltaStock, y
//   sus movimientos usan referencia_entidad 'ecommerce_ventas', que el
//   anularVenta de Caja no acepta: solo se anulan desde el e-commerce.
// ---------------------------------------------------------------------------

export type ResultadoVenta = { status: "APPLIED" } | { status: "DUPLICATE" };

const ENTIDAD = "ecommerce_ventas";
const CATEGORIA_DEVOLUCIONES = "Devoluciones e-commerce";
type Area = "insumos" | "talleres" | "con_sentido";
type Turno = { id: string; cajeroId: string };

// Últimos 4 del id de la transacción de Wompi; sin él (pago manual), del
// número de pedido sin guiones (exigirReferenciaBanco pide 4 caracteres).
function referenciaBanco(v: VentaEcommerce): string {
  const base = (v.wompiTransactionId ?? v.number).replace(/[^A-Za-z0-9]/g, "");
  return base.slice(-4).padStart(4, "0");
}

/**
 * Reparte `total` entre áreas proporcional al bruto de cada una, en centavos
 * enteros con el método del remanente mayor (Hamilton) — misma regla que
 * con_sentido.service.ts::registrarVenta: la suma da EXACTO el total pagado.
 * Las líneas negativas (descuento) se descuentan del área donde están.
 */
export function repartirPorArea(lineas: { area: Area; bruto: number }[], total: number): { area: Area; monto: number }[] {
  const brutoPorArea = new Map<Area, number>();
  for (const l of lineas) brutoPorArea.set(l.area, (brutoPorArea.get(l.area) ?? 0) + l.bruto);
  const areas = [...brutoPorArea].filter(([, bruto]) => bruto > 0);
  const suma = areas.reduce((acc, [, bruto]) => acc + bruto, 0);
  if (areas.length === 0 || suma <= 0) return [{ area: "con_sentido", monto: total }];

  const totalCentavos = Math.round(total * 100);
  const exactos = areas.map(([, bruto]) => (bruto * totalCentavos) / suma);
  const piso = exactos.map((e) => Math.floor(e));
  let faltante = totalCentavos - piso.reduce((a, b) => a + b, 0);
  const orden = piso.map((_, i) => i).sort((a, b) => exactos[b] - piso[b] - (exactos[a] - piso[a]));
  const centavos = [...piso];
  for (let i = 0; i < orden.length && faltante > 0; i++) {
    centavos[orden[i]] += 1;
    faltante--;
  }
  return areas.map(([area], i) => ({ area, monto: centavos[i] / 100 }));
}

/** SALE_RECORDED: guarda la pendiente (una sola vez por origen+id) y la aplica si hay turno. */
export async function guardarVentaEcommerce(client: PoolClient, v: VentaEcommerce): Promise<ResultadoVenta> {
  const existente = await client.query(
    `SELECT id FROM ecommerce_ventas_pendientes WHERE origen = $1 AND origen_id = $2 FOR UPDATE`,
    [v.source, v.sourceId],
  );
  // Ya llegó antes (reintento / "Enviar ventas al POS"), o se anuló antes de llegar.
  if (existente.rowCount) return { status: "DUPLICATE" };

  const fila = await client.query(
    `INSERT INTO ecommerce_ventas_pendientes (origen, origen_id, numero, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
    [v.source, v.sourceId, v.number, JSON.stringify(v)],
  );
  const turno = await cajaRepo.findTurnoAbierto(client);
  if (turno) await aplicarVenta(client, fila.rows[0].id, v, turno);
  return { status: "APPLIED" };
}

async function aplicarVenta(client: PoolClient, filaId: string, v: VentaEcommerce, turno: Turno) {
  const venta = await csRepo.crearVenta(client, {
    usuarioId: turno.cajeroId,
    monto: v.total,
    metodoPago: "banco",
    origen: "ecommerce",
    ecommerceNumero: v.number,
  });

  // Ítems SIN tocar stock: área del producto del POS (por ecommerce_item_key);
  // si no está en el POS, Con Sentido; una reserva de taller, Talleres.
  const lineas: { area: Area; bruto: number }[] = [];
  for (const item of v.items) {
    const producto = item.productId
      ? await csRepo.getProductoPorClaveEcommerce(client, claveItem(item.productId, item.variantId))
      : null;
    const area: Area = v.source === "BOOKING" ? "talleres" : ((producto?.areaDefecto as Area | undefined) ?? "con_sentido");
    await csRepo.crearVentaItem(client, {
      ventaId: venta.id,
      productoId: (producto?.id as string | undefined) ?? null,
      sku: item.sku,
      producto: item.name,
      cantidad: item.quantity,
      precioUnitario: item.unitPrice,
      moduloOrigenSlug: area,
    });
    lineas.push({ area, bruto: item.quantity * item.unitPrice });
  }
  if (v.shipping > 0) {
    await csRepo.crearVentaItem(client, {
      ventaId: venta.id,
      producto: "Envío",
      cantidad: 1,
      precioUnitario: v.shipping,
      moduloOrigenSlug: "con_sentido",
    });
    lineas.push({ area: "con_sentido", bruto: v.shipping });
  }
  if (v.discount > 0) {
    await csRepo.crearVentaItem(client, {
      ventaId: venta.id,
      producto: "Descuento cupón",
      cantidad: 1,
      precioUnitario: -v.discount,
      moduloOrigenSlug: "con_sentido",
    });
    lineas.push({ area: "con_sentido", bruto: -v.discount });
  }

  for (const parte of repartirPorArea(lineas, v.total)) {
    if (parte.monto <= 0) continue;
    await cajaRepo.insertIngreso(client, {
      turnoId: turno.id,
      moduloOrigenSlug: parte.area,
      monto: parte.monto,
      metodoPago: "banco",
      motivo: `Venta e-commerce ${v.number}${v.customerName ? ` — ${v.customerName}` : ""}`,
      referenciaEntidad: ENTIDAD,
      referenciaId: venta.id,
      usuarioId: turno.cajeroId,
      referenciaBanco: referenciaBanco(v),
    });
  }

  await client.query(
    `UPDATE ecommerce_ventas_pendientes
        SET estado = 'aplicada', turno_id = $2, venta_id = $3, aplicado_en = CURRENT_TIMESTAMP(6), detalle = NULL
      WHERE id = $1`,
    [filaId, turno.id, venta.id],
  );
}

/** SALE_REVERSED — solo dinero; el stock ya lo repuso el e-commerce (STOCK_DELTA). */
export async function revertirVentaEcommerce(client: PoolClient, a: AnulacionVentaEcommerce): Promise<ResultadoVenta> {
  const res = await client.query(
    `SELECT * FROM ecommerce_ventas_pendientes WHERE origen = $1 AND origen_id = $2 FOR UPDATE`,
    [a.source, a.sourceId],
  );
  const fila = res.rows[0];
  const detalle = `${a.reason === "REFUNDED" ? "Reembolsado" : "Cancelado"} en el e-commerce`;

  if (!fila) {
    // Llegó primero la anulación: queda descartada, así un SALE_RECORDED tardío da DUPLICATE.
    await client.query(
      `INSERT INTO ecommerce_ventas_pendientes (origen, origen_id, numero, estado, detalle) VALUES ($1, $2, $3, 'descartada', $4)`,
      [a.source, a.sourceId, a.number, detalle],
    );
    return { status: "APPLIED" };
  }
  if (fila.estado === "pendiente") {
    await client.query(`UPDATE ecommerce_ventas_pendientes SET estado = 'descartada', detalle = $2 WHERE id = $1`, [
      fila.id,
      detalle,
    ]);
    return { status: "APPLIED" };
  }
  if (fila.estado !== "aplicada" || Number(fila.reversion_pendiente) === 1) return { status: "DUPLICATE" };

  const turnoAbierto = await cajaRepo.findTurnoAbierto(client);
  if (turnoAbierto && turnoAbierto.id === fila.turno_id) {
    await anularEnSuTurno(client, fila, a.number, detalle, turnoAbierto.cajeroId);
  } else if (turnoAbierto) {
    await egresoDeReembolso(client, fila, turnoAbierto, detalle);
  } else {
    await client.query(`UPDATE ecommerce_ventas_pendientes SET reversion_pendiente = 1, detalle = $2 WHERE id = $1`, [
      fila.id,
      detalle,
    ]);
  }
  return { status: "APPLIED" };
}

// Su turno sigue abierto: se anula la venta y se borran sus ingresos (con
// historial, igual que Caja → Anular venta), sin tocar stock.
async function anularEnSuTurno(client: PoolClient, fila: any, numero: string, detalle: string, usuarioId: string) {
  await anularMovimientosPorReferencia(client, ENTIDAD, fila.venta_id, `${detalle} (${numero})`, usuarioId);
  await client.query(`UPDATE con_sentido_ventas SET estado = 'anulada' WHERE id = $1`, [fila.venta_id]);
  await client.query(
    `UPDATE ecommerce_ventas_pendientes SET estado = 'anulada', reversion_pendiente = 0, detalle = $2 WHERE id = $1`,
    [fila.id, detalle],
  );
}

// Su turno ya cerró: no se reescribe un cierre hecho — sale como egreso por
// banco en el turno abierto. La venta queda marcada anulada en el historial.
async function egresoDeReembolso(client: PoolClient, fila: any, turno: Turno, detalle: string) {
  const payload: VentaEcommerce = typeof fila.payload === "string" ? JSON.parse(fila.payload) : fila.payload;
  const cat = await client.query(`SELECT id FROM categorias_gasto WHERE nombre = $1`, [CATEGORIA_DEVOLUCIONES]);
  let categoriaId: number | undefined = cat.rows[0]?.id;
  if (!categoriaId) {
    const nueva = await client.query(`INSERT INTO categorias_gasto (nombre) VALUES ($1) RETURNING id`, [CATEGORIA_DEVOLUCIONES]);
    categoriaId = nueva.rows[0].id;
  }
  await cajaRepo.insertEgreso(client, {
    turnoId: turno.id,
    categoriaGastoId: categoriaId!,
    monto: Number(payload.total),
    metodoPago: "banco",
    motivo: `${detalle}: ${fila.numero}`,
    usuarioId: turno.cajeroId,
    referenciaEntidad: ENTIDAD,
    referenciaId: fila.venta_id,
  });
  await client.query(`UPDATE con_sentido_ventas SET estado = 'anulada' WHERE id = $1`, [fila.venta_id]);
  await client.query(
    `UPDATE ecommerce_ventas_pendientes SET estado = 'anulada', reversion_pendiente = 0, detalle = $2 WHERE id = $1`,
    [fila.id, detalle],
  );
}

/**
 * Al abrir turno y en el cron: aplica las ventas pendientes y las anulaciones
 * en espera, cada una en su propia transacción — si una falla (datos rotos),
 * queda pendiente con el error en `detalle` y las demás siguen.
 */
export async function aplicarPendientes(): Promise<{ aplicadas: number; reversiones: number; errores: number }> {
  const turno = await cajaRepo.findTurnoAbierto();
  if (!turno) return { aplicadas: 0, reversiones: 0, errores: 0 };

  const resultado = { aplicadas: 0, reversiones: 0, errores: 0 };
  const pendientes = await pool.query(
    `SELECT id FROM ecommerce_ventas_pendientes
      WHERE estado = 'pendiente' OR (estado = 'aplicada' AND reversion_pendiente = 1)
      ORDER BY recibido_en ASC`,
  );
  for (const { id } of pendientes.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(`SELECT * FROM ecommerce_ventas_pendientes WHERE id = $1 FOR UPDATE`, [id]);
      const fila = res.rows[0];
      if (fila?.estado === "pendiente") {
        const v: VentaEcommerce = typeof fila.payload === "string" ? JSON.parse(fila.payload) : fila.payload;
        if (!Array.isArray(v?.items)) throw new Error("payload sin ítems");
        await aplicarVenta(client, fila.id, v, turno);
        resultado.aplicadas++;
      } else if (fila?.estado === "aplicada" && Number(fila.reversion_pendiente) === 1) {
        if (fila.turno_id === turno.id) {
          await anularEnSuTurno(client, fila, fila.numero, fila.detalle ?? "Anulado en el e-commerce", turno.cajeroId);
        } else {
          await egresoDeReembolso(client, fila, turno, fila.detalle ?? "Anulado en el e-commerce");
        }
        resultado.reversiones++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      resultado.errores++;
      const mensaje = (err as Error).message?.slice(0, 280) ?? String(err);
      console.error(`[ventas e-commerce] No se pudo aplicar ${id}:`, err);
      await pool.query(`UPDATE ecommerce_ventas_pendientes SET detalle = $2 WHERE id = $1`, [id, `Error: ${mensaje}`]);
    } finally {
      client.release();
    }
  }
  return resultado;
}
