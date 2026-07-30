import { pool } from "../../shared/db/pool";
import { descomponerPago } from "../../shared/utils/pago-mixto";

interface VentaItem {
  producto: string;
  descripcion?: string;
  categoria?: string;
  cantidad: number;
  precioUnitario: number;
}

interface VentaInput {
  items: VentaItem[];
  monto: number;
  metodoPago: "efectivo" | "banco" | "mixto";
  montoEfectivo?: number;
  montoBanco?: number;
}

export async function registrarVentaService(
  usuario_id: string,
  ventaData: VentaInput,
) {
  try {
    // Obtener turno actual
    const turnoResult = await pool.query(
      `SELECT id FROM turnos_caja WHERE estado = 'abierto' ORDER BY abierto_en DESC LIMIT 1`,
    );

    if (!turnoResult.rows.length) {
      throw new Error("No hay turno abierto");
    }

    const turno_id = turnoResult.rows[0].id;
    const motivo = ventaData.items?.map((i) => i.producto).join(", ") || "Venta";

    // Guardar PRIMERO en con_sentido_ventas (tabla con todos los detalles)
    const ventaResult = await pool.query(
      `
      INSERT INTO con_sentido_ventas (usuario_id, monto, metodo_pago, monto_efectivo, monto_banco)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [
        usuario_id || null,
        ventaData.monto,
        ventaData.metodoPago,
        ventaData.montoEfectivo || null,
        ventaData.montoBanco || null,
      ],
    );

    const venta_id = ventaResult.rows[0].id;

    // Guardar items en con_sentido_venta_items (con la FK a con_sentido_ventas)
    if (ventaData.items && ventaData.items.length > 0) {
      for (const item of ventaData.items) {
        try {
          const cantidad = typeof item.cantidad === "number" ? item.cantidad : parseFloat(item.cantidad as any);
          const precioUnitario = typeof item.precioUnitario === "number" ? item.precioUnitario : parseFloat(item.precioUnitario as any);

          if (!Number.isFinite(cantidad) || !Number.isFinite(precioUnitario)) {
            console.error("Item con valores no numéricos:", { item, cantidad, precioUnitario });
            continue;
          }

          if (cantidad <= 0 || precioUnitario <= 0) {
            console.warn("Item con valores inválidos (<=0):", item);
            continue;
          }

          await pool.query(
            `
            INSERT INTO con_sentido_venta_items (venta_id, producto, descripcion, categoria, cantidad, precio_unitario)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
              venta_id,
              item.producto || "Producto sin nombre",
              item.descripcion || null,
              item.categoria || null,
              cantidad,
              precioUnitario,
            ],
          );
        } catch (itemErr) {
          console.error("Error guardando item:", itemErr, "Item:", item);
        }
      }
    }

    // AHORA guardar en movimientos_caja (SOLO para sincronización con Caja General)
    // Para "mixto", descomponer en dos movimientos
    if (ventaData.metodoPago === "mixto") {
      const pagos = descomponerPago({
        metodoPago: "mixto",
        montoEfectivo: ventaData.montoEfectivo || 0,
        montoBanco: ventaData.montoBanco || 0,
      });

      for (const pago of pagos) {
        const insertQuery = usuario_id
          ? `INSERT INTO movimientos_caja (turno_id, tipo, modulo_origen_id, monto, metodo_pago, motivo, usuario_id)
             VALUES ($1, 'ingreso', 4, $2, $3, $4, $5) RETURNING id`
          : `INSERT INTO movimientos_caja (turno_id, tipo, modulo_origen_id, monto, metodo_pago, motivo)
             VALUES ($1, 'ingreso', 4, $2, $3, $4) RETURNING id`;

        const params = usuario_id
          ? [turno_id, pago.monto, pago.metodoPago, motivo, usuario_id]
          : [turno_id, pago.monto, pago.metodoPago, motivo];

        await pool.query(insertQuery, params);
      }
    } else {
      const insertQuery = usuario_id
        ? `INSERT INTO movimientos_caja (turno_id, tipo, modulo_origen_id, monto, metodo_pago, motivo, usuario_id)
           VALUES ($1, 'ingreso', 4, $2, $3, $4, $5) RETURNING id`
        : `INSERT INTO movimientos_caja (turno_id, tipo, modulo_origen_id, monto, metodo_pago, motivo)
           VALUES ($1, 'ingreso', 4, $2, $3, $4) RETURNING id`;

      const params = usuario_id
        ? [turno_id, ventaData.monto, ventaData.metodoPago, motivo, usuario_id]
        : [turno_id, ventaData.monto, ventaData.metodoPago, motivo];

      await pool.query(insertQuery, params);
    }

    return {
      id: venta_id,
      monto: ventaData.monto,
      metodoPago: ventaData.metodoPago,
      items: ventaData.items || [],
    };
  } catch (error) {
    console.error("Error registrando venta:", error);
    throw error;
  }
}

export async function listarVentasService(
  skip: number = 0,
  limit: number = 50,
  fecha?: string,
) {
  try {
    // Cargar desde con_sentido_ventas (detalles) pero sincronizar metodo_pago desde movimientos_caja
    let query = `
    SELECT
      cv.id::text as id,
      cv.created_at,
      cv.monto::numeric,
      COALESCE(mc.metodo_pago, cv.metodo_pago) as metodo_pago,
      COALESCE(
        json_agg(
          json_build_object(
            'producto', cvi.producto,
            'descripcion', cvi.descripcion,
            'categoria', cvi.categoria,
            'cantidad', cvi.cantidad,
            'precio_unitario', cvi.precio_unitario,
            'subtotal', cvi.subtotal
          ) ORDER BY cvi.id
        ) FILTER (WHERE cvi.id IS NOT NULL),
        '[]'::json
      ) as items
    FROM con_sentido_ventas cv
    LEFT JOIN movimientos_caja mc ON cv.id::text = mc.motivo AND mc.modulo_origen_id = 4
    LEFT JOIN con_sentido_venta_items cvi ON cv.id = cvi.venta_id
    WHERE 1=1
    `;

    const params: any[] = [];

    if (fecha) {
      query += ` AND DATE(cv.created_at) = $${params.length + 1}`;
      params.push(fecha);
    }

    query += ` GROUP BY cv.id, mc.metodo_pago ORDER BY cv.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, skip);

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error("Error listando ventas:", error);
    throw error;
  }
}

export async function obtenerVentaService(venta_id: string) {
  try {
    const result = await pool.query(
      `
      SELECT
        cv.id::text as id,
        cv.created_at,
        cv.monto::numeric,
        COALESCE(mc.metodo_pago, cv.metodo_pago) as metodo_pago,
        COALESCE(
          json_agg(
            json_build_object(
              'producto', cvi.producto,
              'descripcion', cvi.descripcion,
              'categoria', cvi.categoria,
              'cantidad', cvi.cantidad,
              'precio_unitario', cvi.precio_unitario,
              'subtotal', cvi.subtotal
            ) ORDER BY cvi.id
          ) FILTER (WHERE cvi.id IS NOT NULL),
          '[]'::json
        ) as items
      FROM con_sentido_ventas cv
      LEFT JOIN movimientos_caja mc ON cv.id::text = mc.motivo AND mc.modulo_origen_id = 4
      LEFT JOIN con_sentido_venta_items cvi ON cv.id = cvi.venta_id
      WHERE cv.id = $1
      GROUP BY cv.id, mc.metodo_pago
      `,
      [venta_id],
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error("Error obteniendo venta:", error);
    throw error;
  }
}
