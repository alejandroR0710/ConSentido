import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { cajaApi, type ResumenTurno } from "../../modules/caja/api";
import { CerrarTurnoModal } from "../../modules/caja/components/CerrarTurnoModal";
import { OrdenesAbiertasAviso } from "../../modules/caja/components/OrdenesAbiertasAviso";
import { migaoApi, type OrdenResumen } from "../../modules/migao/api";
import { tieneAccesoTotal } from "../auth/roles";
import { useAuth } from "../auth/useAuth";

const POLL_MS = 20000;

/**
 * Vive en el header global (visible en cualquier vista, no solo dentro de
 * `/caja`). Sin turno abierto, es una píldora informativa que lleva a Caja
 * para abrir uno. Con turno abierto, se vuelve el botón de "Cerrar turno":
 * trae el resumen del turno (mismo que usa CajaPage) y abre el mismo modal
 * de cierre, sin necesidad de navegar a la página de Caja primero.
 */
export function IndicadorTurnoCaja() {
  const { usuario } = useAuth();
  const [turnoAbierto, setTurnoAbierto] = useState<boolean | null>(null);
  const [resumen, setResumen] = useState<ResumenTurno | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordenesAbiertas, setOrdenesAbiertas] = useState<OrdenResumen[] | null>(null);

  const puedeVer = usuario?.rol === "Cajero" || tieneAccesoTotal(usuario?.rol);

  useEffect(() => {
    if (!puedeVer) return;
    let cancelado = false;
    async function cargar() {
      try {
        const turno = await cajaApi.obtenerTurnoActual();
        if (!cancelado) setTurnoAbierto(turno !== null);
      } catch {
        /* si falla, simplemente no se muestra nada hasta el próximo intento */
      }
    }
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [puedeVer]);

  async function abrirCierre() {
    setCargandoResumen(true);
    setError(null);
    try {
      // Antes de ofrecer el cierre, se revisa si quedan cuentas abiertas en
      // Migao — cerrarlas primero evita que sus cobros (y lo que generarían
      // en Caja) se queden huérfanos del turno que se está cerrando.
      const abiertas = await migaoApi.listarOrdenesAbiertas();
      if (abiertas.length > 0) {
        setOrdenesAbiertas(abiertas);
        return;
      }
      const turno = await cajaApi.obtenerTurnoActual();
      if (!turno) {
        setTurnoAbierto(false);
        return;
      }
      setResumen(await cajaApi.obtenerResumenTurno(turno.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen del turno");
    } finally {
      setCargandoResumen(false);
    }
  }

  if (!puedeVer || turnoAbierto === null) return null;

  if (!turnoAbierto) {
    return (
      <Link
        to="/caja"
        className="hidden items-center gap-1.5 rounded-full border border-brand-vanilla-dark px-2.5 py-1 text-xs font-medium text-brand-ink/60 sm:flex dark:border-brand-green-700 dark:text-brand-vanilla/60"
      >
        <span className="text-brand-ink/40">●</span>
        Sin turno abierto
      </Link>
    );
  }

  return (
    <>
      <button
        onClick={abrirCierre}
        disabled={cargandoResumen}
        className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 sm:px-3 sm:text-sm"
      >
        <span aria-hidden>🔒</span>
        <span className="hidden sm:inline">{cargandoResumen ? "Cargando..." : "Cerrar turno"}</span>
      </button>
      {error && <span className="hidden text-xs text-red-600 sm:inline">{error}</span>}
      {ordenesAbiertas && (
        <OrdenesAbiertasAviso ordenes={ordenesAbiertas} onCerrar={() => setOrdenesAbiertas(null)} />
      )}
      {resumen && (
        <CerrarTurnoModal
          resumen={resumen}
          onCerrar={() => setResumen(null)}
          onCerrado={async () => {
            setTurnoAbierto(false);
          }}
        />
      )}
    </>
  );
}
