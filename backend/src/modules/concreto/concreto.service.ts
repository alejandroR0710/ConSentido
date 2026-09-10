import * as repo from "./concreto.repository";
import type { ActualizarParametrosConcretoInput, CalcularConcretoInput } from "./concreto.schema";

// ============================================================================
// Fórmula de fabricación — FIJA por decisión del negocio, nunca configurable.
// ============================================================================
// Pieza de referencia: molde con 300 g de agua → pieza terminada de 549 g.
//   Base de mezcla = 300 × 1,8 = 540 g
// Como la calculadora solo recibe el peso final, se invierte esa relación:
//   Base de mezcla = peso final × (540 ÷ 549)
const FACTOR_CONVERSION = 540 / 549; // ≈ 0,983606557
const PORCENTAJE_CEMENTO = 0.4; // 40% de la base de mezcla
const PORCENTAJE_MARMOLINA = 0.6; // 60% de la base de mezcla
const PORCENTAJE_AGUA = 0.24; // 24% de la base de mezcla

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
 * receta (40/60/24 y el factor de conversión) va fija arriba.
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
  const baseMezclaG = pesoFinalG * FACTOR_CONVERSION;
  const cementoG = baseMezclaG * PORCENTAJE_CEMENTO;
  const marmolinaG = baseMezclaG * PORCENTAJE_MARMOLINA;
  const aguaG = baseMezclaG * PORCENTAJE_AGUA;

  const costoCemento = cementoG * precioCementoGramo;
  const costoMarmolina = marmolinaG * precioMarmolinaGramo;
  const costosAdicionales = costoAgua + costoPintura + costoSellante + costoLija + costoManoObra;
  const costoTotal = costoCemento + costoMarmolina + costosAdicionales;
  const precioVenta = redondear(costoTotal * multiplicador, redondeo);

  return {
    pesoFinalG,
    baseMezclaG,
    cementoG,
    marmolinaG,
    aguaG,
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
