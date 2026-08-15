import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type AmasijoInventario, type PreparacionLote, type RecetaLinea, type RecomendacionBase } from "../api";

const POLL_MS = 15000;

/** Fila de amasijo o base — ambos son el mismo tipo de dato (productos
 *  normales del inventario general de Migao). */
function FilaInventario({ item, accion }: { item: AmasijoInventario; accion?: React.ReactNode }) {
  const bajoMinimo = item.stockMinimoUnidades != null && item.stockUnidades < item.stockMinimoUnidades;
  return (
    <tr className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${bajoMinimo ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
      <td className="px-4 py-3 font-medium">{item.nombre}</td>
      <td className={`px-4 py-3 text-right font-semibold ${bajoMinimo ? "text-red-600" : "text-brand-green-600"}`}>
        {item.stockUnidades}
      </td>
      <td className="px-4 py-3 text-right text-brand-ink/60 dark:text-brand-vanilla/60">
        {item.stockMinimoUnidades ?? "—"}
      </td>
      <td className="px-4 py-3 text-right">{accion}</td>
    </tr>
  );
}

export function AmasijosPage() {
  const [amasijos, setAmasijos] = useState<AmasijoInventario[]>([]);
  const [bases, setBases] = useState<AmasijoInventario[]>([]);
  const [recomendaciones, setRecomendaciones] = useState<RecomendacionBase[]>([]);
  const [recetas, setRecetas] = useState<RecetaLinea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  // Compra de amasijos/bases (entrada al inventario general)
  const [modalEntradaAbierto, setModalEntradaAbierto] = useState(false);
  const [entradaProductoId, setEntradaProductoId] = useState("");
  const [entradaCantidad, setEntradaCantidad] = useState(0);
  const [entradaMotivo, setEntradaMotivo] = useState("");
  const [guardandoEntrada, setGuardandoEntrada] = useState(false);
  const [errorEntrada, setErrorEntrada] = useState<string | null>(null);

  // Preparación manual de UNA base puntual (consume amasijos según receta,
  // da entrada a la base) — distinto del lote recomendado de abajo.
  const [modalPrepararAbierto, setModalPrepararAbierto] = useState(false);
  const [prepararBaseId, setPrepararBaseId] = useState("");
  const [prepararCantidad, setPrepararCantidad] = useState(0);
  const [guardandoPreparar, setGuardandoPreparar] = useState(false);
  const [errorPreparar, setErrorPreparar] = useState<string | null>(null);

  // Preparar TODO lo recomendado de una sola vez — un solo botón/modal en
  // vez de un botón por base, así nunca se prepara una base a mano y deja
  // la recomendación de las otras 3 desactualizada (comparten amasijos).
  const [modalLoteAbierto, setModalLoteAbierto] = useState(false);
  const [guardandoLote, setGuardandoLote] = useState(false);
  const [errorLote, setErrorLote] = useState<string | null>(null);
  const [resultadoLote, setResultadoLote] = useState<PreparacionLote[] | null>(null);

  // Editor de recetas
  const [modalRecetaAbierto, setModalRecetaAbierto] = useState(false);
  const [recetaBaseId, setRecetaBaseId] = useState("");
  const [nuevoAmasijoId, setNuevoAmasijoId] = useState("");
  const [nuevaCantidad, setNuevaCantidad] = useState(0.5);
  const [errorReceta, setErrorReceta] = useState<string | null>(null);

  async function cargar() {
    try {
      const [amasijosData, basesData, recomendacionesData, recetasData] = await Promise.all([
        migaoApi.listarAmasijos(),
        migaoApi.listarBases(),
        migaoApi.obtenerRecomendacionesPreparacion(),
        migaoApi.obtenerRecetas(),
      ]);
      setAmasijos(amasijosData);
      setBases(basesData);
      setRecomendaciones(recomendacionesData);
      setRecetas(recetasData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargar);

  function abrirModalEntrada(productoId?: string) {
    setEntradaProductoId(productoId ?? "");
    setEntradaCantidad(0);
    setEntradaMotivo("");
    setErrorEntrada(null);
    setModalEntradaAbierto(true);
  }

  async function confirmarEntrada() {
    if (!entradaProductoId || entradaCantidad <= 0) {
      setErrorEntrada("Elige el producto y una cantidad mayor a 0");
      return;
    }
    setGuardandoEntrada(true);
    setErrorEntrada(null);
    try {
      // Estos productos siempre tienen 1 unidad por "paquete" (se compran por
      // unidad/bolsa suelta) — reusa el mismo endpoint que ya usa el
      // Inventario general de Migao, nada nuevo que mantener. Si el producto
      // es una base con receta, el backend la resuelve como preparación y
      // puede devolver avisos (ej. amasijo sin stock suficiente).
      const resultado = await migaoApi.registrarMovimientoInventario({
        tipo: "entrada",
        productoId: entradaProductoId,
        paquetes: entradaCantidad,
        motivo: entradaMotivo.trim() || undefined,
      });
      setModalEntradaAbierto(false);
      setAvisos(resultado.alertasInventario ?? []);
      await cargar();
    } catch (err) {
      setErrorEntrada(err instanceof ApiError ? err.message : "No se pudo registrar la compra");
    } finally {
      setGuardandoEntrada(false);
    }
  }

  function abrirModalPreparar(baseProductoId?: string) {
    setPrepararBaseId(baseProductoId ?? "");
    setPrepararCantidad(0);
    setErrorPreparar(null);
    setModalPrepararAbierto(true);
  }

  async function confirmarPreparar() {
    if (!prepararBaseId || prepararCantidad <= 0) {
      setErrorPreparar("Elige la base y una cantidad mayor a 0");
      return;
    }
    setGuardandoPreparar(true);
    setErrorPreparar(null);
    try {
      const resultado = await migaoApi.prepararBase({ baseProductoId: prepararBaseId, cantidad: prepararCantidad });
      setModalPrepararAbierto(false);
      setAvisos(resultado.alertas ?? []);
      await cargar();
    } catch (err) {
      setErrorPreparar(err instanceof ApiError ? err.message : "No se pudo registrar la preparación");
    } finally {
      setGuardandoPreparar(false);
    }
  }

  function abrirModalLote() {
    setResultadoLote(null);
    setErrorLote(null);
    setModalLoteAbierto(true);
  }

  /** Confirma el lote completo: recalcula y aplica en el backend, dentro de
   *  una sola transacción bloqueada — el número que se ve acá es una vista
   *  previa, lo que de verdad se prepara puede variar un poco si el stock
   *  cambió justo entre abrir el modal y confirmar (ej. una venta de por
   *  medio), nunca al revés de lo que el backend decida en ese instante. */
  async function confirmarPrepararLote() {
    setGuardandoLote(true);
    setErrorLote(null);
    try {
      const resultado = await migaoApi.prepararRecomendado();
      setResultadoLote(resultado);
      setAvisos(resultado.flatMap((r) => r.alertasInventario));
      await cargar();
    } catch (err) {
      setErrorLote(err instanceof ApiError ? err.message : "No se pudo preparar el lote recomendado");
    } finally {
      setGuardandoLote(false);
    }
  }

  function abrirModalReceta(baseProductoId: string) {
    setRecetaBaseId(baseProductoId);
    setNuevoAmasijoId("");
    setNuevaCantidad(0.5);
    setErrorReceta(null);
    setModalRecetaAbierto(true);
  }

  async function agregarLineaReceta() {
    if (!nuevoAmasijoId || nuevaCantidad <= 0) {
      setErrorReceta("Elige el amasijo y una cantidad mayor a 0");
      return;
    }
    setErrorReceta(null);
    try {
      await migaoApi.crearRecetaLinea({ baseProductoId: recetaBaseId, amasijoProductoId: nuevoAmasijoId, cantidadAmasijo: nuevaCantidad });
      setNuevoAmasijoId("");
      setNuevaCantidad(0.5);
      await cargar();
    } catch (err) {
      setErrorReceta(err instanceof ApiError ? err.message : "No se pudo agregar el ingrediente");
    }
  }

  async function editarLineaReceta(id: string, cantidad: number) {
    try {
      await migaoApi.actualizarRecetaLinea(id, cantidad);
      await cargar();
    } catch (err) {
      setErrorReceta(err instanceof ApiError ? err.message : "No se pudo actualizar");
    }
  }

  async function eliminarLineaReceta(id: string) {
    try {
      await migaoApi.eliminarRecetaLinea(id);
      await cargar();
    } catch (err) {
      setErrorReceta(err instanceof ApiError ? err.message : "No se pudo eliminar");
    }
  }

  const baseEnEdicion = bases.find((b) => b.id === recetaBaseId);
  const recetasDeLaBase = recetas.filter((r) => r.base_producto_id === recetaBaseId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Amasijos y Bases</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Amasijos y bases son productos normales del Inventario general de Migao — el mismo stock que ya manejan
          ahí. Acá solo se calcula cuántas bases se pueden preparar sin bajar del stock mínimo, y se prepara.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {avisos.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          {avisos.map((a, i) => (
            <p key={i}>{a}</p>
          ))}
          <button onClick={() => setAvisos([])} className="mt-1 text-xs underline">
            Cerrar
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <>
          {/* Panel de Recomendaciones */}
          <div className="rounded-lg border border-brand-vanilla-dark bg-white p-6 dark:border-brand-green-700 dark:bg-brand-green-900/40">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
                Recomendación de Preparación
              </h2>
              {recomendaciones.some((r) => r.cantidadRecomendada > 0) && (
                <button
                  onClick={abrirModalLote}
                  className="rounded-md bg-brand-green-700 px-3 py-2 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600"
                >
                  Preparar todo lo recomendado
                </button>
              )}
            </div>
            <p className="-mt-2 mb-4 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              Las 4 recetas comparten los mismos amasijos, así que estos números ya vienen repartidos entre ellas —
              prepáralos todos juntos con el botón de arriba, no una base a la vez (preparar una sola desactualiza el
              cupo que les queda a las demás).
            </p>
            {recomendaciones.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                Ninguna base tiene receta todavía — agrégale ingredientes a una base más abajo.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {recomendaciones.map((rec) => (
                  <div
                    key={rec.baseProductoId}
                    className={`rounded-md border-2 p-4 ${
                      rec.cantidadRecomendada > 0
                        ? "border-brand-green-300 bg-brand-green-50 dark:border-brand-green-600 dark:bg-brand-green-900/50"
                        : "border-red-300 bg-red-50 dark:border-red-600 dark:bg-red-900/50"
                    }`}
                  >
                    <p className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">{rec.baseNombre}</p>
                    <p className="mt-2 text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                      {rec.cantidadRecomendada}
                    </p>
                    <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                      bases recomendadas (sin bajar del stock mínimo)
                    </p>

                    {rec.limitantes.length > 0 && (
                      <div className="mt-3 border-t border-current border-opacity-20 pt-3">
                        <p className="text-xs font-semibold text-brand-ink/60 dark:text-brand-vanilla/60">Limitante:</p>
                        {rec.limitantes.map((lim) => (
                          <p key={lim.amasijoNombre} className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                            {lim.amasijoNombre}: {lim.disponibleSobreMinimo.toFixed(1)} sobre el mínimo
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inventario de Amasijos */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
                Amasijos (Inventario general de Migao)
              </h2>
              <button
                onClick={() => abrirModalEntrada()}
                className="rounded-md bg-brand-green-700 px-3 py-2 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600"
              >
                + Registrar compra
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                  <tr>
                    <th className="px-4 py-3">Amasijo</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right">Stock mínimo</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {amasijos.map((a) => (
                    <FilaInventario
                      key={a.id}
                      item={a}
                      accion={
                        <button
                          onClick={() => abrirModalEntrada(a.id)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          + Compra
                        </button>
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bases preparadas */}
          <div>
            <h2 className="mb-4 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
              Bases (bolsitas de Migao)
            </h2>
            <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                  <tr>
                    <th className="px-4 py-3">Base</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right">Stock mínimo</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {bases.map((b) => (
                    <FilaInventario
                      key={b.id}
                      item={b}
                      accion={
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => abrirModalReceta(b.id)}
                            className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                          >
                            Receta
                          </button>
                          <button
                            onClick={() => abrirModalPreparar(b.id)}
                            className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                          >
                            Preparar
                          </button>
                        </div>
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modalEntradaAbierto && (
        <Modal titulo="Registrar compra" onCerrar={() => setModalEntradaAbierto(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Producto</label>
              <select
                value={entradaProductoId}
                onChange={(e) => setEntradaProductoId(e.target.value)}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              >
                <option value="">Elegir...</option>
                {[...amasijos, ...bases].map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Cantidad comprada</label>
              <input
                type="number"
                min={0}
                value={entradaCantidad || ""}
                onChange={(e) => setEntradaCantidad(Number(e.target.value))}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Motivo (opcional)</label>
              <input
                value={entradaMotivo}
                onChange={(e) => setEntradaMotivo(e.target.value)}
                placeholder="Ej. compra semanal proveedor"
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
            {errorEntrada && <p className="text-sm text-red-600">{errorEntrada}</p>}
            <button
              onClick={confirmarEntrada}
              disabled={guardandoEntrada}
              className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
            >
              {guardandoEntrada ? "Guardando..." : "Registrar compra"}
            </button>
          </div>
        </Modal>
      )}

      {modalPrepararAbierto && (
        <Modal titulo="Preparar bases" onCerrar={() => setModalPrepararAbierto(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Base</label>
              <select
                value={prepararBaseId}
                onChange={(e) => setPrepararBaseId(e.target.value)}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              >
                <option value="">Elegir base...</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Cantidad a preparar</label>
              <input
                type="number"
                min={0}
                value={prepararCantidad || ""}
                onChange={(e) => setPrepararCantidad(Number(e.target.value))}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
            <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              Descuenta del stock de cada amasijo según la receta de esta base, y da entrada a la base.
            </p>
            {errorPreparar && <p className="text-sm text-red-600">{errorPreparar}</p>}
            <button
              onClick={confirmarPreparar}
              disabled={guardandoPreparar}
              className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
            >
              {guardandoPreparar ? "Guardando..." : "Preparar"}
            </button>
          </div>
        </Modal>
      )}

      {modalLoteAbierto && (
        <Modal titulo="Preparar todo lo recomendado" onCerrar={() => setModalLoteAbierto(false)}>
          <div className="flex flex-col gap-3">
            {resultadoLote ? (
              <>
                <p className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">
                  ✓ Listo, se preparó:
                </p>
                {resultadoLote.map((r) => (
                  <div key={r.baseProductoId} className="flex items-center justify-between text-sm">
                    <span className="text-brand-ink dark:text-brand-vanilla">{r.baseNombre}</span>
                    <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      {r.cantidadPreparada}
                    </span>
                  </div>
                ))}
                <button
                  onClick={() => setModalLoteAbierto(false)}
                  className="mt-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600"
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                  Se va a preparar de una sola vez, descontando de los amasijos compartidos y respetando el stock
                  mínimo de cada uno:
                </p>
                {recomendaciones
                  .filter((r) => r.cantidadRecomendada > 0)
                  .map((r) => (
                    <div key={r.baseProductoId} className="flex items-center justify-between text-sm">
                      <span className="text-brand-ink dark:text-brand-vanilla">{r.baseNombre}</span>
                      <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">
                        {r.cantidadRecomendada}
                      </span>
                    </div>
                  ))}
                {errorLote && <p className="text-sm text-red-600">{errorLote}</p>}
                <button
                  onClick={confirmarPrepararLote}
                  disabled={guardandoLote}
                  className="mt-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                >
                  {guardandoLote ? "Preparando..." : "Confirmar y preparar todo"}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}

      {modalRecetaAbierto && (
        <Modal titulo={`Receta de ${baseEnEdicion?.nombre ?? ""}`} onCerrar={() => setModalRecetaAbierto(false)}>
          <div className="flex flex-col gap-3">
            {recetasDeLaBase.length === 0 && (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                Esta base todavía no tiene ningún amasijo en su receta.
              </p>
            )}
            {recetasDeLaBase.map((linea) => (
              <div key={linea.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{linea.amasijo_nombre}</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  defaultValue={linea.cantidad_amasijo}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== linea.cantidad_amasijo) editarLineaReceta(linea.id, v);
                  }}
                  className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <button onClick={() => eliminarLineaReceta(linea.id)} className="text-red-600" aria-label="Quitar">
                  ✕
                </button>
              </div>
            ))}

            <div className="mt-2 flex items-center gap-2 border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
              <select
                value={nuevoAmasijoId}
                onChange={(e) => setNuevoAmasijoId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              >
                <option value="">+ Agregar amasijo...</option>
                {amasijos
                  .filter((a) => !recetasDeLaBase.some((r) => r.amasijo_producto_id === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.1"
                value={nuevaCantidad || ""}
                onChange={(e) => setNuevaCantidad(Number(e.target.value))}
                className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
              <button
                onClick={agregarLineaReceta}
                className="rounded-md bg-brand-green-700 px-3 py-1.5 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600"
              >
                Agregar
              </button>
            </div>
            {errorReceta && <p className="text-sm text-red-600">{errorReceta}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
