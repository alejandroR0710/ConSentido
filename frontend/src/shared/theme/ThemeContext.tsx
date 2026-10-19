import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Tema = "light" | "dark";

const STORAGE_KEY = "cs-theme";

function temaDelSistema(): Tema {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function temaInicial(): Tema {
  try {
    const guardado = localStorage.getItem(STORAGE_KEY);
    if (guardado === "light" || guardado === "dark") return guardado;
  } catch {
    // localStorage puede no estar disponible (modo privado, permisos, etc.)
  }
  return temaDelSistema();
}

const ThemeContext = createContext<{ tema: Tema; alternarTema: () => void } | null>(null);

/** Tema manual (claro/oscuro) con botón en el header — antes el modo oscuro
 *  solo seguía la preferencia del sistema operativo, sin forma de elegirlo
 *  desde la app. Se guarda en localStorage y arranca con esa preferencia
 *  aplicada desde index.html (sin esto se ve un parpadeo del tema por
 *  defecto antes de que React monte). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(temaInicial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", tema === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, tema);
    } catch {
      // ignorar — el toggle ya quedó aplicado en esta sesión
    }
  }, [tema]);

  function alternarTema() {
    setTema((actual) => (actual === "dark" ? "light" : "dark"));
  }

  return <ThemeContext.Provider value={{ tema, alternarTema }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de ThemeProvider");
  return ctx;
}
