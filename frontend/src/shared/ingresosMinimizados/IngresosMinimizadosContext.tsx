import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import type { MetodoPagoValor } from "../components/SelectorMetodoPago";
import type { ModuloOrigenSlug } from "../../modules/caja/api";

/** Una línea del "carrito" de Registrar ingreso — mismo shape que
 *  IngresoModal.tsx usaba de forma local; vive acá para que el snapshot
 *  minimizado y el formulario compartan un solo tipo, sin import circular
 *  (IngresoModal importa de este archivo, nunca al revés). */
export interface LineaIngreso {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  // El cajero cambió el precio a mano: el mayorista automático ya no lo toca.
  precioManual?: boolean;
  // Solo queda seteado cuando la línea vino del autocompletar de productos —
  // escribir después de elegir lo limpia, porque el texto ya no coincide
  // necesariamente con el producto del catálogo.
  productoId?: string;
  // Obligatoria si la línea deja el producto en stock negativo.
  observacionInventario?: string;
}

/** De dónde sale este formulario — determina a qué pantalla navega restaurar
 *  y qué pasa después de registrar (ver IngresoModal.tsx/CajaPage.tsx/
 *  CotizacionesPage.tsx). `numeroCotizacion` viaja acá (no solo el id) porque
 *  es lo único que necesita el chip de la barra para su etiqueta. */
export type OrigenIngreso =
  | { tipo: "caja" }
  | { tipo: "cotizacion"; cotizacionId: string; numeroCotizacion: string };

/** El formulario completo y literal de "Registrar ingreso" — a diferencia de
 *  Migao, no hay ninguna entidad de backend que repedir al restaurar (nada se
 *  persiste hasta el único submit final), así que esto es exactamente lo que
 *  hace falta para reabrirlo tal cual (ver spec 2026-10-11). */
export interface FormularioIngreso {
  modulo: ModuloOrigenSlug;
  modoMonto: "unico" | "productos";
  monto: number;
  lineas: LineaIngreso[];
  descuentoPorcentaje: number;
  pago: MetodoPagoValor;
  montoRecibido: number;
  motivo: string;
}

export interface IngresoMinimizado {
  id: string;
  origen: OrigenIngreso;
  etiqueta: string;
  montoAproximado: number;
  minimizadoEn: string;
  formulario: FormularioIngreso;
}

interface IngresosMinimizadosContextValue {
  minimizados: IngresoMinimizado[];
  minimizar: (
    id: string,
    origen: OrigenIngreso,
    etiqueta: string,
    montoAproximado: number,
    formulario: FormularioIngreso,
  ) => void;
  restaurar: (id: string) => void;
  descartar: (id: string) => void;
  pendienteDeRestaurar: IngresoMinimizado | null;
  limpiarPendienteDeRestaurar: () => void;
}

const STORAGE_KEY_BASE = "caja-ingresos-minimizados";

const IngresosMinimizadosContext = createContext<IngresosMinimizadosContextValue | null>(null);

function leerDeLocalStorage(storageKey: string): Record<string, IngresoMinimizado> {
  try {
    const crudo = localStorage.getItem(storageKey);
    return crudo ? (JSON.parse(crudo) as Record<string, IngresoMinimizado>) : {};
  } catch {
    return {};
  }
}

/**
 * Formularios de "Registrar ingreso" minimizados a mitad de llenar — a
 * diferencia de CuentasMinimizadasContext (Migao), no hay ninguna entidad de
 * backend que volver a pedir: nada se persiste hasta el único submit final,
 * así que lo que se guarda es el formulario completo y literal. Mismo patrón
 * de montaje en AppShell.tsx y de persistencia por usuario en localStorage
 * que el Context de Migao.
 */
export function IngresosMinimizadosProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const storageKey = `${STORAGE_KEY_BASE}:${usuario?.id ?? "anonimo"}`;
  const [mapa, setMapa] = useState<Record<string, IngresoMinimizado>>(() => leerDeLocalStorage(storageKey));
  const [pendienteDeRestaurar, setPendienteDeRestaurar] = useState<IngresoMinimizado | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(mapa));
    } catch {
      // localStorage lleno o bloqueado (modo privado) — sigue funcionando en
      // memoria el resto de la sesión, solo no sobrevive un refresh.
    }
  }, [mapa, storageKey]);

  const minimizar = useCallback(
    (id: string, origen: OrigenIngreso, etiqueta: string, montoAproximado: number, formulario: FormularioIngreso) => {
      setMapa((prev) => ({
        ...prev,
        [id]: { id, origen, etiqueta, montoAproximado, minimizadoEn: new Date().toISOString(), formulario },
      }));
    },
    [],
  );

  const restaurar = useCallback(
    (id: string) => {
      const entry = mapa[id];
      if (!entry) return;
      setPendienteDeRestaurar(entry);
      setMapa((prev) => {
        const { [id]: _restaurado, ...resto } = prev;
        return resto;
      });
    },
    [mapa],
  );

  const descartar = useCallback((id: string) => {
    setMapa((prev) => {
      const { [id]: _descartado, ...resto } = prev;
      return resto;
    });
  }, []);

  const limpiarPendienteDeRestaurar = useCallback(() => setPendienteDeRestaurar(null), []);

  return (
    <IngresosMinimizadosContext.Provider
      value={{
        minimizados: Object.values(mapa),
        minimizar,
        restaurar,
        descartar,
        pendienteDeRestaurar,
        limpiarPendienteDeRestaurar,
      }}
    >
      {children}
    </IngresosMinimizadosContext.Provider>
  );
}

export function useIngresosMinimizados() {
  const ctx = useContext(IngresosMinimizadosContext);
  if (!ctx) throw new Error("useIngresosMinimizados debe usarse dentro de IngresosMinimizadosProvider");
  return ctx;
}
