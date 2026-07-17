import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cajaApi } from "../../modules/caja/api";
import { tieneAccesoTotal } from "../auth/roles";
import { useAuth } from "../auth/useAuth";

const POLL_MS = 20000;

/** Píldora compacta en el header, visible en cualquier vista (no solo dentro de
 *  `/caja`), para que quien maneja caja sepa de un vistazo si ya hay un turno
 *  abierto sin tener que entrar a la página de Caja a averiguarlo. */
export function IndicadorTurnoCaja() {
  const { usuario } = useAuth();
  const [turnoAbierto, setTurnoAbierto] = useState<boolean | null>(null);

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

  if (!puedeVer || turnoAbierto === null) return null;

  return (
    <Link
      to="/caja"
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:flex ${
        turnoAbierto
          ? "border-brand-green-600 text-brand-green-700 dark:border-brand-green-500 dark:text-brand-vanilla"
          : "border-brand-vanilla-dark text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60"
      }`}
    >
      <span className={turnoAbierto ? "text-brand-green-600 dark:text-brand-green-400" : "text-brand-ink/40"}>
        ●
      </span>
      {turnoAbierto ? "Turno abierto" : "Sin turno abierto"}
    </Link>
  );
}
