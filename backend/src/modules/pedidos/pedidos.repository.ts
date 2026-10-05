import { Pool, PoolClient, pool } from "../../shared/db/pool";
import { EditarPedidoInput } from "./pedidos.schema";

type Executor = Pool | PoolClient;

const SELECT_PEDIDO = `
  SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
         resp.nombre AS responsable_nombre, creador.nombre AS creado_por_nombre
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN usuarios resp ON resp.id = p.responsable_id
    LEFT JOIN usuarios creador ON creador.id = p.creado_por_id
`;

export interface FiltrosListarPedidos {
  estado?: string;
  vencidos?: boolean;
}

export async function listPedidos(filtros: FiltrosListarPedidos) {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtros.estado) {
    condiciones.push(`p.estado = $${params.length + 1}`);
    params.push(filtros.estado);
  }
  if (filtros.vencidos) {
    // No se usa proxima_alarma_en acá: ese campo lo adelanta el scheduler de
    // alarma.ts apenas lo nota vencido (cada 60s), así que solo queda <= NOW()
    // durante una ventana angosta de hasta 60s por ciclo — un listado que
    // dependiera de eso podría "perderse" el vencimiento si consulta justo
    // después de que el scheduler ya lo reprogramó. Acá se recalcula directo
    // desde cuándo empezó a correr el reloj de este estado, así que el
    // resultado es siempre correcto sin importar cuándo corrió el scheduler.
    condiciones.push(
      `p.estado IN ('pendiente', 'alistado') AND TIMESTAMPDIFF(MINUTE, COALESCE(p.alistado_en, p.created_at), NOW()) >= (SELECT intervalo_alarma_minutos FROM pedidos_parametros WHERE id = true)`,
    );
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(`${SELECT_PEDIDO} ${where} ORDER BY p.created_at DESC`, params);
  return result.rows;
}

export async function getPedidoById(id: string, executor: Executor = pool) {
  const result = await executor.query(`${SELECT_PEDIDO} WHERE p.id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

/** Misma fila, bloqueada (FOR UPDATE) hasta el COMMIT — para cambiar estado
 *  sin que dos requests simultáneos lean el mismo estado de partida. */
export async function getPedidoParaCambiarEstado(client: PoolClient, id: string) {
  const result = await client.query(`SELECT * FROM pedidos WHERE id = $1 FOR UPDATE`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function getItemsPorPedido(pedidoId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT id, pedido_id, producto_id, sku, nombre, cantidad, precio_unitario,
            (cantidad * precio_unitario) AS subtotal
       FROM pedido_items WHERE pedido_id = $1 ORDER BY id`,
    [pedidoId],
  );
  return result.rows;
}

export async function getAbonosPorPedido(pedidoId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT a.id, a.monto, a.metodo_pago, a.created_at, u.nombre AS usuario_nombre
       FROM pedido_abonos a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.pedido_id = $1 ORDER BY a.created_at`,
    [pedidoId],
  );
  return result.rows;
}

export async function sumAbonosPorPedido(pedidoId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM pedido_abonos WHERE pedido_id = $1`,
    [pedidoId],
  );
  return Number(result.rows[0].total);
}

export async function getHistorialPorPedido(pedidoId: string) {
  const result = await pool.query(
    `SELECT h.id, h.accion, h.detalle, h.created_at, u.nombre AS usuario_nombre
       FROM pedido_historial h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.pedido_id = $1 ORDER BY h.created_at`,
    [pedidoId],
  );
  return result.rows;
}

export async function insertHistorial(
  executor: Executor,
  params: { pedidoId: string; accion: string; detalle?: Record<string, unknown>; usuarioId: string | null },
) {
  await executor.query(
    `INSERT INTO pedido_historial (pedido_id, accion, detalle, usuario_id) VALUES ($1, $2, $3, $4)`,
    [params.pedidoId, params.accion, params.detalle ? JSON.stringify(params.detalle) : null, params.usuarioId],
  );
}

export async function crearPedido(
  client: PoolClient,
  params: {
    clienteId: string | null;
    descripcion: string;
    fechaEntrega: string;
    costoEstimado: number;
    precioAcordado: number;
    responsableId: string | null;
    creadoPorId: string;
    proximaAlarmaEn: Date;
  } & Omit<EditarPedidoInput, "descripcion" | "fechaEntrega" | "responsableId">,
) {
  const result = await client.query(
    `INSERT INTO pedidos (
       cliente_id, descripcion, fecha_entrega, destinatario_nombre, destinatario_documento,
       destinatario_telefono, direccion_envio, ciudad_envio, transportadora, numero_guia,
       notas_entrega, costo_estimado, precio_acordado, responsable_id, creado_por_id,
       proxima_alarma_en
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      params.clienteId,
      params.descripcion,
      params.fechaEntrega,
      params.destinatarioNombre ?? null,
      params.destinatarioDocumento ?? null,
      params.destinatarioTelefono ?? null,
      params.direccionEnvio ?? null,
      params.ciudadEnvio ?? null,
      params.transportadora ?? null,
      params.numeroGuia ?? null,
      params.notasEntrega ?? null,
      params.costoEstimado,
      params.precioAcordado,
      params.responsableId,
      params.creadoPorId,
      params.proximaAlarmaEn,
    ],
  );
  return result.rows[0];
}

export async function crearPedidoItems(
  client: PoolClient,
  pedidoId: string,
  items: { productoId: string | null; sku: string | null; nombre: string; cantidad: number; precioUnitario: number }[],
) {
  for (const item of items) {
    await client.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, sku, nombre, cantidad, precio_unitario)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [pedidoId, item.productoId, item.sku, item.nombre, item.cantidad, item.precioUnitario],
    );
  }
}

export async function actualizarPedido(id: string, input: EditarPedidoInput) {
  const result = await pool.query(
    `UPDATE pedidos SET
       descripcion = COALESCE($2, descripcion),
       fecha_entrega = COALESCE($3, fecha_entrega),
       destinatario_nombre = COALESCE($4, destinatario_nombre),
       destinatario_documento = COALESCE($5, destinatario_documento),
       destinatario_telefono = COALESCE($6, destinatario_telefono),
       direccion_envio = COALESCE($7, direccion_envio),
       ciudad_envio = COALESCE($8, ciudad_envio),
       transportadora = COALESCE($9, transportadora),
       numero_guia = COALESCE($10, numero_guia),
       notas_entrega = COALESCE($11, notas_entrega),
       responsable_id = COALESCE($12, responsable_id)
     WHERE id = $1
     RETURNING id`,
    [
      id,
      input.descripcion ?? null,
      input.fechaEntrega ?? null,
      input.destinatarioNombre ?? null,
      input.destinatarioDocumento ?? null,
      input.destinatarioTelefono ?? null,
      input.direccionEnvio ?? null,
      input.ciudadEnvio ?? null,
      input.transportadora ?? null,
      input.numeroGuia ?? null,
      input.notasEntrega ?? null,
      input.responsableId ?? null,
    ],
  );
  return result.rowCount ? result.rows[0].id : null;
}

/** `timestampCampo` es el nombre de columna literal (alistado_en/enviado_en/
 *  entregado_en) — siempre uno de esos 3 valores fijos, nunca entrada del
 *  usuario, así que interpolarlo en el SQL es seguro. `transportadora`/
 *  `numeroGuia` solo llegan al marcar "enviado" (ver cambiarEstadoPedido) —
 *  con COALESCE no se pisan si el pedido ya los tenía de una edición previa. */
export async function actualizarEstadoPedido(
  client: PoolClient,
  id: string,
  params: {
    estado: string;
    timestampCampo?: "alistado_en" | "enviado_en" | "entregado_en";
    proximaAlarmaEn: Date | null;
    transportadora?: string;
    numeroGuia?: string;
  },
) {
  const campoTimestamp = params.timestampCampo ? `, ${params.timestampCampo} = NOW()` : "";
  await client.query(
    `UPDATE pedidos SET estado = $1, proxima_alarma_en = $2,
       transportadora = COALESCE($4, transportadora),
       numero_guia = COALESCE($5, numero_guia)
       ${campoTimestamp}
     WHERE id = $3`,
    [params.estado, params.proximaAlarmaEn, id, params.transportadora ?? null, params.numeroGuia ?? null],
  );
}

export async function crearAbono(
  client: PoolClient,
  params: { pedidoId: string; monto: number; metodoPago: "efectivo" | "banco"; usuarioId: string },
) {
  const result = await client.query(
    `INSERT INTO pedido_abonos (pedido_id, monto, metodo_pago, usuario_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [params.pedidoId, params.monto, params.metodoPago, params.usuarioId],
  );
  return result.rows[0];
}

/** Borra un abono por completo — usado al cancelar un pedido ya enviado
 *  (Root/Super Root), junto con la reversión de su ingreso en Caja. */
export async function borrarAbono(client: PoolClient, abonoId: string) {
  await client.query(`DELETE FROM pedido_abonos WHERE id = $1`, [abonoId]);
}

/** Info de un producto del catálogo de Con Sentido para armar un ítem de
 *  pedido (nombre/sku/costo de referencia) — de solo lectura, sin bloquear
 *  fila: el stock de verdad se descuenta recién al alistar (ver stock-venta.ts). */
export async function getProductoInfo(id: string) {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.sku, p.costo
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
      WHERE p.id = $1 AND m.slug = 'con_sentido'`,
    [id],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function getParametros() {
  const result = await pool.query(`SELECT * FROM pedidos_parametros WHERE id = true`);
  return result.rows[0];
}

export async function actualizarParametros(intervaloAlarmaMinutos: number) {
  const result = await pool.query(
    `UPDATE pedidos_parametros SET intervalo_alarma_minutos = $1, updated_at = NOW() WHERE id = true RETURNING *`,
    [intervaloAlarmaMinutos],
  );
  return result.rows[0];
}

export async function listPedidosVencidos() {
  const result = await pool.query(
    `SELECT id, descripcion, estado, destinatario_nombre
       FROM pedidos
      WHERE estado IN ('pendiente', 'alistado') AND proxima_alarma_en IS NOT NULL AND proxima_alarma_en <= NOW()`,
  );
  return result.rows;
}

export async function reprogramarAlarma(id: string, minutos: number) {
  await pool.query(
    `UPDATE pedidos SET proxima_alarma_en = DATE_ADD(NOW(), INTERVAL $2 MINUTE) WHERE id = $1`,
    [id, minutos],
  );
}

/** Get-or-create idempotente — mismo patrón que con_sentido.repository.ts::
 *  getOrCrearFactura, comparte la misma facturas_numero_seq. El índice único
 *  en pedido_id (ver migración 2026-10-04) blinda contra doble clic. */
export async function getOrCrearFacturaPedido(
  params: { pedidoId: string; subtotal: number; total: number },
  executor: Executor = pool,
) {
  const insert = await executor.query(
    `INSERT INTO facturas (pedido_id, numero, tipo, subtotal, total)
     VALUES ($1, 'F-' || lpad(nextval('facturas_numero_seq'), 6, '0'), 'factura', $2, $3)
     ON CONFLICT (pedido_id) WHERE pedido_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [params.pedidoId, params.subtotal, params.total],
  );
  if (insert.rowCount) return insert.rows[0];
  const existente = await executor.query(`SELECT * FROM facturas WHERE pedido_id = $1`, [params.pedidoId]);
  return existente.rows[0];
}
