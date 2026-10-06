import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
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

  async function anular() {
    if (!id) return;
    const aviso = vale?.repuesto_en
      ? "Este vale ya está repuesto — anularlo revierte TANTO el egreso original como el de la reposición. ¿Anular igual?"
      : "¿Anular este vale? Si ya generó un egreso en Caja, se revierte.";
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

  const monto = Number(vale.monto_efectivo) + Number(vale.monto_banco);
  const puedeReponer = vale.fuente === "dueno" && !vale.repuesto_en && !vale.anulado_en;
  const puedeAnular = !vale.anulado_en;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/vales" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Vale {vale.numero}</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          {formatearFechaHora(vale.created_at)}
          {vale.anulado_en && <span className="ml-2 font-semibold text-red-600">· ANULADO</span>}
          {vale.repuesto_en && !vale.anulado_en && <span className="ml-2 font-semibold text-blue-600">· Repuesto</span>}
        </p>
        <button
          onClick={() => setImprimiendo(true)}
          className="mt-2 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        >
          🖨️ Imprimir vale
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-brand-vanilla-dark p-4 text-sm dark:border-brand-green-700">
          <p><span className="font-semibold">Pagado a:</span> {vale.pagado_a}</p>
          {vale.destinatario_usuario_nombre && <p><span className="font-semibold">Usuario vinculado:</span> {vale.destinatario_usuario_nombre}</p>}
          {vale.destinatario_documento && <p><span className="font-semibold">Documento:</span> {vale.destinatario_documento}</p>}
          <p><span className="font-semibold">Concepto:</span> {vale.concepto}</p>
          <p><span className="font-semibold">Monto:</span> {formatMoney(monto)}</p>
          <p><span className="font-semibold">Fuente:</span> {LABEL_FUENTE[vale.fuente]}</p>
          {vale.fuente === "dueno" && vale.dueno_nombre && <p><span className="font-semibold">Dueño:</span> {vale.dueno_nombre}</p>}
          {vale.creado_por_nombre && <p><span className="font-semibold">Registrado por:</span> {vale.creado_por_nombre}</p>}
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
