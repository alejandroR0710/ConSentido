import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { usuariosApi, type Usuario } from "../../general/api";
import { migaoApi, type PendientePropinaDia } from "../api";

interface RepartirPropinasModalProps {
  onCerrar: () => void;
  onRepartido: () => Promise<void> | void;
}

interface FilaEntrega {
  nombrePersona: string;
  // true = nombre libre (persona sin cuenta en la plataforma) en vez de
  // elegido de la lista de usuarios.
  nombreManual: boolean;
  metodoPago: "efectivo" | "banco" | "mixto";
  // Solo se usa si metodoPago es "efectivo" o "banco".
  monto: number;
  // Solo se usan si metodoPago es "mixto" — al confirmar, esta fila se
  // descompone en 1-2 entregas ya puras (mismo criterio que "mixto" en
  // cualquier otro cobro de la app, ver descomponerPago en el backend).
  montoEfectivo: number;
  montoBanco: number;
  fechaEntrega: string;
  motivo: string;
}

function montoEfectivoDeFila(e: FilaEntrega) {
  if (e.metodoPago === "efectivo") return Number.isFinite(e.monto) ? e.monto : 0;
  if (e.metodoPago === "mixto") return Number.isFinite(e.montoEfectivo) ? e.montoEfectivo : 0;
  return 0;
}
function montoBancoDeFila(e: FilaEntrega) {
  if (e.metodoPago === "banco") return Number.isFinite(e.monto) ? e.monto : 0;
  if (e.metodoPago === "mixto") return Number.isFinite(e.montoBanco) ? e.montoBanco : 0;
  return 0;
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 'YYYY-MM-DD' → Date local (sin correrse un día por huso horario). */
function aFechaLocal(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function formatearFechaCorta(fecha: string) {
  const d = aFechaLocal(fecha);
  return `${DIAS_SEMANA[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
}

/** Hoy en hora Colombia, 'YYYY-MM-DD' — mismo criterio usado en el resto del
 *  módulo para agrupar/filtrar por día calendario. */
function hoyBogota() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Lunes de la semana (ISO) a la que pertenece esta fecha — clave para
 *  agrupar los días pendientes en bloques de "semana completa". */
function lunesDeLaSemana(fecha: string) {
  const d = aFechaLocal(fecha);
  const diaSemana = d.getDay(); // 0=domingo
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
}

interface GrupoSemana {
  lunes: string;
  dias: PendientePropinaDia[];
}

/** Semanas y días en orden cronológico normal (más antiguo primero, hacia
 *  adelante) — antes quedaba al revés (el día/semana más reciente arriba). */
function agruparPorSemana(dias: PendientePropinaDia[]): GrupoSemana[] {
  const mapa = new Map<string, PendientePropinaDia[]>();
  for (const d of dias) {
    const clave = lunesDeLaSemana(d.fecha);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave)!.push(d);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([lunes, dias]) => ({ lunes, dias: dias.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)) }));
}

/**
 * Reparto de propinas: primero se eligen qué días concretos entran (una
 * semana completa o sueltos, vía checkboxes agrupados por semana) — cada día
 * trae su pendiente en efectivo y en banco. Después se desglosa ese total
 * entre las personas del equipo, cada entrega con su propio método de pago
 * (en qué se le entrega a ESA persona, sin importar en qué método vino la
 * propina original) — la suma de las entregas en efectivo tiene que dar
 * exactamente el pendiente en efectivo elegido, y lo mismo banco, así el
 * historial por persona siempre cuadra con la plata real repartida en cada
 * método.
 */
export function RepartirPropinasModal({ onCerrar, onRepartido }: RepartirPropinasModalProps) {
  const [pendientesDia, setPendientesDia] = useState<PendientePropinaDia[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [diasSeleccionados, setDiasSeleccionados] = useState<Set<string>>(new Set());
  const [entregas, setEntregas] = useState<FilaEntrega[]>([
    {
      nombrePersona: "",
      nombreManual: false,
      metodoPago: "efectivo",
      monto: 0,
      montoEfectivo: 0,
      montoBanco: 0,
      fechaEntrega: hoyBogota(),
      motivo: "",
    },
  ]);
  const [nota, setNota] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const [dias, listaUsuarios] = await Promise.all([
          migaoApi.obtenerPendientesPropinasPorDia(),
          usuariosApi.listar(),
        ]);
        if (cancelado) return;
        setPendientesDia(dias);
        setDiasSeleccionados(new Set(dias.map((d) => d.fecha)));
        // Super Root queda afuera: la propina se reparte entre el equipo, no
        // tiene sentido ofrecerlo como destinatario.
        setUsuarios(listaUsuarios.filter((u) => u.rol_nombre !== "Super Root"));
      } catch (err) {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudieron cargar los días pendientes");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const gruposSemana = useMemo(() => agruparPorSemana(pendientesDia), [pendientesDia]);

  const diasElegidos = pendientesDia.filter((d) => diasSeleccionados.has(d.fecha));
  const totalEfectivoSeleccionado = diasElegidos.reduce((acc, d) => acc + d.montoEfectivo, 0);
  const totalBancoSeleccionado = diasElegidos.reduce((acc, d) => acc + d.montoBanco, 0);
  const totalSeleccionado = totalEfectivoSeleccionado + totalBancoSeleccionado;

  const sumaEntregasEfectivo = entregas.reduce((acc, e) => acc + montoEfectivoDeFila(e), 0);
  const sumaEntregasBanco = entregas.reduce((acc, e) => acc + montoBancoDeFila(e), 0);
  const restanteEfectivo = totalEfectivoSeleccionado - sumaEntregasEfectivo;
  const restanteBanco = totalBancoSeleccionado - sumaEntregasBanco;

  function alternarDia(fecha: string) {
    setDiasSeleccionados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(fecha)) siguiente.delete(fecha);
      else siguiente.add(fecha);
      return siguiente;
    });
  }

  function alternarSemana(grupo: GrupoSemana, marcar: boolean) {
    setDiasSeleccionados((prev) => {
      const siguiente = new Set(prev);
      for (const d of grupo.dias) {
        if (marcar) siguiente.add(d.fecha);
        else siguiente.delete(d.fecha);
      }
      return siguiente;
    });
  }

  function actualizarEntrega(indice: number, campo: keyof FilaEntrega, valor: string | number | boolean) {
    setEntregas((prev) => prev.map((e, i) => (i === indice ? { ...e, [campo]: valor } : e)));
  }

  function agregarEntrega() {
    setEntregas((prev) => [
      ...prev,
      {
        nombrePersona: "",
        nombreManual: false,
        metodoPago: "efectivo",
        monto: 0,
        montoEfectivo: 0,
        montoBanco: 0,
        fechaEntrega: hoyBogota(),
        motivo: "",
      },
    ]);
  }

  function quitarEntrega(indice: number) {
    setEntregas((prev) => prev.filter((_, i) => i !== indice));
  }

  /** Llena el/los monto(s) de esta fila con lo que falte para cuadrar —
   *  atajo para el caso más común (repartir todo entre 1-2 personas). En
   *  mixto llena efectivo y banco por separado, cada uno con lo que quede
   *  de SU método. */
  function usarRestante(indice: number) {
    const fila = entregas[indice];
    if (fila.metodoPago === "mixto") {
      const otrasEfectivo = entregas.reduce((acc, e, i) => (i === indice ? acc : acc + montoEfectivoDeFila(e)), 0);
      const otrasBanco = entregas.reduce((acc, e, i) => (i === indice ? acc : acc + montoBancoDeFila(e)), 0);
      actualizarEntrega(indice, "montoEfectivo", Math.max(0, totalEfectivoSeleccionado - otrasEfectivo));
      actualizarEntrega(indice, "montoBanco", Math.max(0, totalBancoSeleccionado - otrasBanco));
      return;
    }
    const totalDelMetodo = fila.metodoPago === "efectivo" ? totalEfectivoSeleccionado : totalBancoSeleccionado;
    const otras = entregas.reduce(
      (acc, e, i) => (i === indice || e.metodoPago !== fila.metodoPago ? acc : acc + (Number.isFinite(e.monto) ? e.monto : 0)),
      0,
    );
    const sugerido = Math.max(0, totalDelMetodo - otras);
    actualizarEntrega(indice, "monto", sugerido);
  }

  const entregasValidas = entregas.every((e) => {
    if (e.nombrePersona.trim().length === 0) return false;
    if (e.metodoPago === "mixto") return (e.montoEfectivo || 0) + (e.montoBanco || 0) > 0;
    return e.monto > 0;
  });
  const puedeRepartir =
    !cargando &&
    diasSeleccionados.size > 0 &&
    totalSeleccionado > 0 &&
    entregas.length > 0 &&
    entregasValidas &&
    Math.abs(restanteEfectivo) < 1 &&
    Math.abs(restanteBanco) < 1;

  async function confirmar() {
    if (!puedeRepartir) return;
    setProcesando(true);
    setError(null);
    try {
      // "Mixto" no es un método real en la base (mismo criterio que en
      // cualquier otro cobro de la app) — cada fila mixta se descompone acá
      // en 1-2 entregas ya puras antes de mandarlas.
      const entregasParaEnviar = entregas.flatMap((e) => {
        const base = {
          nombrePersona: e.nombrePersona.trim(),
          fechaEntrega: e.fechaEntrega || undefined,
          motivo: e.motivo.trim() || undefined,
        };
        if (e.metodoPago === "mixto") {
          const lineas: (typeof base & { metodoPago: "efectivo" | "banco"; monto: number })[] = [];
          if (e.montoEfectivo > 0) lineas.push({ ...base, metodoPago: "efectivo", monto: e.montoEfectivo });
          if (e.montoBanco > 0) lineas.push({ ...base, metodoPago: "banco", monto: e.montoBanco });
          return lineas;
        }
        return [{ ...base, metodoPago: e.metodoPago, monto: e.monto }];
      });
      await migaoApi.repartirPropinas({
        fechas: Array.from(diasSeleccionados),
        nota: nota.trim() || undefined,
        entregas: entregasParaEnviar,
      });
      await onRepartido();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo repartir la propina");
    } finally {
      setProcesando(false);
    }
  }

  const inputClase =
    "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

  return (
    <Modal titulo="Repartir propinas" onCerrar={onCerrar} maxWidth="sm:max-w-4xl">
      {cargando ? (
        <p className="text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando días pendientes...</p>
      ) : pendientesDia.length === 0 ? (
        <p className="text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
          No hay propinas pendientes por repartir.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Paso 1: elegir días */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              1. ¿Qué días vas a repartir?
            </h3>
            <div className="flex flex-col gap-3">
              {gruposSemana.map((grupo) => {
                const todosMarcados = grupo.dias.every((d) => diasSeleccionados.has(d.fecha));
                const totalSemana = grupo.dias.reduce((acc, d) => acc + d.montoEfectivo + d.montoBanco, 0);
                return (
                  <div
                    key={grupo.lunes}
                    className="rounded-md border border-brand-vanilla-dark p-2 dark:border-brand-green-700"
                  >
                    <label className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={todosMarcados}
                          onChange={(e) => alternarSemana(grupo, e.target.checked)}
                        />
                        Semana del {formatearFechaCorta(grupo.lunes)}
                      </span>
                      <span>{formatMoney(totalSemana)}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {grupo.dias.map((d) => (
                        <label
                          key={d.fecha}
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                            diasSeleccionados.has(d.fecha)
                              ? "border-brand-green-600 bg-brand-green-50 dark:bg-brand-green-700/30"
                              : "border-brand-vanilla-dark dark:border-brand-green-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={diasSeleccionados.has(d.fecha)}
                            onChange={() => alternarDia(d.fecha)}
                          />
                          {formatearFechaCorta(d.fecha)} · {formatMoney(d.montoEfectivo + d.montoBanco)}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-brand-ink dark:text-brand-vanilla">
              Total seleccionado: <span className="font-bold">{formatMoney(totalSeleccionado)}</span>{" "}
              <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                (efectivo {formatMoney(totalEfectivoSeleccionado)} · banco {formatMoney(totalBancoSeleccionado)})
              </span>
            </p>
          </div>

          {/* Paso 2: entregas por persona */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              2. ¿A quién se le entrega, y en qué método?
            </h3>
            <div className="flex flex-col gap-2">
              {entregas.map((entrega, indice) => (
                <div
                  key={indice}
                  className="grid grid-cols-1 gap-2 rounded-md border border-brand-vanilla-dark p-2 sm:grid-cols-[1.3fr_0.9fr_1fr_1fr_1.3fr_auto] sm:items-end dark:border-brand-green-700"
                >
                  <div>
                    <div className="mb-0.5 flex items-center justify-between gap-1">
                      <label className="text-[11px] font-medium">Persona</label>
                      <button
                        type="button"
                        onClick={() => {
                          actualizarEntrega(indice, "nombreManual", !entrega.nombreManual);
                          actualizarEntrega(indice, "nombrePersona", "");
                        }}
                        className="rounded-full border border-brand-green-600 px-2 py-0.5 text-[10px] font-semibold text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                      >
                        {entrega.nombreManual ? "← elegir de la lista" : "✎ escribir nombre"}
                      </button>
                    </div>
                    {entrega.nombreManual ? (
                      <input
                        value={entrega.nombrePersona}
                        onChange={(e) => actualizarEntrega(indice, "nombrePersona", e.target.value)}
                        placeholder="Ej. Juan Pérez"
                        className={inputClase}
                      />
                    ) : (
                      <select
                        value={entrega.nombrePersona}
                        onChange={(e) => actualizarEntrega(indice, "nombrePersona", e.target.value)}
                        className={inputClase}
                      >
                        <option value="">Elegir...</option>
                        {usuarios.map((u) => (
                          <option key={u.id} value={u.nombre}>
                            {u.nombre} · {u.rol_nombre}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Método</label>
                    <select
                      value={entrega.metodoPago}
                      onChange={(e) => actualizarEntrega(indice, "metodoPago", e.target.value)}
                      className={inputClase}
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="banco">Banco</option>
                      <option value="mixto">Mixto</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Monto</label>
                    {entrega.metodoPago === "mixto" ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <span className="w-5 shrink-0 text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">Ef.</span>
                          <MoneyInput
                            value={entrega.montoEfectivo}
                            onChange={(v) => actualizarEntrega(indice, "montoEfectivo", v)}
                            className={inputClase}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-5 shrink-0 text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">Bc.</span>
                          <MoneyInput
                            value={entrega.montoBanco}
                            onChange={(v) => actualizarEntrega(indice, "montoBanco", v)}
                            className={inputClase}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <MoneyInput
                          value={entrega.monto}
                          onChange={(v) => actualizarEntrega(indice, "monto", v)}
                          className={inputClase}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Fecha</label>
                    <input
                      type="date"
                      value={entrega.fechaEntrega}
                      onChange={(e) => actualizarEntrega(indice, "fechaEntrega", e.target.value)}
                      className={inputClase}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Motivo (opcional)</label>
                    <input
                      value={entrega.motivo}
                      onChange={(e) => actualizarEntrega(indice, "motivo", e.target.value)}
                      placeholder="Ej. turno completo"
                      className={inputClase}
                    />
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => usarRestante(indice)}
                      title="Llenar con lo que falte de este método"
                      className="rounded-md border border-brand-green-600 px-2 py-1.5 text-xs text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                    >
                      =Resto
                    </button>
                    {entregas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => quitarEntrega(indice)}
                        title="Quitar"
                        className="rounded-md border border-red-400 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={agregarEntrega}
              className="mt-2 rounded-md border border-brand-green-600 px-3 py-1.5 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
            >
              + Agregar persona
            </button>

            <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:gap-3">
              <div
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
                  Math.abs(restanteEfectivo) < 1
                    ? "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                }`}
              >
                Efectivo:{" "}
                {Math.abs(restanteEfectivo) < 1
                  ? "cuadrado"
                  : restanteEfectivo > 0
                    ? `falta ${formatMoney(restanteEfectivo)}`
                    : `te pasaste por ${formatMoney(-restanteEfectivo)}`}
              </div>
              <div
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
                  Math.abs(restanteBanco) < 1
                    ? "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                }`}
              >
                Banco:{" "}
                {Math.abs(restanteBanco) < 1
                  ? "cuadrado"
                  : restanteBanco > 0
                    ? `falta ${formatMoney(restanteBanco)}`
                    : `te pasaste por ${formatMoney(-restanteBanco)}`}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Nota general del reparto (opcional)</label>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. repartido entre meseros de turno"
              className={inputClase}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={confirmar}
            disabled={procesando || !puedeRepartir}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {procesando ? "Repartiendo..." : "Confirmar reparto"}
          </button>
        </div>
      )}
    </Modal>
  );
}
