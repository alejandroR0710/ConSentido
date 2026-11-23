import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { useAuth } from "../../../shared/auth/useAuth";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type AcumuladoTotal } from "../api";

/**
 * Historial completo de todo lo que ha restado el Acumulado Total — mezcla
 * "Egreso del acumulado" (caja_egresos_acumulado) y "Bolsillo" (movimientos_caja
 * con es_bolsillo), ambos ya combinados por el backend en
 * obtenerAcumuladoTotal().egresos. Antes vivía como una lista desplegable
 * dentro de CajaHistorialPage; ahora que puede crecer mucho, tiene su
 * propia vista con el detalle completo.
 */
export function HistorialEgresosAcumuladoPage() {
  const { usuario } = useAuth();
  const [acumulado, setAcumulado] = useState<AcumuladoTotal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cajaApi
      .obtenerAcumuladoTotal()
      .then(setAcumulado)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial"))
      .finally(() => setLoading(false));
  }, []);

  // Misma vista exclusiva de Root/Super Root que CajaHistorialPage.
  if (!tieneAccesoTotal(usuario?.rol)) {
    return <Navigate to="/caja/historial" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/caja/historial" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Historial de egresos del Acumulado
        </h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Todo lo que ha restado del Acumulado Total: registrado como "Egreso del acumulado" o como "Bolsillo".
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : !acumulado || acumulado.egresos.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin egresos registrados todavía.</p>
      ) : (
        <div className="rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <ul className="flex flex-col divide-y divide-brand-vanilla-dark dark:divide-brand-green-700">
            {acumulado.egresos.map((e) => (
              <li key={`${e.origen}-${e.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-brand-ink dark:text-brand-vanilla">{e.categoria_nombre}</span>
                    {e.origen === "bolsillo" && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-400">
                        🟣 Bolsillo
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                    {new Date(e.created_at).toLocaleString("es")}
                    {e.proveedor_nombre && ` · ${e.proveedor_nombre}`}
                    {e.motivo && ` · ${e.motivo}`}
                    {e.usuario_nombre && ` · ${e.usuario_nombre}`}
                  </div>
                </div>
                <span className="shrink-0 font-semibold capitalize text-brand-ink dark:text-brand-vanilla">
                  {e.metodo_pago} {formatMoney(e.monto)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
