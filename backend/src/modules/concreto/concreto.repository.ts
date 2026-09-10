import { pool } from "../../shared/db/pool";
import type { ActualizarParametrosConcretoInput } from "./concreto.schema";

// Fila única de parámetros (siempre se actualiza sobre id=true), igual patrón
// que velas_parametros.
export async function getParametros() {
  const r = await pool.query(`SELECT * FROM concreto_parametros WHERE id = true`);
  return r.rows[0];
}

export async function actualizarParametros(d: ActualizarParametrosConcretoInput) {
  const r = await pool.query(
    `UPDATE concreto_parametros SET
       precio_cemento_gramo   = $1,
       precio_marmolina_gramo = $2,
       costo_agua             = $3,
       costo_pintura          = $4,
       costo_sellante         = $5,
       costo_lija             = $6,
       costo_mano_obra        = $7,
       multiplicador_precio   = $8,
       redondeo               = $9,
       updated_at             = now()
     WHERE id = true
     RETURNING *`,
    [
      d.precioCementoGramo,
      d.precioMarmolinaGramo,
      d.costoAgua,
      d.costoPintura,
      d.costoSellante,
      d.costoLija,
      d.costoManoObra,
      d.multiplicadorPrecio,
      d.redondeo,
    ],
  );
  return r.rows[0];
}
