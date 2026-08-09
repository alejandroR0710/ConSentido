import { Errors } from "../../shared/utils/app-error";
import * as repo from "./velas.repository";
import type { ComposicionReceta } from "./velas.repository";
import {
  ActualizarCeraInput,
  ActualizarFraganciaInput,
  ActualizarInsumoVelaInput,
  ActualizarPabiloInput,
  ActualizarParametrosInput,
  ActualizarProductoVelaInput,
  CalcularRecetaInput,
  CrearCeraInput,
  CrearFraganciaInput,
  CrearInsumoVelaInput,
  CrearPabiloInput,
  CrearProductoVelaInput,
} from "./velas.schema";

// ============================================================================
// Materiales (tablas maestras) — CRUD simple, activar/desactivar en vez de
// borrar (pueden estar referenciados por recetas ya guardadas).
// ============================================================================

export const listarCeras = () => repo.listCeras();
export const listarCerasAdmin = () => repo.listCerasAdmin();
export const crearCera = (data: CrearCeraInput) => repo.crearCera(data);
export async function editarCera(id: string, data: ActualizarCeraInput) {
  const r = await repo.actualizarCera(id, data);
  if (!r) throw Errors.notFound("Cera no encontrada");
  return r;
}

export const listarFragancias = () => repo.listFragancias();
export const listarFraganciasAdmin = () => repo.listFraganciasAdmin();
export const crearFragancia = (data: CrearFraganciaInput) => repo.crearFragancia(data);
export async function editarFragancia(id: string, data: ActualizarFraganciaInput) {
  const r = await repo.actualizarFragancia(id, data);
  if (!r) throw Errors.notFound("Fragancia no encontrada");
  return r;
}

export const listarPabilos = () => repo.listPabilos();
export const listarPabilosAdmin = () => repo.listPabilosAdmin();
export const crearPabilo = (data: CrearPabiloInput) => repo.crearPabilo(data);
export async function editarPabilo(id: string, data: ActualizarPabiloInput) {
  const r = await repo.actualizarPabilo(id, data);
  if (!r) throw Errors.notFound("Pabilo no encontrado");
  return r;
}

export const listarInsumosVela = () => repo.listInsumosVela();
export const listarInsumosVelaAdmin = () => repo.listInsumosVelaAdmin();
export const crearInsumoVela = (data: CrearInsumoVelaInput) => repo.crearInsumoVela(data);
export async function editarInsumoVela(id: string, data: ActualizarInsumoVelaInput) {
  const r = await repo.actualizarInsumoVela(id, data);
  if (!r) throw Errors.notFound("Insumo no encontrado");
  return r;
}

export const obtenerParametros = () => repo.getParametros();
export const actualizarParametros = (data: ActualizarParametrosInput) => repo.actualizarParametros(data);

// ============================================================================
// Cálculo de costos — punto único usado tanto por POST /calcular (no
// persiste) como al mostrar una receta guardada, para que el resultado sea
// exactamente el mismo cálculo en los dos casos.
// ============================================================================

function redondear(valor: number, multiplo: number): number {
  if (!multiplo) return Math.round(valor);
  // Siempre hacia arriba: redondear hacia abajo le regalaría margen al negocio.
  return Math.ceil(valor / multiplo) * multiplo;
}

// % del peso total que NO queda como cera aprovechable en el producto final
// (se pierde en el proceso propio de cada tipo) — cada tipo tiene su propia
// merma de fabricación, confirmado por el negocio.
const TIPO_VELA_MERMA_PORCENTAJE: Record<"decorativa" | "vaso" | "wax_melt", number> = {
  decorativa: 6,
  vaso: 12,
  wax_melt: 10,
};

export async function calcularCostoReceta(input: CalcularRecetaInput | ComposicionReceta) {
  const ceraIds = input.ceras.map((c) => c.ceraId);
  const fraganciaIds = input.fragancias.map((f) => f.fraganciaId);
  const insumoIds = input.insumos.map((i) => i.insumoId);

  const [ceras, fragancias, pabilo, insumos, parametros] = await Promise.all([
    repo.getCerasByIds(ceraIds),
    repo.getFraganciasByIds(fraganciaIds),
    input.pabiloId ? repo.getPabiloById(input.pabiloId) : Promise.resolve(null),
    repo.getInsumosVelaByIds(insumoIds),
    repo.getParametros(),
  ]);

  const mapCeras = new Map(ceras.map((c) => [c.id, c]));
  const mapFragancias = new Map(fragancias.map((f) => [f.id, f]));
  const mapInsumos = new Map(insumos.map((i) => [i.id, i]));

  const alertas: string[] = [];

  // Peso realmente aprovechable como cera — el peso total (bruto) menos la
  // merma propia del tipo de vela, ver TIPO_VELA_MERMA_PORCENTAJE arriba.
  const pesoMermaPorcentaje = TIPO_VELA_MERMA_PORCENTAJE[input.tipoVela];
  const pesoEfectivoG = input.pesoMezclaG * (1 - pesoMermaPorcentaje / 100);

  const lineasCera = input.ceras.map((linea) => {
    const cera = mapCeras.get(linea.ceraId);
    if (!cera) throw Errors.badRequest("Una de las ceras seleccionadas ya no existe");
    if (!cera.activo) alertas.push(`La cera "${cera.nombre}" está inactiva`);
    const valorGramo = Number(cera.valor_gramo);
    return { nombre: cera.nombre as string, gramos: linea.gramos, valorGramo, costo: linea.gramos * valorGramo };
  });

  const lineasFragancia = input.fragancias.map((linea) => {
    const fragancia = mapFragancias.get(linea.fraganciaId);
    if (!fragancia) throw Errors.badRequest("Una de las fragancias seleccionadas ya no existe");
    if (!fragancia.activo) alertas.push(`La fragancia "${fragancia.nombre}" está inactiva`);
    const valorGramo = Number(fragancia.valor_gramo);
    const gramos = (pesoEfectivoG * linea.porcentaje) / 100;
    return { nombre: fragancia.nombre as string, porcentaje: linea.porcentaje, gramos, valorGramo, costo: gramos * valorGramo };
  });

  let lineaPabilo: { nombre: string; cm: number; valorCm: number; costo: number } | null = null;
  if (input.pabiloId) {
    if (!pabilo) throw Errors.badRequest("El pabilo seleccionado ya no existe");
    if (!pabilo.activo) alertas.push(`El pabilo talla "${pabilo.talla}" está inactivo`);
    const cm = input.cmPabilo ?? 0;
    const valorCm = Number(pabilo.valor_cm);
    lineaPabilo = { nombre: `Pabilo talla ${pabilo.talla}`, cm, valorCm, costo: cm * valorCm };
  }

  const lineasInsumo = input.insumos.map((linea) => {
    const insumo = mapInsumos.get(linea.insumoId);
    if (!insumo) throw Errors.badRequest("Uno de los insumos seleccionados ya no existe");
    if (!insumo.activo) alertas.push(`El insumo "${insumo.nombre}" está inactivo`);
    const valorUnitario = Number(insumo.valor_unitario);
    return {
      nombre: insumo.nombre as string,
      categoria: insumo.categoria as string,
      cantidad: linea.cantidad,
      valorUnitario,
      costo: linea.cantidad * valorUnitario,
    };
  });

  const costoManoObra = input.costoManoObra;

  // Solo cera + fragancia + pabilo + mano de obra entran al multiplicador —
  // el empaque/recipiente es adicional, se suma DESPUÉS (nunca se le aplica
  // el multiplicador, si no la vela quedaría carísima).
  const costoBase =
    lineasCera.reduce((acc, l) => acc + l.costo, 0) +
    lineasFragancia.reduce((acc, l) => acc + l.costo, 0) +
    (lineaPabilo?.costo ?? 0) +
    costoManoObra;
  const costoInsumos = lineasInsumo.reduce((acc, l) => acc + l.costo, 0);
  const costoTotal = costoBase + costoInsumos;

  const multiplicadorGlobal = Number(parametros.multiplicador_precio);
  const multiplicador = input.multiplicadorPrecio ?? multiplicadorGlobal;

  const precioSinRedondeo = costoBase * multiplicador + costoInsumos;
  const precioVenta = redondear(precioSinRedondeo, input.redondeo);

  return {
    tipoVela: input.tipoVela,
    pesoMermaPorcentaje,
    pesoEfectivoG,
    lineasCera,
    lineasFragancia,
    lineaPabilo,
    lineasInsumo,
    costoBase,
    costoManoObra,
    costoInsumos,
    costoTotal,
    multiplicadorAplicado: multiplicador,
    redondeo: input.redondeo,
    precioVenta,
    alertas,
  };
}

// ============================================================================
// Productos (recetas guardadas)
// ============================================================================

export async function listarProductos() {
  const productos = await repo.listProductos();
  // Costo/precio de cada tarjeta de la lista, recalculado en vivo — barato
  // porque son pocas recetas guardadas, y así nunca queda desactualizado.
  return Promise.all(
    productos.map(async (p) => {
      const detalle = await repo.getProductoById(p.id);
      const costo = await calcularCostoReceta(detalle!.composicion);
      return {
        id: p.id,
        nombre: p.nombre,
        activo: p.activo,
        updatedAt: p.updated_at,
        precioFinalAutorizado: p.precio_final_autorizado != null ? Number(p.precio_final_autorizado) : null,
        costoTotal: costo.costoTotal,
        precioSugerido: costo.precioVenta,
        alertas: costo.alertas,
      };
    }),
  );
}

export async function obtenerProducto(id: string) {
  const detalle = await repo.getProductoById(id);
  if (!detalle) throw Errors.notFound("Receta no encontrada");
  const costo = await calcularCostoReceta(detalle.composicion);
  return {
    id: detalle.producto.id,
    nombre: detalle.producto.nombre,
    notas: detalle.producto.notas,
    activo: detalle.producto.activo,
    precioFinalAutorizado:
      detalle.producto.precio_final_autorizado != null ? Number(detalle.producto.precio_final_autorizado) : null,
    composicion: detalle.composicion,
    costo,
  };
}

export async function crearProducto(usuarioId: string, input: CrearProductoVelaInput) {
  // Valida que la receta calcule bien ANTES de guardarla (ids inexistentes,
  // etc.) — más barato rechazar acá que guardar una receta rota.
  await calcularCostoReceta(input);
  const id = await repo.crearProducto(input, usuarioId);
  return obtenerProducto(id);
}

export async function duplicarProducto(id: string) {
  const detalle = await repo.getProductoById(id);
  if (!detalle) throw Errors.notFound("Receta no encontrada");
  const nuevoId = await repo.crearProducto(
    {
      ...detalle.composicion,
      nombre: `${detalle.producto.nombre} (copia)`,
      notas: detalle.producto.notas ?? undefined,
      precioFinalAutorizado: undefined, // el precio autorizado no se copia: cada receta se autoriza aparte
    },
    detalle.producto.usuario_id,
  );
  return obtenerProducto(nuevoId);
}

export async function editarProducto(id: string, data: ActualizarProductoVelaInput) {
  if (data.ceras || data.fragancias || data.insumos || data.pesoMezclaG || data.tipoVela) {
    // Si se toca la composición, se valida completa antes de guardar.
    const actual = await repo.getProductoById(id);
    if (!actual) throw Errors.notFound("Receta no encontrada");
    await calcularCostoReceta({
      tipoVela: data.tipoVela ?? actual.composicion.tipoVela,
      pesoMezclaG: data.pesoMezclaG ?? actual.composicion.pesoMezclaG,
      ceras: data.ceras ?? actual.composicion.ceras,
      fragancias: data.fragancias ?? actual.composicion.fragancias,
      pabiloId: data.pabiloId ?? actual.composicion.pabiloId,
      cmPabilo: data.cmPabilo ?? actual.composicion.cmPabilo,
      insumos: data.insumos ?? actual.composicion.insumos,
      costoManoObra: data.costoManoObra ?? actual.composicion.costoManoObra,
      multiplicadorPrecio: data.multiplicadorPrecio ?? actual.composicion.multiplicadorPrecio,
      redondeo: data.redondeo ?? actual.composicion.redondeo,
    });
  }
  const id2 = await repo.actualizarProducto(id, data);
  if (!id2) throw Errors.notFound("Receta no encontrada");
  return obtenerProducto(id2);
}

export async function eliminarProducto(id: string) {
  const ok = await repo.eliminarProducto(id);
  if (!ok) throw Errors.notFound("Receta no encontrada");
  return { eliminada: true };
}
