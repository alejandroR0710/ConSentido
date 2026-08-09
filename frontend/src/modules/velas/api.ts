import { apiFetch } from "../../shared/api/client";

// Tablas maestras — valores computados (valor_gramo/valor_cm) siempre en
// vivo en la base (GENERATED ALWAYS), nunca se recalculan acá.
export interface Cera {
  id: string;
  nombre: string;
  presentacion_kg: string;
  precio_compra: string;
  valor_gramo: string;
  proveedor: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Fragancia {
  id: string;
  nombre: string;
  presentacion_g: string;
  precio_compra: string;
  valor_gramo: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pabilo {
  id: string;
  talla: string;
  longitud_m: string;
  precio_carrete: string;
  valor_cm: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export type CategoriaInsumoVela =
  | "recipiente"
  | "tapa"
  | "empaque"
  | "decoracion"
  | "identidad"
  | "papeleria"
  | "proteccion"
  | "otro";
export type UnidadCostoVela = "unidad" | "cm" | "g" | "hoja" | "metro";

export interface InsumoVela {
  id: string;
  codigo: string | null;
  nombre: string;
  categoria: CategoriaInsumoVela;
  unidad_costo: UnidadCostoVela;
  valor_unitario: string;
  cantidad_por_paquete: string | null;
  precio_paquete: string | null;
  proveedor: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ParametrosVela {
  multiplicador_precio: string;
  updated_at: string;
}

export type TipoVela = "decorativa" | "vaso" | "wax_melt";

// Composición de una receta — misma forma para /calcular (no persiste) y
// para crear/editar una receta guardada.
export interface RecetaInput {
  tipoVela: TipoVela;
  // Peso TOTAL pesado (bruto) — el servidor descuenta la merma del tipo de
  // vela para obtener el peso de cera realmente aprovechable.
  pesoMezclaG: number;
  ceras: { ceraId: string; gramos: number }[];
  fragancias: { fraganciaId: string; porcentaje: number }[];
  pabiloId?: string;
  cmPabilo?: number;
  insumos: { insumoId: string; cantidad: number }[];
  // Monto fijo escrito a mano, no minutos × tarifa.
  costoManoObra: number;
  multiplicadorPrecio?: number;
  redondeo: 0 | 100 | 500 | 1000;
}

export interface LineaCostoCera {
  nombre: string;
  gramos: number;
  valorGramo: number;
  costo: number;
}
export interface LineaCostoFragancia {
  nombre: string;
  porcentaje: number;
  gramos: number;
  valorGramo: number;
  costo: number;
}
export interface LineaCostoPabilo {
  nombre: string;
  cm: number;
  valorCm: number;
  costo: number;
}
export interface LineaCostoInsumo {
  nombre: string;
  categoria: string;
  cantidad: number;
  valorUnitario: number;
  costo: number;
}

export interface CalculoReceta {
  tipoVela: TipoVela;
  pesoMermaPorcentaje: number;
  pesoEfectivoG: number;
  lineasCera: LineaCostoCera[];
  lineasFragancia: LineaCostoFragancia[];
  lineaPabilo: LineaCostoPabilo | null;
  lineasInsumo: LineaCostoInsumo[];
  costoBase: number;
  costoManoObra: number;
  costoInsumos: number;
  costoTotal: number;
  multiplicadorAplicado: number;
  redondeo: number;
  precioVenta: number;
  alertas: string[];
}

export interface ProductoVelaResumen {
  id: string;
  nombre: string;
  activo: boolean;
  updatedAt: string;
  precioFinalAutorizado: number | null;
  costoTotal: number;
  precioSugerido: number;
  alertas: string[];
}

export interface ProductoVelaDetalle {
  id: string;
  nombre: string;
  notas: string | null;
  activo: boolean;
  precioFinalAutorizado: number | null;
  composicion: RecetaInput;
  costo: CalculoReceta;
}

export const velasApi = {
  // Ceras
  listarCeras: () => apiFetch<Cera[]>("/velas/ceras"),
  listarCerasAdmin: () => apiFetch<Cera[]>("/velas/ceras/admin"),
  crearCera: (input: { nombre: string; presentacionKg: number; precioCompra: number; proveedor?: string }) =>
    apiFetch<Cera>("/velas/ceras", { method: "POST", body: input }),
  editarCera: (
    id: string,
    input: Partial<{ nombre: string; presentacionKg: number; precioCompra: number; proveedor: string; activo: boolean }>,
  ) => apiFetch<Cera>(`/velas/ceras/${id}`, { method: "PATCH", body: input }),

  // Fragancias
  listarFragancias: () => apiFetch<Fragancia[]>("/velas/fragancias"),
  listarFraganciasAdmin: () => apiFetch<Fragancia[]>("/velas/fragancias/admin"),
  crearFragancia: (input: { nombre: string; presentacionG?: number; precioCompra: number }) =>
    apiFetch<Fragancia>("/velas/fragancias", { method: "POST", body: input }),
  editarFragancia: (
    id: string,
    input: Partial<{ nombre: string; presentacionG: number; precioCompra: number; activo: boolean }>,
  ) => apiFetch<Fragancia>(`/velas/fragancias/${id}`, { method: "PATCH", body: input }),

  // Pabilos
  listarPabilos: () => apiFetch<Pabilo[]>("/velas/pabilos"),
  listarPabilosAdmin: () => apiFetch<Pabilo[]>("/velas/pabilos/admin"),
  crearPabilo: (input: { talla: string; longitudM: number; precioCarrete: number }) =>
    apiFetch<Pabilo>("/velas/pabilos", { method: "POST", body: input }),
  editarPabilo: (id: string, input: Partial<{ talla: string; longitudM: number; precioCarrete: number; activo: boolean }>) =>
    apiFetch<Pabilo>(`/velas/pabilos/${id}`, { method: "PATCH", body: input }),

  // Insumos (recipientes, tapas, empaques, decoración, identidad, papelería, protección, otros)
  listarInsumos: () => apiFetch<InsumoVela[]>("/velas/insumos"),
  listarInsumosAdmin: () => apiFetch<InsumoVela[]>("/velas/insumos/admin"),
  crearInsumo: (input: {
    codigo?: string;
    nombre: string;
    categoria: CategoriaInsumoVela;
    unidadCosto: UnidadCostoVela;
    valorUnitario: number;
    cantidadPorPaquete?: number;
    precioPaquete?: number;
    proveedor?: string;
  }) => apiFetch<InsumoVela>("/velas/insumos", { method: "POST", body: input }),
  editarInsumo: (
    id: string,
    input: Partial<{
      codigo: string;
      nombre: string;
      categoria: CategoriaInsumoVela;
      unidadCosto: UnidadCostoVela;
      valorUnitario: number;
      cantidadPorPaquete: number;
      precioPaquete: number;
      proveedor: string;
      activo: boolean;
    }>,
  ) => apiFetch<InsumoVela>(`/velas/insumos/${id}`, { method: "PATCH", body: input }),

  // Parámetros globales
  obtenerParametros: () => apiFetch<ParametrosVela>("/velas/parametros"),
  actualizarParametros: (input: { multiplicadorPrecio: number }) =>
    apiFetch<ParametrosVela>("/velas/parametros", { method: "PUT", body: input }),

  // Calculadora (no persiste)
  calcular: (input: RecetaInput) => apiFetch<CalculoReceta>("/velas/calcular", { method: "POST", body: input }),

  // Recetas guardadas
  listarProductos: () => apiFetch<ProductoVelaResumen[]>("/velas/productos"),
  obtenerProducto: (id: string) => apiFetch<ProductoVelaDetalle>(`/velas/productos/${id}`),
  crearProducto: (input: RecetaInput & { nombre: string; notas?: string; precioFinalAutorizado?: number }) =>
    apiFetch<ProductoVelaDetalle>("/velas/productos", { method: "POST", body: input }),
  duplicarProducto: (id: string) => apiFetch<ProductoVelaDetalle>(`/velas/productos/${id}/duplicar`, { method: "POST" }),
  editarProducto: (id: string, input: Partial<RecetaInput & { nombre: string; notas: string; precioFinalAutorizado: number; activo: boolean }>) =>
    apiFetch<ProductoVelaDetalle>(`/velas/productos/${id}`, { method: "PATCH", body: input }),
  eliminarProducto: (id: string) => apiFetch<{ eliminada: boolean }>(`/velas/productos/${id}`, { method: "DELETE" }),
};
