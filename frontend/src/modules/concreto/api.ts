import { apiFetch } from "../../shared/api/client";

// Fila única en la base — NUMERIC vuelve como texto, hay que parsear con
// Number(...) antes de usar en cuentas o inputs.
export interface ParametrosConcreto {
  precio_cemento_gramo: string;
  precio_marmolina_gramo: string;
  costo_agua: string;
  costo_pintura: string;
  costo_sellante: string;
  costo_lija: string;
  costo_mano_obra: string;
  multiplicador_precio: string;
  redondeo: number;
  updated_at: string;
}

export interface ActualizarParametrosConcretoInput {
  precioCementoGramo: number;
  precioMarmolinaGramo: number;
  costoAgua: number;
  costoPintura: number;
  costoSellante: number;
  costoLija: number;
  costoManoObra: number;
  multiplicadorPrecio: number;
  redondeo: 0 | 100 | 500 | 1000;
}

// Resultado del cálculo — no persiste nada, se pide en cada cambio del peso.
export interface CalculoConcreto {
  pesoFinalG: number;
  baseMezclaG: number;
  cementoG: number;
  marmolinaG: number;
  aguaG: number;
  costoCemento: number;
  costoMarmolina: number;
  costosAdicionalesDetalle: {
    agua: number;
    pintura: number;
    sellante: number;
    lija: number;
    manoObra: number;
  };
  costosAdicionales: number;
  costoTotal: number;
  multiplicadorAplicado: number;
  redondeo: number;
  precioVenta: number;
}

export const concretoApi = {
  obtenerParametros: () => apiFetch<ParametrosConcreto>("/concreto/parametros"),
  actualizarParametros: (input: ActualizarParametrosConcretoInput) =>
    apiFetch<ParametrosConcreto>("/concreto/parametros", { method: "PUT", body: input }),
  calcular: (pesoFinalG: number) =>
    apiFetch<CalculoConcreto>("/concreto/calcular", { method: "POST", body: { pesoFinalG } }),
};
