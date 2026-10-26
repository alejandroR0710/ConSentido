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

interface Asignacion {
  nombre: string;
  metodoPago: "efectivo" | "banco" | "mixto";
  // Solo se usa si metodoPago es "efectivo" o "banco".
  monto: number;
  // Solo se usan si metodoPago es "mixto" — al confirmar, esta asignación se
  // descompone en 1-2 entregas ya puras (mismo criterio que "mixto" en
  // cualquier otro cobro de la app, ver descomponerPago en el backend).
  montoEfectivo: number;
  montoBanco: number;
  motivo: string;
  // true en cuanto el cajero toca el monto/método/motivo a mano — a partir
  // de ahí deja de recalcularse solo con el reparto sugerido (ver el
  // useEffect de sincronización más abajo), para no pisarle un ajuste manual
  // sin avisar si después marca/desmarca a alguien en otro día.
  editadoManual: boolean;
}

function montoEfectivoDeAsignacion(a: Asignacion) {
  if (a.metodoPago === "efectivo") return Number.isFinite(a.monto) ? a.monto : 0;
  if (a.metodoPago === "mixto") return Number.isFinite(a.montoEfectivo) ? a.montoEfectivo : 0;
  return 0;
}
function montoBancoDeAsignacion(a: Asignacion) {
  if (a.metodoPago === "banco") return Number.isFinite(a.monto) ? a.monto : 0;
  if (a.metodoPago === "mixto") return Number.isFinite(a.montoBanco) ? a.montoBanco : 0;
  return 0;
}

/** Reparte `total` en `n` montos iguales — la última persona absorbe el
 *  residuo del redondeo, así la suma siempre da EXACTO el total (mismo
 *  criterio que distribuirIgual en el backend, ver migao.service.ts). */
function distribuirIgual(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor((total / n) * 100) / 100;
  const montos = Array.from({ length: n }, () => base);
  montos[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100;
  return montos;
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
 * trae su pendiente en efectivo y en banco. Después, para CADA día, se
 * marca por checkbox quién trabajó ese día (de la lista de usuarios, o un
 * participante nuevo escrito a mano) — pueden ser personas distintas de un
 * día a otro, y no hace falta incluir a todos en todos los días. Al final se
 * arma un resumen con el total consolidado de cada persona (repartido en
 * partes iguales entre los días que marcó, como sugerencia de partida) con
 * su monto y método de pago totalmente editables — si alguien debe recibir
 * más o menos, se ajusta ahí mismo. La suma de todas las asignaciones tiene
 * que cuadrar exacto con el pendiente total (efectivo y banco) antes de
 * poder repartir.
 */
export function RepartirPropinasModal({ onCerrar, onRepartido }: RepartirPropinasModalProps) {
  const [pendientesDia, setPendientesDia] = useState<PendientePropinaDia[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [diasSeleccionados, setDiasSeleccionados] = useState<Set<string>>(new Set());
  // Participantes escritos a mano (sin cuenta en la plataforma) — se suman a
  // los usuarios en la lista de checkboxes de todos los días, no solo el día
  // en que se agregaron, para no tener que volver a escribirlos.
  const [participantesExtra, setParticipantesExtra] = useState<string[]>([]);
  // Quién está marcado como presente en cada día (clave = fecha).
  const [presenciaPorDia, setPresenciaPorDia] = useState<Record<string, Set<string>>>({});
  const [nuevoParticipante, setNuevoParticipante] = useState<Record<string, string>>({});
  const [asignaciones, setAsignaciones] = useState<Record<string, Asignacion>>({});
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

  const todosLosParticipantes = useMemo(() => {
    const nombres = usuarios.map((u) => u.nombre);
    for (const extra of participantesExtra) {
      if (!nombres.some((n) => n.toLowerCase() === extra.toLowerCase())) nombres.push(extra);
    }
    return nombres.sort((a, b) => a.localeCompare(b, "es"));
  }, [usuarios, participantesExtra]);

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

  function alternarPresencia(fecha: string, nombre: string) {
    setPresenciaPorDia((prev) => {
      const actual = new Set(prev[fecha] ?? []);
      if (actual.has(nombre)) actual.delete(nombre);
      else actual.add(nombre);
      return { ...prev, [fecha]: actual };
    });
  }

  /** Agrega un participante nuevo (sin cuenta en la plataforma) a la lista
   *  compartida de checkboxes, y lo marca de una vez como presente en el día
   *  desde el que se agregó — para eso se estaba escribiendo, al fin y al
   *  cabo. */
  function agregarParticipante(fecha: string) {
    const nombre = (nuevoParticipante[fecha] ?? "").trim();
    if (!nombre) return;
    if (!todosLosParticipantes.some((n) => n.toLowerCase() === nombre.toLowerCase())) {
      setParticipantesExtra((prev) => [...prev, nombre]);
    }
    setPresenciaPorDia((prev) => {
      const actual = new Set(prev[fecha] ?? []);
      actual.add(nombre);
      return { ...prev, [fecha]: actual };
    });
    setNuevoParticipante((prev) => ({ ...prev, [fecha]: "" }));
  }

  // Sincroniza el resumen con quién quedó marcado en cada día: reparte el
  // pendiente de cada día en partes iguales entre sus marcados y lo suma por
  // persona (puede trabajar varios días). Una persona que el cajero ya ajustó
  // a mano (editadoManual) conserva su valor tal cual, aunque se siga
  // marcando/desmarcando gente en otros días — nunca le pisa un ajuste manual
  // sin avisar.
  useEffect(() => {
    const sugerido = new Map<string, { efectivo: number; banco: number }>();
    for (const dia of diasElegidos) {
      const marcados = Array.from(presenciaPorDia[dia.fecha] ?? []);
      if (marcados.length === 0) continue;
      const partesEfectivo = distribuirIgual(dia.montoEfectivo, marcados.length);
      const partesBanco = distribuirIgual(dia.montoBanco, marcados.length);
      marcados.forEach((nombre, idx) => {
        const actual = sugerido.get(nombre) ?? { efectivo: 0, banco: 0 };
        actual.efectivo += partesEfectivo[idx] ?? 0;
        actual.banco += partesBanco[idx] ?? 0;
        sugerido.set(nombre, actual);
      });
    }

    setAsignaciones((prev) => {
      const siguiente: Record<string, Asignacion> = {};
      for (const [nombre, montos] of sugerido) {
        const existente = prev[nombre];
        if (existente?.editadoManual) {
          siguiente[nombre] = existente;
          continue;
        }
        const esMixto = montos.efectivo > 0 && montos.banco > 0;
        siguiente[nombre] = {
          nombre,
          metodoPago: esMixto ? "mixto" : montos.banco > 0 ? "banco" : "efectivo",
          monto: esMixto ? 0 : montos.efectivo > 0 ? montos.efectivo : montos.banco,
          montoEfectivo: montos.efectivo,
          montoBanco: montos.banco,
          motivo: existente?.motivo ?? "",
          editadoManual: false,
        };
      }
      return siguiente;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diasSeleccionados, presenciaPorDia, pendientesDia]);

  function actualizarAsignacion(nombre: string, campo: keyof Asignacion, valor: string | number | boolean) {
    setAsignaciones((prev) => ({
      ...prev,
      [nombre]: { ...prev[nombre], [campo]: valor, editadoManual: true },
    }));
  }

  const listaAsignaciones = useMemo(
    () =>
      Object.values(asignaciones).sort(
        (a, b) =>
          montoEfectivoDeAsignacion(b) + montoBancoDeAsignacion(b) - (montoEfectivoDeAsignacion(a) + montoBancoDeAsignacion(a)),
      ),
    [asignaciones],
  );

  const sumaAsigEfectivo = listaAsignaciones.reduce((acc, a) => acc + montoEfectivoDeAsignacion(a), 0);
  const sumaAsigBanco = listaAsignaciones.reduce((acc, a) => acc + montoBancoDeAsignacion(a), 0);
  const restanteEfectivo = totalEfectivoSeleccionado - sumaAsigEfectivo;
  const restanteBanco = totalBancoSeleccionado - sumaAsigBanco;

  const asignacionesValidas = listaAsignaciones.every((a) => {
    if (a.metodoPago === "mixto") return (a.montoEfectivo || 0) + (a.montoBanco || 0) > 0;
    return a.monto > 0;
  });
  const puedeRepartir =
    !cargando &&
    diasSeleccionados.size > 0 &&
    totalSeleccionado > 0 &&
    listaAsignaciones.length > 0 &&
    asignacionesValidas &&
    Math.abs(restanteEfectivo) < 1 &&
    Math.abs(restanteBanco) < 1;

  async function confirmar() {
    if (!puedeRepartir) return;
    setProcesando(true);
    setError(null);
    try {
      // "Mixto" no es un método real en la base (mismo criterio que en
      // cualquier otro cobro de la app) — cada persona mixta se descompone
      // acá en 1-2 entregas ya puras antes de mandarlas.
      const entregasParaEnviar = listaAsignaciones.flatMap((a) => {
        const base = { nombrePersona: a.nombre, motivo: a.motivo.trim() || undefined };
        if (a.metodoPago === "mixto") {
          const lineas: (typeof base & { metodoPago: "efectivo" | "banco"; monto: number })[] = [];
          if (a.montoEfectivo > 0) lineas.push({ ...base, metodoPago: "efectivo", monto: a.montoEfectivo });
          if (a.montoBanco > 0) lineas.push({ ...base, metodoPago: "banco", monto: a.montoBanco });
          return lineas;
        }
        return [{ ...base, metodoPago: a.metodoPago, monto: a.monto }];
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

          {/* Paso 2: un bloque por día elegido — checkbox de quién estuvo
              presente ese día, más la opción de sumar un participante nuevo
              a la lista. Acá todavía no se habla de plata, solo de quién
              estuvo. */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              2. ¿Quién trabajó cada día?
            </h3>
            {diasElegidos.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Elige al menos un día arriba.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {diasElegidos.map((dia) => {
                  const marcados = presenciaPorDia[dia.fecha] ?? new Set<string>();
                  return (
                    <div
                      key={dia.fecha}
                      className="rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700"
                    >
                      <h4 className="mb-2 text-sm font-semibold capitalize text-brand-ink dark:text-brand-vanilla">
                        {formatearFechaCorta(dia.fecha)}{" "}
                        <span className="text-xs font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                          · pendiente {formatMoney(dia.montoEfectivo + dia.montoBanco)} · {marcados.size} marcado
                          {marcados.size === 1 ? "" : "s"}
                        </span>
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {todosLosParticipantes.length === 0 && (
                          <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                            Todavía no hay participantes — agrega uno abajo.
                          </p>
                        )}
                        {todosLosParticipantes.map((nombre) => {
                          const marcado = marcados.has(nombre);
                          return (
                            <label
                              key={nombre}
                              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                                marcado
                                  ? "border-brand-green-600 bg-brand-green-50 dark:bg-brand-green-700/30"
                                  : "border-brand-vanilla-dark dark:border-brand-green-700"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                onChange={() => alternarPresencia(dia.fecha, nombre)}
                              />
                              {nombre}
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={nuevoParticipante[dia.fecha] ?? ""}
                          onChange={(e) =>
                            setNuevoParticipante((prev) => ({ ...prev, [dia.fecha]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              agregarParticipante(dia.fecha);
                            }
                          }}
                          placeholder="Agregar participante..."
                          className={`${inputClase} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => agregarParticipante(dia.fecha)}
                          className="rounded-md border border-brand-green-600 px-3 py-1.5 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                        >
                          + Agregar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Paso 3: cuánto y en qué método recibe cada quien — arranca con
              un reparto sugerido (partes iguales por día marcado), pero todo
              es editable: si alguien debe recibir más o menos, se ajusta
              acá. La suma tiene que cuadrar exacto con el pendiente antes de
              poder repartir. */}
          {listaAsignaciones.length > 0 && (
            <div className="rounded-lg border border-brand-green-600 bg-brand-green-50 p-3 dark:border-brand-vanilla dark:bg-brand-green-700/20">
              <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
                3. ¿Cuánto y en qué método recibe cada persona?
              </h3>
              <div className="flex flex-col gap-2">
                {listaAsignaciones.map((a) => (
                  <div
                    key={a.nombre}
                    className="grid grid-cols-1 gap-2 rounded-md border border-brand-vanilla-dark bg-brand-vanilla p-2 dark:border-brand-green-700 dark:bg-brand-green-900 sm:grid-cols-[1.2fr_0.9fr_1fr_1.2fr] sm:items-center"
                  >
                    <span className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">{a.nombre}</span>
                    <div>
                      <label className="mb-0.5 block text-[11px] font-medium">Método</label>
                      <select
                        value={a.metodoPago}
                        onChange={(e) => actualizarAsignacion(a.nombre, "metodoPago", e.target.value)}
                        className={inputClase}
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="banco">Banco</option>
                        <option value="mixto">Mixto</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] font-medium">Monto</label>
                      {a.metodoPago === "mixto" ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span className="w-5 shrink-0 text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">
                              Ef.
                            </span>
                            <MoneyInput
                              value={a.montoEfectivo}
                              onChange={(v) => actualizarAsignacion(a.nombre, "montoEfectivo", v)}
                              className={inputClase}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-5 shrink-0 text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">
                              Bc.
                            </span>
                            <MoneyInput
                              value={a.montoBanco}
                              onChange={(v) => actualizarAsignacion(a.nombre, "montoBanco", v)}
                              className={inputClase}
                            />
                          </div>
                        </div>
                      ) : (
                        <MoneyInput
                          value={a.monto}
                          onChange={(v) => actualizarAsignacion(a.nombre, "monto", v)}
                          className={inputClase}
                        />
                      )}
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] font-medium">Motivo (opcional)</label>
                      <input
                        value={a.motivo}
                        onChange={(e) => actualizarAsignacion(a.nombre, "motivo", e.target.value)}
                        placeholder="Ej. turno completo"
                        className={inputClase}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:gap-3">
                <div
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
                    Math.abs(restanteEfectivo) < 1
                      ? "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                  }`}
                >
                  Total efectivo:{" "}
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
                  Total banco:{" "}
                  {Math.abs(restanteBanco) < 1
                    ? "cuadrado"
                    : restanteBanco > 0
                      ? `falta ${formatMoney(restanteBanco)}`
                      : `te pasaste por ${formatMoney(-restanteBanco)}`}
                </div>
              </div>
            </div>
          )}

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
