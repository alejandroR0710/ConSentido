import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { MetodoPagoValor } from "../components/SelectorMetodoPago";

/** El subconjunto de estado de MigaoPage.tsx que representa una decisión ya
 *  tomada por el cajero — nunca el detalle/ítems de la cuenta, que siempre se
 *  vuelve a pedir fresco al backend al restaurar (ver spec 2026-10-10). */
export interface DecisionesCobroMigao {
  pago: MetodoPagoValor;
  montoRecibido: number;
  esAdministrativo: boolean;
  descuentoPorcentaje: number;
  propinaPorcentaje: 0 | 5 | 10 | null;
  propinaMontoCustom: number;
  propinaDecidida: boolean;
  propinaMetodoPago: "efectivo" | "banco";
  abonoForms: Record<
    string,
    { pago: MetodoPagoValor; montoPagarAhora: number; propina: number; montoRecibido: number }
  >;
  cantidadesSeleccionadas: Record<number, number>;
  modalPagarItemsAbierto: boolean;
  pagoItems: MetodoPagoValor;
  propinaItemsPorcentaje: 0 | 5 | 10 | null;
  propinaItemsMontoCustom: number;
  montoRecibidoItems: number;
}

export interface CuentaMinimizada {
  ordenId: string;
  etiqueta: string;
  montoAproximado: number;
  minimizadoEn: string;
  decisiones: DecisionesCobroMigao;
}

interface CuentasMinimizadasContextValue {
  minimizadas: CuentaMinimizada[];
  minimizar: (ordenId: string, etiqueta: string, montoAproximado: number, decisiones: DecisionesCobroMigao) => void;
  restaurar: (ordenId: string) => void;
  descartar: (ordenId: string) => void;
  pendienteDeRestaurar: CuentaMinimizada | null;
  limpiarPendienteDeRestaurar: () => void;
}

const STORAGE_KEY = "migao-cuentas-minimizadas";

const CuentasMinimizadasContext = createContext<CuentasMinimizadasContextValue | null>(null);

function leerDeLocalStorage(): Record<string, CuentaMinimizada> {
  try {
    const crudo = localStorage.getItem(STORAGE_KEY);
    return crudo ? (JSON.parse(crudo) as Record<string, CuentaMinimizada>) : {};
  } catch {
    return {};
  }
}

/**
 * Cuentas de Migao minimizadas a mitad de cobro (propina/método de pago ya
 * elegidos) — sobreviven navegar a otra pantalla y un refresh de página (ver
 * AppShell.tsx, mismo patrón que RefrescoProvider). Nunca guarda el detalle ni
 * los ítems de la cuenta, solo las decisiones del cajero.
 */
export function CuentasMinimizadasProvider({ children }: { children: ReactNode }) {
  const [mapa, setMapa] = useState<Record<string, CuentaMinimizada>>(() => leerDeLocalStorage());
  const [pendienteDeRestaurar, setPendienteDeRestaurar] = useState<CuentaMinimizada | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapa));
    } catch {
      // localStorage lleno o bloqueado (modo privado) — sigue funcionando en
      // memoria el resto de la sesión, solo no sobrevive un refresh.
    }
  }, [mapa]);

  const minimizar = useCallback(
    (ordenId: string, etiqueta: string, montoAproximado: number, decisiones: DecisionesCobroMigao) => {
      setMapa((prev) => ({
        ...prev,
        [ordenId]: { ordenId, etiqueta, montoAproximado, minimizadoEn: new Date().toISOString(), decisiones },
      }));
    },
    [],
  );

  const restaurar = useCallback(
    (ordenId: string) => {
      const entry = mapa[ordenId];
      if (!entry) return;
      setPendienteDeRestaurar(entry);
      setMapa((prev) => {
        const { [ordenId]: _restaurada, ...resto } = prev;
        return resto;
      });
    },
    [mapa],
  );

  const descartar = useCallback((ordenId: string) => {
    setMapa((prev) => {
      const { [ordenId]: _descartada, ...resto } = prev;
      return resto;
    });
  }, []);

  const limpiarPendienteDeRestaurar = useCallback(() => setPendienteDeRestaurar(null), []);

  return (
    <CuentasMinimizadasContext.Provider
      value={{
        minimizadas: Object.values(mapa),
        minimizar,
        restaurar,
        descartar,
        pendienteDeRestaurar,
        limpiarPendienteDeRestaurar,
      }}
    >
      {children}
    </CuentasMinimizadasContext.Provider>
  );
}

export function useCuentasMinimizadas() {
  const ctx = useContext(CuentasMinimizadasContext);
  if (!ctx) throw new Error("useCuentasMinimizadas debe usarse dentro de CuentasMinimizadasProvider");
  return ctx;
}
