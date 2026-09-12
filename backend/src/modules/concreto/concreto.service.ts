import * as repo from "./concreto.repository";
import type { ActualizarParametrosConcretoInput, CalcularConcretoInput } from "./concreto.schema";

// ============================================================================
// Fórmula de fabricación — FIJA por decisión del negocio, nunca configurable.
// ============================================================================
// Directo sobre el peso final de la pieza terminada, sin factor de
// conversión ni agua como material: cemento + marmolina ya suman el 100% de
// ese peso (el agua entra solo como costo fijo de proceso, ver costoAgua).
const PORCENTAJE_CEMENTO = 0.4; // 40% del peso final
const PORCENTAJE_MARMOLINA = 0.6; // 60% del peso final

/** Redondeo del precio de venta SIEMPRE hacia arriba — redondear hacia abajo
 *  le regalaría margen al negocio (mismo criterio que la calculadora de velas). */
function redondear(valor: number, multiplo: number): number {
  if (!multiplo) return Math.round(valor);
  return Math.ceil(valor / multiplo) * multiplo;
}

export const obtenerParametros = () => repo.getParametros();
export const actualizarParametros = (d: ActualizarParametrosConcretoInput) => repo.actualizarParametros(d);

/**
 * A partir de SOLO el peso final de la pieza terminada, devuelve el desglose
 * completo: gramos de cada material, costo de producción y precio de venta.
 * Los precios y costos fijos salen de concreto_parametros (editables); la
 * receta (40/60 directo sobre el peso final) va fija arriba.
 */
export async function calcular(input: CalcularConcretoInput) {
  const p = await repo.getParametros();
  // Cada campo: el override que mandó la pantalla (edición en vivo, sin
  // guardar) o, si no vino, el valor guardado en concreto_parametros.
  const precioCementoGramo = input.precioCementoGramo ?? Number(p.precio_cemento_gramo);
  const precioMarmolinaGramo = input.precioMarmolinaGramo ?? Number(p.precio_marmolina_gramo);
  const costoAgua = input.costoAgua ?? Number(p.costo_agua);
  const costoPintura = input.costoPintura ?? Number(p.costo_pintura);
  const costoSellante = input.costoSellante ?? Number(p.costo_sellante);
  const costoLija = input.costoLija ?? Number(p.costo_lija);
  const costoManoObra = input.costoManoObra ?? Number(p.costo_mano_obra);
  const multiplicador = input.multiplicadorPrecio ?? Number(p.multiplicador_precio);
  const redondeo = input.redondeo ?? Number(p.redondeo);

  const pesoFinalG = input.pesoFinalG;
  const cementoG = pesoFinalG * PORCENTAJE_CEMENTO;
  const marmolinaG = pesoFinalG * PORCENTAJE_MARMOLINA;

  const costoCemento = cementoG * precioCementoGramo;
  const costoMarmolina = marmolinaG * precioMarmolinaGramo;
  const costosAdicionales = costoAgua + costoPintura + costoSellante + costoLija + costoManoObra;
  const costoTotal = costoCemento + costoMarmolina + costosAdicionales;
  const precioVenta = redondear(costoTotal * multiplicador, redondeo);

  return {
    pesoFinalG,
    cementoG,
    marmolinaG,
    costoCemento,
    costoMarmolina,
    costosAdicionalesDetalle: {
      agua: costoAgua,
      pintura: costoPintura,
      sellante: costoSellante,
      lija: costoLija,
      manoObra: costoManoObra,
    },
    costosAdicionales,
    costoTotal,
    multiplicadorAplicado: multiplicador,
    redondeo,
    precioVenta,
  };
}
