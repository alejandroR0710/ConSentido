import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type FuncionRefresco = () => Promise<unknown> | void;

interface RefrescoContextValue {
  registrarRefresco: (fn: FuncionRefresco | null) => void;
  refrescar: () => Promise<void>;
  refrescando: boolean;
}

const RefrescoContext = createContext<RefrescoContextValue | null>(null);

/**
 * Botón único de "actualizar" en el header (ver AppShell.tsx): en vez de que
 * cada pantalla tenga su propio botón de recargar, cada una registra aquí su
 * función de carga de datos ya existente (la misma que usa el polling), y el
 * botón del header simplemente ejecuta la que esté registrada — nunca hace un
 * window.location.reload() de la página completa.
 */
export function RefrescoProvider({ children }: { children: ReactNode }) {
  const fnRef = useRef<FuncionRefresco | null>(null);
  const [refrescando, setRefrescando] = useState(false);

  const registrarRefresco = useCallback((fn: FuncionRefresco | null) => {
    fnRef.current = fn;
  }, []);

  const refrescar = useCallback(async () => {
    if (!fnRef.current) return;
    setRefrescando(true);
    try {
      await fnRef.current();
    } finally {
      setRefrescando(false);
    }
  }, []);

  return (
    <RefrescoContext.Provider value={{ registrarRefresco, refrescar, refrescando }}>
      {children}
    </RefrescoContext.Provider>
  );
}

export function useRefrescoVista() {
  const ctx = useContext(RefrescoContext);
  if (!ctx) throw new Error("useRefrescoVista debe usarse dentro de RefrescoProvider");
  return ctx;
}

/** Registra `fn` como la función que ejecuta el botón de actualizar del header
 *  mientras el componente que llama esto siga montado (se limpia solo al
 *  desmontar o navegar a otra vista). Sin dependencias: siempre registra la
 *  versión más reciente del closure, sin que el consumidor tenga que memoizarlo. */
export function useRegistrarRefresco(fn: FuncionRefresco) {
  const { registrarRefresco } = useRefrescoVista();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    registrarRefresco(fn);
    return () => registrarRefresco(null);
  });
}
