import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, bindTokenHandlers, setAccessToken } from "../api/client";
import type { AuthState, UsuarioSesion } from "./types";

interface AuthContextValue extends AuthState {
  login: (identificador: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bindTokenHandlers(
      () => accessToken,
      (token) => {
        setAccessTokenState(token);
        setAccessToken(token);
      },
    );
  }, [accessToken]);

  async function restaurarSesion() {
    try {
      const { accessToken: token } = await apiFetch<{ accessToken: string }>("/auth/refresh", { method: "POST" });
      setAccessToken(token);
      setAccessTokenState(token);
      const perfil = await apiFetch<UsuarioSesion>("/auth/me");
      setUsuario(perfil);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    // Intento de sesión silenciosa: si hay una cookie de refresh válida, restaura la sesión sin pedir login.
    restaurarSesion().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // En móvil, al bloquear pantalla el navegador "congela" la pestaña: los
    // timers dejan de correr y el token de acceso (15 min) puede vencer
    // mientras está bloqueado. Sin esto, al desbloquear el mesero se
    // encontraba con la sesión rota (parecía logueado pero las acciones
    // fallaban) hasta cerrar sesión y volver a entrar a mano. Refrescar apenas
    // vuelve a primer plano evita llegar a ese estado.
    // Si el refresh falla acá (ej. pasaron las 10h de sesión), es mejor cerrar
    // la sesión de una vez y mostrar el login limpio, que dejar al usuario con
    // la app abierta pero rota — que fue justo la queja original.
    async function reintentarORefrescar() {
      const ok = await restaurarSesion();
      if (!ok) {
        setAccessToken(null);
        setAccessTokenState(null);
        setUsuario(null);
      }
    }
    function alVolverAPrimerPlano() {
      if (document.visibilityState === "visible") reintentarORefrescar();
    }
    function alRestaurarDesdeBfcache(evento: PageTransitionEvent) {
      // iOS Safari en particular puede restaurar la página desde bfcache (los
      // timers quedaron congelados desde antes de bloquear) sin disparar
      // "visibilitychange" — este evento sí se dispara en ese caso.
      if (evento.persisted) reintentarORefrescar();
    }
    document.addEventListener("visibilitychange", alVolverAPrimerPlano);
    window.addEventListener("pageshow", alRestaurarDesdeBfcache);
    return () => {
      document.removeEventListener("visibilitychange", alVolverAPrimerPlano);
      window.removeEventListener("pageshow", alRestaurarDesdeBfcache);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(identificador: string, password: string) {
    const result = await apiFetch<{ accessToken: string; usuario: UsuarioSesion }>("/auth/login", {
      method: "POST",
      body: { identificador, password },
    });
    setAccessToken(result.accessToken);
    setAccessTokenState(result.accessToken);
    setUsuario(result.usuario);
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    setAccessToken(null);
    setAccessTokenState(null);
    setUsuario(null);
  }

  const value = useMemo(
    () => ({ usuario, accessToken, loading, login, logout }),
    [usuario, accessToken, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
