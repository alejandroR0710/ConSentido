import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import {
  SelectorMetodoPago,
  faltaReferenciaBanco,
  referenciaBancoPayload,
  type MetodoPagoValor,
} from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type Vale } from "../api";
import { valeAReciboProps } from "../factura";

const LABEL_FUENTE: Record<string, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DetalleValePage() {
  const { id } = useParams<{ id: string }>();
  const [vale, setVale] = useState<Vale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [fuenteReposicion, setFuenteReposicion] = useState<"turno" | "acumulado">("turno");
  const [pidiendoReposicion, setPidiendoReposicion] = useState(false);
  const [pidiendoCobro, setPidiendoCobro] = useState(false);
  // El monto a cobrar es siempre el exacto que se debe (no editable) — solo
  // se elige el método; "mixto" sí necesita repartirlo, con feedback de
  // "cuadra"/"no cuadra" vía el totalFijo de SelectorMetodoPago.
  const [pagoCobro, setPagoCobro] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [imprimiendo, setImprimiendo] = useState(false);

  async function cargar() {
    if (!id) return;
    try {
      setVale(await valesApi.obtener(id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el vale");
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRegistrarRefresco(cargar);

  async function reponer() {
    if (!id) return;
    setProcesando(true);
    setError(null);
    try {
      await valesApi.marcarRepuesto(id, { fuenteReposicion });
      setPidiendoReposicion(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar como repuesto");
    } finally {
      setProcesando(false);
    }
  }

  async function cobrar(montoAdeudadoTotal: number) {
    if (!id) return;
    setProcesando(true);
    setError(null);
    try {
      await valesApi.cobrar(id, {
        ...(pagoCobro.metodoPago === "mixto"
          ? { metodoPago: "mixto", montoEfectivo: pagoCobro.montoEfectivo, montoBanco: pagoCobro.montoBanco }
          : { metodoPago: pagoCobro.metodoPago, monto: montoAdeudadoTotal }),
        ...referenciaBancoPayload(pagoCobro),
      });
      setPidiendoCobro(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar como cobrada");
    } finally {
      setProcesando(false);
    }
  }

  async function anular() {
    if (!id) return;
    const aviso =
      vale?.repuesto_en || vale?.cobrado_en
        ? "Este vale ya está repuesto o cobrado — anularlo revierte todo lo que haya pasado. ¿Anular igual?"
        : "¿Anular este vale? Si ya generó un movimiento en Caja, se revierte.";
    if (!confirm(aviso)) return;
    setProcesando(true);
    setError(null);
    try {
      await valesApi.anular(id);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo anular el vale");
    } finally {
      setProcesando(false);
    }
  }

  if (error && !vale) return <p className="text-sm text-red-600">{error}</p>;
  if (!vale) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const montoEfectivo = Number(vale.monto_efectivo);
  const montoBanco = Number(vale.monto_banco);
  const esMixto = montoEfectivo > 0 && montoBanco > 0;
  const montoAdeudadoTotal = vale.fuente ? montoEfectivo + montoBanco : Number(vale.monto_adeudado ?? 0);
  const puedeReponer = vale.fuente === "dueno" && !vale.repuesto_en && !vale.anulado_en;
  const puedeCobrar = vale.tipo === "deuda" && !vale.cobrado_en && !vale.anulado_en;
  const puedeAnular = !vale.anulado_en;
  const mixtoCobroInvalido =
    pagoCobro.metodoPago === "mixto" && Math.abs(pagoCobro.montoEfectivo + pagoCobro.montoBanco - montoAdeudadoTotal) > 0.01;
  const puedeConfirmarCobro = !mixtoCobroInvalido && !faltaReferenciaBanco(pagoCobro);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/vales" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
          {vale.tipo === "deuda" ? "Deuda" : "Vale"} {vale.numero}
        </h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          {formatearFechaHora(vale.created_at)}
          {vale.anulado_en && <span className="ml-2 font-semibold text-red-600">· ANULADO</span>}
          {vale.repuesto_en && !vale.anulado_en && <span className="ml-2 font-semibold text-blue-600">· Repuesto</span>}
          {vale.cobrado_en && !vale.anulado_en && <span className="ml-2 font-semibold text-blue-600">· Cobrada</span>}
        </p>
        <button
          onClick={() => setImprimiendo(true)}
          className="mt-2 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        >
          🖨️ Imprimir
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-brand-vanilla-dark p-4 text-sm dark:border-brand-green-700">
          <p><span className="font-semibold">{vale.tipo === "deuda" ? "Quién debe:" : "Pagado a:"}</span> {vale.pagado_a}</p>
          {vale.destinatario_usuario_nombre && <p><span className="font-semibold">Usuario vinculado:</span> {vale.destinatario_usuario_nombre}</p>}
          {vale.destinatario_documento && <p><span className="font-semibold">Documento:</span> {vale.destinatario_documento}</p>}
          <p><span className="font-semibold">Concepto:</span> {vale.concepto}</p>
          <p><span className="font-semibold">Monto:</span> {formatMoney(montoAdeudadoTotal)}</p>
          {vale.fuente && esMixto && (
            <p className="pl-4 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
              {formatMoney(montoEfectivo)} efectivo + {formatMoney(montoBanco)} banco
            </p>
          )}
          <p><span className="font-semibold">Fuente:</span> {vale.fuente ? LABEL_FUENTE[vale.fuente] : "Sin préstamo inicial"}</p>
          {vale.fuente === "dueno" && vale.dueno_nombre && <p><span className="font-semibold">Dueño:</span> {vale.dueno_nombre}</p>}
          {vale.creado_por_nombre && <p><span className="font-semibold">Registrado por:</span> {vale.creado_por_nombre}</p>}
          {vale.repuesto_en && (
            <p>
              <span className="font-semibold">Repuesto el:</span> {formatearFechaHora(vale.repuesto_en)}
              {vale.fuente_reposicion && ` — vía ${LABEL_FUENTE[vale.fuente_reposicion]}`}
            </p>
          )}
          {vale.cobrado_en && <p><span className="font-semibold">Cobrado el:</span> {formatearFechaHora(vale.cobrado_en)}</p>}
          {vale.anulado_en && (
            <p className="font-semibold text-red-600">Anulado el: {formatearFechaHora(vale.anulado_en)}</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {puedeReponer && (
            <div className="rounded-lg border border-blue-300 p-3 dark:border-blue-700">
              {!pidiendoReposicion ? (
                <button
                  onClick={() => setPidiendoReposicion(true)}
                  disabled={procesando}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Marcar como repuesto
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium">¿Con qué se le repone al dueño?</label>
                  <select
                    value={fuenteReposicion}
                    onChange={(e) => setFuenteReposicion(e.target.value as "turno" | "acumulado")}
                    className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                  >
                    <option value="turno">Turno abierto</option>
                    <option value="acumulado">Acumulado</option>
                  </select>
                  <button
                    onClick={reponer}
                    disabled={procesando}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {procesando ? "Procesando..." : "Confirmar reposición"}
                  </button>
                </div>
              )}
            </div>
          )}

          {puedeCobrar && (
            <div className="rounded-lg border border-blue-300 p-3 dark:border-blue-700">
              {!pidiendoCobro ? (
                <button
                  onClick={() => setPidiendoCobro(true)}
                  disabled={procesando}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Marcar como cobrada
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium">
                    Monto a cobrar (fijo): <span className="font-semibold">{formatMoney(montoAdeudadoTotal)}</span>
                  </p>
                  <SelectorMetodoPago value={pagoCobro} onChange={setPagoCobro} totalFijo={montoAdeudadoTotal} />
                  <button
                    onClick={() => cobrar(montoAdeudadoTotal)}
                    disabled={procesando || !puedeConfirmarCobro}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {procesando ? "Procesando..." : "Confirmar cobro"}
                  </button>
                </div>
              )}
            </div>
          )}

          {puedeAnular && (
            <button
              onClick={anular}
              disabled={procesando}
              className="rounded-md border border-red-400 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/30"
            >
              Anular vale
            </button>
          )}
        </div>
      </div>

      {imprimiendo && <ModalImprimir {...valeAReciboProps(vale)} onCerrar={() => setImprimiendo(false)} />}
    </div>
  );
}
